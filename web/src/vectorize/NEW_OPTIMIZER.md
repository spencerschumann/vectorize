# Cut Point Optimizer Specification

## Overview

This document specifies a new "cut point" optimization strategy for
vectorization. Unlike the existing `optimizeEdge` function (which uses gradient
descent to adjust segment endpoints and sagitta points), the cut point optimizer
works at a higher level: it decides **where to break the input pixel chain into
segments**.

Once breakpoints are determined, the existing line/arc fitting functions
(`fitLine`, `fitArc`) provide optimal fits for each segment—no gradient descent
needed for the segments themselves.

## Goals

1. **Simplify optimization**: Replace continuous gradient descent with discrete
   breakpoint search
2. **Improve results**: Leverage optimal line/arc fitters; natural corner
   handling via intersections
3. **Speed up**: Discrete search over breakpoint positions vs. continuous
   coordinate optimization
4. **Fix corner cases**: Squares and polygons get precise intersections at
   corners

## What to Keep

- **Geometric primitives**: All code in `src/vectorize/geometry/` (lines,
  circles, arcs, intersections)
- **Fitting functions**: `fitLine`, `fitArc`, `fitCircle` and their helpers
- **Existing optimizer**: Keep `optimizeEdge` in `optimizer.ts` for potential
  use on full strokes (non-skeletonized). Rename if needed for clarity.
- **Segment types**: The unified `Segment` type with `line` and `arc` variants

## New Components

### 1. Types (`cutPointTypes.ts`)

```typescript
/**
 * A breakpoint in the pixel chain where one segment ends and another begins.
 * The breakpoint index refers to a position in the pixel array.
 */
export interface Breakpoint {
  /** Index into the pixel chain array */
  index: number;

  /**
   * How to handle the junction between adjacent segments.
   * - "intersect": Extend adjacent segments to their intersection point (default)
   * - "bridge": Insert a short line segment connecting the endpoints
   */
  junctionStrategy: "intersect" | "bridge";
}

/**
 * A range of pixels to be fitted as a single segment.
 */
export interface PixelRange {
  /** Start index in pixel chain (inclusive) */
  start: number;
  /** End index in pixel chain (inclusive) */
  end: number;
}

/**
 * Result of fitting a pixel range.
 */
export interface FitResult {
  segment: Segment;
  error: number; // Total squared error for the fit
  pixelRange: PixelRange;
}

/**
 * Configuration for the cut point optimizer.
 */
export interface CutPointOptimizerConfig {
  /** Weight for segment count penalty (default: 1.0) */
  segmentPenalty: number;

  /** Maximum error before a segment should be split (default: 2.0 pixels²) */
  maxSegmentError: number;

  /** Minimum pixels per segment (default: 3) */
  minSegmentLength: number;

  /** How many positions to check when refining breakpoints (default: 5) */
  refinementWindow: number;

  /** Maximum optimization iterations (default: 10) */
  maxIterations: number;
}
```

### 2. Core Algorithm (`cutPointOptimizer.ts`)

The optimizer has three main phases:

#### Phase 1: Greedy Initial Breakpoints

```typescript
/**
 * Find initial breakpoints using a greedy approach.
 * Start with the full chain as one segment, then recursively split
 * at the point of maximum error until all segments are under threshold.
 */
function findInitialBreakpoints(
  pixels: Point[],
  config: CutPointOptimizerConfig,
): number[];
```

Algorithm:

1. Start with no breakpoints (entire chain is one segment)
2. Fit the segment (try both line and arc, pick better)
3. If error > `maxSegmentError`, find the pixel with maximum deviation
4. Add a breakpoint at that pixel
5. Recursively process the two new segments
6. Return sorted list of breakpoint indices

#### Phase 2: Local Refinement

```typescript
/**
 * Refine breakpoint positions using local search.
 * For each breakpoint, try moving it within a window and keep
 * the position that minimizes total cost.
 */
function refineBreakpoints(
  pixels: Point[],
  breakpoints: number[],
  config: CutPointOptimizerConfig,
): number[];
```

Algorithm:

1. For each breakpoint (in order):
   - Try positions: `[current - window, ..., current + window]`
   - For each position, compute cost of adjacent segments
   - Keep the position with lowest cost
2. Repeat until no improvement or max iterations reached
3. Cost = sum of segment errors + `segmentPenalty * numSegments`

#### Phase 3: Merge Pass

```typescript
/**
 * Try removing each breakpoint and keep removal if it improves cost.
 * This merges segments that don't need to be separate.
 */
function mergeBreakpoints(
  pixels: Point[],
  breakpoints: number[],
  config: CutPointOptimizerConfig,
): number[];
```

Algorithm:

1. For each breakpoint:
   - Compute cost without this breakpoint (merged segment)
   - If cost improves, remove the breakpoint
2. Return remaining breakpoints

