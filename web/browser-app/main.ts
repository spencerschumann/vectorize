// Browser application entry point - New UI
import { loadImageFromFile } from "../src/pdf/image_load.ts";
import { renderPdfPage } from "../src/pdf/pdf_render.ts";
import type { CanvasBackend } from "../src/pdf/pdf_render.ts";
import { cleanupGPU, recombineWithValue, type CleanupResults } from "../src/gpu/cleanup_gpu.ts";
import { processValueChannel, type ValueProcessResults } from "../src/gpu/value_process_gpu.ts";
import { palettizeGPU } from "../src/gpu/palettize_gpu.ts";
import { median3x3GPU } from "../src/gpu/median_gpu.ts";
import { extractBlack } from "../src/raster/threshold.ts";
import type { RGBAImage } from "../src/formats/rgba_image.ts";
import type { PalettizedImage } from "../src/formats/palettized.ts";
import type { BinaryImage } from "../src/formats/binary.ts";
import { DEFAULT_PALETTE } from "../src/formats/palettized.ts";
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
type AppMode = "upload" | "pageSelection" | "crop" | "processing";
let currentMode: AppMode = "upload";
let currentFileId: string | null = null;
let currentFile: File | null = null;
let currentPdfData: Uint8Array | null = null;
let currentImage: RGBAImage | null = null;
let currentSelectedPage: number | null = null;
let pdfPageCount = 0;
let cancelThumbnailLoading = false;

// Processing state
type ProcessingStage = 
  | "cropped" 
  | "value" 
  | "saturation" 
  | "saturation_median" 
  | "hue" 
  | "hue_median" 
  | "cleanup" 
  | "value_median"
  | "value_skeleton"
  | "palettized" 
  | "median" 
  | "binary";
let currentStage: ProcessingStage = "cropped";
const processedImages: Map<ProcessingStage, RGBAImage | PalettizedImage | BinaryImage> = new Map();

// Palette configuration
interface PaletteColor {
  inputColor: string;   // Hex color for matching
  outputColor: string;  // Hex color for display
  mapToBg: boolean;     // Map this color to background
}

// Convert u32 color to hex
function u32ToHex(color: number): string {
  const r = (color >> 24) & 0xff;
  const g = (color >> 16) & 0xff;
  const b = (color >> 8) & 0xff;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Convert hex to RGBA values
function hexToRGBA(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

// Initialize palette from DEFAULT_PALETTE
const userPalette: PaletteColor[] = Array.from(DEFAULT_PALETTE).map(color => ({
  inputColor: u32ToHex(color),
  outputColor: u32ToHex(color),
  mapToBg: false,
}));

// Canvas/Viewport State
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let isDraggingCropHandle = false;
let activeCropHandle: string | null = null; // 'tl', 'tr', 'bl', 'br', 't', 'r', 'b', 'l'
let cropRegion: { x: number; y: number; width: number; height: number } | null = null;
let lastPanX = 0;
let lastPanY = 0;

// Processing canvas state
let processZoom = 1.0;
let processPanX = 0;
let processPanY = 0;
let isProcessPanning = false;
let lastProcessPanX = 0;
let lastProcessPanY = 0;
let processViewInitialized = false;

// DOM Elements
const uploadFileList = document.getElementById("uploadFileList") as HTMLDivElement;
const uploadBtn = document.getElementById("uploadBtn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clearAllBtn") as HTMLButtonElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

const uploadScreen = document.getElementById("uploadScreen") as HTMLDivElement;

const pageSelectionScreen = document.getElementById("pageSelectionScreen") as HTMLDivElement;
const pdfFileName = document.getElementById("pdfFileName") as HTMLHeadingElement;
const pageGrid = document.getElementById("pageGrid") as HTMLDivElement;
const pageStatusText = document.getElementById("pageStatusText") as HTMLDivElement;
const backToFilesBtn = document.getElementById("backToFilesBtn") as HTMLButtonElement;

const cropScreen = document.getElementById("cropScreen") as HTMLDivElement;
const canvasContainer = document.getElementById("canvasContainer") as HTMLDivElement;
const mainCanvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
const ctx = mainCanvas.getContext("2d")!;
const cropOverlay = document.getElementById("cropOverlay") as HTMLCanvasElement;
const cropCtx = cropOverlay.getContext("2d")!;

const zoomInBtn = document.getElementById("zoomInBtn") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoomOutBtn") as HTMLButtonElement;
const zoomLevel = document.getElementById("zoomLevel") as HTMLDivElement;
const fitToScreenBtn = document.getElementById("fitToScreenBtn") as HTMLButtonElement;
const clearCropBtn = document.getElementById("clearCropBtn") as HTMLButtonElement;
const cropInfo = document.getElementById("cropInfo") as HTMLDivElement;
const processBtn = document.getElementById("processBtn") as HTMLButtonElement;
const backFromCropBtn = document.getElementById("backFromCropBtn") as HTMLButtonElement;
const statusText = document.getElementById("statusText") as HTMLDivElement;
const resultsPanel = document.getElementById("resultsPanel") as HTMLDivElement;
const resultsContainer = document.getElementById("resultsContainer") as HTMLDivElement;

// Palette editor elements
const paletteList = document.getElementById("paletteList") as HTMLDivElement;
const addPaletteColorBtn = document.getElementById("addPaletteColorBtn") as HTMLButtonElement;
const resetPaletteBtn = document.getElementById("resetPaletteBtn") as HTMLButtonElement;

const processingScreen = document.getElementById("processingScreen") as HTMLDivElement;
const processCanvasContainer = document.getElementById("processCanvasContainer") as HTMLDivElement;
const processCanvas = document.getElementById("processCanvas") as HTMLCanvasElement;
const processCtx = processCanvas.getContext("2d")!;
const processZoomInBtn = document.getElementById("processZoomInBtn") as HTMLButtonElement;
const processZoomOutBtn = document.getElementById("processZoomOutBtn") as HTMLButtonElement;
const processZoomLevel = document.getElementById("processZoomLevel") as HTMLDivElement;
const processFitToScreenBtn = document.getElementById("processFitToScreenBtn") as HTMLButtonElement;
const processStatusText = document.getElementById("processStatusText") as HTMLDivElement;
const backToCropBtn = document.getElementById("backToCropBtn") as HTMLButtonElement;

const stageCroppedBtn = document.getElementById("stageCroppedBtn") as HTMLButtonElement;
const stageValueBtn = document.getElementById("stageValueBtn") as HTMLButtonElement;
const stageValueMedianBtn = document.getElementById("stageValueMedianBtn") as HTMLButtonElement;
const stageValueSkeletonBtn = document.getElementById("stageValueSkeletonBtn") as HTMLButtonElement;
const stageSaturationBtn = document.getElementById("stageSaturationBtn") as HTMLButtonElement;
const stageSaturationMedianBtn = document.getElementById("stageSaturationMedianBtn") as HTMLButtonElement;
const stageHueBtn = document.getElementById("stageHueBtn") as HTMLButtonElement;
const stageHueMedianBtn = document.getElementById("stageHueMedianBtn") as HTMLButtonElement;
const stageCleanupBtn = document.getElementById("stageCleanupBtn") as HTMLButtonElement;
const stagePalettizedBtn = document.getElementById("stagePalettizedBtn") as HTMLButtonElement;
const stageMedianBtn = document.getElementById("stageMedianBtn") as HTMLButtonElement;
const stageBinaryBtn = document.getElementById("stageBinaryBtn") as HTMLButtonElement;

// Processing screen event handlers
backToCropBtn.addEventListener("click", () => {
  setMode("crop");
});

stageCroppedBtn.addEventListener("click", () => displayProcessingStage("cropped"));
stageValueBtn.addEventListener("click", () => displayProcessingStage("value"));
stageValueMedianBtn.addEventListener("click", () => displayProcessingStage("value_median"));
stageValueSkeletonBtn.addEventListener("click", () => displayProcessingStage("value_skeleton"));
stageSaturationBtn.addEventListener("click", () => displayProcessingStage("saturation"));
stageSaturationMedianBtn.addEventListener("click", () => displayProcessingStage("saturation_median"));
stageHueBtn.addEventListener("click", () => displayProcessingStage("hue"));
stageHueMedianBtn.addEventListener("click", () => displayProcessingStage("hue_median"));
stageCleanupBtn.addEventListener("click", () => displayProcessingStage("cleanup"));
stagePalettizedBtn.addEventListener("click", () => displayProcessingStage("palettized"));
stageMedianBtn.addEventListener("click", () => displayProcessingStage("median"));
stageBinaryBtn.addEventListener("click", () => displayProcessingStage("binary"));

processZoomInBtn.addEventListener("click", () => {
  processZoom = Math.min(10, processZoom * 1.2);
  updateProcessZoom();
  updateProcessTransform();
});

processZoomOutBtn.addEventListener("click", () => {
  processZoom = Math.max(0.1, processZoom / 1.2);
  updateProcessZoom();
  updateProcessTransform();
});

processFitToScreenBtn.addEventListener("click", () => {
  processFitToScreen();
});

// Initialize
refreshFileList();
setMode("upload");

// File management
uploadBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

uploadScreen.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  // Don't trigger file input if clicking on a file card, button, or inside the files grid
  if (target.closest(".file-card") || target.closest(".upload-actions")) {
    return;
  }
  // Only trigger on empty area or the upload-empty placeholder
  if (target === uploadScreen || target.closest(".upload-file-list")) {
    fileInput.click();
  }
});

