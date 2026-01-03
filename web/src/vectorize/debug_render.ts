/**
 * Debug visualization rendering for test results.
 * Renders multi-layer debug images showing original, skeleton, DP path, and optimized primitives.
 */

import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import type { BinaryImage } from "../formats/binary.ts";
import { getPixelBin } from "../formats/binary.ts";
import type { Point } from "./geometry.ts";
import type { Primitive } from "./global_fitter.ts";

// RGBA color type
type RGBA = [number, number, number, number];

// Color palette
const COLORS = {
  WHITE: [255, 255, 255, 255] as RGBA,
  BLACK: [0, 0, 0, 255] as RGBA,
  CYAN: [0, 255, 255, 255] as RGBA,
  ORANGE: [255, 165, 0, 255] as RGBA,
  GREEN: [0, 255, 0, 255] as RGBA,
  MAGENTA: [255, 0, 255, 255] as RGBA,
  RED: [255, 0, 0, 255] as RGBA,
  BLUE: [0, 0, 255, 255] as RGBA,
};

interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, 4 bytes per pixel
}

function createRGBAImage(width: number, height: number, fill: RGBA): RGBAImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = fill[0];
    data[idx + 1] = fill[1];
    data[idx + 2] = fill[2];
    data[idx + 3] = fill[3];
  }
  return { width, height, data };
}

function setPixel(img: RGBAImage, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const idx = (y * img.width + x) * 4;
  img.data[idx] = color[0];
  img.data[idx + 1] = color[1];
  img.data[idx + 2] = color[2];
  img.data[idx + 3] = color[3];
}

function blendPixel(img: RGBAImage, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const idx = (y * img.width + x) * 4;
  const alpha = color[3] / 255;
  const invAlpha = 1 - alpha;
  img.data[idx] = img.data[idx] * invAlpha + color[0] * alpha;
  img.data[idx + 1] = img.data[idx + 1] * invAlpha + color[1] * alpha;
  img.data[idx + 2] = img.data[idx + 2] * invAlpha + color[2] * alpha;
  img.data[idx + 3] = 255;
}

/**
 * Draw a thick line segment using Bresenham + thickness
 */
function drawThickSegment(
  img: RGBAImage,
  p0: Point,
  p1: Point,
  width: number,
  color: RGBA,
): void {
  const halfWidth = width / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) {
    // Draw circle for point
    drawCircleFilled(img, p0.x, p0.y, halfWidth, color);
    return;
  }

  // Perpendicular unit vector
  const perpX = -dy / len;
  const perpY = dx / len;

  // Walk along the line and draw perpendicular segments
  const steps = Math.max(2, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = p0.x + t * dx;
    const y = p0.y + t * dy;

    // Draw perpendicular segment
    for (let w = -halfWidth; w <= halfWidth; w += 0.5) {
      const px = Math.round(x + w * perpX);
      const py = Math.round(y + w * perpY);
      blendPixel(img, px, py, color);
    }
  }
}

function drawCircleFilled(
  img: RGBAImage,
  cx: number,
  cy: number,
  r: number,
  color: RGBA,
): void {
  const minX = Math.max(0, Math.floor(cx - r - 1));
  const maxX = Math.min(img.width - 1, Math.ceil(cx + r + 1));
  const minY = Math.max(0, Math.floor(cy - r - 1));
  const maxY = Math.min(img.height - 1, Math.ceil(cy + r + 1));
  const rSq = r * r;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (distSq <= rSq) {
        blendPixel(img, x, y, color);
      }
    }
  }
}

/**
 * Draw an arc with thickness
 */
function drawArc(
  img: RGBAImage,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  width: number,
  color: RGBA,
): void {
  // Determine sweep direction and amount
  let sweep = endAngle - startAngle;
  const absSwep = Math.abs(sweep);
  
  // Sample the arc with enough points
  const numPoints = Math.max(8, Math.ceil(absSwep * r / 2));
  const points: Point[] = [];
  
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const angle = startAngle + t * sweep;
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  // Draw as connected segments
  for (let i = 0; i < points.length - 1; i++) {
    drawThickSegment(img, points[i], points[i + 1], width, color);
  }
}

