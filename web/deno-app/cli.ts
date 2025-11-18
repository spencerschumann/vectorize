#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * CleanPlans Vectorizer - Deno CLI
 * 
 * Command-line interface for batch processing and testing
 * Demonstrates using the same TypeScript modules as the browser
 */

import { parseArgs } from "@std/cli/parse-args";
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";

import { renderPdfPageDeno } from "../src/pdf/pdf_render_deno.ts";
import type { RGBAImage } from "../src/formats/rgba_image.ts";
import { cropRGBA, type CropRect } from "../src/raster/crop.ts";
import { DEFAULT_PALETTE_16_RGBA } from "../src/raster/palette.ts";
import { extractBlack } from "../src/raster/threshold.ts";
import { whiteThresholdGPU } from "../src/gpu/white_threshold_gpu.ts";
import { palettizeGPU } from "../src/gpu/palettize_gpu.ts";
import { median3x3GPU } from "../src/gpu/median_gpu.ts";
import { getGPUContext } from "../src/gpu/gpu_context.ts";
import { palettizedToRGBA } from "../src/formats/palettized.ts";

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
  deno task cli --input <file> [options]

Options:
  --input <file>       Input PDF or PNG file (required)
  --output <prefix>    Output file prefix (default: output)
  --page <n>           Page number to process for PDFs (default: 1)
  --full-pipeline      Run full pipeline (crop, grayscale, median, etc.)
  --help               Show this help

Examples:
  # Extract first page from PDF as PNG
  deno task cli --input plan.pdf

  # Load PNG directly
  deno task cli --input page.png --full-pipeline

  # Process page 2 from PDF with full pipeline
  deno task cli --input plan.pdf --page 2 --full-pipeline
