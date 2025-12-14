/**
 * Core geometric primitives and operations for vectorization
 */

export interface Point {
  x: number;
  y: number;
}

export interface Line {
  /** Point on the line */
  point: Point;
  /** Unit direction vector */
  direction: Point;
}

export interface Arc {
  center: Point;
  radius: number;
  /** Start angle in radians */
  startAngle: number;
  /** End angle in radians */
  endAngle: number;
  /** True if arc goes clockwise from start to end */
  clockwise: boolean;
}

export interface Circle {
  center: Point;
  radius: number;
}

// ============================================================================
// Point Operations
// ============================================================================

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate squared distance (faster when you don't need actual distance)
 */
export function distanceSquared(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

/**
 * Add two points (vector addition)
 */
export function add(p1: Point, p2: Point): Point {
  return { x: p1.x + p2.x, y: p1.y + p2.y };
}

/**
 * Subtract two points (vector subtraction)
 */
export function subtract(p1: Point, p2: Point): Point {
  return { x: p1.x - p2.x, y: p1.y - p2.y };
}

/**
 * Scale a point/vector by a scalar
 */
export function scale(p: Point, s: number): Point {
  return { x: p.x * s, y: p.y * s };
}

/**
 * Calculate dot product of two vectors
 */
export function dot(p1: Point, p2: Point): number {
  return p1.x * p2.x + p1.y * p2.y;
}

/**
 * Calculate cross product magnitude (z-component of 3D cross product)
 */
export function cross(p1: Point, p2: Point): number {
  return p1.x * p2.y - p1.y * p2.x;
}

/**
 * Calculate magnitude (length) of a vector
 */
export function magnitude(p: Point): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

/**
 * Normalize a vector to unit length
 */
export function normalize(p: Point): Point {
  const mag = magnitude(p);
  if (mag < 1e-10) {
    return { x: 0, y: 0 };
  }
  return { x: p.x / mag, y: p.y / mag };
}

/**
 * Calculate angle of a vector in radians (-π to π)
 */
export function angle(p: Point): number {
  return Math.atan2(p.y, p.x);
}

/**
 * Calculate angle between two vectors in radians (0 to π)
 */
export function angleBetween(p1: Point, p2: Point): number {
  const mag1 = magnitude(p1);
  const mag2 = magnitude(p2);
  if (mag1 < 1e-10 || mag2 < 1e-10) {
    return 0;
  }
  const cosAngle = dot(p1, p2) / (mag1 * mag2);
  // Clamp to handle floating point errors
  return Math.acos(Math.max(-1, Math.min(1, cosAngle)));
}

/**
 * Rotate a point around the origin by an angle in radians
 */
export function rotate(p: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

/**
 * Check if two points are approximately equal within tolerance
 */
export function pointsEqual(p1: Point, p2: Point, tolerance = 1e-6): boolean {
  return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
}

// ============================================================================
// Line Operations
// ============================================================================

/**
 * Create a line from two points
 */
export function lineFromPoints(p1: Point, p2: Point): Line | null {
  const dir = subtract(p2, p1);
  const mag = magnitude(dir);
  if (mag < 1e-10) {
    return null; // Points are too close
  }
  return {
    point: p1,
    direction: normalize(dir),
  };
}

/**
 * Calculate perpendicular distance from a point to a line
 */
export function distanceToLine(point: Point, line: Line): number {
  const toPoint = subtract(point, line.point);
  // Distance is |toPoint × direction| since direction is unit length
  return Math.abs(cross(toPoint, line.direction));
}

/**
 * Project a point onto a line (closest point on line to the given point)
 */
export function projectPointOnLine(point: Point, line: Line): Point {
  const toPoint = subtract(point, line.point);
  const projection = dot(toPoint, line.direction);
  return add(line.point, scale(line.direction, projection));
}

/**
 * Calculate parameter t where point lies on line (line.point + t * line.direction)
 */
export function lineParameter(point: Point, line: Line): number {
  const toPoint = subtract(point, line.point);
  return dot(toPoint, line.direction);
}

/**
 * Find intersection point of two lines
 * Returns null if lines are parallel
 */
export function lineLineIntersection(
  line1: Line,
  line2: Line,
  tolerance = 1e-6,
): Point | null {
  const d1 = line1.direction;
  const d2 = line2.direction;
  const crossProduct = cross(d1, d2);

  // Check if lines are parallel
  if (Math.abs(crossProduct) < tolerance) {
    return null;
  }

  const diff = subtract(line2.point, line1.point);
  const t = cross(diff, d2) / crossProduct;

  return add(line1.point, scale(d1, t));
}

// ============================================================================
// Circle Operations
// ============================================================================

/**
 * Calculate distance from a point to the circle perimeter
 * Positive means outside, negative means inside
 */
export function distanceToCircle(point: Point, circle: Circle): number {
  return distance(point, circle.center) - circle.radius;
}

/**
 * Project a point onto a circle (closest point on circle to the given point)
 */
export function projectPointOnCircle(point: Point, circle: Circle): Point {
  const toPoint = subtract(point, circle.center);
  const dir = normalize(toPoint);
  return add(circle.center, scale(dir, circle.radius));
}

/**
 * Calculate angle of a point relative to circle center
 */
export function angleOnCircle(point: Point, circle: Circle): number {
  const toPoint = subtract(point, circle.center);
  return angle(toPoint);
}

/**
 * Find intersection points of a line and a circle
 * Returns 0, 1, or 2 intersection points
 */
export function lineCircleIntersection(
  line: Line,
  circle: Circle,
  tolerance = 1e-6,
): Point[] {
  // Vector from line point to circle center
  const toCenter = subtract(circle.center, line.point);

  // Project center onto line
  const projection = dot(toCenter, line.direction);

  // Closest point on line to center
  const closest = add(line.point, scale(line.direction, projection));

  // Distance from center to line
  const distToLine = distance(circle.center, closest);

  // No intersection if line is too far from circle
  if (distToLine > circle.radius + tolerance) {
    return [];
  }

  // Tangent case (1 intersection)
  if (Math.abs(distToLine - circle.radius) < tolerance) {
    return [closest];
  }

  // Two intersections
  const halfChord = Math.sqrt(
    circle.radius * circle.radius - distToLine * distToLine,
  );
  const offset = scale(line.direction, halfChord);

  return [
    subtract(closest, offset),
    add(closest, offset),
  ];
}

/**
 * Find intersection points of two circles
 * Returns 0, 1, or 2 intersection points
 */
export function circleCircleIntersection(
  c1: Circle,
  c2: Circle,
  tolerance = 1e-6,
): Point[] {
  const d = distance(c1.center, c2.center);

  // No intersection if circles are too far apart or one contains the other
  if (
    d > c1.radius + c2.radius + tolerance ||
    d < Math.abs(c1.radius - c2.radius) - tolerance
  ) {
    return [];
  }

  // Same circle
  if (d < tolerance && Math.abs(c1.radius - c2.radius) < tolerance) {
    return []; // Infinite intersections, return empty
  }

  // Calculate intersection points
  const a = (c1.radius * c1.radius - c2.radius * c2.radius + d * d) / (2 * d);
  const h = Math.sqrt(c1.radius * c1.radius - a * a);

  const toC2 = subtract(c2.center, c1.center);
  const unit = normalize(toC2);
  const midpoint = add(c1.center, scale(unit, a));

  // Tangent case (1 intersection)
  if (Math.abs(h) < tolerance) {
    return [midpoint];
  }

  // Perpendicular offset
  const perpendicular = { x: -unit.y, y: unit.x };
  const offset = scale(perpendicular, h);

  return [
    add(midpoint, offset),
    subtract(midpoint, offset),
  ];
}

// ============================================================================
// Arc Operations
// ============================================================================

/**
 * Normalize angle to range [-π, π]
 */
export function normalizeAngle(angleRad: number): number {
  let normalized = angleRad % (2 * Math.PI);
  if (normalized > Math.PI) normalized -= 2 * Math.PI;
  if (normalized < -Math.PI) normalized += 2 * Math.PI;
  return normalized;
}

/**
 * Calculate sweep angle of an arc
 * Always returns positive value
 */
export function arcSweepAngle(arc: Arc): number {
  let sweep = arc.endAngle - arc.startAngle;
  if (arc.clockwise) {
    if (sweep > 0) sweep -= 2 * Math.PI;
    return -sweep;
  } else {
    if (sweep < 0) sweep += 2 * Math.PI;
    return sweep;
  }
}

/**
 * Get point on arc at a specific angle
 */
export function pointOnArc(arc: Arc, angleRad: number): Point {
  return {
    x: arc.center.x + arc.radius * Math.cos(angleRad),
    y: arc.center.y + arc.radius * Math.sin(angleRad),
  };
}

/**
 * Get start point of an arc
 */
export function arcStartPoint(arc: Arc): Point {
  return pointOnArc(arc, arc.startAngle);
}

/**
 * Get end point of an arc
 */
export function arcEndPoint(arc: Arc): Point {
  return pointOnArc(arc, arc.endAngle);
}

/**
 * Check if an angle is within the arc's sweep
 */
export function isAngleInArc(arc: Arc, angleRad: number): boolean {
  const normalized = normalizeAngle(angleRad);
  const start = normalizeAngle(arc.startAngle);
  const end = normalizeAngle(arc.endAngle);

  if (arc.clockwise) {
    if (start > end) {
      return normalized <= start && normalized >= end;
    } else {
      return normalized <= start || normalized >= end;
    }
  } else {
    if (start < end) {
      return normalized >= start && normalized <= end;
    } else {
      return normalized >= start || normalized <= end;
    }
  }
}

/**
 * Calculate perpendicular distance from a point to an arc
 * Returns the minimum distance considering the arc's extent
 */
export function distanceToArc(point: Point, arc: Arc): number {
  const angleToPoint = angleOnCircle(point, arc);

  // If the point projects onto the arc, use circle distance
  if (isAngleInArc(arc, angleToPoint)) {
    return Math.abs(distanceToCircle(point, arc));
  }

  // Otherwise, use distance to nearest endpoint
  const startPoint = arcStartPoint(arc);
  const endPoint = arcEndPoint(arc);
  return Math.min(
    distance(point, startPoint),
    distance(point, endPoint),
  );
}

/**
 * Find intersection points of a line and an arc
 */
export function lineArcIntersection(
  line: Line,
  arc: Arc,
  tolerance = 1e-6,
): Point[] {
  // First find line-circle intersections
  const circleIntersections = lineCircleIntersection(line, arc, tolerance);

  // Filter to only points that lie on the arc
  return circleIntersections.filter((point) => {
    const angleToPoint = angleOnCircle(point, arc);
    return isAngleInArc(arc, angleToPoint);
  });
}

/**
 * Find intersection points of two arcs
 */
export function arcArcIntersection(
  arc1: Arc,
  arc2: Arc,
  tolerance = 1e-6,
): Point[] {
  // First find circle-circle intersections
  const circleIntersections = circleCircleIntersection(arc1, arc2, tolerance);

  // Filter to only points that lie on both arcs
  return circleIntersections.filter((point) => {
    const angle1 = angleOnCircle(point, arc1);
    const angle2 = angleOnCircle(point, arc2);
    return isAngleInArc(arc1, angle1) && isAngleInArc(arc2, angle2);
  });
}
