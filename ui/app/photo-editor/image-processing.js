/**
 * Change the brightness contrast of a pixel.
 * Reference: https://github.com/GNOME/gimp/blob/GIMP_2_10_10/app/operations/gimpoperationbrightnesscontrast.c
 * @param {number} pixel The pixel value. (Value: 0 - 1)
 * @param {number} brightness The brightness value. (Value: -1 - 1)
 * @param {number} contrast The contrast value. (Value: -1 - 1)
 * @returns The updated pixel value.
 */
export function brightnessContrast(pixel, brightness, contrast) {
  // Brightness adjustment.
  pixel = brightness < 0 ? pixel * (1 + brightness) : pixel + (1 - pixel) * brightness;

  // Contrast adjustment.
  return (pixel - 0.5) * (contrast + 1) + 0.5;
}