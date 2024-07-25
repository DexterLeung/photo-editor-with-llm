import { PhotoEditor } from "./app/photo-editor/photo-editor.js";



/**
 * The LLM App core script.
 */
class LMMApp {
  /** To initialize the app. */
  static initialize() {
    new LMMApp();
  }

  constructor() {
    // Start the app once the document is ready.
    if (document.readyState === "complete") {
      this.start();
    } else {
      window.addEventListener("load", this.start.bind(this), { capture: false, once: true });
    }
  }

  start() {
    // Initialize the PhotoEditor component.
    PhotoEditor.initialize();
  }
}

// Initialize the app.
LMMApp.initialize();
