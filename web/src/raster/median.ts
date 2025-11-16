import type { RGBAImage } from "../formats/rgba_image.ts";
import { createRGBAImage, setPixelRGBA, getPixelRGBA } from "../formats/rgba_image.ts";

/**
 * Apply 3x3 median filter to an RGBA image
 * Equivalent to ImageMagick: -statistic median 3x3
 * 
 * Processes each channel (R, G, B) independently
 */
export function median3x3(img: RGBAImage): RGBAImage {
    const filtered = createRGBAImage(img.width, img.height);
    const window: number[] = new Array(9);

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const [, , , a] = getPixelRGBA(img, x, y);

            // Collect 3x3 neighborhood for each channel
            const rValues: number[] = [];
            const gValues: number[] = [];
            const bValues: number[] = [];

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = Math.max(0, Math.min(img.width - 1, x + dx));
                    const ny = Math.max(0, Math.min(img.height - 1, y + dy));
                    const [r, g, b] = getPixelRGBA(img, nx, ny);

                    rValues.push(r);
                    gValues.push(g);
                    bValues.push(b);
                }
            }

            // Calculate median for each channel
            const medianR = median(rValues);
            const medianG = median(gValues);
            const medianB = median(bValues);

            setPixelRGBA(filtered, x, y, medianR, medianG, medianB, a);
        }
    }

    return filtered;
}

/**
 * Calculate median of an array of numbers
 */
function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    } else {
        return sorted[mid];
    }
}
