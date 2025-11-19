// Browser application entry point - New UI
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
    rgba[i * 4] = (color >> 24) & 0xff;
    rgba[i * 4 + 1] = (color >> 16) & 0xff;
    rgba[i * 4 + 2] = (color >> 8) & 0xff;
    rgba[i * 4 + 3] = color & 0xff;
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

// Declare global pdfjsLib from CDN script
// deno-lint-ignore no-explicit-any
declare const pdfjsLib: any;

// UI State
type AppMode = "upload" | "pageSelection" | "crop";
let currentMode: AppMode = "upload";
let currentFileId: string | null = null;
let currentFile: File | null = null;
let currentPdfData: Uint8Array | null = null;
let currentImage: RGBAImage | null = null;
let pdfPageCount = 0;

// Canvas/Viewport State
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let isCropping = false;
let cropStart: { x: number; y: number } | null = null;
let cropRegion: { x: number; y: number; width: number; height: number } | null = null;
let lastPanX = 0;
let lastPanY = 0;

// DOM Elements
const sidebar = document.getElementById("sidebar") as HTMLDivElement;
const sidebarToggle = document.getElementById("sidebarToggle") as HTMLButtonElement;
const fileListEl = document.getElementById("fileList") as HTMLDivElement;
const uploadBtn = document.getElementById("uploadBtn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clearAllBtn") as HTMLButtonElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

const uploadScreen = document.getElementById("uploadScreen") as HTMLDivElement;
const uploadBox = document.getElementById("uploadBox") as HTMLDivElement;

const pageSelectionScreen = document.getElementById("pageSelectionScreen") as HTMLDivElement;
const pdfFileName = document.getElementById("pdfFileName") as HTMLHeadingElement;
const pageGrid = document.getElementById("pageGrid") as HTMLDivElement;
const backToFilesBtn = document.getElementById("backToFilesBtn") as HTMLButtonElement;

const cropScreen = document.getElementById("cropScreen") as HTMLDivElement;
const canvasContainer = document.getElementById("canvasContainer") as HTMLDivElement;
const mainCanvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
const ctx = mainCanvas.getContext("2d")!;

const zoomInBtn = document.getElementById("zoomInBtn") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoomOutBtn") as HTMLButtonElement;
const zoomLevel = document.getElementById("zoomLevel") as HTMLDivElement;
const fitToScreenBtn = document.getElementById("fitToScreenBtn") as HTMLButtonElement;
const startCropBtn = document.getElementById("startCropBtn") as HTMLButtonElement;
const clearCropBtn = document.getElementById("clearCropBtn") as HTMLButtonElement;
const cropInfo = document.getElementById("cropInfo") as HTMLDivElement;
const processBtn = document.getElementById("processBtn") as HTMLButtonElement;
const backFromCropBtn = document.getElementById("backFromCropBtn") as HTMLButtonElement;
const statusText = document.getElementById("statusText") as HTMLDivElement;
const resultsPanel = document.getElementById("resultsPanel") as HTMLDivElement;
const resultsContainer = document.getElementById("resultsContainer") as HTMLDivElement;

// Initialize
refreshFileList();
setMode("upload");

// Sidebar toggle
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

// File management
uploadBtn.addEventListener("click", () => fileInput.click());
uploadBox.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});

uploadBox.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadBox.classList.add("drag-over");
});

uploadBox.addEventListener("dragleave", () => {
  uploadBox.classList.remove("drag-over");
});

uploadBox.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadBox.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});

clearAllBtn.addEventListener("click", async () => {
  if (confirm("Delete all saved files?")) {
    await clearAllFiles();
    await refreshFileList();
    showStatus("All files cleared");
  }
});

backToFilesBtn.addEventListener("click", () => {
  setMode("upload");
});

backFromCropBtn.addEventListener("click", () => {
  if (currentFile?.type === "application/pdf") {
    setMode("pageSelection");
  } else {
    setMode("upload");
  }
});

// Zoom controls
zoomInBtn.addEventListener("click", () => {
  zoom *= 1.2;
  updateZoom();
  redrawCanvas();
});

zoomOutBtn.addEventListener("click", () => {
  zoom /= 1.2;
  updateZoom();
  redrawCanvas();
});

fitToScreenBtn.addEventListener("click", () => {
  fitToScreen();
});

// Crop controls
startCropBtn.addEventListener("click", () => {
  isCropping = true;
  canvasContainer.classList.add("cropping");
  startCropBtn.classList.add("active");
  cropInfo.textContent = "Click and drag to select crop area";
});

