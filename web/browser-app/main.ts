// Browser application entry point - New UI
import { loadImageFromFile } from "../src/pdf/image_load.ts";
import { renderPdfPage } from "../src/pdf/pdf_render.ts";
import type { CanvasBackend } from "../src/pdf/pdf_render.ts";
import { cleanupGPU, recombineWithValue } from "../src/gpu/cleanup_gpu.ts";
import { processValueChannel } from "../src/gpu/value_process_gpu.ts";
import { palettizeGPU } from "../src/gpu/palettize_gpu.ts";
import { median3x3GPU } from "../src/gpu/median_gpu.ts";
import { extractBlackGPU } from "../src/gpu/extract_black_gpu.ts";
import { bloomFilter3x3GPU } from "../src/gpu/bloom_gpu.ts";
import { subtractBlackGPU } from "../src/gpu/subtract_black_gpu.ts";
import { getGPUContext, createGPUBuffer } from "../src/gpu/gpu_context.ts";
import type { RGBAImage } from "../src/formats/rgba_image.ts";
import type { PalettizedImage } from "../src/formats/palettized.ts";
import type { BinaryImage } from "../src/formats/binary.ts";
import { DEFAULT_PALETTE } from "../src/formats/palettized.ts";
import { saveFile, getFile, listFiles, deleteFile, clearAllFiles, updateFile } from "./storage.ts";
import type { AppMode, ProcessingStage, BaseProcessingStage, PaletteColor } from "./types.ts";
import { u32ToHex, hexToRGBA } from "./utils.ts";
import { state } from "./state.ts";
import {
  initCanvasElements,
  loadImage,
  fitToScreen,
  updateZoom,
  setDefaultCrop,
  getCropSettings,
  saveCropSettings,
  updateCropInfo,
  getCropHandleAtPoint,
  updateCursorForHandle,
  adjustCropRegion,
  updateTransform,
  redrawCanvas,
  drawCropOverlay,
  cropImage,
} from "./canvas.ts";
import {
  initPaletteModule,
  initPaletteDB,
  savePalette,
  loadPalette,
  setDefaultPalette,
  loadDefaultPalette,
  renderPaletteUI,
  addPaletteColor,
  resetPaletteToDefault,
  pickColorFromCanvas,
  buildPaletteRGBA,
  isEyedropperActive,
  forceDeactivateEyedropper,
} from "./palette.ts";
import {
  vectorizeSkeleton,
  vectorizedToSVG,
  renderVectorizedToSVG,
} from "./vectorize.ts";

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
const statusText = document.getElementById("statusText") as HTMLDivElement;
const resultsContainer = document.getElementById("resultsContainer") as HTMLDivElement;

// Top navigation elements
const navStepFile = document.getElementById("navStepFile") as HTMLDivElement;
const navStepPage = document.getElementById("navStepPage") as HTMLDivElement;
const navStepConfigure = document.getElementById("navStepConfigure") as HTMLDivElement;
const toggleToolbarBtn = document.getElementById("toggleToolbarBtn") as HTMLButtonElement;
const cropSidebar = document.getElementById("cropSidebar") as HTMLDivElement;
const processSidebar = document.getElementById("processSidebar") as HTMLDivElement;

// Palette editor elements (removed const paletteList - now defined in renderPaletteUI)
const paletteName = document.getElementById("paletteName") as HTMLInputElement;
const addPaletteColorBtn = document.getElementById("addPaletteColorBtn") as HTMLButtonElement;
const resetPaletteBtn = document.getElementById("resetPaletteBtn") as HTMLButtonElement;
const savePaletteBtn = document.getElementById("savePaletteBtn") as HTMLButtonElement;
const loadPaletteBtn = document.getElementById("loadPaletteBtn") as HTMLButtonElement;
const setDefaultPaletteBtn = document.getElementById("setDefaultPaletteBtn") as HTMLButtonElement;

console.log("Palette buttons:", { addPaletteColorBtn, resetPaletteBtn, savePaletteBtn, loadPaletteBtn, setDefaultPaletteBtn });

const processingScreen = document.getElementById("processingScreen") as HTMLDivElement;
const processCanvasContainer = document.getElementById("processCanvasContainer") as HTMLDivElement;
const processCanvas = document.getElementById("processCanvas") as HTMLCanvasElement;
const processCtx = processCanvas.getContext("2d")!;
const processSvgOverlay = document.getElementById("processSvgOverlay") as SVGSVGElement;
const processZoomInBtn = document.getElementById("processZoomInBtn") as HTMLButtonElement;
const processZoomOutBtn = document.getElementById("processZoomOutBtn") as HTMLButtonElement;
const processZoomLevel = document.getElementById("processZoomLevel") as HTMLDivElement;
const processFitToScreenBtn = document.getElementById("processFitToScreenBtn") as HTMLButtonElement;
const processStatusText = document.getElementById("processStatusText") as HTMLDivElement;

const stageCroppedBtn = document.getElementById("stageCroppedBtn") as HTMLButtonElement;
const stageExtractBlackBtn = document.getElementById("stageExtractBlackBtn") as HTMLButtonElement;
const stageSubtractBlackBtn = document.getElementById("stageSubtractBlackBtn") as HTMLButtonElement;
const stageValueBtn = document.getElementById("stageValueBtn") as HTMLButtonElement;
const stageSaturationBtn = document.getElementById("stageSaturationBtn") as HTMLButtonElement;
const stageSaturationMedianBtn = document.getElementById("stageSaturationMedianBtn") as HTMLButtonElement;
const stageHueBtn = document.getElementById("stageHueBtn") as HTMLButtonElement;
const stageHueMedianBtn = document.getElementById("stageHueMedianBtn") as HTMLButtonElement;
const stageCleanupBtn = document.getElementById("stageCleanupBtn") as HTMLButtonElement;
const stagePalettizedBtn = document.getElementById("stagePalettizedBtn") as HTMLButtonElement;
const stageMedianBtn = document.getElementById("stageMedianBtn") as HTMLButtonElement;
const colorStagesContainer = document.getElementById("colorStagesContainer") as HTMLDivElement;
const vectorOverlayContainer = document.getElementById("vectorOverlayContainer") as HTMLDivElement;

