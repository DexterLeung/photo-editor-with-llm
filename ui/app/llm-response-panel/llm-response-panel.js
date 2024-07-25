import { BaseComponent } from "../../component.js";


/**
 * @typedef {import("../../scripts/llmClient.js").LLMClient} LLMClient
 */

/**
 * The LLM response panel element.
 */
export class LLMResponsePanel extends BaseComponent {
  static initialize() {
    customElements.define("llm-response-panel", LLMResponsePanel);
  }

  /** @type {"en" | "zh"} The language of this app. */
  #lang = "en";

  /** @type {LLMClient} The LLM client. */
  #llmClient;

  /** @type {HTMLDivElement} The message container. */
  messageContainer;

  /** @type {HTMLDivElement} The message container. */
  messageEle;

  /** @type {boolean} Whether LLM is loading. */
  #llmLoading = false;

  /**
   * @param {boolean} llmLoading Whether LLM is loading.
    */
  set llmLoading(llmLoading) {
    this.#llmLoading = llmLoading;
    this.#updateLoadingStatus();
  }

  constructor() {
    super();

    // Load the content of this component.
    this.loadComponents(
      ["/app/llm-response-panel/llm-response-panel.css"],
      ["/app/llm-response-panel/llm-response-panel.html"]
    );
  }

  finishLoad() {
    super.finishLoad();
    this.messageContainer = this._shadowRoot.querySelector(".llmMessage");
    this.messageEle = this._shadowRoot.querySelector(".llmMessage > .message");
    this.#updateLoadingStatus();
  }

  /**
   * To add an LLM client.
   * @param {LLMClient} llmClient 
   */
  addLLMClient(llmClient) {
    this.#llmClient = llmClient;
    this.#llmClient.addEventListener("llm_message", this.#onLLMMessage.bind(this), false);
  }

  /**
   * Triggered when the LLM client receives a message event.
   * @param {Event} e The message event.
   */
  #onLLMMessage(e) {
    const message = e.data;
    if (message.responseStart) {
      // Swap to message screen.
      this.llmLoading = false;

      // Remove previous message.
      this.messageEle.innerHTML = "";
    } else if (message.response) {
      this.messageEle.innerHTML += message.response;
    }
  }

  /**
   * To set as loading.
   */
  setAsLoading() {
    // Swap to loading screen.
    this.llmLoading = true;
  }

  /**
   * To update the UI loading status.
   */
  #updateLoadingStatus() {
    if (this._loaded) {
      // Swap to loading screen.
      if (this.#llmLoading) {
        this._shadowRoot.querySelector(".llmLoading").classList.remove("hidden");
        this._shadowRoot.querySelector(".llmMessage").classList.add("hidden");
      } else {
        this._shadowRoot.querySelector(".llmLoading").classList.add("hidden");
        this._shadowRoot.querySelector(".llmMessage").classList.remove("hidden");
      }
    }
  }
}