/**
 * RGBA image format
 * Standard 4 bytes per pixel (Red, Green, Blue, Alpha)
 */
export interface RGBAImage {
    width: number;
    height: number;
    data: Uint8ClampedArray; // length = width * height * 4
}

/**
 * Create an empty RGBA image
 */
export function createRGBAImage(width: number, height: number): RGBAImage {
    return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
    };
}

/**
 * Get pixel value at (x, y)
 * Returns [r, g, b, a]
 */
export function getPixelRGBA(
    img: RGBAImage,
    x: number,
    y: number,
): [number, number, number, number] {
    const idx = (y * img.width + x) * 4;
    return [
        img.data[idx],
        img.data[idx + 1],
        img.data[idx + 2],
        img.data[idx + 3],
    ];
}

/**
 * Set pixel value at (x, y)
 */
export function setPixelRGBA(
    img: RGBAImage,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
): void {
    const idx = (y * img.width + x) * 4;
    img.data[idx] = r;
    img.data[idx + 1] = g;
    img.data[idx + 2] = b;
    img.data[idx + 3] = a;
}

/**
 * Clone an RGBA image
 */
export function cloneRGBAImage(img: RGBAImage): RGBAImage {
    return {
        width: img.width,
        height: img.height,
        data: new Uint8ClampedArray(img.data),
    };
}
