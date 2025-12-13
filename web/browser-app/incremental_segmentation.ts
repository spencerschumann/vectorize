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
  // Projected endpoints for fitted segments (on the fitted curve)
  // For unfitted polylines, these are undefined and raw skeleton pixels are used
  projectedStart?: Point;
  projectedEnd?: Point;
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
const MAX_ERROR_P90 = 1; // absolute distance tolerance (pixels) at 90th percentile
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
      const lineOk = medianLineError <= MAX_ERROR &&
        percentileLineError <= MAX_ERROR_P90;
      const circleOk = medianCircleError <= MAX_ERROR &&
        percentileCircleError <= MAX_ERROR_P90;

      // Debug logging for segment growing
      if (j - segStart > 10 && j % 5 === 0) {
        console.log(`[Segment ${segStart}-${j}] Points: ${j - segStart + 1}`);
        console.log(
          `  Line: median=${medianLineError.toFixed(3)}px (${
            lineOk ? "✓" : "✗"
          }), p90=${percentileLineError.toFixed(3)}px`,
        );
        console.log(
          `  Circle: median=${medianCircleError.toFixed(3)}px (${
            circleOk ? "✓" : "✗"
          }), p90=${percentileCircleError.toFixed(3)}px`,
        );
        if (circleFit.getCount() >= MIN_POINTS) {
          const circleFitResult = circleFit.getFit();
          if (circleFitResult.valid) {
            console.log(
              `  Circle fit: center=(${circleFitResult.center.x.toFixed(1)}, ${
                circleFitResult.center.y.toFixed(1)
              }), radius=${circleFitResult.radius.toFixed(1)}px`,
            );
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
          console.log(
            `[Segment ${segStart}-${j}] STOPPED - both median errors exceeded ${MAX_ERROR}px`,
          );
          break;
        }
        j++;
        continue;
      }

      // Both fits failed - stop growing
      console.log(
        `[Segment ${segStart}-${j}] STOPPED - both fits exceeded tolerance`,
      );
      break;
    }

    // Determine segment end based on where we stopped and path end proximity
    let segEnd: number;
    
    // Check if we're at or very close to the end of the path
    if (j >= N - 1) {
      // Reached the end naturally - use the last point
      segEnd = N - 1;
      console.log(
        `[Segment reached end] ${segStart}-${segEnd} (${
          segEnd - segStart + 1
        } points)`,
      );
    } else if (N - 1 - j <= LOOKAHEAD_POINTS + 2) {
      // Close to the end - try extending to the end if fit is still good
      const extendedLineFit = new IncrementalLineFit();
      const extendedCircleFit = new IncrementalCircleFit();
      const extendedLineErrors: number[] = [];
      const extendedCircleErrors: number[] = [];
      
      for (let k = segStart; k < N; k++) {
        extendedLineFit.addPoint(points[k]);
        extendedCircleFit.addPoint(points[k]);
      }
      
      for (let k = segStart; k < N; k++) {
        extendedLineErrors.push(extendedLineFit.distanceToPoint(points[k]));
        extendedCircleErrors.push(extendedCircleFit.distanceToPoint(points[k]));
      }
      
      const medianLineError = percentile(extendedLineErrors, 0.5);
      const medianCircleError = percentile(extendedCircleErrors, 0.5);
      const p90LineError = percentile(extendedLineErrors, ERROR_PERCENTILE);
      const p90CircleError = percentile(extendedCircleErrors, ERROR_PERCENTILE);
      
      const lineOk = medianLineError <= MAX_ERROR && p90LineError <= MAX_ERROR_P90;
      const circleOk = medianCircleError <= MAX_ERROR && p90CircleError <= MAX_ERROR_P90;
      
      if (lineOk || circleOk) {
        segEnd = N - 1;
        console.log(
          `[Segment extended to end] ${segStart}-${segEnd} (${
            segEnd - segStart + 1
          } points, fit still good)`,
        );
      } else {
        // Can't extend - use normal backup
        segEnd = Math.max(j - LOOKAHEAD_POINTS, segStart + MIN_POINTS - 1);
        console.log(
          `[Segment near end, can't extend] ${segStart}-${segEnd} (${
            segEnd - segStart + 1
          } points, ${N - 1 - segEnd} points remain)`,
        );
      }
    } else {
      // Normal case: back up by lookahead points
      segEnd = Math.max(j - LOOKAHEAD_POINTS, segStart + MIN_POINTS - 1);
    }

    console.log(
      `[Segment finalized] ${segStart}-${segEnd} (${
        segEnd - segStart + 1
      } points, backed up ${j - segEnd} points)`,
    );

    // Create segment (classification happens later)
    segments.push({
      startIndex: segStart,
      endIndex: Math.min(segEnd, N - 1),
      type: "line", // Will be classified later
    });

    i = segEnd + 1;
  }

  // For open paths, try extending first/last segments to path boundaries
  if (!isClosed && segments.length > 0) {
    const extended = extendBoundarySegments(points, segments);
    
    // Handle closed paths by attempting to merge first and last segments
    if (isClosed && extended.length >= 2) {
      const merged = reconcileClosedPath(points, extended);
      return merged;
    }
    
    return extended;
  }

  // Handle closed paths by attempting to merge first and last segments
  if (isClosed && segments.length >= 2) {
    const merged = reconcileClosedPath(points, segments);
    return merged;
  }

  return segments;
}