clearCropBtn.addEventListener("click", () => {
  cropRegion = null;
  isCropping = false;
  canvasContainer.classList.remove("cropping");
  startCropBtn.classList.remove("active");
  cropInfo.textContent = "No crop selected";
  redrawCanvas();
});

processBtn.addEventListener("click", () => {
  if (currentImage) {
    processImage(currentImage);
  }
});

// Canvas interaction
canvasContainer.addEventListener("mousedown", (e) => {
  if (isCropping) {
    const rect = canvasContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoom;
    const y = (e.clientY - rect.top - panY) / zoom;
    cropStart = { x, y };
  } else {
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    canvasContainer.classList.add("grabbing");
  }
});

canvasContainer.addEventListener("mousemove", (e) => {
  if (isCropping && cropStart) {
    const rect = canvasContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoom;
    const y = (e.clientY - rect.top - panY) / zoom;
    
    const minX = Math.min(cropStart.x, x);
    const minY = Math.min(cropStart.y, y);
    const maxX = Math.max(cropStart.x, x);
    const maxY = Math.max(cropStart.y, y);
    
    cropRegion = {
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      width: Math.min(currentImage!.width - minX, maxX - minX),
      height: Math.min(currentImage!.height - minY, maxY - minY),
    };
    
    redrawCanvas();
  } else if (isPanning) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    panX += dx;
    panY += dy;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    redrawCanvas();
  }
});

canvasContainer.addEventListener("mouseup", () => {
  if (isCropping && cropStart) {
    isCropping = false;
    cropStart = null;
    canvasContainer.classList.remove("cropping");
    startCropBtn.classList.remove("active");
    
    if (cropRegion && cropRegion.width > 0 && cropRegion.height > 0) {
      cropInfo.textContent = `Crop: ${Math.round(cropRegion.width)}×${Math.round(cropRegion.height)} at (${Math.round(cropRegion.x)}, ${Math.round(cropRegion.y)})`;
    }
  }
  
  if (isPanning) {
    isPanning = false;
    canvasContainer.classList.remove("grabbing");
  }
});

canvasContainer.addEventListener("mouseleave", () => {
  isPanning = false;
  canvasContainer.classList.remove("grabbing");
});

canvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  zoom *= delta;
  updateZoom();
  redrawCanvas();
});

// Mode management
function setMode(mode: AppMode) {
  console.log("setMode called:", mode);
  currentMode = mode;
  
  uploadScreen.classList.remove("active");
  pageSelectionScreen.classList.remove("active");
  cropScreen.classList.remove("active");
  
  switch (mode) {
    case "upload":
      uploadScreen.classList.add("active");
      console.log("Upload screen activated");
      break;
    case "pageSelection":
      pageSelectionScreen.classList.add("active");
      // Force display as a test
      pageSelectionScreen.style.display = "flex";
      console.log("Page selection screen activated, pageGrid children:", pageGrid.children.length);
      console.log("pageSelectionScreen display:", globalThis.getComputedStyle(pageSelectionScreen).display);
      console.log("pageSelectionScreen visibility:", globalThis.getComputedStyle(pageSelectionScreen).visibility);
      break;
    case "crop":
      cropScreen.classList.add("active");
      console.log("Crop screen activated");
      break;
  }
}

function showStatus(message: string, isError = false) {
  statusText.textContent = message;
  if (isError) {
    statusText.classList.add("status-error");
  } else {
    statusText.classList.remove("status-error");
  }
  console.log(message);
}

async function handleFileUpload(file: File) {
  try {
    currentFile = file;
    showStatus(`Loading: ${file.name}...`);
    
    // Save to storage if not already saved
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
      console.log("handleFileUpload: Detected PDF, calling loadPdf");
      await loadPdf(file);
      console.log("handleFileUpload: loadPdf complete, switching to pageSelection mode");
      setMode("pageSelection");
    } else {
      console.log("handleFileUpload: Detected image, loading directly");
      const image = await loadImageFromFile(file);
      await loadImage(image);
      setMode("crop");
    }
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
    console.error(error);
  }
}