`);
        Deno.exit(args.help ? 0 : 1);
    }

    try {
        let rgba: RGBAImage;
        let loadTime = 0;
        
        // Check if input is PNG or PDF
        const isPng = args.input.toLowerCase().endsWith('.png');
        
        if (isPng) {
            console.log(`Loading PNG: ${args.input}`);
            const start = performance.now();
            rgba = await loadPNG(args.input);
            loadTime = performance.now() - start;
            console.log(`Loaded: ${rgba.width}x${rgba.height} pixels (${loadTime.toFixed(1)}ms)`);
        } else {
            console.log(`Reading PDF: ${args.input}`);
            const pageNumber = parseInt(args.page);
            console.log(`Rendering page ${pageNumber} with ImageMagick...`);
            const start = performance.now();
            rgba = await renderPdfPageDeno(args.input, {
                pageNumber,
                dpi: 200.02,
            });
            loadTime = performance.now() - start;
            console.log(`Rendered: ${rgba.width}x${rgba.height} pixels (${loadTime.toFixed(1)}ms)`);
        }

        // Save PNG image if output is specified and input was PDF
        if (args.output && !isPng) {
            const outputFile = args.output;
            const start = performance.now();
            await savePNG(rgba, outputFile);
            const saveTime = performance.now() - start;
            console.log(`Saved image to ${outputFile} (${saveTime.toFixed(1)}ms)`);
        }

        if (args["full-pipeline"]) {
            console.log("\nInitializing WebGPU...");
            let start = performance.now();
            await getGPUContext();
            let stepTime = performance.now() - start;
            console.log(`GPU initialized (${stepTime.toFixed(1)}ms)\n`);
            
            console.log("Running GPU-accelerated pipeline...");

            let processedImage = rgba;
            const baseOutput = args.output ? args.output.replace(/\.png$/, "") : "output";

            // Only crop for PDF inputs (PNGs are assumed pre-cropped)
            if (!isPng) {
                // For PDF, crop to center 80%
                const cropRect: CropRect = {
                    x: Math.floor(rgba.width * 0.1),
                    y: Math.floor(rgba.height * 0.1),
                    width: Math.floor(rgba.width * 0.8),
                    height: Math.floor(rgba.height * 0.8),
                };

                console.log("1. Cropping...");
                start = performance.now();
                processedImage = cropRGBA(rgba, cropRect);
                stepTime = performance.now() - start;
                console.log(`   Cropped to ${processedImage.width}x${processedImage.height} (${stepTime.toFixed(1)}ms)`);
            } else {
                console.log("1. Skipping crop (PNG assumed pre-cropped)");
            }

            console.log("2. White threshold (GPU, 85%)...");
            
            // Debug: histogram of INPUT
            console.log(`   Debug - INPUT histogram (top 16)...`);
            const inputHistogram = new Map<string, number>();
            for (let i = 0; i < processedImage.data.length; i += 4) {
                const r = processedImage.data[i];
                const g = processedImage.data[i + 1];
                const b = processedImage.data[i + 2];
                const a = processedImage.data[i + 3];
                const key = `${r},${g},${b},${a}`;
                inputHistogram.set(key, (inputHistogram.get(key) || 0) + 1);
            }
            const inputSorted = Array.from(inputHistogram.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 16);
            for (const [color, count] of inputSorted) {
                const [r, g, b, a] = color.split(',');
                console.log(`     R=${r} G=${g} B=${b} A=${a}: ${count} pixels`);
            }
            
            start = performance.now();
            const thresholded = await whiteThresholdGPU(processedImage, 0.85);
            stepTime = performance.now() - start;
            console.log(`   Done (${stepTime.toFixed(1)}ms)`);
            
            // Debug: build histogram of pixel values
            console.log(`   Debug - OUTPUT histogram (top 16)...`);
            const histogram = new Map<string, number>();
            for (let i = 0; i < thresholded.data.length; i += 4) {
                const r = thresholded.data[i];
                const g = thresholded.data[i + 1];
                const b = thresholded.data[i + 2];
                const a = thresholded.data[i + 3];
                const key = `${r},${g},${b},${a}`;
                histogram.set(key, (histogram.get(key) || 0) + 1);
            }
            
            // Sort by count and show top 16
            const sorted = Array.from(histogram.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 16);
            console.log(`   Top 16 most common pixel values:`);
            for (const [color, count] of sorted) {
                const [r, g, b, a] = color.split(',');
                console.log(`     R=${r} G=${g} B=${b} A=${a}: ${count} pixels`);
            }
            
            // Save white thresholded image
            start = performance.now();
            await savePNG(thresholded, `${baseOutput}_1_threshold.png`);
            stepTime = performance.now() - start;
            console.log(`   Saved ${baseOutput}_1_threshold.png (${stepTime.toFixed(1)}ms)`);

            console.log("3. Palettizing to 16 colors (GPU)...");
            start = performance.now();
            const pal = await palettizeGPU(thresholded, DEFAULT_PALETTE_16_RGBA);
            stepTime = performance.now() - start;
            console.log(`   Done (${stepTime.toFixed(1)}ms)`);
            
            // Save palettized image (convert back to RGBA for PNG)
            start = performance.now();
            const palRGBA = palettizedToRGBA(pal);
            await savePNG(palRGBA, `${baseOutput}_2_palette.png`);
            stepTime = performance.now() - start;
            console.log(`   Saved ${baseOutput}_2_palette.png (${stepTime.toFixed(1)}ms)`);

            console.log("4. Applying 3x3 median filter (GPU)...");
            start = performance.now();
            const filtered = await median3x3GPU(pal);
            stepTime = performance.now() - start;
            console.log(`   Done (${stepTime.toFixed(1)}ms)`);
            
            // Save filtered image
            start = performance.now();
            const filteredRGBA = palettizedToRGBA(filtered);
            await savePNG(filteredRGBA, `${baseOutput}_3_median.png`);
            stepTime = performance.now() - start;
            console.log(`   Saved ${baseOutput}_3_median.png (${stepTime.toFixed(1)}ms)`);

            console.log("5. Extracting black channel...");
            start = performance.now();
            const black = extractBlack(filtered, {
                whiteThreshold: 0.10,
                blackThreshold: 0.05,
            });
            stepTime = performance.now() - start;
            console.log(`   Binary image: ${black.width}x${black.height} (${stepTime.toFixed(1)}ms)`);
            
            // Convert binary to RGBA for PNG export
            start = performance.now();
            const blackRGBA = binaryToRGBA(black);
            await savePNG(blackRGBA, `${baseOutput}_4_binary.png`);
            stepTime = performance.now() - start;
            console.log(`   Saved ${baseOutput}_4_binary.png (${stepTime.toFixed(1)}ms)`);

            console.log(`\nPipeline complete!`);
            console.log(`Outputs:`);
            if (args.output && !isPng) {
                console.log(`  - ${args.output} (original render)`);
            }
            console.log(`  - ${baseOutput}_1_threshold.png`);
            console.log(`  - ${baseOutput}_2_palette.png`);
            console.log(`  - ${baseOutput}_3_median.png`);
            console.log(`  - ${baseOutput}_4_binary.png`);
        }
    } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        Deno.exit(1);
    }
}

/**
 * Load PNG image as RGBA using pngjs (pure JavaScript, fast)
 */
async function loadPNG(filename: string): Promise<RGBAImage> {
    const fileData = await Deno.readFile(filename);
    const png = PNG.sync.read(Buffer.from(fileData));
    
    return {
        width: png.width,
        height: png.height,
        data: new Uint8ClampedArray(png.data),
    };
}

/**
 * Convert binary image to RGBA for visualization
 */
function binaryToRGBA(binary: { width: number; height: number; data: Uint8Array }): RGBAImage {
    const rgbaData = new Uint8ClampedArray(binary.width * binary.height * 4);
    
    for (let i = 0; i < binary.width * binary.height; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        const bit = (binary.data[byteIdx] >> bitIdx) & 1;
        
        // 1 = black, 0 = white
        const value = bit ? 0 : 255;
        rgbaData[i * 4] = value;
        rgbaData[i * 4 + 1] = value;
        rgbaData[i * 4 + 2] = value;
        rgbaData[i * 4 + 3] = 255;
    }
    
    return {
        width: binary.width,
        height: binary.height,
        data: rgbaData,
    };
}

/**
 * Save RGBA image as PNG using pngjs (pure JavaScript, fast)
 */
async function savePNG(img: RGBAImage, filename: string) {
    const { width, height, data } = img;
    
    const png = new PNG({ width, height });
    png.data = Buffer.from(data);
    
    const buffer = PNG.sync.write(png);
    await Deno.writeFile(filename, buffer);
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
