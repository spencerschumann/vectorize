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
const MIN_POINTS = 5; // minimum points for a valid fit
const LOOKAHEAD_POINTS = 2; // hysteresis to prevent jitter
const ERROR_PERCENTILE = 0.9; // Use 90th percentile for outlier tolerance
const MIN_RADIUS = 2.0; // minimum valid circle radius
const MAX_RADIUS = 10000.0; // maximum valid circle radius (treat as line)
const ARC_PREFERENCE_FACTOR = 1.2; // prefer arcs when error is similar
const MIN_SWEEP_ANGLE = Math.PI / 6; // minimum sweep angle for arcs (30 degrees)

// Multi-pass tolerance levels
interface ToleranceLevel {
  name: string;
  maxError: number; // median error tolerance
  maxErrorP90: number; // 90th percentile error tolerance
  minSegmentLength: number; // minimum segment length to prevent overfitting
}

const TOLERANCE_LEVELS: ToleranceLevel[] = [
  { name: "strict", maxError: 0.3, maxErrorP90: 0.5, minSegmentLength: 20 }, // Pass 1: Long clean segments only
  { name: "normal", maxError: 0.6, maxErrorP90: 1.0, minSegmentLength: 10 }, // Pass 2: Medium segments
  { name: "relaxed", maxError: 1.0, maxErrorP90: 1.5, minSegmentLength: 5 }, // Pass 3: Short segments OK
];

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
 * with specified tolerance levels
 */
