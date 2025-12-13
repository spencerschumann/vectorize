/**
 * Incremental segmentation algorithm for vectorization
 * Converts ordered polyline points to line and arc segments
 * Based on greedy segment growing with incremental line and circle fitting
 */

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  startIndex: number;
  endIndex: number;
  type: "line" | "arc" | "polyline";
  // For lines: store fitted direction and centroid
  lineFit?: {
    centroid: Point;
    direction: Point;
    error: number;
  };
  // For arcs: store fitted center and radius
  circleFit?: {
    center: Point;
    radius: number;
    error: number;
    sweepAngle: number;
    clockwise: boolean; // Direction of arc travel
  };
}

// Tunable parameters
const MAX_ERROR = 0.75; // absolute distance tolerance (pixels) for median/majority
const MAX_ERROR_P90 = 2.0; // absolute distance tolerance (pixels) at 90th percentile
const MIN_POINTS = 5; // minimum points for a valid fit
const LOOKAHEAD_POINTS = 2; // hysteresis to prevent jitter
const ERROR_PERCENTILE = 0.9; // Use 90th percentile for outlier tolerance
const MIN_RADIUS = 2.0; // minimum valid circle radius
const MAX_RADIUS = 10000.0; // maximum valid circle radius (treat as line)
const ARC_PREFERENCE_FACTOR = 1.2; // prefer arcs when error is similar
const MIN_SWEEP_ANGLE = Math.PI / 6; // minimum sweep angle for arcs (30 degrees)

/**
 * Calculate the nth percentile of an array of values
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * p);
  return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Incremental line fit state using Total Least Squares (TLS)
 */
class IncrementalLineFit {
  private n = 0;
  private sumX = 0;
  private sumY = 0;
  private sumXX = 0;
  private sumYY = 0;
  private sumXY = 0;

  addPoint(p: Point): void {
    this.n++;
    this.sumX += p.x;
    this.sumY += p.y;
    this.sumXX += p.x * p.x;
    this.sumYY += p.y * p.y;
    this.sumXY += p.x * p.y;
  }

  getCount(): number {
    return this.n;
  }

  /**
   * Compute line fit and return perpendicular distance to a point
   */
  distanceToPoint(p: Point): number {
    if (this.n < 2) return 0;

    const { centroid, direction } = this.getFit();

    // Vector from centroid to point
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;

    // Perpendicular distance: |v × n| where n is perpendicular to direction
    const perpX = -direction.y;
    const perpY = direction.x;

    return Math.abs(dx * perpX + dy * perpY);
  }

  getFit(): { centroid: Point; direction: Point } {
    if (this.n < 2) {
      return {
        centroid: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
      };
    }

    // Compute mean (centroid)
    const meanX = this.sumX / this.n;
    const meanY = this.sumY / this.n;

    // Compute covariance matrix
    const covXX = this.sumXX / this.n - meanX * meanX;
    const covYY = this.sumYY / this.n - meanY * meanY;
    const covXY = this.sumXY / this.n - meanX * meanY;

    // Find dominant eigenvector (PCA direction)
    const trace = covXX + covYY;
    const det = covXX * covYY - covXY * covXY;
    const lambda1 = (trace + Math.sqrt(trace * trace - 4 * det)) / 2;

    let dirX, dirY;
    if (Math.abs(covXY) > 1e-10) {
      dirX = lambda1 - covYY;
      dirY = covXY;
    } else if (covXX > covYY) {
      dirX = 1;
      dirY = 0;
    } else {
      dirX = 0;
      dirY = 1;
    }

    const length = Math.sqrt(dirX * dirX + dirY * dirY);
    if (length > 1e-10) {
      dirX /= length;
      dirY /= length;
    }

    return {
      centroid: { x: meanX, y: meanY },
      direction: { x: dirX, y: dirY },
    };
  }
}

/**
 * Incremental circle fit using algebraic least squares
 * Based on Pratt/Taubin method
 */
