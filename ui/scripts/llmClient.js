import { Utils } from "./utils.js";



export class LLMClient extends EventTarget {
  /** @type {string} The LLM language. */
  #lang;

  /** @type {boolean} Whether the LLM is responding. */
  #responding = false;

  /** @type {{role: string, content: string}} Any responding messages. */
  #respondingMessage;

  /** @type {WebSocket} The WebSocket connection. */
  #ws;

  /** @type {string} The WebSocket connection URL. */
  #url;

  /** @type {Array<{role: string, content: string, forget?: boolean}>} The chat history. */
  #chatHistory = [];

  /** @type {Array<Any>} The pending messages that WS has not been connected. */
  #pendingMessages = [];

  /** @type {{data:Array<Any>, response: string}} The working message that LLM is handling. */
  #workingMessage;

  /** @type {boolean} Get the connection status. */
  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Setup the LLM client.
   * @param {string} url The URL of the LLM client.
   * @param {"en" | "zh"} lang The language.
   */
  constructor(url = "ws://localhost:8082", lang = "en") {
    super();
    this.#lang = lang;
    this.#url = url;
    this.startWS();
  }

  /**
   * To start the WebSocket connection.
   */
  startWS() {
    // Avoid repeated connections.
    if (this.#ws) {
      return;
    }

    // Create new WS connection.
    this.#ws = new WebSocket(this.#url);
    this.#ws.addEventListener("open", this.#onWSOpened.bind(this), {once: true, capture: false});
    this.#ws.addEventListener("message", this.#onWSMessage.bind(this), {capture: false});
    this.#ws.addEventListener("error", this.#onWSError.bind(this), {capture: false, once: true});
    this.#ws.addEventListener("close", this.#onWSClosed.bind(this), {capture: false, once: true});
  }

  /**
   * Triggered when the WS connection is opened.
   */
  #onWSOpened() {
    console.info(`WebSocket opened on ${this.#ws.url}.`);

    // Add working message.
    if (this.#workingMessage) {
      this.#pendingMessages.splice(0, 0, this.#workingMessage.data);
    }

    // Submit pending messages.
    while (this.#pendingMessages.length) {
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#sendWSMessage(this.#pendingMessages[0]);
        this.#pendingMessages.splice(0, 1);
      } else {
        return;
      }
    }

    // Dispatch the message event.
    this.dispatchEvent(new Event("connected"));
  }

  /**
   * Triggered when the WS connection is opened.
   */
  #onWSError(e) {
    console.info(`WebSocket error: ${this.#ws.url}.`);
    console.error(e)
    this.#ws.close();
  }

  /**
   * Triggered when the WS connection has received message.
   * @param {MessageEvent} e The messge event.
   */
  #onWSMessage(e) {
    // Handle only in valid respond state.
    if (!this.#responding) {
      return;
    }

    // Parse the data.
    const data = JSON.parse(e.data);

    // Remove working message if needed.
    if (data.responseEnd && this.#workingMessage) {
      this.#workingMessage = undefined;
    }

    // Add LLM response to chat history.
    if (data.responseStart) {
      this.#respondingMessage = {
        role: "assistant", content: ""
      };
      this.#chatHistory.push(this.#respondingMessage);
    } else if (data.response) {
      const currentMsg = this.#chatHistory.at(-1);
      if (currentMsg) {
        currentMsg.content += data.response;
      }
    } else if (data.responseEnd) {
      this.wrapLLMTurn();
      
      // Dispatch special response end.
      if (data.action) {
        this.dispatchEvent(new MessageEvent("llm_action_end", {data}));
      }
    }

    // Dynamic response actions.
    if (data.responseAction) {
      if (data.responseAction === "notUnderstand") {
        // Forget messages that don't understand.
        const lastMsg = this.#chatHistory.findLast(msg => msg.role === 'user');
        if (lastMsg) {
          lastMsg.forget = true;
        }
      } else {
        // Dispatch other actions.
        this.dispatchEvent(new MessageEvent("llm_action", {data}));
      }
    } else {
      // Dispatch the message event.
      this.dispatchEvent(new MessageEvent("llm_message", {data}));
    }
  }

  /**
   * To wrap existing LLM turn.
   */
  async wrapLLMTurn() {
    // Skip if LLM turn does not exist.
    if (!this.#responding) {
      return;
    }

    // Unset responding status.
    this.#responding = false;

    // Skip if LLM turn message does not exist.
    if (!this.#respondingMessage) {
      return;
    }

    // Check the last user message.
    const lastUserMsgIdx = this.#chatHistory.findLastIndex(msg => msg.role === 'user');

    // Check whether to set forget message.
    let setForget = false;
    if (lastUserMsgIdx >= 0 && this.#chatHistory[lastUserMsgIdx]?.forget) {
      setForget = true;
    }

    // Trim the message and set forget.
    this.#respondingMessage.content = this.#respondingMessage.content.trim();
    if (setForget) {
      this.#respondingMessage.forget = true;
    }

    // Dispatch message finish event.
    this.dispatchEvent(new MessageEvent("message_finish", {
      data: this.#respondingMessage
    }));
  }

  /**
   * Triggered when the WS connection is closed.
   */
  async #onWSClosed() {
    console.info(`WebSocket closed: ${this.#ws.url}.`);

    // Dispatch the message event.
    this.dispatchEvent(new Event("disconnected"));

    // Wait for 3 seconds, clear the WebSocket then reconnect.
    await Utils.waitSeconds(3);
    this.#ws = undefined;
    this.startWS();
  }

  /**
   * To directly send the message to the LLM server.
   * @param {any} data The content of the message.
   */
  #sendWSMessage(data) {
    // Set the working message.
    this.#workingMessage = {
      data, response: ""
    };

    // Send the data to WS server.
    this.#ws.send(JSON.stringify(data));
  }

  /**
   * To consolidate all messages as LLM history.
   * @returns {Array<{role: string, content: string}>} The messages as history.
   */
  #consolidateMessageHistory() {
    return this.#chatHistory.filter((msg, idx) =>
      !msg.forget && !msg?.length && (idx > 0 || msg.role !== "assistant"));
  }

  /**
   * To send a message to LLM server.
   * @param {any} data The message to be submitted.
   * @param {boolean} keepPreviousMessages Whether to keep previous messages.
   */
  sendMessage(data, keepPreviousMessages = false) {
    // Clear current working message.
    this.#workingMessage = undefined;

    // Interrupt current responds.
    if (this.#responding) {
      this.wrapLLMTurn();
    }

    // Reset responding data.
    this.#responding = true;
    this.#respondingMessage = undefined;

    // Check if it's a chat action, add the conversation history into it.
    if (data.action === "Chat") {
      const messages = data.details?.messages;
      if (!messages?.length) {
        throw "Message data error in submitting chat messages."
      }
      data.details.messages = [...this.#consolidateMessageHistory(), messages[0]];
      this.#chatHistory.push(messages[0]);
      this.dispatchEvent(new MessageEvent("message_finish", {
        data: messages[0]
      }));
    }

    // Determine whether to send right now or later.
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#sendWSMessage(data);
    } else if (keepPreviousMessages) {
      this.#pendingMessages.push(data);
    } else {
      this.#pendingMessages = [data];
    }
  }
}