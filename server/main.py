"""The WebSocket server handling the client connections.
"""
import asyncio
from typing import TypedDict, NotRequired, Any, Literal, AsyncGenerator, Awaitable
from enum import Enum
import json
import os
import re
from copy import deepcopy

from websockets.server import serve, WebSocketServerProtocol
from websockets.exceptions import ConnectionClosedError, WebSocketException
import aiohttp



class ClientStatusEnum(Enum):
    """The WS client status enumeration"""
    Idle = 1
    NewTask = 2
    Interrupt = 3
    Working = 4
    Responding = 5
    Closed = 6


class IChatMessage(TypedDict):
    """Interface for a chat message.
    """
    role: Literal['user', 'system', 'assistant']
    """The role of the message."""

    content: str
    """The content of the message."""

    images: NotRequired[list[str]]
    """The list of images to analyze."""


class IChatPrompt(TypedDict):
    """Interface for a chat prompt."""
    messages: list[IChatMessage]
    """The list of chat messages."""

    stop: NotRequired[list[str]]
    """The list of stop words."""

    temperature: NotRequired[float]
    """The temperature of this prompt."""

    model: NotRequired[str]
    """The model of this prompt."""

    prefix: NotRequired[str]
    """The prefix of this prompt results."""


class IClientChatDetails(TypedDict):
    """The client chat details."""
    page: Literal['blank', 'editor']
    """The page of the UI."""

    messages: list[IChatMessage]
    """The conversation history."""

    conversation: NotRequired[str]
    """The string format of the conversation."""

    setup: NotRequired[dict[str, Any]]
    """The editor setup of an image."""


class IClientData(TypedDict):
    """The interface of a client data.
    """
    client: WebSocketServerProtocol
    """The WebSocket client"""

    id: int
    """The client ID."""

    lang: Literal['en', 'zh']
    """The language of the LLM."""

    action: dict[str, Any] | None
    """Any action required by the user."""

    status: ClientStatusEnum
    """The client status."""

    results: list[Any]
    """The results to be """

    chatDetails: IClientChatDetails | None
    """The chat details."""

    userName: NotRequired[str]
    """The user name."""

    fileName: NotRequired[str]
    """The file name."""

    images: NotRequired[list[str]]
    """The list of images to analyze."""