/**
 * Extend first and last segments of open paths to reach path boundaries (indices 0 and N-1)
 */
function extendBoundarySegments(points: Point[], segments: Segment[]): Segment[] {
  if (segments.length === 0) return segments;
  
  const N = points.length;
  const result = [...segments];
  
  // Try extending first segment to start at index 0
  if (result[0].startIndex > 0) {
    const seg = result[0];
    const extendedPoints: Point[] = [];
    for (let i = 0; i <= seg.endIndex; i++) {
      extendedPoints.push(points[i]);
    }
    
    // Test if extending to 0 maintains reasonable fit
    const lineFit = new IncrementalLineFit();
    const circleFit = new IncrementalCircleFit();
    for (const p of extendedPoints) {
      lineFit.addPoint(p);
      circleFit.addPoint(p);
    }
    
    const lineErrors = extendedPoints.map(p => lineFit.distanceToPoint(p));
    const circleErrors = extendedPoints.map(p => circleFit.distanceToPoint(p));
    
    const medianLineError = percentile(lineErrors, 0.5);
    const medianCircleError = percentile(circleErrors, 0.5);
    const p90LineError = percentile(lineErrors, ERROR_PERCENTILE);
    const p90CircleError = percentile(circleErrors, ERROR_PERCENTILE);
    
    const lineOk = medianLineError <= MAX_ERROR && p90LineError <= MAX_ERROR_P90;
    const circleOk = medianCircleError <= MAX_ERROR && p90CircleError <= MAX_ERROR_P90;
    
    if (lineOk || circleOk) {
      result[0] = { ...seg, startIndex: 0 };
      console.log(`[Extended first segment to path start] 0-${seg.endIndex}`);
    }
  }
  
  // Try extending last segment to end at index N-1
  const lastIdx = result.length - 1;
  if (result[lastIdx].endIndex < N - 1) {
    const seg = result[lastIdx];
    const extendedPoints: Point[] = [];
    for (let i = seg.startIndex; i < N; i++) {
      extendedPoints.push(points[i]);
    }
    
    // Test if extending to N-1 maintains reasonable fit
    const lineFit = new IncrementalLineFit();
    const circleFit = new IncrementalCircleFit();
    for (const p of extendedPoints) {
      lineFit.addPoint(p);
      circleFit.addPoint(p);
    }
    
    const lineErrors = extendedPoints.map(p => lineFit.distanceToPoint(p));
    const circleErrors = extendedPoints.map(p => circleFit.distanceToPoint(p));
    
    const medianLineError = percentile(lineErrors, 0.5);
    const medianCircleError = percentile(circleErrors, 0.5);
    const p90LineError = percentile(lineErrors, ERROR_PERCENTILE);
    const p90CircleError = percentile(circleErrors, ERROR_PERCENTILE);
    
    const lineOk = medianLineError <= MAX_ERROR && p90LineError <= MAX_ERROR_P90;
    const circleOk = medianCircleError <= MAX_ERROR && p90CircleError <= MAX_ERROR_P90;
    
    if (lineOk || circleOk) {
      result[lastIdx] = { ...seg, endIndex: N - 1 };
      console.log(`[Extended last segment to path end] ${seg.startIndex}-${N - 1}`);
    }
  }
  
  return result;
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
  const lineErrors: number[] = [];
  const circleErrors: number[] = [];

  for (const p of wrappedPoints) {
    lineFit.addPoint(p);
    circleFit.addPoint(p);
  }

  for (const p of wrappedPoints) {
    lineErrors.push(lineFit.distanceToPoint(p));
    circleErrors.push(circleFit.distanceToPoint(p));
  }

  const medianLineError = percentile(lineErrors, 0.5);
  const medianCircleError = percentile(circleErrors, 0.5);
  const p90LineError = percentile(lineErrors, ERROR_PERCENTILE);
  const p90CircleError = percentile(circleErrors, ERROR_PERCENTILE);

  const lineOk = medianLineError <= MAX_ERROR && p90LineError <= MAX_ERROR_P90;
  const circleOk = medianCircleError <= MAX_ERROR && p90CircleError <= MAX_ERROR_P90;

  // If either fit is within tolerance, merge the segments
  if (lineOk || circleOk) {
    console.log(
      `[Closed path] Merging first and last segments: ${last.startIndex}-${first.endIndex} (${wrappedPoints.length} points)`,
    );
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
    const lineWithinTolerance = medianLineError <= MAX_ERROR &&
      p90LineError <= MAX_ERROR_P90;
    const circleWithinTolerance = medianCircleError <= MAX_ERROR &&
      p90CircleError <= MAX_ERROR_P90;

    // If neither fit is within tolerance, mark as unfitted (keep as pixel polyline)
    if (!lineWithinTolerance && !circleWithinTolerance) {
      console.log(
        `[Classify segment ${seg.startIndex}-${seg.endIndex}] ${segPoints.length} points`,
      );
      console.log(
        `  Line: median=${medianLineError.toFixed(3)}px, p90=${
          p90LineError.toFixed(3)
        }px (✗)`,
      );
      console.log(
        `  Circle: median=${medianCircleError.toFixed(3)}px, p90=${
          p90CircleError.toFixed(3)
        }px (✗)`,
      );
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

    console.log(
      `[Classify segment ${seg.startIndex}-${seg.endIndex}] ${segPoints.length} points`,
    );
    console.log(
      `  Line: median=${medianLineError.toFixed(3)}px, p90=${
        p90LineError.toFixed(3)
      }px`,
    );
    console.log(
      `  Circle: median=${medianCircleError.toFixed(3)}px, p90=${
        p90CircleError.toFixed(3)
      }px, valid=${circleResult.valid}, sweep=${
        (sweepAngle * 180 / Math.PI).toFixed(1)
      }°`,
    );
    if (circleResult.valid) {
      console.log(
        `  Circle: center=(${circleResult.center.x.toFixed(1)}, ${
          circleResult.center.y.toFixed(1)
        }), radius=${circleResult.radius.toFixed(1)}px`,
      );
    }
    console.log(
      `  → Classified as: ${isArc ? "ARC" : "LINE"} (circle ${
        medianCircleError.toFixed(3)
      } vs line ${medianLineError.toFixed(3)} * ${ARC_PREFERENCE_FACTOR})`,
    );

    if (isArc) {
      // Project start and end points onto fitted circle
      const start = segPoints[0];
      const end = segPoints[segPoints.length - 1];
      const center = circleResult.center;
      const radius = circleResult.radius;

      // Project start point
      const dx0 = start.x - center.x;
      const dy0 = start.y - center.y;
      const dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const projStart = {
        x: center.x + (dx0 / dist0) * radius,
        y: center.y + (dy0 / dist0) * radius,
      };

      // Project end point
      const dx1 = end.x - center.x;
      const dy1 = end.y - center.y;
      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const projEnd = {
        x: center.x + (dx1 / dist1) * radius,
        y: center.y + (dy1 / dist1) * radius,
      };

      return {
        ...seg,
        type: "arc",
        projectedStart: projStart,
        projectedEnd: projEnd,
        circleFit: {
          center: circleResult.center,
          radius: circleResult.radius,
          error: medianCircleError,
          sweepAngle,
          clockwise,
        },
      };
    } else {
      // Project start and end points onto fitted line
      const start = segPoints[0];
      const end = segPoints[segPoints.length - 1];
      const centroid = lineResult.centroid;
      const direction = lineResult.direction;

      // Project onto line: P_proj = centroid + t * direction
      // where t = (P - centroid) · direction
      const projectPoint = (p: Point) => {
        const vx = p.x - centroid.x;
        const vy = p.y - centroid.y;
        const t = vx * direction.x + vy * direction.y;
        return {
          x: centroid.x + t * direction.x,
          y: centroid.y + t * direction.y,
        };
      };

      const projStart = projectPoint(start);
      const projEnd = projectPoint(end);

      return {
        ...seg,
        type: "line",
        projectedStart: projStart,
        projectedEnd: projEnd,
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
 * Refine segment boundaries to minimize fitting error
 * Try extending or trimming endpoints to improve fit quality
 */
function refineSegmentBoundaries(
  points: Point[],
  segments: Segment[],
  isClosed: boolean,
): Segment[] {
  const refined: Segment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // Only refine fitted segments (line/arc)
    if (seg.type !== "line" && seg.type !== "arc") {
      refined.push(seg);
      continue;
    }

    // Get current segment points
    const currentSegPoints = extractSegmentPoints(points, seg, isClosed);
    if (currentSegPoints.length < MIN_POINTS) {
      refined.push(seg);
      continue;
    }

    let bestStartIndex = seg.startIndex;
    let bestEndIndex = seg.endIndex;
    let bestError = Infinity;

    // Calculate baseline error
    const baselineFit = seg.type === "line"
      ? new IncrementalLineFit()
      : new IncrementalCircleFit();
    for (const p of currentSegPoints) {
      baselineFit.addPoint(p);
    }
    const baselineErrors = currentSegPoints.map((p) =>
      baselineFit.distanceToPoint(p)
    );
    bestError = percentile(baselineErrors, 0.5);
    
    // Check if boundary points fit well
    const startPointError = baselineErrors[0];
    const endPointError = baselineErrors[baselineErrors.length - 1];

    const adjustment_range = 5; // Max points to adjust
    
    // Determine if this segment is at a path boundary (only for open paths)
    const isFirstSegment = (i === 0);
    const isLastSegment = (i === segments.length - 1);
    
    // Phase 1: Find optimal start index by testing extensions/trims independently
    // Look for local minima: keep extending as long as error decreases or stays similar
    let optimalStartIndex = seg.startIndex;
    let bestStartError = bestError;
    
    // Don't trim from start if the start point already fits well
    const canTrimStart = startPointError > MAX_ERROR;
    
    // Try extending/trimming start
    for (let startDelta = -adjustment_range; startDelta <= adjustment_range; startDelta++) {
      if (startDelta === 0) continue;
      
      // Skip trimming if start fits well
      if (startDelta > 0 && !canTrimStart) continue;
      
      const newStartIndex = seg.startIndex + startDelta;
      
      // Ensure index is within bounds
      if (newStartIndex < 0 || newStartIndex >= points.length) continue;
      
      // Ensure we don't overlap with previous segment
      if (i > 0 && !isClosed) {
        const prevSegEnd = refined[i - 1].endIndex;
        if (newStartIndex <= prevSegEnd) continue;
      }
      
      // Test this start index with current end index
      const testSegLength = seg.endIndex >= newStartIndex
        ? seg.endIndex - newStartIndex + 1
        : (points.length - newStartIndex) + seg.endIndex + 1;
      if (testSegLength < MIN_POINTS) continue;
      
      const testPoints = extractSegmentPoints(
        points,
        { startIndex: newStartIndex, endIndex: seg.endIndex, type: seg.type },
        isClosed,
      );
      
      if (testPoints.length < MIN_POINTS) continue;
      
      const testFit = seg.type === "line"
        ? new IncrementalLineFit()
        : new IncrementalCircleFit();
      for (const p of testPoints) {
        testFit.addPoint(p);
      }
      
      if (seg.type === "arc") {
        const circleFit = testFit as IncrementalCircleFit;
        const result = circleFit.getFit();
        if (!result.valid) continue;
      }
      
      const testErrors = testPoints.map((p) => testFit.distanceToPoint(p));
      const testMedian = percentile(testErrors, 0.5);
      const testP90 = percentile(testErrors, ERROR_PERCENTILE);
      
      // Accept if error improves or stays very similar (within 5%)
      // This finds local minima for extensions
      if (
        testMedian <= MAX_ERROR &&
        testP90 <= MAX_ERROR_P90 &&
        testMedian <= bestStartError * 1.05
      ) {
        // For extensions (negative delta), require actual improvement
        // For trims (positive delta), allow if it improves
        if (startDelta < 0 && testMedian < bestStartError) {
          optimalStartIndex = newStartIndex;
          bestStartError = testMedian;
        } else if (startDelta > 0 && testMedian < bestStartError) {
          optimalStartIndex = newStartIndex;
          bestStartError = testMedian;
        }
      }
    }
    
    // Phase 2: Find optimal end index using the optimal start index
    let optimalEndIndex = seg.endIndex;
    let bestEndError = bestStartError;
    
    // Don't trim from end if the end point already fits well
    const canTrimEnd = endPointError > MAX_ERROR;
    
    // Try extending/trimming end
    for (let endDelta = -adjustment_range; endDelta <= adjustment_range; endDelta++) {
      if (endDelta === 0) continue;
      
      // Skip trimming if end fits well
      if (endDelta < 0 && !canTrimEnd) continue;
      
      const newEndIndex = seg.endIndex + endDelta;
      
      // Ensure index is within bounds
      if (newEndIndex < 0 || newEndIndex >= points.length) continue;
      
      // Ensure we don't overlap with next segment
      if (i < segments.length - 1 && !isClosed) {
        const nextSegStart = segments[i + 1].startIndex;
        if (newEndIndex >= nextSegStart) continue;
      }
      
      // Test this end index with optimal start index
      const testSegLength = newEndIndex >= optimalStartIndex
        ? newEndIndex - optimalStartIndex + 1
        : (points.length - optimalStartIndex) + newEndIndex + 1;
      if (testSegLength < MIN_POINTS) continue;
      
      const testPoints = extractSegmentPoints(
        points,
        { startIndex: optimalStartIndex, endIndex: newEndIndex, type: seg.type },
        isClosed,
      );
      
      if (testPoints.length < MIN_POINTS) continue;
      
      const testFit = seg.type === "line"
        ? new IncrementalLineFit()
        : new IncrementalCircleFit();
      for (const p of testPoints) {
        testFit.addPoint(p);
      }
      
      if (seg.type === "arc") {
        const circleFit = testFit as IncrementalCircleFit;
        const result = circleFit.getFit();
        if (!result.valid) continue;
      }
      
      const testErrors = testPoints.map((p) => testFit.distanceToPoint(p));
      const testMedian = percentile(testErrors, 0.5);
      const testP90 = percentile(testErrors, ERROR_PERCENTILE);
      
      // Accept if error improves or stays very similar (within 5%)
      if (
        testMedian <= MAX_ERROR &&
        testP90 <= MAX_ERROR_P90 &&
        testMedian <= bestEndError * 1.05
      ) {
        // For extensions (positive delta), require actual improvement
        // For trims (negative delta), allow if it improves
        if (endDelta > 0 && testMedian < bestEndError) {
          optimalEndIndex = newEndIndex;
          bestEndError = testMedian;
        } else if (endDelta < 0 && testMedian < bestEndError) {
          optimalEndIndex = newEndIndex;
          bestEndError = testMedian;
        }
      }
    }
    
    bestStartIndex = optimalStartIndex;
    bestEndIndex = optimalEndIndex;
    bestError = bestEndError;

    // Update segment if we found improvement
    // But enforce continuity: refined segments must be adjacent (no gaps)
    if (bestStartIndex !== seg.startIndex || bestEndIndex !== seg.endIndex) {
      // Check for gaps with previous segment
      if (i > 0) {
        const prevEnd = refined[i - 1].endIndex;
        // Ensure no gap: new segment must start at prevEnd+1 or earlier
        if (bestStartIndex > prevEnd + 1) {
          // Would create a gap - adjust start to maintain continuity
          bestStartIndex = prevEnd + 1;
          console.log(
            `[Refine segment ${seg.startIndex}-${seg.endIndex}] Gap detected, adjusted start to ${bestStartIndex}`,
          );
        }
      }
      
      console.log(
        `[Refine segment ${seg.startIndex}-${seg.endIndex}] → [${bestStartIndex}-${bestEndIndex}] (error ${
          bestError.toFixed(3)
        }px)`,
      );
      refined.push({
        ...seg,
        startIndex: bestStartIndex,
        endIndex: bestEndIndex,
      });
    } else {
      refined.push(seg);
    }
  }

  return refined;
}

/**
 * Main entry point: segment and classify a path
 */
export function vectorizeWithIncrementalSegmentation(
  points: Point[],
  isClosed: boolean,
): Segment[] {
  console.log(
    `\n=== Vectorizing path: ${points.length} points, ${
      isClosed ? "closed" : "open"
    } ===`,
  );
  
  const segments = segmentPath(points, isClosed);
  console.log(`  After segmentPath: ${segments.length} segments`);
  segments.forEach((s, i) =>
    console.log(`    Seg ${i}: [${s.startIndex}-${s.endIndex}]`)
  );
  
  const classified = classifySegments(points, segments, isClosed);
  console.log(`  After classification: ${classified.length} segments`);
  classified.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );
  
  const refined = refineSegmentBoundaries(points, classified, isClosed);
  console.log(`  After refinement: ${refined.length} segments`);
  refined.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );
  
  const final = classifySegments(points, refined, isClosed);
  console.log(`  Final: ${final.length} segments`);
  final.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );
  
  return final;
}
