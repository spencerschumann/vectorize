/**
 * Palettized image format
 * 4 bits per pixel (16 colors), stored as 2 pixels per byte
 * High nibble = left pixel, low nibble = right pixel
 */
export interface PalettizedImage {
    width: number;
    height: number;
    data: Uint8Array; // length = ceil(width * height / 2)
    palette?: Uint32Array; // optional RGBA palette (16 colors)
}

/**
 * Create an empty palettized image
 */
export function createPalettizedImage(
    width: number,
    height: number,
    palette?: Uint32Array,
): PalettizedImage {
    const size = Math.ceil((width * height) / 2);
    return {
        width,
        height,
        data: new Uint8Array(size),
        palette,
    };
}

/**
 * Get pixel value at (x, y)
 * Returns index 0-15
 */
export function getPixelPal(
    img: PalettizedImage,
    x: number,
    y: number,
): number {
    const pixelIndex = y * img.width + x;
    const byteIndex = Math.floor(pixelIndex / 2);
    const isHighNibble = pixelIndex % 2 === 0;

    if (isHighNibble) {
        return (img.data[byteIndex] >> 4) & 0x0f;
    } else {
        return img.data[byteIndex] & 0x0f;
    }
}

/**
 * Set pixel value at (x, y)
 * value must be 0-15
 */
export function setPixelPal(
    img: PalettizedImage,
    x: number,
    y: number,
    value: number,
): void {
    const pixelIndex = y * img.width + x;
    const byteIndex = Math.floor(pixelIndex / 2);
    const isHighNibble = pixelIndex % 2 === 0;

    value = value & 0x0f; // ensure 0-15

    if (isHighNibble) {
        img.data[byteIndex] = (img.data[byteIndex] & 0x0f) | (value << 4);
    } else {
        img.data[byteIndex] = (img.data[byteIndex] & 0xf0) | value;
    }
}

/**
 * Default 16-color palette
 * Based on the original Python implementation
 */
export const DEFAULT_PALETTE_16: Uint32Array = new Uint32Array([
    0xffffffff, // 0: white
    0x000000ff, // 1: black
    0xff0000ff, // 2: red
    0x00ff00ff, // 3: green
    0x0000ffff, // 4: blue
    0xffff00ff, // 5: yellow
    0xff00ffff, // 6: magenta
    0x00ffffff, // 7: cyan
    0x808080ff, // 8: gray
    0xc0c0c0ff, // 9: light gray
    0x800000ff, // 10: dark red
    0x008000ff, // 11: dark green
    0x000080ff, // 12: dark blue
    0x808000ff, // 13: olive
    0x800080ff, // 14: purple
    0x008080ff, // 15: teal
]);
