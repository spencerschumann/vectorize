/**
 * Arc (circle) fitting using algebraic distance minimization
 * Minimizes the algebraic distance from points to the fitted circle
 */

import type { Circle, Point } from "./geometry.ts";
import { distance, normalizeAngle } from "./geometry.ts";

/**
 * Compute errors and error statistics for a circle fit
 */
function computeErrors(
  points: Point[],
  center: Point,
  radius: number,
): {
  errors: number[];
  rmsError: number;
  maxErrorSq: number;
  medianError: number;
} {
  const errors = points.map((p) => Math.abs(distance(p, center) - radius));

  const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
  const rmsError = Math.sqrt(sumSquaredErrors / errors.length);

  const maxErrorSq = errors.reduce((m, e) => Math.max(m, e * e), 0);

  const sortedErrors = [...errors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

  return { errors, rmsError, maxErrorSq, medianError };
}

/**
 * Compute arc parameters (angles, sweep, direction) from points
 */
function computeArcParameters(
  points: Point[],
  center: Point,
  radius: number,
): {
  startAngle: number;
  endAngle: number;
} {
  const startPt = points[0];
  const endPt = points[points.length - 1];
  const midPt = points[Math.floor(points.length / 2)];

  const startAngleRaw = Math.atan2(startPt.y - center.y, startPt.x - center.x);
  const endAngleRaw = Math.atan2(endPt.y - center.y, endPt.x - center.x);
  const midAngleRaw = Math.atan2(midPt.y - center.y, midPt.x - center.x);
  // Helper: unwrap angle `a` so it's as close as possible to `ref` by adding multiples of 2π
  const twoPi = 2 * Math.PI;
  function unwrap(a: number, ref: number): number {
    let candidate = a;
    while (candidate - ref > Math.PI) candidate -= twoPi;
    while (candidate - ref < -Math.PI) candidate += twoPi;
    return candidate;
  }

  // Work in unwrapped space relative to the raw start angle to choose correct sweep
  const startRaw = startAngleRaw;
  const endUnwrapped = unwrap(endAngleRaw, startRaw);
  const midUnwrapped = unwrap(midAngleRaw, startRaw);

  // Build unwrapped angles for all points to detect full-circle sweeps and direction
  const rawAngles = points.map((p) =>
    Math.atan2(p.y - center.y, p.x - center.x)
  );
  const unwrappedAngles: number[] = [];
  let prev = startRaw;
  for (let i = 0; i < rawAngles.length; i++) {
    const a = unwrap(rawAngles[i], prev);
    unwrappedAngles.push(a);
    prev = a;
  }

  const span = Math.max(...unwrappedAngles) - Math.min(...unwrappedAngles);

  // If points cover (approximately) a full circle, determine direction
  // using a small local delta near the middle of the sample set. This
  // avoids accumulating many small numerical deltas that can cancel.
  if (span > 1.9 * Math.PI) {
    const midIdx = Math.floor(unwrappedAngles.length / 2);
    let dirDelta = 0;
    if (midIdx > 0 && midIdx + 1 < unwrappedAngles.length) {
      dirDelta = unwrappedAngles[midIdx + 1] - unwrappedAngles[midIdx - 1];
    } else if (unwrappedAngles.length > 1) {
      dirDelta = unwrappedAngles[unwrappedAngles.length - 1] -
        unwrappedAngles[0];
    }
    const signedDelta = dirDelta >= 0 ? twoPi : -twoPi;
    const startAngle = ((startRaw % twoPi) + twoPi) % twoPi;
    const endAngle = startAngle + signedDelta;
    return { startAngle, endAngle };
  }

  // Consider end candidates shifted by ±2π to allow large sweeps
  const candidates = [endUnwrapped - twoPi, endUnwrapped, endUnwrapped + twoPi];

  // Prefer candidates closest to start to avoid spurious ±2π jumps
  const sortedCandidates = [...candidates].sort((a, b) =>
    Math.abs(a - startRaw) - Math.abs(b - startRaw)
  );

  let chosenEnd = candidates[1];
  let found = false;
  for (const c of sortedCandidates) {
    if (c >= startRaw) {
      if (midUnwrapped >= startRaw - 1e-12 && midUnwrapped <= c + 1e-12) {
        chosenEnd = c;
        found = true;
        break;
      }
    } else {
      if (midUnwrapped <= startRaw + 1e-12 && midUnwrapped >= c - 1e-12) {
        chosenEnd = c;
        found = true;
        break;
      }
    }
  }

  if (!found) {
    chosenEnd = candidates.reduce(
      (best, c) =>
        Math.abs(c - startRaw) < Math.abs(best - startRaw) ? c : best,
      candidates[1],
    );
  }

  const signedDelta = chosenEnd - startRaw;

  // Normalize startAngle to [0, 2π) for return
  const startAngle = ((startRaw % twoPi) + twoPi) % twoPi;
  const endAngle = startAngle + signedDelta;

  return { startAngle, endAngle };
}

export interface ArcFitResult {
  /** The fitted circle */
  circle: Circle;
  /** Root mean square error (radial distance) */
  rmsError: number;
  /** Maximum squared radial distance for any point */
  maxErrorSq: number;
  /** Median error */
  medianError: number;
  /** Number of points in the fit */
  count: number;
  /** Individual errors for each point */
  errors: number[];
  /** Start angle of the arc in radians */
  startAngle: number;
  /** End angle of the arc in radians (relative to startAngle) */
  endAngle: number;
}

/**
 * Fit a circle to a set of points using algebraic fitting
 * Returns null if fewer than 3 points or fit is degenerate
 */
export function fitCircle(points: Point[]): ArcFitResult | null {
  if (points.length < 3) {
    return null;
  }

  // Use algebraic circle fitting (Pratt method)
  // Minimizes algebraic distance: (x-cx)² + (y-cy)² - r²

  const n = points.length;

  // Calculate means
  let meanX = 0;
  let meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  // Build moment matrix
  let Mxx = 0, Mxy = 0, Myy = 0;
  let Mxz = 0, Myz = 0;
  let Mzz = 0;

  for (const p of points) {
    const x = p.x - meanX;
    const y = p.y - meanY;
    const z = x * x + y * y;

    Mxx += x * x;
    Mxy += x * y;
    Myy += y * y;
    Mxz += x * z;
    Myz += y * z;
    Mzz += z * z;
  }

  Mxx /= n;
  Mxy /= n;
  Myy /= n;
  Mxz /= n;
  Myz /= n;
  Mzz /= n;

  // Solve for center offset
  // The equations are: 2*Mxx*cx + 2*Mxy*cy = Mxz, 2*Mxy*cx + 2*Myy*cy = Myz
  const det = Mxx * Myy - Mxy * Mxy;
  if (Math.abs(det) < 1e-10) {
    return null; // Degenerate case
  }

  const cx = (Mxz * Myy - Myz * Mxy) / (2 * det);
  const cy = (Myz * Mxx - Mxz * Mxy) / (2 * det);

  const center = {
    x: cx + meanX,
    y: cy + meanY,
  };

  // Calculate radius
  const radiusSquared = cx * cx + cy * cy + (Mxx + Myy);
  if (radiusSquared <= 9) {
    // Invalid circle or radius too small (TODO: make threshold configurable)
    return null;
  }
  const radius = Math.sqrt(radiusSquared);

  const circle: Circle = { center, radius };

  // Calculate errors using helper function
  const { errors, rmsError, maxErrorSq, medianError } = computeErrors(
    points,
    center,
    radius,
  );

  // Calculate arc parameters using helper function
  const { startAngle, endAngle } = computeArcParameters(
    points,
    center,
    radius,
  );

  return {
    circle,
    rmsError,
    maxErrorSq,
    medianError,
    count: points.length,
    errors,
    startAngle,
    endAngle,
  };
}

/**
 * Incremental circle fitting for online algorithms
 * Allows adding points one at a time and updating the fit efficiently
 */
export class IncrementalCircleFit {
  private n = 0;
  private sumX = 0;
  private sumY = 0;
  private sumXX = 0;
  private sumYY = 0;
  private sumXY = 0;
  private sumXXX = 0;
  private sumXXY = 0;
  private sumXYY = 0;
  private sumYYY = 0;
  private points: Point[] = [];

  /**
   * Add a point to the fit
   */
  addPoint(p: Point): void {
    this.n++;
    this.sumX += p.x;
    this.sumY += p.y;
    this.sumXX += p.x * p.x;
    this.sumYY += p.y * p.y;
    this.sumXY += p.x * p.y;
    this.sumXXX += p.x * p.x * p.x;
    this.sumXXY += p.x * p.x * p.y;
    this.sumXYY += p.x * p.y * p.y;
    this.sumYYY += p.y * p.y * p.y;

    this.points.push(p);
  }

  /**
   * Get the number of points in the fit
   */
  getCount(): number {
    return this.n;
  }

  /**
   * Get all points in the fit
   */
  getPoints(): Point[] {
    return [...this.points];
  }

  /**
   * Get the current fit result
   * Returns null if fewer than 3 points
   */
  getFit(): ArcFitResult | null {
    if (this.n < 3) {
      return null;
    }

    const meanX = this.sumX / this.n;
    const meanY = this.sumY / this.n;

    // Calculate moment matrix using stored sums
    // These match the batch computation exactly
    let Mxx = 0, Mxy = 0, Myy = 0;
    let Mxz = 0, Myz = 0;

    for (const p of this.points) {
      const x = p.x - meanX;
      const y = p.y - meanY;
      const z = x * x + y * y;

      Mxx += x * x;
      Mxy += x * y;
      Myy += y * y;
      Mxz += x * z;
      Myz += y * z;
    }

    Mxx /= this.n;
    Mxy /= this.n;
    Myy /= this.n;
    Mxz /= this.n;
    Myz /= this.n;

    const det = Mxx * Myy - Mxy * Mxy;
    if (Math.abs(det) < 1e-10) {
      return null;
    }

    const cx = (Mxz * Myy - Myz * Mxy) / (2 * det);
    const cy = (Myz * Mxx - Mxz * Mxy) / (2 * det);

    const center = {
      x: cx + meanX,
      y: cy + meanY,
    };

    const radiusSquared = cx * cx + cy * cy + (Mxx + Myy);
    if (radiusSquared <= 0) {
      return null;
    }
    const radius = Math.sqrt(radiusSquared);

    const circle: Circle = { center, radius };

    // Calculate errors using helper function
    const { errors, rmsError, maxErrorSq, medianError } = computeErrors(
      this.points,
      center,
      radius,
    );

    // Calculate arc parameters using helper function
    const { startAngle, endAngle } = computeArcParameters(
      this.points,
      center,
      radius,
    );

    return {
      circle,
      rmsError,
      maxErrorSq,
      medianError,
      count: this.n,
      errors,
      startAngle,
      endAngle,
    };
  }

  /**
   * Reset the fit to start over
   */
  reset(): void {
    this.n = 0;
    this.sumX = 0;
    this.sumY = 0;
    this.sumXX = 0;
    this.sumYY = 0;
    this.sumXY = 0;
    this.sumXXX = 0;
    this.sumXXY = 0;
    this.sumXYY = 0;
    this.sumYYY = 0;
    this.points = [];
  }
}

/**
 * Calculate percentile of errors
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * p);
  return sorted[Math.min(index, sorted.length - 1)];
}

// ============================================================================
// Helper utilities for angles and SVG flags
// ============================================================================

/** Duck-type: any object with startAngle and endAngle */
interface ArcAngles {
  startAngle: number;
  endAngle: number;
}

/** Return signed sweep (end - start). Negative => clockwise (screen Y-down). */
export function signedSweep(arc: ArcAngles): number {
  return arc.endAngle - arc.startAngle;
}

/** True if arc is clockwise in screen Y-down coordinates. */
export function isClockwiseAngles(arc: ArcAngles): boolean {
  return signedSweep(arc) < 0;
}

/** True if arc sweep is >= 180° (large-arc in SVG). */
export function isLargeArc(arc: ArcAngles): boolean {
  return Math.abs(signedSweep(arc)) >= Math.PI;
}

/** SVG flags: large-arc-flag (0/1) and sweep-flag (0/1). */
export function svgArcFlags(arc: ArcAngles): {
  largeArcFlag: 0 | 1;
  sweepFlag: 0 | 1;
} {
  const largeArcFlag: 0 | 1 = isLargeArc(arc) ? 1 : 0;
  // In SVG (Y-down), sweepFlag=1 means clockwise
  const sweepFlag: 0 | 1 = isClockwiseAngles(arc) ? 0 : 1;
  return { largeArcFlag, sweepFlag };
}
