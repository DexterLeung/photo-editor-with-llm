import { BaseComponent } from "../../component.js";
import { LLMClient } from "../../scripts/llmClient.js";
import { Utils } from "../../scripts/utils.js";
import { LLMResponsePanel } from "../llm-response-panel/llm-response-panel.js";
import { brightnessContrast } from "./image-processing.js";


/**
 * The photo editor element.
 */
export class PhotoEditor extends BaseComponent {
  static initialize() {
    customElements.define("photo-editor", PhotoEditor);
  }

  /** @type {HTMLTextAreaElement} The user message input textarea element. */
  userMessageInputEle;

  /** @type {"en" | "zh"} The language of this app. */
  #lang = "en";

  /** @type {LLMResponsePanel} The LLM response panel. */
  #llmResponsePanel;

  /** @type {LLMClient} The LLM client. */
  #llmClient;

  /** @type {File} The image file. */
  file;

  /** @type {HTMLAnchorElement} The save link element. */
  #saveFileLink;

  /** @type {string} The save file object URL. */
  #saveURL;

  /**
   * @type {boolean} Whether the image is loading.
   */
  #imageLoading = false;
  get imageLoading() {
    return this.#imageLoading;
  }

  /**
   * @type {ImageBitmap} The image bitmap of the file.
   */
  #imageBitmap;

  /** @type {HTMLCanvasElement} The image canvas. */
  #imageCanvas;

  /** @type {OffscreenCanvas} The original canvas of the file. */
  #originalCanvas;

  /**
   * @type {{[key: string]: any}} The image setup.
   */
  imageSetup = {
    brightness: 0,
    contrast: 0,
    saturation: 1,
    crop: undefined,
    rotate: 0
  };

  constructor() {
    super();

    // Add depending components.
    LLMResponsePanel.initialize();

    // Load the content of this component.
    this.loadComponents(
      ["/app/photo-editor/photo-editor.css"], ["/app/photo-editor/photo-editor.html"]
    );
  }

  /**
   * Get the current app page viewing status.
   * @returns {string} The app page viewing status.
   */
  getAppStatus() {
    if (!this.file) {
      return "blank";
    } else {
      return "editor";
    }
  }