/**
 * Draw a polyline (connected line segments)
 */
function drawPolyline(
  img: RGBAImage,
  points: Point[],
  width: number,
  color: RGBA,
): void {
  for (let i = 0; i < points.length - 1; i++) {
    drawThickSegment(img, points[i], points[i + 1], width, color);
  }
  // Draw endpoint markers
  for (const pt of points) {
    drawCircleFilled(img, pt.x, pt.y, width / 2 + 0.5, color);
  }
}

/**
 * Overlay binary image pixels onto RGBA image
 */
function drawBinaryImage(
  target: RGBAImage,
  binary: BinaryImage,
  color: RGBA,
): void {
  for (let y = 0; y < binary.height; y++) {
    for (let x = 0; x < binary.width; x++) {
      if (getPixelBin(binary, x, y) === 1) {
        setPixel(target, x, y, color);
      }
    }
  }
}

/**
 * Draw primitives (lines and arcs)
 */
function drawPrimitives(
  img: RGBAImage,
  primitives: Primitive[],
  lineColor: RGBA,
  arcColor: RGBA,
  width: number,
): void {
  for (const prim of primitives) {
    if (prim.type === "line") {
      drawThickSegment(img, prim.p0, prim.p1, width, lineColor);
    } else {
      drawArc(
        img,
        prim.cx,
        prim.cy,
        prim.r,
        prim.startAngle,
        prim.endAngle,
        width,
        arcColor,
      );
    }
  }
}

/**
 * Convert RGBA image to PNG data URL
 */
