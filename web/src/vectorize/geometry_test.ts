/**
 * Tests for geometric primitives and operations
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  add,
  angle,
  angleBetween,
  angleOnCircle,
  type Arc,
  arcArcIntersection,
  arcEndPoint,
  arcStartPoint,
  arcSweepAngle,
  type Circle,
  circleCircleIntersection,
  cross,
  distance,
  distanceSquared,
  distanceToArc,
  distanceToCircle,
  distanceToLine,
  dot,
  isAngleInArc,
  type Line,
  lineArcIntersection,
  lineCircleIntersection,
  lineFromPoints,
  lineLineIntersection,
  lineParameter,
  magnitude,
  normalize,
  normalizeAngle,
  type Point,
  pointOnArc,
  pointsEqual,
  projectPointOnCircle,
  projectPointOnLine,
  rotate,
  scale,
  subtract,
} from "./geometry.ts";

const EPSILON = 1e-6;

function assertPointEquals(actual: Point, expected: Point, epsilon = EPSILON) {
  assertAlmostEquals(actual.x, expected.x, epsilon, `x coordinate mismatch`);
  assertAlmostEquals(actual.y, expected.y, epsilon, `y coordinate mismatch`);
}

// ============================================================================
// Point Operations Tests
// ============================================================================

Deno.test("distance - calculates distance between points", () => {
  assertEquals(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assertEquals(distance({ x: 1, y: 1 }, { x: 4, y: 5 }), 5);
  assertEquals(distance({ x: -1, y: -1 }, { x: 2, y: 3 }), 5);
});

Deno.test("distanceSquared - calculates squared distance", () => {
  assertEquals(distanceSquared({ x: 0, y: 0 }, { x: 3, y: 4 }), 25);
  assertEquals(distanceSquared({ x: 1, y: 1 }, { x: 4, y: 5 }), 25);
});

Deno.test("add - adds two points", () => {
  assertPointEquals(add({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: 4, y: 6 });
  assertPointEquals(add({ x: -1, y: 2 }, { x: 3, y: -4 }), { x: 2, y: -2 });
});

Deno.test("subtract - subtracts two points", () => {
  assertPointEquals(subtract({ x: 5, y: 7 }, { x: 2, y: 3 }), { x: 3, y: 4 });
  assertPointEquals(subtract({ x: 1, y: 1 }, { x: 1, y: 1 }), { x: 0, y: 0 });
});

Deno.test("scale - scales a point", () => {
  assertPointEquals(scale({ x: 3, y: 4 }, 2), { x: 6, y: 8 });
  assertPointEquals(scale({ x: 3, y: 4 }, 0.5), { x: 1.5, y: 2 });
  assertPointEquals(scale({ x: 3, y: 4 }, -1), { x: -3, y: -4 });
});

Deno.test("dot - calculates dot product", () => {
  assertEquals(dot({ x: 1, y: 2 }, { x: 3, y: 4 }), 11);
  assertEquals(dot({ x: 1, y: 0 }, { x: 0, y: 1 }), 0); // Perpendicular
  assertEquals(dot({ x: 2, y: 3 }, { x: -2, y: -3 }), -13); // Opposite
});

Deno.test("cross - calculates cross product magnitude", () => {
  assertEquals(cross({ x: 1, y: 0 }, { x: 0, y: 1 }), 1);
  assertEquals(cross({ x: 0, y: 1 }, { x: 1, y: 0 }), -1);
  assertEquals(cross({ x: 2, y: 0 }, { x: 1, y: 0 }), 0); // Parallel
});

Deno.test("magnitude - calculates vector length", () => {
  assertEquals(magnitude({ x: 3, y: 4 }), 5);
  assertEquals(magnitude({ x: 0, y: 0 }), 0);
  assertAlmostEquals(magnitude({ x: 1, y: 1 }), Math.sqrt(2), EPSILON);
});

Deno.test("normalize - creates unit vector", () => {
  assertPointEquals(normalize({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });
  assertPointEquals(normalize({ x: 5, y: 0 }), { x: 1, y: 0 });
  assertPointEquals(normalize({ x: 0, y: 0 }), { x: 0, y: 0 }); // Zero vector
});

Deno.test("angle - calculates vector angle", () => {
  assertAlmostEquals(angle({ x: 1, y: 0 }), 0, EPSILON);
  assertAlmostEquals(angle({ x: 0, y: 1 }), Math.PI / 2, EPSILON);
  assertAlmostEquals(angle({ x: -1, y: 0 }), Math.PI, EPSILON);
  assertAlmostEquals(angle({ x: 0, y: -1 }), -Math.PI / 2, EPSILON);
});

Deno.test("angleBetween - calculates angle between vectors", () => {
  assertAlmostEquals(
    angleBetween({ x: 1, y: 0 }, { x: 0, y: 1 }),
    Math.PI / 2,
    EPSILON,
  );
  assertAlmostEquals(
    angleBetween({ x: 1, y: 0 }, { x: 1, y: 0 }),
    0,
    EPSILON,
  );
  assertAlmostEquals(
    angleBetween({ x: 1, y: 0 }, { x: -1, y: 0 }),
    Math.PI,
    EPSILON,
  );
});

Deno.test("rotate - rotates a point", () => {
  assertPointEquals(rotate({ x: 1, y: 0 }, Math.PI / 2), { x: 0, y: 1 });
  assertPointEquals(rotate({ x: 1, y: 0 }, Math.PI), { x: -1, y: 0 });
  assertPointEquals(rotate({ x: 1, y: 1 }, -Math.PI / 2), { x: 1, y: -1 });
});

Deno.test("pointsEqual - checks point equality", () => {
  assertEquals(pointsEqual({ x: 1, y: 2 }, { x: 1, y: 2 }), true);
  assertEquals(pointsEqual({ x: 1, y: 2 }, { x: 1.0000001, y: 2 }), true);
  assertEquals(pointsEqual({ x: 1, y: 2 }, { x: 1.1, y: 2 }), false);
});

// ============================================================================
// Line Operations Tests
// ============================================================================

Deno.test("lineFromPoints - creates line from two points", () => {
  const line = lineFromPoints({ x: 0, y: 0 }, { x: 3, y: 4 });
  assertEquals(line !== null, true);
  if (line) {
    assertPointEquals(line.point, { x: 0, y: 0 });
    assertPointEquals(line.direction, { x: 0.6, y: 0.8 });
  }
});

Deno.test("lineFromPoints - returns null for coincident points", () => {
  const line = lineFromPoints({ x: 1, y: 2 }, { x: 1, y: 2 });
  assertEquals(line, null);
});

Deno.test("distanceToLine - calculates perpendicular distance", () => {
  const line: Line = {
    point: { x: 0, y: 0 },
    direction: { x: 1, y: 0 }, // Horizontal line
  };

  assertAlmostEquals(distanceToLine({ x: 5, y: 3 }, line), 3, EPSILON);
  assertAlmostEquals(distanceToLine({ x: -2, y: -4 }, line), 4, EPSILON);
  assertAlmostEquals(distanceToLine({ x: 10, y: 0 }, line), 0, EPSILON);
});

Deno.test("projectPointOnLine - projects point onto line", () => {
  const line: Line = {
    point: { x: 0, y: 0 },
    direction: { x: 1, y: 0 }, // Horizontal line
  };

  assertPointEquals(projectPointOnLine({ x: 5, y: 3 }, line), { x: 5, y: 0 });
  assertPointEquals(projectPointOnLine({ x: -2, y: 7 }, line), { x: -2, y: 0 });
});

Deno.test("lineParameter - calculates parameter along line", () => {
  const line: Line = {
    point: { x: 1, y: 2 },
    direction: { x: 1, y: 0 },
  };

  assertAlmostEquals(lineParameter({ x: 1, y: 2 }, line), 0, EPSILON);
  assertAlmostEquals(lineParameter({ x: 5, y: 2 }, line), 4, EPSILON);
  assertAlmostEquals(lineParameter({ x: -3, y: 2 }, line), -4, EPSILON);
});

Deno.test("lineLineIntersection - finds intersection of two lines", () => {
  const line1: Line = {
    point: { x: 0, y: 0 },
    direction: { x: 1, y: 0 }, // Horizontal
  };
  const line2: Line = {
    point: { x: 5, y: -3 },
    direction: { x: 0, y: 1 }, // Vertical
  };

  const intersection = lineLineIntersection(line1, line2);
  assertEquals(intersection !== null, true);
  if (intersection) {
    assertPointEquals(intersection, { x: 5, y: 0 });
  }
});

Deno.test("lineLineIntersection - returns null for parallel lines", () => {
  const line1: Line = {
    point: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
  };
  const line2: Line = {
    point: { x: 0, y: 5 },
    direction: { x: 1, y: 0 },
  };

  assertEquals(lineLineIntersection(line1, line2), null);
});

Deno.test("lineLineIntersection - finds intersection at angle", () => {
  const line1: Line = {
    point: { x: 0, y: 0 },
    direction: normalize({ x: 1, y: 1 }), // 45° angle
  };
  const line2: Line = {
    point: { x: 0, y: 4 },
    direction: normalize({ x: 1, y: -1 }), // -45° angle
  };

  const intersection = lineLineIntersection(line1, line2);
  assertEquals(intersection !== null, true);
  if (intersection) {
    assertPointEquals(intersection, { x: 2, y: 2 });
  }
});

// ============================================================================
// Circle Operations Tests
// ============================================================================

Deno.test("distanceToCircle - calculates distance to circle perimeter", () => {
  const circle: Circle = { center: { x: 0, y: 0 }, radius: 5 };

  assertAlmostEquals(distanceToCircle({ x: 10, y: 0 }, circle), 5, EPSILON);
  assertAlmostEquals(distanceToCircle({ x: 3, y: 0 }, circle), -2, EPSILON);
  assertAlmostEquals(distanceToCircle({ x: 5, y: 0 }, circle), 0, EPSILON);
});

Deno.test("projectPointOnCircle - projects point onto circle", () => {
  const circle: Circle = { center: { x: 0, y: 0 }, radius: 5 };

  assertPointEquals(projectPointOnCircle({ x: 10, y: 0 }, circle), {
    x: 5,
    y: 0,
  });
  assertPointEquals(projectPointOnCircle({ x: 0, y: -7 }, circle), {
    x: 0,
    y: -5,
  });
});

Deno.test("angleOnCircle - calculates angle to point", () => {
  const circle: Circle = { center: { x: 0, y: 0 }, radius: 5 };

  assertAlmostEquals(angleOnCircle({ x: 5, y: 0 }, circle), 0, EPSILON);
  assertAlmostEquals(
    angleOnCircle({ x: 0, y: 5 }, circle),
    Math.PI / 2,
    EPSILON,
  );
  assertAlmostEquals(angleOnCircle({ x: -5, y: 0 }, circle), Math.PI, EPSILON);
});

Deno.test("lineCircleIntersection - finds two intersection points", () => {
  const line: Line = {
    point: { x: -10, y: 3 },
    direction: { x: 1, y: 0 },
  };
  const circle: Circle = { center: { x: 0, y: 0 }, radius: 5 };

  const intersections = lineCircleIntersection(line, circle);
  assertEquals(intersections.length, 2);
  assertPointEquals(intersections[0], { x: -4, y: 3 });
  assertPointEquals(intersections[1], { x: 4, y: 3 });
});

Deno.test("lineCircleIntersection - finds one intersection (tangent)", () => {
  const line: Line = {
    point: { x: -10, y: 5 },
    direction: { x: 1, y: 0 },
  };
  const circle: Circle = { center: { x: 0, y: 0 }, radius: 5 };

  const intersections = lineCircleIntersection(line, circle);
  assertEquals(intersections.length, 1);
  assertPointEquals(intersections[0], { x: 0, y: 5 });
});

Deno.test("lineCircleIntersection - finds no intersection", () => {
  const line: Line = {
    point: { x: -10, y: 10 },
    direction: { x: 1, y: 0 },
  };
  const circle: Circle = { center: { x: 0, y: 0 }, radius: 5 };

  const intersections = lineCircleIntersection(line, circle);
  assertEquals(intersections.length, 0);
});

Deno.test("circleCircleIntersection - finds two intersection points", () => {
  const c1: Circle = { center: { x: 0, y: 0 }, radius: 5 };
  const c2: Circle = { center: { x: 6, y: 0 }, radius: 5 };

  const intersections = circleCircleIntersection(c1, c2);
  assertEquals(intersections.length, 2);
  assertPointEquals(intersections[0], { x: 3, y: 4 });
  assertPointEquals(intersections[1], { x: 3, y: -4 });
});

Deno.test("circleCircleIntersection - finds one intersection (tangent)", () => {
  const c1: Circle = { center: { x: 0, y: 0 }, radius: 5 };
  const c2: Circle = { center: { x: 10, y: 0 }, radius: 5 };

  const intersections = circleCircleIntersection(c1, c2);
  assertEquals(intersections.length, 1);
  assertPointEquals(intersections[0], { x: 5, y: 0 });
});

Deno.test("circleCircleIntersection - finds no intersection (too far)", () => {
  const c1: Circle = { center: { x: 0, y: 0 }, radius: 5 };
  const c2: Circle = { center: { x: 20, y: 0 }, radius: 5 };

  const intersections = circleCircleIntersection(c1, c2);
  assertEquals(intersections.length, 0);
});

Deno.test("circleCircleIntersection - finds no intersection (one inside)", () => {
  const c1: Circle = { center: { x: 0, y: 0 }, radius: 10 };
  const c2: Circle = { center: { x: 2, y: 0 }, radius: 3 };

  const intersections = circleCircleIntersection(c1, c2);
  assertEquals(intersections.length, 0);
});

// ============================================================================
// Arc Operations Tests
// ============================================================================

Deno.test("normalizeAngle - normalizes angles to [-π, π]", () => {
  assertAlmostEquals(normalizeAngle(0), 0, EPSILON);
  assertAlmostEquals(normalizeAngle(Math.PI), Math.PI, EPSILON);
  assertAlmostEquals(Math.abs(normalizeAngle(-Math.PI)), Math.PI, EPSILON); // -π and π are equivalent
  assertAlmostEquals(Math.abs(normalizeAngle(3 * Math.PI)), Math.PI, EPSILON);
  assertAlmostEquals(Math.abs(normalizeAngle(-3 * Math.PI)), Math.PI, EPSILON);
  assertAlmostEquals(normalizeAngle(Math.PI / 2), Math.PI / 2, EPSILON);
});

Deno.test("arcSweepAngle - calculates sweep angle for CCW arc", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  assertAlmostEquals(arcSweepAngle(arc), Math.PI / 2, EPSILON);
});

Deno.test("arcSweepAngle - calculates sweep angle for CW arc", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: Math.PI / 2,
    endAngle: 0,
    clockwise: true,
  };

  assertAlmostEquals(arcSweepAngle(arc), Math.PI / 2, EPSILON);
});

Deno.test("arcSweepAngle - handles wrap-around for CCW", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: Math.PI,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  assertAlmostEquals(arcSweepAngle(arc), 3 * Math.PI / 2, EPSILON);
});

Deno.test("pointOnArc - gets point at specific angle", () => {
  const arc: Arc = {
    center: { x: 1, y: 2 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  assertPointEquals(pointOnArc(arc, 0), { x: 6, y: 2 });
  assertPointEquals(pointOnArc(arc, Math.PI / 2), { x: 1, y: 7 });
});

Deno.test("arcStartPoint and arcEndPoint - get arc endpoints", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  assertPointEquals(arcStartPoint(arc), { x: 5, y: 0 });
  assertPointEquals(arcEndPoint(arc), { x: 0, y: 5 });
});

Deno.test("isAngleInArc - checks if angle is within CCW arc", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  assertEquals(isAngleInArc(arc, 0), true);
  assertEquals(isAngleInArc(arc, Math.PI / 4), true);
  assertEquals(isAngleInArc(arc, Math.PI / 2), true);
  assertEquals(isAngleInArc(arc, Math.PI), false);
  assertEquals(isAngleInArc(arc, -Math.PI / 4), false);
});

Deno.test("isAngleInArc - checks if angle is within CW arc", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: Math.PI / 2,
    endAngle: 0,
    clockwise: true,
  };

  assertEquals(isAngleInArc(arc, Math.PI / 2), true);
  assertEquals(isAngleInArc(arc, Math.PI / 4), true);
  assertEquals(isAngleInArc(arc, 0), true);
  assertEquals(isAngleInArc(arc, Math.PI), false);
  assertEquals(isAngleInArc(arc, -Math.PI / 4), false);
});

Deno.test("distanceToArc - calculates distance to arc on perimeter", () => {
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  // Point that projects onto arc (angle π/4 is within [0, π/2])
  // At angle π/4, point on circle is (5*cos(π/4), 5*sin(π/4)) ≈ (3.54, 3.54)
  // Point at (7.07, 7.07) is along same angle but farther out
  const angle = Math.PI / 4;
  const testPoint = { x: 10 * Math.cos(angle), y: 10 * Math.sin(angle) };
  assertAlmostEquals(distanceToArc(testPoint, arc), 5, 0.1);

  // Point projects outside arc - use endpoint distance
  assertAlmostEquals(
    distanceToArc({ x: 10, y: -5 }, arc),
    distance({ x: 10, y: -5 }, { x: 5, y: 0 }),
    EPSILON,
  );
});

Deno.test("lineArcIntersection - finds intersections within arc", () => {
  const line: Line = {
    point: { x: -10, y: 3 },
    direction: { x: 1, y: 0 },
  };
  const arc: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
    clockwise: false,
  };

  const intersections = lineArcIntersection(line, arc);
  assertEquals(intersections.length, 1); // Only one point in first quadrant
  assertPointEquals(intersections[0], { x: 4, y: 3 });
});

Deno.test("arcArcIntersection - finds intersections between arcs", () => {
  const arc1: Arc = {
    center: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI,
    clockwise: false,
  };
  const arc2: Arc = {
    center: { x: 6, y: 0 },
    radius: 5,
    startAngle: Math.PI / 2,
    endAngle: 3 * Math.PI / 2,
    clockwise: false,
  };

  const intersections = arcArcIntersection(arc1, arc2);
  assertEquals(intersections.length, 1); // Only upper intersection in both arcs
  assertPointEquals(intersections[0], { x: 3, y: 4 });
});
