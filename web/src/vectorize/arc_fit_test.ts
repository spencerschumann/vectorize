/**
 * Tests for arc (circle) fitting algorithms
 */

import { assertAlmostEquals, assertEquals, assertExists } from "@std/assert";
import type { Point } from "./geometry.ts";
import {
  fitCircle,
  IncrementalCircleFit,
  isClockwiseAngles,
  isLargeArc,
  percentile,
  signedSweep,
  svgArcFlags,
} from "./arc_fit.ts";

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

// ============================================================================
// Arc Angle Calculation Tests
// ============================================================================

Deno.test("fitCircle - clockwise 90° arc, startAngle normalized to [0, 2π)", () => {
  // Test various quadrants to ensure startAngle is always [0, 2π)
  const testCases = [
    {
      start: { x: 5, y: 0 },
      mid: { x: 3.5, y: 3.5 },
      end: { x: 0, y: 5 },
      expectedAngle: 0,
    }, // Right (0°) to Bottom (90°)
    {
      start: { x: 0, y: 5 },
      mid: { x: -3.5, y: 3.5 },
      end: { x: -5, y: 0 },
      expectedAngle: Math.PI / 2,
    }, // Bottom (90°) to Left (180°)
    {
      start: { x: -5, y: 0 },
      mid: { x: -3.5, y: -3.5 },
      end: { x: 0, y: -5 },
      expectedAngle: Math.PI,
    }, // Left (180°) to Top (270°)
    {
      start: { x: 0, y: -5 },
      mid: { x: 3.5, y: -3.5 },
      end: { x: 5, y: 0 },
      expectedAngle: 3 * Math.PI / 2,
    }, // Top (270°) to Right (0°)
  ];

  for (const tc of testCases) {
    const points: Point[] = [
      tc.start,
      tc.mid,
      tc.end,
    ];
    const result = fitCircle(points);
    assertEquals(
      result !== null,
      true,
      `Failed to fit circle for start angle ${tc.expectedAngle}`,
    );
    if (result) {
      assertAlmostEquals(
        result.startAngle,
        tc.expectedAngle,
        0.1,
        `Expected angle ${tc.expectedAngle} for point (${tc.start.x}, ${tc.start.y})`,
      );
      assertAlmostEquals(
        result.endAngle,
        tc.expectedAngle + Math.PI / 2,
        0.1,
        `Expected end angle ${
          tc.expectedAngle + Math.PI / 2
        } for point (${tc.end.x}, ${tc.end.y})`,
      );
    }
  }
});

Deno.test("fitCircle - counterclockwise arc (screen Y-down) has positive sweep", () => {
  // Arc from 0° to 90° in screen Y-down coords (where Y increases downward)
  // This appears as clockwise in standard math coords but CCW in screen coords
  const radius = 5;
  const points: Point[] = [];
  // Start at 0°, sweep to 90° (increasing angle = CCW in screen Y-down)
  for (let angle = 0; angle <= Math.PI / 2; angle += Math.PI / 8) {
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    // In screen Y-down coords with increasing Y downward, this is actually clockwise
    // because positive Y angles move clockwise
    const sweep = result.endAngle - result.startAngle;
    assertEquals(
      isClockwiseAngles(result),
      true,
      "Arc should be clockwise in screen Y-down",
    );
    assertEquals(
      sweep < 0,
      true,
      `CW arc should have negative sweep, got ${sweep}`,
    );
    assertAlmostEquals(
      Math.abs(signedSweep(result)),
      Math.PI / 2,
      0.2,
      "Sweep should be ~90°",
    );
  }
});

Deno.test("fitCircle - clockwise arc (screen Y-down) has negative sweep", () => {
  // Arc from 90° to 0° (decreasing angle = CW in screen Y-down)
  const radius = 5;
  const points: Point[] = [];
  // Start at 90°, end at 0° (going backwards = CCW in screen Y-down)
  for (let angle = Math.PI / 2; angle >= 0; angle -= Math.PI / 8) {
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    // Decreasing angles = CCW in screen Y-down
    const sweep = result.endAngle - result.startAngle;
    assertEquals(
      isClockwiseAngles(result),
      false,
      "Arc should be counterclockwise in screen Y-down",
    );
    assertEquals(
      sweep > 0,
      true,
      `CCW arc should have positive sweep, got ${sweep}`,
    );
    assertAlmostEquals(
      Math.abs(signedSweep(result)),
      Math.PI / 2,
      0.2,
      "Sweep should be ~90°",
    );
  }
});

