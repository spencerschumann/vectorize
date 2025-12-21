import type { Point } from "../geometry.ts";
import type { Segment } from "../simplifier.ts";
import { findInitialBreakpoints } from "./greedy.ts";
import { refineBreakpoints, mergeBreakpoints } from "./refine.ts";
import { breakpointsToSegments } from "./junctions.ts";
import { FitCache } from "./cache.ts";
import type { CutPointOptimizerConfig } from "./types.ts";

const DEFAULT_CONFIG: CutPointOptimizerConfig = {
  segmentPenalty: 1.0,
  maxSegmentError: 2.0,
  minSegmentLength: 3,
  refinementWindow: 5,
  maxIterations: 10,
};

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
): Segment[] {
  if (pixels.length < 2) {
    return [];
  }

  const fullConfig: CutPointOptimizerConfig = { ...DEFAULT_CONFIG, ...config };
  const cache = new FitCache();

  // Phase 1: Greedy Initial Breakpoints
  let breakpoints = findInitialBreakpoints(pixels, fullConfig);

  // Phase 2: Local Refinement
  breakpoints = refineBreakpoints(pixels, breakpoints, fullConfig, cache);

  // Phase 3: Merge Pass
  breakpoints = mergeBreakpoints(pixels, breakpoints, fullConfig, cache);

  // Final Refinement after merging
  breakpoints = refineBreakpoints(pixels, breakpoints, fullConfig, cache);

  // Phase 4: Final Output
  return breakpointsToSegments(pixels, breakpoints, isClosedLoop);
}
