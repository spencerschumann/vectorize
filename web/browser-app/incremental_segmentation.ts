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

      const lineOk = medianLineError <= MAX_ERROR &&
        p90LineError <= MAX_ERROR_P90;
      const circleOk = medianCircleError <= MAX_ERROR &&
        p90CircleError <= MAX_ERROR_P90;

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
 * Helper: Try extending a segment boundary incrementally, stopping when fit degrades
 * Tests both line and arc fits since segment type isn't determined yet
 */
function tryExtendBoundary(
  points: Point[],
  startIndex: number,
  endIndex: number,
  direction: "start" | "end",
  targetIndex: number,
): number {
  // Calculate baseline error
  const baselinePoints: Point[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    baselinePoints.push(points[i]);
  }
  const baselineFit = new IncrementalLineFit();
  for (const p of baselinePoints) {
    baselineFit.addPoint(p);
  }
  const baselineErrors = baselinePoints.map((p) =>
    baselineFit.distanceToPoint(p)
  );
  let bestError = percentile(baselineErrors, 0.5);
  let bestIndex = direction === "start" ? startIndex : endIndex;

  // Determine iteration parameters based on direction
  const step = direction === "start" ? -1 : 1;
  const shouldContinue = direction === "start"
    ? (idx: number) => idx >= targetIndex
    : (idx: number) => idx < targetIndex;

  // Try extending incrementally
  for (
    let testIdx = bestIndex + step;
    shouldContinue(testIdx);
    testIdx += step
  ) {
    const testPoints: Point[] = [];
    const testStart = direction === "start" ? testIdx : startIndex;
    const testEnd = direction === "end" ? testIdx : endIndex;

    for (let i = testStart; i <= testEnd; i++) {
      testPoints.push(points[i]);
    }

    // Test both line and arc fits
    const lineFit = new IncrementalLineFit();
    const circleFit = new IncrementalCircleFit();
    for (const p of testPoints) {
      lineFit.addPoint(p);
      circleFit.addPoint(p);
    }

    const lineErrors = testPoints.map((p) => lineFit.distanceToPoint(p));
    const circleErrors = testPoints.map((p) => circleFit.distanceToPoint(p));

    const lineMedian = percentile(lineErrors, 0.5);
    const circleMedian = percentile(circleErrors, 0.5);
    const lineP90 = percentile(lineErrors, ERROR_PERCENTILE);
    const circleP90 = percentile(circleErrors, ERROR_PERCENTILE);

    const circleResult = circleFit.getFit();
    const lineOk = lineMedian <= MAX_ERROR && lineP90 <= MAX_ERROR_P90;
    const circleOk = circleResult.valid && circleMedian <= MAX_ERROR &&
      circleP90 <= MAX_ERROR_P90;

    // Use whichever fit is better
    const testMedian = (lineOk && circleOk)
      ? Math.min(lineMedian, circleMedian)
      : lineOk
      ? lineMedian
      : circleOk
      ? circleMedian
      : Infinity;

    // Accept if it improves or maintains fit within tolerance
    if (testMedian <= bestError && testMedian !== Infinity) {
      bestIndex = testIdx;
      bestError = testMedian;
    } else {
      // Stop extending if fit degrades
      break;
    }
  }

  return bestIndex;
}

/**
 * Extend first and last segments of open paths to reach path boundaries (indices 0 and N-1)
 */
