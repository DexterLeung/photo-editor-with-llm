# Prompts

This is the folder to save prompts.

Remarks:
- The prompts should be saved as `*.prompts.json`.
- The prompt file name should not start with `.` (a hidden file).

## Specs

A two level object.
- The first level is the language, currently supporting keys: `"zh"`, `"en"`.
- The second level is the prompt key.

The value of each prompt includes the following fields:

| Field | Data Type | Value |
|---|---|---|
| messages | Array<IChatMessage> | The list of chat messages as the prompt. |
| messages[].role | string | Either `"system"`, `"user"` or `"assistant"`. |
| messages[].content | string | A templatable string of the chat message. The template variables are within a pair of curly brackets. Double brackets escapes templating as a single curly bracket. Blank strings are not allowed and skipped. |
| stop | Array<string> | The list of stop words for LLM to stop responding. |
| temperature | float | The temperature of the LLM. |
| model | string | The Ollama model name. |

## Example
```json
{
  "zh": {
    "welcome": {
      "messages": [{
        "role": "system",
        "content": ""
      }, {
        "role": "user",
        "content": ""
      }],
      "stop": [],
      "temperature": 0.9
    },
  },
  "en": {
    "welcome": {
      "messages": [{
        "role": "system",
        "content": ""
      }, {
        "role": "user",
        "content": ""
      }],
      "stop": [],
      "temperature": 0.9
    },
  }
}
```