function rgbaToDataURL(img: RGBAImage): string {
  const png = PNG.sync.write({
    width: img.width,
    height: img.height,
    data: Buffer.from(img.data),
  });
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/**
 * Save RGBA image to file
 */
async function saveRGBAImage(img: RGBAImage, filename: string): Promise<void> {
  const png = PNG.sync.write({
    width: img.width,
    height: img.height,
    data: Buffer.from(img.data),
  });
  await Deno.writeFile(filename, png);
}

// ============================================================================
// Main Debug Rendering Functions
// ============================================================================

export interface DebugLayers {
  binary?: BinaryImage;
  skeleton?: BinaryImage;
  dpPath?: Point[];
  primitives?: Primitive[];
  rawPixels?: Point[];
}

export interface DebugRenderOptions {
  /** Output filename (if provided, saves to disk) */
  filename?: string;
  /** Width of lines for visualization */
  lineWidth?: number;
  /** Scale factor for output image */
  scale?: number;
}

/**
 * Render debug visualization with multiple layers
 * Returns data URL for browser viewing and optionally saves to disk
 */
export async function renderDebugLayers(
  layers: DebugLayers,
  options: DebugRenderOptions = {},
): Promise<string> {
  const lineWidth = options.lineWidth ?? 2;
  const scale = options.scale ?? 1;

  // Determine canvas size from binary or skeleton
  const ref = layers.binary ?? layers.skeleton;
  if (!ref) {
    throw new Error("Must provide at least binary or skeleton layer");
  }

  const width = ref.width * scale;
  const height = ref.height * scale;
  const img = createRGBAImage(width, height, COLORS.WHITE);

  // Layer 1: Original binary (black)
  if (layers.binary) {
    drawBinaryImage(img, layers.binary, COLORS.BLACK);
  }

  // Layer 2: Skeleton (cyan, semi-transparent)
  if (layers.skeleton) {
    drawBinaryImage(img, layers.skeleton, [0, 255, 255, 180] as RGBA);
  }

  // Layer 3: Raw pixels (if provided) in light red
  if (layers.rawPixels) {
    for (const pt of layers.rawPixels) {
      blendPixel(img, Math.round(pt.x * scale), Math.round(pt.y * scale), [255, 100, 100, 120] as RGBA);
    }
  }

  // Layer 4: DP path (orange)
  if (layers.dpPath && layers.dpPath.length > 1) {
    const scaledPath = scale !== 1
      ? layers.dpPath.map((p) => ({ x: p.x * scale, y: p.y * scale }))
      : layers.dpPath;
    drawPolyline(img, scaledPath, lineWidth, COLORS.ORANGE);
  }

  // Layer 5: Optimized primitives (green for lines, magenta for arcs)
  if (layers.primitives) {
    const scaledPrims: Primitive[] = scale !== 1
      ? layers.primitives.map((p) => {
        if (p.type === "line") {
          return {
            ...p,
            p0: { x: p.p0.x * scale, y: p.p0.y * scale },
            p1: { x: p.p1.x * scale, y: p.p1.y * scale },
          };
        } else {
          return {
            ...p,
            cx: p.cx * scale,
            cy: p.cy * scale,
            r: p.r * scale,
            p0: { x: p.p0.x * scale, y: p.p0.y * scale },
            p1: { x: p.p1.x * scale, y: p.p1.y * scale },
          };
        }
      })
      : layers.primitives;
    drawPrimitives(img, scaledPrims, COLORS.GREEN, COLORS.MAGENTA, lineWidth + 1);
  }

  // Save to file if requested
  if (options.filename) {
    await saveRGBAImage(img, options.filename);
  }

  // Return data URL
  return rgbaToDataURL(img);
}

/**
 * Create a side-by-side comparison of multiple debug renders
 */
export async function renderComparison(
  panels: Array<{ layers: DebugLayers; label?: string }>,
  options: DebugRenderOptions = {},
): Promise<string> {
  const lineWidth = options.lineWidth ?? 2;

  // Render each panel
  const renderedPanels: RGBAImage[] = [];
  for (const panel of panels) {
    const ref = panel.layers.binary ?? panel.layers.skeleton;
    if (!ref) continue;

    const img = createRGBAImage(ref.width, ref.height, COLORS.WHITE);
    
    if (panel.layers.binary) drawBinaryImage(img, panel.layers.binary, COLORS.BLACK);
    if (panel.layers.skeleton) drawBinaryImage(img, panel.layers.skeleton, [0, 255, 255, 180] as RGBA);
    if (panel.layers.dpPath && panel.layers.dpPath.length > 1) {
      drawPolyline(img, panel.layers.dpPath, lineWidth, COLORS.ORANGE);
    }
    if (panel.layers.primitives) {
      drawPrimitives(img, panel.layers.primitives, COLORS.GREEN, COLORS.MAGENTA, lineWidth + 1);
    }

    renderedPanels.push(img);
  }

  if (renderedPanels.length === 0) {
    throw new Error("No valid panels to render");
  }

  // Stack horizontally
  const totalWidth = renderedPanels.reduce((sum, p) => sum + p.width, 0);
  const maxHeight = Math.max(...renderedPanels.map((p) => p.height));
  const combined = createRGBAImage(totalWidth, maxHeight, COLORS.WHITE);

  let xOffset = 0;
  for (const panel of renderedPanels) {
    for (let y = 0; y < panel.height; y++) {
      for (let x = 0; x < panel.width; x++) {
        const srcIdx = (y * panel.width + x) * 4;
        const dstIdx = (y * combined.width + (x + xOffset)) * 4;
        combined.data[dstIdx] = panel.data[srcIdx];
        combined.data[dstIdx + 1] = panel.data[srcIdx + 1];
        combined.data[dstIdx + 2] = panel.data[srcIdx + 2];
        combined.data[dstIdx + 3] = panel.data[srcIdx + 3];
      }
    }
    xOffset += panel.width;
  }

  // Save if requested
  if (options.filename) {
    await saveRGBAImage(combined, options.filename);
  }

  return rgbaToDataURL(combined);
}
