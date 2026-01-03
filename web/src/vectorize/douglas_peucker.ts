/**
 * Douglas-Peucker simplification for polyline points.
 */

import type { Point } from "./geometry.ts";
import { distanceSquared } from "./geometry.ts";

/**
 * Compute perpendicular distance from a point to a line segment.
 */
export function distancePointToSegmentSq(p: Point, a: Point, b: Point): number {
  const l2 = distanceSquared(a, b);
  if (l2 === 0) return distanceSquared(p, a);

  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * (b.x - a.x);
  const projY = a.y + t * (b.y - a.y);

  return distanceSquared(p, { x: projX, y: projY });
}

/**
 * Simplify a polyline with Douglas-Peucker.
 * @param points Ordered polyline points
 * @param epsilon Maximum allowed deviation
 */
export function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return [...points];

  let maxDistSq = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const distSq = distancePointToSegmentSq(points[i], points[0], points[points.length - 1]);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      index = i;
    }
  }

  if (Math.sqrt(maxDistSq) > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
}