class PhotoEditorServer:
    """A photo editor server.
    """
    clients: dict[int, IClientData] = {}

    _client_index = 0

    prompts: dict[str, dict[str, IChatPrompt]] = {}
    """All the prompts."""

    prompt_error_message: dict[str, IChatPrompt] = {
        'en': {
            'messages': [{
                'role': "system",
                'content': "Generate a message to tell someone that you've experienced an error."
            }]
        },
        'zh': {
            'messages': [{
                'role': "system",
                'content': "請用正體中文撰寫一句話，告訴對方你正在發生錯誤，請稍後再試。"
            }]
        }
    }
    """The error message."""

    def __init__(self, prompt_folder: str = './prompts'):
        """Create a photo editor server.
        """
        # Check if the prompt folder exists.
        if not os.path.exists(prompt_folder) or not os.path.isdir(prompt_folder):
            raise ValueError("Server not conencted with valid prompt folder.")

        # Loop for all prompt files.
        file_names = os.listdir(prompt_folder)
        for file_name in file_names:
            # Skip for non-prompt files.
            if (
                not file_name.endswith('.prompts.json') or file_name.startswith('.')
                or os.path.isdir(file_name)
            ):
                continue

            # Load the prompt file.
            file_path = os.path.join(prompt_folder, file_name)
            with open(file_path, 'r', encoding='utf-8', newline='') as f:
                prompt_data = json.loads(f.read())
                if not isinstance(prompt_data, dict):
                    raise ValueError(f"Prompt data not in JSON object: {file_path}")

                # Add the prompt data.
                for lang_key, lang_prompts in prompt_data.items():
                    if lang_key in self.prompts:
                        self.prompts[lang_key] |= lang_prompts
                    else:
                        self.prompts[lang_key] = lang_prompts
        # Log the prompt count.
        print("Prompt Count:")
        for key, prompts in self.prompts.items():
            print(f"{key}: {len(prompts)}")

    def get_client_index(self) -> int:
        """To get the WS client index."""
        self._client_index += 1
        return self._client_index

    def get_prompts(
        self, lang: str, prompt_id: str, data: dict[str, Any] | None = None
    ) -> IChatPrompt:
        """To get the prompts.

        ### Parameters
        - lang: The language ID.
        - prompt_id: The prompt ID.
        - data: Data variables to be filled in the prompts.
        """
        # To get the prompt from the loaded prompts, and give fallback error message if needed.
        prompts = deepcopy(
            self.prompts.get(lang, {}).get(prompt_id)
            or self.prompt_error_message.get(lang, self.prompt_error_message['en']))

        # Replace variables.
        template = re.compile(r"(?<!\{)\{[a-zA-Z0-9\_]+\}(?!\})")

        def replace_content(match: re.Match):
            key = match.group()[1:-1]
            if key and data and key in data:
                return data[key]
            return ''

        for msg in prompts['messages']:
            msg['content'] = re.sub("{{", "{", re.sub("}}", "}", template.sub(
                replace_content, msg['content']
            )))

        print("GET prompt")
        print(data)
        print(prompts)
        print("======")
        return prompts

    async def _stream_from_llm(
        self, prompts: IChatPrompt, temperature: float = 0.0
    ) -> AsyncGenerator[dict[str, Any], None]:
        """To communicate with Ollama and handle the prompt. Works in stream mode and \
generate LLM responses.

        ### Parameters
        - prompts: The prompt setup to be used by the LLM.
        - temperature. The LLM temperature.

        ### Yields
        - Generating the LLM response message.
        """
        # Connect the Chat API.
        print("LLM Handling - stream.")
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://localhost:11434/api/chat",
                headers={
                    'Content-Type': 'application/json'
                },
                json={
                    'model': prompts['model'] if 'model' in prompts else 'llama3.1',
                    'messages': prompts['messages'],
                    'options': {
                        'temperature': prompts['temperature']
                            if 'temperature' in prompts else temperature,
                        'stop': prompts['stop'] if 'stop' in prompts else []
                    }
                }
            ) as response:
                # Raise error for non-200 responses.
                if response.status != 200:
                    raise ConnectionError()

                # Generate the response content.
                async for response_buffer in response.content:
                    response_chunk = response_buffer.decode("utf-8")
                    yield json.loads(response_chunk)

    async def _response_from_llm(
        self, prompts: IChatPrompt, temperature: float = 0.0
    ) -> str:
        """To communicate with Ollama and handle the prompt. Works in single API call.

        ### Parameters
        - prompts: The prompt setup to be used by the LLM.
        - temperature. The LLM temperature.

        ### Returns
        - The LLM response.
        """
        # Connect the Chat API.
        print("LLM Handling - response.")
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://localhost:11434/api/chat",
                headers={
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'llama3.1',
                    'messages': prompts['messages'],
                    'options': {
                        'temperature': prompts['temperature']
                            if 'temperature' in prompts else temperature,
                        'stop': prompts['stop'] if 'stop' in prompts else []
                    },
                    'stream': False
                }
            ) as response:
                # Raise error for non-200 responses.
                if response.status != 200:
                    raise ConnectionError()

                # Parse the data.
                data = await response.json()
                if 'message' not in data:
                    raise ValueError()

                # Parse the response.
                if isinstance(data['message'], str):
                    return data['message']
                if isinstance(data['message'], dict) and 'content' in data['message']:
                    return data['message']['content']

                raise ValueError()

    async def ensure_ws_send_message(self, client_info: IClientData, json_message: Any):
        """To ensure a message is sent to a client.
        """
        while not client_info['client'].closed:
            try:
                await client_info['client'].send(json.dumps(json_message))
                return True
            except ConnectionClosedError:
                return False

        return False

    async def stream_prompts(
        self,
        prompts: IChatPrompt,
        client_info: IClientData,
        flag_idle: bool = False,
        action: str | None = None
    ) -> bool:
        """To stream prompts from the LLM.

        ### Parameters
        - prompts: The prompts data to be used for LLM input.
        - client_info: The WS client data.
        - flag_idle: Whether to flag idle after completion.
        - action: Any action identifier for sending response messages.
        """
        # Get the client and set the status.
        client = client_info['client']
        client_info['status'] = ClientStatusEnum.Working

        # Non-sent messages.
        prev_msg = ""

        async for chunk_data in self._stream_from_llm(prompts):
            if client_info['id'] not in self.clients or client.closed or client_info['status'] in [
                ClientStatusEnum.Closed, ClientStatusEnum.Interrupt
            ]:
                return False

            if 'message' in chunk_data:
                # Check the status. Send the first response message.
                if client_info['status'] == ClientStatusEnum.Working:
                    client_info['status'] = ClientStatusEnum.Responding

                    # Send response start signal.
                    sent = await self.ensure_ws_send_message(client_info, {
                        'responseStart': True,
                        'action': action
                    })
                    if not sent:
                        return False

                text = chunk_data['message']['content'] if (
                    isinstance(chunk_data['message'], dict) and 'content' in chunk_data['message']
                ) else chunk_data['message'] if isinstance(chunk_data['message'], str) else None

                if text:
                    text = prev_msg + text
                    try:
                        await client.send(json.dumps({'response': text, 'action': action}))
                        prev_msg = ""
                    except ConnectionClosedError:
                        return False
                    except WebSocketException:
                        prev_msg = text

        # Continue trying re-sending message.
        if prev_msg:
            sent = await self.ensure_ws_send_message(
                client_info, {'response': prev_msg, 'action': action})
            if not sent:
                return False

        # Try response end signal.
        sent = await self.ensure_ws_send_message(
            client_info, {'responseEnd': True, 'action': action})
        if not sent:
            return False

        # Whether to flag idle.
        if flag_idle:
            # Update the client status.
            if client_info['status'] in [ClientStatusEnum.Working, ClientStatusEnum.Responding]:
                client_info['status'] = ClientStatusEnum.Idle

        return True

    async def submit_prompts(
        self,
        prompts: IChatPrompt,
        client_info: IClientData
    ) -> str:
        """To submit prompts for the LLM.

        ### Parameters
        - prompts: The prompts data to be used for LLM input.
        - client_info: The WS client data.
        """
        client_info['status'] = ClientStatusEnum.Working
        data = await self._response_from_llm(prompts)
        return data

    async def create_welcome_message(self, client_info: IClientData):
        """To create a welcome message.

        ### Parameters
        - client_info: The WS client data.
        """
        # Get the prompt.
        prompts: IChatPrompt = self.get_prompts(client_info['lang'], 'welcome')

        # Send the prompts.
        await self.stream_prompts(prompts, client_info, True, action='Welcome')

    async def create_image_opened_message(self, client_info: IClientData):
        """To create a image opened message.

        ### Parameters
        - client_info: The WS client data.
        """
        # Skip if no file name is given.
        if 'fileName' not in client_info:
            raise ValueError("No file name given.")

        # Get the prompt.
        prompts: IChatPrompt = self.get_prompts(client_info['lang'], 'imageOpened', {
            'file_name': client_info['fileName']
        })

        # Send the prompts.
        await self.stream_prompts(prompts, client_info, True, action='ImageOpened')

    async def create_auto_image_desc_message(self, client_info: IClientData):
        """To create an auto image description message.

        ### Parameters
        - client_info: The WS client data.
        """
        # Skip if no file name is given.
        if 'images' not in client_info:
            raise ValueError("No images given.")

        # Get the prompt and insert the system image with the images.
        prompts: IChatPrompt = self.get_prompts(client_info['lang'], 'autoDescription')
        prompts['messages'][0]['images'] = client_info['images']

        # Send the prompts.
        await self.stream_prompts(prompts, client_info, True, action='AutoImageDesc')

    async def edit_photo(self, client_info: IClientData):
        """To create an edit image message.

        ### Parameters
        - client_info: The WS client data.
        """
        # Skip if no chat details is given.
        if client_info['chatDetails'] is None or 'setup' not in client_info['chatDetails']:
            raise ValueError("No given chat details.")

        # Get the prompt and insert the system image with the images.
        original_setup = {
            'brightness': client_info['chatDetails']['setup']['brightness'],
            'contrast': client_info['chatDetails']['setup']['contrast'],
            'saturation': client_info['chatDetails']['setup']['saturation']
        }
        prompts: IChatPrompt = self.get_prompts('en', 'editImage', {
            'current_setup': json.dumps(original_setup),
            'conversation': self.get_conversation(client_info, 'en')
        })

        # Get the intent results.
        results = await self._response_from_llm(prompts)

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Trim the results string.
        results = results.strip()

        # Parse the JSON string.
        try:
            prefix = prompts['jsonPrefix'] if 'jsonPrefix' in prompts else ''
            adjustments = json.loads(prefix + results)
        except json.JSONDecodeError:
            await self.stream_not_understand(client_info)
            return

        # Send the edited setup.
        await self.ensure_ws_send_message(client_info, {
            'responseAction': "editImage",
            'setup': adjustments
        })

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Look for the difference.
        changes: str = ""
        for key, value in adjustments.items():
            if key in original_setup and value != original_setup[key]:
                changes += f"{key}: from {original_setup[key]} to {value}. "

        # Send the prompts.
        prompts: IChatPrompt = self.get_prompts(client_info['lang'], 'imageEdited', {
            'changes': changes
        }) if changes else self.get_prompts(client_info['lang'], 'imageNotEdited')
        await self.stream_prompts(prompts, client_info, True)

    async def crop_rotate(self, client_info: IClientData):
        """To create a crop or rotate image message.

        ### Parameters
        - client_info: The WS client data.
        """
        # Skip if no chat details is given.
        if client_info['chatDetails'] is None or 'setup' not in client_info['chatDetails']:
            raise ValueError("No given chat details.")

        # Get the prompt and insert the system image with the images.
        original_setup = {
            'crop': client_info['chatDetails']['setup']['crop'],
            'rotate': client_info['chatDetails']['setup']['rotate']
        }
        prompts: IChatPrompt = self.get_prompts('en', 'rotateCrop', {
            'current_setup': json.dumps(original_setup),
            'conversation': self.get_conversation(client_info, 'en')
        })

        # Get the intent results.
        results = await self._response_from_llm(prompts)

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Trim the results string.
        results = results.strip()

        # Parse the JSON string.
        try:
            prefix = prompts['jsonPrefix'] if 'jsonPrefix' in prompts else ''
            adjustments = json.loads(prefix + results)
        except json.JSONDecodeError:
            await self.stream_not_understand(client_info)
            return

        # Send the edited setup.
        await self.ensure_ws_send_message(client_info, {
            'responseAction': "editImage",
            'setup': adjustments
        })

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Look for the difference.
        changes: str = ""
        for key, value in adjustments.items():
            if key in original_setup and value != original_setup[key]:
                changes += f"{key}: from {original_setup[key]} to {value}. "

        # Send the prompts.
        prompts: IChatPrompt = self.get_prompts(client_info['lang'], 'imageEdited', {
            'changes': changes
        }) if changes else self.get_prompts(client_info['lang'], 'imageNotEdited')
        await self.stream_prompts(prompts, client_info, True)

    async def describe_image(self, client_info: IClientData):
        """To create an image description message.

        ### Parameters
        - client_info: The WS client data.
        """
        # Skip if no file name is given.
        if 'images' not in client_info:
            raise ValueError("No images given.")

        # Get the prompt and insert the system image with the images.
        prompts: IChatPrompt = self.get_prompts(client_info['lang'], 'describeImage', {
            'conversation': self.get_conversation(client_info, client_info['lang'])
        })
        prompts['messages'][0]['images'] = client_info['images']

        # Send the prompts.
        await self.stream_prompts(prompts, client_info, True)

    async def switch_lang_by_message(self, client_info: IClientData):
        """Handle switching language by message.

        ### Parameters
        - client_info: The WS client data.

        ### Notes
        Expected status: ClientStatusEnum.Working
        """
        # Get the prompt.
        prompts: IChatPrompt = self.get_prompts('en', 'switchLanguage', {
            'last_message': self.get_last_message(client_info)
        })

        # Get the intent results.
        results = await self._response_from_llm(prompts)

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Trim the results string.
        results = results.strip()

        # If it's not in number, raise error.
        if re.compile(r"^[0-9]+$").match(results) is None:
            raise ValueError()

        # Go to different flow.
        intent = int(results)
        if intent == 1:
            # Taiwan Mandarin
            client_info['lang'] = 'zh'
            await self.ensure_ws_send_message(client_info, {
                'responseAction': "switchLang",
                'lang': 'zh'
            })
            await self.stream_prompts(
                self.get_prompts('zh', 'langSwitched', {'lang': 'zh'}), client_info, True)

        elif intent == 2:
            # English
            client_info['lang'] = 'en'
            await self.ensure_ws_send_message(client_info, {
                'responseAction': "switchLang",
                'lang': 'en'
            })
            await self.stream_prompts(
                self.get_prompts('en', 'langSwitched', {'lang': 'en'}), client_info, True)

        elif intent == 3:
            # Not supported.
            await self.stream_prompts(self.get_prompts(client_info['lang'], 'langNotSupported', {
                'last_message': self.get_last_message(client_info)
            }), client_info, True)

        elif intent == 4:
            # Not mentioned.
            await self.stream_prompts(self.get_prompts(client_info['lang'], 'langReAsk', {
                'last_message': self.get_last_message(client_info)
            }), client_info, True)

        else:
            # Not understand retry.
            await self.stream_not_understand(client_info)

    def get_last_message(self, client_info: IClientData) -> str:
        """Get the latest message from the user.

        ### Parameters
        - client_info: The WS client data.
        """
        return client_info['chatDetails']['messages'][-1]['content'] \
            if client_info['chatDetails'] else ''

    def get_conversation(
        self,
        client_info: IClientData,
        lang: str,
        role_names: dict[str, dict[str, str]] | None = None
    ) -> str:
        """Get the conversation string from the message history array.

        ### Parameters
        - client_info: The WS client data.
        - lang: The language to be used.
        - role_names: The available role names in different languages.

        ### Returns
        - The conversation string.
        """
        # Skip for not chat details.
        chat_details = client_info['chatDetails']
        if not chat_details:
            return ''

        # Return cached copy of the conversation.
        if 'conversation' in chat_details:
            return chat_details['conversation']

        # Set the role name.
        default_role_names = {
            'zh': {
                'user': "使用者",
                'assistant': "斯德 (你)"
            },
            'en': {
                'user': "User",
                'assistant': "Cindex (You)"
            }
        }
        role_names = role_names or default_role_names
        lang_role_names = role_names.get(lang, default_role_names['en'])

        # Create the conversation string.
        conversation: list[str] = []
        for msg in chat_details['messages']:
            role = lang_role_names.get(msg['role'], msg['role'])
            conversation.append(f"{role}: ```{msg['content']}```")
        conversation_str = '\n'.join(conversation)

        # Set and return the conversation string.
        chat_details['conversation'] = conversation_str
        return conversation_str

    async def chat_in_blank_page(self, client_info: IClientData):
        """Handle chat in blank page.

        ### Parameters
        - client_info: The WS client data.
        """
        # Get the prompt.
        prompts: IChatPrompt = self.get_prompts('en', 'newFile', {
            'conversation': self.get_conversation(client_info, client_info['lang'])})

        # Get the intent results.
        client_info['status'] = ClientStatusEnum.Working
        results = await self._response_from_llm(prompts)

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Trim the results string.
        results = results.strip()

        # If it's not in number, raise error.
        if re.compile(r"^[0-9]+$").match(results) is None:
            print(results)
            raise ValueError()

        # Go to different flow.
        intent = int(results)
        if intent == 1:
            # Open file.
            # Send an open file message.
            await self.ensure_ws_send_message(client_info, {'responseAction': "openFile"})

            await self.stream_prompts(
                self.get_prompts(client_info['lang'], 'openFile'), client_info, True)
        elif intent == 2:
            # Save file.
            await self.stream_prompts(
                self.get_prompts(client_info['lang'], 'saveFileNoFile'), client_info, True)
        elif intent == 3:
            # Change language.
            await self.switch_lang_by_message(client_info)
        elif intent == 4:
            # Ask helper.
            await self.stream_prompts(self.get_prompts(client_info['lang'], 'about', {
                'conversation': self.get_conversation(client_info, client_info['lang'])
            }), client_info, True)
        elif intent == 5:
            # Casual chat.
            await self.stream_prompts(self.get_prompts(client_info['lang'], 'casualChat', {
                'conversation': self.get_conversation(client_info, client_info['lang'])
            }), client_info, True)

        else:
            # Not understand retry.
            await self.stream_not_understand(client_info)

    async def chat_in_editor(self, client_info: IClientData):
        """Handle chat in editor.

        ### Parameters
        - client_info: The WS client data.
        """
        # Get the prompt.
        prompts: IChatPrompt = self.get_prompts('en', 'chatEditor', {
            'conversation': self.get_conversation(client_info, client_info['lang'])})

        # Get the intent results.
        client_info['status'] = ClientStatusEnum.Working
        results = await self._response_from_llm(prompts)

        # Skip if the message is interrupted.
        if client_info['status'] == ClientStatusEnum.Interrupt:
            return

        # Trim the results string.
        results = results.strip()

        # If it's not in number, raise error.
        if re.compile(r"^[0-9]+$").match(results) is None:
            print(results)
            raise ValueError()

        # Go to different flow.
        intent = int(results)
        if intent == 1:
            # Open file.
            # Send an open file message.
            await self.ensure_ws_send_message(client_info, {'responseAction': "openFile"})

            await self.stream_prompts(
                self.get_prompts(client_info['lang'], 'openFile'), client_info, True)
        elif intent == 2:
            # Save file.
            # Send an open file message.
            await self.ensure_ws_send_message(client_info, {'responseAction': "saveFile"})

            await self.stream_prompts(
                self.get_prompts(client_info['lang'], 'saveFile'), client_info, True)
        elif intent == 3:
            # Change language.
            await self.switch_lang_by_message(client_info)
        elif intent == 4:
            # Edit photo.
            await self.edit_photo(client_info)
        elif intent == 5:
            # Crop and rotate photo.
            await self.crop_rotate(client_info)
        elif intent == 7:
            # Crop and rotate photo.
            await self.describe_image(client_info)
        elif intent == 8:
            # Ask helper.
            await self.stream_prompts(self.get_prompts(client_info['lang'], 'about', {
                'conversation': self.get_conversation(client_info, client_info['lang'])
            }), client_info, True)
        elif intent == 9:
            # Casual chat.
            await self.stream_prompts(self.get_prompts(client_info['lang'], 'casualChat', {
                'conversation': self.get_conversation(client_info, client_info['lang'])
            }), client_info, True)

        else:
            # Not understand retry.
            await self.stream_not_understand(client_info)

    async def stream_not_understand(self, client_info: IClientData):
        """Handle the flow of LLM not understanding in any steps.
        """
        # Send a not understand message to clear previous conversation history.
        await self.ensure_ws_send_message(client_info, {
            'responseAction': "notUnderstand"
        })

        # Stream a not understand response.
        await self.stream_prompts(self.get_prompts(client_info['lang'], 'notUnderstand', {
            'conversation': self.get_conversation(client_info, client_info['lang'])
        }), client_info, True)

    async def ws_llm_worker(self, client_info: IClientData):
        """A loop for handling data.
        """
        client = client_info['client']
        while not client.closed and client_info['id'] in self.clients:
            # Actions handler.
            if client_info['action']:
                data = client_info['action']
                client_info['action'] = None
                if data == 'Welcome':
                    print("Create Welcome Message.")
                    await self.create_welcome_message(client_info)

                elif data == 'ImageOpened':
                    print("Create Image Opened Message.")
                    await self.create_image_opened_message(client_info)

                elif data == 'Chat' and client_info['chatDetails']:
                    print("Create Chat Message.")
                    if client_info['chatDetails']['page'] == 'blank':
                        await self.chat_in_blank_page(client_info)
                    elif client_info['chatDetails']['page'] == 'editor':
                        await self.chat_in_editor(client_info)

                elif data == 'AutoImageDesc':
                    print("Create Auto Image Description Message.")
                    await self.create_auto_image_desc_message(client_info)

            await asyncio.sleep(.01)

    async def ws_receiver(self, client_info: IClientData):
        """A loop for receiving messages from the client.
        """
        client = client_info['client']
        async for message in client:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            print("Received message.")

            # Set language, file name, images first.
            if 'lang' in data:
                client_info['lang'] = data['lang']

            if 'fileName' in data:
                client_info['fileName'] = data['fileName']

            if 'images' in data:
                client_info['images'] = data['images']

            # Set the actions.
            if 'action' in data:
                client_info['action'] = data['action']
                if client_info['status'] in [
                    ClientStatusEnum.Working, ClientStatusEnum.Responding
                ]:
                    print("INTERRUPT")
                    client_info['status'] = ClientStatusEnum.Interrupt
                else:
                    client_info['status'] = ClientStatusEnum.NewTask

            if 'details' in data:
                client_info['chatDetails'] = data['details']

    async def ws_runtime(self, websocket: WebSocketServerProtocol):
        """The WebSocket runtime.

        ### Parameters
        - websocket: The WS client protocol object.
        """
        # Create client index and client info.
        client_id = self.get_client_index()
        client_info: IClientData = {
            'client': websocket,
            'id': client_id,
            'status': ClientStatusEnum.Idle,
            'results': [],
            'action': None,
            'lang': 'en',
            'chatDetails': None
        }
        self.clients[client_id] = client_info
        print("Client connected from: " + websocket.path)

        async with asyncio.TaskGroup() as tg:
            tg.create_task(self.ws_llm_worker(self.clients[client_id]))
            tg.create_task(self.ws_receiver(self.clients[client_id]))

        client_info['status'] = ClientStatusEnum.Closed
        del self.clients[client_id]

    async def run_server(self, host: str, port: int):
        async with serve(self.ws_runtime, host, port):
            print(f"WebSocket started on ws://{host}:{port}")
            await asyncio.Future()  # run forever

    def start(self):
        asyncio.run(self.run_server(host="localhost", port=8082))



if __name__ == '__main__':
    server = PhotoEditorServer()
    server.start()
