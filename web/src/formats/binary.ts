/**
 * Binary image format
 * 1 bit per pixel, stored as 8 pixels per byte, MSB-first
 */
export interface BinaryImage {
    width: number;
    height: number;
    data: Uint8Array; // length = ceil(width * height / 8)
}

/**
 * Create an empty binary image
 */
export function createBinaryImage(width: number, height: number): BinaryImage {
    const size = Math.ceil((width * height) / 8);
    return {
        width,
        height,
        data: new Uint8Array(size),
    };
}

/**
 * Get pixel value at (x, y)
 * Returns 0 or 1
 */
export function getPixelBin(
    img: BinaryImage,
    x: number,
    y: number,
): 0 | 1 {
    const pixelIndex = y * img.width + x;
    const byteIndex = Math.floor(pixelIndex / 8);
    const bitIndex = 7 - (pixelIndex % 8); // MSB-first

    return ((img.data[byteIndex] >> bitIndex) & 1) as 0 | 1;
}

/**
 * Set pixel value at (x, y)
 * value must be 0 or 1
 */
export function setPixelBin(
    img: BinaryImage,
    x: number,
    y: number,
    value: 0 | 1,
): void {
    const pixelIndex = y * img.width + x;
    const byteIndex = Math.floor(pixelIndex / 8);
    const bitIndex = 7 - (pixelIndex % 8); // MSB-first

    if (value === 1) {
        img.data[byteIndex] |= 1 << bitIndex;
    } else {
        img.data[byteIndex] &= ~(1 << bitIndex);
    }
}

/**
 * Clone a binary image
 */
export function cloneBinaryImage(img: BinaryImage): BinaryImage {
    return {
        width: img.width,
        height: img.height,
        data: new Uint8Array(img.data),
    };
}
