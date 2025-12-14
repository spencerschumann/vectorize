# Vectorization Module

Clean, modular implementation of vectorization primitives for converting raster
line art into vector paths.

## Structure

```
src/vectorize/
├── geometry.ts           # Core geometric primitives and operations
├── geometry_test.ts      # Comprehensive geometry tests
├── line_fit.ts          # Line fitting algorithms (TLS)
├── line_fit_test.ts     # Line fitting tests
├── arc_fit.ts           # Arc/circle fitting algorithms
├── arc_fit_test.ts      # Arc fitting tests
└── README.md            # This file
```

## Modules

### `geometry.ts`

Core geometric primitives and operations. All functions are standalone and
reusable.

**Types:**

- `Point` - 2D point with x, y coordinates
- `Line` - Line defined by a point and unit direction vector
- `Arc` - Circular arc with center, radius, angles, and direction
- `Circle` - Circle defined by center and radius

**Point Operations:**

- Distance, squared distance, add, subtract, scale
- Dot product, cross product, magnitude, normalize
- Angle calculation, rotation, equality testing

**Line Operations:**

- Create line from two points
- Distance from point to line (perpendicular)
- Project point onto line
- Line-line intersection

**Circle Operations:**

- Distance from point to circle perimeter
- Project point onto circle
- Line-circle intersection
- Circle-circle intersection

**Arc Operations:**

- Angle normalization
- Sweep angle calculation
- Point on arc, start/end points
- Check if angle is within arc
- Line-arc intersection
- Arc-arc intersection

### `line_fit.ts`

Line fitting using **Total Least Squares (TLS)** algorithm.

**Features:**

- Minimizes perpendicular distance (not vertical distance like OLS)
- Handles vertical and horizontal lines equally well
- Returns RMS error, median error, and per-point errors
- Both batch and incremental fitting modes

**API:**

```typescript
// Batch fitting
const result = fitLine(points);
if (result) {
  const { line, rmsError, medianError, errors } = result;
}

// Incremental fitting
const fitter = new IncrementalLineFit();
for (const point of points) {
  fitter.addPoint(point);
  const fit = fitter.getFit(); // O(1) update
}
```

### `arc_fit.ts`

Circle/arc fitting using **algebraic distance minimization** (Pratt method).

**Features:**

- Fits circles to point sets
- Calculates arc parameters (start/end angles, sweep, direction)
- Returns RMS error, median error, and per-point errors
- Both batch and incremental fitting modes

**API:**

```typescript
// Batch fitting
const result = fitCircle(points);
if (result) {
  const { circle, rmsError, startAngle, endAngle, clockwise } = result;
}

// Incremental fitting
const fitter = new IncrementalCircleFit();
for (const point of points) {
  fitter.addPoint(point);
  const fit = fitter.getFit();
}
```

**Note:** Algebraic fitting can have bias for partial arcs. For production use,
consider implementing geometric fitting (minimizing geometric distance) for
better arc accuracy.

## Testing

All modules have comprehensive test coverage:

```bash
# Run all vectorization tests
deno test src/vectorize/

# Run specific test file
deno test src/vectorize/geometry_test.ts
deno test src/vectorize/line_fit_test.ts
deno test src/vectorize/arc_fit_test.ts
```

**Test Coverage:**

- 42 geometry operation tests
- 18 line fitting tests
- 12 arc fitting tests
- **71 tests passing** ✓

## Usage Examples

### Basic Line Fitting

```typescript
import { fitLine } from "./line_fit.ts";

const points = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 2, y: 2 },
  { x: 3, y: 3 },
];

const result = fitLine(points);
if (result) {
  console.log("Line direction:", result.line.direction);
  console.log("RMS error:", result.rmsError);
  console.log("Median error:", result.medianError);
}
```

### Basic Arc Fitting

```typescript
import { fitCircle } from "./arc_fit.ts";

const points = [];
const radius = 5;
for (let angle = 0; angle < Math.PI / 2; angle += 0.1) {
  points.push({
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
  });
}

const result = fitCircle(points);
if (result) {
  console.log("Center:", result.circle.center);
  console.log("Radius:", result.circle.radius);
  console.log("Sweep angle:", result.sweepAngle);
  console.log("Clockwise:", result.clockwise);
}
```

### Geometric Intersections

```typescript
import { lineCircleIntersection, lineLineIntersection } from "./geometry.ts";

// Find where two lines intersect
const line1 = { point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
const line2 = { point: { x: 5, y: -3 }, direction: { x: 0, y: 1 } };
const intersection = lineLineIntersection(line1, line2);
// => { x: 5, y: 0 }

// Find where line intersects circle
const circle = { center: { x: 0, y: 0 }, radius: 5 };
const intersections = lineCircleIntersection(line1, circle);
// => [{ x: -5, y: 0 }, { x: 5, y: 0 }]
```

## Design Principles

1. **Standalone Functions** - Each operation is independent and reusable
2. **Type Safety** - Full TypeScript typing for all functions
3. **Well-Tested** - Comprehensive test coverage with edge cases
4. **Performance** - Efficient algorithms with O(1) incremental updates where
   possible
5. **Robustness** - Handles degenerate cases (coincident points, parallel lines,
   etc.)

## Future Enhancements

- Geometric circle fitting for better arc accuracy
- Bézier curve fitting
- Spline interpolation
- Path simplification algorithms (Douglas-Peucker, Visvalingam-Whyatt)
- Arc-to-arc blending for smooth transitions

## References

- **Line Fitting:** Total Least Squares (Orthogonal Regression)
- **Circle Fitting:** Algebraic fitting (Pratt method)
- **Geometric Algorithms:** "Computational Geometry: Algorithms and
  Applications"
