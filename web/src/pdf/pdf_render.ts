import type { RGBAImage } from "../formats/rgba_image.ts";

/**
 * Canvas backend interface
 * Allows for different implementations in browser vs Deno
 */
export interface CanvasBackend {
    createCanvas(width: number, height: number): CanvasLike;
}

/**
 * Minimal canvas interface needed for PDF rendering
 */
export interface CanvasLike {
    width: number;
    height: number;
    getContext(contextId: "2d"): CanvasRenderingContext2DLike | null;
}

/**
 * Minimal 2D context interface
 */
export interface CanvasRenderingContext2DLike {
    getImageData(
        sx: number,
        sy: number,
        sw: number,
        sh: number,
    ): ImageDataLike;
    putImageData(imageData: ImageDataLike, dx: number, dy: number): void;
    drawImage(image: unknown, dx: number, dy: number): void;
}

/**
 * Minimal ImageData interface
 */
export interface ImageDataLike {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/**
 * PDF rendering options
 */
export interface PDFRenderOptions {
    file: ArrayBuffer;
    pageNumber: number;
    dpi?: number;
    scale?: number;
}

/**
 * Render a PDF page to an RGBA image
 * Uses the provided canvas backend (browser or Deno)
 */
export async function renderPdfPage(
    options: PDFRenderOptions,
    backend: CanvasBackend,
    pdfjsLib: any,
): Promise<RGBAImage> {
    const { file, pageNumber, scale = 2.0 } = options;

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: file });
    const pdf = await loadingTask.promise;

    if (pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error(
            `Page ${pageNumber} out of range (1-${pdf.numPages})`,
        );
    }

    // Get page
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = backend.createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    if (!context) {
        throw new Error("Failed to get 2D context");
    }

    // Render page to canvas
    await page.render({
        canvasContext: context,
        viewport: viewport,
    }).promise;

    // Extract image data
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    return {
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
    };
}
