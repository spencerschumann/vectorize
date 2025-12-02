/// <reference lib="deno.ns" />
import type { RGBAImage } from "../formats/rgba_image.ts";

/**
 * Deno PDF rendering using external tools (ImageMagick, poppler, etc.)
 * This provides actual pixel-perfect rendering by delegating to proven tools
 */

/**
 * PDF rendering options
 */
export interface PDFRenderOptions {
    pageNumber: number;
    dpi?: number;
}

/**
 * Render a PDF page using ImageMagick + Ghostscript
 */
export async function renderPdfPageDeno(
    pdfPath: string,
    options: PDFRenderOptions,
): Promise<RGBAImage> {
    const { pageNumber, dpi = 200.02 } = options;

    if (!await hasImageMagick()) {
        throw new Error("ImageMagick is required for PDF rendering in Deno. Please install ImageMagick and Ghostscript.");
    }

    return await renderWithImageMagick(pdfPath, pageNumber, dpi);
}

/**
 * Check if ImageMagick is available
 */
async function hasImageMagick(): Promise<boolean> {
    try {
        const cmd = new Deno.Command("magick", {
            args: ["--version"],
            stdout: "null",
            stderr: "null",
        });
        const { code } = await cmd.output();
        return code === 0;
    } catch {
        return false;
    }
}

/**
 * Render PDF using ImageMagick
 */
async function renderWithImageMagick(
    pdfPath: string,
    pageNumber: number,
    dpi: number,
): Promise<RGBAImage> {
    // Create temp PNG file for intermediate output
    const tempPng = await Deno.makeTempFile({ suffix: ".png" });

    try {
        // Step 1: Render PDF to PNG (much faster than direct RGBA)
        // Note: -density must come BEFORE the input file
        console.log(`Rendering PDF page ${pageNumber} to PNG at ${dpi} dpi...`);
        const renderCmd = new Deno.Command("magick", {
            args: [
                "-density", dpi.toString(),
                `${pdfPath}[${pageNumber - 1}]`,  // ImageMagick uses 0-based indexing
                "-colorspace", "sRGB",
                tempPng,
            ],
            stdout: "piped",
            stderr: "piped",
        });

        const { code: renderCode, stderr: renderStderr } = await renderCmd.output();

        if (renderCode !== 0) {
            const errorText = new TextDecoder().decode(renderStderr);
            throw new Error(`ImageMagick render failed: ${errorText}`);
        }

        // Step 2: Get PNG dimensions
        const identifyCmd = new Deno.Command("magick", {
            args: [
                "identify",
                "-format", "%w %h",
                tempPng,
            ],
            stdout: "piped",
        });

        const { stdout } = await identifyCmd.output();
        const dimensions = new TextDecoder().decode(stdout).trim().split(" ");
        const width = parseInt(dimensions[0]);
        const height = parseInt(dimensions[1]);

        // Step 3: Convert PNG to raw RGBA
        console.log(`Converting PNG to RGBA: ${width}x${height} pixels`);
        const convertCmd = new Deno.Command("magick", {
            args: [
                tempPng,
                "-depth", "8",
                "RGBA:-",  // Output to stdout
            ],
            stdout: "piped",
            stderr: "piped",
        });

        const { code: convertCode, stdout: rgbaData, stderr: convertStderr } = await convertCmd.output();

        if (convertCode !== 0) {
            const errorText = new TextDecoder().decode(convertStderr);
            throw new Error(`ImageMagick convert failed: ${errorText}`);
        }

        if (rgbaData.length !== width * height * 4) {
            throw new Error(`Size mismatch: expected ${width * height * 4} bytes, got ${rgbaData.length}`);
        }

        console.log(`Rendered with ImageMagick: ${width}x${height} @ ${dpi}dpi`);

        return {
            width,
            height,
            data: new Uint8ClampedArray(rgbaData),
        };
    } finally {
        // Clean up temp file
        try {
            await Deno.remove(tempPng);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Get PDF info using ImageMagick
 */
export async function getPdfInfo(pdfPath: string) {
    if (!await hasImageMagick()) {
        throw new Error("ImageMagick is required. Please install ImageMagick and Ghostscript.");
    }

    try {
        // Get page count
        const identifyCmd = new Deno.Command("magick", {
            args: [
                "identify",
                "-format", "%n",
                pdfPath,
            ],
            stdout: "piped",
            stderr: "piped",
        });

        const { code, stdout, stderr } = await identifyCmd.output();

        if (code !== 0) {
            const errorText = new TextDecoder().decode(stderr);
            throw new Error(`Failed to identify PDF: ${errorText}`);
        }

        const pageCountStr = new TextDecoder().decode(stdout).trim();
        const pageCount = parseInt(pageCountStr) || 1;

        // Get dimensions for each page
        const pages = [];
        for (let i = 0; i < pageCount; i++) {
            const dimCmd = new Deno.Command("magick", {
                args: [
                    "identify",
                    "-format", "%w %h",
                    `${pdfPath}[${i}]`,
                ],
                stdout: "piped",
            });

            const { stdout: dimStdout } = await dimCmd.output();
            const dimensions = new TextDecoder().decode(dimStdout).trim().split(" ");

            pages.push({
                number: i + 1,
                width: parseInt(dimensions[0]) || 612,
                height: parseInt(dimensions[1]) || 792,
            });
        }

        return { pageCount, pages };
    } catch (error) {
        throw new Error(`Failed to read PDF info: ${error instanceof Error ? error.message : String(error)}`);
    }
}
