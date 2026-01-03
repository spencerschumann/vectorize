/**
 * Integration helpers for end-to-end raster-to-vector testing.
 * - Accepts base64 1-bit PNG or canvas drawing commands
 * - Skeletonizes the binary image
 * - Extracts paths via traceGraph()
 * - Simplifies via Douglas-Peucker
 * - Collects raw pixels near the simplified path
 */

import { decodeBase64 } from "jsr:@std/encoding/base64";
import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import {
  binaryFromCanvas,
  buildStrokesFromBinary,
  extractRawPixelsWithinTolerance,
  type PipelineOptions,
  type RasterContext,
  skeletonizeZhangSuen,
  type StrokeBuildResult,
  countOnPixels,
} from "./test_pipeline_core.ts";
import { createBinaryImage, setPixelBin, type BinaryImage } from "../formats/binary.ts";

export type { PipelineOptions, RasterContext, StrokeBuildResult } from "./test_pipeline_core.ts";
export {
  binaryFromCanvas,
  buildStrokesFromBinary,
  extractRawPixelsWithinTolerance,
  skeletonizeZhangSuen,
  countOnPixels,
} from "./test_pipeline_core.ts";

// ============================================================================
// Image Loading
// ============================================================================

/**
 * Decode a base64 (or data URL) PNG into a BinaryImage by thresholding.
 */
export function binaryFromBase64Png(
  base64: string,
  threshold = 128,
): BinaryImage {
  const cleaned = base64.startsWith("data:")
    ? base64.substring(base64.indexOf(",") + 1)
    : base64;

  const bytes = decodeBase64(cleaned);
  const pngData = typeof Buffer !== "undefined"
    ? Buffer.from(bytes)
    : Uint8Array.from(bytes);
  const png = PNG.sync.read(pngData);

  const width = png.width;
  const height = png.height;
  const bin = createBinaryImage(width, height);

  const data = png.data; // RGBA
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Simple luminance threshold
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255);
      setPixelBin(bin, x, y, lum < threshold ? 1 : 0);
    }
  }

  return bin;
}

export function buildStrokesFromBase64(
  base64Png: string,
  options: PipelineOptions = {},
): StrokeBuildResult {
  const binary = binaryFromBase64Png(base64Png);
  return buildStrokesFromBinary(binary, options);
}

export function buildStrokesFromCanvas(
  width: number,
  height: number,
  draw: (ctx: RasterContext) => void,
  options: PipelineOptions = {},
): StrokeBuildResult {
  const binary = binaryFromCanvas(width, height, draw);
  return buildStrokesFromBinary(binary, options);
}
