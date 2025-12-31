import type { Point } from "../geometry.ts";
import {
  angleOnCircle,
  arcEndPoint,
  arcStartPoint,
  distance,
  distancePointToLineSegmentSq,
  pointOnArc,
} from "../geometry.ts";
import { fitPixelRange } from "./fitting.ts";
import type { CutPointOptimizerConfig } from "./types.ts";
import type { FitCache } from "./cache.ts";

/**
 * Finds the point in a segment that is most distant from the line segment connecting the endpoints.
 * @param pixels The array of all points.
 * @param start The starting index of the segment.
 * @param end The ending index of the segment.
 * @returns The index of the most distant point.
 */
function findFurthestPoint(
  pixels: Point[],
  start: number,
  end: number,
): number {
  let maxDistSq = 0;
  let furthestIndex = -1;
  const startPoint = pixels[start];
  const endPoint = pixels[end];

  for (let i = start + 1; i < end; i++) {
    const distSq = distancePointToLineSegmentSq(
      pixels[i],
      startPoint,
      endPoint,
    );
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      furthestIndex = i;
    }
  }

  return furthestIndex;
}

/**
 * Finds initial breakpoints using a hybrid greedy recursive splitting approach.
 *
 * @param pixels The array of points representing the pixel chain.
 * @param config The optimizer configuration.
 * @returns A sorted array of breakpoint indices.
 */
export function findInitialBreakpoints(
  pixels: Point[],
  config: CutPointOptimizerConfig,
  cache: FitCache,
): number[] {
  const breakpoints = new Set<number>();

  function recursiveSplit(start: number, end: number) {
    const segmentLength = end - start + 1;
    if (segmentLength < config.minSegmentLength) {
      return;
    }

    const cachedFit = cache.get(start, end);
    const fit = cachedFit ?? fitPixelRange(pixels, { start, end });
    if (fit && !cachedFit) {
      cache.set(start, end, fit);
    }
    if (!fit) return;
    // TODO: add separate config for max error while finding initial breakpoints
    //if (fit.maxErrorSq < config.maxSegmentError) return;
    if (
      fit.maxErrorSq < 1.2 ||
      (fit.segment.type == "arc" && fit.maxErrorSq < 1.2)
    ) return;

    // If the fit is poor, fall back to Douglas-Peucker to find the split point.
    const furthestIndex = findFurthestPoint(pixels, start, end);

    if (furthestIndex !== -1) {
      breakpoints.add(furthestIndex);
      recursiveSplit(start, furthestIndex);
      recursiveSplit(furthestIndex, end);
    }
  }

  recursiveSplit(0, pixels.length - 1);

  // TODO: should we care about closed vs open paths in this function? Essentially,
  // if we don't, there's always an implicit breakpoint between the last and first points.

  const breakpointsList = Array.from(breakpoints).sort((a, b) => a - b);

  // Optional debug: log breakpoints and the fitted segments
  if (true) {
    const logSegment = function (start: number, end: number) {
      const fit = cache.get(start, end) ||
        fitPixelRange(pixels, { start, end });
      // Log fit, but not the full points array
      if (fit) {
        let details = "";
        if (fit.segment.type === "line") {
          const line = fit.segment.line;
          details = `point: (${line.point.x.toFixed(2)}, ${
            line.point.y.toFixed(2)
          }),
            direction: (${line.direction.x.toFixed(2)}, ${
            line.direction.y.toFixed(2)
          })`;
        } else if (fit.segment.type === "arc") {
          const arc = fit.segment.arc;
          // project start/end points onto arc
          const arcStart = arcStartPoint(arc);
          const arcEnd = arcEndPoint(arc);
          details = `center: (${arc.center.x.toFixed(2)}, ${
            arc.center.y.toFixed(2)
          }),
            radius: ${arc.radius.toFixed(2)}
            startAngle: ${arc.startAngle.toFixed(2)},
            endAngle: ${arc.endAngle.toFixed(2)},
            arcStart: (${arcStart.x.toFixed(2)}, ${arcStart.y.toFixed(2)}),
            arcEnd: (${arcEnd.x.toFixed(2)}, ${arcEnd.y.toFixed(2)}),
            clockwise: ${arc.clockwise}`;
          // Show each pixel point and the point on the arc
          for (const p of fit.segment.points) {
            const angle = angleOnCircle(p, {
              center: arc.center,
              radius: arc.radius,
            });
            if (false) {
              const point = pointOnArc(arc, angle);
              console.log(
                `  pixel: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) -> onArc: (${
                  point.x.toFixed(2)
                }, ${point.y.toFixed(2)}), dist: ${
                  distance(p, point).toFixed(2)
                };`,
              );
            }
          }
        }
        console.log(
          ` Segment [${start}, ${end}]: {
            type: ${fit.segment.type},
            start: (${fit.segment.start.x.toFixed(2)}, ${
            fit.segment.start.y.toFixed(2)
          }),
            end: (${fit.segment.end.x.toFixed(2)}, ${
            fit.segment.end.y.toFixed(2)
          }),
            error: ${fit.error.toFixed(2)},
            maxErrorSq: ${fit.maxErrorSq.toFixed(2)},
            ${details}
          }`,
        );
      } else {
        console.log(` Segment [${start}, ${end}]: No fit`);
      }
    };

    console.log("Initial Breakpoints:", breakpointsList);
    let prev = 0;
    for (const bp of breakpointsList) {
      logSegment(prev, bp);
      prev = bp;
    }
    logSegment(prev, pixels.length - 1);
  }

  return breakpointsList;
}
