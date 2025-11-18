// Browser application entry point
import { loadImageFromFile } from "../src/pdf/image_load.ts";
import { renderPdfPage } from "../src/pdf/pdf_render.ts";
import type { CanvasBackend } from "../src/pdf/pdf_render.ts";
import { whiteThresholdGPU } from "../src/gpu/white_threshold_gpu.ts";
import { palettizeGPU } from "../src/gpu/palettize_gpu.ts";
import { median3x3GPU } from "../src/gpu/median_gpu.ts";
import { extractBlack } from "../src/raster/threshold.ts";
import type { RGBAImage } from "../src/formats/rgba_image.ts";
import { DEFAULT_PALETTE_16 } from "../src/formats/palettized.ts";
import { saveFile, getFile, listFiles, deleteFile, clearAllFiles, updateFile } from "./storage.ts";

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

// Browser canvas backend for PDF rendering
const browserCanvasBackend: CanvasBackend = {
  createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

// Global state
let currentFileId: string | null = null;
let currentFile: File | null = null;
let currentPdfData: Uint8Array | null = null;
let currentImage: RGBAImage | null = null;
let pdfPageCount = 0;
let cropRegion: { x: number; y: number; width: number; height: number } | null = null;
let isSelectingCrop = false;
let cropStart: { x: number; y: number } | null = null;

// DOM elements
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const controlsEl = document.getElementById("controls") as HTMLDivElement;
const pageSelectGroup = document.getElementById("pageSelectGroup") as HTMLDivElement;
const pageSelect = document.getElementById("pageSelect") as HTMLSelectElement;
const renderPageBtn = document.getElementById("renderPageBtn") as HTMLButtonElement;
const cropGroup = document.getElementById("cropGroup") as HTMLDivElement;
const selectCropBtn = document.getElementById("selectCropBtn") as HTMLButtonElement;
const resetCropBtn = document.getElementById("resetCropBtn") as HTMLButtonElement;
const processBtn = document.getElementById("processBtn") as HTMLButtonElement;
const cropInfo = document.getElementById("cropInfo") as HTMLDivElement;
const previewCanvas = document.getElementById("previewCanvas") as HTMLCanvasElement;
const fileListEl = document.getElementById("fileList") as HTMLDivElement;
const uploadBtn = document.getElementById("uploadBtn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clearAllBtn") as HTMLButtonElement;

// Event listeners for file input
dropZone.addEventListener("click", () => fileInput.click());
uploadBtn.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFileLoad(files[0]);
  }
});

fileInput.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    handleFileLoad(files[0]);
  }
});

// Page selection
renderPageBtn.addEventListener("click", async () => {
  const pageNum = parseInt(pageSelect.value);
  await renderPdfPageToCanvas(pageNum);
});

// Crop controls
selectCropBtn.addEventListener("click", () => {
  isSelectingCrop = true;
  previewCanvas.style.cursor = "crosshair";
  cropInfo.textContent = "Click and drag to select crop area";
});

resetCropBtn.addEventListener("click", () => {
  cropRegion = null;
  isSelectingCrop = false;
  previewCanvas.style.cursor = "default";
  redrawPreview();
  cropInfo.textContent = "No crop selected - full image will be processed";
});

processBtn.addEventListener("click", () => {
  if (currentImage) {
    processImagePipeline(currentImage);
  }
});

