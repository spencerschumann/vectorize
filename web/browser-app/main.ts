// Browser application entry point - New UI
import { loadImageFromFile } from "../src/pdf/image_load.ts";
import { renderPdfPage } from "../src/pdf/pdf_render.ts";
import type { CanvasBackend } from "../src/pdf/pdf_render.ts";
import { cleanupGPU, recombineWithValue, type CleanupResults } from "../src/gpu/cleanup_gpu.ts";
import { processValueChannel } from "../src/gpu/value_process_gpu.ts";
import { palettizeGPU } from "../src/gpu/palettize_gpu.ts";
import { median3x3GPU } from "../src/gpu/median_gpu.ts";
import { extractBlackGPU } from "../src/gpu/extract_black_gpu.ts";
import { bloomFilter3x3GPU } from "../src/gpu/bloom_gpu.ts";
import { subtractBlackGPU } from "../src/gpu/subtract_black_gpu.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "../src/gpu/gpu_context.ts";
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
// Base processing stages
type BaseProcessingStage = 
  | "cropped" 
  | "extract_black"
  | "subtract_black"
  | "value" 
  | "saturation" 
  | "saturation_median" 
  | "hue" 
  | "hue_median" 
  | "cleanup" 
  | "palettized" 
  | "median";

// Dynamic stages: color_0, color_0_skel, color_1, color_1_skel, etc.
type ProcessingStage = BaseProcessingStage | string;

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

// Palette storage variables
let currentPaletteName = "";
let defaultPaletteName = "";

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
const statusText = document.getElementById("statusText") as HTMLDivElement;
const resultsPanel = document.getElementById("resultsPanel") as HTMLDivElement;
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

// Navigation step click handlers
navStepFile.addEventListener("click", () => {
  if (!navStepFile.classList.contains("disabled")) {
    setMode("upload");
  }
});