  finishLoad() {
    super.finishLoad();

    // Enable the buttons.
    const controls = this._shadowRoot.querySelectorAll("#open-file-button, #user-message-input, #user-message-submit, select");
    for (const control of controls) {
      control.disabled = false;
    }

    // Set the LLM response panel.
    this.#llmResponsePanel = this._shadowRoot.querySelector("llm-response-panel");
    this.#llmResponsePanel.setAsLoading();

    // Set lang.
    const localLang = localStorage.getItem("lang") || (navigator.language.startsWith("zh") ? "zh" : "en");
    this.selectLang(localLang);

    // Change lang.
    /** @type {HTMLSelectElement} */
    const langSelector = this._shadowRoot.querySelector("#lang-selector");
    langSelector.addEventListener("change", () => this.selectLang(langSelector.selectedOptions[0].value));

    // Setup WebSocket client.
    this.#llmClient = new LLMClient("ws://localhost:8082/", this.#lang);
    this.#llmClient.addEventListener("llm_action", this.#onLLMAction.bind(this), false);
    this.#llmClient.addEventListener("llm_action_end", this.#onLLMActionEnd.bind(this), false);
    this.#llmResponsePanel.addLLMClient(this.#llmClient);
    this.#llmResponsePanel.setAsLoading();
    this.#llmClient.sendMessage({action: "Welcome", lang: this.#lang});

    // Setup Open File flow.
    /** @type {HTMLButtonElement} */
    const fileOpenButton = this._shadowRoot.querySelector("#open-file-button");
    /** @type {HTMLInputElement} */
    const fileInputButton = this._shadowRoot.querySelector("#open-file-input");
    fileOpenButton.addEventListener("click", () => fileInputButton.click(), false);
    fileInputButton.addEventListener("change", this.#onFileInput.bind(this), false);

    // Setup Save File flow
    const fileSaveButton = this._shadowRoot.querySelector("#save-file-button");
    fileSaveButton.addEventListener("click", this.#saveFile.bind(this), false);
    this.#saveFileLink = this._shadowRoot.querySelector("#save-file-link");

    // Setup the User Input Box for LLM interaction.
    /** @type {HTMLButtonElement} */
    const inputToggleButton = this._shadowRoot.querySelector("#add-message");
    inputToggleButton.addEventListener("click", this.#onToggleUserInput.bind(this), false);
    this.userMessageInputEle = this._shadowRoot.querySelector("#user-message-input");
    this.userMessageInputEle.addEventListener("keyup", this.#onUserMessageKeyUp.bind(this), false);
    const userMessageSubmitButton = this._shadowRoot.querySelector("#user-message-submit");
    userMessageSubmitButton.addEventListener("click", this.#onUserMessageSubmit.bind(this), false);

    // Listen the LLM client connected and disconnected events.
    this.#llmClient.addEventListener("connected", this.#onLLMConnected.bind(this), false);
    this.#llmClient.addEventListener("disconnected", this.#onLLMDisConnected.bind(this), false);

    // Set the canvas.
    this.#imageCanvas = this._shadowRoot.querySelector("#image-canvas");
    this.#originalCanvas = new OffscreenCanvas(this.#imageCanvas.width, this.#imageCanvas.height);
    window.addEventListener("resize", this.#onResize.bind(this), {capture: false, passive: true});
  }

  /**
   * Triggered when the LLM client is connected.
   */
  #onLLMConnected() {
    this._shadowRoot.querySelector("#user-message-submit")?.removeAttribute("disabled");
  }

  /**
   * Triggered when the LLM client is disconnected.
   */
  #onLLMDisConnected() {
    this._shadowRoot.querySelector("#user-message-submit")?.setAttribute("disabled", "");
  }

  /**
   * To select a language.
   * @param {"en" | "zh"} lang The language string.
   * @param {boolean} skipLLMUpdate Whether to skip LLM updates.
   */
  selectLang(lang, skipLLMUpdate = false) {
    // Update the language.
    this.#lang = lang;
    localStorage.setItem("lang", lang);
    const langSelector = this._shadowRoot.querySelector("#lang-selector");
    langSelector.selectedIndex = [...langSelector.options].findIndex(
      option => option.value === this.#lang);

    // Set the UI language.
    // Better to use with a translation service and translated text component. This is demo only.
    if (this._loaded) {
      if (lang === "en") {
        this._shadowRoot.querySelector("#open-file-button").innerHTML = "Open";
        this._shadowRoot.querySelector("#save-file-button").innerHTML = "Save";
      } else {
        this._shadowRoot.querySelector("#open-file-button").innerHTML = "開啟檔案";
        this._shadowRoot.querySelector("#save-file-button").innerHTML = "儲存";
      }
    }

    // Referesh the LLM message.
    if (!this.#llmClient) {
      return;
    }
    if (!this.file && !this.imageLoading && !skipLLMUpdate) {
      this.#llmResponsePanel.setAsLoading();
      this.#llmClient.sendMessage({action: "Welcome", lang: this.#lang});
    }
  }

  /**
   * Triggered when the File input is changed.
   * @param {InputEvent} e The input event.
   */
  async #onFileInput(e) {
    // Get the file from the input.
    /** @type {HTMLInputElement} The file input element. */
    const fileInputElement = e.currentTarget;
    this.file = fileInputElement.files[0];

    // Clear existing save URL.
    if (this.#saveURL) {
      URL.revokeObjectURL(this.#saveURL);
    }

    // Disable open file button and save file button.
    this._shadowRoot.querySelector("#open-file-button").setAttribute("disabled", "");
    this._shadowRoot.querySelector("#save-file-button").setAttribute("disabled", "");

    // Prepare image loading.
    this.#imageLoading = true;
    this.#imageCanvas.classList.add("hidden");

    // Tell the LLM that the image is loaded.
    this.#llmResponsePanel.setAsLoading();
    this.#llmClient.sendMessage(
      {action: "ImageOpened", lang: this.#lang, fileName: this.file.name});

    // Clear and load new image bitmap.
    if (this.#imageBitmap) {
      this.#imageBitmap.close();
    }
    this.#imageBitmap = await createImageBitmap(this.file);

    // Prepare canvas context.
    const ctx = this.#imageCanvas.getContext("2d");
    const rawCtx = this.#originalCanvas.getContext("2d");

    // Clear existing image.
    if (this.#imageCanvas.width) {
      ctx.clearRect(0, 0, this.#imageCanvas.width, this.#imageCanvas.height);
      rawCtx.clearRect(0, 0, this.#imageCanvas.width, this.#imageCanvas.height)
    }

    // Set the new canvas size.
    this.#imageCanvas.width = this.#imageBitmap.width;
    this.#imageCanvas.height = this.#imageBitmap.height;
    this.#originalCanvas.width = this.#imageBitmap.width;
    this.#originalCanvas.height = this.#imageBitmap.height;

    // Update the cropped ratio.
    const currentRatio = this.#imageBitmap.width / this.#imageBitmap.height;
    this.imageSetup.crop = (
      (currentRatio - 16/9) < 1e-5 ? "16:9" :
      (currentRatio - 16/10) < 1e-5 ? "16:10" :
      (currentRatio - 4/3) < 1e-5 ? "4:3" :
      (currentRatio - 5/4) < 1e-5 ? "5:4" :
      (currentRatio - 21/9) < 1e-5 ? "21:9" :
      (currentRatio - 1) < 1e-5 ? "1:1" :
      (currentRatio - 9/16) < 1e-5 ? "9:16" :
      (currentRatio - 10/16) < 1e-5 ? "10:16" :
      (currentRatio - 3/4) < 1e-5 ? "3:4" :
      (currentRatio - 4/5) < 1e-5 ? "4:5" :
      (currentRatio - 9/21) < 1e-5 ? "9:21" : (currentRatio.toFixed(2) + ":1")
    );

    // Draw the image.
    ctx.drawImage(this.#imageBitmap, 0, 0);
    rawCtx.drawImage(this.#imageBitmap, 0, 0);

    // Resize the show the canvas.
    this.resizeCanvas();
    this.#imageCanvas.classList.remove("hidden");
    this.#imageLoading = false;

    // Re-enable open file button and save file button.
    this._shadowRoot.querySelector("#open-file-button").removeAttribute("disabled");
    this._shadowRoot.querySelector("#save-file-button").removeAttribute("disabled");
  }

  /**
   * To save the current edits.
   */
  #saveFile() {
    // Clear existing save URL.
    if (this.#saveURL) {
      URL.revokeObjectURL(this.#saveURL);
    }

    // Convert the image to a save image link.
    this.#imageCanvas.toBlob((blob) => {
      this.#saveURL = URL.createObjectURL(blob);
      this.#saveFileLink.setAttribute("href", this.#saveURL);
      this.#saveFileLink.setAttribute("download", this.file.name);
      this.#saveFileLink.click();
    }, "image/jpeg", 0.85);
  }

  /**
   * To toggle user input box.
   */
  async #onToggleUserInput() {
    const buttonEle = this._shadowRoot.querySelector("#add-message");
    const userMessageEle = this._shadowRoot.querySelector("#user-message");
    const activated = buttonEle.classList.contains("activated");
    if (activated) {
      buttonEle.classList.remove("activated");
      userMessageEle.setAttribute("inert", "");
      userMessageEle.classList.add("hidden");
    } else {
      buttonEle.classList.add("activated");
      userMessageEle.removeAttribute("inert");
      userMessageEle.classList.remove("hidden");
      userMessageEle.querySelector("textarea").focus();
    }
  }

  /**
   * Triggered when the user message textarea experience `keyup` event.
   * @param {KeyboardEvent} e The `keyup` event.
   */
  #onUserMessageKeyUp(e) {
    if ((e.altKey || e.ctrlKey) && e.key === "Enter") {
      this.#submitUserMessage();
    }
  }

  /**
   * Triggered when the user message submit button is clicked.
   */
  #onUserMessageSubmit() {
    this.#submitUserMessage();
  }

  /**
   * To submit the user message.
   */
  async #submitUserMessage() {
    // Skip if the LLM client is not connected.
    if (!this.#llmClient.connected) {
      return;
    }

    // Get the user message and ensure there is some text.
    const userMessage = this.userMessageInputEle.value.trim();
    if (!userMessage.length) {
      return;
    }
    this.userMessageInputEle.value = "";

    // To submit the user message.
    this.#llmResponsePanel.setAsLoading();
    this.#llmClient.sendMessage({
      action: "Chat",
      details: {
        page: this.getAppStatus(),
        messages: [{
          role: "user",
          content: userMessage
        }],
        setup: {...this.imageSetup}
      },
      images: [this.getLLMImage()],
      lang: this.#lang
    });
  }

  /**
   * Triggered for LLM actions.
   * @param {MessageEvent} e The LLM action data.
   */
  #onLLMAction(e) {
    /** @type {{responseAction: string, [data: string]: any}} The message object data type. */
    const message = e.data;
    if (message.responseAction === "openFile") {
      this._shadowRoot.querySelector("#open-file-input").click();
    } else if (message.responseAction === "saveFile") {
      this.#saveFile();
    } else if (message.responseAction === "switchLang") {
      this.selectLang(message.lang, true);
    } else if (message.responseAction === "editImage") {
      // Check the changed values.
      const updatedKeys = [];
      for (const [key, value] of Object.entries(message.setup)) {
        if (key in this.imageSetup && this.imageSetup !== value) {
          this.imageSetup[key] = value;
          updatedKeys.push(key);
        }
      }

      // Change the brightness and contrast.
      if (updatedKeys.includes("brightness") || updatedKeys.includes("contrast")) {
        this.updateBrightnessContrast();
      }
    }
  }

  /**
   * To update the brightness contrast of the current image.
   */
  updateBrightnessContrast() {
    const ctx = this.#originalCanvas.getContext("2d");
    const ary = ctx.getImageData(0, 0, this.#originalCanvas.width, this.#originalCanvas.height).data;
    const {brightness, contrast} = this.imageSetup;
    const newAry = ary.map((v, i) => 
      Math.round(brightnessContrast(v / 256, brightness, contrast) * 256));
    const newImageData = new ImageData(newAry, this.#originalCanvas.width);
    this.#imageCanvas.getContext("2d").putImageData(newImageData, 0, 0);
  }

  /**
   * Triggered for LLM response end with action.
   * @param {MessageEvent} e The LLM action data.
   */
  #onLLMActionEnd(e) {
    /** @type {{action: string, [data: string]: any}} The message object data type. */
    const message = e.data;
    console.dir("Action End")
    if (message.action === "ImageOpened") {
      // NOTE: Skip for low performance.
      // this.#llmClient.sendMessage({action: "AutoImageDesc", images: [this.getLLMImage()]});
    }
  }

  /**
   * To scale fit the canvas.
   */
  resizeCanvas() {
    // Skip if there is no canvas yet.
    if (!this.#imageCanvas || !this.#imageBitmap) {
      return;
    }

    // Get the wrapper and image size.
    const wrapper = this.#imageCanvas.parentElement;
    const wrapperWidth = wrapper.clientWidth;
    const wrapperHeight = wrapper.clientHeight;
    const imageWidth = this.#imageBitmap.width;
    const imageHeight = this.#imageBitmap.height;

    // Set the scale of the canvas.
    let scale = 1;
    if ((wrapperWidth / wrapperHeight) > (imageWidth / imageHeight)) {
      scale = Math.min(1, 0.9 * wrapperHeight / imageHeight);
    } else {
      scale = Math.min(1, 0.9 * wrapperWidth / imageWidth);
    }

    // Set the view scale of the canvas.
    this.#imageCanvas.style.setProperty("--view-scale", scale);
  }

  /**
   * Triggered when the window is resized.
   */
  async #onResize() {
    await Utils.waitNextFrame();
    this.resizeCanvas();
  }


  /**
   * Get the image data string.
   * @param {number} sx The source x.
   * @param {number} sy The source y.
   * @param {number} sw The source width.
   * @param {number} sh The source height.
   * @returns {string} The base64 encoded string.
   */
  getLLMImage(sx = 0, sy = 0, sw = this.#imageBitmap?.width, sh = this.#imageBitmap?.height) {
    // Skip if there is no file.
    if (!this.file) {
      return undefined;
    }

    // Create the canvas and set the size.
    const canvas = document.createElement("canvas");
    if (sw > sh) {
      canvas.width = 1000;
      canvas.height = sh / sw * 1000;
    } else {
      canvas.width = sw / sh * 1000;
      canvas.height = 100;
    }

    // Draw the image and return the base64 URL.
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      this.#imageBitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75).slice(23);
  }
}