/**
 * Tests for arc (circle) fitting algorithms
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import type { Point } from "./geometry.ts";
import { fitCircle, IncrementalCircleFit, percentile } from "./arc_fit.ts";

const EPSILON = 1e-6;

function assertPointEquals(actual: Point, expected: Point, epsilon = EPSILON) {
  assertAlmostEquals(actual.x, expected.x, epsilon, `x coordinate mismatch`);
  assertAlmostEquals(actual.y, expected.y, epsilon, `y coordinate mismatch`);
}

// ============================================================================
// Basic Circle Fitting Tests
// ============================================================================

Deno.test("fitCircle - fits circle from points", () => {
  // Points on circle with center (0, 0) and radius 5
  const points: Point[] = [
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: -5, y: 0 },
    { x: 0, y: -5 },
  ];

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.circle.center, { x: 0, y: 0 }, 0.01);
    assertAlmostEquals(result.circle.radius, 5, 0.01);
    assertAlmostEquals(result.rmsError, 0, 0.01);
    assertEquals(result.count, 4);
  }
});

Deno.test("fitCircle - fits circle with offset center", () => {
  // Points on circle with center (3, 4) and radius 5
  const points: Point[] = [
    { x: 8, y: 4 },
    { x: 3, y: 9 },
    { x: -2, y: 4 },
    { x: 3, y: -1 },
  ];

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.circle.center, { x: 3, y: 4 }, 0.01);
    assertAlmostEquals(result.circle.radius, 5, 0.01);
    assertAlmostEquals(result.rmsError, 0, 0.01);
  }
});

Deno.test("fitCircle - fits circle with noise", () => {
  // Points near a circle with center (0, 0) and radius 5
  const points: Point[] = [
    { x: 5.1, y: 0 },
    { x: 0, y: 4.9 },
    { x: -5.05, y: 0 },
    { x: 0, y: -5.1 },
  ];

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.circle.center, { x: 0, y: 0 }, 0.2);
    assertAlmostEquals(result.circle.radius, 5, 0.2);
    assertEquals(result.rmsError > 0, true);
    assertEquals(result.rmsError < 0.2, true);
  }
});

Deno.test("fitCircle - returns null for fewer than 3 points", () => {
  assertEquals(fitCircle([]), null);
  assertEquals(fitCircle([{ x: 0, y: 0 }]), null);
  assertEquals(fitCircle([{ x: 0, y: 0 }, { x: 1, y: 1 }]), null);
});

Deno.test("fitCircle - returns null for collinear points", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];

  const result = fitCircle(points);
  assertEquals(result, null);
});

// ============================================================================
// Incremental Circle Fitting Tests
// ============================================================================

Deno.test("IncrementalCircleFit - builds fit incrementally", () => {
  const fitter = new IncrementalCircleFit();

  fitter.addPoint({ x: 5, y: 0 });
  assertEquals(fitter.getCount(), 1);
  assertEquals(fitter.getFit(), null);

  fitter.addPoint({ x: 0, y: 5 });
  assertEquals(fitter.getCount(), 2);
  assertEquals(fitter.getFit(), null);

  fitter.addPoint({ x: -5, y: 0 });
  assertEquals(fitter.getCount(), 3);
  let result = fitter.getFit();
  assertEquals(result !== null, true);

  fitter.addPoint({ x: 0, y: -5 });
  result = fitter.getFit();
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.circle.center, { x: 0, y: 0 }, 0.01);
    assertAlmostEquals(result.circle.radius, 5, 0.01);
    assertEquals(result.count, 4);
  }
});

Deno.test("IncrementalCircleFit - matches batch fitting", () => {
  const points: Point[] = [];
  const radius = 7;
  const centerX = 2;
  const centerY = 3;

  // Use a complete circle for accurate fitting
  for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 4) {
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }

  // Batch fit
  const batchResult = fitCircle(points);

  // Incremental fit
  const fitter = new IncrementalCircleFit();
  for (const p of points) {
    fitter.addPoint(p);
  }
  const incrementalResult = fitter.getFit();

  assertEquals(batchResult !== null && incrementalResult !== null, true);
  if (batchResult && incrementalResult) {
    // Both should produce same results
    assertPointEquals(
      batchResult.circle.center,
      incrementalResult.circle.center,
      0.1,
    );
    assertAlmostEquals(
      batchResult.circle.radius,
      incrementalResult.circle.radius,
      0.1,
    );
  }
});

Deno.test("IncrementalCircleFit - reset clears state", () => {
  const fitter = new IncrementalCircleFit();

  fitter.addPoint({ x: 5, y: 0 });
  fitter.addPoint({ x: 0, y: 5 });
  fitter.addPoint({ x: -5, y: 0 });
  assertEquals(fitter.getCount(), 3);

  fitter.reset();
  assertEquals(fitter.getCount(), 0);
  assertEquals(fitter.getFit(), null);
});

Deno.test("IncrementalCircleFit - getPoints returns all points", () => {
  const fitter = new IncrementalCircleFit();
  const points: Point[] = [
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: -5, y: 0 },
  ];

  for (const p of points) {
    fitter.addPoint(p);
  }

  const retrieved = fitter.getPoints();
  assertEquals(retrieved.length, 3);
  for (let i = 0; i < points.length; i++) {
    assertPointEquals(retrieved[i], points[i]);
  }
});

// ============================================================================
// Error Calculation Tests
// ============================================================================

Deno.test("fitCircle - calculates individual errors", () => {
  const points: Point[] = [
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: -8, y: 0 }, // 3 units farther out to ensure max error > 0.5
    { x: 0, y: -5 },
  ];

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    assertEquals(result.errors.length, 4);
    // One error should be larger than others
    const maxError = Math.max(...result.errors);
    assertEquals(
      maxError > 0.5,
      true,
      `Expected max error > 0.5, got ${maxError}`,
    );
  }
});

Deno.test("fitCircle - median error for outlier", () => {
  const points: Point[] = [
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: -5, y: 0 },
    { x: 0, y: -5 },
    { x: 10, y: 0 }, // Outlier
  ];

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    // Median should be more robust than RMS to the outlier
    assertEquals(result.medianError < result.rmsError, true);
  }
});

Deno.test("percentile - calculates percentiles correctly", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  assertAlmostEquals(percentile(values, 0), 1, EPSILON);
  assertAlmostEquals(percentile(values, 0.5), 6, EPSILON);
  assertAlmostEquals(percentile(values, 0.9), 10, EPSILON);
});