function segmentPathWithTolerance(
  points: Point[],
  isClosed: boolean,
  maxError: number,
  maxErrorP90: number,
  minSegmentLength: number,
  skipIndices: Set<number> = new Set(),
): Segment[] {
  const N = points.length;
  if (N < 2) return [];

  const segments: Segment[] = [];
  
  // Special case: For closed paths with no fitted indices yet, try fitting as a single circle first
  if (isClosed && skipIndices.size === 0 && N >= minSegmentLength) {
    console.log(`[Testing complete circle] ${N} points, minLen=${minSegmentLength}, maxErr=${maxError}px`);
    const circleFit = new IncrementalCircleFit();
    for (const p of points) {
      circleFit.addPoint(p);
    }
    
    const circleErrors: number[] = [];
    for (const p of points) {
      circleErrors.push(circleFit.distanceToPoint(p));
    }
    
    const medianCircleError = percentile(circleErrors, 0.5);
    const percentileCircleError = percentile(circleErrors, ERROR_PERCENTILE);
    const fit = circleFit.getFit();
    
    console.log(
      `  Circle fit: valid=${fit.valid}, radius=${fit.valid ? fit.radius.toFixed(1) : 'N/A'}px, ` +
      `medianErr=${medianCircleError.toFixed(3)}px (max=${maxError}px), ` +
      `p90Err=${percentileCircleError.toFixed(3)}px (max=${maxErrorP90}px)`,
    );
    
    if (
      fit.valid &&
      fit.radius >= MIN_RADIUS &&
      fit.radius <= MAX_RADIUS &&
      medianCircleError <= maxError &&
      percentileCircleError <= maxErrorP90
    ) {
      console.log(
        `[✓ Complete circle detected] Returning single arc segment for entire path`,
      );
      return [{
        startIndex: 0,
        endIndex: N - 1,
        type: "arc",
      }];
    } else {
      console.log(`[✗ Complete circle rejected] Proceeding with normal segmentation`);
    }
  }
  
  let i = 0;

  // Skip already-fitted indices
  while (i < N && skipIndices.has(i)) {
    i++;
  }

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
      // Use the tolerance parameters passed to this function
      const lineOk = medianLineError <= maxError &&
        percentileLineError <= maxErrorP90;
      const circleOk = medianCircleError <= maxError &&
        percentileCircleError <= maxErrorP90;

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

      // Check if we should continue or stop
      // Strategy: Encourage longer segments when fit is excellent, but stop when it degrades
      
      // For closed paths with good circle fits, check if we're near completing the full path
      let isNearCompleteCircle = false;
      if (circleOk && isClosed && minSegmentLength >= 10) { // Only in strict/normal passes on closed paths
        const fit = circleFit.getFit();
        if (fit.valid && fit.radius >= MIN_RADIUS && fit.radius <= MAX_RADIUS) {
          const pointsCovered = j - segStart + 1;
          const totalPoints = N;
          
          // If we've covered > 80% of the path with a good circle fit, we're likely completing a circle
          if (pointsCovered > totalPoints * 0.8) {
            isNearCompleteCircle = true;
            console.log(
              `[Near complete circle] ${pointsCovered}/${totalPoints} points covered (${(pointsCovered/totalPoints*100).toFixed(1)}%)`,
            );
          }
        }
      }

      // Stop conditions:
      const lineMedianBad = medianLineError > maxError;
      const circleMedianBad = medianCircleError > maxError;

      if (lineOk || circleOk) {
        // Continue if at least one fit is within tolerance
        // But stop if both medians are bad AND we're not completing a circle
        if (lineMedianBad && circleMedianBad && !isNearCompleteCircle) {
          console.log(
            `[Segment ${segStart}-${j}] STOPPED - both median errors exceeded ${maxError}px`,
          );
          break;
        }

        // Skip already-fitted indices
        j++;
        while (j < N && skipIndices.has(j)) {
          j++;
        }
        continue;
      }

      // Both fits failed tolerance - but allow continuing if we're very close to completing a circle
      if (isNearCompleteCircle && medianCircleError <= maxError * 1.2) {
        console.log(
          `[Segment ${segStart}-${j}] CONTINUING to complete circle (sweep > 300°)`,
        );
        j++;
        while (j < N && skipIndices.has(j)) {
          j++;
        }
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

      const lineOk = medianLineError <= maxError &&
        p90LineError <= maxErrorP90;
      const circleOk = medianCircleError <= maxError &&
        p90CircleError <= maxErrorP90;

      if (lineOk || circleOk) {
        segEnd = N - 1;
        console.log(
          `[Segment extended to end] ${segStart}-${segEnd} (${
            segEnd - segStart + 1
          } points, fit still good)`,
        );
      } else {
        // Can't extend - use normal backup
        segEnd = Math.max(j - LOOKAHEAD_POINTS, segStart + minSegmentLength - 1);
        console.log(
          `[Segment near end, can't extend] ${segStart}-${segEnd} (${
            segEnd - segStart + 1
          } points, ${N - 1 - segEnd} points remain)`,
        );
      }
    } else {
      // Normal case: back up by lookahead points
      segEnd = Math.max(j - LOOKAHEAD_POINTS, segStart + minSegmentLength - 1);
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
    // Skip already-fitted indices
    while (i < N && skipIndices.has(i)) {
      i++;
    }
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

  // Handle closed paths
  if (isClosed) {
    // If we have a single segment that covers the entire path, it's likely a complete circle
    if (segments.length === 1 && segments[0].startIndex === 0 && segments[0].endIndex === N - 1) {
      console.log(`[Complete closed path] Single segment covers entire path (0-${N-1})`);
      return segments;
    }
    
    // Try to merge first and last segments
    if (segments.length >= 2) {
      const merged = reconcileClosedPath(points, segments);
      return merged;
    }
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
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

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
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

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
  // Use relaxed tolerance
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

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
  maxError: number = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError,
  maxErrorP90: number =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90,
): Segment[] {
  return segments.map((seg) => {
    // Preserve polyline segments - they should not be reclassified
    if (seg.type === "polyline") {
      return seg;
    }

    const segPoints = extractSegmentPoints(points, seg, isClosed);

    // For very small segments (< MIN_POINTS), still fit a line for intersection calculations
    // but skip circle fitting since it's not meaningful for so few points
    if (segPoints.length < MIN_POINTS) {
      const lineFit = new IncrementalLineFit();
      for (const p of segPoints) {
        lineFit.addPoint(p);
      }
      const lineResult = lineFit.getFit();

      return {
        ...seg,
        type: "line",
        lineFit: {
          centroid: lineResult.centroid,
          direction: lineResult.direction,
          error: 0, // Small segments typically fit perfectly
        },
        projectedStart: segPoints[0],
        projectedEnd: segPoints[segPoints.length - 1],
      };
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
    const lineWithinTolerance = medianLineError <= maxError &&
      p90LineError <= maxErrorP90;
    const circleWithinTolerance = medianCircleError <= maxError &&
      p90CircleError <= maxErrorP90;

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
  // Use relaxed tolerance for refinement
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

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

      // Ensure we don't overlap with previous segment (for both open and closed paths)
      if (i > 0) {
        const prevSegEnd = refined[i - 1].endIndex;
        // For adjacent segments, don't allow extending backward past the previous segment's end
        if (newStartIndex <= prevSegEnd && prevSegEnd + 1 === seg.startIndex) {
          continue;
        }
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

      // Ensure we don't overlap with next segment (for both open and closed paths)
      if (i < segments.length - 1) {
        const nextSegStart = segments[i + 1].startIndex;
        // For adjacent segments, don't allow extending forward past the next segment's start
        if (newEndIndex >= nextSegStart && seg.endIndex + 1 === nextSegStart) {
          continue;
        }
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
    if (bestStartIndex !== seg.startIndex || bestEndIndex !== seg.endIndex) {
      // Small gaps between segments are OK - they represent corners where
      // the segments will meet at intersection points

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
 * Select the best intersection point from multiple candidates based on
 * how well it fits the skeleton pixels. Tests each candidate against ALL
 * skeleton pixels involved (segment end + gap + next segment start) and
 * returns the one with the lowest maximum error.
 */
function bestIntersectionForGap(
  intersections: Point[],
  points: Point[],
  gapStartIdx: number,
  gapEndIdx: number,
  seg: Segment,
  nextSeg: Segment,
): Point | null {
  if (intersections.length === 0) return null;
  if (intersections.length === 1) return intersections[0];

  console.log(
    `[bestIntersectionForGap] Testing ${intersections.length} intersection candidates against skeleton pixels [${gapStartIdx}-${gapEndIdx}]`,
  );

  // Test each intersection candidate
  let bestIntersection = intersections[0];
  let bestError = Infinity;

  for (let i = 0; i < intersections.length; i++) {
    const candidate = intersections[i];

    // Calculate maximum error across ALL skeleton pixels:
    // - Pixels in gap (bridged by line from seg.end to intersection to nextSeg.start)
    // - Also consider pixels near segment endpoints to ensure good connection
    let maxError = 0;

    // Test gap pixels against the path through this intersection
    for (let k = gapStartIdx; k <= gapEndIdx; k++) {
      const skelPt = points[k];

      // Calculate distance to the two-segment path:
      // seg.endPoint -> intersection -> nextSeg.startPoint
      const segEndPt = points[seg.endIndex];
      const nextSegStartPt = points[nextSeg.startIndex];

      // Distance to first segment (segEnd -> intersection)
      const dx1 = candidate.x - segEndPt.x;
      const dy1 = candidate.y - segEndPt.y;
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

      // Distance to second segment (intersection -> nextSegStart)
      const dx2 = nextSegStartPt.x - candidate.x;
      const dy2 = nextSegStartPt.y - candidate.y;
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      // Calculate distance to first segment
      let dist1 = Infinity;
      if (len1 > 0) {
        const nx1 = -dy1 / len1;
        const ny1 = dx1 / len1;
        const vx1 = skelPt.x - segEndPt.x;
        const vy1 = skelPt.y - segEndPt.y;
        dist1 = Math.abs(nx1 * vx1 + ny1 * vy1);
      }

      // Calculate distance to second segment
      let dist2 = Infinity;
      if (len2 > 0) {
        const nx2 = -dy2 / len2;
        const ny2 = dx2 / len2;
        const vx2 = skelPt.x - candidate.x;
        const vy2 = skelPt.y - candidate.y;
        dist2 = Math.abs(nx2 * vx2 + ny2 * vy2);
      }

      // Use minimum distance to either segment
      const dist = Math.min(dist1, dist2);
      maxError = Math.max(maxError, dist);
    }

    console.log(
      `[bestIntersectionForGap]   Candidate ${i} at (${
        candidate.x.toFixed(1)
      }, ${candidate.y.toFixed(1)}): maxError=${maxError.toFixed(3)}px`,
    );

    if (maxError < bestError) {
      bestError = maxError;
      bestIntersection = candidate;
    }
  }

  console.log(
    `[bestIntersectionForGap] Selected candidate with error ${
      bestError.toFixed(3)
    }px`,
  );

  return bestIntersection;
}

/**
 * Refine segment connections by finding intersections and bridging gaps
 */
function refineSegmentConnections(
  points: Point[],
  segments: Segment[],
  isClosed: boolean,
): Segment[] {
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

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
    // Don't skip overlapping segments - they still need intersection points calculated
    // The overlap just means they share a pixel, which is fine
    
    if (gapSize < 0) {
      console.log(
        `[Refine connections] Overlapping segments ${i} [${seg.startIndex}-${seg.endIndex}] and ${nextSegIdx} [${nextSeg.startIndex}-${nextSeg.endIndex}]: overlap=${-gapSize} points`,
      );
    } else if (gapSize === 0) {
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

    // Try to find intersection point
    // For polyline segments, we still want to try intersection to see if it fits the gap pixels
    let intersection: Point | null = null;

    if (
      seg.type === "line" && actualNextSeg.type === "line" && seg.lineFit &&
      actualNextSeg.lineFit
    ) {
      intersection = lineLineIntersection(seg.lineFit, actualNextSeg.lineFit);
      console.log(
        `[Refine connections] Line-to-line intersection: ${intersection ? `(${intersection.x.toFixed(1)}, ${intersection.y.toFixed(1)})` : 'null'}`,
      );
    } else if (
      seg.type === "line" && actualNextSeg.type === "arc" && seg.lineFit &&
      actualNextSeg.circleFit
    ) {
      const intersections = lineCircleIntersection(
        seg.lineFit,
        actualNextSeg.circleFit,
      );
      // If we have gap pixels, choose the intersection that best fits them
      if (actualGapSize > 0) {
        const gapStartIdx = seg.endIndex + 1;
        const gapEndIdx = actualNextSeg.startIndex - 1;
        intersection = bestIntersectionForGap(
          intersections,
          points,
          gapStartIdx,
          gapEndIdx,
          seg,
          actualNextSeg,
        );
      } else {
        const gapMidpoint = points[seg.endIndex];
        intersection = closestIntersection(intersections, gapMidpoint);
      }
    } else if (
      seg.type === "arc" && actualNextSeg.type === "line" && seg.circleFit &&
      actualNextSeg.lineFit
    ) {
      const intersections = lineCircleIntersection(
        actualNextSeg.lineFit,
        seg.circleFit,
      );
      // If we have gap pixels, choose the intersection that best fits them
      if (actualGapSize > 0) {
        const gapStartIdx = seg.endIndex + 1;
        const gapEndIdx = actualNextSeg.startIndex - 1;
        intersection = bestIntersectionForGap(
          intersections,
          points,
          gapStartIdx,
          gapEndIdx,
          seg,
          actualNextSeg,
        );
      } else {
        const gapMidpoint = points[seg.endIndex];
        intersection = closestIntersection(intersections, gapMidpoint);
      }
    } else if (
      seg.type === "arc" && actualNextSeg.type === "arc" && seg.circleFit &&
      actualNextSeg.circleFit
    ) {
      const intersections = circleCircleIntersection(
        seg.circleFit,
        actualNextSeg.circleFit,
      );
      // If we have gap pixels, choose the intersection that best fits them
      if (actualGapSize > 0) {
        const gapStartIdx = seg.endIndex + 1;
        const gapEndIdx = actualNextSeg.startIndex - 1;
        intersection = bestIntersectionForGap(
          intersections,
          points,
          gapStartIdx,
          gapEndIdx,
          seg,
          actualNextSeg,
        );
      } else {
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

      // Check if intersection also fits the gap pixels well (for polyline case)
      let gapFitError = 0;
      if (skipIntersection && actualGapSize > 0) {
        // Calculate how well the intersection point fits the gap pixels
        // by checking distance from each gap pixel to the line segments leading to/from intersection
        const gapStartIdx = seg.endIndex + 1;
        const gapEndIdx = actualNextSeg.startIndex - 1;
        let maxGapError = 0;

        for (let k = gapStartIdx; k <= gapEndIdx; k++) {
          const gapPoint = points[k];
          // Calculate distance to the line from seg's end to intersection
          const segEndPoint = points[seg.endIndex];
          const dx1 = intersection.x - segEndPoint.x;
          const dy1 = intersection.y - segEndPoint.y;
          const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
          if (len1 > 0) {
            const nx1 = -dy1 / len1;
            const ny1 = dx1 / len1;
            const vx1 = gapPoint.x - segEndPoint.x;
            const vy1 = gapPoint.y - segEndPoint.y;
            const dist1 = Math.abs(nx1 * vx1 + ny1 * vy1);
            maxGapError = Math.max(maxGapError, dist1);
          }
        }
        gapFitError = maxGapError;
        console.log(
          `[Refine connections] Intersection gap fit error: ${
            gapFitError.toFixed(3)
          }px`,
        );
      }

      // If extension error is acceptable AND gap pixels fit well (if any), use intersection
      // Special case: line-to-line intersections with very low error are always preferred (sharp corners)
      const isLineToLine = seg.type === "line" && actualNextSeg.type === "line";
      const isSharpCorner = isLineToLine && maxExtensionError <= 0.5;
      const intersectionAcceptable = 
        isSharpCorner || 
        (maxExtensionError <= MAX_EXTENSION_ERROR && (skipIntersection ? gapFitError <= MAX_ERROR : true));

      if (intersectionAcceptable) {
        if (isSharpCorner) {
          console.log(`[Refine connections] Using line-to-line intersection (sharp corner, error=${maxExtensionError.toFixed(3)}px)`);
        }
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
        console.log(
          `[Refine connections] Set actualNextSeg [${actualNextSeg.startIndex}-${actualNextSeg.endIndex}] projectedStart to (${intersection.x.toFixed(2)}, ${intersection.y.toFixed(2)})`,
        );
        // For wrap-around, also update result[0] since we already pushed it
        if (isLastSegment && isClosed) {
          result[0] = actualNextSeg;
        }
        continue;
      } else if (skipIntersection && gapFitError > MAX_ERROR) {
        console.log(
          `[Refine connections] Intersection doesn't fit gap pixels well (${
            gapFitError.toFixed(3)
          }px > ${MAX_ERROR}px)`,
        );
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

      // Greedily expand symmetrically to find the largest segment that fits well
      // This helps overcome suboptimal breaks from the initial greedy segmentation
      let expandedStartIdx = bridgeStartIdx;
      let expandedEndIdx = bridgeEndIdx;
      let bestStartIdx = expandedStartIdx;
      let bestEndIdx = expandedEndIdx;
      let bestError = Infinity;
      let bestIsLine = true;

      // Maximum expansion: up to 1/3 of each adjacent segment, or 10 pixels
      const maxExpandLeft = Math.min(
        10,
        Math.floor((seg.endIndex - seg.startIndex) / 3),
      );
      const maxExpandRight = Math.min(
        10,
        Math.floor((actualNextSeg.endIndex - actualNextSeg.startIndex) / 3),
      );

      // Try progressively larger symmetric expansions
      // Keep expanding as long as the fit is acceptable (≤ MAX_ERROR)
      // We want the LARGEST range that still fits well, not necessarily the best error
      // BUT: stop expanding if we detect we're entering genuinely curved regions
      for (
        let expandSize = 0;
        expandSize <= Math.min(maxExpandLeft, maxExpandRight);
        expandSize++
      ) {
        const tryStartIdx = Math.max(
          seg.startIndex,
          bridgeStartIdx - expandSize,
        );
        const tryEndIdx = Math.min(
          actualNextSeg.endIndex,
          bridgeEndIdx + expandSize,
        );

        // Fit line and arc to this expanded range
        const lineFit = new IncrementalLineFit();
        const circleFit = new IncrementalCircleFit();

        for (let j = tryStartIdx; j <= tryEndIdx; j++) {
          lineFit.addPoint(points[j]);
          circleFit.addPoint(points[j]);
        }

        // Calculate errors for all points in the range
        const lineErrors: number[] = [];
        const circleErrors: number[] = [];
        for (let j = tryStartIdx; j <= tryEndIdx; j++) {
          lineErrors.push(lineFit.distanceToPoint(points[j]));
          const circleResult = circleFit.getFit();
          if (circleResult.valid) {
            circleErrors.push(circleFit.distanceToPoint(points[j]));
          }
        }

        const lineError = percentile(lineErrors, 0.5);
        const circleResult = circleFit.getFit();
        const circleError = circleResult.valid && circleErrors.length > 0
          ? percentile(circleErrors, 0.5)
          : Infinity;

        const bestFitError = Math.min(lineError, circleError);

        // Accept this expansion if the fit is acceptable
        if (bestFitError <= MAX_ERROR) {
          // Keep this as our best range (largest that still fits well)
          bestError = bestFitError;
          bestStartIdx = tryStartIdx;
          bestEndIdx = tryEndIdx;
          bestIsLine = lineError <= circleError;
          // Continue trying to expand further
        } else {
          // Fit got too poor, stop expanding
          break;
        }
      }

      expandedStartIdx = bestStartIdx;
      expandedEndIdx = bestEndIdx;

      console.log(
        `[Refine connections] Optimal expanded range: [${expandedStartIdx}-${expandedEndIdx}] (${
          expandedEndIdx - expandedStartIdx + 1
        } points), best fit: ${bestError.toFixed(3)}px`,
      );

      // Now fit with the optimal range
      const expandedLineFit = new IncrementalLineFit();
      const expandedCircleFit = new IncrementalCircleFit();

      for (let j = expandedStartIdx; j <= expandedEndIdx; j++) {
        expandedLineFit.addPoint(points[j]);
        expandedCircleFit.addPoint(points[j]);
      }

      // Calculate final errors
      const expandedLineErrors: number[] = [];
      const expandedCircleErrors: number[] = [];
      for (let j = expandedStartIdx; j <= expandedEndIdx; j++) {
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

      if (circleFitResult.valid) {
        console.log(
          `[Refine connections] Circle fit: center=(${
            circleFitResult.center.x.toFixed(1)
          }, ${circleFitResult.center.y.toFixed(1)}), radius=${
            circleFitResult.radius.toFixed(1)
          }px`,
        );
        console.log(
          `[Refine connections] Circle error details: min=${
            Math.min(...expandedCircleErrors).toFixed(3)
          }px, median=${circleError.toFixed(3)}px, max=${
            Math.max(...expandedCircleErrors).toFixed(3)
          }px`,
        );
      }

      // Check if the expanded fit is acceptable
      if (lineError <= MAX_ERROR || circleError <= MAX_ERROR) {
        // For very small expanded ranges (≤2 pixels), always use a line to avoid arc direction ambiguity
        // For larger ranges, use whichever fit is better
        const expandedLength = expandedEndIdx - expandedStartIdx + 1;
        const useLine = (expandedLength <= 2) || (lineError <= circleError);

        const bridgeLineFit = useLine ? expandedLineFit.getFit() : null;
        const bridgeCircleFit = !useLine && circleFitResult.valid
          ? {
            center: circleFitResult.center,
            radius: circleFitResult.radius,
          }
          : null;

        console.log(
          `[Refine connections] Bridge fit choice: ${
            useLine ? "line" : "arc"
          } (expanded length: ${expandedLength} pixels, line error: ${
            lineError.toFixed(3)
          }px, circle error: ${circleError.toFixed(3)}px)`,
        );

        // Try intersection with seg
        let bridgeStartPoint: Point | null = null;
        if (seg.type === "line" && bridgeLineFit && seg.lineFit) {
          bridgeStartPoint = lineLineIntersection(seg.lineFit, bridgeLineFit);
          console.log(
            `[Refine connections] Bridge-seg intersection (line-line): ${
              bridgeStartPoint ? "found" : "parallel/no intersection"
            }`,
          );
        } else if (seg.type === "line" && bridgeCircleFit && seg.lineFit) {
          const intersections = lineCircleIntersection(
            seg.lineFit,
            bridgeCircleFit,
          );
          bridgeStartPoint = closestIntersection(
            intersections,
            points[seg.endIndex],
          );
          console.log(
            `[Refine connections] Bridge-seg intersection (line-circle): ${intersections.length} candidates, selected: ${
              bridgeStartPoint ? "yes" : "none"
            }`,
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
          console.log(
            `[Refine connections] Bridge-seg intersection (circle-line): ${intersections.length} candidates, selected: ${
              bridgeStartPoint ? "yes" : "none"
            }`,
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
          console.log(
            `[Refine connections] Bridge-seg intersection (circle-circle): ${intersections.length} candidates, selected: ${
              bridgeStartPoint ? "yes" : "none"
            }`,
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
          console.log(
            `[Refine connections] Bridge-actualNextSeg intersection (line-line): ${
              bridgeEndPoint ? "found" : "parallel/no intersection"
            }`,
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
          console.log(
            `[Refine connections] Bridge-actualNextSeg intersection (line-circle): ${intersections.length} candidates, selected: ${
              bridgeEndPoint ? "yes" : "none"
            }`,
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
          console.log(
            `[Refine connections] Bridge-actualNextSeg intersection (circle-line): ${intersections.length} candidates, selected: ${
              bridgeEndPoint ? "yes" : "none"
            }`,
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
          console.log(
            `[Refine connections] Bridge-actualNextSeg intersection (circle-circle): ${intersections.length} candidates, selected: ${
              bridgeEndPoint ? "yes" : "none"
            }`,
          );
        }

        // Use intersections if we found both, otherwise fall back to expanded range endpoints
        // For bridges, the fit quality is more important than perfect geometric intersections
        if (!bridgeStartPoint || !bridgeEndPoint) {
          console.log(
            `[Refine connections] Could not find geometric intersections, using expanded range endpoints as fallback`,
          );
          // Use the actual skeleton points at the expanded range boundaries
          bridgeStartPoint = points[expandedStartIdx];
          bridgeEndPoint = points[expandedEndIdx];
        }

        console.log(
          `[Refine connections] Bridge connection points: start=(${
            bridgeStartPoint.x.toFixed(1)
          }, ${bridgeStartPoint.y.toFixed(1)}), end=(${
            bridgeEndPoint.x.toFixed(1)
          }, ${bridgeEndPoint.y.toFixed(1)})`,
        );

        // The bridge now replaces the expanded range, so we need to shorten seg
        // to end before the expanded range starts
        if (expandedStartIdx < seg.endIndex) {
          seg.endIndex = expandedStartIdx - 1;
          console.log(
            `[Refine connections] Shortened seg to [${seg.startIndex}-${seg.endIndex}] to make room for bridge`,
          );
        }
        seg.projectedEnd = bridgeStartPoint;
        result[result.length - 1] = seg;

        // Add bridge segment using the expanded range
        const bridgeSeg: Segment = {
          startIndex: expandedStartIdx,
          endIndex: expandedEndIdx,
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
          // Calculate proper sweep angle and direction from projected endpoints
          const startAngle = Math.atan2(
            bridgeStartPoint.y - circleFitResult.center.y,
            bridgeStartPoint.x - circleFitResult.center.x,
          );
          const endAngle = Math.atan2(
            bridgeEndPoint.y - circleFitResult.center.y,
            bridgeEndPoint.x - circleFitResult.center.x,
          );

          // Determine direction by checking cumulative angle through skeleton points
          // Use the EXPANDED range, not the original gap
          let totalAngle = 0;
          for (let j = expandedStartIdx; j < expandedEndIdx; j++) {
            const angle1 = Math.atan2(
              points[j].y - circleFitResult.center.y,
              points[j].x - circleFitResult.center.x,
            );
            const angle2 = Math.atan2(
              points[j + 1].y - circleFitResult.center.y,
              points[j + 1].x - circleFitResult.center.x,
            );
            let deltaAngle = angle2 - angle1;
            // Normalize to [-π, π]
            while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
            while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
            totalAngle += deltaAngle;
          }

          // Match classifySegments convention: positive cumulative angle = clockwise
          const clockwise = totalAngle > 0;
          let sweepAngle = clockwise
            ? (startAngle - endAngle)
            : (endAngle - startAngle);
          // Normalize to [0, 2π]
          while (sweepAngle < 0) sweepAngle += 2 * Math.PI;
          while (sweepAngle > 2 * Math.PI) sweepAngle -= 2 * Math.PI;

          bridgeSeg.circleFit = {
            center: circleFitResult.center,
            radius: circleFitResult.radius,
            error: circleError,
            sweepAngle: (sweepAngle * 180) / Math.PI,
            clockwise: clockwise,
          };
        }

        result.push(bridgeSeg);

        // If we bridged over a polyline, mark it as skipped
        if (nextSeg.type === "polyline") {
          console.log(
            `[Refine connections] Polyline segment ${i + 1} replaced by bridge`,
          );
          skippedSegments.add(i + 1);
        }

        // Update actualNextSeg to start after the expanded range
        if (expandedEndIdx > actualNextSeg.startIndex) {
          actualNextSeg.startIndex = expandedEndIdx + 1;
          console.log(
            `[Refine connections] Adjusted actualNextSeg to start at ${actualNextSeg.startIndex}`,
          );
        }
        actualNextSeg.projectedStart = bridgeEndPoint;
        if (isLastSegment && isClosed) {
          result[0] = actualNextSeg;
        }

        console.log(
          `[Refine connections] Added expanded bridge [${expandedStartIdx}-${expandedEndIdx}]`,
        );
        continue;
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

  // Debug: log projected points before returning
  console.log(`[Refine connections] Returning ${result.length} segments with projected points:`);
  result.forEach((s, idx) => {
    if (s.projectedStart && s.projectedEnd) {
      console.log(
        `  Seg ${idx} [${s.startIndex}-${s.endIndex}]: start=(${s.projectedStart.x.toFixed(2)}, ${s.projectedStart.y.toFixed(2)}), end=(${s.projectedEnd.x.toFixed(2)}, ${s.projectedEnd.y.toFixed(2)})`,
      );
    }
  });

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
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

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
 * Merge adjacent collinear line segments to eliminate redundant vertices.
 * This is especially useful after connection refinement which may create
 * tiny segments at junctions.
 */
function mergeCollinearSegments(
  points: Point[],
  segments: Segment[],
): Segment[] {
  if (segments.length < 2) return segments;

  const result: Segment[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];

    // Only merge line segments
    if (seg.type !== "line" || !seg.lineFit) {
      result.push(seg);
      i++;
      continue;
    }

    // Try to merge with subsequent adjacent line segments
    let mergedSeg = seg;
    let j = i + 1;

    while (j < segments.length) {
      const nextSeg = segments[j];

      // Can only merge adjacent line segments
      if (nextSeg.type !== "line" || !nextSeg.lineFit) break;

      // Check if segments are adjacent (no gap)
      const gap = nextSeg.startIndex - mergedSeg.endIndex - 1;
      if (gap !== 0) break;

      // Check if they're collinear by comparing directions
      const dot = mergedSeg.lineFit.direction.x * nextSeg.lineFit.direction.x +
        mergedSeg.lineFit.direction.y * nextSeg.lineFit.direction.y;

      // If directions are very similar (cosine similarity > 0.999 ≈ 2.5°), merge them
      if (Math.abs(dot) > 0.999) {
        console.log(
          `[Merge collinear] Merging line segments ${i} [${mergedSeg.startIndex}-${mergedSeg.endIndex}] and ${j} [${nextSeg.startIndex}-${nextSeg.endIndex}] (dot=${
            dot.toFixed(4)
          })`,
        );

        // Create merged segment spanning both ranges
        // Use the projected endpoints from the outer segments
        mergedSeg = {
          ...mergedSeg,
          endIndex: nextSeg.endIndex,
          projectedEnd: nextSeg.projectedEnd,
        };
        j++;
      } else {
        break;
      }
    }

    result.push(mergedSeg);
    i = j;
  }

  return result;
}

/**
 * Merge adjacent arc segments that are part of the same circle.
 * This combines arcs that were split during segmentation but share
 * the same center and radius (within tolerance).
 */
function mergeCoincidentArcs(
  points: Point[],
  segments: Segment[],
): Segment[] {
  if (segments.length < 2) return segments;

  const result: Segment[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];

    // Only merge arc segments
    if (seg.type !== "arc" || !seg.circleFit) {
      result.push(seg);
      i++;
      continue;
    }

    // Try to merge with subsequent adjacent arc segments
    let mergedSeg = seg;
    let j = i + 1;

    while (j < segments.length) {
      const nextSeg = segments[j];

      // Can only merge adjacent arc segments
      if (nextSeg.type !== "arc" || !nextSeg.circleFit) break;

      // Check if segments are adjacent or have a small gap (≤1 pixel)
      const gap = nextSeg.startIndex - mergedSeg.endIndex - 1;
      if (gap > 1) break;

      // Check if they share the same circle center and radius (within tolerance)
      const dx = mergedSeg.circleFit.center.x - nextSeg.circleFit.center.x;
      const dy = mergedSeg.circleFit.center.y - nextSeg.circleFit.center.y;
      const centerDist = Math.sqrt(dx * dx + dy * dy);
      const radiusDiff = Math.abs(mergedSeg.circleFit.radius - nextSeg.circleFit.radius);
      
      // Centers should be within 5px and radii within 5px to be considered the same circle
      const sameCircle = centerDist <= 5 && radiusDiff <= 5;

      if (sameCircle) {
        console.log(
          `[Merge arcs] Merging arc segments ${i} [${mergedSeg.startIndex}-${mergedSeg.endIndex}] and ${j} [${nextSeg.startIndex}-${nextSeg.endIndex}] (centerDist=${
            centerDist.toFixed(1)
          }px, radiusDiff=${radiusDiff.toFixed(1)}px)`,
        );

        // Create merged segment spanning both ranges
        // Use the projected endpoints from the outer segments
        // Recalculate circle fit for the combined arc
        const mergedPoints = extractSegmentPoints(points, {
          ...mergedSeg,
          endIndex: nextSeg.endIndex,
        }, false);
        const mergedCircleFit = fitCircle(mergedPoints);

        mergedSeg = {
          ...mergedSeg,
          endIndex: nextSeg.endIndex,
          projectedEnd: nextSeg.projectedEnd,
          circleFit: mergedCircleFit.valid ? mergedCircleFit : mergedSeg.circleFit,
        };
        j++;
      } else {
        break;
      }
    }

    result.push(mergedSeg);
    i = j;
  }

  return result;
}

/**
 * Try to absorb unfitted polyline segments by expanding adjacent fitted segments.
 * This aggressively tests if neighboring line/arc segments can be extended to
 * cover the polyline pixels while maintaining acceptable fit.
 */
function absorbUnfittedSegments(
  points: Point[],
  segments: Segment[],
  isClosed: boolean,
): Segment[] {
  const MAX_ERROR = TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxError;
  const MAX_ERROR_P90 =
    TOLERANCE_LEVELS[TOLERANCE_LEVELS.length - 1].maxErrorP90;

  if (segments.length < 2) return segments;

  const result: Segment[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];

    // If this is a fitted segment (not polyline), add it
    if (seg.type !== "polyline") {
      result.push(seg);
      i++;
      continue;
    }

    // Found an unfitted polyline - try to absorb it into neighbors
    console.log(
      `[Absorb unfitted] Found polyline segment ${i} [${seg.startIndex}-${seg.endIndex}] (${
        seg.endIndex - seg.startIndex + 1
      } pixels)`,
    );

    const prevSeg = result.length > 0 ? result[result.length - 1] : null;
    const nextSeg = i + 1 < segments.length ? segments[i + 1] : null;

    let absorbed = false;

    // Try extending previous segment to cover polyline
    if (prevSeg && prevSeg.type !== "polyline") {
      const extendedEnd = seg.endIndex;
      const testPoints = extractSegmentPoints(
        points,
        { ...prevSeg, endIndex: extendedEnd },
        isClosed,
      );

      if (testPoints.length >= MIN_POINTS) {
        // Test both line and arc fits
        const lineFit = new IncrementalLineFit();
        const circleFit = new IncrementalCircleFit();
        for (const p of testPoints) {
          lineFit.addPoint(p);
          circleFit.addPoint(p);
        }

        const lineErrors = testPoints.map((p) => lineFit.distanceToPoint(p));
        const lineMedian = percentile(lineErrors, 0.5);
        const lineP90 = percentile(lineErrors, ERROR_PERCENTILE);

        const circleResult = circleFit.getFit();
        const circleErrors = testPoints.map((p) =>
          circleFit.distanceToPoint(p)
        );
        const circleMedian = circleResult.valid
          ? percentile(circleErrors, 0.5)
          : Infinity;
        const circleP90 = circleResult.valid
          ? percentile(circleErrors, ERROR_PERCENTILE)
          : Infinity;

        const lineFits = lineMedian <= MAX_ERROR && lineP90 <= MAX_ERROR_P90;
        const circleFits = circleMedian <= MAX_ERROR &&
          circleP90 <= MAX_ERROR_P90;

        if (lineFits || circleFits) {
          const useArc = circleFits &&
            circleMedian < lineMedian * ARC_PREFERENCE_FACTOR;
          console.log(
            `[Absorb unfitted] Extended previous segment to [${prevSeg.startIndex}-${extendedEnd}] as ${
              useArc ? "arc" : "line"
            } (line=${lineMedian.toFixed(3)}px, circle=${
              circleMedian.toFixed(3)
            }px)`,
          );

          result[result.length - 1] = {
            ...prevSeg,
            endIndex: extendedEnd,
            type: useArc ? "arc" : "line",
          };
          absorbed = true;
        }
      }
    }

    // Try extending next segment backward to cover polyline
    if (!absorbed && nextSeg && nextSeg.type !== "polyline") {
      const extendedStart = seg.startIndex;
      const testPoints = extractSegmentPoints(
        points,
        { ...nextSeg, startIndex: extendedStart },
        isClosed,
      );

      if (testPoints.length >= MIN_POINTS) {
        // Test both line and arc fits
        const lineFit = new IncrementalLineFit();
        const circleFit = new IncrementalCircleFit();
        for (const p of testPoints) {
          lineFit.addPoint(p);
          circleFit.addPoint(p);
        }

        const lineErrors = testPoints.map((p) => lineFit.distanceToPoint(p));
        const lineMedian = percentile(lineErrors, 0.5);
        const lineP90 = percentile(lineErrors, ERROR_PERCENTILE);

        const circleResult = circleFit.getFit();
        const circleErrors = testPoints.map((p) =>
          circleFit.distanceToPoint(p)
        );
        const circleMedian = circleResult.valid
          ? percentile(circleErrors, 0.5)
          : Infinity;
        const circleP90 = circleResult.valid
          ? percentile(circleErrors, ERROR_PERCENTILE)
          : Infinity;

        const lineFits = lineMedian <= MAX_ERROR && lineP90 <= MAX_ERROR_P90;
        const circleFits = circleMedian <= MAX_ERROR &&
          circleP90 <= MAX_ERROR_P90;

        if (lineFits || circleFits) {
          const useArc = circleFits &&
            circleMedian < lineMedian * ARC_PREFERENCE_FACTOR;
          console.log(
            `[Absorb unfitted] Extended next segment to [${extendedStart}-${nextSeg.endIndex}] as ${
              useArc ? "arc" : "line"
            } (line=${lineMedian.toFixed(3)}px, circle=${
              circleMedian.toFixed(3)
            }px)`,
          );

          // Update nextSeg for next iteration
          segments[i + 1] = {
            ...nextSeg,
            startIndex: extendedStart,
            type: useArc ? "arc" : "line",
          };
          absorbed = true;
          i++; // Skip the polyline, add extended nextSeg on next iteration
          continue;
        }
      }
    }

    // Couldn't absorb - keep the polyline
    if (!absorbed) {
      console.log(
        `[Absorb unfitted] Could not absorb polyline segment ${i}, keeping as unfitted`,
      );
      result.push(seg);
    }

    i++;
  }

  return result;
}

/**
 * Multi-pass segmentation with progressively relaxed tolerances.
 * Pass 1: Strict - captures clean horizontals/verticals/arcs
 * Pass 2: Normal - captures diagonals and good fits
 * Pass 3: Relaxed - cleanup stragglers
 */
function segmentPathMultiPass(
  points: Point[],
  isClosed: boolean,
): Segment[] {
  const allSegments: Segment[] = [];
  const fittedIndices = new Set<number>();

  for (const level of TOLERANCE_LEVELS) {
    console.log(
      `\n=== Pass: ${level.name} (maxError=${level.maxError}px, maxErrorP90=${level.maxErrorP90}px) ===`,
    );

    const passSegments = segmentPathWithTolerance(
      points,
      isClosed,
      level.maxError,
      level.maxErrorP90,
      level.minSegmentLength,
      fittedIndices,
    );

    console.log(
      `  Found ${passSegments.length} segments in ${level.name} pass`,
    );

    // Mark fitted indices
    for (const seg of passSegments) {
      for (let i = seg.startIndex; i <= seg.endIndex; i++) {
        fittedIndices.add(i);
      }
      allSegments.push(seg);
    }

    console.log(
      `  Total fitted: ${fittedIndices.size}/${points.length} pixels`,
    );
  }

  // Sort segments by start index
  allSegments.sort((a, b) => a.startIndex - b.startIndex);

  console.log(
    `\n=== Multi-pass complete: ${allSegments.length} total raw segments ===`,
  );
  allSegments.forEach((s, i) =>
    console.log(`    Seg ${i}: [${s.startIndex}-${s.endIndex}]`)
  );

  // Remove redundant segments: prefer longer segments that fully contain shorter ones
  const filteredSegments: Segment[] = [];
  for (const seg of allSegments) {
    const segLength = seg.endIndex - seg.startIndex + 1;
    
    // Check if this segment is fully contained by a longer segment
    let isRedundant = false;
    for (const other of allSegments) {
      if (seg === other) continue;
      
      const otherLength = other.endIndex - other.startIndex + 1;
      if (otherLength <= segLength) continue; // Only check longer segments
      
      // Check if seg is fully contained within other
      const segFullyContained = seg.startIndex >= other.startIndex && 
                                 seg.endIndex <= other.endIndex;
      
      if (segFullyContained) {
        console.log(
          `  [Removing redundant] Seg [${seg.startIndex}-${seg.endIndex}] ` +
          `(${segLength} pts) contained by [${other.startIndex}-${other.endIndex}] ` +
          `(${otherLength} pts)`,
        );
        isRedundant = true;
        break;
      }
    }
    
    if (!isRedundant) {
      filteredSegments.push(seg);
    }
  }

  console.log(
    `\n=== After filtering: ${filteredSegments.length} segments ===`,
  );
  filteredSegments.forEach((s, i) =>
    console.log(`    Seg ${i}: [${s.startIndex}-${s.endIndex}]`)
  );

  return filteredSegments;
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

  const segments = segmentPathMultiPass(points, isClosed);
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

  // Try to absorb any remaining unfitted polyline segments
  const absorbed = absorbUnfittedSegments(points, connected, isClosed);
  console.log(
    `  After absorbing unfitted segments: ${absorbed.length} segments`,
  );
  absorbed.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  // DON'T re-classify after connection refinement - it would recalculate
  // projectedStart/projectedEnd and erase our carefully calculated intersection points!
  // The segments already have their fits from earlier classification steps.
  
  // Merge adjacent collinear line segments to eliminate redundant vertices
  const mergedLines = mergeCollinearSegments(points, absorbed);
  console.log(`  After merging collinear segments: ${mergedLines.length} segments`);
  mergedLines.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  // Merge adjacent arc segments that share the same circle
  const merged = mergeCoincidentArcs(points, mergedLines);
  console.log(`  After merging coincident arcs: ${merged.length} segments`);
  merged.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  // Note: We don't re-classify after connection refinement because it would
  // recalculate projectedStart/projectedEnd and erase our intersection points
  // The segments are already classified and just have updated projected endpoints
  console.log(`  Final: ${merged.length} segments`);
  merged.forEach((s, i) =>
    console.log(
      `    Seg ${i}: [${s.startIndex}-${s.endIndex}] type=${s.type}`,
    )
  );

  return merged;
}
