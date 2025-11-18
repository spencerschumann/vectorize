// Browser application entry point
import { loadImageFromFile } from "../src/pdf/image_load.ts";
import { whiteThresholdGPU } from "../src/gpu/white_threshold_gpu.ts";
import { palettizeGPU } from "../src/gpu/palettize_gpu.ts";
import { median3x3GPU } from "../src/gpu/median_gpu.ts";
import { extractBlack } from "../src/raster/threshold.ts";
import type { RGBAImage } from "../src/formats/rgba_image.ts";
import { DEFAULT_PALETTE_16 } from "../src/formats/palettized.ts";

// Convert u32 palette to Uint8ClampedArray RGBA format
function paletteToRGBA(palette: Uint32Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(palette.length * 4);
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    rgba[i * 4] = (color >> 24) & 0xff;     // R
    rgba[i * 4 + 1] = (color >> 16) & 0xff; // G
    rgba[i * 4 + 2] = (color >> 8) & 0xff;  // B
    rgba[i * 4 + 3] = color & 0xff;         // A
  }
  return rgba;
}

const PALETTE_RGBA = paletteToRGBA(DEFAULT_PALETTE_16);

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

// Set up event listeners
dropZone?.addEventListener("click", () => fileInput?.click());

dropZone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    processImage(files[0]);
  }
});

fileInput?.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    processImage(files[0]);
  }
});

async function processImage(file: File) {
  try {
    showStatus(`Loading: ${file.name}...`);

    // Load image
    const start = performance.now();
    const image = await loadImageFromFile(file);
    const loadTime = performance.now() - start;
    showStatus(`Loaded: ${image.width}x${image.height} (${loadTime.toFixed(1)}ms)`);
    
    // Display original
    displayImage(image, "Original");
    
    // Run GPU pipeline
    showStatus("Initializing WebGPU...");
    
    const t1 = performance.now();
    const thresholded = await whiteThresholdGPU(image, 0.85);
    const t2 = performance.now();
    showStatus(`White threshold: ${(t2 - t1).toFixed(1)}ms`);
    displayImage(thresholded, "1. White Threshold");
    
    const t3 = performance.now();
    const palettized = await palettizeGPU(thresholded, PALETTE_RGBA);
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    
    const t5 = performance.now();
    const median = await median3x3GPU(palettized);
    const t6 = performance.now();
    showStatus(`Median filter: ${(t6 - t5).toFixed(1)}ms`);
    
    const t7 = performance.now();
    const _binary = extractBlack(median);
    const t8 = performance.now();
    showStatus(`Extract black: ${(t8 - t7).toFixed(1)}ms`);
    
    const totalTime = t8 - t1;
    showStatus(`✓ Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
    
  } catch (error) {
    const err = error as Error;
    showStatus(`Error: ${err.message}`, true);
    console.error(error);
  }
}

function displayImage(image: RGBAImage, label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.style.maxWidth = "100%";
  canvas.style.border = "1px solid #ccc";
  canvas.style.marginBottom = "1rem";
  
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height
    );
    ctx.putImageData(imageData, 0, 0);
  }
  
  const container = document.createElement("div");
  container.style.marginBottom = "2rem";
  
  const title = document.createElement("h3");
  title.textContent = label;
  title.style.marginBottom = "0.5rem";
  
  container.appendChild(title);
  container.appendChild(canvas);
  
  resultsEl?.appendChild(container);
}

function showStatus(message: string, isError: boolean = false) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#ef4444" : "#000";
  }
  console.log(message);
}
