/**
 * Type definitions for the vectorizer application
 */

export type AppMode = "upload" | "pageSelection" | "crop" | "processing";

// Base processing stages
export type BaseProcessingStage = 
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
  | "median"
  | "vectorized";

// Dynamic stages: color_0, color_0_skel, color_1, color_1_skel, color_1_vec, etc.
export type ProcessingStage = BaseProcessingStage | string;

// Palette configuration
export interface PaletteColor {
  inputColor: string;   // Hex color for matching
  outputColor: string;  // Hex color for display
  mapToBg: boolean;     // Map this color to background
}