class IncrementalCircleFit {
  private n = 0;
  private sumX = 0;
  private sumY = 0;
  private sumXX = 0;
  private sumYY = 0;
  private sumXY = 0;
  private sumR2 = 0; // Σ(x²+y²)
  private sumXR2 = 0; // Σx(x²+y²)
  private sumYR2 = 0; // Σy(x²+y²)

  addPoint(p: Point): void {
    this.n++;
    const r2 = p.x * p.x + p.y * p.y;
    this.sumX += p.x;
    this.sumY += p.y;
    this.sumXX += p.x * p.x;
    this.sumYY += p.y * p.y;
    this.sumXY += p.x * p.y;
    this.sumR2 += r2;
    this.sumXR2 += p.x * r2;
    this.sumYR2 += p.y * r2;
  }

  getCount(): number {
    return this.n;
  }

  /**
   * Compute circle fit and return distance to point
   */
  distanceToPoint(p: Point): number {
    if (this.n < 3) return 0;

    const { center, radius, valid } = this.getFit();
    if (!valid) return Infinity;

    // Distance: ||p - center| - radius|
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const distToCenter = Math.sqrt(dx * dx + dy * dy);

    return Math.abs(distToCenter - radius);
  }

  getFit(): { center: Point; radius: number; valid: boolean } {
    if (this.n < 3) {
      return { center: { x: 0, y: 0 }, radius: 0, valid: false };
    }

    // Solve the algebraic circle fit
    // System: [A] * [cx, cy, c] = [b]
    // where (x-cx)² + (y-cy)² = r² becomes: x²+y² = 2cx*x + 2cy*y + c

    const n = this.n;

    // Build matrix elements
    const a11 = this.sumXX;
    const a12 = this.sumXY;
    const a13 = this.sumX;

    const a21 = this.sumXY;
    const a22 = this.sumYY;
    const a23 = this.sumY;

    const a31 = this.sumX;
    const a32 = this.sumY;
    const a33 = n;

    const b1 = this.sumXR2;
    const b2 = this.sumYR2;
    const b3 = this.sumR2;

    // Solve 3x3 system using Cramer's rule
    const det = a11 * (a22 * a33 - a23 * a32) -
      a12 * (a21 * a33 - a23 * a31) +
      a13 * (a21 * a32 - a22 * a31);

    if (Math.abs(det) < 1e-10) {
      return { center: { x: 0, y: 0 }, radius: 0, valid: false };
    }

    const det1 = b1 * (a22 * a33 - a23 * a32) -
      a12 * (b2 * a33 - a23 * b3) +
      a13 * (b2 * a32 - a22 * b3);

    const det2 = a11 * (b2 * a33 - a23 * b3) -
      b1 * (a21 * a33 - a23 * a31) +
      a13 * (a21 * b3 - b2 * a31);

    const det3 = a11 * (a22 * b3 - b2 * a32) -
      a12 * (a21 * b3 - b2 * a31) +
      b1 * (a21 * a32 - a22 * a31);

    const cx = det1 / det / 2;
    const cy = det2 / det / 2;
    const c = det3 / det;

    const radius = Math.sqrt(cx * cx + cy * cy + c);

    // Validate radius
    const valid = radius >= MIN_RADIUS && radius <= MAX_RADIUS;

    return {
      center: { x: cx, y: cy },
      radius,
      valid,
    };
  }
}

/**
 * Segment a path into line and arc segments using greedy incremental fitting
 */
