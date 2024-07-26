# A Photo Editor Concept with LLM

Repo for a concept design with LLM.

This is only a demo for how LLM can be interacted with traditional application, but not suggesting an idea of UX with LLM-only interface.

## System Requirements

- Ubuntu 24.04 (standalone / WSL2 on Windows 11) or above
- Python 3.12
- GPU: Nvidia RTX 3070 or above

## Local Test Execution

1. UI

   - Execute the following script to start the UI server.
```sh
# Go to the UI directory.
cd ui

# Start web server by node.js .
node server.js
```

   - Launch the UI on web browser:  http://localhost:8083

2. Ollama Server

   - Launch Ollama Server at http://localhost:11434
   - Ollama Version:  v0.3.0
   - Recommended models: `llama3.1`, `llava-llama3`.

2. LLM Communication Server

   - Execute Server Script (on host or venv)
```sh
# Go to the server directory.
cd server

# Start web server by node.js .
python main.py
```

## Prompts

All LLM prompts are intentionally skipped to be sync on GitHub. Please bring your own prompts to customize the behavior of the app. For further information, please check with the [README](./server/prompts/README.md) on the prompts folder.