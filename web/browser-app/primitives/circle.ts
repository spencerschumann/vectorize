/**
 * Circle detection and fitting for vectorization
 */

import type { Circle, VectorPath, Vertex } from "../vectorize.ts";

/**
 * Detect if a closed path represents a circle using robust least-squares fitting
 * Returns circle parameters if the fit is good enough (within epsilon tolerance)
 */
export function detectCircle(
  path: VectorPath,
  vertices: Map<number, Vertex>,
  epsilon: number,
): Circle | null {
  // Must be a closed path with at least 4 points
  if (!path.closed || path.vertices.length < 4) {
    return null;
  }

  const coords = path.vertices.map((id) => vertices.get(id)!);

  // Remove duplicate endpoint if present
  let points = coords;
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first.x === last.x && first.y === last.y) {
      points = coords.slice(0, -1);
    }
  }

  if (points.length < 4) {
    return null;
  }

  // Fit circle using algebraic least-squares method (Pratt method)
  // This is more robust to non-uniform point distributions than simple centroid
  const circle = fitCircleLeastSquares(points);

  if (!circle) {
    return null;
  }

  // Calculate squared distances from fitted center
  const distancesSquared = points.map((p) => {
    const dx = p.x - circle.cx;
    const dy = p.y - circle.cy;
    return dx * dx + dy * dy;
  });

  const radiusSquared = circle.radius * circle.radius;

  // Check if 90th percentile of points are within epsilon, and all points within 2*epsilon
  const minRadiusSquared = (circle.radius - epsilon) *
    (circle.radius - epsilon);
  const maxRadiusSquared = (circle.radius + epsilon) *
    (circle.radius + epsilon);
  const minRadiusSquared2x = (circle.radius - 2 * epsilon) *
    (circle.radius - 2 * epsilon);
  const maxRadiusSquared2x = (circle.radius + 2 * epsilon) *
    (circle.radius + 2 * epsilon);

  // Count how many points fall within epsilon
  const withinEpsilon = distancesSquared.filter(
    (d) => d >= minRadiusSquared && d <= maxRadiusSquared,
  ).length;

  // Check if all points fall within 2*epsilon
  const allWithin2Epsilon = distancesSquared.every(
    (d) => d >= minRadiusSquared2x && d <= maxRadiusSquared2x,
  );

  // Require 90% within epsilon, and 100% within 2*epsilon
  const percentileThreshold = 0.9;
  const isCircle =
    (withinEpsilon / distancesSquared.length) >= percentileThreshold &&
    allWithin2Epsilon;

  console.log(
    `Circle detection: path with ${points.length} points, fitted radius ${
      circle.radius.toFixed(2)
    }, center (${circle.cx.toFixed(2)}, ${circle.cy.toFixed(2)}), ${
      (withinEpsilon / distancesSquared.length * 100).toFixed(1)
    }% within epsilon, all within 2x epsilon => ${
      isCircle ? "CIRCLE" : "not a circle"
    }`,
  );

  if (isCircle) {
    return {
      cx: circle.cx + 0.5, // Shift by 0.5 to align with pixel centers
      cy: circle.cy + 0.5,
      radius: circle.radius,
    };
  }

  return null;
}

/**
 * Fit a circle to points using algebraic least-squares (Pratt method)
 * This minimizes algebraic distance and is more robust than centroid-based fitting
 * Returns null if the fit fails (e.g., points are collinear)
 */
function fitCircleLeastSquares(
  points: Array<{ x: number; y: number }>,
): { cx: number; cy: number; radius: number } | null {
  const n = points.length;

  // Calculate means
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  // Center the points
  const centeredPoints = points.map((p) => ({
    x: p.x - mx,
    y: p.y - my,
  }));

  // Build the matrix for the least-squares system
  // We're solving: [Sxx Sxy Sx] [a]   [Sxxx + Sxyy]
  //                [Sxy Syy Sy] [b] = [Syyy + Sxxy]
  //                [Sx  Sy  n ] [c]   [Sxx  + Syy ]
  // where the circle is (x-a)^2 + (y-b)^2 = c + a^2 + b^2

  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0;
  let Sxxx = 0, Sxyy = 0, Syyy = 0, Sxxy = 0;

  for (const p of centeredPoints) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;

    Sxx += x2;
    Sxy += x * y;
    Syy += y2;
    Sx += x;
    Sy += y;
    Sxxx += x * x2;
    Sxyy += x * y2;
    Syyy += y * y2;
    Sxxy += x2 * y;
  }

  // Right-hand side
  const b1 = Sxxx + Sxyy;
  const b2 = Syyy + Sxxy;
  const b3 = Sxx + Syy;

  // Solve 3x3 system using Cramer's rule
  // Determinant of coefficient matrix
  const det = Sxx * (Syy * n - Sy * Sy) - Sxy * (Sxy * n - Sx * Sy) +
    Sx * (Sxy * Sy - Syy * Sx);

  if (Math.abs(det) < 1e-10) {
    // Singular matrix - points are likely collinear
    return null;
  }

  // Solve for a (x-offset from mx)
  const detA = b1 * (Syy * n - Sy * Sy) - Sxy * (b2 * n - b3 * Sy) +
    Sx * (b2 * Sy - Syy * b3);
  const a = detA / det / 2;

  // Solve for b (y-offset from my)
  const detB = Sxx * (b2 * n - b3 * Sy) - b1 * (Sxy * n - Sx * Sy) +
    Sx * (Sxy * b3 - b2 * Sx);
  const b = detB / det / 2;

  // Solve for c
  const detC = Sxx * (Syy * b3 - Sy * b2) - Sxy * (Sxy * b3 - Sx * b2) +
    b1 * (Sxy * Sy - Syy * Sx);
  const c = detC / det;

  // Calculate actual center (add back the mean offset)
  const cx = a + mx;
  const cy = b + my;

  // Calculate radius: r^2 = c + a^2 + b^2
  const r2 = c + a * a + b * b;

  if (r2 <= 0) {
    // Invalid circle (negative or zero radius)
    return null;
  }

  const radius = Math.sqrt(r2);

  return { cx, cy, radius };
}
