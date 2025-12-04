/**
 * Application state management
 * Using a state object to allow mutations from importing modules
 */

import type { RGBAImage } from "../src/formats/rgba_image.ts";
import type { PalettizedImage } from "../src/formats/palettized.ts";
import type { BinaryImage } from "../src/formats/binary.ts";
import { DEFAULT_PALETTE } from "../src/formats/palettized.ts";
import type { ProcessingStage, PaletteColor } from "./types.ts";
import type { VectorizedImage } from "./vectorize.ts";
import { u32ToHex } from "./utils.ts";

// UI State
export const state = {
  currentFileId: null as string | null,
  currentPdfData: null as Uint8Array | null,
  currentImage: null as RGBAImage | null,
  currentSelectedPage: null as number | null,
  pdfPageCount: 0,
  cancelThumbnailLoading: false,

  // Processing state
  currentStage: "cropped" as ProcessingStage,
  processedImages: new Map<ProcessingStage, RGBAImage | PalettizedImage | BinaryImage>(),
  vectorizedImages: new Map<string, VectorizedImage>(), // e.g., "color_1_vec"

  // Palette configuration
  userPalette: Array.from(DEFAULT_PALETTE).map(color => ({
    inputColor: u32ToHex(color),
    outputColor: u32ToHex(color),
    mapToBg: false,
  })) as PaletteColor[],
  currentPaletteName: "",

  // Canvas/Viewport State
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  isDraggingCropHandle: false,
  activeCropHandle: null as string | null,
  cropRegion: null as { x: number; y: number; width: number; height: number } | null,
  lastPanX: 0,
  lastPanY: 0,

  // Processing canvas state
  processZoom: 1.0,
  processPanX: 0,
  processPanY: 0,
  isProcessPanning: false,
  lastProcessPanX: 0,
  lastProcessPanY: 0,
  processViewInitialized: false,
  
  // Vector overlay state
  vectorOverlayEnabled: false,
  vectorOverlayStage: null as string | null, // e.g., "color_1_vec"
};
