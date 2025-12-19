import type { Point } from "../geometry.ts";
import type { Segment } from "../simplifier.ts";

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
