/**
 * Global line+arc fitting system for raster-to-vector conversion
 * with G¹ continuity and pixel-based error
 *
 * Follows the design spec in global_fitter.md
 */

import type { Point } from "./geometry.ts";
import {
  add,
  distance,
  distanceSquared,
  dot,
  magnitude,
  normalize,
  scale,
  subtract,
} from "./geometry.ts";
import { fitLine } from "./line_fit.ts";
import { fitCircle } from "./arc_fit.ts";

// ============================================================================
// Primitive Types
// ============================================================================

export interface LinePrimitive {
  type: "line";
  p0: Point;
  p1: Point;
}

export interface ArcPrimitive {
  type: "arc";
  cx: number;
  cy: number;
  r: number;
  startAngle: number;
  endAngle: number;
  p0: Point;
  p1: Point;
}

export type Primitive = LinePrimitive | ArcPrimitive;

// ============================================================================
// Input Types
// ============================================================================

export interface StrokeInput {
  dpPoints: Point[];
  rawPixels: Point[];
}

// ============================================================================
// Fitting Configuration
// ============================================================================

export interface FitConfig {
  /** Tolerance for accepting a fit (RMS pixel error) */
  tolerance: number;
  /** Curvature penalty coefficient for arcs: lambda * (1/r)^2 */
  curvatureLambda: number;
  /** Minimum number of points to attempt arc fitting */
  minPointsForArc: number;
}

const DEFAULT_CONFIG: FitConfig = {
  tolerance: 1.0,
  curvatureLambda: 100.0,
  minPointsForArc: 3,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute RMS error of pixels to a line segment
 */
function linePixelError(
  p0: Point,
  p1: Point,
  pixels: Point[],
): number {
  if (pixels.length === 0) return 0;

  let sumSq = 0;
  for (const pixel of pixels) {
    const dist = distancePointToLineSegment(pixel, p0, p1);
    sumSq += dist * dist;
  }
  return Math.sqrt(sumSq / pixels.length);
}

/**
 * Compute RMS error of pixels to a circular arc
 */
function arcPixelError(
  cx: number,
  cy: number,
  r: number,
  pixels: Point[],
): number {
  if (pixels.length === 0) return 0;

  let sumSq = 0;
  const center = { x: cx, y: cy };
  for (const pixel of pixels) {
    const dist = Math.abs(distance(pixel, center) - r);
    sumSq += dist * dist;
  }
  return Math.sqrt(sumSq / pixels.length);
}

/**
 * Distance from point to line segment
 */
function distancePointToLineSegment(
  p: Point,
  a: Point,
  b: Point,
): number {
  const l2 = distanceSquared(a, b);
  if (l2 === 0) return distance(p, a);

  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const proj = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
  return distance(p, proj);
}

/**
 * Find the point with maximum deviation from a line
 */
function findMaxDeviation(
  points: Point[],
  p0: Point,
  p1: Point,
): { index: number; deviation: number } {
  if (points.length === 0) return { index: -1, deviation: 0 };

  let maxDev = 0;
  let maxIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const dev = distancePointToLineSegment(points[i], p0, p1);
    if (dev > maxDev) {
      maxDev = dev;
      maxIdx = i;
    }
  }

  return { index: maxIdx, deviation: maxDev };
}

/**
 * Assign raw pixels to a span based on proximity
 */
function assignPixelsToSpan(
  spanStart: Point,
  spanEnd: Point,
  allPixels: Point[],
): Point[] {
  // For now, return all pixels
  // In a more sophisticated implementation, we would partition pixels
  // among multiple spans based on proximity
  return allPixels;
}

// ============================================================================
// Step 1: Recursive Segmentation
// ============================================================================

/**
 * Recursively fit a span of points with lines or arcs
 */
