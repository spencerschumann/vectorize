import type { PalettizedImage } from "../formats/palettized.ts";
import type { BinaryImage } from "../formats/binary.ts";
import { getPixelPal } from "../formats/palettized.ts";
import { createBinaryImage, setPixelBin } from "../formats/binary.ts";

/**
 * Options for extracting black channel
 */
export interface ThresholdOptions {
    whiteThreshold?: number; // 0.0 - 1.0, default 0.10
    blackThreshold?: number; // 0.0 - 1.0, default 0.05
}

/**
 * Extract black channel from palettized image
 * 
 * Equivalent to ImageMagick:
 *   -white-threshold 10%
 *   -colorspace Gray
 *   -threshold 5%
 * 
 * Assumes palette index 0 is white, index 1 is black
 */
export function extractBlack(
    img: PalettizedImage,
    options: ThresholdOptions = {},
): BinaryImage {
    const { whiteThreshold = 0.10, blackThreshold = 0.05 } = options;
    const binary = createBinaryImage(img.width, img.height);

    if (!img.palette) {
        throw new Error("Palettized image must have palette");
    }

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const paletteIndex = getPixelPal(img, x, y);
            const color = img.palette[paletteIndex];

            // Extract RGB from RGBA
            const r = (color >> 24) & 0xff;
            const g = (color >> 16) & 0xff;
            const b = (color >> 8) & 0xff;

            // Convert to grayscale (luminance)
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            const normalized = gray / 255.0;

            // Apply thresholds:
            // - If > whiteThreshold, it's white (0)
            // - If < blackThreshold, it's black (1)
            // - Between: use simple threshold at midpoint
            let isBlack = false;

            if (normalized > whiteThreshold) {
                isBlack = false;
            } else if (normalized < blackThreshold) {
                isBlack = true;
            } else {
                // Intermediate values
                const midpoint = (whiteThreshold + blackThreshold) / 2;
                isBlack = normalized < midpoint;
            }

            setPixelBin(binary, x, y, isBlack ? 1 : 0);
        }
    }

    return binary;
}
