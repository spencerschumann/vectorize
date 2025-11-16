import type { CanvasBackend, CanvasLike } from "./pdf_render.ts";

/**
 * Browser canvas backend
 * Uses native browser HTMLCanvasElement
 */
export class BrowserCanvasBackend implements CanvasBackend {
    createCanvas(width: number, height: number): CanvasLike {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas as CanvasLike;
    }
}
