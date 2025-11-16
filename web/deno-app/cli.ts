#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * CleanPlans Vectorizer - Deno CLI
 * 
 * Command-line interface for batch processing and testing
 * Demonstrates using the same TypeScript modules as the browser
 */

import { parseArgs } from "@std/cli/parse-args";

import { renderPdfPageDeno, getPdfInfo } from "../src/pdf/pdf_render_deno.ts";
import { cropRGBA, type CropRect } from "../src/raster/crop.ts";
import { toGrayscale } from "../src/raster/grayscale.ts";
import { median3x3 } from "../src/raster/median.ts";
import { palettize16, DEFAULT_PALETTE_16 } from "../src/raster/palette.ts";
import { extractBlack } from "../src/raster/threshold.ts";

async function main() {
    const args = parseArgs(Deno.args, {
        string: ["input", "output", "page"],
        boolean: ["help", "full-pipeline"],
        default: {
            page: "1",
            "full-pipeline": false,
        },
    });

    if (args.help || !args.input) {
        console.log(`
CleanPlans Vectorizer - Deno CLI

Usage:
  deno task cli --input <pdf-file> [options]

Options:
  --input <file>       Input PDF file (required)
  --output <prefix>    Output file prefix (default: output)
  --page <n>           Page number to process (default: 1)
  --full-pipeline      Run full pipeline (crop, grayscale, median, etc.)
  --help               Show this help

Examples:
  # Extract first page as RGBA
  deno task cli --input plan.pdf

  # Process page 2 with full pipeline
  deno task cli --input plan.pdf --page 2 --full-pipeline
`);
        Deno.exit(args.help ? 0 : 1);
    }

    try {
        console.log(`Reading PDF: ${args.input}`);

        const pageNumber = parseInt(args.page);

        console.log(`Rendering page ${pageNumber} with ImageMagick...`);

        const rgba = await renderPdfPageDeno(args.input, {
            pageNumber,
            dpi: 200.02,
        });

        console.log(`Rendered: ${rgba.width}x${rgba.height} pixels`);

        // Save PNG image
        const outputFile = args.output || "output.png";
        await savePNG(rgba, outputFile);
        console.log(`Saved image to ${outputFile}`);

        if (args["full-pipeline"]) {
            console.log("\nRunning full pipeline...");

            // For demo, crop to center 80%
            const cropRect: CropRect = {
                x: Math.floor(rgba.width * 0.1),
                y: Math.floor(rgba.height * 0.1),
                width: Math.floor(rgba.width * 0.8),
                height: Math.floor(rgba.height * 0.8),
            };

            console.log("1. Cropping...");
            const cropped = cropRGBA(rgba, cropRect);
            console.log(`   Cropped to ${cropped.width}x${cropped.height}`);

            console.log("2. Converting to grayscale...");
            const gray = toGrayscale(cropped);

            console.log("3. Applying 3x3 median filter...");
            const filtered = median3x3(gray);

            console.log("4. Palettizing to 16 colors...");
            const pal = palettize16(filtered, DEFAULT_PALETTE_16);

            console.log("5. Extracting black channel...");
            const black = extractBlack(pal, {
                whiteThreshold: 0.10,
                blackThreshold: 0.05,
            });

            console.log(`   Binary image: ${black.width}x${black.height}`);

            // Save pipeline outputs
            const baseOutput = outputFile.replace(/\.png$/, "");
            await savePalettizedDebug(pal, `${baseOutput}_palette.txt`);
            await saveBinaryDebug(black, `${baseOutput}_binary.txt`);

            console.log(`\nPipeline complete!`);
            console.log(`Outputs:`);
            console.log(`  - ${outputFile}`);
            console.log(`  - ${baseOutput}_palette.txt`);
            console.log(`  - ${baseOutput}_binary.txt`);
        }
    } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        Deno.exit(1);
    }
}

/**
 * Save RGBA image as PNG using ImageMagick
 */
async function savePNG(img: any, filename: string) {
    const { width, height, data } = img;

    // Write RGBA data to temp file
    const tempRgba = await Deno.makeTempFile({ suffix: ".rgba" });
    try {
        // Convert Uint8ClampedArray to Uint8Array for Deno.writeFile
        await Deno.writeFile(tempRgba, new Uint8Array(data));

        // Convert to PNG using ImageMagick
        const cmd = new Deno.Command("magick", {
            args: [
                "-size", `${width}x${height}`,
                "-depth", "8",
                "RGBA:" + tempRgba,
                filename,
            ],
            stdout: "piped",
            stderr: "piped",
        });

        const { code, stderr } = await cmd.output();
        if (code !== 0) {
            const errorText = new TextDecoder().decode(stderr);
            throw new Error(`Failed to save PNG: ${errorText}`);
        }
    } finally {
        try {
            await Deno.remove(tempRgba);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Save palettized image info to text file
 */
async function savePalettizedDebug(img: any, filename: string) {
    const info = `Palettized Image (4bpp)
Width: ${img.width}
Height: ${img.height}
Data size: ${img.data.length} bytes (${img.width * img.height} pixels)
Palette: ${img.palette ? img.palette.length : 0} colors
`;
    await Deno.writeTextFile(filename, info);
}

/**
 * Save binary image info to text file
 */
async function saveBinaryDebug(img: any, filename: string) {
    const info = `Binary Image (1bpp)
Width: ${img.width}
Height: ${img.height}
Data size: ${img.data.length} bytes (${img.width * img.height} pixels)
`;
    await Deno.writeTextFile(filename, info);
}

if (import.meta.main) {
    main();
}
