import type { Point } from "../geometry.ts";
import { distancePointToLineSegmentSq } from "../geometry.ts";
import { fitPixelRange } from "./fitting.ts";
import type { CutPointOptimizerConfig } from "./types.ts";

/**
 * Finds the point in a segment that is most distant from the line segment connecting the endpoints.
 * @param pixels The array of all points.
 * @param start The starting index of the segment.
 * @param end The ending index of the segment.
 * @returns The index of the most distant point and the squared distance.
 */
function findFurthestPoint(
  pixels: Point[],
  start: number,
  end: number,
): { index: number; distanceSq: number } {
  let maxDistSq = 0;
  let furthestIndex = -1;
  const startPoint = pixels[start];
  const endPoint = pixels[end];

  for (let i = start + 1; i < end; i++) {
    const distSq = distancePointToLineSegmentSq(pixels[i], startPoint, endPoint);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      furthestIndex = i;
    }
  }

  return { index: furthestIndex, distanceSq: maxDistSq };
}

/**
 * Finds initial breakpoints using a greedy recursive splitting approach based on the Douglas-Peucker algorithm.
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

    const { index: furthestIndex, distanceSq } = findFurthestPoint(
      pixels,
      start,
      end,
    );

    // The threshold in Douglas-Peucker is a distance, not an error. We'll use the square root of maxSegmentError.
    if (Math.sqrt(distanceSq) > config.maxSegmentError) {
      if (furthestIndex !== -1) {
        breakpoints.add(furthestIndex);
        recursiveSplit(start, furthestIndex);
        recursiveSplit(furthestIndex, end);
      }
    }
  }

  recursiveSplit(0, pixels.length - 1);

  return Array.from(breakpoints).sort((a, b) => a - b);
}