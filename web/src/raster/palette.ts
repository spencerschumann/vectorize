import type { RGBAImage } from "../formats/rgba_image.ts";
import type { PalettizedImage } from "../formats/palettized.ts";
import {
    createPalettizedImage,
    setPixelPal,
} from "../formats/palettized.ts";
import { getPixelRGBA } from "../formats/rgba_image.ts";

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

/**
 * Default 16-color palette as RGBA bytes (for GPU)
 */
export const DEFAULT_PALETTE_16_RGBA = new Uint8ClampedArray(
    new Uint32Array(DEFAULT_PALETTE_16).buffer
);

/**
 * Convert RGBA image to 16-color palettized image
 * Uses nearest color matching, no dithering
 */
export function palettize16(
    img: RGBAImage,
    palette: Uint32Array = DEFAULT_PALETTE_16,
): PalettizedImage {
    const pal = createPalettizedImage(img.width, img.height, palette);

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const [r, g, b] = getPixelRGBA(img, x, y);
            const colorIndex = findNearestColor(r, g, b, palette);
            setPixelPal(pal, x, y, colorIndex);
        }
    }

    return pal;
}

/**
 * Find the nearest color in the palette
 * Uses Euclidean distance in RGB space
 */
function findNearestColor(
    r: number,
    g: number,
    b: number,
    palette: Uint32Array,
): number {
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < palette.length; i++) {
        const color = palette[i];
        const pr = (color >> 24) & 0xff;
        const pg = (color >> 16) & 0xff;
        const pb = (color >> 8) & 0xff;

        const distance = Math.sqrt(
            (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2,
        );

        if (distance < minDistance) {
            minDistance = distance;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}