export function segmentPath(points: Point[], isClosed: boolean): Segment[] {
  const N = points.length;
  if (N < 2) return [];

  const segments: Segment[] = [];
  let i = 0;

  while (i < N) {
    const segStart = i;
    const lineFit = new IncrementalLineFit();
    const circleFit = new IncrementalCircleFit();

    const lineErrors: number[] = [];
    const circleErrors: number[] = [];
    let j = i;

    // Grow segment as long as one of the fits is valid
    while (j < N) {
      lineFit.addPoint(points[j]);
      circleFit.addPoint(points[j]);

      if (lineFit.getCount() < MIN_POINTS) {
        j++;
        continue;
      }

      // Recalculate errors for ALL points in the segment with the updated fit
      lineErrors.length = 0;
      circleErrors.length = 0;
      for (let k = segStart; k <= j; k++) {
        lineErrors.push(lineFit.distanceToPoint(points[k]));
        circleErrors.push(circleFit.distanceToPoint(points[k]));
      }

      // Calculate median (50th) and 90th percentile errors
      const medianLineError = percentile(lineErrors, 0.5);
      const medianCircleError = percentile(circleErrors, 0.5);
      const percentileLineError = percentile(lineErrors, ERROR_PERCENTILE);
      const percentileCircleError = percentile(circleErrors, ERROR_PERCENTILE);

      // Continue if at least one fit is within tolerance
      // Require both median <= MAX_ERROR and 90th percentile <= MAX_ERROR_P90
      const lineOk = medianLineError <= MAX_ERROR && percentileLineError <= MAX_ERROR_P90;
      const circleOk = medianCircleError <= MAX_ERROR && percentileCircleError <= MAX_ERROR_P90;
      
      // Debug logging for segment growing
      if (j - segStart > 10 && j % 5 === 0) {
        console.log(`[Segment ${segStart}-${j}] Points: ${j - segStart + 1}`);
        console.log(`  Line: median=${medianLineError.toFixed(3)}px (${lineOk ? "✓" : "✗"}), p90=${percentileLineError.toFixed(3)}px`);
        console.log(`  Circle: median=${medianCircleError.toFixed(3)}px (${circleOk ? "✓" : "✗"}), p90=${percentileCircleError.toFixed(3)}px`);
        if (circleFit.getCount() >= MIN_POINTS) {
          const circleFitResult = circleFit.getFit();
          if (circleFitResult.valid) {
            console.log(`  Circle fit: center=(${circleFitResult.center.x.toFixed(1)}, ${circleFitResult.center.y.toFixed(1)}), radius=${circleFitResult.radius.toFixed(1)}px`);
          }
        }
      }
      
      // Stop if fits are getting worse - if neither fit has good median anymore, stop even if p90 is ok
      // This prevents creating long segments with mediocre fits
      const lineMedianBad = medianLineError > MAX_ERROR;
      const circleMedianBad = medianCircleError > MAX_ERROR;
      
      if (lineOk || circleOk) {
        // Allow continuing if at least one fit is fully within tolerance
        // But stop if both medians are bad (even if one p90 is still ok)
        if (lineMedianBad && circleMedianBad) {
          console.log(`[Segment ${segStart}-${j}] STOPPED - both median errors exceeded ${MAX_ERROR}px`);
          break;
        }
        j++;
        continue;
      }

      // Both fits failed - stop growing
      console.log(`[Segment ${segStart}-${j}] STOPPED - both fits exceeded tolerance`);
      break;
    }

    // Apply hysteresis: back up a few points
    const segEnd = Math.max(j - LOOKAHEAD_POINTS, segStart + MIN_POINTS - 1);

    console.log(`[Segment finalized] ${segStart}-${segEnd} (${segEnd - segStart + 1} points, backed up ${j - segEnd} points)`);

    // Create segment (classification happens later)
    segments.push({
      startIndex: segStart,
      endIndex: Math.min(segEnd, N - 1),
      type: "line", // Will be classified later
    });

    i = segEnd + 1;
  }

  // Handle closed paths by attempting to merge first and last segments
  if (isClosed && segments.length >= 2) {
    const merged = reconcileClosedPath(points, segments);
    return merged;
  }

  return segments;
}

/**
 * Reconcile closed paths by attempting to merge first and last segments
 */
