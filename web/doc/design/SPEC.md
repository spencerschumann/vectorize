# CleanPlans Vectorizer - Specification

## Overview

The CleanPlans Vectorizer converts raster line art (scanned drawings, PDFs) into
clean vector paths suitable for CNC machining and CAD workflows.

### Design Goals

1. **Precision**: Maintain high fidelity to source artwork
2. **Simplicity**: Minimize number of primitives while preserving accuracy
3. **CNC-Ready**: Output lines and arcs compatible with GRBL controllers
4. **Browser-First**: Maximum portability without installation requirements
5. **Performance**: GPU-accelerated processing for interactive workflows

### Architectural Inspiration

Loosely based on Autotrace's centerline mode, but addressing its limitations:

- Reduced deviation from input image
- Better arc detection and fitting
- Configurable tolerance levels for different use cases
- Multi-pass optimization for optimal segmentation

### Primitives

The vectorizer uses two geometric primitives:

- **Lines**: Straight segments (G1 commands)
- **Arcs**: Circular segments with center, radius, and sweep angle (G2/G3
  commands)

## Architecture

The tool consists of three major subsystems:

1. **Image Processing Pipeline** - GPU-accelerated raster cleanup and
   skeletonization
2. **Vectorization Engine** - Path tracing and curve fitting
3. **Output Generation** - SVG, G-code, and debugging formats

---

## 1. Image Processing Pipeline

### Purpose

Transform noisy raster input into clean, 1-bit skeletonized images suitable for
vectorization.

### Pipeline Stages

#### 1.1 PDF Rendering

- **Input**: PDF file
- **Output**: RGBA image at configurable DPI
- **Implementation**:
  - Browser: PDF.js for rendering
  - Deno: pdf-lib for metadata extraction
- **Format**: `RGBAImage` (4 bytes per pixel)

#### 1.2 Color Extraction and Palettization

Transform full-color input into a small set of meaningful colors.

**Process:**

1. **Black Extraction** (priority layer)
   - Use value channel thresholding
   - Configurable threshold (default: < 0.2 in HSV value)
   - Separates black linework from colored regions

2. **Color Quantization**
   - Extract highly saturated colors using saturation mask
   - Cluster colors by hue into configurable buckets (maximum 16 colors)
   - Weighted quantization preserving dominant colors

3. **Color Mapping**
   - User-configurable remapping of detected colors to output colors
   - Option to delete colors (map to background/transparent)
   - Preserve black layer separately for maximum fidelity

**GPU Implementation:**

- `extract_black_gpu.ts` - Black layer extraction
- `palettize_gpu.ts` - Color quantization with GPU histograms
- **Format**: `PalettizedImage` (4 bits per pixel, 16 color palette)

#### 1.3 Noise Reduction

Remove scanning artifacts and noise while preserving edges.

**Median Filtering:**

- 3×3 or 5×5 weighted median filter
- Applied per-channel or on value channel
- GPU-accelerated for real-time preview
- Configurable iterations (typically 1-2 passes)

**Anti-Aliasing Removal** (future enhancement):

- Detect and undo anti-aliasing from PDF rendering
- Threshold fuzzy edges to crisp binary boundaries

**GPU Implementation:**

- `median_gpu.ts` - Fast median filtering with separable passes
- `bloom_gpu.ts` - Edge-preserving smoothing (optional)

#### 1.4 Skeletonization (Thinning)

Reduce thick lines to single-pixel centerlines.

**Algorithm: Zhang-Suen Thinning**

- Iterative morphological thinning
- Preserves topology (connectivity and endpoints)
- Handles junctions gracefully
- Runs until convergence (no pixels removed)

**Process:**

1. Convert to binary (1-bit format: `BinaryImage`)
2. Alternate between two sub-iterations:
   - Sub-iteration 1: Mark border pixels meeting specific conditions
   - Sub-iteration 2: Mark border pixels meeting complementary conditions
3. Remove marked pixels after each sub-iteration
4. Repeat until no changes occur

**GPU Implementation:**

- `value_process_gpu.ts` - Zhang-Suen skeletonization shader
- Ping-pong buffer strategy for iterative refinement
- **Format**: `BinaryImage` (1 bit per pixel, 8 pixels per byte)

#### 1.5 Post-Processing

- **Cleanup**: Remove isolated pixels and small artifacts
- **Gap Closing**: Bridge small gaps in lines (optional)
- **White Threshold**: Suppress background noise

**GPU Implementation:**

- `cleanup_gpu.ts` - Morphological operations
- `white_threshold_gpu.ts` - Background suppression
- `subtract_black_gpu.ts` - Layer compositing

### Pipeline Output

- **Primary**: `BinaryImage` - 1-bit skeletonized artwork
- **Debug**: Intermediate images at each stage for visualization
- **Metadata**: Processing parameters and statistics

---

## 2. Vectorization Engine

### Purpose

Convert skeletonized pixel data into optimized vector paths with geometric
primitives.

### 2.1 Path Tracing

**Input**: `BinaryImage` (1-bit skeletonized) **Output**: `VectorPath[]`
(ordered sequences of pixel coordinates)

#### Algorithm

**Vertex Graph Construction:**

1. Scan image to find all set pixels
2. Build adjacency graph:
   - Cardinal neighbors (N, E, S, W) - preferred
   - Diagonal neighbors only if no stair-step path exists
3. Classify pixels by neighbor count:
   - 0 neighbors: Isolated point
   - 1 neighbor: Endpoint
   - 2 neighbors: Path continuation
   - 3+ neighbors: Junction

**Path Extraction:**

