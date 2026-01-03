/**
 * Unit tests for global_fitter.ts
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type ArcPrimitive,
  globalFit,
  type LinePrimitive,
  type Primitive,
  primitivesToGCode,
  type StrokeInput,
} from "./global_fitter.ts";
import type { Point } from "./geometry.ts";

// ============================================================================
// Helper Functions
// ============================================================================

function createStraightLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  numPoints: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    points.push({
      x: x0 + t * (x1 - x0),
      y: y0 + t * (y1 - y0),
    });
  }
  return points;
}

function createCircularArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  numPoints: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const angle = startAngle + t * (endAngle - startAngle);
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }
  return points;
}

function generatePixelsAroundPath(path: Point[], width: number): Point[] {
  const pixels: Point[] = [];
  for (const pt of path) {
    // Add nearby points to simulate thickness (includes center when dx=0, dy=0)
    for (let dx = -width; dx <= width; dx++) {
      for (let dy = -width; dy <= width; dy++) {
        if (dx * dx + dy * dy <= width * width) {
          pixels.push({
            x: pt.x + dx,
            y: pt.y + dy,
          });
        }
      }
    }
  }
  return pixels;
}

// ============================================================================
// Tests
// ============================================================================

Deno.test("globalFit - simple straight line", () => {
  const dpPoints = createStraightLine(0, 0, 100, 0, 10);
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, { tolerance: 5.0 });

  assertExists(result);
  assertExists(result.primitives);
  assertEquals(result.primitives.length >= 1, true);

  // Should produce at least one line primitive
  const hasLine = result.primitives.some((p) => p.type === "line");
  assertEquals(hasLine, true);
});

Deno.test("globalFit - circular arc", () => {
  const cx = 50;
  const cy = 50;
  const r = 30;
  const startAngle = 0;
  const endAngle = Math.PI / 2; // Quarter circle

  const dpPoints = createCircularArc(cx, cy, r, startAngle, endAngle, 20);
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, {
    tolerance: 5.0,
    curvatureLambda: 10.0,
  });

  assertExists(result);
  assertExists(result.primitives);
  assertEquals(result.primitives.length >= 1, true);
});

Deno.test("globalFit - L-shape (line + line with corner)", () => {
  // Create an L shape: horizontal line then vertical line
  const horizontal = createStraightLine(0, 0, 50, 0, 10);
  const vertical = createStraightLine(50, 0, 50, 50, 10);

  // Remove duplicate point at corner
  const dpPoints = [...horizontal, ...vertical.slice(1)];
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, { tolerance: 5.0 });

  assertExists(result);
  assertExists(result.primitives);

  // Should produce multiple primitives for the corner
  assertEquals(result.primitives.length >= 2, true);
});

Deno.test("globalFit - S-curve", () => {
  // Create an S-curve with two arcs
  const arc1 = createCircularArc(25, 25, 25, Math.PI, 0, 15);
  const arc2 = createCircularArc(75, 25, 25, Math.PI, 0, 15);

  const dpPoints = [...arc1, ...arc2];
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, {
    tolerance: 5.0,
    curvatureLambda: 10.0,
  });

  assertExists(result);
  assertExists(result.primitives);
  assertEquals(result.primitives.length >= 1, true);
});

Deno.test("globalFit - single point", () => {
  const dpPoints: Point[] = [{ x: 10, y: 10 }];
  const rawPixels: Point[] = [{ x: 10, y: 10 }];

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input);

  assertExists(result);
  assertExists(result.primitives);
  assertEquals(result.primitives.length, 0);
});

Deno.test("globalFit - two points (single segment)", () => {
  const dpPoints: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, { tolerance: 5.0 });

  assertExists(result);
  assertExists(result.primitives);
  assertEquals(result.primitives.length, 1);
  assertEquals(result.primitives[0].type, "line");
});

Deno.test("globalFit - diagonal line", () => {
  const dpPoints = createStraightLine(0, 0, 100, 100, 15);
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, { tolerance: 5.0 });

  assertExists(result);
  assertEquals(result.primitives.length >= 1, true);

  const hasLine = result.primitives.some((p) => p.type === "line");
  assertEquals(hasLine, true);
});

Deno.test("globalFit - full circle", () => {
  const cx = 50;
  const cy = 50;
  const r = 30;

  const dpPoints = createCircularArc(cx, cy, r, 0, 2 * Math.PI, 40);
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, {
    tolerance: 5.0,
    curvatureLambda: 10.0,
  });

  assertExists(result);
  assertExists(result.primitives);

  // Full circle might be split into multiple arcs
  const hasArc = result.primitives.some((p) => p.type === "arc");
  assertEquals(hasArc, true);
});

Deno.test("globalFit - complex path with multiple segments", () => {
  // Line + arc + line
  const line1 = createStraightLine(0, 50, 30, 50, 8);
  const arc = createCircularArc(30, 30, 20, Math.PI / 2, 0, 10);
  const line2 = createStraightLine(50, 30, 80, 30, 8);

  const dpPoints = [...line1, ...arc.slice(1), ...line2.slice(1)];
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, {
    tolerance: 5.0,
    curvatureLambda: 20.0,
  });

  assertExists(result);
  assertExists(result.primitives);
  assertEquals(result.primitives.length >= 1, true);
});

Deno.test("primitivesToGCode - line primitive", () => {
  const primitives: Primitive[] = [
    {
      type: "line",
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 50 },
    },
  ];

  const gcode = primitivesToGCode(primitives);

  assertEquals(gcode.length, 1);
  assertEquals(gcode[0].startsWith("G1"), true);
  assertEquals(gcode[0].includes("X100"), true);
  assertEquals(gcode[0].includes("Y50"), true);
});

Deno.test("primitivesToGCode - arc primitive counter-clockwise", () => {
  const primitives: Primitive[] = [
    {
      type: "arc",
      cx: 50,
      cy: 50,
      r: 30,
      startAngle: 0,
      endAngle: Math.PI / 2,
      p0: { x: 80, y: 50 },
      p1: { x: 50, y: 80 },
    },
  ];

  const gcode = primitivesToGCode(primitives);

  assertEquals(gcode.length, 1);
  assertEquals(gcode[0].startsWith("G3"), true); // Counter-clockwise
  assertEquals(gcode[0].includes("I"), true);
  assertEquals(gcode[0].includes("J"), true);
});

Deno.test("primitivesToGCode - multiple primitives", () => {
  const primitives: Primitive[] = [
    {
      type: "line",
      p0: { x: 0, y: 0 },
      p1: { x: 50, y: 0 },
    },
    {
      type: "arc",
      cx: 50,
      cy: 25,
      r: 25,
      startAngle: -Math.PI / 2,
      endAngle: Math.PI / 2,
      p0: { x: 50, y: 0 },
      p1: { x: 50, y: 50 },
    },
    {
      type: "line",
      p0: { x: 50, y: 50 },
      p1: { x: 0, y: 50 },
    },
  ];

  const gcode = primitivesToGCode(primitives);

  assertEquals(gcode.length, 3);
  assertEquals(gcode[0].startsWith("G1"), true);
  assertEquals(gcode[1].startsWith("G"), true);
  assertEquals(gcode[2].startsWith("G1"), true);
});

Deno.test("globalFit - respects tolerance parameter", () => {
  const dpPoints = createStraightLine(0, 0, 100, 0, 20);
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  // With high tolerance, should produce fewer primitives
  const result1 = globalFit(input, { tolerance: 10.0 });

  // With low tolerance, might produce more primitives (depending on fit quality)
  const result2 = globalFit(input, { tolerance: 0.5 });

  assertExists(result1);
  assertExists(result2);

  // Both should produce valid results
  assertEquals(result1.primitives.length >= 1, true);
  assertEquals(result2.primitives.length >= 1, true);
});

Deno.test("globalFit - endpoint continuity", () => {
  const dpPoints = createStraightLine(0, 0, 100, 100, 30);
  const rawPixels = generatePixelsAroundPath(dpPoints, 2);

  const input: StrokeInput = {
    dpPoints,
    rawPixels,
  };

  const result = globalFit(input, { tolerance: 3.0 });

  assertExists(result);

  // Check that consecutive primitives are connected
  for (let i = 1; i < result.primitives.length; i++) {
    const prev = result.primitives[i - 1];
    const curr = result.primitives[i];

    // Endpoints should be close (allowing for floating point error)
    const dx = prev.p1.x - curr.p0.x;
    const dy = prev.p1.y - curr.p0.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    assertEquals(
      dist < 5.0,
      true,
      `Gap between primitives ${i - 1} and ${i}: ${dist}`,
    );
  }
});