async function loadPdf(file: File) {
  try {
    console.log("loadPdf: Starting to load", file.name);
    const arrayBuffer = await file.arrayBuffer();
    console.log("loadPdf: Got arrayBuffer, length:", arrayBuffer.byteLength);
    const copy = new Uint8Array(arrayBuffer.byteLength);
    copy.set(new Uint8Array(arrayBuffer));
    currentPdfData = copy;
    console.log("loadPdf: Created copy", copy.length);
    
    const initialCopy = currentPdfData.slice();
    console.log("loadPdf: Calling getDocument");
    const loadingTask = pdfjsLib.getDocument({ data: initialCopy });
    const pdf = await loadingTask.promise;
    pdfPageCount = pdf.numPages;
    console.log("loadPdf: PDF loaded, pages:", pdfPageCount);
    
    showStatus(`PDF loaded: ${pdfPageCount} pages`);
    console.log("loadPdf: About to set pdfFileName, element:", pdfFileName);
    try {
      pdfFileName.textContent = file.name;
      console.log("loadPdf: pdfFileName set successfully");
    } catch (e) {
      console.error("loadPdf: Error setting pdfFileName:", e);
    }
    console.log("loadPdf: pdfFileName set, about to generate thumbnails");
    
    // Generate page thumbnails
    console.log("loadPdf: Generating page thumbnails, clearing pageGrid");
    console.log("loadPdf: pageGrid element:", pageGrid);
    pageGrid.innerHTML = "";
    console.log("loadPdf: pageGrid cleared, adding", pdfPageCount, "cards");
    for (let i = 1; i <= pdfPageCount; i++) {
      const card = document.createElement("div");
      card.className = "page-card";
      
      const imageDiv = document.createElement("div");
      imageDiv.className = "page-card-image";
      imageDiv.textContent = "📄";
      
      const label = document.createElement("div");
      label.className = "page-card-label";
      label.textContent = `Page ${i}`;
      
      card.appendChild(imageDiv);
      card.appendChild(label);
      card.addEventListener("click", () => {
        // Add loading state immediately
        card.style.opacity = "0.5";
        card.style.pointerEvents = "none";
        selectPdfPage(i);
      });
      
      pageGrid.appendChild(card);
      
      // Generate thumbnail asynchronously
      generatePageThumbnail(i, imageDiv);
    }
  } catch (error) {
    console.error("loadPdf error:", error);
    showStatus(`PDF load error: ${(error as Error).message}`, true);
    throw error;
  }
}

async function generatePageThumbnail(pageNum: number, container: HTMLElement) {
  try {
    if (!currentPdfData) return;
    
    const pdfDataCopy = currentPdfData.slice();
    const image = await renderPdfPage(
      { file: pdfDataCopy, pageNumber: pageNum, scale: 0.8 },
      browserCanvasBackend,
      pdfjsLib,
    );
    
    // Set the container's aspect ratio based on actual page dimensions
    const aspectRatio = image.width / image.height;
    container.style.aspectRatio = aspectRatio.toString();
    container.style.width = (250 * aspectRatio) + "px";
    
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const imageData = new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
      );
      ctx.putImageData(imageData, 0, 0);
      
      const img = document.createElement("img");
      img.src = canvas.toDataURL();
      container.innerHTML = "";
      container.appendChild(img);
    }
  } catch (err) {
    console.error(`Error generating thumbnail for page ${pageNum}:`, err);
  }
}

async function selectPdfPage(pageNum: number) {
  try {
    console.log("selectPdfPage: Starting, page:", pageNum);
    if (!currentPdfData) {
      console.error("selectPdfPage: No PDF data!");
      showStatus("No PDF loaded", true);
      return;
    }
    
    // Switch to crop screen immediately with loading state
    setMode("crop");
    showStatus(`⏳ Rendering page ${pageNum} at 200 DPI...`);
    canvasContainer.style.opacity = "0.5";
    
    console.log("selectPdfPage: Creating copy");
    const pdfDataCopy = currentPdfData.slice();
    console.log("selectPdfPage: Calling renderPdfPage");
    // Scale 2.78 ≈ 200 DPI (72 * 2.78 ≈ 200)
    const image = await renderPdfPage(
      { file: pdfDataCopy, pageNumber: pageNum, scale: 2.78 },
      browserCanvasBackend,
      pdfjsLib,
    );
    console.log("selectPdfPage: Got image", image.width, "x", image.height);
    
    canvasContainer.style.opacity = "1";
    await loadImage(image);
    showStatus(`✓ Page ${pageNum} loaded: ${image.width}×${image.height}`);
    
    // Update thumbnail in storage
    if (currentFileId && currentImage) {
      const thumbnail = generateThumbnail(currentImage);
      await updateFile(currentFileId, { thumbnail });
      await refreshFileList();
    }
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
    console.error(error);
  }
}