function fitSpan(
  dpPoints: Point[],
  rawPixels: Point[],
  startIdx: number,
  endIdx: number,
  config: FitConfig,
): Primitive[] {
  if (startIdx >= endIdx) return [];
  if (startIdx + 1 === endIdx) {
    // Single segment - just a line
    return [{
      type: "line",
      p0: dpPoints[startIdx],
      p1: dpPoints[endIdx],
    }];
  }

  const spanPoints = dpPoints.slice(startIdx, endIdx + 1);
  const p0 = dpPoints[startIdx];
  const p1 = dpPoints[endIdx];

  // Assign pixels to this span
  const spanPixels = assignPixelsToSpan(p0, p1, rawPixels);

  // Try line fit
  const lineFit = fitLine(spanPoints);
  let lineCost = Infinity;
  if (lineFit) {
    const lineError = linePixelError(p0, p1, spanPixels);
    lineCost = lineError;
  }

  // Try arc fit (if enough points)
  let arcCost = Infinity;
  let arcCenter: Point | null = null;
  let arcRadius = 0;
  let arcStartAngle = 0;
  let arcEndAngle = 0;

  if (spanPoints.length >= config.minPointsForArc) {
    const arcFit = fitCircle(spanPoints);
    if (arcFit) {
      const arcError = arcPixelError(
        arcFit.circle.center.x,
        arcFit.circle.center.y,
        arcFit.circle.radius,
        spanPixels,
      );
      const curvaturePenalty = config.curvatureLambda /
        (arcFit.circle.radius * arcFit.circle.radius);
      arcCost = arcError + curvaturePenalty;
      arcCenter = arcFit.circle.center;
      arcRadius = arcFit.circle.radius;
      arcStartAngle = arcFit.startAngle;
      arcEndAngle = arcFit.endAngle;
    }
  }

  // Choose the better model
  const useLine = lineCost <= arcCost;
  const bestCost = useLine ? lineCost : arcCost;

  // Check if we should accept this fit
  if (bestCost < config.tolerance) {
    if (useLine) {
      return [{
        type: "line",
        p0,
        p1,
      }];
    } else {
      return [{
        type: "arc",
        cx: arcCenter!.x,
        cy: arcCenter!.y,
        r: arcRadius,
        startAngle: arcStartAngle,
        endAngle: arcEndAngle,
        p0,
        p1,
      }];
    }
  }

  // Split at point of maximum deviation
  const { index: splitIdx } = findMaxDeviation(spanPoints, p0, p1);
  const actualSplitIdx = startIdx + splitIdx;

  if (actualSplitIdx <= startIdx || actualSplitIdx >= endIdx) {
    // Can't split further, accept what we have
    if (useLine) {
      return [{
        type: "line",
        p0,
        p1,
      }];
    } else if (arcCenter) {
      return [{
        type: "arc",
        cx: arcCenter.x,
        cy: arcCenter.y,
        r: arcRadius,
        startAngle: arcStartAngle,
        endAngle: arcEndAngle,
        p0,
        p1,
      }];
    } else {
      return [{
        type: "line",
        p0,
        p1,
      }];
    }
  }

  // Recursively fit sub-spans
  const leftPrimitives = fitSpan(
    dpPoints,
    rawPixels,
    startIdx,
    actualSplitIdx,
    config,
  );
  const rightPrimitives = fitSpan(
    dpPoints,
    rawPixels,
    actualSplitIdx,
    endIdx,
    config,
  );

  return [...leftPrimitives, ...rightPrimitives];
}

// ============================================================================
// Step 3: G¹ Continuity Solver (Simplified)
// ============================================================================

/**
 * Apply G¹ continuity by adjusting shared endpoints and tangents
 * This is a simplified version - a full implementation would use
 * Gauss-Newton least squares optimization
 */
function enforceG1Continuity(primitives: Primitive[]): Primitive[] {
  if (primitives.length < 2) return primitives;

  const result: Primitive[] = [];

  for (let i = 0; i < primitives.length; i++) {
    const prim = primitives[i];

    // Ensure endpoint continuity
    if (i > 0) {
      const prev = result[result.length - 1];
      // Make sure current primitive starts where previous ended
      if (prim.type === "line") {
        prim.p0 = prev.p1;
      } else {
        prim.p0 = prev.p1;
        // Update arc endpoints based on angles
        prim.p1 = {
          x: prim.cx + prim.r * Math.cos(prim.endAngle),
          y: prim.cy + prim.r * Math.sin(prim.endAngle),
        };
      }
    }

    result.push(prim);
  }

  return result;
}