### 3. Segment Fitting

```typescript
/**
 * Fit a pixel range to the best segment (line or arc).
 */
function fitPixelRange(pixels: Point[], range: PixelRange): FitResult;
```

Algorithm:

1. Fit a line to the pixels in range
2. Fit an arc to the pixels in range (if enough pixels)
3. Return whichever has lower error
4. For very short ranges (< 3 pixels), always use line

### 4. Final Output

```typescript
/**
 * Convert breakpoints to final segment array with proper junctions.
 */
function breakpointsToSegments(
  pixels: Point[],
  breakpoints: number[],
  isClosedLoop: boolean,
): Segment[];
```

Algorithm:

1. Create segments for each pixel range between breakpoints
2. For each junction (breakpoint), apply the junction strategy:
   - **intersect**: Find intersection of adjacent segments, adjust endpoints
   - **bridge**: Keep segment endpoints, optionally insert bridging segment
3. Handle closed loops: Last segment connects to first

## Intersection Handling

For "intersect" junctions (the default):

```typescript
/**
 * Adjust adjacent segment endpoints to meet at their intersection.
 */
function applyIntersection(seg1: Segment, seg2: Segment): void;
```

- **Line-Line**: Compute intersection point, set as shared endpoint
- **Line-Arc**: Find intersection(s), pick closest to original junction
- **Arc-Arc**: Find intersection(s), pick closest to original junction
- **No intersection**: Fall back to "bridge" strategy

Use existing functions from `geometry/lineIntersection.ts` and
`geometry/circleIntersection.ts`.

## Caching Strategy

To avoid redundant computation:

```typescript
interface FitCache {
  // Key: "start-end", Value: FitResult
  get(start: number, end: number): FitResult | undefined;
  set(start: number, end: number, result: FitResult): void;
  clear(): void;
}
```

Cache line/arc fits for pixel ranges. Invalidate when breakpoints change (only
affected ranges need refitting).

## Entry Point

```typescript
/**
 * Main entry point for cut point optimization.
 *
 * @param pixels - The pixel chain to segment
 * @param isClosedLoop - Whether the chain forms a closed loop
 * @param config - Optional configuration overrides
 * @returns Array of optimized segments
 */
export function optimizeWithCutPoints(
  pixels: Point[],
  isClosedLoop: boolean,
  config?: Partial<CutPointOptimizerConfig>,
): Segment[];
```

## Integration

The new optimizer should be called from `segmentEdge` (or a variant) as an
alternative to the current approach:

```typescript
// In edgeProcessing.ts or similar
function segmentEdgeWithCutPoints(
  edgePixels: Point[],
  isClosedLoop: boolean,
): Segment[] {
  return optimizeWithCutPoints(edgePixels, isClosedLoop);
}
```

## File Structure

```
src/vectorize/
├── geometry/           # KEEP - existing geometric primitives
│   ├── line.ts
│   ├── circle.ts
│   ├── arc.ts
│   ├── lineIntersection.ts
│   ├── circleIntersection.ts
│   └── ...
├── optimizer.ts        # KEEP - rename to gradientOptimizer.ts if needed
├── cutPointOptimizer/  # NEW
│   ├── index.ts        # Re-exports
│   ├── types.ts        # Breakpoint, PixelRange, FitResult, Config
│   ├── optimizer.ts    # Main optimizeWithCutPoints function
│   ├── greedy.ts       # findInitialBreakpoints
│   ├── refine.ts       # refineBreakpoints, mergeBreakpoints
│   ├── fitting.ts      # fitPixelRange, segment fitting logic
│   ├── junctions.ts    # applyIntersection, junction handling
│   └── cache.ts        # FitCache implementation
└── ...
```

## Test Cases

### Square (Priority)

- Input: ~40 pixels forming a square outline
- Expected: 4 line segments with precise corner intersections
- Verify: Corners are at exact intersection points, not pixel centers

### Circle

- Input: Pixels forming a circle
- Expected: Single arc segment (or small number of arcs for large circles)

### Mixed Curve

- Input: Pixels with both straight and curved sections
- Expected: Lines for straight parts, arcs for curves, proper junctions

### L-Shape

- Input: Two perpendicular line segments
- Expected: 2 line segments meeting at corner intersection

## Implementation Order

1. Create `cutPointOptimizer/types.ts` with type definitions
2. Create `cutPointOptimizer/fitting.ts` - wrap existing fitLine/fitArc
3. Create `cutPointOptimizer/greedy.ts` - initial breakpoint finding
4. Create `cutPointOptimizer/refine.ts` - local refinement and merge
5. Create `cutPointOptimizer/junctions.ts` - intersection handling
6. Create `cutPointOptimizer/optimizer.ts` - main entry point
7. Create `cutPointOptimizer/index.ts` - exports
8. Add tests for each component
9. Integrate with edge processing pipeline