fileInput.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});

// Drag and drop on entire upload screen
uploadScreen.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadScreen.classList.add("drag-over");
});

uploadScreen.addEventListener("dragleave", (e) => {
  if (e.target === uploadScreen) {
    uploadScreen.classList.remove("drag-over");
  }
});

uploadScreen.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadScreen.classList.remove("drag-over");
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
  currentFileId = null;
  currentPdfData = null;
  currentImage = null;
  cropRegion = null;
  setMode("upload");
  refreshFileList();
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
  zoom = Math.min(10, zoom * 1.2);
  updateZoom();
  updateTransform();
});

zoomOutBtn.addEventListener("click", () => {
  zoom /= 1.2;
  updateZoom();
  redrawCanvas();
});

fitToScreenBtn.addEventListener("click", () => {
  fitToScreen();
});

// Crop controls - crop is always active
clearCropBtn.addEventListener("click", () => {
  // Reset to default 10% margin
  if (currentImage) {
    setDefaultCrop(currentImage.width, currentImage.height);
    drawCropOverlay();
  }
});

processBtn.addEventListener("click", async () => {
  if (currentImage) {
    await startProcessing();
  }
});

// Canvas interaction
canvasContainer.addEventListener("mousedown", (e) => {
  const rect = canvasContainer.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left - panX) / zoom;
  const canvasY = (e.clientY - rect.top - panY) / zoom;
  
  // Check if clicking on a crop handle
  const handle = getCropHandleAtPoint(canvasX, canvasY);
  if (handle && cropRegion) {
    isDraggingCropHandle = true;
    activeCropHandle = handle;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
  } else if (!e.shiftKey) {
    // Pan with mouse drag (when not shift-clicking)
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    canvasContainer.classList.add("grabbing");
  }
});

canvasContainer.addEventListener("mousemove", (e) => {
  if (isDraggingCropHandle && activeCropHandle && cropRegion) {
    const dx = (e.clientX - lastPanX) / zoom;
    const dy = (e.clientY - lastPanY) / zoom;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    
    // Adjust crop region based on handle
    adjustCropRegion(activeCropHandle, dx, dy);
    drawCropOverlay();
  } else if (isPanning) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    panX += dx;
    panY += dy;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    updateTransform();
  } else {
    // Update cursor based on hover
    const rect = canvasContainer.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - panX) / zoom;
    const canvasY = (e.clientY - rect.top - panY) / zoom;
    const handle = getCropHandleAtPoint(canvasX, canvasY);
    updateCursorForHandle(handle);
  }
});

canvasContainer.addEventListener("mouseup", () => {
  if (isDraggingCropHandle) {
    isDraggingCropHandle = false;
    activeCropHandle = null;
    // Save crop settings
    if (currentImage && cropRegion) {
      saveCropSettings(currentImage.width, currentImage.height, cropRegion);
      updateCropInfo();
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
  
  // Check if this is a pinch zoom (ctrlKey) or two-finger pan
  const isPinchZoom = e.ctrlKey;
  
  if (isPinchZoom) {
    // Pinch to zoom
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate the point in canvas coordinates before zoom
    const canvasX = (mouseX - panX) / zoom;
    const canvasY = (mouseY - panY) / zoom;
    
    // Apply zoom with constant speed in log space (feels consistent at all zoom levels)
    // Instead of multiplying by a factor, we adjust by a fixed percentage of the current zoom
    const zoomSpeed = 0.005; // Adjust this to change overall zoom speed
    const zoomChange = -e.deltaY * zoomSpeed * zoom;
    const newZoom = Math.max(0.1, Math.min(10, zoom + zoomChange));
    
    // Adjust pan to keep the point under the mouse
    panX = mouseX - canvasX * newZoom;
    panY = mouseY - canvasY * newZoom;
    zoom = newZoom;
    
    updateZoom();
    updateTransform();
  } else {
    // Two-finger pan (or mouse wheel)
    panX -= e.deltaX;
    panY -= e.deltaY;
    updateTransform();
  }
});

// Processing canvas interaction
processCanvasContainer.addEventListener("mousedown", (e) => {
  isProcessPanning = true;
  lastProcessPanX = e.clientX;
  lastProcessPanY = e.clientY;
  processCanvasContainer.classList.add("grabbing");
});

processCanvasContainer.addEventListener("mousemove", (e) => {
  if (isProcessPanning) {
    const dx = e.clientX - lastProcessPanX;
    const dy = e.clientY - lastProcessPanY;
    processPanX += dx;
    processPanY += dy;
    lastProcessPanX = e.clientX;
    lastProcessPanY = e.clientY;
    updateProcessTransform();
  }
});

processCanvasContainer.addEventListener("mouseup", () => {
  if (isProcessPanning) {
    isProcessPanning = false;
    processCanvasContainer.classList.remove("grabbing");
  }
});

processCanvasContainer.addEventListener("mouseleave", () => {
  isProcessPanning = false;
  processCanvasContainer.classList.remove("grabbing");
});

processCanvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  
  const isPinchZoom = e.ctrlKey;
  
  if (isPinchZoom) {
    // Pinch to zoom
    const rect = processCanvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const image = processedImages.get(currentStage);
    if (!image) return;
    
    const canvasX = (mouseX - processPanX) / processZoom;
    const canvasY = (mouseY - processPanY) / processZoom;
    
    const zoomSpeed = 0.005;
    const zoomChange = -e.deltaY * zoomSpeed * processZoom;
    const newZoom = Math.max(0.1, Math.min(10, processZoom + zoomChange));
    
    processPanX = mouseX - canvasX * newZoom;
    processPanY = mouseY - canvasY * newZoom;
    processZoom = newZoom;
    
    updateProcessZoom();
    updateProcessTransform();
  } else {
    // Two-finger pan (or mouse wheel)
    processPanX -= e.deltaX;
    processPanY -= e.deltaY;
    updateProcessTransform();
  }
});