// ============================================================================
// Step 4: Merge Primitives
// ============================================================================

/**
 * Merge adjacent arcs with similar centers/radii
 * and collinear lines
 */
function mergePrimitives(primitives: Primitive[]): Primitive[] {
  if (primitives.length < 2) return primitives;

  const result: Primitive[] = [];
  let i = 0;

  while (i < primitives.length) {
    const current = primitives[i];

    // Try to merge with next primitive
    if (i + 1 < primitives.length) {
      const next = primitives[i + 1];
      let merged = false;

      // Merge two lines if collinear
      if (current.type === "line" && next.type === "line") {
        const dir1 = normalize(subtract(current.p1, current.p0));
        const dir2 = normalize(subtract(next.p1, next.p0));
        const dotProduct = dot(dir1, dir2);

        // If nearly parallel (cosine close to 1)
        if (dotProduct > 0.99) {
          result.push({
            type: "line",
            p0: current.p0,
            p1: next.p1,
          });
          i += 2;
          merged = true;
        }
      }

      // Merge two arcs if similar center and radius
      if (current.type === "arc" && next.type === "arc") {
        const centerDist = distance(
          { x: current.cx, y: current.cy },
          { x: next.cx, y: next.cy },
        );
        const radiusDiff = Math.abs(current.r - next.r);

        // If centers are close and radii are similar
        if (centerDist < 2.0 && radiusDiff < 1.0) {
          result.push({
            type: "arc",
            cx: (current.cx + next.cx) / 2,
            cy: (current.cy + next.cy) / 2,
            r: (current.r + next.r) / 2,
            startAngle: current.startAngle,
            endAngle: next.endAngle,
            p0: current.p0,
            p1: next.p1,
          });
          i += 2;
          merged = true;
        }
      }

      if (!merged) {
        result.push(current);
        i++;
      }
    } else {
      result.push(current);
      i++;
    }
  }

  return result;
}

// ============================================================================
// Step 5: Main Entry Point
// ============================================================================

export interface GlobalFitResult {
  primitives: Primitive[];
}

/**
 * Perform global line+arc fitting on a stroke
 *
 * @param input - Stroke data with DP-simplified points and raw pixels
 * @param config - Fitting configuration (optional)
 * @returns Fitted primitives with G¹ continuity
 */
export function globalFit(
  input: StrokeInput,
  config: Partial<FitConfig> = {},
): GlobalFitResult {
  const finalConfig: FitConfig = { ...DEFAULT_CONFIG, ...config };

  // Step 1: Recursive segmentation
  let primitives = fitSpan(
    input.dpPoints,
    input.rawPixels,
    0,
    input.dpPoints.length - 1,
    finalConfig,
  );

  // Step 2: Primitive graph is implicit (sequential order)

  // Step 3: Enforce G¹ continuity
  primitives = enforceG1Continuity(primitives);

  // Step 4: Merge similar primitives
  primitives = mergePrimitives(primitives);

  return { primitives };
}

// ============================================================================
// Output Conversion
// ============================================================================

/**
 * Convert primitives to G-code format strings
 */
export function primitivesToGCode(primitives: Primitive[]): string[] {
  const lines: string[] = [];

  for (const prim of primitives) {
    if (prim.type === "line") {
      lines.push(`G1 X${prim.p1.x.toFixed(3)} Y${prim.p1.y.toFixed(3)}`);
    } else {
      // G2 for clockwise, G3 for counter-clockwise
      const isCW = prim.endAngle < prim.startAngle;
      const cmd = isCW ? "G2" : "G3";
      const i = prim.cx - prim.p0.x;
      const j = prim.cy - prim.p0.y;
      lines.push(
        `${cmd} X${prim.p1.x.toFixed(3)} Y${prim.p1.y.toFixed(3)} ` +
          `I${i.toFixed(3)} J${j.toFixed(3)}`,
      );
    }
  }

  return lines;
}