navStepPage.addEventListener("click", () => {
  if (!navStepPage.classList.contains("disabled") && currentPdfData) {
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
  currentFileId = null;
  currentPdfData = null;
  currentImage = null;
  cropRegion = null;
  setMode("upload");
  refreshFileList();
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
    const zoomSpeed = 0.01; // Adjust this to change overall zoom speed
    const zoomChange = -e.deltaY * zoomSpeed * zoom;
    const newZoom = Math.max(0.1, Math.min(20, zoom + zoomChange));
    
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
async function initPaletteDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("VectorizerPalettes", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("palettes")) {
        db.createObjectStore("palettes", { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
  });
}

async function savePalette(name: string) {
  if (!name.trim()) {
    showStatus("Please enter a palette name", true);
    return;
  }
  
  const db = await initPaletteDB();
  const transaction = db.transaction(["palettes"], "readwrite");
  const store = transaction.objectStore("palettes");
  
  const paletteData = {
    name: name.trim(),
    colors: userPalette.map(c => ({ ...c })),
    timestamp: Date.now()
  };
  
  await store.put(paletteData);
  currentPaletteName = name.trim();
  showStatus(`Palette "${name}" saved`);
}

async function loadPalette(name?: string) {
  const db = await initPaletteDB();
  
  if (!name) {
    // Show palette picker
    const transaction = db.transaction(["palettes"], "readonly");
    const store = transaction.objectStore("palettes");
    const request = store.getAllKeys();
    
    request.onsuccess = () => {
      const names = request.result as string[];
      if (names.length === 0) {
        showStatus("No saved palettes found", true);
        return;
      }
      
      const selected = prompt(`Select palette:\n${names.join("\n")}`);
      if (selected && names.includes(selected)) {
        loadPalette(selected);
      }
    };
    return;
  }
  
  const transaction = db.transaction(["palettes"], "readonly");
  const store = transaction.objectStore("palettes");
  const request = store.get(name);
  
  request.onsuccess = () => {
    const data = request.result;
    if (data) {
      userPalette.length = 0;
      data.colors.forEach((c: PaletteColor) => userPalette.push({ ...c }));
      currentPaletteName = name;
      renderPaletteUI();
      showStatus(`Palette "${name}" loaded`);
      
      // Update palette name input
      const paletteNameInput = document.getElementById("paletteName") as HTMLInputElement;
      if (paletteNameInput) paletteNameInput.value = name;
    } else {
      showStatus(`Palette "${name}" not found`, true);
    }
  };
}

async function setDefaultPalette() {
  if (!currentPaletteName) {
    showStatus("Please save the palette first", true);
    return;
  }
  
  const db = await initPaletteDB();
  const transaction = db.transaction(["settings"], "readwrite");
  const store = transaction.objectStore("settings");
  
  await store.put({ key: "defaultPalette", value: currentPaletteName });
  defaultPaletteName = currentPaletteName;
  showStatus(`"${currentPaletteName}" set as default palette`);
}

async function loadDefaultPalette() {
  const db = await initPaletteDB();
  const transaction = db.transaction(["settings"], "readonly");
  const store = transaction.objectStore("settings");
  const request = store.get("defaultPalette");
  
  request.onsuccess = () => {
    const data = request.result;
    if (data && data.value) {
      defaultPaletteName = data.value;
      loadPalette(data.value);
    }
  };
}

// Initialize default palette on load
initPaletteDB().then(() => loadDefaultPalette());


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
    
    // Extract black from cropped image
    showStatus("Extracting black...");
    const extractBlackStart = performance.now();
    const extractedBlack = await extractBlackGPU(processImage, 0.20);
    const extractBlackEnd = performance.now();
    showStatus(`Extract black: ${(extractBlackEnd - extractBlackStart).toFixed(1)}ms`);
    
    processedImages.set("extract_black", extractedBlack);
    displayProcessingStage("extract_black");
    
    // Process color_1: median filter and skeletonize
    const color1Buffer = await binaryToGPUBuffer(extractedBlack);
    const color1SkelResults = await processValueChannel(
      color1Buffer,
      extractedBlack.width,
      extractedBlack.height
    );
    
    // Store median-filtered version as color_1, skeletonized as color_1_skel
    processedImages.set("color_1", color1SkelResults.median);
    processedImages.set("color_1_skel", color1SkelResults.skeleton);
    
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
    processedImages.set("subtract_black", subtractedImage);
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
    processedImages.set("value", cleanupResults.value);
    processedImages.set("saturation", cleanupResults.saturation);
    processedImages.set("saturation_median", cleanupResults.saturationMedian);
    processedImages.set("hue", cleanupResults.hue);
    processedImages.set("hue_median", cleanupResults.hueMedian);
    
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
    processedImages.set("cleanup", cleanupFinal);
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
    for (let i = 0; i < userPalette.length && i < 16; i++) {
      const color = userPalette[i];
      // Use output color, or background if marked for removal
      const useColor = color.mapToBg ? userPalette[0].outputColor : color.outputColor;
      const [r, g, b, a] = hexToRGBA(useColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    for (let i = userPalette.length; i < 16; i++) {
      const [r, g, b, a] = hexToRGBA(userPalette[0].outputColor);
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
    processedImages.set("palettized", palettized);
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
    processedImages.set("median", median);
    displayProcessingStage("median");
    
    // Process each non-background, non-removed color separately
    showStatus("Processing individual colors...");
    const t5 = performance.now();
    for (let i = 1; i < userPalette.length && i < 16; i++) {
      const color = userPalette[i];
      if (color.mapToBg) continue; // Skip removed colors
      if (i === 1) continue; // Skip color_1 - already processed as extracted black
      
      showStatus(`Processing color ${i}...`);
      
      // Extract this color as binary from median-filtered image
      const colorBinary = extractColorFromPalettized(median, i);
      processedImages.set(`color_${i}`, colorBinary);
      
      // Convert to GPU buffer and run skeletonization
      const colorBuffer = await binaryToGPUBuffer(colorBinary);
      const skelResults = await processValueChannel(
        colorBuffer,
        colorBinary.width,
        colorBinary.height
      );
      
      // Store skeletonized result
      processedImages.set(`color_${i}_skel`, skelResults.skeleton);
      
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
  
  // Add a button for each non-background, non-removed color
  for (let i = 1; i < userPalette.length && i < 16; i++) {
    const color = userPalette[i];
    if (color.mapToBg) continue; // Skip removed colors
    
    // Check if this color stage exists
    if (!processedImages.has(`color_${i}`)) continue;
    
    // Color button
    const colorBtn = document.createElement("button");
    colorBtn.className = "stage-btn";
    colorBtn.textContent = `Color ${i}`;
    colorBtn.style.borderLeft = `4px solid ${color.outputColor}`;
    colorBtn.addEventListener("click", () => displayProcessingStage(`color_${i}`));
    colorStagesContainer.appendChild(colorBtn);
    
    // Skeleton button (if it exists)
    if (processedImages.has(`color_${i}_skel`)) {
      const skelBtn = document.createElement("button");
      skelBtn.className = "stage-btn";
      skelBtn.textContent = `Color ${i} Skel`;
      skelBtn.style.borderLeft = `4px solid ${color.outputColor}`;
      skelBtn.addEventListener("click", () => displayProcessingStage(`color_${i}_skel`));
      colorStagesContainer.appendChild(skelBtn);
    }
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
  console.log("renderPaletteUI called, userPalette length:", userPalette.length);
  // Render compact display in sidebar with colors and hex values
  const paletteDisplay = document.getElementById("paletteDisplay") as HTMLDivElement;
  console.log("paletteDisplay element:", paletteDisplay);
  if (!paletteDisplay) {
    console.error("paletteDisplay not found in DOM!");
    return;
  }
  paletteDisplay.innerHTML = "";
  
  userPalette.forEach((color, index) => {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-bottom: 1px solid #3a3a3a; cursor: pointer; transition: background 0.2s;";
    item.onmouseover = () => item.style.background = "#333";
    item.onmouseout = () => item.style.background = "transparent";
    item.onclick = () => openColorEditor(index);
    
    // Input color swatch
    const inputSwatch = document.createElement("div");
    inputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.inputColor}; flex-shrink: 0;`;
    item.appendChild(inputSwatch);
    
    // Status indicator and output
    if (color.mapToBg) {
      const statusIcon = document.createElement("span");
      statusIcon.textContent = "✕";
      statusIcon.style.cssText = "font-size: 0.9rem; color: #ef4444; flex-shrink: 0; width: 16px; text-align: center;";
      statusIcon.title = "Remove";
      item.appendChild(statusIcon);
    } else if (color.inputColor.toLowerCase() !== color.outputColor.toLowerCase()) {
      const arrow = document.createElement("span");
      arrow.textContent = "→";
      arrow.style.cssText = "font-size: 0.9rem; color: #999; flex-shrink: 0;";
      item.appendChild(arrow);
      
      const outputSwatch = document.createElement("div");
      outputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.outputColor}; flex-shrink: 0;`;
      item.appendChild(outputSwatch);
    }
    
    // Hex value
    const hexLabel = document.createElement("div");
    hexLabel.style.cssText = "font-family: 'Courier New', monospace; font-size: 0.8rem; color: #aaa; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;";
    hexLabel.textContent = color.inputColor.toUpperCase();
    hexLabel.title = color.inputColor.toUpperCase();
    item.appendChild(hexLabel);
    
    // Index indicator
    if (index === 0) {
      const bgLabel = document.createElement("span");
      bgLabel.textContent = "BG";
      bgLabel.style.cssText = "font-size: 0.7rem; color: #4f46e5; font-weight: 600; flex-shrink: 0; padding: 0.1rem 0.3rem; background: rgba(79, 70, 229, 0.2); border-radius: 3px;";
      item.appendChild(bgLabel);
    }
    
    paletteDisplay.appendChild(item);
  });
}

// Color Editor Panel - opens when clicking a palette color
let colorEditorIndex: number | null = null;
let eyedropperMode: 'input' | 'output' | null = null;

function openColorEditor(index: number) {
  colorEditorIndex = index;
  const color = userPalette[index];
  
  // Create or get color editor modal
  let modal = document.getElementById("colorEditorModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "colorEditorModal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px);
      z-index: 3000; display: flex; align-items: center; justify-content: center;
    `;
    document.body.appendChild(modal);
  }
  
  modal.innerHTML = `
    <div style="background: #1a1a1a; border: 2px solid #4f46e5; border-radius: 8px; padding: 1.5rem; min-width: 400px; max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="margin: 0; color: #fff;">Edit Color ${index}${index === 0 ? ' (Background)' : ''}</h3>
        <button id="closeColorEditor" style="background: none; border: none; color: #999; font-size: 1.5rem; cursor: pointer; padding: 0; width: 32px; height: 32px;">×</button>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- Input Color -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Input Color (from document)</label>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.inputColor}; flex-shrink: 0;"></div>
            <input type="text" id="inputColorHex" value="${color.inputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperInput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">💧</button>
          </div>
        </div>
        
        <!-- Output Options -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Output (in vectorized result)</label>
          
          <div style="display: flex; gap: 0.75rem; margin-bottom: 0.5rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="same" ${!color.mapToBg && color.inputColor === color.outputColor ? 'checked' : ''} style="cursor: pointer;">
              <span>Keep same color</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="different" ${!color.mapToBg && color.inputColor !== color.outputColor ? 'checked' : ''} style="cursor: pointer;">
              <span>Transform to:</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="remove" ${color.mapToBg ? 'checked' : ''} style="cursor: pointer;">
              <span style="color: #ef4444;">Remove</span>
            </label>
          </div>
          
          <div id="outputColorSection" style="display: flex; gap: 0.5rem; align-items: center; ${color.mapToBg || color.inputColor === color.outputColor ? 'opacity: 0.4; pointer-events: none;' : ''}">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.outputColor}; flex-shrink: 0;"></div>
            <input type="text" id="outputColorHex" value="${color.outputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperOutput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">💧</button>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button id="saveColorEdit" style="flex: 1; padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: 600;">Save</button>
          ${index !== 0 ? '<button id="deleteColor" style="padding: 0.75rem 1.25rem; background: #ef4444; border: none; border-radius: 4px; color: white; cursor: pointer;">Delete</button>' : ''}
          <button id="cancelColorEdit" style="padding: 0.75rem 1.25rem; background: #3a3a3a; border: none; border-radius: 4px; color: white; cursor: pointer;">Cancel</button>
        </div>
      </div>
    </div>
  `;
  
  modal.style.display = "flex";
  
  // Setup event listeners
  const inputHexField = document.getElementById("inputColorHex") as HTMLInputElement;
  const outputHexField = document.getElementById("outputColorHex") as HTMLInputElement;
  const outputSection = document.getElementById("outputColorSection") as HTMLDivElement;
  const outputModeRadios = document.getElementsByName("outputMode") as NodeListOf<HTMLInputElement>;
  
  // Update output section visibility based on mode
  outputModeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (radio.value === "different") {
        outputSection.style.opacity = "1";
        outputSection.style.pointerEvents = "auto";
      } else {
        outputSection.style.opacity = "0.4";
        outputSection.style.pointerEvents = "none";
      }
    });
  });
  
  // Eyedropper buttons
  document.getElementById("eyedropperInput")!.addEventListener("click", () => {
    eyedropperMode = 'input';
    activateEyedropper();
    modal!.style.display = "none";
  });
  
  document.getElementById("eyedropperOutput")!.addEventListener("click", () => {
    eyedropperMode = 'output';
    activateEyedropper();
    modal!.style.display = "none";
  });
  
  // Save button
  document.getElementById("saveColorEdit")!.addEventListener("click", () => {
    const inputColor = inputHexField.value;
    const outputColor = outputHexField.value;
    const selectedMode = Array.from(outputModeRadios).find(r => r.checked)?.value;
    
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
      alert("Invalid input color format. Use #RRGGBB");
      return;
    }
    
    if (selectedMode === 'different' && !/^#[0-9A-Fa-f]{6}$/.test(outputColor)) {
      alert("Invalid output color format. Use #RRGGBB");
      return;
    }
    
    userPalette[index].inputColor = inputColor;
    
    if (selectedMode === 'remove') {
      userPalette[index].mapToBg = true;
      userPalette[index].outputColor = inputColor; // Keep it same for display
    } else if (selectedMode === 'different') {
      userPalette[index].mapToBg = false;
      userPalette[index].outputColor = outputColor;
    } else { // same
      userPalette[index].mapToBg = false;
      userPalette[index].outputColor = inputColor;
    }
    
    renderPaletteUI();
    closeColorEditor();
  });
  
  // Delete button
  const deleteBtn = document.getElementById("deleteColor");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (index !== 0 && confirm("Delete this color?")) {
        userPalette.splice(index, 1);
        renderPaletteUI();
        closeColorEditor();
      }
    });
  }
  
  // Cancel/Close buttons
  document.getElementById("cancelColorEdit")!.addEventListener("click", closeColorEditor);
  document.getElementById("closeColorEditor")!.addEventListener("click", closeColorEditor);
  
  // Click outside to close
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeColorEditor();
  });
}

function closeColorEditor() {
  const modal = document.getElementById("colorEditorModal");
  if (modal) modal.style.display = "none";
  colorEditorIndex = null;
  eyedropperMode = null;
}

function addPaletteColor() {
  console.log("Add palette color clicked, current length:", userPalette.length);
  if (userPalette.length >= 16) {
    showStatus("Maximum 16 colors allowed", true);
    return;
  }
  
  const newIndex = userPalette.length;
  userPalette.push({
    inputColor: "#808080",
    outputColor: "#808080",
    mapToBg: false,
  });
  
  renderPaletteUI();
  
  // Immediately open editor for the new color
  openColorEditor(newIndex);
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

let eyedropperActive = false;

function activateEyedropper() {
  if (!currentImage) {
    showStatus("No image loaded", true);
    return;
  }
  
  eyedropperActive = true;
  document.body.classList.add("eyedropper-active");
  mainCanvas.style.cursor = "crosshair";
  showStatus("💧 Click on the image to pick a color (ESC to cancel)");
}

function deactivateEyedropper() {
  eyedropperActive = false;
  document.body.classList.remove("eyedropper-active");
  mainCanvas.style.cursor = "";
  showStatus("Eyedropper cancelled");
}

function pickColorFromCanvas(x: number, y: number) {
  if (!currentImage) return;
  
  // Convert canvas coordinates to image coordinates
  const rect = mainCanvas.getBoundingClientRect();
  const scaleX = currentImage.width / rect.width;
  const scaleY = currentImage.height / rect.height;
  const imgX = Math.floor((x - rect.left) * scaleX);
  const imgY = Math.floor((y - rect.top) * scaleY);
  
  // Check bounds
  if (imgX < 0 || imgX >= currentImage.width || imgY < 0 || imgY >= currentImage.height) {
    return;
  }
  
  // Get pixel color
  const pixelIndex = (imgY * currentImage.width + imgX) * 4;
  const r = currentImage.data[pixelIndex];
  const g = currentImage.data[pixelIndex + 1];
  const b = currentImage.data[pixelIndex + 2];
  
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  
  deactivateEyedropper();
  
  // If we're in color editor mode, update the color editor
  if (colorEditorIndex !== null && eyedropperMode) {
    if (eyedropperMode === 'input') {
      userPalette[colorEditorIndex].inputColor = hex;
    } else if (eyedropperMode === 'output') {
      userPalette[colorEditorIndex].outputColor = hex;
      userPalette[colorEditorIndex].mapToBg = false; // Ensure it's not set to remove
    }
    // Reopen the color editor with updated values
    openColorEditor(colorEditorIndex);
    showStatus(`Picked ${hex.toUpperCase()}`);
  } else {
    // Old behavior: add to palette
    addColorToPalette(hex);
    showStatus(`Added ${hex.toUpperCase()} to palette`);
  }
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

// Convert userPalette to RGBA format for GPU processing
function buildPaletteRGBA(): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(16 * 4);
  
  for (let i = 0; i < userPalette.length && i < 16; i++) {
    const color = userPalette[i];
    // Use INPUT color for matching - GPU will find nearest input color
    // The palette stored with the result contains OUTPUT colors for display
    const [r, g, b, a] = hexToRGBA(color.inputColor);
    
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  
  // Fill remaining slots with background color
  for (let i = userPalette.length; i < 16; i++) {
    const [r, g, b, a] = hexToRGBA(userPalette[0].inputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  
  return palette;
}

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
  if (eyedropperActive) {
    pickColorFromCanvas(e.clientX, e.clientY);
  }
});

// ESC key to cancel eyedropper
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && eyedropperActive) {
    deactivateEyedropper();
  }
});

// Initialize palette UI on load
renderPaletteUI();
