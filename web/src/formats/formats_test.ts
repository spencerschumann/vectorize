import { assertEquals } from "@std/assert";
import { getPixelPal, setPixelPal, createPalettizedImage } from "./palettized.ts";
import { getPixelBin, setPixelBin, createBinaryImage } from "./binary.ts";
import { toGrayscale } from "../raster/grayscale.ts";
import { cropRGBA } from "../raster/crop.ts";
import { createRGBAImage, setPixelRGBA, getPixelRGBA } from "./rgba_image.ts";

Deno.test("Palettized image - pixel get/set", () => {
    const img = createPalettizedImage(4, 4);

    // Set pixels
    setPixelPal(img, 0, 0, 15);
    setPixelPal(img, 1, 0, 7);
    setPixelPal(img, 2, 0, 3);
    setPixelPal(img, 3, 0, 0);

    // Get pixels
    assertEquals(getPixelPal(img, 0, 0), 15);
    assertEquals(getPixelPal(img, 1, 0), 7);
    assertEquals(getPixelPal(img, 2, 0), 3);
    assertEquals(getPixelPal(img, 3, 0), 0);
});

Deno.test("Binary image - pixel get/set", () => {
    const img = createBinaryImage(8, 8);

    // Set some pixels to 1
    setPixelBin(img, 0, 0, 1);
    setPixelBin(img, 7, 7, 1);
    setPixelBin(img, 3, 4, 1);

    // Check values
    assertEquals(getPixelBin(img, 0, 0), 1);
    assertEquals(getPixelBin(img, 7, 7), 1);
    assertEquals(getPixelBin(img, 3, 4), 1);
    assertEquals(getPixelBin(img, 1, 1), 0);
});

Deno.test("RGBA to grayscale conversion", () => {
    const img = createRGBAImage(2, 2);

    // Pure red pixel
    setPixelRGBA(img, 0, 0, 255, 0, 0, 255);
    // Pure green pixel
    setPixelRGBA(img, 1, 0, 0, 255, 0, 255);
    // Pure blue pixel
    setPixelRGBA(img, 0, 1, 0, 0, 255, 255);
    // White pixel
    setPixelRGBA(img, 1, 1, 255, 255, 255, 255);

    const gray = toGrayscale(img);

    // Check grayscale values (luminance formula: 0.299*R + 0.587*G + 0.114*B)
    const [r0] = getPixelRGBA(gray, 0, 0);
    assertEquals(r0, Math.round(0.299 * 255)); // Red -> ~76

    const [r1] = getPixelRGBA(gray, 1, 0);
    assertEquals(r1, Math.round(0.587 * 255)); // Green -> ~150

    const [r2] = getPixelRGBA(gray, 0, 1);
    assertEquals(r2, Math.round(0.114 * 255)); // Blue -> ~29

    const [r3] = getPixelRGBA(gray, 1, 1);
    assertEquals(r3, 255); // White -> 255
});

Deno.test("Crop RGBA image", () => {
    const img = createRGBAImage(10, 10);

    // Fill with a pattern
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            setPixelRGBA(img, x, y, x * 25, y * 25, 128, 255);
        }
    }

    // Crop center 4x4
    const cropped = cropRGBA(img, { x: 3, y: 3, width: 4, height: 4 });

    assertEquals(cropped.width, 4);
    assertEquals(cropped.height, 4);

    // Check that cropped pixel matches original
    const [r, g] = getPixelRGBA(cropped, 0, 0);
    assertEquals(r, 3 * 25);
    assertEquals(g, 3 * 25);
});

Deno.test("Palettized data packing", () => {
    const img = createPalettizedImage(10, 1);

    // 10 pixels = 5 bytes (2 pixels per byte)
    assertEquals(img.data.length, 5);

    // Set alternating values
    for (let i = 0; i < 10; i++) {
        setPixelPal(img, i, 0, i % 2 === 0 ? 0 : 15);
    }

    // Verify packing
    for (let i = 0; i < 10; i++) {
        const expected = i % 2 === 0 ? 0 : 15;
        assertEquals(getPixelPal(img, i, 0), expected);
    }
});

Deno.test("Binary data packing", () => {
    const img = createBinaryImage(16, 1);

    // 16 pixels = 2 bytes (8 pixels per byte)
    assertEquals(img.data.length, 2);

    // Set alternating bits
    for (let i = 0; i < 16; i++) {
        setPixelBin(img, i, 0, (i % 2) as 0 | 1);
    }

    // Verify packing
    for (let i = 0; i < 16; i++) {
        const expected = (i % 2) as 0 | 1;
        assertEquals(getPixelBin(img, i, 0), expected);
    }
});
