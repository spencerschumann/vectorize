import type { Point } from "../geometry.ts";
import { fitPixelRange } from "./fitting.ts";
import type { CutPointOptimizerConfig } from "./types.ts";
import type { FitCache } from "./cache.ts";

function calculateCost(
  pixels: Point[],
  breakpoints: number[],
  config: CutPointOptimizerConfig,
  cache: FitCache,
): number {
  let totalError = 0;
  let start = 0;
  const fullBreakpoints = [
    ...breakpoints,
    pixels.length - 1,
  ];

  for (const end of fullBreakpoints) {
    const fit = cache.get(start, end) || fitPixelRange(pixels, { start, end });
    if (fit) {
      cache.set(start, end, fit);
      totalError += fit.error;
    }
    start = end;
  }

  return totalError + breakpoints.length * config.segmentPenalty;
}

/**
 * Refines breakpoint positions using local search.
 *
 * @param pixels The pixel chain.
 * @param breakpoints The initial breakpoints.
 * @param config The optimizer configuration.
 * @param cache The fit cache.
 * @returns A new array of refined breakpoints.
 */
export function refineBreakpoints(
  pixels: Point[],
  breakpoints: number[],
  config: CutPointOptimizerConfig,
  cache: FitCache,
): number[] {
  const refinedBreakpoints = [...breakpoints];

  for (let i = 0; i < config.maxIterations; i++) {
    let changed = false;
    for (let j = 0; j < refinedBreakpoints.length; j++) {
      const currentBreakpoint = refinedBreakpoints[j];
      const prevBreakpoint = j > 0 ? refinedBreakpoints[j - 1] : 0;
      const nextBreakpoint = j < refinedBreakpoints.length - 1
        ? refinedBreakpoints[j + 1]
        : pixels.length - 1;

      let bestBreakpoint = currentBreakpoint;
      // TODO: cache should already be populated from the initial fitting - is it?
      const fit1 = cache.get(prevBreakpoint, currentBreakpoint) ||
        fitPixelRange(pixels, {
          start: prevBreakpoint,
          end: currentBreakpoint,
        });
      const fit2 = cache.get(currentBreakpoint, nextBreakpoint) ||
        fitPixelRange(pixels, {
          start: currentBreakpoint,
          end: nextBreakpoint,
        });
      if (!fit1 || !fit2) continue;

      let minCost = fit1.error + fit2.error;

      const window = config.refinementWindow;
      for (let offset = -window; offset <= window; offset++) {
        if (offset === 0) continue;
        const newBreakpoint = currentBreakpoint + offset;

        if (
          newBreakpoint <= prevBreakpoint + config.minSegmentLength ||
          newBreakpoint >= nextBreakpoint - config.minSegmentLength
        ) {
          continue;
        }

        const newFit1 = cache.get(prevBreakpoint, newBreakpoint) ||
          fitPixelRange(pixels, { start: prevBreakpoint, end: newBreakpoint });
        const newFit2 = cache.get(newBreakpoint, nextBreakpoint) ||
          fitPixelRange(pixels, { start: newBreakpoint, end: nextBreakpoint });
        if (!newFit1 || !newFit2) continue;

        const cost = newFit1.error + newFit2.error;
        if (cost < minCost) {
          minCost = cost;
          bestBreakpoint = newBreakpoint;
          changed = true;
        }
      }
      refinedBreakpoints[j] = bestBreakpoint;
    }
    if (!changed) {
      break;
    }
  }

  return refinedBreakpoints;
}

/**
 * Tries removing each breakpoint and keeps the removal if it improves cost.
 *
 * @param pixels The pixel chain.
 * @param breakpoints The current breakpoints.
 * @param config The optimizer configuration.
 * @param cache The fit cache.
 * @returns A new array of merged breakpoints.
 */
export function mergeBreakpoints(
  pixels: Point[],
  breakpoints: number[],
  config: CutPointOptimizerConfig,
  cache: FitCache,
): number[] {
  const mergedBreakpoints = [...breakpoints];
  let i = 0;
  while (i < mergedBreakpoints.length) {
    const prevBreakpoint = i > 0 ? mergedBreakpoints[i - 1] : 0;
    const currentBreakpoint = mergedBreakpoints[i];
    const nextBreakpoint = i < mergedBreakpoints.length - 1
      ? mergedBreakpoints[i + 1]
      : pixels.length - 1;

    const fit1 = cache.get(prevBreakpoint, currentBreakpoint) ||
      fitPixelRange(pixels, { start: prevBreakpoint, end: currentBreakpoint });
    const fit2 = cache.get(currentBreakpoint, nextBreakpoint) ||
      fitPixelRange(pixels, { start: currentBreakpoint, end: nextBreakpoint });
    const mergedFit = cache.get(prevBreakpoint, nextBreakpoint) ||
      fitPixelRange(pixels, { start: prevBreakpoint, end: nextBreakpoint });

    if (fit1 && fit2 && mergedFit) {
      const currentCost = fit1.error + fit2.error + config.segmentPenalty;
      const mergedCost = mergedFit.error;

      if (mergedCost < currentCost) {
        console.log(
          `Merging breakpoints at index ${i} (pixel ${currentBreakpoint}) reduces cost from ${
            currentCost.toFixed(2)
          } to ${mergedCost.toFixed(2)}`,
        );
        mergedBreakpoints.splice(i, 1);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return mergedBreakpoints;
}
