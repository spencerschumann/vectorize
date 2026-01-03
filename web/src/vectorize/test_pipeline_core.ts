/**
 * Browser-safe core pipeline utilities (no PNG decoding, no Node deps).
 */

import {
  createBinaryImage,
  getPixelBin,
  setPixelBin,
  type BinaryImage,
} from "../formats/binary.ts";
import { traceGraph } from "./tracer.ts";
import type { Point } from "./geometry.ts";
import { distancePointToSegmentSq, douglasPeucker } from "./douglas_peucker.ts";
import type { StrokeInput } from "./global_fitter.ts";

export interface PipelineOptions {
  dpEpsilon?: number;
  rawTolerance?: number;
}

const DEFAULT_OPTIONS: Required<PipelineOptions> = {
  dpEpsilon: 1.0,
  rawTolerance: 1.5,
};

export interface RasterContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

function drawThickLine(
  img: BinaryImage,
  p0: Point,
  p1: Point,
  width: number,
): void {
  const half = width / 2;
  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x) - half - 1));
  const maxX = Math.min(img.width - 1, Math.ceil(Math.max(p0.x, p1.x) + half + 1));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y) - half - 1));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(p0.y, p1.y) + half + 1));
  const halfSq = half * half;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Use pixel center for distance calculation
      const dSq = distancePointToSegmentSq({ x: x + 0.5, y: y + 0.5 }, p0, p1);
      if (dSq < halfSq) {
        setPixelBin(img, x, y, 1);
      }
    }
  }
}

export function binaryFromCanvas(
  width: number,
  height: number,
  draw: (ctx: RasterContext) => void,
): BinaryImage {
  const bin = createBinaryImage(width, height);

  const path: Point[] = [];
  const ctx: RasterContext = {
    fillStyle: "black",
    strokeStyle: "black",
    lineWidth: 1,
    beginPath() {
      path.length = 0;
    },
    moveTo(x: number, y: number) {
      path.length = 0;
      path.push({ x, y });
    },
    lineTo(x: number, y: number) {
      path.push({ x, y });
    },
    stroke() {
      for (let i = 0; i < path.length - 1; i++) {
        drawThickLine(bin, path[i], path[i + 1], this.lineWidth);
      }
    },
    fillRect(x: number, y: number, w: number, h: number) {
      for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + h)); yy++) {
        for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + w)); xx++) {
          setPixelBin(bin, xx, yy, 1);
        }
      }
    },
  };

  draw(ctx);
  return bin;
}

function countNeighbors(img: BinaryImage, x: number, y: number): number {
  let count = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      if (i === 0 && j === 0) continue;
      const nx = x + i;
      const ny = y + j;
      if (nx >= 0 && nx < img.width && ny >= 0 && ny < img.height) {
        if (getPixelBin(img, nx, ny) === 1) count++;
      }
    }
  }
  return count;
}

function transitions(img: BinaryImage, x: number, y: number): number {
  const p2 = getPixelBinSafe(img, x, y - 1);
  const p3 = getPixelBinSafe(img, x + 1, y - 1);
  const p4 = getPixelBinSafe(img, x + 1, y);
  const p5 = getPixelBinSafe(img, x + 1, y + 1);
  const p6 = getPixelBinSafe(img, x, y + 1);
  const p7 = getPixelBinSafe(img, x - 1, y + 1);
  const p8 = getPixelBinSafe(img, x - 1, y);
  const p9 = getPixelBinSafe(img, x - 1, y - 1);
  const sequence = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
  let t = 0;
  for (let i = 0; i < 8; i++) {
    if (sequence[i] === 0 && sequence[i + 1] === 1) t++;
  }
  return t;
}

function getPixelBinSafe(img: BinaryImage, x: number, y: number): 0 | 1 {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return getPixelBin(img, x, y);
}