// Initialize canvas and palette modules
initCanvasElements({
  canvasContainer,
  mainCanvas,
  ctx,
  cropOverlay,
  cropCtx,
  zoomLevel,
  cropInfo,
});

initPaletteModule({
  showStatus,
  mainCanvas,
});

// Processing screen event handlers
stageCroppedBtn.addEventListener("click", () => displayProcessingStage("cropped"));
stageExtractBlackBtn.addEventListener("click", () => displayProcessingStage("extract_black"));
stageSubtractBlackBtn.addEventListener("click", () => displayProcessingStage("subtract_black"));
stageValueBtn.addEventListener("click", () => displayProcessingStage("value"));
stageSaturationBtn.addEventListener("click", () => displayProcessingStage("saturation"));
stageSaturationMedianBtn.addEventListener("click", () => displayProcessingStage("saturation_median"));
stageHueBtn.addEventListener("click", () => displayProcessingStage("hue"));
stageHueMedianBtn.addEventListener("click", () => displayProcessingStage("hue_median"));
stageCleanupBtn.addEventListener("click", () => displayProcessingStage("cleanup"));
stagePalettizedBtn.addEventListener("click", () => displayProcessingStage("palettized"));
stageMedianBtn.addEventListener("click", () => displayProcessingStage("median"));

processZoomInBtn.addEventListener("click", () => {
  state.processZoom = Math.min(10, state.processZoom * 1.2);
  updateProcessZoom();
  updateProcessTransform();
});

processZoomOutBtn.addEventListener("click", () => {
  state.processZoom = Math.max(0.1, state.processZoom / 1.2);
  updateProcessZoom();
  updateProcessTransform();
});

processFitToScreenBtn.addEventListener("click", () => {
  processFitToScreen();
});

// Navigation step click handlers
navStepFile.addEventListener("click", () => {
  if (!navStepFile.classList.contains("disabled")) {
    setMode("upload");
  }
});

navStepPage.addEventListener("click", () => {
  if (!navStepPage.classList.contains("disabled") && state.currentPdfData) {
    setMode("pageSelection");
  }
});

// Sidebar toggle
toggleToolbarBtn.addEventListener("click", () => {
  cropSidebar?.classList.toggle("collapsed");
  processSidebar?.classList.toggle("collapsed");
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
  state.currentFileId = null;
  state.currentPdfData = null;
  state.currentImage = null;
  state.cropRegion = null;
  setMode("upload");
  refreshFileList();
});

// Zoom controls
zoomInBtn.addEventListener("click", () => {
  state.zoom = Math.min(10, state.zoom * 1.2);
  updateZoom();
  updateTransform();
});

zoomOutBtn.addEventListener("click", () => {
  state.zoom /= 1.2;
  updateZoom();
  redrawCanvas();
});

fitToScreenBtn.addEventListener("click", () => {
  fitToScreen();
});

// Crop controls - crop is always active
clearCropBtn.addEventListener("click", () => {
  // Reset to default 10% margin
  if (state.currentImage) {
    setDefaultCrop(state.currentImage.width, state.currentImage.height);
    drawCropOverlay();
  }
});

processBtn.addEventListener("click", async () => {
  if (state.currentImage) {
    await startProcessing();
  }
});

// Canvas interaction
canvasContainer.addEventListener("mousedown", (e) => {
  const rect = canvasContainer.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left - state.panX) / state.zoom;
  const canvasY = (e.clientY - rect.top - state.panY) / state.zoom;
  
  // Check if clicking on a crop handle
  const handle = getCropHandleAtPoint(canvasX, canvasY);
  if (handle && state.cropRegion) {
    state.isDraggingCropHandle = true;
    state.activeCropHandle = handle;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
  } else if (!e.shiftKey) {
    // Pan with mouse drag (when not shift-clicking)
    state.isPanning = true;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    canvasContainer.classList.add("grabbing");
  }
});

canvasContainer.addEventListener("mousemove", (e) => {
  if (state.isDraggingCropHandle && state.activeCropHandle && state.cropRegion) {
    const dx = (e.clientX - state.lastPanX) / state.zoom;
    const dy = (e.clientY - state.lastPanY) / state.zoom;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    
    // Adjust crop region based on handle
    adjustCropRegion(state.activeCropHandle, dx, dy);
    drawCropOverlay();
  } else if (state.isPanning) {
    const dx = e.clientX - state.lastPanX;
    const dy = e.clientY - state.lastPanY;
    state.panX += dx;
    state.panY += dy;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    updateTransform();
  } else {
    // Update cursor based on hover
    const rect = canvasContainer.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - state.panX) / state.zoom;
    const canvasY = (e.clientY - rect.top - state.panY) / state.zoom;
    const handle = getCropHandleAtPoint(canvasX, canvasY);
    updateCursorForHandle(handle);
  }
});

canvasContainer.addEventListener("mouseup", () => {
  if (state.isDraggingCropHandle) {
    state.isDraggingCropHandle = false;
    state.activeCropHandle = null;
    // Save crop settings
    if (state.currentImage && state.cropRegion) {
      saveCropSettings(state.currentImage.width, state.currentImage.height, state.cropRegion);
      updateCropInfo();
    }
  }
  
  if (state.isPanning) {
    state.isPanning = false;
    canvasContainer.classList.remove("grabbing");
  }
});

canvasContainer.addEventListener("mouseleave", () => {
  state.isPanning = false;
  canvasContainer.classList.remove("grabbing");
});

canvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  
  // Check if this is a pinch state.zoom (ctrlKey) or two-finger pan
  const isPinchZoom = e.ctrlKey;
  
  if (isPinchZoom) {
    // Pinch to state.zoom
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate the point in canvas coordinates before state.zoom
    const canvasX = (mouseX - state.panX) / state.zoom;
    const canvasY = (mouseY - state.panY) / state.zoom;
    
    // Apply state.zoom with constant speed in log space (feels consistent at all state.zoom levels)
    // Instead of multiplying by a factor, we adjust by a fixed percentage of the current state.zoom
    const zoomSpeed = 0.01; // Adjust this to change overall state.zoom speed
    const zoomChange = -e.deltaY * zoomSpeed * state.zoom;
    const newZoom = Math.max(0.1, Math.min(20, state.zoom + zoomChange));
    
    // Adjust pan to keep the point under the mouse
    state.panX = mouseX - canvasX * newZoom;
    state.panY = mouseY - canvasY * newZoom;
    state.zoom = newZoom;
    
    updateZoom();
    updateTransform();
  } else {
    // Two-finger pan (or mouse wheel)
    state.panX -= e.deltaX;
    state.panY -= e.deltaY;
    updateTransform();
  }
});

// Processing canvas interaction
processCanvasContainer.addEventListener("mousedown", (e) => {
  state.isProcessPanning = true;
  state.lastProcessPanX = e.clientX;
  state.lastProcessPanY = e.clientY;
  processCanvasContainer.classList.add("grabbing");
});

processCanvasContainer.addEventListener("mousemove", (e) => {
  if (state.isProcessPanning) {
    const dx = e.clientX - state.lastProcessPanX;
    const dy = e.clientY - state.lastProcessPanY;
    state.processPanX += dx;
    state.processPanY += dy;
    state.lastProcessPanX = e.clientX;
    state.lastProcessPanY = e.clientY;
    updateProcessTransform();
  }
});

processCanvasContainer.addEventListener("mouseup", () => {
  if (state.isProcessPanning) {
    state.isProcessPanning = false;
    processCanvasContainer.classList.remove("grabbing");
  }
});

processCanvasContainer.addEventListener("mouseleave", () => {
  state.isProcessPanning = false;
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
    
    // Get dimensions from either processed image or vectorized image
    let width = 0, height = 0;
    const image = state.processedImages.get(state.currentStage);
    if (image) {
      width = image.width;
      height = image.height;
    } else if (state.currentStage.endsWith("_vec")) {
      const vectorized = state.vectorizedImages.get(state.currentStage);
      if (vectorized) {
        width = vectorized.width;
        height = vectorized.height;
      }
    }
    
    if (width === 0 || height === 0) return;
    
    const canvasX = (mouseX - state.processPanX) / state.processZoom;
    const canvasY = (mouseY - state.processPanY) / state.processZoom;
    
    const zoomSpeed = 0.005;
    const zoomChange = -e.deltaY * zoomSpeed * state.processZoom;
    const newZoom = Math.max(0.1, Math.min(10, state.processZoom + zoomChange));
    
    state.processPanX = mouseX - canvasX * newZoom;
    state.processPanY = mouseY - canvasY * newZoom;
    state.processZoom = newZoom;
    
    updateProcessZoom();
    updateProcessTransform();
  } else {
    // Two-finger pan (or mouse wheel)
    state.processPanX -= e.deltaX;
    state.processPanY -= e.deltaY;
    updateProcessTransform();
  }
});

// Mode management
function updateNavigation(mode: AppMode) {
  // Update navigation step states
  navStepFile.classList.remove("active", "completed", "disabled");
  navStepPage.classList.remove("active", "completed", "disabled");
  navStepConfigure.classList.remove("active", "completed", "disabled");
  
  switch (mode) {
    case "upload":
      navStepFile.classList.add("active");
      navStepPage.classList.add("disabled");
      navStepConfigure.classList.add("disabled");
      break;
    case "pageSelection":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("active");
      navStepConfigure.classList.add("disabled");
      break;
    case "crop":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("completed");
      navStepConfigure.classList.add("active");
      break;
    case "processing":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("completed");
      navStepConfigure.classList.add("completed");
      break;
  }
}