// Canvas mouse events for cropping
previewCanvas.addEventListener("mousedown", (e) => {
  if (!isSelectingCrop) return;
  
  const rect = previewCanvas.getBoundingClientRect();
  const scaleX = previewCanvas.width / rect.width;
  const scaleY = previewCanvas.height / rect.height;
  
  cropStart = {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
});

previewCanvas.addEventListener("mousemove", (e) => {
  if (!isSelectingCrop || !cropStart) return;
  
  const rect = previewCanvas.getBoundingClientRect();
  const scaleX = previewCanvas.width / rect.width;
  const scaleY = previewCanvas.height / rect.height;
  
  const currentX = (e.clientX - rect.left) * scaleX;
  const currentY = (e.clientY - rect.top) * scaleY;
  
  const x = Math.min(cropStart.x, currentX);
  const y = Math.min(cropStart.y, currentY);
  const width = Math.abs(currentX - cropStart.x);
  const height = Math.abs(currentY - cropStart.y);
  
  cropRegion = { x, y, width, height };
  redrawPreview();
});

previewCanvas.addEventListener("mouseup", () => {
  if (isSelectingCrop && cropStart) {
    isSelectingCrop = false;
    cropStart = null;
    previewCanvas.style.cursor = "default";
    
    if (cropRegion) {
      cropInfo.textContent = `Crop: ${Math.round(cropRegion.width)}×${Math.round(cropRegion.height)} at (${Math.round(cropRegion.x)}, ${Math.round(cropRegion.y)})`;
    }
  }
});

async function handleFileLoad(file: File) {
  try {
    currentFile = file;
    showStatus(`Loading: ${file.name}...`);
    resultsEl.innerHTML = "";
    
    // Save to storage immediately if not already saved
    if (!currentFileId) {
      try {
        currentFileId = await saveFile(file);
        console.log(`File saved with ID: ${currentFileId}`);
        await refreshFileList();
      } catch (err) {
        console.error("Error saving file:", err);
      }
    }
    
    if (file.type === "application/pdf") {
      await handlePdfFile(file);
    } else {
      await handleImageFile(file);
    }
    
    // Update thumbnail after we have the image
    if (currentImage && currentFileId) {
      const thumbnail = generateThumbnail(currentImage);
      const stored = await getFile(currentFileId);
      if (stored && !stored.thumbnail) {
        await updateFile(currentFileId, { thumbnail });
        await refreshFileList();
      }
    }
  } catch (error) {
    const err = error as Error;
    showStatus(`Error: ${err.message}`, true);
    console.error(error);
  }
}

async function handlePdfFile(file: File) {
  // Load PDF and make a copy to avoid detachment
  const arrayBuffer = await file.arrayBuffer();
  const copy = new Uint8Array(arrayBuffer.byteLength);
  copy.set(new Uint8Array(arrayBuffer));
  currentPdfData = copy;
  
  // Use a copy for getDocument to avoid detaching currentPdfData
  const initialCopy = currentPdfData.slice();
  
  // @ts-ignore - pdfjsLib is loaded from CDN
  const loadingTask = pdfjsLib.getDocument({ data: initialCopy });
  const pdf = await loadingTask.promise;
  pdfPageCount = pdf.numPages;
  
  showStatus(`PDF loaded: ${pdfPageCount} pages`);
  
  // Populate page selector
  pageSelect.innerHTML = "";
  for (let i = 1; i <= pdfPageCount; i++) {
    const option = document.createElement("option");
    option.value = i.toString();
    option.textContent = `Page ${i}`;
    pageSelect.appendChild(option);
  }
  
  // Show controls
  controlsEl.classList.remove("hidden");
  pageSelectGroup.style.display = "block";
  cropGroup.style.display = "none";
  
  // Render first page
  await renderPdfPageToCanvas(1);
}

async function renderPdfPageToCanvas(pageNum: number) {
  if (!currentPdfData) return;
  
  showStatus(`Rendering page ${pageNum}...`);
  
  const start = performance.now();
  
  // Create a fresh copy for each render to avoid detachment issues
  // Use slice() to create a true copy of the underlying buffer
  const pdfDataCopy = currentPdfData.slice();
  
  // @ts-ignore - pdfjsLib is loaded from CDN
  const image = await renderPdfPage(
    { file: pdfDataCopy, pageNumber: pageNum, scale: 2.0 },
    browserCanvasBackend,
    pdfjsLib,
  );
  
  const loadTime = performance.now() - start;
  currentImage = image;
  
  showStatus(`Page ${pageNum} rendered: ${image.width}×${image.height} (${loadTime.toFixed(1)}ms)`);
  
  // Display preview
  previewCanvas.width = image.width;
  previewCanvas.height = image.height;
  const ctx = previewCanvas.getContext("2d");
  if (ctx) {
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    );
    ctx.putImageData(imageData, 0, 0);
  }
  
  previewCanvas.classList.remove("hidden");
  cropGroup.style.display = "block";
  cropRegion = null;
  cropInfo.textContent = "Click 'Select Crop Area' to choose a region, or 'Process Image' for full image";
}

async function handleImageFile(file: File) {
  const start = performance.now();
  const image = await loadImageFromFile(file);
  const loadTime = performance.now() - start;
  currentImage = image;
  
  showStatus(`Loaded: ${image.width}×${image.height} (${loadTime.toFixed(1)}ms)`);
  
  // Display preview
  previewCanvas.width = image.width;
  previewCanvas.height = image.height;
  const ctx = previewCanvas.getContext("2d");
  if (ctx) {
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    );
    ctx.putImageData(imageData, 0, 0);
  }
  
  previewCanvas.classList.remove("hidden");
  controlsEl.classList.remove("hidden");
  pageSelectGroup.style.display = "none";
  cropGroup.style.display = "block";
  cropRegion = null;
  cropInfo.textContent = "Click 'Select Crop Area' to choose a region, or 'Process Image' for full image";
}