// Mode management
function setMode(mode: AppMode) {
  console.log("setMode called:", mode);
  currentMode = mode;
  
  uploadScreen.classList.remove("active");
  pageSelectionScreen.classList.remove("active");
  cropScreen.classList.remove("active");
  processingScreen.classList.remove("active");
  
  // Clear any inline styles that might override CSS
  pageSelectionScreen.style.display = "";
  
  switch (mode) {
    case "upload":
      uploadScreen.classList.add("active");
      console.log("Upload screen activated");
      console.log("uploadScreen display:", globalThis.getComputedStyle(uploadScreen).display);
      console.log("uploadScreen hasClass active:", uploadScreen.classList.contains("active"));
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
    case "processing":
      processingScreen.classList.add("active");
      console.log("Processing screen activated");
      break;
  }
}

function showStatus(message: string, isError = false) {
  // Update status in whichever screen is currently visible
  let activeStatusText = statusText;
  if (pageSelectionScreen.classList.contains("active")) {
    activeStatusText = pageStatusText;
  } else if (processingScreen.classList.contains("active")) {
    activeStatusText = processStatusText;
  }
  
  activeStatusText.textContent = message;
  if (isError) {
    activeStatusText.classList.add("status-error");
  } else {
    activeStatusText.classList.remove("status-error");
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
    const existingCards = pageGrid.children.length;
    if (existingCards > 0) {
      console.log(`[THUMBNAIL] PURGING ${existingCards} existing thumbnail cards from cache`);
    }
    pageGrid.innerHTML = "";
    console.log("loadPdf: pageGrid cleared, adding", pdfPageCount, "cards");
    
    // First pass: get all page dimensions and create cards with proper aspect ratios
    const pageDimensions: Array<{width: number; height: number; pageLabel: string}> = [];
    
    // Get page labels from PDF (if available)
    let pageLabels: string[] | null = null;
    try {
      pageLabels = await pdf.getPageLabels();
    } catch (_e) {
      // Page labels not available, will use page numbers
    }
    
    for (let i = 1; i <= pdfPageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      
      // Get page label from PDF (e.g., "i", "ii", "1", "A-1", etc.)
      const pageLabel = (pageLabels && pageLabels[i - 1]) || `Page ${i}`;
      
      pageDimensions.push({ 
        width: viewport.width, 
        height: viewport.height,
        pageLabel 
      });
      
      const card = document.createElement("div");
      card.className = "page-card";
      
      const imageDiv = document.createElement("div");
      imageDiv.className = "page-card-image";
      imageDiv.textContent = "📄";
      
      // Set aspect ratio immediately so layout is stable
      const aspectRatio = viewport.width / viewport.height;
      imageDiv.style.aspectRatio = aspectRatio.toString();
      imageDiv.style.width = (250 * aspectRatio) + "px";
      
      const label = document.createElement("div");
      label.className = "page-card-label";
      label.textContent = pageLabel;
      
      card.appendChild(imageDiv);
      card.appendChild(label);
      card.dataset.pageNum = i.toString();
      
      // Highlight if this is the currently selected page
      if (i === currentSelectedPage) {
        card.classList.add("selected");
      }
      
      card.addEventListener("click", () => {
        selectPdfPage(i);
      });
      
      pageGrid.appendChild(card);
    }
    
    // Second pass: render thumbnails with interleaved priority (early pages + largest pages)
    // Cap at reasonable number for large PDFs (~2-3 screenfuls worth)
    const MAX_THUMBNAILS = 50;
    const thumbnailsToRender = Math.min(pdfPageCount, MAX_THUMBNAILS);
    
    // Reset cancellation flag
    cancelThumbnailLoading = false;
    
    (async () => {
      // Sort pages by size (largest first)
      const pagesBySize = Array.from({ length: pdfPageCount }, (_, i) => i)
        .sort((a, b) => {
          const areaA = pageDimensions[a].width * pageDimensions[a].height;
          const areaB = pageDimensions[b].width * pageDimensions[b].height;
          return areaB - areaA;
        });
      
      // Interleave: [page 1, page 2, largest], [page 3, page 4, 2nd largest], etc.
      const renderQueue: number[] = [];
      const addedPages = new Set<number>();
      let sequentialIndex = 0;
      let largestIndex = 0;
      
      console.log(`[THUMBNAIL] Building render queue for ${thumbnailsToRender} thumbnails out of ${pdfPageCount} pages`);
      
      while (renderQueue.length < thumbnailsToRender && (sequentialIndex < pdfPageCount || largestIndex < pagesBySize.length)) {
        // Add next 2 sequential pages
        if (sequentialIndex < pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        if (sequentialIndex < pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        
        // Add next largest page (but skip if already in queue)
        while (largestIndex < pagesBySize.length && renderQueue.length < thumbnailsToRender) {
          const largestPageIdx = pagesBySize[largestIndex++];
          if (!addedPages.has(largestPageIdx)) {
            renderQueue.push(largestPageIdx);
            addedPages.add(largestPageIdx);
            break;
          }
        }
      }
      
      console.log(`[THUMBNAIL] Render queue built with ${renderQueue.length} pages:`, renderQueue.map(idx => {
        const pageNum = idx + 1;
        const label = pageDimensions[idx]?.pageLabel || `Page ${pageNum}`;
        return `${pageNum}(${label})`;
      }).join(', '));
      
      // Render in batches of 3
      const batchSize = 3;
      let completed = 0;
      
      // Store cards array once to avoid re-querying
      const allCards = Array.from(pageGrid.children);
      
      for (let i = 0; i < renderQueue.length; i += batchSize) {
        // Check cancellation flag
        if (cancelThumbnailLoading) {
          console.log(`[THUMBNAIL] Loading cancelled after ${completed} thumbnails`);
          showStatus(`Thumbnail loading cancelled`);
          return;
        }
        
        const batch = [];
        const batchInfo = [];
        for (let j = 0; j < batchSize && i + j < renderQueue.length; j++) {
          const pageIndex = renderQueue[i + j];
          const pageNum = pageIndex + 1;
          const pageLabel = pageDimensions[pageIndex]?.pageLabel || `Page ${pageNum}`;
          
          // Safely get card and image div
          if (pageIndex < allCards.length) {
            const card = allCards[pageIndex];
            const imageDiv = card.querySelector(".page-card-image") as HTMLElement;
            if (imageDiv) {
              batchInfo.push(`${pageNum}(${pageLabel})`);
              batch.push(generatePageThumbnail(pageNum, pageLabel, imageDiv));
            } else {
              console.warn(`[THUMBNAIL] No imageDiv found for page ${pageNum}(${pageLabel}) at index ${pageIndex}`);
            }
          } else {
            console.warn(`[THUMBNAIL] Page index ${pageIndex} out of bounds (cards.length=${allCards.length}) for page ${pageNum}`);
          }
        }
        
        if (batch.length > 0) {
          console.log(`[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: Rendering ${batchInfo.join(', ')}`);
          await Promise.all(batch);
          completed += batch.length;
          console.log(`[THUMBNAIL] Batch complete. Total: ${completed}/${renderQueue.length}`);
          const statusMsg = thumbnailsToRender < pdfPageCount 
            ? `Loading thumbnails: ${completed}/${thumbnailsToRender} (${pdfPageCount} pages total)`
            : `Loading thumbnails: ${completed}/${pdfPageCount}`;
          showStatus(statusMsg);
        } else {
          console.warn(`[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: No valid thumbnails to render`);
        }
      }
      const finalMsg = thumbnailsToRender < pdfPageCount
        ? `PDF loaded: ${pdfPageCount} pages (showing ${thumbnailsToRender} thumbnails)`
        : `PDF loaded: ${pdfPageCount} pages`;
      showStatus(finalMsg);
    })();
  } catch (error) {
    console.error("loadPdf error:", error);
    showStatus(`PDF load error: ${(error as Error).message}`, true);
    throw error;
  }
}

async function generatePageThumbnail(pageNum: number, pageLabel: string, container: HTMLElement) {
  try {
    if (!currentPdfData) {
      console.warn(`[THUMBNAIL] No PDF data for page ${pageNum}(${pageLabel})`);
      return;
    }
    
    console.log(`[THUMBNAIL] START rendering page ${pageNum}(${pageLabel})`);
    const pdfDataCopy = currentPdfData.slice();
    const image = await renderPdfPage(
      { file: pdfDataCopy, pageNumber: pageNum, scale: 0.4 },
      browserCanvasBackend,
      pdfjsLib,
    );
    console.log(`[THUMBNAIL] RENDERED page ${pageNum}(${pageLabel}): ${image.width}x${image.height}`);
    
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
      console.log(`[THUMBNAIL] COMPLETE page ${pageNum}(${pageLabel}) - image inserted into DOM`);
    }
  } catch (err) {
    console.error(`[THUMBNAIL] ERROR generating thumbnail for page ${pageNum}(${pageLabel}):`, err);
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
    
    // Cancel any ongoing thumbnail loading
    cancelThumbnailLoading = true;
    
    // Update selected page tracking
    currentSelectedPage = pageNum;
    
    // Update page card selection highlighting
    const cards = pageGrid.querySelectorAll(".page-card");
    cards.forEach(card => card.classList.remove("selected"));
    const selectedCard = pageGrid.querySelector(`[data-page-num="${pageNum}"]`);
    if (selectedCard) {
      selectedCard.classList.add("selected");
    }
    
    // Switch to crop screen immediately with loading state
    setMode("crop");
    
    // Clear previous canvas content AND hide crop overlay
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    mainCanvas.width = 0;
    mainCanvas.height = 0;
    cropOverlay.width = 0;
    cropOverlay.height = 0;
    cropOverlay.style.display = "none";
    
    showStatus(`⏳ Rendering page ${pageNum} at 200 DPI...`);
    canvasContainer.style.opacity = "0.3";
    
    // Simulate progress indicator (since PDF.js doesn't provide real progress)
    let progressDots = 0;
    const progressInterval = setInterval(() => {
      progressDots = (progressDots + 1) % 4;
      showStatus(`⏳ Rendering page ${pageNum} at 200 DPI${'.'.repeat(progressDots)}`);
    }, 300);
    
    console.log("selectPdfPage: Creating copy");
    const pdfDataCopy = currentPdfData.slice();
    console.log("selectPdfPage: Calling renderPdfPage");
    // Scale 2.778 ≈ 200 DPI (72 * 2.778 ≈ 200)
    const image = await renderPdfPage(
      { 
        file: pdfDataCopy, 
        pageNumber: pageNum, 
        scale: 2.778
      },
      browserCanvasBackend,
      pdfjsLib,
    );
    console.log("selectPdfPage: Got image", image.width, "x", image.height);
    
    clearInterval(progressInterval);
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
  
  // Set up canvases
  mainCanvas.width = image.width;
  mainCanvas.height = image.height;
  cropOverlay.width = image.width;
  cropOverlay.height = image.height;
  
  // Make sure main canvas is visible (crop overlay shown after drawing)
  mainCanvas.style.display = "block";
  canvasContainer.style.opacity = "1";
  
  // Load saved crop settings or set default 10% margin
  const savedCrop = getCropSettings(image.width, image.height);
  if (savedCrop) {
    cropRegion = savedCrop;
  } else {
    setDefaultCrop(image.width, image.height);
  }
  
  // Draw the image first
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
  ctx.putImageData(imageData, 0, 0);
  
  // Then fit to screen and draw crop
  fitToScreen();
  cropOverlay.style.display = "block";
  drawCropOverlay();
  
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
  updateTransform();
}

function updateZoom() {
  zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
}

// Crop management functions
function setDefaultCrop(imageWidth: number, imageHeight: number) {
  const margin = 0.1; // 10% margin
  cropRegion = {
    x: imageWidth * margin,
    y: imageHeight * margin,
    width: imageWidth * (1 - 2 * margin),
    height: imageHeight * (1 - 2 * margin),
  };
  updateCropInfo();
}

function getCropSettings(imageWidth: number, imageHeight: number) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return JSON.parse(stored) as { x: number; y: number; width: number; height: number };
    } catch {
      return null;
    }
  }
  return null;
}

