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

// Helper to create a line segment with pixel-level points (like from skeletonization)
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

  // Generate intermediate points along the line (simulating pixel path)
  const points: Point[] = [start];
  if (len > 0) {
    const numSteps = Math.max(1, Math.floor(len));
    for (let i = 1; i < numSteps; i++) {
      const t = i / numSteps;
      points.push({
        x: startX + dx * t,
        y: startY + dy * t,
      });
    }
  }
  points.push(end);

  return {
    type: "line",
    start,
    end,
    points,
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
  const radius = Math.sqrt((startX - centerX) ** 2 + (startY - centerY) ** 2);

  // Generate intermediate points along the arc (simulating pixel path)
  const points: Point[] = [start];
  
  // Normalize angles to handle wraparound
  let angle = startAngle;
  const angleStep = (endAngle - startAngle) / 10; // 10 segments
  for (let i = 1; i < 10; i++) {
    angle += angleStep;
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }
  points.push(end);

  return {
    type: "arc",
    start,
    end,
    points,
    arc: {
      center,
      radius,
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
  const { corners } = detectCorners(segments);

  console.log(`Total corners found: ${corners.length}`);
  corners.forEach((c, i) => {
    console.log(
      `  Corner ${i}: angle=${
        (c.cornerAngle * 180 / Math.PI).toFixed(1)
      }°, pos={${c.position.x},${c.position.y}}`,
    );
  });

  // Should detect the 90° corner as a curvature peak
  assertEquals(corners.length >= 1, true, "Should detect at least one corner");

  // Check for right angle (π/2)
  const rightAngleCorner = corners.find(
    (c) => Math.abs(c.cornerAngle - Math.PI / 2) < 0.1,
  );
  assertExists(rightAngleCorner, "Should find a corner near 90°");
});

Deno.test("detectCorners - straight line has only no corner peaks", () => {
  // Three collinear segments have zero curvature, no peaks
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 20, 0),
    createLineSegment(20, 0, 30, 0),
  ];

  const { corners } = detectCorners(
    segments,
    6, // windowLength
    0.1, // curvatureThreshold (rad/px)
  );

  // Straight lines have zero curvature, so no curvature peaks (but may have endpoints)
  const curvaturePeaks = corners.filter((c) => c.cornerAngle > 0);
  assertEquals(curvaturePeaks.length, 0, "Straight lines should have no curvature peaks");
});

Deno.test("detectCorners - detects right angle as corner", () => {
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 10, 10),
  ];

  const { corners } = detectCorners(
    segments,
    6, // windowLength
    0.05, // curvatureThreshold (rad/px) - 90° over 6px ≈ 0.26 rad/px
  );

  // Should detect the 90° corner
  const rightAngleCorners = corners.filter((c) => c.cornerAngle > Math.PI / 2.5);
  assertEquals(
    rightAngleCorners.length > 0,
    true,
    "Should detect 90° corner with high curvature",
  );
});

Deno.test("detectCorners - small segment absorption", () => {
  // Segments with a small one between two larger ones that creates a corner
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 10.5, 0.5),
    createLineSegment(10.5, 0.5, 20, 10),
  ];

  const { segmentsWithCorners } = detectCorners(
    segments,
    6, // windowLength
    0.05, // curvatureThreshold
  );

  // The small middle segment should be marked as absorbed
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

  const { corners } = detectCorners(
    segments,
    6, // windowLength
    0.05, // curvatureThreshold
  );

  // Find a corner with high angle (the 90° turn)
  const sharpCorner = corners.find(
    (c) => c.cornerAngle > Math.PI / 2.5,
  );
  assertExists(sharpCorner, "Should find corner at 90° turn");

  // Test pixel within corner radius
  const nearbyPixel: Point = { x: 10.5, y: 0 };
  const inRadius = isPixelInCornerRegion(nearbyPixel, corners);
  assertExists(inRadius, "Pixel near corner should be in radius");
});

Deno.test("detectCorners - half circle polyline vertices not detected as corners", () => {
  // Approximate a smooth half circle (radius 20) with many segments
  // This creates small angles between segments (smooth curve)
  const numSegments = 20;
  const radius = 20;
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

  const { corners } = detectCorners(
    segments,
    6, // windowLength
    0.1, // curvatureThreshold - smooth curves have low curvature
  );

  // Should have no curvature peaks (smooth curve), only endpoints
  const curvaturePeaks = corners.filter((c) => c.cornerAngle > 0);
  assertEquals(curvaturePeaks.length, 0, "Smooth curve should have no curvature peaks");
});