function reconcileClosedPath(points: Point[], segments: Segment[]): Segment[] {
  if (segments.length < 2) return segments;

  const first = segments[0];
  const last = segments[segments.length - 1];

  // Collect wrapped points from last.startIndex to first.endIndex
  const wrappedPoints: Point[] = [];
  for (let i = last.startIndex; i < points.length; i++) {
    wrappedPoints.push(points[i]);
  }
  for (let i = 0; i <= first.endIndex; i++) {
    wrappedPoints.push(points[i]);
  }

  if (wrappedPoints.length < MIN_POINTS) return segments;

  // Try fitting both line and circle to merged segment
  const lineFit = new IncrementalLineFit();
  const circleFit = new IncrementalCircleFit();

  for (const p of wrappedPoints) {
    lineFit.addPoint(p);
    circleFit.addPoint(p);
  }

  let maxLineError = 0;
  let maxCircleError = 0;

  for (const p of wrappedPoints) {
    maxLineError = Math.max(maxLineError, lineFit.distanceToPoint(p));
    maxCircleError = Math.max(maxCircleError, circleFit.distanceToPoint(p));
  }

  // If either fit is within tolerance, merge the segments
  if (maxLineError <= MAX_ERROR || maxCircleError <= MAX_ERROR) {
    const newSegment: Segment = {
      startIndex: last.startIndex,
      endIndex: first.endIndex,
      type: "line", // Will be classified later
    };

    // Remove first and last, prepend merged segment
    return [newSegment, ...segments.slice(1, -1)];
  }

  return segments;
}

/**
 * Classify segments as line or arc based on fit quality
 */
