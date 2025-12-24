/**
 * Line fitting using Total Least Squares (TLS)
 * Minimizes perpendicular distance from points to the fitted line
 */

import type { Line, Point } from "./geometry.ts";
import { normalize } from "./geometry.ts";

export interface LineFitResult {
  /** The fitted line */
  line: Line;
  /** Root mean square error (perpendicular distance) */
  rmsError: number;
  /** Maximum squared perpendicular distance for any point */
  maxErrorSq: number;
  /** Median error */
  medianError: number;
  /** Number of points in the fit */
  count: number;
  /** Individual errors for each point */
  errors: number[];
}

/**
 * Fit a line to a set of points using Total Least Squares
 * Returns null if fewer than 2 points or points are degenerate
 */
export function fitLine(points: Point[]): LineFitResult | null {
  if (points.length < 2) {
    return null;
  }

  // Calculate centroid
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const centroid = {
    x: sumX / points.length,
    y: sumY / points.length,
  };

  // Calculate covariance matrix
  let covXX = 0;
  let covYY = 0;
  let covXY = 0;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }

  // Find principal component (eigenvector of largest eigenvalue)
  // For 2x2 matrix: lambda = (trace ± sqrt(trace² - 4*det)) / 2
  const trace = covXX + covYY;
  const det = covXX * covYY - covXY * covXY;
  const discriminant = trace * trace - 4 * det;

  if (discriminant < 0 || trace < 1e-10) {
    // Degenerate case: all points are at the same location
    return null;
  }

  const lambda1 = (trace + Math.sqrt(discriminant)) / 2;

  // Eigenvector corresponding to lambda1
  let direction: Point;
  if (Math.abs(covXY) > 1e-10) {
    direction = normalize({ x: lambda1 - covYY, y: covXY });
  } else if (covXX > covYY) {
    direction = { x: 1, y: 0 };
  } else {
    direction = { x: 0, y: 1 };
  }

  const line: Line = {
    point: centroid,
    direction,
  };

  // Calculate errors
  const errors = points.map((p) => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    // Perpendicular distance: |cross product| with unit direction
    return Math.abs(dx * direction.y - dy * direction.x);
  });

  // Calculate RMS error
  const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
  const rmsError = Math.sqrt(sumSquaredErrors / errors.length);

  // Maximum squared error
  const maxErrorSq = errors.reduce((m, e) => Math.max(m, e * e), 0);

  // Calculate median error
  const sortedErrors = [...errors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

  return {
    line,
    rmsError,
    maxErrorSq,
    medianError,
    count: points.length,
    errors,
  };
}

/**
 * Incremental line fitting for online algorithms
 * Allows adding points one at a time and updating the fit efficiently
 */
export class IncrementalLineFit {
  private n = 0;
  private sumX = 0;
  private sumY = 0;
  private sumXX = 0;
  private sumYY = 0;
  private sumXY = 0;
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
   * Returns null if fewer than 2 points
   */
  getFit(): LineFitResult | null {
    if (this.n < 2) {
      return null;
    }

    // Calculate centroid
    const centroid = {
      x: this.sumX / this.n,
      y: this.sumY / this.n,
    };

    // Calculate covariance matrix components
    const covXX = this.sumXX - this.sumX * this.sumX / this.n;
    const covYY = this.sumYY - this.sumY * this.sumY / this.n;
    const covXY = this.sumXY - this.sumX * this.sumY / this.n;

    // Find principal component
    const trace = covXX + covYY;
    const det = covXX * covYY - covXY * covXY;
    const discriminant = trace * trace - 4 * det;

    if (discriminant < 0 || trace < 1e-10) {
      return null;
    }

    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;

    // Eigenvector
    let direction: Point;
    if (Math.abs(covXY) > 1e-10) {
      direction = normalize({ x: lambda1 - covYY, y: covXY });
    } else if (covXX > covYY) {
      direction = { x: 1, y: 0 };
    } else {
      direction = { x: 0, y: 1 };
    }

    const line: Line = {
      point: centroid,
      direction,
    };

    // Calculate errors
    const errors = this.points.map((p) => {
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      return Math.abs(dx * direction.y - dy * direction.x);
    });

    const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
    const rmsError = Math.sqrt(sumSquaredErrors / errors.length);

    const sortedErrors = [...errors].sort((a, b) => a - b);
    const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

    const maxErrorSq = errors.reduce((m, e) => Math.max(m, e * e), 0);

    return {
      line,
      rmsError,
      maxErrorSq,
      medianError,
      count: this.n,
      errors,
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