Deno.test("detectCorners - endpoints are always marked", () => {
  const segments: Segment[] = [
    createLineSegment(0, 0, 10, 0),
    createLineSegment(10, 0, 10, 10),
  ];

  const { corners, segmentsWithCorners } = detectCorners(
    segments,
    6, // windowLength
    0.05, // curvatureThreshold
  );

  // Should detect the 90° corner
  const sharpCorners = corners.filter((c) => c.cornerAngle > Math.PI / 2.5);
  assertEquals(
    sharpCorners.length > 0,
    true,
    "Should detect the 90° corner",
  );

  // First segment should reference at least one corner
  const firstSegmentCornerIndices = segmentsWithCorners[0].cornerIndices;
  assertEquals(
    firstSegmentCornerIndices.length > 0,
    true,
    "First segment should reference at least one corner",
  );

  // Last segment should reference at least one corner
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

  const { segmentPrimitives } = detectCorners(segments);

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

Deno.test("detectCorners - closed rounded rectangle with 2 segments per corner", () => {
  // Closed path: a rounded rectangle with 2 line segments per rounded corner
  // This matches the actual fitted polyline output from the simplifier
  
  // Rectangle bounds with corner radius = 5
  const x1 = 10, y1 = 10, x2 = 90, y2 = 90;
  const r = 5; // corner radius

  const segments: Segment[] = [
    // Top edge (left to right, from corner to corner)
    createLineSegment(x1 + r, y1, x2 - r, y1),
    // Top-right rounded corner (2 segments)
    createLineSegment(x2 - r, y1, x2 - r * 0.3, y1 + r * 0.3),
    createLineSegment(x2 - r * 0.3, y1 + r * 0.3, x2, y1 + r),
    // Right edge (top to bottom)
    createLineSegment(x2, y1 + r, x2, y2 - r),
    // Bottom-right rounded corner (2 segments)
    createLineSegment(x2, y2 - r, x2 - r * 0.3, y2 - r * 0.3),
    createLineSegment(x2 - r * 0.3, y2 - r * 0.3, x2 - r, y2),
    // Bottom edge (right to left)
    createLineSegment(x2 - r, y2, x1 + r, y2),
    // Bottom-left rounded corner (2 segments)
    createLineSegment(x1 + r, y2, x1 + r * 0.3, y2 - r * 0.3),
    createLineSegment(x1 + r * 0.3, y2 - r * 0.3, x1, y2 - r),
    // Left edge (bottom to top)
    createLineSegment(x1, y2 - r, x1, y1 + r),
    // Top-left rounded corner (2 segments) - this is the wraparound junction
    createLineSegment(x1, y1 + r, x1 + r * 0.3, y1 + r * 0.3),
    createLineSegment(x1 + r * 0.3, y1 + r * 0.3, x1 + r, y1),
  ];

  const { corners } = detectCorners(
    segments,
    6, // windowLength
    0.2, // curvatureThreshold - high enough to not detect 45-50° rounded corners
  );

  console.log(`Rounded rectangle corners found: ${corners.length}`);
  corners.forEach((c, i) => {
    console.log(
      `  Corner ${i}: angle=${
        (c.cornerAngle * 180 / Math.PI).toFixed(1)
      }°, pos={${c.position.x.toFixed(1)},${c.position.y.toFixed(1)}}`,
    );
  });

  // With 2 segments per corner, each corner has ~45° angles
  // These should not be detected as sharp corners - not even at wraparound
  const sharpCorners = corners.filter((c) => c.cornerAngle > Math.PI / 4);
  assertEquals(
    sharpCorners.length,
    0,
    "Rounded rectangle should have no sharp corners (including at wraparound)",
  );

  // Should have NO endpoint corners (angle = 0) for closed paths
  const endpointCorners = corners.filter((c) => c.cornerAngle === 0);
  assertEquals(
    endpointCorners.length,
    0,
    "Closed paths should not have endpoint corners",
  );
});

Deno.test("detectCorners - closed teardrop with sharp point at wraparound", () => {
  // Closed teardrop shape: circular at bottom, pointed at top (start/end)
  // The sharp point at start/end should be detected via wraparound evaluation
  
  const centerX = 50;
  const centerY = 60;
  const radius = 20;
  
  const segments: Segment[] = [
    // Sharp point at top (this is the wraparound junction)
    createLineSegment(centerX, centerY - radius - 10, centerX + 5, centerY - radius),
    createLineSegment(centerX + 5, centerY - radius, centerX + 10, centerY - radius + 5),
    
    // Right side (curving down)
    createLineSegment(centerX + 10, centerY - radius + 5, centerX + 14, centerY - 5),
    createLineSegment(centerX + 14, centerY - 5, centerX + 15, centerY + 5),
    
    // Bottom curve (rounded)
    createLineSegment(centerX + 15, centerY + 5, centerX + 10, centerY + 12),
    createLineSegment(centerX + 10, centerY + 12, centerX, centerY + 15),
    createLineSegment(centerX, centerY + 15, centerX - 10, centerY + 12),
    createLineSegment(centerX - 10, centerY + 12, centerX - 15, centerY + 5),
    
    // Left side (curving up)
    createLineSegment(centerX - 15, centerY + 5, centerX - 14, centerY - 5),
    createLineSegment(centerX - 14, centerY - 5, centerX - 10, centerY - radius + 5),
    
    // Back to sharp point (completing the teardrop)
    createLineSegment(centerX - 10, centerY - radius + 5, centerX - 5, centerY - radius),
    createLineSegment(centerX - 5, centerY - radius, centerX, centerY - radius - 10),
  ];

  const { corners } = detectCorners(
    segments,
    6, // windowLength
    0.05, // curvatureThreshold
  );

  // Should detect the sharp point at the wraparound location
  const sharpCorners = corners.filter((c) => c.cornerAngle > Math.PI / 3);
  assertEquals(
    sharpCorners.length >= 1,
    true,
    "Should detect sharp point at wraparound junction",
  );

  // Should NOT have endpoint corners (closed path)
  const endpointCorners = corners.filter((c) => c.cornerAngle === 0);
  assertEquals(
    endpointCorners.length,
    0,
    "Closed teardrop should not have endpoint corners",
  );
});

