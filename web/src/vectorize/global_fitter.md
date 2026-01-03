Implement a global line+arc fitting system for raster-to-vector conversion, with
G¹ continuity and pixel-based error, suitable for CAM output (G1/G2/G3).

I already have: binary thresholded image skeletonization traced centerline paths
(ordered points per stroke) Douglas-Peucker simplified polylines for each stroke

For each stroke, implement a model-selection fitter that converts the DP
polyline into a minimal set of lines and circular arcs that best fit the raw
stroke pixels, with tangent continuity between adjacent primitives unless a real
corner is required.

Inputs

For each stroke:

```typescript
type Point = { x: number, y: number }

dpPoints: Point[] // DP-simplified centerline
rawPixels: Point[] // all thresholded pixels belonging to this stroke
```

rawPixels should include all black pixels within a distance of the skeleton for
this stroke.

## Step 1 — Recursive segmentation

Implement:

```typescript
fitSpan(i: number, j: number): Primitive[]
```

Where i..j indexes into dpPoints.

For each span:

1. Fit a line to dpPoints[i..j]
2. Fit a circle arc to dpPoints[i..j]
3. Compute pixel error for each fit using rawPixels:

- For each pixel assigned to this span, compute shortest distance to the curve
- Use RMS or max distance

4. Add curvature penalty for arcs: arcCost = pixelError + lambda * (1 / radius)²
5. Choose the cheaper model

If chosen model error < tolerance → accept as a primitive Else → find point k in
(i..j) with maximum deviation and split:

```typescript
return fitSpan(i, k) + fitSpan(k, j);
```

This produces a primitive chain with no explicit corners yet.

## Step 2 — Primitive graph

Store for each primitive:

```typescript
type Line = { type: "line"; p0; p1 };
type Arc = { type: "arc"; cx; cy; r; startAngle; endAngle; p0; p1 };
```

Where p0,p1 are endpoints.

Adjacency is determined by sequence order.

## Step 3 — Global G¹ continuity solve

Build a least-squares system over all primitives:

### Variables

- Line endpoints
- Arc centers (cx,cy)
- Arc radii
- Arc endpoints

### Constraints

For every shared endpoint S between primitive A and B:

1. Position continuity

```typescript
A.end == B.start;
```

2. Tangent continuity (G¹) unless marked corner

- For line–line: `dirA == dirB`
- For line–arc: `line direction == arc tangent at S`
- For arc–arc: `tangent(A,S) == tangent(B,S)`

Corners are those junctions where segmentation split occurred due to fit
failure.

### Objective

Minimize:

```
Σ pixel_to_curve_distance²
+ λ Σ curvature²
```

Solve with linearized least squares (Gauss-Newton).

Update all primitive parameters simultaneously.

## Step 4 — Merge primitives

After solve:

- Merge adjacent arcs with similar centers/radii
- Merge collinear lines

## Step 5 — Output

Return a sequence of:

```
G1 (lines) G2/G3 (arcs)
```

in stroke order.

## Important notes

Never fit splines

Never use angle-based corner detection

Corners emerge only when the recursive fitter must split

All geometry is adjusted globally to enforce G¹ continuity
