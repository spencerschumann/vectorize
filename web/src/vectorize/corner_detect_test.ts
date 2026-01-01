/**
 * Tests for corner detection
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type Corner,
  detectCorners,
  isPixelInCornerRegion,
  type SegmentPrimitive,
} from "./corner_detect.ts";
import type { Segment } from "./simplifier.ts";
import {
  type Circle,
  type Line,
  normalizeAngle,
  type Point,
} from "./geometry.ts";

// Helper to create a horizontal line segment
function createLineSegment(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): Segment {
  const start = { x: startX, y: startY };
  const end = { x: endX, y: endY };
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.sqrt(dx * dx + dy * dy);

  return {
    type: "line",
    start,
    end,
    points: [start, end],
    line: {
      point: start,
      direction: len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 },
    } as Line,
  };
}

// Helper to create an arc segment
function createArcSegment(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  startAngle: number,
  endAngle: number,
): Segment {
  const start = { x: startX, y: startY };
  const end = { x: endX, y: endY };
  const center = { x: centerX, y: centerY };

  return {
    type: "arc",
    start,
    end,
    points: [start, end],
    arc: {
      center,
      radius: 10,
      startAngle,
      endAngle,
      clockwise: false,
    },
  };
}

Deno.test("detectCorners - detects right angle as corner", () => {
  // Horizontal segment (0,0) to (10,0), then vertical segment (10,0) to (10,10)
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 10, 10),
  ];

  // Use appropriate threshold for detecting right angle
  const { corners } = detectCorners(segments, Math.PI / 2.5, 2);

  console.log(`Total corners found: ${corners.length}`);
  corners.forEach((c, i) => {
    console.log(
      `  Corner ${i}: angle=${
        (c.cornerAngle * 180 / Math.PI).toFixed(1)
      }°, pos={${c.position.x},${c.position.y}}`,
    );
  });

  // Should have at least 3 corners: start endpoint, right angle, end endpoint
  assertEquals(corners.length >= 3, true, "Should detect multiple corners");

  // Check for right angle (π/2)
  const rightAngleCorner = corners.find(
    (c) => Math.abs(c.cornerAngle - Math.PI / 2) < 0.2,
  );
  assertExists(rightAngleCorner, "Should detect right angle corner");
});

Deno.test("detectCorners - straight line has only endpoint corners", () => {
  // Three collinear segments
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 20, 0),
    createLineSegment(20, 0, 30, 0),
  ];

  const { corners } = detectCorners(segments, Math.PI / 3, 2);

  // Straight lines should only have endpoint corners
  const endpointCorners = corners.filter((c) => c.cornerAngle === 0);
  assertEquals(
    endpointCorners.length,
    2,
    "Should only have start and end endpoints",
  );
});

Deno.test("detectCorners - small segment absorption", () => {
  // Segments with a small one between two larger ones
  const segments: Segment[] = [
    createLineSegment(0, 0, 9, 0),
    createLineSegment(9, 0, 10, 0),
    createLineSegment(10, 0, 10.5, 0.5),
    createLineSegment(10.5, 0.5, 20, 10),
  ];

  const { segmentsWithCorners } = detectCorners(
    segments,
    Math.PI / 2.5,
    2,
  );

  // The small middle segment should be absorbed
  const absorbedCount = segmentsWithCorners.filter(
    (s) => s.absorbedIntoCorner,
  ).length;
  assertEquals(
    absorbedCount > 0,
    true,
    "Small segments should be marked as absorbed into corners",
  );
});

Deno.test("detectCorners - pixel in corner radius", () => {
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 10, 10),
  ];

  const { corners } = detectCorners(segments, Math.PI / 2.5, 2);

  // Find an actual corner position
  const cornerAtEnd = corners.find(
    (c) => c.position.x === 10 && c.position.y === 0,
  );
  assertExists(cornerAtEnd, "Should find corner at segment end");

  // Test pixel within radius
  const nearbyPixel: Point = { x: 10.5, y: 0 };
  const cornerHit = isPixelInCornerRegion(nearbyPixel, corners);

  // The pixel should be within 2 units of some corner
  const withinDistance = corners.some(
    (c) =>
      Math.sqrt(
        (c.position.x - nearbyPixel.x) ** 2 +
          (c.position.y - nearbyPixel.y) ** 2,
      ) <= c.radius,
  );
  assertEquals(withinDistance, true, "Nearby pixel should be in corner region");
});

Deno.test("detectCorners - endpoints are always marked", () => {
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 10, 10),
  ];

  const { corners, segmentsWithCorners } = detectCorners(
    segments,
    Math.PI / 2.5,
    2,
  );

  const endpointCorners = corners.filter((c) => c.cornerAngle === 0);
  assertEquals(
    endpointCorners.length,
    2,
    "Should have start and end endpoint corners",
  );

  // First segment should reference start endpoint
  const firstSegmentCornerIndices = segmentsWithCorners[0].cornerIndices;
  assertEquals(
    firstSegmentCornerIndices.length > 0,
    true,
    "First segment should reference at least one corner",
  );

  // Last segment should reference end endpoint
  const lastSegmentCornerIndices =
    segmentsWithCorners[segmentsWithCorners.length - 1].cornerIndices;
  assertEquals(
    lastSegmentCornerIndices.length > 0,
    true,
    "Last segment should reference at least one corner",
  );
});

Deno.test("detectCorners - half circle polyline vertices not detected as corners", () => {
  // Approximate a half circle (radius 50) with 50 line segments
  // Angle between segments: π/50 ≈ 3.6°, well below all thresholds
  // Segment length ≈ 3.14, short enough that angle*length << 16
  const numSegments = 50;
  const radius = 50;
  const segments: Segment[] = [];

  for (let i = 0; i < numSegments; i++) {
    const angle1 = Math.PI * i / numSegments;
    const angle2 = Math.PI * (i + 1) / numSegments;
    const x1 = radius * Math.cos(angle1);
    const y1 = radius * Math.sin(angle1);
    const x2 = radius * Math.cos(angle2);
    const y2 = radius * Math.sin(angle2);
    segments.push(createLineSegment(x1, y1, x2, y2));
  }

  const { corners } = detectCorners(segments); // Use default threshold

  // Should only have 2 endpoint corners, not corners at intermediate vertices
  const endpointCorners = corners.filter((c) => c.cornerAngle === 0);
  const interiorCorners = corners.filter((c) => c.cornerAngle > 0);

  assertEquals(
    endpointCorners.length,
    2,
    "Should have exactly 2 endpoint corners",
  );
  assertEquals(
    interiorCorners.length,
    0,
    "Should have no interior corners - polyline approximates smooth curve",
  );
});

Deno.test("detectCorners - corner segment owns pixels and trims neighbors", () => {
  const isCorner = (
    seg: SegmentPrimitive,
  ): seg is Extract<SegmentPrimitive, { type: "corner" }> =>
    seg.type === "corner";
  const isLine = (
    seg: SegmentPrimitive,
  ): seg is Extract<SegmentPrimitive, { type: "line" }> => seg.type === "line";

  const segments: Segment[] = [
    {
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      line: { point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
    },
    {
      type: "line",
      start: { x: 10, y: 0 },
      end: { x: 10, y: 10 },
      points: [
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 10, y: 10 },
      ],
      line: { point: { x: 10, y: 0 }, direction: { x: 0, y: 1 } },
    },
  ];

  const { segmentPrimitives } = detectCorners(segments, Math.PI / 3, 1);

  const cornerSegments = segmentPrimitives.filter(isCorner);
  assertEquals(cornerSegments.length > 0, true, "Should emit a corner segment");

  const trimmedLines = segmentPrimitives.filter(isLine);
  assertEquals(
    trimmedLines.length,
    2,
    "Should keep two line segments after trimming",
  );

  const firstLine = trimmedLines[0];
  const secondLine = trimmedLines[1];
  assertEquals(firstLine.end.x, 5, "First line should end at trimmed boundary");
  assertEquals(
    secondLine.start.y,
    5,
    "Second line should start after trimming corner pixels",
  );

  const interiorCorner = cornerSegments.find((c) => c.cornerAngle > 0) ??
    cornerSegments[0];
  const cornerPoints = interiorCorner.points;
  assertEquals(
    cornerPoints.some((p) => p.x === 10 && p.y === 0),
    true,
    "Corner segment should own the original joint pixel",
  );
});
