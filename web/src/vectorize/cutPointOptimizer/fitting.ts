import type { Point } from "../geometry.ts";
import { fitLine } from "../line_fit.ts";
import { fitCircle, signedSweep, isClockwiseAngles } from "../arc_fit.ts";
import type { Segment } from "../simplifier.ts";
import type { FitResult, PixelRange } from "./types.ts";
import { distance } from "../geometry.ts";

/**
 * Fits a pixel range to the best segment (line or arc).
 *
 * @param pixels The full array of pixel points.
 * @param range The start and end indices for the segment to be fitted.
 * @returns A FitResult containing the best segment and its error, or null if no fit is possible.
 */
export function fitPixelRange(
  pixels: Point[],
  range: PixelRange,
): FitResult | null {
  const segmentPixels = pixels.slice(range.start, range.end + 1);
  if (segmentPixels.length < 2) {
    return null;
  }

  const startPoint = segmentPixels[0];
  const endPoint = segmentPixels[segmentPixels.length - 1];

  // For very short ranges, always use a line.
  if (segmentPixels.length < 3) {
    const lineFit = fitLine(segmentPixels);
    if (!lineFit) {
      // Fallback for 2 identical points
      return {
        segment: {
          type: "line",
          start: startPoint,
          end: endPoint,
          points: segmentPixels,
          line: { point: startPoint, direction: { x: 0, y: 0 } },
        },
        error: 0,
        maxErrorSq: 0,
        pixelRange: range,
      };
    }
    const error = lineFit.rmsError * lineFit.rmsError * lineFit.count;
    return {
      segment: {
        type: "line",
        start: startPoint,
        end: endPoint,
        points: segmentPixels,
        line: lineFit.line,
      },
      error: error,
      maxErrorSq: lineFit.maxErrorSq,
      pixelRange: range,
    };
  }

  // Attempt both line and arc fits
  const lineFit = fitLine(segmentPixels);

  const isClosedLoop = distance(startPoint, endPoint) < 1e-3;
  if (isClosedLoop) {
    // for closed loop, don't double count the last point
    segmentPixels.pop();
  }

  const arcFit = fitCircle(segmentPixels);

  const lineError = lineFit
    ? lineFit.rmsError * lineFit.rmsError * lineFit.count
    : Infinity;
  const arcError = arcFit
    ? arcFit.rmsError * arcFit.rmsError * arcFit.count
    : Infinity;

  // If no valid fit was found, return null
  if (!lineFit && !arcFit) {
    return null;
  }

  // Choose the fit with the lower error. Prefer line in case of a tie.
  if (lineError <= arcError) {
    return {
      segment: {
        type: "line",
        start: startPoint,
        end: endPoint,
        points: segmentPixels,
        line: lineFit!.line,
      },
      error: lineError,
      maxErrorSq: lineFit!.maxErrorSq,
      pixelRange: range,
    };
  } else {
    // Check for degenerate arcs (huge radius), treat as lines
    const chordLength = distance(startPoint, endPoint);
    const sweepAngleAbs = Math.abs(signedSweep(arcFit!));
    if (sweepAngleAbs < 1 && arcFit!.circle.radius > 1000 * chordLength &&
      lineFit) {
      return {
        segment: {
          type: "line",
          start: startPoint,
          end: endPoint,
          points: segmentPixels,
          line: lineFit!.line,
        },
        error: lineError,
        maxErrorSq: lineFit!.maxErrorSq,
        pixelRange: range,
      };
    }

    return {
      segment: {
        type: "arc",
        start: startPoint,
        end: endPoint,
        points: segmentPixels,
        arc: {
          center: arcFit!.circle.center,
          radius: arcFit!.circle.radius,
          startAngle: arcFit!.startAngle,
          endAngle: arcFit!.endAngle,
          clockwise: isClockwiseAngles(arcFit!),
        },
      },
      error: arcError,
      maxErrorSq: arcFit!.maxErrorSq,
      pixelRange: range,
    };
  }
}
