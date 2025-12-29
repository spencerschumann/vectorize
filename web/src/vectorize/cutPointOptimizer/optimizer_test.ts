import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.122.0/testing/asserts.ts";
import { optimizeWithCutPoints } from "./optimizer.ts";
import type { Point } from "../geometry.ts";
import type { Segment } from "../simplifier.ts";

function createSquare(
  size: number,
  offset: Point,
  pointsPerSide: number,
): Point[] {
  const points: Point[] = [];
  // Top
  for (let i = 0; i < pointsPerSide; i++) {
    points.push({ x: offset.x + (i / pointsPerSide) * size, y: offset.y });
  }
  // Right
  for (let i = 0; i < pointsPerSide; i++) {
    points.push({
      x: offset.x + size,
      y: offset.y + (i / pointsPerSide) * size,
    });
  }
  // Bottom
  for (let i = 0; i < pointsPerSide; i++) {
    points.push({
      x: offset.x + size - (i / pointsPerSide) * size,
      y: offset.y + size,
    });
  }
  // Left
  for (let i = 0; i < pointsPerSide; i++) {
    points.push({
      x: offset.x,
      y: offset.y + size - (i / pointsPerSide) * size,
    });
  }
  return points;
}

function createCircle(
  radius: number,
  center: Point,
  numPoints: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

function createLShape(
  size: number,
  offset: Point,
  pointsPerSide: number,
): Point[] {
  const points: Point[] = [];
  // Vertical
  for (let i = 0; i <= pointsPerSide; i++) {
    points.push({ x: offset.x, y: offset.y + (i / pointsPerSide) * size });
  }
  // Horizontal
  for (let i = 1; i <= pointsPerSide; i++) {
    points.push({
      x: offset.x + (i / pointsPerSide) * size,
      y: offset.y + size,
    });
  }
  return points;
}

Deno.test("optimizeWithCutPoints - Square", () => {
  const squarePoints = createSquare(100, { x: 10, y: 10 }, 20);
  const segments = optimizeWithCutPoints(squarePoints, true, {
    maxSegmentError: 1.0,
  });

  assertEquals(segments.length, 4, "Should have 4 segments for a square");
  assert(
    segments.every((s) => s.type === "line"),
    "All segments should be lines",
  );

  // Check that the corners are sharp
  const corner1 = segments[0].end;
  const corner2 = segments[1].end;
  const corner3 = segments[2].end;
  const corner4 = segments[3].end;

  assertEquals(corner1.x, 110, "Corner 1 X should be at intersection");
  assertEquals(corner1.y, 10, "Corner 1 Y should be at intersection");
  assertEquals(corner2.x, 110, "Corner 2 X should be at intersection");
  assertEquals(corner2.y, 110, "Corner 2 Y should be at intersection");
  assertEquals(corner3.x, 10, "Corner 3 X should be at intersection");
  assertEquals(corner3.y, 110, "Corner 3 Y should be at intersection");
  assertEquals(corner4.x, 10, "Corner 4 X should be at intersection");
});

Deno.test("optimizeWithCutPoints - Circle", () => {
  const circlePoints = createCircle(50, { x: 100, y: 100 }, 80);
  const segments = optimizeWithCutPoints(circlePoints, true);

  assert(
    segments.length >= 1 && segments.length <= 4,
    `Circle should be 1-4 segments, but got ${segments.length}`,
  );
  assert(
    segments.every((s) => s.type === "arc"),
    "All segments should be arcs or a circle",
  );
});

Deno.test("optimizeWithCutPoints - L-Shape", () => {
  const lShapePoints = createLShape(100, { x: 10, y: 10 }, 20);
  const segments = optimizeWithCutPoints(lShapePoints, false);

  assertEquals(segments.length, 2, "Should have 2 segments for an L-shape");
  const [seg1, seg2] = segments;

  assert(seg1.type === "line", "First segment should be a line");
  assert(seg2.type === "line", "Second segment should be a line");

  // Check that the corner is sharp
  const corner = seg1.end;
  assertEquals(corner.x, 10, "Corner X should be at intersection");
  assertEquals(corner.y, 110, "Corner Y should be at intersection");
});
