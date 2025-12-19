import type { Point } from "../geometry.ts";
import { distance, distanceToLine } from "../geometry.ts";
import { fitPixelRange } from "./fitting.ts";
import type { CutPointOptimizerConfig } from "./types.ts";

function getPixelErrors(
  points: Point[],
  fit: ReturnType<typeof fitPixelRange>,
): { errors: number[]; maxErrorIndex: number } {
  const errors = points.map((p) => {
    if (!fit) return 0;
    const { segment } = fit;
    if (segment.type === "line") {
      return distanceToLine(p, segment.line);
    } else if (segment.type === "arc") {
      return Math.abs(distance(p, segment.arc.center) - segment.arc.radius);
    }
    return 0;
  });

  let maxError = -1;
  let maxErrorIndex = -1;
  for (let i = 0; i < errors.length; i++) {
    if (errors[i] > maxError) {
      maxError = errors[i];
      maxErrorIndex = i;
    }
  }

  return { errors, maxErrorIndex };
}


/**
 * Finds initial breakpoints using a greedy recursive splitting approach.
 *
 * @param pixels The array of points representing the pixel chain.
 * @param config The optimizer configuration.
 * @returns A sorted array of breakpoint indices.
 */
export function findInitialBreakpoints(
  pixels: Point[],
  config: CutPointOptimizerConfig,
): number[] {
  const breakpoints = new Set<number>();

  function recursiveSplit(start: number, end: number) {
    const segmentLength = end - start + 1;
    if (segmentLength < config.minSegmentLength) {
      return;
    }

    const fit = fitPixelRange(pixels, { start, end });
    if (!fit) {
      return;
    }

    if (fit.error > config.maxSegmentError) {
      const segmentPixels = pixels.slice(start, end + 1);
      const { maxErrorIndex } = getPixelErrors(segmentPixels, fit);

      if (
        maxErrorIndex > 0 &&
        maxErrorIndex < segmentLength - 1
      ) {
        const splitIndex = start + maxErrorIndex;
        breakpoints.add(splitIndex);
        recursiveSplit(start, splitIndex);
        recursiveSplit(splitIndex, end);
      }
    }
  }

  recursiveSplit(0, pixels.length - 1);

  return Array.from(breakpoints).sort((a, b) => a - b);
}
