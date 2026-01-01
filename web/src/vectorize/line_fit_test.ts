/**
 * Tests for line fitting algorithms
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import type { Point } from "./geometry.ts";
import { fitLine, IncrementalLineFit, percentile } from "./line_fit.ts";

const EPSILON = 1e-6;

function assertPointEquals(actual: Point, expected: Point, epsilon = EPSILON) {
  assertAlmostEquals(actual.x, expected.x, epsilon, `x coordinate mismatch`);
  assertAlmostEquals(actual.y, expected.y, epsilon, `y coordinate mismatch`);
}

function assertDirectionAligned(
  direction: Point,
  points: Point[],
  msg: string,
) {
  // Check alignment with first-to-last point progression
  const progressionDx = points[points.length - 1].x - points[0].x;
  const progressionDy = points[points.length - 1].y - points[0].y;
  const dotProduct = direction.x * progressionDx + direction.y * progressionDy;
  assertEquals(
    dotProduct > 0,
    true,
    `${msg}: Direction should align with point progression (dot=${
      dotProduct.toFixed(3)
    })`,
  );
}

// ============================================================================
// Basic Line Fitting Tests
// ============================================================================

Deno.test("fitLine - fits horizontal line", () => {
  const points: Point[] = [
    { x: 0, y: 5 },
    { x: 1, y: 5 },
    { x: 2, y: 5 },
    { x: 3, y: 5 },
    { x: 4, y: 5 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.line.point, { x: 2, y: 5 });
    assertPointEquals(result.line.direction, { x: 1, y: 0 }, 0.01);
    assertAlmostEquals(result.rmsError, 0, EPSILON);
    assertEquals(result.count, 5);
    assertDirectionAligned(result.line.direction, points, "Horizontal line");
  }
});

Deno.test("fitLine - fits vertical line", () => {
  const points: Point[] = [
    { x: 3, y: 0 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
    { x: 3, y: 3 },
    { x: 3, y: 4 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.line.point, { x: 3, y: 2 });
    assertPointEquals(result.line.direction, { x: 0, y: 1 }, 0.01);
    assertAlmostEquals(result.rmsError, 0, EPSILON);
    assertDirectionAligned(result.line.direction, points, "Vertical line");
  }
});

Deno.test("fitLine - fits diagonal line", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
    { x: 4, y: 4 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.line.point, { x: 2, y: 2 });
    // Direction should be (1,1) normalized = (1/√2, 1/√2)
    assertPointEquals(
      result.line.direction,
      { x: 1 / Math.sqrt(2), y: 1 / Math.sqrt(2) },
      0.01,
    );
    assertAlmostEquals(result.rmsError, 0, EPSILON);
    assertDirectionAligned(result.line.direction, points, "Diagonal line");
  }
});

Deno.test("fitLine - fits line with noise", () => {
  const points: Point[] = [
    { x: 0, y: 0.1 },
    { x: 1, y: 1.0 },
    { x: 2, y: 1.9 },
    { x: 3, y: 3.1 },
    { x: 4, y: 4.0 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    // Should still fit roughly a diagonal line
    assertPointEquals(result.line.point, { x: 2, y: 2 }, 0.1);
    assertPointEquals(
      result.line.direction,
      { x: 1 / Math.sqrt(2), y: 1 / Math.sqrt(2) },
      0.1,
    );
    // Error should be small but non-zero
    assertEquals(result.rmsError > 0, true);
    assertEquals(result.rmsError < 0.2, true);
  }
});

Deno.test("fitLine - returns null for single point", () => {
  const points: Point[] = [{ x: 1, y: 2 }];
  const result = fitLine(points);
  assertEquals(result, null);
});

Deno.test("fitLine - returns null for coincident points", () => {
  const points: Point[] = [
    { x: 1, y: 2 },
    { x: 1, y: 2 },
    { x: 1, y: 2 },
  ];
  const result = fitLine(points);
  assertEquals(result, null);
});

Deno.test("fitLine - calculates errors correctly", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 1 }, // 1 unit away from y=0 line
    { x: 3, y: 0 },
    { x: 4, y: 0 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    // One point is 1 unit away, others are close to the line
    assertEquals(result.errors.length, 5);
    assertEquals(Math.max(...result.errors) > 0.5, true);
  }
});

// ============================================================================
// Incremental Line Fitting Tests
// ============================================================================

Deno.test("IncrementalLineFit - builds fit incrementally", () => {
  const fitter = new IncrementalLineFit();

  fitter.addPoint({ x: 0, y: 0 });
  assertEquals(fitter.getCount(), 1);
  assertEquals(fitter.getFit(), null); // Need at least 2 points

  fitter.addPoint({ x: 1, y: 1 });
  assertEquals(fitter.getCount(), 2);
  let result = fitter.getFit();
  assertEquals(result !== null, true);

  fitter.addPoint({ x: 2, y: 2 });
  fitter.addPoint({ x: 3, y: 3 });
  fitter.addPoint({ x: 4, y: 4 });

  result = fitter.getFit();
  assertEquals(result !== null, true);
  if (result) {
    assertPointEquals(result.line.point, { x: 2, y: 2 });
    assertPointEquals(
      result.line.direction,
      { x: 1 / Math.sqrt(2), y: 1 / Math.sqrt(2) },
      0.01,
    );
    assertEquals(result.count, 5);
  }
});

Deno.test("IncrementalLineFit - matches batch fitting", () => {
  const points: Point[] = [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 3 },
    { x: 3, y: 4 },
    { x: 4, y: 5 },
  ];

  // Batch fit
  const batchResult = fitLine(points);

  // Incremental fit
  const fitter = new IncrementalLineFit();
  for (const p of points) {
    fitter.addPoint(p);
  }
  const incrementalResult = fitter.getFit();

  assertEquals(batchResult !== null && incrementalResult !== null, true);
  if (batchResult && incrementalResult) {
    assertPointEquals(
      batchResult.line.point,
      incrementalResult.line.point,
      0.001,
    );
    assertPointEquals(
      batchResult.line.direction,
      incrementalResult.line.direction,
      0.001,
    );
    assertAlmostEquals(
      batchResult.rmsError,
      incrementalResult.rmsError,
      0.001,
    );
  }
});

Deno.test("IncrementalLineFit - reset clears state", () => {
  const fitter = new IncrementalLineFit();

  fitter.addPoint({ x: 0, y: 0 });
  fitter.addPoint({ x: 1, y: 1 });
  assertEquals(fitter.getCount(), 2);

  fitter.reset();
  assertEquals(fitter.getCount(), 0);
  assertEquals(fitter.getFit(), null);
});

Deno.test("IncrementalLineFit - getPoints returns all points", () => {
  const fitter = new IncrementalLineFit();
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
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

Deno.test("fitLine - median error for symmetric noise", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 }, // Outlier
    { x: 3, y: 3 },
    { x: 4, y: 4 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    // Median should be more robust than RMS
    assertEquals(result.medianError < result.rmsError, true);
  }
});

Deno.test("percentile - calculates percentiles correctly", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  assertAlmostEquals(percentile(values, 0), 1, EPSILON);
  assertAlmostEquals(percentile(values, 0.5), 6, EPSILON); // Median
  assertAlmostEquals(percentile(values, 0.9), 10, EPSILON);
  assertAlmostEquals(percentile(values, 1.0), 10, EPSILON);
});

Deno.test("percentile - handles empty array", () => {
  assertEquals(percentile([], 0.5), 0);
});

Deno.test("percentile - handles single element", () => {
  assertAlmostEquals(percentile([42], 0.5), 42, EPSILON);
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("fitLine - handles collinear points with different spacing", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 5, y: 5 }, // Larger gap
    { x: 10, y: 10 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    // Should still fit perfectly
    assertAlmostEquals(result.rmsError, 0, 0.001);
  }
});

Deno.test("fitLine - handles nearly vertical line", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 0.01, y: 1 },
    { x: 0.02, y: 2 },
    { x: 0.03, y: 3 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    // Direction should be nearly vertical
    assertEquals(Math.abs(result.line.direction.y) > 0.99, true);
  }
});

Deno.test("fitLine - handles nearly horizontal line", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0.01 },
    { x: 2, y: 0.02 },
    { x: 3, y: 0.03 },
  ];

  const result = fitLine(points);
  assertEquals(result !== null, true);
  if (result) {
    // Direction should be nearly horizontal
    assertEquals(Math.abs(result.line.direction.x) > 0.99, true);
  }
});
