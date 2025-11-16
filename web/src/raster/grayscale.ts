import type { RGBAImage } from "../formats/rgba_image.ts";
import { createRGBAImage, setPixelRGBA, getPixelRGBA } from "../formats/rgba_image.ts";

/**
 * Convert RGBA image to grayscale
 * Uses standard luminance formula: 0.299*R + 0.587*G + 0.114*B
 */
export function toGrayscale(img: RGBAImage): RGBAImage {
    const gray = createRGBAImage(img.width, img.height);

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const [r, g, b, a] = getPixelRGBA(img, x, y);

            // Calculate luminance
            const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

            // Set grayscale value
            setPixelRGBA(gray, x, y, luma, luma, luma, a);
        }
    }

    return gray;
}