Deno.test("fitCircle - large arc (270°) in screen Y-down", () => {
  const radius = 5;
  const points: Point[] = [];
  // Start at 0°, sweep 270° (will be detected as clockwise in screen Y-down)
  for (let angle = 0; angle <= 3 * Math.PI / 2; angle += Math.PI / 6) {
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    const sweep = result.endAngle - result.startAngle;
    // Large arc sweeping through increasing angles
    assertAlmostEquals(
      Math.abs(signedSweep(result)),
      3 * Math.PI / 2,
      0.3,
      "Sweep should be ~270°",
    );
    // Direction depends on screen Y-down coordinate system
    assertEquals(isClockwiseAngles(result), true);
    assertEquals(sweep < 0, true, "Should have negative sweep for clockwise");
  }
});

Deno.test("fitCircle - arc crossing 0° boundary", () => {
  const radius = 5;
  const points: Point[] = [];
  // Arc from 315° (-45°) to 45° (counterclockwise, crossing 0°)
  for (let angle = -Math.PI / 4; angle <= Math.PI / 4; angle += Math.PI / 8) {
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    // startAngle should be normalized to [0, 2π), so 315° = 7π/4
    assertAlmostEquals(
      result.startAngle,
      7 * Math.PI / 4,
      0.1,
      "Start should be ~315°",
    );
    assertAlmostEquals(
      Math.abs(signedSweep(result)),
      Math.PI / 2,
      0.2,
      "Sweep should be ~90°",
    );
  }
});

Deno.test("fitCircle - semicircle arc", () => {
  const radius = 5;
  const points: Point[] = [];
  // Semicircle from 0° to 180°
  for (let angle = 0; angle <= Math.PI; angle += Math.PI / 8) {
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    assertAlmostEquals(
      Math.abs(signedSweep(result)),
      Math.PI,
      0.2,
      "Sweep should be ~180°",
    );
    // Semicircle from 0° to 180° is clockwise in screen Y-down
    assertEquals(isClockwiseAngles(result), true);
  }
});

Deno.test("IncrementalCircleFit - angles match batch fit", () => {
  const radius = 5;
  const points: Point[] = [];
  // Quarter circle from 0° to 90°
  for (let angle = 0; angle <= Math.PI / 2; angle += Math.PI / 8) {
    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }

  const batchResult = fitCircle(points);

  const fitter = new IncrementalCircleFit();
  for (const p of points) {
    fitter.addPoint(p);
  }
  const incrementalResult = fitter.getFit();

  assertEquals(batchResult !== null && incrementalResult !== null, true);
  if (batchResult && incrementalResult) {
    assertAlmostEquals(
      batchResult.startAngle,
      incrementalResult.startAngle,
      0.01,
    );
    assertAlmostEquals(batchResult.endAngle, incrementalResult.endAngle, 0.01);
    assertAlmostEquals(
      Math.abs(signedSweep(batchResult)),
      Math.abs(signedSweep(incrementalResult)),
      0.01,
    );
    assertEquals(
      isClockwiseAngles(batchResult),
      isClockwiseAngles(incrementalResult),
    );
  }
});