function saveCropSettings(imageWidth: number, imageHeight: number, crop: { x: number; y: number; width: number; height: number }) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  localStorage.setItem(key, JSON.stringify(crop));
}

function updateCropInfo() {
  if (cropRegion) {
    cropInfo.textContent = `Crop: ${Math.round(cropRegion.width)}×${Math.round(cropRegion.height)} at (${Math.round(cropRegion.x)}, ${Math.round(cropRegion.y)})`;
  }
}

function getCropHandleAtPoint(x: number, y: number): string | null {
  if (!cropRegion) return null;
  
  const handleSize = 15 / zoom; // Handle hit area in canvas coordinates
  const { x: cx, y: cy, width: cw, height: ch } = cropRegion;
  
  // Check corners first
  if (Math.abs(x - cx) < handleSize && Math.abs(y - cy) < handleSize) return "tl";
  if (Math.abs(x - (cx + cw)) < handleSize && Math.abs(y - cy) < handleSize) return "tr";
  if (Math.abs(x - cx) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "bl";
  if (Math.abs(x - (cx + cw)) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "br";
  
  // Check edges
  if (Math.abs(x - (cx + cw / 2)) < handleSize && Math.abs(y - cy) < handleSize) return "t";
  if (Math.abs(x - (cx + cw / 2)) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "b";
  if (Math.abs(y - (cy + ch / 2)) < handleSize && Math.abs(x - cx) < handleSize) return "l";
  if (Math.abs(y - (cy + ch / 2)) < handleSize && Math.abs(x - (cx + cw)) < handleSize) return "r";
  
  return null;
}

function updateCursorForHandle(handle: string | null) {
  if (!handle) {
    canvasContainer.style.cursor = "default";
  } else if (handle === "tl" || handle === "br") {
    canvasContainer.style.cursor = "nwse-resize";
  } else if (handle === "tr" || handle === "bl") {
    canvasContainer.style.cursor = "nesw-resize";
  } else if (handle === "t" || handle === "b") {
    canvasContainer.style.cursor = "ns-resize";
  } else if (handle === "l" || handle === "r") {
    canvasContainer.style.cursor = "ew-resize";
  }
}

function adjustCropRegion(handle: string, dx: number, dy: number) {
  if (!cropRegion || !currentImage) return;
  
  const { x, y, width, height } = cropRegion;
  let newX = x, newY = y, newWidth = width, newHeight = height;
  
  switch (handle) {
    case "tl":
      newX = x + dx;
      newY = y + dy;
      newWidth = width - dx;
      newHeight = height - dy;
      break;
    case "tr":
      newY = y + dy;
      newWidth = width + dx;
      newHeight = height - dy;
      break;
    case "bl":
      newX = x + dx;
      newWidth = width - dx;
      newHeight = height + dy;
      break;
    case "br":
      newWidth = width + dx;
      newHeight = height + dy;
      break;
    case "t":
      newY = y + dy;
      newHeight = height - dy;
      break;
    case "b":
      newHeight = height + dy;
      break;
    case "l":
      newX = x + dx;
      newWidth = width - dx;
      break;
    case "r":
      newWidth = width + dx;
      break;
  }
  
  // Constrain to image bounds
  newX = Math.max(0, Math.min(newX, currentImage.width - 10));
  newY = Math.max(0, Math.min(newY, currentImage.height - 10));
  newWidth = Math.max(10, Math.min(newWidth, currentImage.width - newX));
  newHeight = Math.max(10, Math.min(newHeight, currentImage.height - newY));
  
  cropRegion.x = newX;
  cropRegion.y = newY;
  cropRegion.width = newWidth;
  cropRegion.height = newHeight;
  
  updateCropInfo();
}

// Fast update - only changes transform (for panning/zooming)
function updateTransform() {
  const transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  mainCanvas.style.transform = transform;
  mainCanvas.style.transformOrigin = "0 0";
  mainCanvas.style.willChange = "transform";
  
  cropOverlay.style.transform = transform;
  cropOverlay.style.transformOrigin = "0 0";
  cropOverlay.style.willChange = "transform";
  
  // Use crisp pixels when zoomed in (>= 1x), filtered when zoomed out (< 1x)
  if (zoom >= 1) {
    mainCanvas.style.imageRendering = "pixelated";
  } else {
    mainCanvas.style.imageRendering = "smooth";
  }
  
  // Redraw crop overlay whenever transform changes
  drawCropOverlay();
}

// Full redraw - updates canvas content
function redrawCanvas() {
  if (!currentImage) return;
  
  // Clear and redraw base image
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImage.data),
    currentImage.width,
    currentImage.height,
  );
  ctx.putImageData(imageData, 0, 0);
  
  drawCropOverlay();
}

// Draw crop overlay with darkened mask and handles
function drawCropOverlay() {
  if (!currentImage || !cropRegion) {
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    return;
  }
  
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  
  // Draw darkened mask over entire image
  cropCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
  cropCtx.fillRect(0, 0, currentImage.width, currentImage.height);
  
  // Clear the crop region (composite mode)
  cropCtx.globalCompositeOperation = "destination-out";
  cropCtx.fillStyle = "rgba(0, 0, 0, 1)";
  cropCtx.fillRect(
    cropRegion.x,
    cropRegion.y,
    cropRegion.width,
    cropRegion.height,
  );
  cropCtx.globalCompositeOperation = "source-over";
  
  // Draw crop rectangle border
  cropCtx.strokeStyle = "#4f46e5";
  cropCtx.lineWidth = 3 / zoom;
  cropCtx.strokeRect(
    cropRegion.x,
    cropRegion.y,
    cropRegion.width,
    cropRegion.height,
  );
  
  // Draw handles - 4 corners + 4 edges
  const handleSize = 10 / zoom;
  cropCtx.fillStyle = "#4f46e5";
  
  const cx = cropRegion.x;
  const cy = cropRegion.y;
  const cw = cropRegion.width;
  const ch = cropRegion.height;
  
  const handles = [
    // Corners
    [cx, cy],                     // top-left
    [cx + cw, cy],                // top-right
    [cx, cy + ch],                // bottom-left
    [cx + cw, cy + ch],           // bottom-right
    // Edges
    [cx + cw / 2, cy],            // top
    [cx + cw, cy + ch / 2],       // right
    [cx + cw / 2, cy + ch],       // bottom
    [cx, cy + ch / 2],            // left
  ];
  
  for (const [x, y] of handles) {
    cropCtx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
  }
}

// Processing mode functions
async function startProcessing() {
  if (!currentImage) return;
  
  try {
    setMode("processing");
    processedImages.clear();
    processViewInitialized = false; // Reset for new processing session
    
    // Apply crop if selected
    let processImage = currentImage;
    if (cropRegion && cropRegion.width > 0 && cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(currentImage, cropRegion);
    }
    
    // Store and display cropped image
    processedImages.set("cropped", processImage);
    displayProcessingStage("cropped");
    
    // Run GPU pipeline with auto-advance after each stage
    showStatus("Running cleanup (extracting channels)...");
    const t1 = performance.now();
    const cleanupResults = await cleanupGPU(processImage);
    const t2 = performance.now();
    showStatus(`Cleanup: ${(t2 - t1).toFixed(1)}ms`);
    
    // Store all intermediate cleanup stages
    processedImages.set("value", cleanupResults.value);
    processedImages.set("saturation", cleanupResults.saturation);
    processedImages.set("saturation_median", cleanupResults.saturationMedian);
    processedImages.set("hue", cleanupResults.hue);
    processedImages.set("hue_median", cleanupResults.hueMedian);
    // Don't set "cleanup" yet - we'll recombine with skeleton value
    
    // Process value channel: weighted median, skeletonization
    showStatus("Processing value channel (median, skeleton)...");
    const t2b = performance.now();
    const valueResults = await processValueChannel(
        cleanupResults.valueBuffer,
        cleanupResults.width,
        cleanupResults.height
    );
    const t2c = performance.now();
    showStatus(`Value processing: ${(t2c - t2b).toFixed(1)}ms`);
    
    // Store value processing stages
    processedImages.set("value_median", valueResults.median);
    processedImages.set("value_skeleton", valueResults.skeleton);
    
    // Now recombine with skeleton value instead of thresholded value
    showStatus("Recombining with skeletonized value...");
    const t2d = performance.now();
    const cleanupFinal = await recombineWithValue(
        valueResults.skeletonBuffer,
        cleanupResults.saturationBuffer,
        cleanupResults.hueBuffer,
        cleanupResults.width,
        cleanupResults.height
    );
    const t2e = performance.now();
    showStatus(`Recombine: ${(t2e - t2d).toFixed(1)}ms`);
    processedImages.set("cleanup", cleanupFinal);
    displayProcessingStage("cleanup");
    
    // Clean up buffers now that we're done with them
    cleanupResults.valueBuffer.destroy();
    cleanupResults.saturationBuffer.destroy();
    cleanupResults.hueBuffer.destroy();
    valueResults.skeletonBuffer.destroy();
    
    showStatus("Palettizing...");
    const t3 = performance.now();
    const customPalette = buildPaletteRGBA();
    const palettized = await palettizeGPU(cleanupFinal, customPalette);
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    processedImages.set("palettized", palettized);
    displayProcessingStage("palettized");
    
    showStatus("Applying median filter...");
    const t5 = performance.now();
    const median = await median3x3GPU(palettized);
    const t6 = performance.now();
    showStatus(`Median filter: ${(t6 - t5).toFixed(1)}ms`);
    processedImages.set("median", median);
    displayProcessingStage("median");
    
    showStatus("Extracting black...");
    const t7 = performance.now();
    const binary = extractBlack(median);
    const t8 = performance.now();
    showStatus(`Extract black: ${(t8 - t7).toFixed(1)}ms`);
    processedImages.set("binary", binary);
    displayProcessingStage("binary");
    
    const totalTime = t8 - t1;
    showStatus(`✓ Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
    console.error(error);
  }
}

function displayProcessingStage(stage: ProcessingStage) {
  const image = processedImages.get(stage);
  if (!image) {
    showStatus(`Stage ${stage} not available`, true);
    return;
  }
  
  currentStage = stage;
  
  // Update stage button states
  document.querySelectorAll(".stage-btn").forEach(btn => btn.classList.remove("active"));
  const stageButtons: Record<ProcessingStage, HTMLButtonElement> = {
    cropped: stageCroppedBtn,
    value: stageValueBtn,
    saturation: stageSaturationBtn,
    saturation_median: stageSaturationMedianBtn,
    hue: stageHueBtn,
    hue_median: stageHueMedianBtn,
    cleanup: stageCleanupBtn,
    value_median: document.getElementById("stageValueMedianBtn") as HTMLButtonElement,
    value_skeleton: document.getElementById("stageValueSkeletonBtn") as HTMLButtonElement,
    palettized: stagePalettizedBtn,
    median: stageMedianBtn,
    binary: stageBinaryBtn,
  };
  stageButtons[stage]?.classList.add("active");
  
  // Set up canvas
  processCanvas.width = image.width;
  processCanvas.height = image.height;
  
  // Convert to RGBA for display
  let rgbaData: Uint8ClampedArray;
  if ("palette" in image && image.palette) {
    // PalettizedImage - convert indexed colors to RGBA
    // Palettized format stores 2 pixels per byte: high nibble (left) and low nibble (right)
    const numPixels = image.width * image.height;
    rgbaData = new Uint8ClampedArray(numPixels * 4);
    
    for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
      const byteIndex = Math.floor(pixelIndex / 2);
      const isHighNibble = pixelIndex % 2 === 0;
      
      // Extract 4-bit color index from nibble
      const colorIndex = isHighNibble 
        ? (image.data[byteIndex] >> 4) & 0x0f
        : image.data[byteIndex] & 0x0f;
      
      // Look up RGBA color in palette (stored as Uint8ClampedArray, 4 bytes per color)
      const paletteOffset = colorIndex * 4;
      const pixelOffset = pixelIndex * 4;
      
      rgbaData[pixelOffset] = image.palette[paletteOffset];       // R
      rgbaData[pixelOffset + 1] = image.palette[paletteOffset + 1]; // G
      rgbaData[pixelOffset + 2] = image.palette[paletteOffset + 2]; // B
      rgbaData[pixelOffset + 3] = image.palette[paletteOffset + 3]; // A
    }
  } else if (image.data instanceof Uint8Array && image.data.length === image.width * image.height) {
    // BinaryImage - convert 1-bit to RGBA (0=white, 1=black)
    rgbaData = new Uint8ClampedArray(image.width * image.height * 4);
    for (let i = 0; i < image.data.length; i++) {
      const value = image.data[i] ? 0 : 255;
      const offset = i * 4;
      rgbaData[offset] = value;
      rgbaData[offset + 1] = value;
      rgbaData[offset + 2] = value;
      rgbaData[offset + 3] = 255;
    }
  } else {
    // RGBAImage - use directly
    rgbaData = new Uint8ClampedArray(image.data);
  }
  
  // Draw image - ensure it's a proper Uint8ClampedArray with ArrayBuffer
  const displayData = new Uint8ClampedArray(rgbaData);
  const imageData = new ImageData(
    displayData,
    image.width,
    image.height,
  );
  processCtx.putImageData(imageData, 0, 0);
  
  // Only fit to screen on first display, then preserve zoom/pan
  if (!processViewInitialized) {
    processFitToScreen();
    processViewInitialized = true;
  } else {
    updateProcessTransform();
  }
  
  showStatus(`Viewing: ${stage} (${image.width}×${image.height})`);
}

function processFitToScreen() {
  const image = processedImages.get(currentStage);
  if (!image) return;
  
  const containerWidth = processCanvasContainer.clientWidth;
  const containerHeight = processCanvasContainer.clientHeight;
  const imageWidth = image.width;
  const imageHeight = image.height;
  
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  processZoom = Math.min(scaleX, scaleY) * 0.9;
  
  processPanX = (containerWidth - imageWidth * processZoom) / 2;
  processPanY = (containerHeight - imageHeight * processZoom) / 2;
  
  updateProcessZoom();
  updateProcessTransform();
}

function updateProcessZoom() {
  processZoomLevel.textContent = `${Math.round(processZoom * 100)}%`;
}

function updateProcessTransform() {
  const transform = `translate(${processPanX}px, ${processPanY}px) scale(${processZoom})`;
  processCanvas.style.transform = transform;
  processCanvas.style.transformOrigin = "0 0";
  processCanvas.style.willChange = "transform";
  
  if (processZoom >= 1) {
    processCanvas.style.imageRendering = "pixelated";
  } else {
    processCanvas.style.imageRendering = "auto";
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

function _displayResult(image: RGBAImage, label: string) {
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
    uploadFileList.innerHTML = `
      <div class="upload-empty">
        <div>📁</div>
        <div>No files yet</div>
      </div>
    `;
    return;
  }
  
  uploadFileList.innerHTML = `<div class="files-grid"></div>`;
  const filesGrid = uploadFileList.querySelector(".files-grid") as HTMLDivElement;
  
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-card";
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
    
    filesGrid.appendChild(item);
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

// Palette Editor Functions
function renderPaletteUI() {
  paletteList.innerHTML = "";
  
  userPalette.forEach((color, index) => {
    const entry = document.createElement("div");
    entry.className = "palette-entry";
    if (index === 0) entry.classList.add("background");
    
    // Header with index and remove button
    const header = document.createElement("div");
    header.className = "palette-entry-header";
    
    const indexLabel = document.createElement("div");
    indexLabel.className = index === 0 ? "palette-index bg-index" : "palette-index";
    indexLabel.textContent = `${index}${index === 0 ? " (BG)" : ""}`;
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-color";
    removeBtn.textContent = "Remove";
    removeBtn.disabled = index === 0; // Can't remove background
    removeBtn.onclick = () => {
      if (index !== 0) {
        userPalette.splice(index, 1);
        renderPaletteUI();
      }
    };
    
    header.appendChild(indexLabel);
    header.appendChild(removeBtn);
    entry.appendChild(header);
    
    // Input color picker
    const inputGroup = document.createElement("div");
    inputGroup.className = "color-picker-group";
    
    const inputLabel = document.createElement("label");
    inputLabel.textContent = "Input (matching):";
    inputGroup.appendChild(inputLabel);
    
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "color-picker-wrapper";
    
    const inputColorPicker = document.createElement("input");
    inputColorPicker.type = "color";
    inputColorPicker.value = color.inputColor;
    inputColorPicker.oninput = (e) => {
      const hex = (e.target as HTMLInputElement).value;
      userPalette[index].inputColor = hex;
      inputHex.value = hex;
    };
    
    const inputHex = document.createElement("input");
    inputHex.type = "text";
    inputHex.value = color.inputColor;
    inputHex.maxLength = 7;
    inputHex.oninput = (e) => {
      const hex = (e.target as HTMLInputElement).value;
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        userPalette[index].inputColor = hex;
        inputColorPicker.value = hex;
      }
    };
    
    inputWrapper.appendChild(inputColorPicker);
    inputWrapper.appendChild(inputHex);
    inputGroup.appendChild(inputWrapper);
    entry.appendChild(inputGroup);
    
    // Output color picker
    const outputGroup = document.createElement("div");
    outputGroup.className = "color-picker-group";
    
    const outputLabel = document.createElement("label");
    outputLabel.textContent = "Output (display):";
    outputGroup.appendChild(outputLabel);
    
    const outputWrapper = document.createElement("div");
    outputWrapper.className = "color-picker-wrapper";
    
    const outputColorPicker = document.createElement("input");
    outputColorPicker.type = "color";
    outputColorPicker.value = color.outputColor;
    outputColorPicker.oninput = (e) => {
      const hex = (e.target as HTMLInputElement).value;
      userPalette[index].outputColor = hex;
      outputHex.value = hex;
    };
    
    const outputHex = document.createElement("input");
    outputHex.type = "text";
    outputHex.value = color.outputColor;
    outputHex.maxLength = 7;
    outputHex.oninput = (e) => {
      const hex = (e.target as HTMLInputElement).value;
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        userPalette[index].outputColor = hex;
        outputColorPicker.value = hex;
      }
    };
    
    outputWrapper.appendChild(outputColorPicker);
    outputWrapper.appendChild(outputHex);
    outputGroup.appendChild(outputWrapper);
    entry.appendChild(outputGroup);
    
    // Map to background checkbox
    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "checkbox-label";
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = color.mapToBg;
    checkbox.disabled = index === 0; // Background can't map to itself
    checkbox.onchange = (e) => {
      userPalette[index].mapToBg = (e.target as HTMLInputElement).checked;
    };
    
    checkboxLabel.appendChild(checkbox);
    checkboxLabel.appendChild(document.createTextNode("Map to BG"));
    entry.appendChild(checkboxLabel);
    
    paletteList.appendChild(entry);
  });
}

function addPaletteColor() {
  if (userPalette.length >= 16) {
    showStatus("Maximum 16 colors allowed", true);
    return;
  }
  
  userPalette.push({
    inputColor: "#808080",
    outputColor: "#808080",
    mapToBg: false,
  });
  
  renderPaletteUI();
}

function resetPaletteToDefault() {
  userPalette.length = 0;
  Array.from(DEFAULT_PALETTE).forEach(color => {
    userPalette.push({
      inputColor: u32ToHex(color),
      outputColor: u32ToHex(color),
      mapToBg: false,
    });
  });
  renderPaletteUI();
  showStatus("Palette reset to default");
}

function showColorHistogram() {
  if (!currentImage) {
    showStatus("No image loaded", true);
    return;
  }
  
  showStatus("⏳ Analyzing colors...");
  
  // Quantization function - reduce to 5 levels per channel (5^3 = 125 buckets)
  // Levels: 0, 64, 128, 192, 255
  const quantize = (value: number) => Math.round(value / 64) * 64;
  
  // Count quantized color frequencies
  const colorCounts = new Map<string, { count: number; avgR: number; avgG: number; avgB: number; samples: number }>();
  const data = currentImage.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Quantize to bucket
    const qR = quantize(r);
    const qG = quantize(g);
    const qB = quantize(b);
    const key = `${qR},${qG},${qB}`;
    
    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
      existing.avgR += r;
      existing.avgG += g;
      existing.avgB += b;
      existing.samples++;
    } else {
      colorCounts.set(key, {
        count: 1,
        avgR: r,
        avgG: g,
        avgB: b,
        samples: 1,
      });
    }
  }
  
  // Convert to array and compute average colors for each bucket
  const buckets = Array.from(colorCounts.entries()).map(([_key, data]) => {
    const avgR = Math.round(data.avgR / data.samples);
    const avgG = Math.round(data.avgG / data.samples);
    const avgB = Math.round(data.avgB / data.samples);
    const hex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
    return { hex, count: data.count, r: avgR, g: avgG, b: avgB };
  });
  
  // Find background (most prevalent) and cap its size
  buckets.sort((a, b) => b.count - a.count);
  const backgroundHex = buckets.length > 0 ? buckets[0].hex : "#ffffff";
  const secondCount = buckets.length > 1 ? buckets[1].count : buckets[0].count;
  
  // Cap background to second most prevalent
  if (buckets.length > 0) {
    buckets[0].count = Math.min(buckets[0].count, secondCount);
  }
  
  // Calculate opposite color for border
  const bgR = parseInt(backgroundHex.slice(1, 3), 16);
  const bgG = parseInt(backgroundHex.slice(3, 5), 16);
  const bgB = parseInt(backgroundHex.slice(5, 7), 16);
  const borderColor = `rgb(${255 - bgR}, ${255 - bgG}, ${255 - bgB})`;
  
  // HSV conversion for sorting
  const rgbToHSV = (r: number, g: number, b: number) => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;
    
    let h = 0;
    if (delta !== 0) {
      if (max === rNorm) {
        h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) / 6;
      } else if (max === gNorm) {
        h = ((bNorm - rNorm) / delta + 2) / 6;
      } else {
        h = ((rNorm - gNorm) / delta + 4) / 6;
      }
    }
    
    const s = max === 0 ? 0 : delta / max;
    const v = max;
    
    return { h, s, v };
  };
  
  // Separate grayscale from chromatic and sort consistently
  const grayscale: typeof buckets = [];
  const chromatic: typeof buckets = [];
  
  buckets.forEach(bucket => {
    const { s } = rgbToHSV(bucket.r, bucket.g, bucket.b);
    if (s < 0.1) {
      grayscale.push(bucket);
    } else {
      chromatic.push(bucket);
    }
  });
  
  // Sort grayscale by brightness (dark to light)
  grayscale.sort((a, b) => {
    const { v: vA } = rgbToHSV(a.r, a.g, a.b);
    const { v: vB } = rgbToHSV(b.r, b.g, b.b);
    return vA - vB;
  });
  
  // Sort chromatic by hue, then saturation, then brightness
  chromatic.sort((a, b) => {
    const hsvA = rgbToHSV(a.r, a.g, a.b);
    const hsvB = rgbToHSV(b.r, b.g, b.b);
    
    // Sort by hue first
    if (Math.abs(hsvA.h - hsvB.h) > 0.015) {
      return hsvA.h - hsvB.h;
    }
    // Then by saturation (more saturated first)
    if (Math.abs(hsvA.s - hsvB.s) > 0.05) {
      return hsvB.s - hsvA.s;
    }
    // Then by value (brighter first)
    return hsvB.v - hsvA.v;
  });
  
  // Combine: chromatic first, then grayscale
  const allColorsSorted = [...chromatic, ...grayscale];
  
  // Show histogram modal
  const modal = document.getElementById("histogramModal") as HTMLDivElement;
  const body = document.getElementById("histogramBody") as HTMLDivElement;
  
  const total = currentImage.width * currentImage.height;
  
  // Set background color
  body.style.backgroundColor = backgroundHex;
  
  // Create tiles container
  const tiles = document.createElement("div");
  tiles.className = "histogram-tiles";
  
  // Calculate tile sizes - direct proportion with minimum
  const maxCount = Math.max(...allColorsSorted.map(b => b.count));
  const minSize = 3;   // Minimum 3px
  const maxSize = 120; // Maximum size for largest tile
  
  allColorsSorted.forEach(({ hex, count }) => {
    const percent = (count / total) * 100;
    
    // Direct linear proportion from count
    const sizeFactor = count / maxCount;
    const size = Math.max(minSize, sizeFactor * maxSize);
    
    const tile = document.createElement("div");
    tile.className = "color-tile";
    tile.style.backgroundColor = hex;
    tile.style.width = `${size}px`;
    tile.style.height = `${size}px`;
    tile.style.border = `1px solid ${borderColor}`;
    tile.title = `${hex.toUpperCase()} - ${percent.toFixed(3)}%`;
    
    const label = document.createElement("div");
    label.className = "color-tile-label";
    if (size > 20) {
      label.textContent = percent >= 1 ? `${percent.toFixed(1)}%` : `${percent.toFixed(2)}%`;
    }
    tile.appendChild(label);
    
    tile.onclick = () => {
      addColorToPalette(hex);
      modal.classList.remove("active");
      showStatus(`Added ${hex} (${percent.toFixed(2)}%) to palette`);
    };
    
    tiles.appendChild(tile);
  });
  
  body.innerHTML = "";
  body.appendChild(tiles);
  modal.classList.add("active");
  
  showStatus(`${allColorsSorted.length} colors (${chromatic.length} chromatic, ${grayscale.length} grayscale, bg: ${backgroundHex})`);
}

function addColorToPalette(hex: string) {
  if (userPalette.length >= 16) {
    showStatus("Maximum 16 colors - remove one first", true);
    return;
  }
  
  userPalette.push({
    inputColor: hex,
    outputColor: hex,
    mapToBg: false,
  });
  
  renderPaletteUI();
  showStatus(`Added ${hex} to palette`);
}

// Histogram modal handlers
const histogramModal = document.getElementById("histogramModal") as HTMLDivElement;
const closeHistogramBtn = document.getElementById("closeHistogramBtn") as HTMLButtonElement;

closeHistogramBtn.addEventListener("click", () => {
  histogramModal.classList.remove("active");
});

// Close on outside click
histogramModal.addEventListener("click", (e) => {
  if (e.target === histogramModal) {
    histogramModal.classList.remove("active");
  }
});

// Convert userPalette to RGBA format for GPU processing
function buildPaletteRGBA(): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(16 * 4);
  
  for (let i = 0; i < userPalette.length && i < 16; i++) {
    const color = userPalette[i];
    const useColor = color.mapToBg ? userPalette[0].outputColor : color.inputColor;
    const [r, g, b, a] = hexToRGBA(useColor);
    
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  
  // Fill remaining slots with background color
  for (let i = userPalette.length; i < 16; i++) {
    const [r, g, b, a] = hexToRGBA(userPalette[0].outputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  
  return palette;
}

// Palette editor event handlers
addPaletteColorBtn.addEventListener("click", addPaletteColor);
resetPaletteBtn.addEventListener("click", resetPaletteToDefault);
const showHistogramBtn = document.getElementById("showHistogramBtn") as HTMLButtonElement;
showHistogramBtn.addEventListener("click", showColorHistogram);

// Initialize palette UI on load
renderPaletteUI();