export function classifySegments(
  points: Point[],
  segments: Segment[],
  isClosed: boolean,
): Segment[] {
  return segments.map((seg) => {
    const segPoints = extractSegmentPoints(points, seg, isClosed);

    if (segPoints.length < MIN_POINTS) {
      return { ...seg, type: "line" };
    }

    // Fit line
    const lineFit = new IncrementalLineFit();
    const lineErrors: number[] = [];
    for (const p of segPoints) {
      lineFit.addPoint(p);
    }
    const lineResult = lineFit.getFit();
    for (const p of segPoints) {
      lineErrors.push(lineFit.distanceToPoint(p));
    }
    const medianLineError = percentile(lineErrors, 0.5);
    const p90LineError = percentile(lineErrors, ERROR_PERCENTILE);

    // Fit circle
    const circleFit = new IncrementalCircleFit();
    const circleErrors: number[] = [];
    for (const p of segPoints) {
      circleFit.addPoint(p);
    }
    const circleResult = circleFit.getFit();
    let medianCircleError = Infinity;
    let p90CircleError = Infinity;
    let sweepAngle = 0;
    let clockwise = false;

    if (circleResult.valid) {
      for (const p of segPoints) {
        circleErrors.push(circleFit.distanceToPoint(p));
      }
      medianCircleError = percentile(circleErrors, 0.5);
      p90CircleError = percentile(circleErrors, ERROR_PERCENTILE);

      // Calculate sweep angle
      const startAngle = Math.atan2(
        segPoints[0].y - circleResult.center.y,
        segPoints[0].x - circleResult.center.x,
      );
      const endAngle = Math.atan2(
        segPoints[segPoints.length - 1].y - circleResult.center.y,
        segPoints[segPoints.length - 1].x - circleResult.center.x,
      );

      // Calculate angular span traveled and direction
      let totalAngle = 0;
      let cumulativeAngle = 0;
      for (let i = 1; i < segPoints.length; i++) {
        const angle1 = Math.atan2(
          segPoints[i - 1].y - circleResult.center.y,
          segPoints[i - 1].x - circleResult.center.x,
        );
        const angle2 = Math.atan2(
          segPoints[i].y - circleResult.center.y,
          segPoints[i].x - circleResult.center.x,
        );
        let deltaAngle = angle2 - angle1;

        // Normalize to [-π, π]
        while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

        cumulativeAngle += deltaAngle;
        totalAngle += Math.abs(deltaAngle);
      }
      sweepAngle = totalAngle;
      
      // Determine direction based on cumulative angle change
      // In SVG coords (y-axis points down):
      // - Positive cumulative angle = clockwise rotation
      // - Negative cumulative angle = counter-clockwise rotation
      clockwise = cumulativeAngle > 0;
    }

    // Decide: arc, line, or unfitted?
    // Check if either fit meets tolerance requirements
    const lineWithinTolerance = medianLineError <= MAX_ERROR && p90LineError <= MAX_ERROR_P90;
    const circleWithinTolerance = medianCircleError <= MAX_ERROR && p90CircleError <= MAX_ERROR_P90;
    
    // If neither fit is within tolerance, mark as unfitted (keep as pixel polyline)
    if (!lineWithinTolerance && !circleWithinTolerance) {
      console.log(`[Classify segment ${seg.startIndex}-${seg.endIndex}] ${segPoints.length} points`);
      console.log(`  Line: median=${medianLineError.toFixed(3)}px, p90=${p90LineError.toFixed(3)}px (✗)`);
      console.log(`  Circle: median=${medianCircleError.toFixed(3)}px, p90=${p90CircleError.toFixed(3)}px (✗)`);
      console.log(`  → Classified as: UNFITTED (neither fit within tolerance)`);
      
      return {
        ...seg,
        type: "polyline", // Keep raw skeleton pixels
      };
    }
    
    // Prefer arc if:
    // 1. Circle fit is valid
    // 2. Circle error meets tolerance requirements
    // 3. Circle error is significantly better than line error
    // 4. Sweep angle is sufficient
    const isArc = circleResult.valid &&
      circleWithinTolerance &&
      medianCircleError <= medianLineError * ARC_PREFERENCE_FACTOR &&
      sweepAngle >= MIN_SWEEP_ANGLE;
    
    console.log(`[Classify segment ${seg.startIndex}-${seg.endIndex}] ${segPoints.length} points`);
    console.log(`  Line: median=${medianLineError.toFixed(3)}px, p90=${p90LineError.toFixed(3)}px`);
    console.log(`  Circle: median=${medianCircleError.toFixed(3)}px, p90=${p90CircleError.toFixed(3)}px, valid=${circleResult.valid}, sweep=${(sweepAngle * 180 / Math.PI).toFixed(1)}°`);
    if (circleResult.valid) {
      console.log(`  Circle: center=(${circleResult.center.x.toFixed(1)}, ${circleResult.center.y.toFixed(1)}), radius=${circleResult.radius.toFixed(1)}px`);
    }
    console.log(`  → Classified as: ${isArc ? "ARC" : "LINE"} (circle ${medianCircleError.toFixed(3)} vs line ${medianLineError.toFixed(3)} * ${ARC_PREFERENCE_FACTOR})`);
    
    if (isArc) {
      return {
        ...seg,
        type: "arc",
        circleFit: {
          center: circleResult.center,
          radius: circleResult.radius,
          error: medianCircleError,
          sweepAngle,
          clockwise,
        },
      };
    } else {
      return {
        ...seg,
        type: "line",
        lineFit: {
          centroid: lineResult.centroid,
          direction: lineResult.direction,
          error: medianLineError,
        },
      };
    }
  });
}

/**
 * Extract points for a segment, handling wrap-around for closed paths
 */
function extractSegmentPoints(
  points: Point[],
  segment: Segment,
  isClosed: boolean,
): Point[] {
  const result: Point[] = [];

  if (segment.endIndex >= segment.startIndex) {
    // Normal case: no wrap-around
    for (let i = segment.startIndex; i <= segment.endIndex; i++) {
      result.push(points[i]);
    }
  } else if (isClosed) {
    // Wrap-around case for closed paths
    for (let i = segment.startIndex; i < points.length; i++) {
      result.push(points[i]);
    }
    for (let i = 0; i <= segment.endIndex; i++) {
      result.push(points[i]);
    }
  }

  return result;
}

/**
 * Main entry point: segment and classify a path
 */
export function vectorizeWithIncrementalSegmentation(
  points: Point[],
  isClosed: boolean,
): Segment[] {
  const segments = segmentPath(points, isClosed);
  return classifySegments(points, segments, isClosed);
}
