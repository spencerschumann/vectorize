import type { Point } from "../geometry.ts";
import {
  lineLineIntersection,
  lineArcIntersection,
  arcArcIntersection,
  distance,
} from "../geometry.ts";
import type { Segment } from "../simplifier.ts";
import { fitPixelRange } from "./fitting.ts";

/**
 * Adjusts the endpoints of two adjacent segments to meet at their intersection.
 * Modifies the segments in place.
 *
 * @param seg1 The first segment.
 * @param seg2 The second segment.
 */
function applyIntersection(seg1: Segment, seg2: Segment): void {
  if (seg1.type === "circle" || seg2.type === "circle") {
    return; // Cannot intersect with a full circle in this context
  }
  let intersection: Point | null = null;
  const junctionPoint = seg1.end;

  if (seg1.type === "line" && seg2.type === "line") {
    intersection = lineLineIntersection(seg1.line, seg2.line);
  } else if (seg1.type === "line" && seg2.type === "arc") {
    const intersections = lineArcIntersection(seg1.line, seg2.arc);
    intersection = findClosestPoint(junctionPoint, intersections);
  } else if (seg1.type === "arc" && seg2.type === "line") {
    const intersections = lineArcIntersection(seg2.line, seg1.arc);
    intersection = findClosestPoint(junctionPoint, intersections);
  } else if (seg1.type === "arc" && seg2.type === "arc") {
    const intersections = arcArcIntersection(seg1.arc, seg2.arc);
    intersection = findClosestPoint(junctionPoint, intersections);
  }

  if (intersection) {
    if (seg1.type === "line" || seg1.type === "arc") {
      seg1.end = intersection;
    }
    if (seg2.type === "line" || seg2.type === "arc") {
      seg2.start = intersection;
    }
  }
}

function findClosestPoint(target: Point, points: Point[]): Point | null {
  if (points.length === 0) {
    return null;
  }
  let closestPoint = points[0];
  let minDistance = distance(target, closestPoint);
  for (let i = 1; i < points.length; i++) {
    const d = distance(target, points[i]);
    if (d < minDistance) {
      minDistance = d;
      closestPoint = points[i];
    }
  }
  return closestPoint;
}

/**
 * Converts a set of breakpoints into a final array of Segments.
 *
 * @param pixels The pixel chain.
 * @param breakpoints The sorted array of breakpoint indices.
 * @param isClosedLoop Whether the pixel chain forms a closed loop.
 * @returns An array of optimized Segments.
 */
export function breakpointsToSegments(
  pixels: Point[],
  breakpoints: number[],
  isClosedLoop: boolean,
): Segment[] {
  const segments: Segment[] = [];
  let start = 0;

  const fullBreakpoints = [...breakpoints, pixels.length - 1];

  for (const end of fullBreakpoints) {
    const fit = fitPixelRange(pixels, { start, end });
    if (fit) {
      segments.push(fit.segment);
    }
    start = end;
  }

  // Apply intersections at junctions
  if (segments.length > 1) {
    for (let i = 0; i < segments.length - 1; i++) {
      applyIntersection(segments[i], segments[i + 1]);
    }
    if (isClosedLoop) {
      applyIntersection(segments[segments.length - 1], segments[0]);
    }
  }

  return segments;
}
