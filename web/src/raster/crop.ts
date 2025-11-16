import type { RGBAImage } from "../formats/rgba_image.ts";
import { createRGBAImage, setPixelRGBA, getPixelRGBA } from "../formats/rgba_image.ts";

/**
 * Crop rectangle
 */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Crop an RGBA image to the specified rectangle
 */
export function cropRGBA(img: RGBAImage, rect: CropRect): RGBAImage {
    const { x, y, width, height } = rect;

    // Validate crop bounds
    if (x < 0 || y < 0 || x + width > img.width || y + height > img.height) {
        throw new Error("Crop rectangle out of bounds");
    }

    const cropped = createRGBAImage(width, height);

    for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
            const [r, g, b, a] = getPixelRGBA(img, x + dx, y + dy);
            setPixelRGBA(cropped, dx, dy, r, g, b, a);
        }
    }

    return cropped;
}
