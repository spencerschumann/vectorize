/**
 * Canvas viewport and crop management
 */

import type { RGBAImage } from "../src/formats/rgba_image.ts";
import { state } from "./state.ts";

// DOM Elements (initialized in main.ts)
export let canvasContainer: HTMLDivElement;
export let mainCanvas: HTMLCanvasElement;
export let ctx: CanvasRenderingContext2D;
export let cropOverlay: HTMLCanvasElement;
export let cropCtx: CanvasRenderingContext2D;
export let zoomLevel: HTMLDivElement;
export let cropInfo: HTMLDivElement;

export function initCanvasElements(elements: {
  canvasContainer: HTMLDivElement;
  mainCanvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cropOverlay: HTMLCanvasElement;
  cropCtx: CanvasRenderingContext2D;
  zoomLevel: HTMLDivElement;
  cropInfo: HTMLDivElement;
}) {
  canvasContainer = elements.canvasContainer;
  mainCanvas = elements.mainCanvas;
  ctx = elements.ctx;
  cropOverlay = elements.cropOverlay;
  cropCtx = elements.cropCtx;
  zoomLevel = elements.zoomLevel;
  cropInfo = elements.cropInfo;
}

export function loadImage(image: RGBAImage, statusCallback: (msg: string) => void) {
  state.currentImage = image;
  
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
    state.cropRegion = savedCrop;
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
  
  statusCallback(`✓ Ready: ${image.width}×${image.height} pixels`);
}

export function fitToScreen() {
  if (!state.currentImage) return;
  
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;
  const imageWidth = state.currentImage.width;
  const imageHeight = state.currentImage.height;
  
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  state.zoom = Math.min(scaleX, scaleY) * 0.9; // 90% to add padding
  
  state.panX = (containerWidth - imageWidth * state.zoom) / 2;
  state.panY = (containerHeight - imageHeight * state.zoom) / 2;
  
  updateZoom();
  updateTransform();
}

export function updateZoom() {
  zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
}

// Crop management functions
export function setDefaultCrop(imageWidth: number, imageHeight: number) {
  const margin = 0.1; // 10% margin
  state.cropRegion = {
    x: imageWidth * margin,
    y: imageHeight * margin,
    width: imageWidth * (1 - 2 * margin),
    height: imageHeight * (1 - 2 * margin),
  };
  updateCropInfo();
}

export function getCropSettings(imageWidth: number, imageHeight: number) {
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

export function saveCropSettings(imageWidth: number, imageHeight: number, crop: { x: number; y: number; width: number; height: number }) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  localStorage.setItem(key, JSON.stringify(crop));
}

export function updateCropInfo() {
  if (state.cropRegion) {
    cropInfo.textContent = `Crop: ${Math.round(state.cropRegion.width)}×${Math.round(state.cropRegion.height)} at (${Math.round(state.cropRegion.x)}, ${Math.round(state.cropRegion.y)})`;
  }
}

export function getCropHandleAtPoint(x: number, y: number): string | null {
  if (!state.cropRegion) return null;
  
  const handleSize = 15 / state.zoom; // Handle hit area in canvas coordinates
  const { x: cx, y: cy, width: cw, height: ch } = state.cropRegion;
  
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

export function updateCursorForHandle(handle: string | null) {
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

export function adjustCropRegion(handle: string, dx: number, dy: number) {
  if (!state.cropRegion || !state.currentImage) return;
  
  const { x, y, width, height } = state.cropRegion;
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
  newX = Math.max(0, Math.min(newX, state.currentImage.width - 10));
  newY = Math.max(0, Math.min(newY, state.currentImage.height - 10));
  newWidth = Math.max(10, Math.min(newWidth, state.currentImage.width - newX));
  newHeight = Math.max(10, Math.min(newHeight, state.currentImage.height - newY));
  
  state.cropRegion.x = newX;
  state.cropRegion.y = newY;
  state.cropRegion.width = newWidth;
  state.cropRegion.height = newHeight;
  
  updateCropInfo();
}

// Fast update - only changes transform (for panning/zooming)
export function updateTransform() {
  const transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  mainCanvas.style.transform = transform;
  mainCanvas.style.transformOrigin = "0 0";
  mainCanvas.style.willChange = "transform";
  
  cropOverlay.style.transform = transform;
  cropOverlay.style.transformOrigin = "0 0";
  cropOverlay.style.willChange = "transform";
  
  // Use crisp pixels when zoomed in (>= 1x), filtered when zoomed out (< 1x)
  if (state.zoom >= 1) {
    mainCanvas.style.imageRendering = "pixelated";
  } else {
    mainCanvas.style.imageRendering = "smooth";
  }
  
  // Redraw crop overlay whenever transform changes
  drawCropOverlay();
}

// Full redraw - updates canvas content
export function redrawCanvas() {
  if (!state.currentImage) return;
  
  // Clear and redraw base image
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(state.currentImage.data),
    state.currentImage.width,
    state.currentImage.height,
  );
  ctx.putImageData(imageData, 0, 0);
  
  drawCropOverlay();
}

// Draw crop overlay with darkened mask and handles
export function drawCropOverlay() {
  if (!state.currentImage || !state.cropRegion) {
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    return;
  }
  
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  
  // Draw darkened mask over entire image
  cropCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
  cropCtx.fillRect(0, 0, state.currentImage.width, state.currentImage.height);
  
  // Clear the crop region (composite mode)
  cropCtx.globalCompositeOperation = "destination-out";
  cropCtx.fillStyle = "rgba(0, 0, 0, 1)";
  cropCtx.fillRect(
    state.cropRegion.x,
    state.cropRegion.y,
    state.cropRegion.width,
    state.cropRegion.height,
  );
  cropCtx.globalCompositeOperation = "source-over";
  
  // Draw crop rectangle border
  cropCtx.strokeStyle = "#4f46e5";
  cropCtx.lineWidth = 3 / state.zoom;
  cropCtx.strokeRect(
    state.cropRegion.x,
    state.cropRegion.y,
    state.cropRegion.width,
    state.cropRegion.height,
  );
  
  // Draw handles - 4 corners + 4 edges
  const handleSize = 10 / state.zoom;
  cropCtx.fillStyle = "#4f46e5";
  
  const cx = state.cropRegion.x;
  const cy = state.cropRegion.y;
  const cw = state.cropRegion.width;
  const ch = state.cropRegion.height;
  
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

export function cropImage(
  image: RGBAImage,
  crop: { x: number; y: number; width: number; height: number },
): RGBAImage {
  // Round crop coordinates to integers and ensure they're within bounds
  const x = Math.max(0, Math.min(Math.round(crop.x), image.width - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), image.height - 1));
  const width = Math.max(1, Math.min(Math.round(crop.width), image.width - x));
  const height = Math.max(1, Math.min(Math.round(crop.height), image.height - y));
  
  const croppedData = new Uint8ClampedArray(width * height * 4);
  
  for (let row = 0; row < height; row++) {
    const srcOffset = ((y + row) * image.width + x) * 4;
    const dstOffset = row * width * 4;
    const copyLength = width * 4;
    
    // Ensure we don't read beyond the source image bounds
    if (srcOffset + copyLength <= image.data.length) {
      croppedData.set(
        image.data.subarray(srcOffset, srcOffset + copyLength),
        dstOffset,
      );
    }
  }
  
  return { width, height, data: croppedData };
}