function extendBoundarySegments(
  points: Point[],
  segments: Segment[],
): Segment[] {
  if (segments.length === 0) return segments;

  const N = points.length;
  const result = [...segments];

  // Try extending first segment toward index 0
  if (result[0].startIndex > 0) {
    const seg = result[0];
    const bestStartIndex = tryExtendBoundary(
      points,
      seg.startIndex,
      seg.endIndex,
      "start",
      0,
    );

    if (bestStartIndex < seg.startIndex) {
      result[0] = { ...seg, startIndex: bestStartIndex };
      console.log(
        `[Extended first segment toward path start] ${bestStartIndex}-${seg.endIndex} (was ${seg.startIndex}-${seg.endIndex})`,
      );
    }
  }

  // Try extending last segment toward index N-1
  const lastIdx = result.length - 1;
  if (result[lastIdx].endIndex < N - 1) {
    const seg = result[lastIdx];
    const bestEndIndex = tryExtendBoundary(
      points,
      seg.startIndex,
      seg.endIndex,
      "end",
      N,
    );

    if (bestEndIndex > seg.endIndex) {
      result[lastIdx] = { ...seg, endIndex: bestEndIndex };
      console.log(
        `[Extended last segment toward path end] ${seg.startIndex}-${bestEndIndex} (was ${seg.startIndex}-${seg.endIndex})`,
      );
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
  const circleOk = medianCircleError <= MAX_ERROR &&
    p90CircleError <= MAX_ERROR_P90;

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
    const isFirstSegment = i === 0;
    const isLastSegment = i === segments.length - 1;

    // Phase 1: Find optimal start index by testing extensions/trims independently
    // Look for local minima: keep extending as long as error decreases or stays similar
    let optimalStartIndex = seg.startIndex;
    let bestStartError = bestError;

    // Don't trim from start if the start point already fits well
    const canTrimStart = startPointError > MAX_ERROR;

    // Try extending/trimming start
    for (
      let startDelta = -adjustment_range;
      startDelta <= adjustment_range;
      startDelta++
    ) {
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
    for (
      let endDelta = -adjustment_range;
      endDelta <= adjustment_range;
      endDelta++
    ) {
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
        {
          startIndex: optimalStartIndex,
          endIndex: newEndIndex,
          type: seg.type,
        },
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
 * Find intersection point between two line segments (infinite lines)
 */
function lineLineIntersection(
  line1: { centroid: Point; direction: Point },
  line2: { centroid: Point; direction: Point },
): Point | null {
  const { centroid: c1, direction: d1 } = line1;
  const { centroid: c2, direction: d2 } = line2;

  // Solve: c1 + t*d1 = c2 + s*d2
  // In matrix form: [d1x -d2x][t] = [c2x - c1x]
  //                 [d1y -d2y][s]   [c2y - c1y]

  const det = d1.x * (-d2.y) - d1.y * (-d2.x);
  if (Math.abs(det) < 1e-10) return null; // Parallel lines

  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;

  const t = (dx * (-d2.y) - dy * (-d2.x)) / det;

  return {
    x: c1.x + t * d1.x,
    y: c1.y + t * d1.y,
  };
}

/**
 * Find intersection points between a line and a circle
 */
function lineCircleIntersection(
  line: { centroid: Point; direction: Point },
  circle: { center: Point; radius: number },
): Point[] {
  const { centroid, direction } = line;
  const { center, radius } = circle;

  // Parametric line: P = centroid + t * direction
  // Circle: |P - center|^2 = radius^2
  // Substitute and solve quadratic for t

  const dx = centroid.x - center.x;
  const dy = centroid.y - center.y;

  const a = direction.x * direction.x + direction.y * direction.y;
  const b = 2 * (dx * direction.x + dy * direction.y);
  const c = dx * dx + dy * dy - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return []; // No intersection

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  const result: Point[] = [];
  result.push({
    x: centroid.x + t1 * direction.x,
    y: centroid.y + t1 * direction.y,
  });
  if (discriminant > 1e-10) {
    result.push({
      x: centroid.x + t2 * direction.x,
      y: centroid.y + t2 * direction.y,
    });
  }
  return result;
}

/**
 * Find intersection points between two circles
 */
function circleCircleIntersection(
  circle1: { center: Point; radius: number },
  circle2: { center: Point; radius: number },
): Point[] {
  const { center: c1, radius: r1 } = circle1;
  const { center: c2, radius: r2 } = circle2;

  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Check if circles are too far apart or one contains the other
  if (dist > r1 + r2 || dist < Math.abs(r1 - r2) || dist < 1e-10) {
    return [];
  }

  // Find intersection points
  const a = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(r1 * r1 - a * a);

  const px = c1.x + a * (dx / dist);
  const py = c1.y + a * (dy / dist);

  const result: Point[] = [];
  result.push({
    x: px + h * (-dy / dist),
    y: py + h * (dx / dist),
  });

  if (h > 1e-10) {
    result.push({
      x: px - h * (-dy / dist),
      y: py - h * (dx / dist),
    });
  }

  return result;
}

/**
 * Choose the closest intersection point to a reference point
 */
function closestIntersection(
  intersections: Point[],
  reference: Point,
): Point | null {
  if (intersections.length === 0) return null;

  let closest = intersections[0];
  let minDist = Infinity;

  for (const pt of intersections) {
    const dx = pt.x - reference.x;
    const dy = pt.y - reference.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      closest = pt;
    }
  }

  return closest;
}

/**
 * Refine segment connections by finding intersections and bridging gaps
 */
function refineSegmentConnections(
  points: Point[],
  segments: Segment[],
  isClosed: boolean,
): Segment[] {
  if (segments.length < 2) return segments;

  // Make a working copy since we'll modify segments in place
  const workingSegments = segments.map((s) => ({ ...s }));
  const result: Segment[] = [];
  const MAX_EXTENSION_ERROR = 0.75; // Same as MAX_ERROR
  const MIN_BRIDGE_SIZE = 3; // Minimum points for a bridge segment
  const skippedSegments = new Set<number>(); // Track segments that were replaced

  for (let i = 0; i < workingSegments.length; i++) {
    const seg = workingSegments[i];
    const isLastSegment = i === workingSegments.length - 1;
    const nextSeg = !isLastSegment
      ? workingSegments[i + 1]
      : (isClosed ? workingSegments[0] : null);

    // Skip this segment if it was replaced in a previous iteration
    if (skippedSegments.has(i)) {
      console.log(`[Refine connections] Skipping replaced segment ${i}`);
      continue;
    }

    result.push(seg);

    if (!nextSeg) continue;

    // Check if there's a gap between segments (or if they're adjacent)
    // For closed paths wrapping from last segment to first, calculate wrap-around gap
    const gapSize = (isLastSegment && isClosed)
      ? (points.length - 1 - seg.endIndex) + nextSeg.startIndex
      : nextSeg.startIndex - seg.endIndex - 1;

    const nextSegIdx = isLastSegment && isClosed ? 0 : i + 1;

    // Process intersection for adjacent or gapped segments
    if (gapSize < 0) continue; // Skip overlapping segments

    if (gapSize === 0) {
      console.log(
        `[Refine connections] Adjacent segments ${i} [${seg.startIndex}-${seg.endIndex}] and ${nextSegIdx} [${nextSeg.startIndex}-${nextSeg.endIndex}]`,
      );
    } else {
      console.log(
        `[Refine connections] Gap between seg ${i} [${seg.startIndex}-${seg.endIndex}] and seg ${nextSegIdx} [${nextSeg.startIndex}-${nextSeg.endIndex}]: ${gapSize} points`,
      );
    }

    // Skip intersection attempt if either segment is unfitted (polyline)
    // These will be handled by the expanded bridge approach below
    const skipIntersection = seg.type === "polyline" ||
      nextSeg.type === "polyline";

    // If nextSeg is a polyline, treat it as part of the gap to be bridged
    // We'll look ahead to the segment after the polyline
    const actualNextSeg =
      nextSeg.type === "polyline" && i + 1 < workingSegments.length - 1
        ? workingSegments[i + 2]
        : nextSeg;

    // Adjust gap size to include polyline segment if present
    let actualGapSize = gapSize;
    if (nextSeg.type === "polyline") {
      // Gap includes the polyline segment itself plus any gap after it
      actualGapSize = actualNextSeg.startIndex - seg.endIndex - 1;
      console.log(
        `[Refine connections] Polyline segment ${
          i + 1
        } [${nextSeg.startIndex}-${nextSeg.endIndex}] will be replaced, total gap: ${actualGapSize} points`,
      );
    }

    // Try to find intersection point (only for fitted segments)
    let intersection: Point | null = null;

    if (!skipIntersection) {
      if (
        seg.type === "line" && actualNextSeg.type === "line" && seg.lineFit &&
        actualNextSeg.lineFit
      ) {
        intersection = lineLineIntersection(seg.lineFit, actualNextSeg.lineFit);
      } else if (
        seg.type === "line" && actualNextSeg.type === "arc" && seg.lineFit &&
        actualNextSeg.circleFit
      ) {
        const intersections = lineCircleIntersection(
          seg.lineFit,
          actualNextSeg.circleFit,
        );
        const gapMidpoint = points[seg.endIndex];
        intersection = closestIntersection(intersections, gapMidpoint);
      } else if (
        seg.type === "arc" && actualNextSeg.type === "line" && seg.circleFit &&
        actualNextSeg.lineFit
      ) {
        const intersections = lineCircleIntersection(
          actualNextSeg.lineFit,
          seg.circleFit,
        );
        const gapMidpoint = points[seg.endIndex];
        intersection = closestIntersection(intersections, gapMidpoint);
      } else if (
        seg.type === "arc" && actualNextSeg.type === "arc" && seg.circleFit &&
        actualNextSeg.circleFit
      ) {
        const intersections = circleCircleIntersection(
          seg.circleFit,
          actualNextSeg.circleFit,
        );
        const gapMidpoint = points[seg.endIndex];
        intersection = closestIntersection(intersections, gapMidpoint);
      }
    }

    if (intersection) {
      console.log(
        `[Refine connections] Found intersection at (${
          intersection.x.toFixed(1)
        }, ${intersection.y.toFixed(1)})`,
      );

      // Test if extending both segments to the intersection improves fit
      const segPoints = extractSegmentPoints(points, seg, isClosed);
      const nextSegPoints = extractSegmentPoints(
        points,
        actualNextSeg,
        isClosed,
      );

      // Calculate error for extending seg to intersection
      let segExtensionError = 0;
      if (seg.type === "line" && seg.lineFit) {
        const dx = intersection.x - seg.lineFit.centroid.x;
        const dy = intersection.y - seg.lineFit.centroid.y;
        const perpX = -seg.lineFit.direction.y;
        const perpY = seg.lineFit.direction.x;
        segExtensionError = Math.abs(dx * perpX + dy * perpY);
      } else if (seg.type === "arc" && seg.circleFit) {
        const dx = intersection.x - seg.circleFit.center.x;
        const dy = intersection.y - seg.circleFit.center.y;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);
        segExtensionError = Math.abs(distToCenter - seg.circleFit.radius);
      }

      // Calculate error for extending actualNextSeg to intersection
      let nextSegExtensionError = 0;
      if (actualNextSeg.type === "line" && actualNextSeg.lineFit) {
        const dx = intersection.x - actualNextSeg.lineFit.centroid.x;
        const dy = intersection.y - actualNextSeg.lineFit.centroid.y;
        const perpX = -actualNextSeg.lineFit.direction.y;
        const perpY = actualNextSeg.lineFit.direction.x;
        nextSegExtensionError = Math.abs(dx * perpX + dy * perpY);
      } else if (actualNextSeg.type === "arc" && actualNextSeg.circleFit) {
        const dx = intersection.x - actualNextSeg.circleFit.center.x;
        const dy = intersection.y - actualNextSeg.circleFit.center.y;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);
        nextSegExtensionError = Math.abs(
          distToCenter - actualNextSeg.circleFit.radius,
        );
      }

      const maxExtensionError = Math.max(
        segExtensionError,
        nextSegExtensionError,
      );
      console.log(
        `[Refine connections] Extension errors: seg=${
          segExtensionError.toFixed(3)
        }px, nextSeg=${nextSegExtensionError.toFixed(3)}px, max=${
          maxExtensionError.toFixed(3)
        }px`,
      );

      // If extension error is acceptable, use intersection
      if (maxExtensionError <= MAX_EXTENSION_ERROR) {
        console.log(`[Refine connections] Using intersection (good fit)`);
        // Update current segment to use intersection as projected end
        seg.projectedEnd = intersection;
        result[result.length - 1] = seg;

        // If we bridged over a polyline, mark it as skipped
        if (nextSeg.type === "polyline") {
          console.log(
            `[Refine connections] Polyline segment ${
              i + 1
            } replaced by intersection`,
          );
          skippedSegments.add(i + 1);
        }

        // Update actualNextSeg to use intersection as projected start
        actualNextSeg.projectedStart = intersection;
        // For wrap-around, also update result[0] since we already pushed it
        if (isLastSegment && isClosed) {
          result[0] = actualNextSeg;
        }
        continue;
      }
    }

    // Try expanded bridge if:
    // 1. Intersection was skipped (polyline segment) - always try if gap > 0
    // 2. Intersection failed or extension error too high - only if gap >= MIN_BRIDGE_SIZE
    const shouldTryBridge = (skipIntersection && actualGapSize > 0) ||
      (actualGapSize >= MIN_BRIDGE_SIZE);

    if (shouldTryBridge) {
      if (skipIntersection) {
        console.log(
          `[Refine connections] Polyline segment detected, trying expanded bridge for ${actualGapSize} points`,
        );
      } else {
        console.log(
          `[Refine connections] Extension error too high, trying expanded bridge for ${actualGapSize} gap points`,
        );
      }

      const bridgeStartIdx = seg.endIndex + 1;
      const bridgeEndIdx = actualNextSeg.startIndex - 1;

      // Expand to include surrounding pixels from adjacent segments for better fit
      const EXPAND_SIZE = Math.min(
        5,
        Math.floor((seg.endIndex - seg.startIndex) / 3),
      );
      const expandedStartIdx = Math.max(
        seg.startIndex,
        seg.endIndex - EXPAND_SIZE + 1,
      );
      const expandedEndIdx = Math.min(
        actualNextSeg.endIndex,
        actualNextSeg.startIndex + EXPAND_SIZE - 1,
      );

      console.log(
        `[Refine connections] Expanded range: [${expandedStartIdx}-${expandedEndIdx}] (${
          expandedEndIdx - expandedStartIdx + 1
        } points including ${actualGapSize} gap points)`,
      );

      // Fit line and arc to the expanded range
      const expandedLineFit = new IncrementalLineFit();
      const expandedCircleFit = new IncrementalCircleFit();

      for (let j = expandedStartIdx; j <= expandedEndIdx; j++) {
        expandedLineFit.addPoint(points[j]);
        expandedCircleFit.addPoint(points[j]);
      }

      // Calculate errors for the gap points only
      const expandedLineErrors: number[] = [];
      const expandedCircleErrors: number[] = [];
      for (let j = bridgeStartIdx; j <= bridgeEndIdx; j++) {
        expandedLineErrors.push(expandedLineFit.distanceToPoint(points[j]));
        expandedCircleErrors.push(
          expandedCircleFit.distanceToPoint(points[j]),
        );
      }

      const lineError = percentile(expandedLineErrors, 0.5);
      const circleFitResult = expandedCircleFit.getFit();
      const circleError = circleFitResult.valid
        ? percentile(expandedCircleErrors, 0.5)
        : Infinity;

      console.log(
        `[Refine connections] Expanded fit errors: line=${
          lineError.toFixed(3)
        }px, circle=${circleError.toFixed(3)}px`,
      );

      // Check if the expanded fit is acceptable
      if (lineError <= MAX_ERROR || circleError <= MAX_ERROR) {
        // Try intersecting expanded bridge with neighbors
        const useLine = lineError <= circleError;
        const bridgeLineFit = useLine ? expandedLineFit.getFit() : null;
        const bridgeCircleFit = !useLine && circleFitResult.valid
          ? {
            center: circleFitResult.center,
            radius: circleFitResult.radius,
          }
          : null;

        // Try intersection with seg
        let bridgeStartPoint: Point | null = null;
        if (seg.type === "line" && bridgeLineFit && seg.lineFit) {
          bridgeStartPoint = lineLineIntersection(seg.lineFit, bridgeLineFit);
        } else if (seg.type === "line" && bridgeCircleFit && seg.lineFit) {
          const intersections = lineCircleIntersection(
            seg.lineFit,
            bridgeCircleFit,
          );
          bridgeStartPoint = closestIntersection(
            intersections,
            points[seg.endIndex],
          );
        } else if (seg.type === "arc" && bridgeLineFit && seg.circleFit) {
          const intersections = lineCircleIntersection(
            bridgeLineFit,
            seg.circleFit,
          );
          bridgeStartPoint = closestIntersection(
            intersections,
            points[seg.endIndex],
          );
        } else if (
          seg.type === "arc" && bridgeCircleFit && seg.circleFit
        ) {
          const intersections = circleCircleIntersection(
            seg.circleFit,
            bridgeCircleFit,
          );
          bridgeStartPoint = closestIntersection(
            intersections,
            points[seg.endIndex],
          );
        }

        // Try intersection with actualNextSeg
        let bridgeEndPoint: Point | null = null;
        if (
          actualNextSeg.type === "line" && bridgeLineFit &&
          actualNextSeg.lineFit
        ) {
          bridgeEndPoint = lineLineIntersection(
            bridgeLineFit,
            actualNextSeg.lineFit,
          );
        } else if (
          actualNextSeg.type === "line" && bridgeCircleFit &&
          actualNextSeg.lineFit
        ) {
          const intersections = lineCircleIntersection(
            actualNextSeg.lineFit,
            bridgeCircleFit,
          );
          bridgeEndPoint = closestIntersection(
            intersections,
            points[actualNextSeg.startIndex],
          );
        } else if (
          actualNextSeg.type === "arc" && bridgeLineFit &&
          actualNextSeg.circleFit
        ) {
          const intersections = lineCircleIntersection(
            bridgeLineFit,
            actualNextSeg.circleFit,
          );
          bridgeEndPoint = closestIntersection(
            intersections,
            points[actualNextSeg.startIndex],
          );
        } else if (
          actualNextSeg.type === "arc" && bridgeCircleFit &&
          actualNextSeg.circleFit
        ) {
          const intersections = circleCircleIntersection(
            bridgeCircleFit,
            actualNextSeg.circleFit,
          );
          bridgeEndPoint = closestIntersection(
            intersections,
            points[actualNextSeg.startIndex],
          );
        }

        // If we found good intersections, use them
        if (bridgeStartPoint && bridgeEndPoint) {
          console.log(
            `[Refine connections] Found bridge intersections: start=(${
              bridgeStartPoint.x.toFixed(1)
            }, ${bridgeStartPoint.y.toFixed(1)}), end=(${
              bridgeEndPoint.x.toFixed(1)
            }, ${bridgeEndPoint.y.toFixed(1)})`,
          );

          // Update segments with intersections
          seg.projectedEnd = bridgeStartPoint;
          result[result.length - 1] = seg;

          // Add bridge segment with intersection endpoints
          const bridgeSeg: Segment = {
            startIndex: bridgeStartIdx,
            endIndex: bridgeEndIdx,
            type: useLine ? "line" : "arc",
            projectedStart: bridgeStartPoint,
            projectedEnd: bridgeEndPoint,
          };

          if (useLine) {
            bridgeSeg.lineFit = {
              ...bridgeLineFit!,
              error: lineError,
            };
          } else {
            bridgeSeg.circleFit = {
              center: circleFitResult.center,
              radius: circleFitResult.radius,
              error: circleError,
              sweepAngle: 0,
              clockwise: false,
            };
          }

          result.push(bridgeSeg);

          // If we bridged over a polyline, mark it as skipped
          if (nextSeg.type === "polyline") {
            console.log(
              `[Refine connections] Polyline segment ${
                i + 1
              } replaced by bridge`,
            );
            skippedSegments.add(i + 1);
          }

          // Update actualNextSeg
          actualNextSeg.projectedStart = bridgeEndPoint;
          if (isLastSegment && isClosed) {
            result[0] = actualNextSeg;
          }

          console.log(
            `[Refine connections] Added expanded bridge [${bridgeStartIdx}-${bridgeEndIdx}] with intersections`,
          );
          continue;
        } else {
          console.log(
            `[Refine connections] Could not find valid intersections for bridge, leaving as gap`,
          );
        }
      } else {
        console.log(
          `[Refine connections] Expanded bridge fit too poor (line=${
            lineError.toFixed(3)
          }px, circle=${circleError.toFixed(3)}px), leaving as gap`,
        );
      }
    } else {
      console.log(
        `[Refine connections] Gap too small (${gapSize} < ${MIN_BRIDGE_SIZE}), leaving unfitted`,
      );
    }
  }

  return result;
}

/**
 * Fit additional segments to unfit pixels (boundary gaps and interior gaps)
 * Handles gaps at start/end of open paths and gaps between segments
 */
function fitBoundaryGaps(
  points: Point[],
  segments: Segment[],
  isClosed: boolean,
): Segment[] {
  if (segments.length === 0) return segments;

  const N = points.length;
  const MIN_GAP_SIZE = 3; // minimum unfit pixels to attempt fitting
  const MIN_FIT_SIZE = 3; // minimum segment size (allow shorter than first pass)

  const result: Segment[] = [];

  // For open paths: check for gap at start (points 0 to first segment start)
  if (!isClosed) {
    const firstSeg = segments[0];
    const startGapSize = firstSeg.startIndex;

    if (startGapSize > 0) {
      console.log(
        `[Fit boundary gap] Start gap: ${startGapSize} points (0-${
          firstSeg.startIndex - 1
        })`,
      );

      // If gap is too small to fit (< MIN_FIT_SIZE), just add as unfitted polyline
      if (startGapSize < MIN_FIT_SIZE) {
        console.log(
          `[Fit boundary gap] Start gap too small to fit, marking as unfitted polyline [0-${
            firstSeg.startIndex - 1
          }]`,
        );
        result.push({
          startIndex: 0,
          endIndex: firstSeg.startIndex - 1,
          type: "polyline",
        });
      } else {
        // Try fitting a segment to these points
        // Start from the gap and try to grow it
        let bestSeg: Segment | null = null;
        let bestError = Infinity;

        // Try different end points (at least MIN_FIT_SIZE points)
        for (let endIdx = MIN_FIT_SIZE - 1; endIdx < startGapSize; endIdx++) {
          const lineFit = new IncrementalLineFit();
          const circleFit = new IncrementalCircleFit();

          // Add all points from 0 to endIdx
          for (let i = 0; i <= endIdx; i++) {
            lineFit.addPoint(points[i]);
            circleFit.addPoint(points[i]);
          }

          // Calculate errors manually
          const lineErrors: number[] = [];
          const circleErrors: number[] = [];
          for (let i = 0; i <= endIdx; i++) {
            lineErrors.push(lineFit.distanceToPoint(points[i]));
            circleErrors.push(circleFit.distanceToPoint(points[i]));
          }

          const lineError = percentile(lineErrors, 0.5);
          const circleFitResult = circleFit.getFit();
          const circleError = circleFitResult.valid
            ? percentile(circleErrors, 0.5)
            : Infinity;
          const error = Math.min(lineError, circleError);

          console.log(
            `[Fit boundary gap] Trying start [0-${endIdx}] (${
              endIdx + 1
            } points): lineError=${lineError.toFixed(3)}px, circleError=${
              circleError.toFixed(3)
            }px, best=${error.toFixed(3)}px`,
          );

          // Accept if it's a reasonable fit - prefer longer segments that still fit well
          if (error <= MAX_ERROR) {
            bestError = error;
            bestSeg = {
              startIndex: 0,
              endIndex: endIdx,
              type: "line", // will be classified later
            };
          }
        }

        if (bestSeg) {
          console.log(
            `[Fit boundary gap] Added start segment [0-${bestSeg.endIndex}] (error ${
              bestError.toFixed(3)
            }px)`,
          );
          result.push(bestSeg);
        } else {
          // Couldn't fit well, add entire gap as polyline
          console.log(
            `[Fit boundary gap] Could not fit start gap, marking as unfitted polyline [0-${
              firstSeg.startIndex - 1
            }]`,
          );
          result.push({
            startIndex: 0,
            endIndex: firstSeg.startIndex - 1,
            type: "polyline",
          });
        }
      }
    }
  }

  // Add all existing segments and check for interior gaps
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // Check for gap before this segment
    const expectedStart = result.length > 0
      ? result[result.length - 1].endIndex + 1
      : 0;
    const gapSize = seg.startIndex - expectedStart;

    if (gapSize > 0) {
      console.log(
        `[Fit boundary gap] Interior gap: ${gapSize} points (${expectedStart}-${
          seg.startIndex - 1
        })`,
      );

      // If gap is too small to fit (< MIN_FIT_SIZE), just add as unfitted polyline
      if (gapSize < MIN_FIT_SIZE) {
        console.log(
          `[Fit boundary gap] Gap too small to fit, marking as unfitted polyline [${expectedStart}-${
            seg.startIndex - 1
          }]`,
        );
        result.push({
          startIndex: expectedStart,
          endIndex: seg.startIndex - 1,
          type: "polyline",
        });
      } else {
        // Try fitting a segment to these points
        let bestGapSeg: Segment | null = null;
        let bestError = Infinity;

        // Try different segment boundaries (at least MIN_FIT_SIZE points)
        for (
          let endIdx = expectedStart + MIN_FIT_SIZE - 1;
          endIdx < seg.startIndex;
          endIdx++
        ) {
          for (
            let startIdx = expectedStart;
            startIdx <= endIdx - MIN_FIT_SIZE + 1;
            startIdx++
          ) {
            const lineFit = new IncrementalLineFit();
            const circleFit = new IncrementalCircleFit();

            // Add all points from startIdx to endIdx
            for (let j = startIdx; j <= endIdx; j++) {
              lineFit.addPoint(points[j]);
              circleFit.addPoint(points[j]);
            }

            // Calculate errors manually
            const lineErrors: number[] = [];
            const circleErrors: number[] = [];
            for (let j = startIdx; j <= endIdx; j++) {
              lineErrors.push(lineFit.distanceToPoint(points[j]));
              circleErrors.push(circleFit.distanceToPoint(points[j]));
            }

            const lineError = percentile(lineErrors, 0.5);
            const circleFitResult = circleFit.getFit();
            const circleError = circleFitResult.valid
              ? percentile(circleErrors, 0.5)
              : Infinity;
            const error = Math.min(lineError, circleError);

            // Accept if it's a reasonable fit - prefer longer segments that still fit well
            if (error <= MAX_ERROR) {
              bestError = error;
              bestGapSeg = {
                startIndex: startIdx,
                endIndex: endIdx,
                type: "line", // will be classified later
              };
            }
          }
        }

        if (bestGapSeg) {
          console.log(
            `[Fit boundary gap] Added interior segment [${bestGapSeg.startIndex}-${bestGapSeg.endIndex}] (error ${
              bestError.toFixed(3)
            }px)`,
          );
          result.push(bestGapSeg);
        } else {
          // Mark gap as unfitted polyline
          console.log(
            `[Fit boundary gap] Marking interior gap as unfitted polyline [${expectedStart}-${
              seg.startIndex - 1
            }]`,
          );
          result.push({
            startIndex: expectedStart,
            endIndex: seg.startIndex - 1,
            type: "polyline",
          });
        }
      }
    }

    result.push(seg);
  }

  // For open paths: check for gap at end (last segment end to N-1)
  if (!isClosed) {
    const lastResultSeg = result[result.length - 1];
    const endGapSize = N - 1 - lastResultSeg.endIndex;

    if (endGapSize > 0) {
      console.log(
        `[Fit boundary gap] End gap: ${endGapSize} points (${
          lastResultSeg.endIndex + 1
        }-${N - 1})`,
      );

      // If gap is too small to fit (< MIN_FIT_SIZE), just add as unfitted polyline
      if (endGapSize < MIN_FIT_SIZE) {
        console.log(
          `[Fit boundary gap] End gap too small to fit, marking as unfitted polyline [${
            lastResultSeg.endIndex + 1
          }-${N - 1}]`,
        );
        result.push({
          startIndex: lastResultSeg.endIndex + 1,
          endIndex: N - 1,
          type: "polyline",
        });
      } else {
        // Try fitting a segment to these points
        let bestSeg: Segment | null = null;
        let bestError = Infinity;

        // Try different start points (at least MIN_FIT_SIZE points)
        for (
          let startIdx = N - MIN_FIT_SIZE;
          startIdx > lastResultSeg.endIndex;
          startIdx--
        ) {
          const lineFit = new IncrementalLineFit();
          const circleFit = new IncrementalCircleFit();

          // Add all points from startIdx to N-1
          for (let i = startIdx; i < N; i++) {
            lineFit.addPoint(points[i]);
            circleFit.addPoint(points[i]);
          }

          // Calculate errors manually
          const lineErrors: number[] = [];
          const circleErrors: number[] = [];
          for (let i = startIdx; i < N; i++) {
            lineErrors.push(lineFit.distanceToPoint(points[i]));
            circleErrors.push(circleFit.distanceToPoint(points[i]));
          }

          const lineError = percentile(lineErrors, 0.5);
          const circleFitResult = circleFit.getFit();
          const circleError = circleFitResult.valid
            ? percentile(circleErrors, 0.5)
            : Infinity;
          const error = Math.min(lineError, circleError);

          // Accept if it's a reasonable fit - prefer longer segments that still fit well
          if (error <= MAX_ERROR) {
            bestError = error;
            bestSeg = {
              startIndex: startIdx,
              endIndex: N - 1,
              type: "line", // will be classified later
            };
          }
        }

        if (bestSeg) {
          console.log(
            `[Fit boundary gap] Added end segment [${bestSeg.startIndex}-${
              N - 1
            }] (error ${bestError.toFixed(3)}px)`,
          );
          result.push(bestSeg);
        } else {
          // Couldn't fit well, add entire gap as polyline
          console.log(
            `[Fit boundary gap] Could not fit end gap, marking as unfitted polyline [${
              lastResultSeg.endIndex + 1
            }-${N - 1}]`,
          );
          result.push({
            startIndex: lastResultSeg.endIndex + 1,
            endIndex: N - 1,
            type: "polyline",
          });
        }
      }
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

  const withBoundaryFits = fitBoundaryGaps(points, refined, isClosed);
  console.log(
    `  After boundary gap fitting: ${withBoundaryFits.length} segments`,
  );
  withBoundaryFits.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  const classified2 = classifySegments(points, withBoundaryFits, isClosed);
  console.log(`  After gap classification: ${classified2.length} segments`);
  classified2.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  const connected = refineSegmentConnections(points, classified2, isClosed);
  console.log(`  After connection refinement: ${connected.length} segments`);
  connected.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  // Note: We don't re-classify after connection refinement because it would
  // recalculate projectedStart/projectedEnd and erase our intersection points
  // The segments are already classified and just have updated projected endpoints
  console.log(`  Final: ${connected.length} segments`);
  connected.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  return connected;
}