1. Start from endpoints (pixels with 1 neighbor)
2. Follow path by visiting unvisited neighbors
3. Prefer cardinal directions over diagonals for cleaner paths
4. Mark pixels as visited to avoid retracing
5. Handle closed loops by detecting cycles
6. Split at junctions (3+ way intersections)

**Implementation**: `vectorize.ts::vectorizeSkeleton()`

### 2.2 Curve Fitting and Simplification

**Input**: `VectorPath[]` (raw pixel sequences) **Output**: `SimplifiedPath[]`
(optimized line and arc segments)

#### Multi-Pass Segmentation Strategy

The algorithm uses multiple passes with increasing error tolerances to build
optimal segmentations progressively.

**Tolerance Levels:**

```typescript
Pass 1 - "strict":   maxError: 0.3px, minLength: 20px  // Long, clean segments
Pass 2 - "normal":   maxError: 0.6px, minLength: 10px  // Medium segments
Pass 3 - "relaxed":  maxError: 1.0px, minLength: 5px   // Short, complex regions
```

#### Fitting Algorithms

**Line Fitting: Total Least Squares (TLS)**

- Minimizes perpendicular distance to fitted line
- Incremental computation: O(1) per point addition
- Returns: direction vector, centroid, RMS error

**Arc Fitting: Algebraic Circle Fit**

- Minimizes algebraic distance to fitted circle
- Incremental computation using running sums
- Returns: center, radius, sweep angle, RMS error
- Validates: minimum radius (2px), maximum radius (10,000px)

**Error Metrics:**

- Median error: Central tendency, robust to outliers
- 90th percentile error: Captures outlier tolerance
- Both must be within tolerance for valid fit

#### Greedy Segment Growing

For each pass tolerance level:

1. **Initialize** with first point
2. **Grow Segment**:
   - Add next point to candidate segment
   - Incrementally update line and arc fits
   - Calculate error metrics for both fits
3. **Evaluate Fits**:
   - Check if segment meets minimum length requirement
   - Test if errors are within tolerance
   - Prefer arcs when error is similar (1.2× factor)
   - Require minimum sweep angle (30°) for arcs
4. **Lookahead Hysteresis**:
   - Continue growing for N additional points (default: 2)
   - Prevent premature breaks at local noise
5. **Commit Segment**:
   - Choose best fit (line or arc)
   - Store fitted parameters and projected endpoints
   - If no valid fit, keep as unfitted polyline
6. **Repeat** from next unprocessed point

**Implementation**:
`incremental_segmentation.ts::vectorizeWithIncrementalSegmentation()`

#### Segment Refinement

After initial segmentation, optimize connections:

**Intersection Recovery:**

- Extend adjacent line/arc fits to find their geometric intersection
- If intersection is close to both segments (within tolerance):
  - Snap both endpoints to intersection
  - Recovers sharp corners rounded by filtering

**Gap Bridging:**

- Detect small gaps between segments (< 5px)
- Attempt to bridge with line or arc
- Replace original segments if bridge improves overall fit

**Polyline Handling:**

- Unfitted polyline segments indicate complex regions
- Treat as "gaps" to be bridged in later passes
- Preserve if no better fit found

**Circle Detection:**

- Identify closed paths with consistent arc curvature
- Fit complete circle if error is low
- Special handling in output (single G2 or SVG circle element)

### 2.3 Output Formats

#### Simplified Path Structure

```typescript
interface SimplifiedPath {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
  circle?: Circle; // For complete circles
  segments: Segment[]; // Line/arc/polyline segments
}

interface Segment {
  type: "line" | "arc" | "polyline";
  startIndex: number;
  endIndex: number;
  projectedStart?: Point; // Fitted endpoints
  projectedEnd?: Point;
  lineFit?: { centroid; direction; error };
  circleFit?: { center; radius; error; sweepAngle; clockwise };
}
```

---

## 3. Tunable Parameters

### Image Processing

- **DPI**: Rendering resolution (default: 200)
- **Black threshold**: HSV value cutoff (default: 0.2)
- **Palette size**: Number of color buckets (default: 16)
- **Median iterations**: Noise reduction passes (default: 1-2)
- **Skeletonization iterations**: Maximum thinning passes (auto-converge)

### Vectorization

- **Minimum segment points**: Valid fit requirement (default: 5)
- **Lookahead points**: Hysteresis buffer (default: 2)
- **Error percentile**: Outlier tolerance (default: 90th)
- **Minimum radius**: Smallest valid arc (default: 2px)
- **Maximum radius**: Line threshold (default: 10,000px)
- **Arc preference factor**: Bias toward arcs (default: 1.2×) (TODO: rethink
  this, may give too much arc preference)
- **Minimum sweep angle**: Smallest valid arc (default: 30°)
- **Tolerance levels**: Multi-pass thresholds (3 passes)

---

## 4. Implementation Notes

### GPU Acceleration

- All image processing stages use WebGPU compute shaders
- Fallback to CPU for unsupported browsers
- Shared `GPUContext` manages device and buffers
- Ping-pong buffers for iterative algorithms

### Memory Formats

- **RGBA**: 4 bytes/pixel - standard interchange format
- **Palettized**: 4 bits/pixel (2 pixels/byte) - color quantization
- **Binary**: 1 bit/pixel (8 pixels/byte) - skeletonized output

### Testing Strategy

- Unit tests for each pipeline stage
- Visual regression tests for known inputs
- Performance benchmarks for GPU operations
- Test data: synthetic patterns and real-world scans

### Future Enhancements

- Bézier curve fitting (G5 commands)
- Spline support for smooth curves
- Layer preservation with color output
- Real-time parameter adjustment
- Batch processing optimizations
