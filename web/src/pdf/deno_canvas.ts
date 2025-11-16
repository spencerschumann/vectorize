import type { CanvasBackend, CanvasLike } from "./pdf_render.ts";

/**
 * Deno canvas backend
 * Uses the npm:canvas package (node-canvas)
 */
export class DenoCanvasBackend implements CanvasBackend {
    private canvasModule: any;

    constructor(canvasModule: any) {
        this.canvasModule = canvasModule;
    }

    createCanvas(width: number, height: number): CanvasLike {
        return this.canvasModule.createCanvas(width, height) as CanvasLike;
    }
}

/**
 * Create a Deno canvas backend
 * Usage in Deno:
 *   import canvas from "npm:canvas@^2.11.2";
 *   const backend = await createDenoCanvasBackend(canvas);
 */
export async function createDenoCanvasBackend(
    canvasModule: any,
): Promise<DenoCanvasBackend> {
    return new DenoCanvasBackend(canvasModule);
}