Deno.test("fitCircle - endAngle is startAngle plus signed sweep (CCW)", () => {
  // Quarter circle with decreasing angle (screen Y-down: counterclockwise)
  const radius = 5;
  const points: Point[] = [];
  for (let angle = Math.PI / 2; angle >= 0; angle -= Math.PI / 8) {
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  const result = fitCircle(points);
  assertEquals(result !== null, true);
  if (result) {
    const signed = signedSweep(result);
    assertAlmostEquals(
      result.endAngle,
      result.startAngle + signed,
      1e-6,
      "endAngle should equal startAngle plus signed sweep",
    );
    const diff = result.endAngle - result.startAngle;
    assertAlmostEquals(Math.abs(diff), Math.abs(signed), 1e-6);
    assertEquals(signed > 0, true);
  }
});
Deno.test("fitCircle - counterclockwise 90° arc, startAngle normalized to [0, 2π)", () => {
  // Test quarter arcs going counterclockwise (decreasing atan2 angle in screen Y-down)
  const testCases = [
    {
      start: { x: 5, y: 0 },
      mid: { x: 3.53, y: -3.53 },
      end: { x: 0, y: -5 },
      expectedAngle: 0,
    }, // Right (0°) to Top (-90°)
    {
      start: { x: 0, y: 5 },
      mid: { x: 3.53, y: 3.53 },
      end: { x: 5, y: 0 },
      expectedAngle: Math.PI / 2,
    }, // Bottom (90°) to Right (0°)
    {
      start: { x: -5, y: 0 },
      mid: { x: -3.53, y: 3.53 },
      end: { x: 0, y: 5 },
      expectedAngle: Math.PI,
    }, // Left (180°) to Bottom (90°)
    {
      start: { x: 0, y: -5 },
      mid: { x: -3.53, y: -3.53 },
      end: { x: -5, y: 0 },
      expectedAngle: 3 * Math.PI / 2,
    }, // Top (270°) to Left (180°)
  ];

  for (const tc of testCases) {
    const points: Point[] = [tc.start, tc.mid, tc.end];
    const result = fitCircle(points);
    assertExists(result);
    assertAlmostEquals(result.startAngle, tc.expectedAngle, 0.1);
    // For counterclockwise quarter arcs the end angle should be start - 90°
    assertAlmostEquals(result.endAngle, tc.expectedAngle - Math.PI / 2, 0.1);
  }
});

Deno.test("fitCircle - parameterized starts and sweeps, startAngle normalized to [0, 2π)", () => {
  const radius = 5;
  const twoPi = 2 * Math.PI;
  const starts: number[] = [];
  for (let a = 0; a < twoPi - 1e-12; a += Math.PI / 6) starts.push(a);

  const sweepMags = [
    Math.PI / 4,
    Math.PI / 2,
    3 / 4 * Math.PI,
    Math.PI,
    3 / 2 * Math.PI,
    2 * Math.PI,
  ];

  for (const start of starts) {
    for (const mag of sweepMags) {
      for (const dir of [1, -1]) {
        const sweep = dir * mag;
        const absMag = Math.abs(sweep);
        const nPts = absMag < Math.PI ? 3 : 6;
        const pts: Point[] = [];
        for (let i = 0; i < nPts; i++) {
          const t = i / (nPts - 1);
          const ang = start + sweep * t;
          pts.push({ x: radius * Math.cos(ang), y: radius * Math.sin(ang) });
        }

        const result = fitCircle(pts);
        assertExists(result);

        // Debug output - log the points being tested
        console.log(
          `Testing start=${start / Math.PI}π, sweep=${
            sweep / Math.PI
          }π, points=`,
          pts,
        );
        console.log(
          `  Fitted arc: startAngle=${result.startAngle / Math.PI}π, endAngle=${
            result.endAngle / Math.PI
          }π, center=(${result.circle.center.x.toFixed(2)}, ${
            result.circle.center.y.toFixed(2)
          }), radius=${result.circle.radius.toFixed(2)}`,
        );

        // If the fitted start is very close to 2π, treat it as 0 for comparison
        if (Math.abs(result.startAngle - twoPi) < 1e-6) {
          result.startAngle -= twoPi;
          result.endAngle -= twoPi;
        }

        const testDesc = `start=${start / Math.PI}π, sweep=${sweep / Math.PI}π`;

        // Start angle should match (within tolerance)
        const expectedStart = start;
        assertAlmostEquals(result.startAngle, expectedStart, 1e-6, testDesc);

        // Sweep magnitude should match (within tolerance)
        assertAlmostEquals(
          Math.abs(signedSweep(result)),
          absMag,
          1e-6,
          testDesc,
        );

        // Direction should match sign of sweep (negative => clockwise)
        assertEquals(isClockwiseAngles(result), sweep < 0, testDesc);
      }
    }
  }
});