function redrawPreview() {
  if (!currentImage) return;
  
  const ctx = previewCanvas.getContext("2d");
  if (!ctx) return;
  
  // Redraw image
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImage.data),
    currentImage.width,
    currentImage.height,
  );
  ctx.putImageData(imageData, 0, 0);
  
  // Draw crop region
  if (cropRegion) {
    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 2;
    ctx.strokeRect(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
  }
}

async function processImagePipeline(image: RGBAImage) {
  try {
    resultsEl.innerHTML = "";
    
    // Apply crop if selected
    let processImage = image;
    if (cropRegion && cropRegion.width > 0 && cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(image, cropRegion);
      displayImage(processImage, "Cropped");
    } else {
      displayImage(image, "Original");
    }
    
    // Run GPU pipeline
    showStatus("Initializing WebGPU...");
    statusEl.classList.remove("hidden");
    
    const t1 = performance.now();
    const thresholded = await whiteThresholdGPU(processImage, 0.85);
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

function cropImage(
  image: RGBAImage,
  region: { x: number; y: number; width: number; height: number },
): RGBAImage {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.min(image.width - x, Math.floor(region.width));
  const height = Math.min(image.height - y, Math.floor(region.height));
  
  const croppedData = new Uint8ClampedArray(width * height * 4);
  
  for (let row = 0; row < height; row++) {
    const srcOffset = ((y + row) * image.width + x) * 4;
    const dstOffset = row * width * 4;
    croppedData.set(
      image.data.subarray(srcOffset, srcOffset + width * 4),
      dstOffset,
    );
  }
  
  return {
    width,
    height,
    data: croppedData,
  };
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

// Declare global pdfjsLib from CDN script
// deno-lint-ignore no-explicit-any
declare const pdfjsLib: any;

function showStatus(message: string, isError: boolean = false) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  if (isError) {
    statusEl.classList.add("error");
  } else {
    statusEl.classList.remove("error");
  }
  console.log(message);
}

// File storage management
uploadBtn.addEventListener("click", () => fileInput.click());

clearAllBtn.addEventListener("click", async () => {
  if (confirm("Delete all saved files?")) {
    await clearAllFiles();
    await refreshFileList();
    showStatus("All files cleared");
  }
});

async function refreshFileList() {
  const files = await listFiles();
  
  console.log(`Refreshing file list: ${files.length} files`);
  
  if (files.length === 0) {
    fileListEl.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: #999;">
        No files yet<br>Upload a PDF or image
      </div>
    `;
    return;
  }
  
  fileListEl.innerHTML = "";
  
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-item";
    if (file.id === currentFileId) {
      item.classList.add("active");
    }
    
    const thumbnail = document.createElement("div");
    thumbnail.className = "file-thumbnail";
    if (file.thumbnail) {
      const img = document.createElement("img");
      img.src = file.thumbnail;
      thumbnail.appendChild(img);
    } else {
      thumbnail.textContent = file.type.includes("pdf") ? "📄" : "🖼️";
    }
    
    const info = document.createElement("div");
    info.className = "file-info";
    
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.name;
    
    const meta = document.createElement("div");
    meta.className = "file-meta";
    const date = new Date(file.uploadedAt);
    const size = (file.data.length / 1024).toFixed(0);
    meta.textContent = `${size} KB • ${date.toLocaleDateString()}`;
    
    info.appendChild(name);
    info.appendChild(meta);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "file-delete";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Delete file";
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`Delete ${file.name}?`)) {
        await deleteFile(file.id);
        if (file.id === currentFileId) {
          currentFileId = null;
          currentPdfData = null;
          currentImage = null;
        }
        await refreshFileList();
        showStatus(`Deleted ${file.name}`);
      }
    };
    
    item.appendChild(thumbnail);
    item.appendChild(info);
    item.appendChild(deleteBtn);
    
    item.onclick = () => loadStoredFile(file.id);
    
    fileListEl.appendChild(item);
  }
}

async function loadStoredFile(id: string) {
  const stored = await getFile(id);
  if (!stored) {
    showStatus("File not found", true);
    return;
  }
  
  currentFileId = id;
  // Create a new Uint8Array from stored data to avoid type issues
  const data = new Uint8Array(stored.data);
  const blob = new Blob([data], { type: stored.type });
  const file = new File([blob], stored.name, { type: stored.type });
  
  await refreshFileList();
  await handleFileLoad(file);
}

function generateThumbnail(image: RGBAImage): string {
  const maxSize = 48;
  const scale = Math.min(maxSize / image.width, maxSize / image.height);
  const thumbWidth = Math.floor(image.width * scale);
  const thumbHeight = Math.floor(image.height * scale);
  
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return "";
  
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
  tempCtx.putImageData(imageData, 0, 0);
  
  ctx.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);
  
  return canvas.toDataURL("image/jpeg", 0.7);
}

// Initialize file list on load
refreshFileList();