function setMode(mode: AppMode) {
  console.log("setMode called:", mode);
  
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
  
  // Update navigation
  updateNavigation(mode);
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

// Palette Storage Functions (IndexedDB)









// Initialize palette DB (default palette will be loaded only if no file is selected)
initPaletteDB();


async function handleFileUpload(file: File) {
  try {
    showStatus(`Loading: ${file.name}...`);
    
    // Save to storage if not already saved
    if (!state.currentFileId) {
      try {
        state.currentFileId = await saveFile(file);
        console.log(`File saved with ID: ${state.currentFileId}`);
        // Load default palette for new uploads
        await loadDefaultPalette();
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
      await loadImage(image, showStatus);
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
    state.currentPdfData = copy;
    console.log("loadPdf: Created copy", copy.length);
    
    const initialCopy = state.currentPdfData.slice();
    console.log("loadPdf: Calling getDocument");
    const loadingTask = pdfjsLib.getDocument({ data: initialCopy });
    const pdf = await loadingTask.promise;
    state.pdfPageCount = pdf.numPages;
    console.log("loadPdf: PDF loaded, pages:", state.pdfPageCount);
    
    showStatus(`PDF loaded: ${state.pdfPageCount} pages`);
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
    console.log("loadPdf: pageGrid cleared, adding", state.pdfPageCount, "cards");
    
    // First pass: get all page dimensions and create cards with proper aspect ratios
    const pageDimensions: Array<{width: number; height: number; pageLabel: string}> = [];
    
    // Get page labels from PDF (if available)
    let pageLabels: string[] | null = null;
    try {
      pageLabels = await pdf.getPageLabels();
    } catch (_e) {
      // Page labels not available, will use page numbers
    }
    
    for (let i = 1; i <= state.pdfPageCount; i++) {
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
      if (i === state.currentSelectedPage) {
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
    const thumbnailsToRender = Math.min(state.pdfPageCount, MAX_THUMBNAILS);
    
    // Reset cancellation flag
    state.cancelThumbnailLoading = false;
    
    (async () => {
      // Sort pages by size (largest first)
      const pagesBySize = Array.from({ length: state.pdfPageCount }, (_, i) => i)
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
      
      console.log(`[THUMBNAIL] Building render queue for ${thumbnailsToRender} thumbnails out of ${state.pdfPageCount} pages`);
      
      while (renderQueue.length < thumbnailsToRender && (sequentialIndex < state.pdfPageCount || largestIndex < pagesBySize.length)) {
        // Add next 2 sequential pages
        if (sequentialIndex < state.pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        if (sequentialIndex < state.pdfPageCount && renderQueue.length < thumbnailsToRender) {
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
        if (state.cancelThumbnailLoading) {
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
          const statusMsg = thumbnailsToRender < state.pdfPageCount 
            ? `Loading thumbnails: ${completed}/${thumbnailsToRender} (${state.pdfPageCount} pages total)`
            : `Loading thumbnails: ${completed}/${state.pdfPageCount}`;
          showStatus(statusMsg);
        } else {
          console.warn(`[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: No valid thumbnails to render`);
        }
      }
      const finalMsg = thumbnailsToRender < state.pdfPageCount
        ? `PDF loaded: ${state.pdfPageCount} pages (showing ${thumbnailsToRender} thumbnails)`
        : `PDF loaded: ${state.pdfPageCount} pages`;
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
    if (!state.currentPdfData) {
      console.warn(`[THUMBNAIL] No PDF data for page ${pageNum}(${pageLabel})`);
      return;
    }
    
    console.log(`[THUMBNAIL] START rendering page ${pageNum}(${pageLabel})`);
    const pdfDataCopy = state.currentPdfData.slice();
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
    if (!state.currentPdfData) {
      console.error("selectPdfPage: No PDF data!");
      showStatus("No PDF loaded", true);
      return;
    }
    
    // Cancel any ongoing thumbnail loading
    state.cancelThumbnailLoading = true;
    
    // Update selected page tracking
    state.currentSelectedPage = pageNum;
    
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
    const pdfDataCopy = state.currentPdfData.slice();
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
    await loadImage(image, showStatus);
    showStatus(`✓ Page ${pageNum} loaded: ${image.width}×${image.height}`);
    
    // Update thumbnail and palette in storage
    if (state.currentFileId && state.currentImage) {
      const thumbnail = generateThumbnail(state.currentImage);
      const palette = JSON.stringify(state.userPalette);
      await updateFile(state.currentFileId, { thumbnail, palette });
      await refreshFileList();
    }
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
    console.error(error);
  }
}







// Helper: Convert RGBA skeleton (grayscale) to binary format
function rgbaToBinary(rgba: RGBAImage): BinaryImage {
  const { width, height, data } = rgba;
  const numPixels = width * height;
  const byteCount = Math.ceil(numPixels / 8);
  const binaryData = new Uint8Array(byteCount);
  
  // Convert: white (255) = 0, black (0) = 1
  for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
    const r = data[pixelIndex * 4];
    
    // If pixel is black (or dark), set bit to 1
    if (r < 128) {
      const bitByteIndex = Math.floor(pixelIndex / 8);
      const bitIndex = 7 - (pixelIndex % 8); // MSB-first
      binaryData[bitByteIndex] |= (1 << bitIndex);
    }
  }
  
  return { width, height, data: binaryData };
}

// Crop management functions













// Helper: Extract a single color from palettized image to binary format
function extractColorFromPalettized(palettized: PalettizedImage, colorIndex: number): BinaryImage {
  const { width, height, data } = palettized;
  const numPixels = width * height;
  
  // Create properly bit-packed binary image
  const byteCount = Math.ceil(numPixels / 8);
  const binaryData = new Uint8Array(byteCount);
  
  for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
    const byteIndex = Math.floor(pixelIndex / 2);
    const isHighNibble = pixelIndex % 2 === 0;
    
    // Extract 4-bit color index from nibble
    const paletteIndex = isHighNibble 
      ? (data[byteIndex] >> 4) & 0x0f
      : data[byteIndex] & 0x0f;
    
    // Set bit to 1 if this pixel matches the color we're extracting
    if (paletteIndex === colorIndex) {
      const bitByteIndex = Math.floor(pixelIndex / 8);
      const bitIndex = 7 - (pixelIndex % 8); // MSB-first
      binaryData[bitByteIndex] |= (1 << bitIndex);
    }
  }
  
  return { width, height, data: binaryData };
}

// Helper: Convert Binary image to GPU buffer for processing
async function binaryToGPUBuffer(binary: BinaryImage): Promise<GPUBuffer> {
  const { device } = await getGPUContext();
  const { width, height, data } = binary;
  const numPixels = width * height;
  
  // Binary data is already bit-packed (8 pixels per byte, MSB-first)
  // Convert to packed binary format for GPU (32 pixels per u32)
  const numWords = Math.ceil(numPixels / 32);
  const packed = new Uint32Array(numWords);
  
  for (let i = 0; i < numPixels; i++) {
    // Read bit from bit-packed data
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8); // MSB-first
    const bit = (data[byteIdx] >> bitIdx) & 1;
    
    if (bit) {
      const wordIdx = Math.floor(i / 32);
      const bitInWord = i % 32;
      packed[wordIdx] |= 1 << bitInWord;
    }
  }
  
  // Create and fill GPU buffer
  const buffer = createGPUBuffer(
    device,
    packed,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  
  return buffer;
}

// Processing mode functions
async function startProcessing() {
  if (!state.currentImage) return;
  
  try {
    setMode("processing");
    state.processedImages.clear();
    state.processViewInitialized = false; // Reset for new processing session
    
    // Apply crop if selected
    let processImage = state.currentImage;
    if (state.cropRegion && state.cropRegion.width > 0 && state.cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(state.currentImage, state.cropRegion);
    }
    
    // Store and display cropped image
    state.processedImages.set("cropped", processImage);
    displayProcessingStage("cropped");
    
    // Extract black from cropped image
    showStatus("Extracting black...");
    const extractBlackStart = performance.now();
    const extractedBlack = await extractBlackGPU(processImage, 0.20);
    const extractBlackEnd = performance.now();
    showStatus(`Extract black: ${(extractBlackEnd - extractBlackStart).toFixed(1)}ms`);
    
    state.processedImages.set("extract_black", extractedBlack);
    displayProcessingStage("extract_black");
    
    // Process color_1: median filter and skeletonize
    const color1Buffer = await binaryToGPUBuffer(extractedBlack);
    const color1SkelResults = await processValueChannel(
      color1Buffer,
      extractedBlack.width,
      extractedBlack.height
    );
    
    // Store median-filtered version as color_1, skeletonized as color_1_skel
    state.processedImages.set("color_1", color1SkelResults.median);
    state.processedImages.set("color_1_skel", color1SkelResults.skeleton);
    
    color1Buffer.destroy();
    color1SkelResults.skeletonBuffer.destroy();
    
    // Apply bloom filter to extracted black
    showStatus("Applying bloom filter...");
    const bloomStart = performance.now();
    const bloomFiltered = await bloomFilter3x3GPU(extractedBlack);
    const bloomEnd = performance.now();
    showStatus(`Bloom filter: ${(bloomEnd - bloomStart).toFixed(1)}ms`);
    
    // Subtract black from cropped image
    showStatus("Subtracting black...");
    const subtractStart = performance.now();
    const subtractedImage = await subtractBlackGPU(processImage, bloomFiltered);
    const subtractEnd = performance.now();
    showStatus(`Subtract black: ${(subtractEnd - subtractStart).toFixed(1)}ms`);
    state.processedImages.set("subtract_black", subtractedImage);
    displayProcessingStage("subtract_black");
    
    // Use subtracted image for further processing
    processImage = subtractedImage;
    
    // Run GPU pipeline with auto-advance after each stage
    showStatus("Running cleanup (extracting channels)...");
    const t1 = performance.now();
    const cleanupResults = await cleanupGPU(processImage);
    const t2 = performance.now();
    showStatus(`Cleanup: ${(t2 - t1).toFixed(1)}ms`);
    
    // Store all intermediate cleanup stages
    state.processedImages.set("value", cleanupResults.value);
    state.processedImages.set("saturation", cleanupResults.saturation);
    state.processedImages.set("saturation_median", cleanupResults.saturationMedian);
    state.processedImages.set("hue", cleanupResults.hue);
    state.processedImages.set("hue_median", cleanupResults.hueMedian);
    
    // Recombine with thresholded value (no skeletonization yet)
    showStatus("Recombining channels...");
    const t2d = performance.now();
    const cleanupFinal = await recombineWithValue(
        cleanupResults.valueBuffer,
        cleanupResults.saturationBuffer,
        cleanupResults.hueBuffer,
        cleanupResults.width,
        cleanupResults.height
    );
    const t2e = performance.now();
    showStatus(`Recombine: ${(t2e - t2d).toFixed(1)}ms`);
    state.processedImages.set("cleanup", cleanupFinal);
    displayProcessingStage("cleanup");
    
    // Clean up buffers now that we're done with them
    cleanupResults.valueBuffer.destroy();
    cleanupResults.saturationBuffer.destroy();
    cleanupResults.hueBuffer.destroy();
    
    showStatus("Palettizing...");
    const t3 = performance.now();
    const inputPalette = buildPaletteRGBA(); // Input colors for matching
    const palettized = await palettizeGPU(cleanupFinal, inputPalette);
    
    // Replace palette with output colors (after matching is done)
    const outputPalette = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < state.userPalette.length && i < 16; i++) {
      const color = state.userPalette[i];
      // Use output color, or background if marked for removal
      const useColor = color.mapToBg ? state.userPalette[0].outputColor : color.outputColor;
      const [r, g, b, a] = hexToRGBA(useColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    for (let i = state.userPalette.length; i < 16; i++) {
      const [r, g, b, a] = hexToRGBA(state.userPalette[0].outputColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    
    // Convert to Uint32Array for palette storage
    const outputPaletteU32 = new Uint32Array(16);
    const outputView = new DataView(outputPalette.buffer, outputPalette.byteOffset, outputPalette.byteLength);
    for (let i = 0; i < 16; i++) {
      outputPaletteU32[i] = outputView.getUint32(i * 4, true); // little-endian
    }
    palettized.palette = outputPaletteU32;
    
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    state.processedImages.set("palettized", palettized);
    displayProcessingStage("palettized");
    
    // Apply median filter right after palettization (3 passes for aggressive cleaning)
    showStatus("Applying median filter (pass 1/3)...");
    const t4b = performance.now();
    let median = await median3x3GPU(palettized);
    showStatus("Applying median filter (pass 2/3)...");
    median = await median3x3GPU(median);
    showStatus("Applying median filter (pass 3/3)...");
    median = await median3x3GPU(median);
    const t4c = performance.now();
    showStatus(`Median filter (3 passes): ${(t4c - t4b).toFixed(1)}ms`);
    state.processedImages.set("median", median);
    displayProcessingStage("median");
    
    // Process each non-background, non-removed color separately
    showStatus("Processing individual colors...");
    const t5 = performance.now();
    for (let i = 1; i < state.userPalette.length && i < 16; i++) {
      const color = state.userPalette[i];
      if (color.mapToBg) continue; // Skip removed colors
      if (i === 1) continue; // Skip color_1 - already processed as extracted black
      
      showStatus(`Processing color ${i}...`);
      
      // Extract this color as binary from median-filtered image
      const colorBinary = extractColorFromPalettized(median, i);
      state.processedImages.set(`color_${i}`, colorBinary);
      
      // Convert to GPU buffer and run skeletonization
      const colorBuffer = await binaryToGPUBuffer(colorBinary);
      const skelResults = await processValueChannel(
        colorBuffer,
        colorBinary.width,
        colorBinary.height
      );
      
      // Store skeletonized result
      state.processedImages.set(`color_${i}_skel`, skelResults.skeleton);
      
      // Clean up
      colorBuffer.destroy();
      skelResults.skeletonBuffer.destroy();
    }
    const t6 = performance.now();
    showStatus(`Per-color processing: ${(t6 - t5).toFixed(1)}ms`);
    
    // Add dynamic stage buttons for each color
    addColorStageButtons();
    
    const totalTime = t6 - t1;
    showStatus(`✓ Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
    console.error(error);
  }
}

// Add dynamic color stage buttons after processing
function addColorStageButtons() {
  // Clear existing color buttons
  colorStagesContainer.innerHTML = "";
  vectorOverlayContainer.innerHTML = "";
  
  // Add a button for each non-background, non-removed color
  for (let i = 1; i < state.userPalette.length && i < 16; i++) {
    const color = state.userPalette[i];
    if (color.mapToBg) continue; // Skip removed colors
    
    // Check if this color stage exists
    if (!state.processedImages.has(`color_${i}`)) continue;
    
    // Color button
    const colorBtn = document.createElement("button");
    colorBtn.className = "stage-btn";
    colorBtn.textContent = `Color ${i}`;
    colorBtn.style.borderLeft = `4px solid ${color.outputColor}`;
    colorBtn.addEventListener("click", () => displayProcessingStage(`color_${i}`));
    colorStagesContainer.appendChild(colorBtn);
    
    // Skeleton button (if it exists)
    if (state.processedImages.has(`color_${i}_skel`)) {
      const skelBtn = document.createElement("button");
      skelBtn.className = "stage-btn";
      skelBtn.textContent = `Color ${i} Skel`;
      skelBtn.style.borderLeft = `4px solid ${color.outputColor}`;
      skelBtn.dataset.stage = `color_${i}_skel`;
      skelBtn.addEventListener("click", () => displayProcessingStage(`color_${i}_skel`));
      colorStagesContainer.appendChild(skelBtn);
      
      // Vector overlay toggle button
      const vecStage = `color_${i}_vec`;
      const vecToggle = document.createElement("button");
      vecToggle.className = "stage-btn";
      vecToggle.textContent = `Color ${i} Vec`;
      vecToggle.style.borderLeft = `4px solid ${color.outputColor}`;
      vecToggle.dataset.stage = vecStage;
      vecToggle.addEventListener("click", () => toggleVectorOverlay(vecStage));
      vectorOverlayContainer.appendChild(vecToggle);
    }
  }
}

function toggleVectorOverlay(vecStage: string) {
  // If clicking the same overlay, toggle it off
  if (state.vectorOverlayEnabled && state.vectorOverlayStage === vecStage) {
    state.vectorOverlayEnabled = false;
    state.vectorOverlayStage = null;
    processSvgOverlay.style.display = "none";
    updateVectorOverlayButtons();
    showStatus("Vector overlay hidden");
    return;
  }
  
  // Check if we need to vectorize
  let vectorized = state.vectorizedImages.get(vecStage);
  
  if (!vectorized) {
    // Vectorize on-demand
    const skelStage = vecStage.replace("_vec", "_skel") as ProcessingStage;
    const skelImage = state.processedImages.get(skelStage);
    
    if (!skelImage) {
      showStatus(`Skeleton stage ${skelStage} not available`, true);
      return;
    }
    
    // Convert skeleton to binary format if needed
    let binaryImage: BinaryImage;
    const expectedBinaryLength = Math.ceil(skelImage.width * skelImage.height / 8);
    
    if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
      console.log(`Converting ${skelStage} from RGBA to binary format`);
      binaryImage = rgbaToBinary(skelImage as RGBAImage);
    } else if (skelImage.data instanceof Uint8Array && skelImage.data.length === expectedBinaryLength) {
      binaryImage = skelImage as BinaryImage;
    } else {
      showStatus(`${skelStage} has unexpected format`, true);
      return;
    }
    
    showStatus(`Vectorizing ${skelStage}...`);
    const vectorizeStart = performance.now();
    vectorized = vectorizeSkeleton(binaryImage);
    state.vectorizedImages.set(vecStage, vectorized);
    const vectorizeEnd = performance.now();
    console.log(`Vectorized: ${vectorized.paths.length} paths, ${vectorized.vertices.size} vertices (${(vectorizeEnd - vectorizeStart).toFixed(1)}ms)`);
  }
  
  // Enable overlay
  state.vectorOverlayEnabled = true;
  state.vectorOverlayStage = vecStage;
  
  // Render SVG overlay
  const currentImage = state.processedImages.get(state.currentStage);
  if (currentImage) {
    renderVectorizedToSVG(vectorized, processSvgOverlay, currentImage.width, currentImage.height);
    processSvgOverlay.style.display = "block";
  }
  
  updateVectorOverlayButtons();
  showStatus(`Vector overlay: ${vectorized.paths.length} paths, ${vectorized.vertices.size} vertices`);
}

function updateVectorOverlayButtons() {
  vectorOverlayContainer.querySelectorAll(".stage-btn").forEach(btn => {
    const btnStage = (btn as HTMLElement).dataset.stage;
    if (btnStage === state.vectorOverlayStage && state.vectorOverlayEnabled) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function displayProcessingStage(stage: ProcessingStage) {
  // Check if this is a vectorized stage
  if (stage.endsWith("_vec")) {
    // Check if we already have it vectorized
    let vectorized = state.vectorizedImages.get(stage);
    
    if (!vectorized) {
      // Need to vectorize on-demand
      const skelStage = stage.replace("_vec", "_skel") as ProcessingStage;
      const skelImage = state.processedImages.get(skelStage);
      
      if (!skelImage) {
        showStatus(`Skeleton stage ${skelStage} not available`, true);
        return;
      }
      
      // Convert skeleton to binary format if needed
      let binaryImage: BinaryImage;
      const expectedBinaryLength = Math.ceil(skelImage.width * skelImage.height / 8);
      
      if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
        // RGBA format - convert to binary
        console.log(`Converting ${skelStage} from RGBA to binary format`);
        binaryImage = rgbaToBinary(skelImage as RGBAImage);
      } else if (skelImage.data instanceof Uint8Array && skelImage.data.length === expectedBinaryLength) {
        // Already binary format
        binaryImage = skelImage as BinaryImage;
      } else {
        showStatus(`${skelStage} has unexpected format`, true);
        console.error(`Unexpected format:`, {
          dataType: skelImage.data?.constructor?.name,
          actualLength: skelImage.data.length,
          expectedRGBA: skelImage.width * skelImage.height * 4,
          expectedBinary: expectedBinaryLength
        });
        return;
      }
      
      // Vectorize now
      showStatus(`Vectorizing ${skelStage}...`);
      const vectorizeStart = performance.now();
      vectorized = vectorizeSkeleton(binaryImage);
      state.vectorizedImages.set(stage, vectorized);
      const vectorizeEnd = performance.now();
      showStatus(`Vectorized: ${vectorized.paths.length} paths, ${vectorized.vertices.size} vertices (${(vectorizeEnd - vectorizeStart).toFixed(1)}ms)`);
    }
    
    state.currentStage = stage;
    
    // Update stage button states
    document.querySelectorAll(".stage-btn").forEach(btn => btn.classList.remove("active"));
    const btn = Array.from(document.querySelectorAll(".stage-btn")).find(
      b => (b as HTMLElement).dataset.stage === stage
    );
    btn?.classList.add("active");
    
    // First, display the skeleton image on canvas
    const skelStage = stage.replace("_vec", "_skel") as ProcessingStage;
    const skelImage = state.processedImages.get(skelStage);
    if (skelImage) {
      // Render skeleton to canvas
      processCanvas.width = skelImage.width;
      processCanvas.height = skelImage.height;
      
      // Convert to RGBA for display
      let rgbaData: Uint8ClampedArray;
      if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
        rgbaData = skelImage.data;
      } else {
        // Convert binary to RGBA
        const numPixels = skelImage.width * skelImage.height;
        rgbaData = new Uint8ClampedArray(numPixels * 4);
        for (let i = 0; i < numPixels; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitIndex = 7 - (i % 8);
          const bit = (skelImage.data[byteIndex] >> bitIndex) & 1;
          const value = bit ? 0 : 255;
          rgbaData[i * 4] = value;
          rgbaData[i * 4 + 1] = value;
          rgbaData[i * 4 + 2] = value;
          rgbaData[i * 4 + 3] = 255;
        }
      }
      
      const imageData = new ImageData(rgbaData, skelImage.width, skelImage.height);
      processCtx.putImageData(imageData, 0, 0);
    }
    
    // Then overlay the vectorized paths as SVG
    renderVectorizedToSVG(vectorized, processSvgOverlay);
    
    // Fit to screen on first display
    if (!state.processViewInitialized) {
      processFitToScreen();
      state.processViewInitialized = true;
    } else {
      updateProcessTransform();
    }
    
    showStatus(`Viewing: ${stage} (${vectorized.paths.length} paths, ${vectorized.vertices.size} vertices)`);
    return;
  }
  
  const image = state.processedImages.get(stage);
  if (!image) {
    showStatus(`Stage ${stage} not available`, true);
    return;
  }
  
  state.currentStage = stage;
  
  // Re-render vector overlay if it's enabled (over the new stage)
  if (state.vectorOverlayEnabled && state.vectorOverlayStage) {
    const vectorized = state.vectorizedImages.get(state.vectorOverlayStage);
    if (vectorized) {
      renderVectorizedToSVG(vectorized, processSvgOverlay, image.width, image.height);
      processSvgOverlay.style.display = "block";
    }
  }
  
  // Update stage button states
  document.querySelectorAll(".stage-btn").forEach(btn => btn.classList.remove("active"));
  
  // Handle dynamic color stage buttons
  if (typeof stage === "string" && (stage.startsWith("color_"))) {
    const btn = Array.from(document.querySelectorAll(".stage-btn")).find(
      b => (b as HTMLElement).textContent?.toLowerCase().replace(" ", "_").includes(stage)
    );
    btn?.classList.add("active");
  } else {
    // Static stage buttons
    const stageButtons: Partial<Record<BaseProcessingStage, HTMLButtonElement>> = {
      cropped: stageCroppedBtn,
      extract_black: stageExtractBlackBtn,
      subtract_black: stageSubtractBlackBtn,
      value: stageValueBtn,
      saturation: stageSaturationBtn,
      saturation_median: stageSaturationMedianBtn,
      hue: stageHueBtn,
      hue_median: stageHueMedianBtn,
      cleanup: stageCleanupBtn,
      palettized: stagePalettizedBtn,
      median: stageMedianBtn,
    };
    const baseStage = stage as BaseProcessingStage;
    stageButtons[baseStage]?.classList.add("active");
  }
  
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
      
      // Look up RGBA color in palette (stored as Uint32Array - need to unpack)
      const pixelOffset = pixelIndex * 4;
      const packedColor = image.palette[colorIndex];
      
      // Unpack RGBA from 32-bit value (little-endian: ABGR)
      rgbaData[pixelOffset] = packedColor & 0xff;           // R
      rgbaData[pixelOffset + 1] = (packedColor >> 8) & 0xff;  // G
      rgbaData[pixelOffset + 2] = (packedColor >> 16) & 0xff; // B
      rgbaData[pixelOffset + 3] = (packedColor >> 24) & 0xff; // A
    }
  } else if (image.data instanceof Uint8Array && image.data.length === Math.ceil(image.width * image.height / 8)) {
    // BinaryImage - convert bit-packed 1-bit to RGBA (0=white, 1=black)
    rgbaData = new Uint8ClampedArray(image.width * image.height * 4);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const pixelIndex = y * image.width + x;
        const byteIndex = Math.floor(pixelIndex / 8);
        const bitIndex = 7 - (pixelIndex % 8); // MSB-first
        const bitValue = (image.data[byteIndex] >> bitIndex) & 1;
        const value = bitValue ? 0 : 255; // 1=black, 0=white
        const offset = pixelIndex * 4;
        rgbaData[offset] = value;
        rgbaData[offset + 1] = value;
        rgbaData[offset + 2] = value;
        rgbaData[offset + 3] = 255;
      }
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
  
  // Only fit to screen on first display, then preserve state.zoom/pan
  if (!state.processViewInitialized) {
    processFitToScreen();
    state.processViewInitialized = true;
  } else {
    updateProcessTransform();
  }
  
  showStatus(`Viewing: ${stage} (${image.width}×${image.height})`);
}

function processFitToScreen() {
  // Get dimensions from either processed image or vectorized image
  let imageWidth = 0, imageHeight = 0;
  const image = state.processedImages.get(state.currentStage);
  if (image) {
    imageWidth = image.width;
    imageHeight = image.height;
  } else if (state.currentStage.endsWith("_vec")) {
    const vectorized = state.vectorizedImages.get(state.currentStage);
    if (vectorized) {
      imageWidth = vectorized.width;
      imageHeight = vectorized.height;
    }
  }
  
  if (imageWidth === 0 || imageHeight === 0) return;
  
  const containerWidth = processCanvasContainer.clientWidth;
  const containerHeight = processCanvasContainer.clientHeight;
  
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  state.processZoom = Math.min(scaleX, scaleY) * 0.9;
  
  state.processPanX = (containerWidth - imageWidth * state.processZoom) / 2;
  state.processPanY = (containerHeight - imageHeight * state.processZoom) / 2;
  
  updateProcessZoom();
  updateProcessTransform();
}

function updateProcessZoom() {
  processZoomLevel.textContent = `${Math.round(state.processZoom * 100)}%`;
}

function updateProcessTransform() {
  const transform = `translate(${state.processPanX}px, ${state.processPanY}px) scale(${state.processZoom})`;
  processCanvas.style.transform = transform;
  processCanvas.style.transformOrigin = "0 0";
  processCanvas.style.willChange = "transform";
  
  // Apply same transform to SVG overlay
  processSvgOverlay.style.transform = transform;
  processSvgOverlay.style.transformOrigin = "0 0";
  processSvgOverlay.style.willChange = "transform";
  
  if (state.processZoom >= 1) {
    processCanvas.style.imageRendering = "pixelated";
  } else {
    processCanvas.style.imageRendering = "auto";
  }
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
    if (file.id === state.currentFileId) {
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
        if (file.id === state.currentFileId) {
          state.currentFileId = null;
          state.currentPdfData = null;
          state.currentImage = null;
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
  
  state.currentFileId = id;
  
  // Restore palette if saved, otherwise load default
  if (stored.palette) {
    try {
      const savedPalette = JSON.parse(stored.palette);
      state.userPalette.length = 0;
      state.userPalette.push(...savedPalette);
      renderPaletteUI();
      console.log("Restored saved palette with", savedPalette.length, "colors");
    } catch (err) {
      console.error("Failed to restore palette:", err);
      await loadDefaultPalette();
    }
  } else {
    // No saved palette, load default
    await loadDefaultPalette();
  }
  
  const data = new Uint8Array(stored.data);
  const blob = new Blob([data], { type: stored.type });
  const file = new File([blob], stored.name, { type: stored.type });
  
  await refreshFileList();
  await handleFileUpload(file);
}

// Palette Editor Functions

// Color Editor Panel - opens when clicking a palette color















// Convert state.userPalette to RGBA format for GPU processing

// Palette editor event handlers
console.log("Setting up palette event listeners...");
if (addPaletteColorBtn) {
  addPaletteColorBtn.addEventListener("click", () => {
    console.log("Add button clicked!");
    addPaletteColor();
  });
} else {
  console.error("addPaletteColorBtn not found!");
}

if (resetPaletteBtn) {
  resetPaletteBtn.addEventListener("click", () => {
    console.log("Reset button clicked!");
    resetPaletteToDefault();
  });
} else {
  console.error("resetPaletteBtn not found!");
}

if (savePaletteBtn) {
  savePaletteBtn.addEventListener("click", () => {
    const name = paletteName.value;
    savePalette(name);
  });
}

if (loadPaletteBtn) {
  loadPaletteBtn.addEventListener("click", () => {
    loadPalette();
  });
}

if (setDefaultPaletteBtn) {
  setDefaultPaletteBtn.addEventListener("click", () => {
    setDefaultPalette();
  });
}

// Canvas click handler for eyedropper
mainCanvas.addEventListener("click", (e: MouseEvent) => {
  if (isEyedropperActive()) {
    pickColorFromCanvas(e.clientX, e.clientY);
  }
});

// ESC key to cancel eyedropper
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && isEyedropperActive()) {
    forceDeactivateEyedropper();
  }
});

// Initialize palette UI on load
renderPaletteUI();