export function skeletonizeZhangSuen(input: BinaryImage): BinaryImage {
  const img = createBinaryImage(input.width, input.height);
  img.data.set(input.data);

  let changed = true;
  while (changed) {
    changed = false;
    const toRemove: [number, number][] = [];

    // Pass 1
    for (let y = 1; y < img.height - 1; y++) {
      for (let x = 1; x < img.width - 1; x++) {
        if (getPixelBin(img, x, y) === 0) continue;
        const n = countNeighbors(img, x, y);
        if (n < 2 || n > 6) continue;
        if (transitions(img, x, y) !== 1) continue;

        const p2 = getPixelBin(img, x, y - 1);
        const p4 = getPixelBin(img, x + 1, y);
        const p6 = getPixelBin(img, x, y + 1);
        const p8 = getPixelBin(img, x - 1, y);
        if (p2 * p4 * p6 !== 0) continue;
        if (p4 * p6 * p8 !== 0) continue;

        toRemove.push([x, y]);
      }
    }

    if (toRemove.length > 0) {
      changed = true;
      for (const [x, y] of toRemove) setPixelBin(img, x, y, 0);
    }

    toRemove.length = 0;

    // Pass 2
    for (let y = 1; y < img.height - 1; y++) {
      for (let x = 1; x < img.width - 1; x++) {
        if (getPixelBin(img, x, y) === 0) continue;
        const n = countNeighbors(img, x, y);
        if (n < 2 || n > 6) continue;
        if (transitions(img, x, y) !== 1) continue;

        const p2 = getPixelBin(img, x, y - 1);
        const p4 = getPixelBin(img, x + 1, y);
        const p6 = getPixelBin(img, x, y + 1);
        const p8 = getPixelBin(img, x - 1, y);
        if (p2 * p4 * p8 !== 0) continue;
        if (p2 * p6 * p8 !== 0) continue;

        toRemove.push([x, y]);
      }
    }

    if (toRemove.length > 0) {
      changed = true;
      for (const [x, y] of toRemove) setPixelBin(img, x, y, 0);
    }
  }

  return img;
}

export function extractRawPixelsWithinTolerance(
  img: BinaryImage,
  path: Point[],
  tolerance: number,
): Point[] {
  const tolSq = tolerance * tolerance;
  const pixels: Point[] = [];

  const segments: [Point, Point][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    segments.push([path[i], path[i + 1]]);
  }

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const byteIndex = (y * img.width + x) >> 3;
      const bitIndex = 7 - ((y * img.width + x) & 7);
      if (((img.data[byteIndex] >> bitIndex) & 1) === 0) continue;

      let minDistSq = Infinity;
      for (const [a, b] of segments) {
        // Use pixel center (x + 0.5, y + 0.5) for distance calculation
        const dSq = distancePointToSegmentSq({ x: x + 0.5, y: y + 0.5 }, a, b);
        if (dSq < minDistSq) minDistSq = dSq;
        if (minDistSq <= tolSq) break;
      }
      if (minDistSq <= tolSq) {
        pixels.push({ x, y });
      }
    }
  }

  return pixels;
}

export interface StrokeBuildResult {
  strokes: StrokeInput[];
  skeleton: BinaryImage;
  binary: BinaryImage;
}

export function buildStrokesFromBinary(
  binary: BinaryImage,
  options: PipelineOptions = {},
): StrokeBuildResult {
  const opts = { ...DEFAULT_OPTIONS, ...options } as Required<PipelineOptions>;
  const skeleton = skeletonizeZhangSuen(binary);
  const graph = traceGraph(skeleton);

  const strokes: StrokeInput[] = [];
  for (const edge of graph.edges) {
    if (edge.points.length < 2) continue;
    const dpPoints = douglasPeucker(edge.points, opts.dpEpsilon);
    const rawPixels = extractRawPixelsWithinTolerance(
      binary,
      dpPoints,
      opts.rawTolerance,
    );
    strokes.push({ dpPoints, rawPixels });
  }

  return { strokes, skeleton, binary };
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

// Utility: count set pixels (handy for tests)
export function countOnPixels(img: BinaryImage): number {
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixelBin(img, x, y) === 1) count++;
    }
  }
  return count;
}
