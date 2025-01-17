/**
 * Module for some common utility functions.
 */
export class Utils {
  /**
   * To load a file.
   * @param {string} link The URL of the file.
   * @returns The text content of the file.
   */
  static async loadFile(link) {
    const response = await fetch(link);
    return await response.text();
  }

  /**
   * Async function to wait for one animation frame.
   */
  static async waitNextFrame() {
    await new Promise((res) => requestAnimationFrame(res));
  }

  /**
   * Async function to wait for some seconds.
   * @param {number} seconds The numbers to wait for.
   */
  static async waitSeconds(seconds) {
    await new Promise((res) => setTimeout(res, seconds));
  }
}