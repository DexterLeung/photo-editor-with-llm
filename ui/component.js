import { Utils } from "./scripts/utils.js"


/**
 * The base WebComponent class.
 */
export class BaseComponent extends HTMLElement {
  /** @type {ShadowRoot} The shadow root of the component. */
  _shadowRoot;

  /** Whether this component is loaded. */
  _loaded = false;

  /**
   * To initialize the component.
   */
  static initialize() {
    throw "Not implemented."
  }

  /**
   * Load the content of the component, including stylesheets or the HTML template content.
   * @param {Array<string>} styleSheets The style sheets to be used. (File paths)
   * @param {Array<string>} templates The HTML templates to be used. (File paths)
   */
  async loadComponents(styleSheets = [], templates = []) {
    // Attach the shadow root.
    this._shadowRoot = this.attachShadow({mode: "closed"});

    // Dynamic content to be loaded in each component.
    await Promise.all([
      this.addStyleSheets(styleSheets), this.addTemplates(templates)
    ]);

    this.finishLoad();
  }

  /**
   * Add style sheets to this component.
   * @param {Array<string>} styleSheets The style sheets to be used. (File paths)
   */
  async addStyleSheets(styleSheets) {
    const styleSheetContents = await Promise.all(styleSheets.map(stylesheet => Utils.loadFile(stylesheet)));
    for (const styleSheetContent of styleSheetContents) {
      const styleSheet = document.createElement("style");
      styleSheet.innerHTML = styleSheetContent;
      this._shadowRoot.append(styleSheet);
    }
  }

  /**
   * Add HTML templates to this component.
   * @param {Array<string>} templates The HTML templates to be used. (File paths)
   */
  async addTemplates(templates) {
    const templateContents = await Promise.all(templates.map(template => Utils.loadFile(template)));
    for (const templateContent of templateContents) {
      const template = document.createElement("template");
      template.innerHTML = templateContent;
      this._shadowRoot.append(template.content);
    }
  }

  /**
   * Finish loading the component.
   */
  finishLoad() {
    // Flag loaded to be true to stat it's loaded.
    this._loaded = true;
  }
}