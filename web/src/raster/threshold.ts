import type { PalettizedImage } from "../formats/palettized.ts";
import type { BinaryImage } from "../formats/binary.ts";
import type { RGBAImage } from "../formats/rgba_image.ts";
import { getPixelPal } from "../formats/palettized.ts";
import { createBinaryImage, setPixelBin, getPixelBin } from "../formats/binary.ts";
import { createRGBAImage, getPixelRGBA, setPixelRGBA } from "../formats/rgba_image.ts";

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

/**
 * Extract black pixels from RGBA image based on luminosity threshold
 * Pixels with luminosity below the threshold are marked as black (1), others as white (0)
 * 
 * @param img - The RGBA image to process
 * @param luminosityThreshold - Threshold value from 0.0 to 1.0 (default 0.20)
 * @returns Binary image with black pixels extracted
 */
export function extractBlackFromRGBA(
    img: RGBAImage,
    luminosityThreshold: number = 0.20,
): BinaryImage {
    const binary = createBinaryImage(img.width, img.height);

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const [r, g, b] = getPixelRGBA(img, x, y);
            
            // Calculate luminosity (same formula as in extractBlack)
            const luminosity = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
            
            // If below threshold, it's black
            const isBlack = luminosity < luminosityThreshold;
            setPixelBin(binary, x, y, isBlack ? 1 : 0);
        }
    }

    return binary;
}

/**
 * Apply a 3x3 bloom filter to a binary image
 * For each pixel, if any pixel in its 3x3 neighborhood is black, set it to black
 * 
 * @param img - The binary image to process
 * @returns New binary image with bloom filter applied
 */
export function bloomFilter3x3(img: BinaryImage): BinaryImage {
    const result = createBinaryImage(img.width, img.height);

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            let hasBlackNeighbor = false;

            // Check 3x3 neighborhood
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;

                    // Check bounds
                    if (nx >= 0 && nx < img.width && ny >= 0 && ny < img.height) {
                        if (getPixelBin(img, nx, ny) === 1) {
                            hasBlackNeighbor = true;
                            break;
                        }
                    }
                }
                if (hasBlackNeighbor) break;
            }

            setPixelBin(result, x, y, hasBlackNeighbor ? 1 : 0);
        }
    }

    return result;
}

/**
 * Subtract bloom-filtered black from the original RGBA image
 * Where the bloom filter has black (1), set the RGBA image to white (255, 255, 255, 255)
 * 
 * @param img - The original RGBA image
 * @param bloomFiltered - The bloom-filtered binary image
 * @returns New RGBA image with black subtracted
 */
export function subtractBlack(
    img: RGBAImage,
    bloomFiltered: BinaryImage,
): RGBAImage {
    if (img.width !== bloomFiltered.width || img.height !== bloomFiltered.height) {
        throw new Error("Image dimensions must match");
    }

    const result = createRGBAImage(img.width, img.height);

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const isBlack = getPixelBin(bloomFiltered, x, y) === 1;

            if (isBlack) {
                // Set to white
                setPixelRGBA(result, x, y, 255, 255, 255, 255);
            } else {
                // Copy original pixel
                const [r, g, b, a] = getPixelRGBA(img, x, y);
                setPixelRGBA(result, x, y, r, g, b, a);
            }
        }
    }

    return result;
}
