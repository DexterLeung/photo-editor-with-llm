import { BaseComponent } from "../../component.js";
import { Utils } from "../../scripts/utils.js";


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
  #messageEle;

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

    window.addEventListener("resize", this.#onWindowResize.bind(this), {passive: true, capture: false});
  }

  finishLoad() {
    super.finishLoad();
    this.messageContainer = this._shadowRoot.querySelector(".llmMessage");
    this.#messageEle = this._shadowRoot.querySelector(".llmMessage > .message");
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
      this.#messageEle.innerHTML = "";
    } else if (message.response) {
      // Update the LLM message.
      this.#messageEle.innerHTML += message.response;

      // Update the message position.
      this.#updateMessagePosition();
    }
  }

  #updateMessagePosition() {
    // Update scroll.
    const height = this.#messageEle.clientHeight;
    const wrapper = this.#messageEle.parentElement;
    const wrapperHeight = wrapper.clientHeight;
    if (wrapperHeight < height) {
      this.#messageEle.style.setProperty("margin-top", `-${height - wrapperHeight}px`);
    } else {
      this.#messageEle.style.setProperty("margin-top", `${(wrapperHeight - height) / 2}px`);
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

  /**
   * Triggered when the window is resized.
   */
  async #onWindowResize() {
    await Utils.waitNextFrame();
    this.#updateMessagePosition();
  }
}