function loadImage(image: RGBAImage) {
  currentImage = image;
  
  // Set up canvas
  mainCanvas.width = image.width;
  mainCanvas.height = image.height;
  
  // Make sure canvas is visible
  mainCanvas.style.display = "block";
  canvasContainer.style.opacity = "1";
  
  // Reset view
  cropRegion = null;
  cropInfo.textContent = "No crop selected";
  
  // Draw the image first
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
  ctx.putImageData(imageData, 0, 0);
  
  // Then fit to screen
  fitToScreen();
  
  showStatus(`✓ Ready: ${image.width}×${image.height} pixels`);
}

function fitToScreen() {
  if (!currentImage) return;
  
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;
  const imageWidth = currentImage.width;
  const imageHeight = currentImage.height;
  
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  zoom = Math.min(scaleX, scaleY) * 0.9; // 90% to add padding
  
  panX = (containerWidth - imageWidth * zoom) / 2;
  panY = (containerHeight - imageHeight * zoom) / 2;
  
  updateZoom();
  redrawCanvas();
}

function updateZoom() {
  zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
}

function redrawCanvas() {
  if (!currentImage) return;
  
  // Clear
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  
  // Draw image
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImage.data),
    currentImage.width,
    currentImage.height,
  );
  ctx.putImageData(imageData, 0, 0);
  
  // Draw crop region
  if (cropRegion) {
    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 3 / zoom; // Scale line width inversely to zoom
    ctx.strokeRect(
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
    
    // Draw handles
    const handleSize = 10 / zoom;
    ctx.fillStyle = "#4f46e5";
    const corners = [
      [cropRegion.x, cropRegion.y],
      [cropRegion.x + cropRegion.width, cropRegion.y],
      [cropRegion.x, cropRegion.y + cropRegion.height],
      [cropRegion.x + cropRegion.width, cropRegion.y + cropRegion.height],
    ];
    for (const [x, y] of corners) {
      ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
    }
  }
  
  // Apply transform for viewport
  mainCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  mainCanvas.style.transformOrigin = "0 0";
}

async function processImage(image: RGBAImage) {
  try {
    resultsContainer.innerHTML = "";
    resultsPanel.classList.add("active");
    
    // Apply crop if selected
    let processImage = image;
    if (cropRegion && cropRegion.width > 0 && cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(image, cropRegion);
      displayResult(processImage, "Cropped");
    } else {
      displayResult(image, "Original");
    }
    
    // Run GPU pipeline
    showStatus("Running white threshold...");
    const t1 = performance.now();
    const thresholded = await whiteThresholdGPU(processImage, 0.85);
    const t2 = performance.now();
    showStatus(`White threshold: ${(t2 - t1).toFixed(1)}ms`);
    displayResult(thresholded, "1. White Threshold");
    
    showStatus("Palettizing...");
    const t3 = performance.now();
    const palettized = await palettizeGPU(thresholded, PALETTE_RGBA);
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    
    showStatus("Applying median filter...");
    const t5 = performance.now();
    const median = await median3x3GPU(palettized);
    const t6 = performance.now();
    showStatus(`Median filter: ${(t6 - t5).toFixed(1)}ms`);
    
    showStatus("Extracting black...");
    const t7 = performance.now();
    const _binary = extractBlack(median);
    const t8 = performance.now();
    showStatus(`Extract black: ${(t8 - t7).toFixed(1)}ms`);
    
    const totalTime = t8 - t1;
    showStatus(`✓ Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
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
  
  return { width, height, data: croppedData };
}

function displayResult(image: RGBAImage, label: string) {
  const item = document.createElement("div");
  item.className = "result-item";
  
  const title = document.createElement("h3");
  title.textContent = label;
  
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    );
    ctx.putImageData(imageData, 0, 0);
  }
  
  const img = document.createElement("img");
  img.src = canvas.toDataURL();
  
  item.appendChild(title);
  item.appendChild(img);
  resultsContainer.appendChild(item);
}

function generateThumbnail(image: RGBAImage): string {
  const maxSize = 128; // Increased for better quality
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
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);
  
  return canvas.toDataURL("image/png");
}

// File list management
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
          setMode("upload");
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
  showStatus("⏳ Loading file...");
  
  const stored = await getFile(id);
  if (!stored) {
    showStatus("File not found", true);
    return;
  }
  
  currentFileId = id;
  const data = new Uint8Array(stored.data);
  const blob = new Blob([data], { type: stored.type });
  const file = new File([blob], stored.name, { type: stored.type });
  
  await refreshFileList();
  await handleFileUpload(file);
}
