// src/formats/binary.ts
function createBinaryImage(width, height) {
  const size = Math.ceil(width * height / 8);
  return {
    width,
    height,
    data: new Uint8Array(size)
  };
}
function getPixelBin(img, x, y) {
  const pixelIndex = y * img.width + x;
  const byteIndex = Math.floor(pixelIndex / 8);
  const bitIndex = 7 - pixelIndex % 8;
  return img.data[byteIndex] >> bitIndex & 1;
}
function setPixelBin(img, x, y, value) {
  const pixelIndex = y * img.width + x;
  const byteIndex = Math.floor(pixelIndex / 8);
  const bitIndex = 7 - pixelIndex % 8;
  if (value === 1) {
    img.data[byteIndex] |= 1 << bitIndex;
  } else {
    img.data[byteIndex] &= ~(1 << bitIndex);
  }
}

// src/vectorize/tracer.ts
function traceGraph(binary) {
  const width = binary.width;
  const height = binary.height;
  const nodes = /* @__PURE__ */ new Map();
  const edges = [];
  const visitedEdges = /* @__PURE__ */ new Set();
  const getVertexId = (x, y) => y * width + x;
  const isPixelSet = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return getPixelBin(binary, x, y) === 1;
  };
  const getNeighbors = (x, y) => {
    const neighbors = [];
    const cardinalOffsets = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 }
    ];
    for (const offset of cardinalOffsets) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (isPixelSet(nx, ny)) {
          neighbors.push({ x: nx, y: ny });
        }
      }
    }
    const diagonalOffsets = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 }
    ];
    for (const offset of diagonalOffsets) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (isPixelSet(nx, ny)) {
          const hasStairStep = cardinalOffsets.some((cardinal) => {
            const cx = x + cardinal.x;
            const cy = y + cardinal.y;
            if (cx >= 0 && cx < width && cy >= 0 && cy < height && isPixelSet(cx, cy)) {
              const dcx = nx - cx;
              const dcy = ny - cy;
              return Math.abs(dcx) + Math.abs(dcy) === 1;
            }
            return false;
          });
          if (!hasStairStep) {
            neighbors.push({ x: nx, y: ny });
          }
        }
      }
    }
    return neighbors;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPixelSet(x, y)) {
        const neighbors = getNeighbors(x, y);
        if (neighbors.length !== 2) {
          const id = getVertexId(x, y);
          nodes.set(id, {
            id,
            point: { x, y },
            edges: []
          });
        }
      }
    }
  }
  const getEdgeKey = (id1, id2) => {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
  };
  for (const node of nodes.values()) {
    const startNeighbors = getNeighbors(node.point.x, node.point.y);
    for (const neighbor of startNeighbors) {
      const neighborId = getVertexId(neighbor.x, neighbor.y);
      const edgeKey = getEdgeKey(node.id, neighborId);
      if (visitedEdges.has(edgeKey)) continue;
      const pathPoints = [node.point, neighbor];
      visitedEdges.add(edgeKey);
      let currentId = neighborId;
      let currentPoint = neighbor;
      let prevId = node.id;
      while (true) {
        if (nodes.has(currentId)) {
          const edgeIndex = edges.length;
          const endNode = nodes.get(currentId);
          edges.push({
            id: edgeIndex,
            points: pathPoints,
            nodeA: node.id,
            nodeB: endNode.id
          });
          node.edges.push(edgeIndex);
          if (node.id !== endNode.id) {
            endNode.edges.push(edgeIndex);
          } else {
            node.edges.push(edgeIndex);
          }
          break;
        }
        const neighbors = getNeighbors(currentPoint.x, currentPoint.y);
        const next = neighbors.find((n) => getVertexId(n.x, n.y) !== prevId);
        if (!next) {
          break;
        }
        const nextId = getVertexId(next.x, next.y);
        const nextKey = getEdgeKey(currentId, nextId);
        visitedEdges.add(nextKey);
        pathPoints.push(next);
        prevId = currentId;
        currentId = nextId;
        currentPoint = next;
      }
    }
  }
  const processedPixels = /* @__PURE__ */ new Set();
  for (const edge of edges) {
    for (const p of edge.points) {
      processedPixels.add(getVertexId(p.x, p.y));
    }
  }
  for (const node of nodes.values()) {
    processedPixels.add(node.id);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = getVertexId(x, y);
      if (isPixelSet(x, y) && !processedPixels.has(id)) {
        const pathPoints = [{ x, y }];
        processedPixels.add(id);
        let currentPoint = { x, y };
        let currentId = id;
        let prevId = -1;
        while (true) {
          const neighbors = getNeighbors(currentPoint.x, currentPoint.y);
          let next;
          if (prevId === -1) {
            next = neighbors[0];
          } else {
            next = neighbors.find((n) => getVertexId(n.x, n.y) !== prevId);
          }
          if (!next) break;
          const nextId = getVertexId(next.x, next.y);
          if (nextId === id && prevId !== -1) {
            pathPoints.push(next);
            break;
          }
          if (processedPixels.has(nextId)) {
            break;
          }
          processedPixels.add(nextId);
          pathPoints.push(next);
          prevId = currentId;
          currentId = nextId;
          currentPoint = next;
        }
        const edgeIndex = edges.length;
        edges.push({
          id: edgeIndex,
          points: pathPoints,
          nodeA: -1,
          nodeB: -1
        });
      }
    }
  }
  return { nodes, edges };
}

// src/vectorize/geometry.ts
function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function add(p1, p2) {
  return { x: p1.x + p2.x, y: p1.y + p2.y };
}
function subtract(p1, p2) {
  return { x: p1.x - p2.x, y: p1.y - p2.y };
}
function scale(p, s) {
  return { x: p.x * s, y: p.y * s };
}
function dot(p1, p2) {
  return p1.x * p2.x + p1.y * p2.y;
}
function cross(p1, p2) {
  return p1.x * p2.y - p1.y * p2.x;
}
function magnitude(p) {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}
function normalize(p) {
  const mag = magnitude(p);
  if (mag < 1e-10) {
    return { x: 0, y: 0 };
  }
  return { x: p.x / mag, y: p.y / mag };
}

// src/vectorize/optimizer.ts
var CONFIG = {
  LEARNING_RATE: 0.05,
  ITERATIONS: 50,
  SPLIT_THRESHOLD: 0.7,
  // Max error to trigger split
  MERGE_THRESHOLD: 0.2,
  // Error increase allowed for merge
  ALIGNMENT_STRENGTH: 1,
  // Weight for axis alignment
  SMOOTHNESS_STRENGTH: 0.2,
  // Weight for tangent continuity
  FIDELITY_WEIGHT: 1
};
function optimizeEdge(edge, initialSegments, onIteration) {
  let nodes = [];
  let segments = [];
  if (initialSegments && initialSegments.length > 0) {
    const firstP = initialSegments[0].start;
    nodes.push({ x: firstP.x, y: firstP.y, fixed: true });
    let currentPointIdx = 0;
    for (let i = 0; i < initialSegments.length; i++) {
      const seg = initialSegments[i];
      const endP = seg.end;
      const isLast = i === initialSegments.length - 1;
      nodes.push({ x: endP.x, y: endP.y, fixed: isLast });
      let bestIdx = currentPointIdx;
      let minD = Infinity;
      for (let k = currentPointIdx; k < edge.original.points.length; k++) {
        const d = distanceSquared(edge.original.points[k], endP);
        if (d < minD) {
          minD = d;
          bestIdx = k;
        } else if (d > minD + 2) {
          break;
        }
      }
      if (isLast) {
        bestIdx = edge.original.points.length - 1;
      } else {
        bestIdx = Math.max(bestIdx, currentPointIdx + 1);
      }
      const segmentPoints = edge.original.points.slice(
        currentPointIdx,
        bestIdx + 1
      );
      let sagitta = 0;
      if (seg.type === "arc") {
        const chord = subtract(seg.end, seg.start);
        const chordLen = magnitude(chord);
        const midChord = scale(add(seg.start, seg.end), 0.5);
        const toCenter = subtract(seg.arc.center, midChord);
        const distToCenter = magnitude(toCenter);
        const cp = cross(chord, toCenter);
        const midAngle = (seg.arc.startAngle + seg.arc.endAngle) / 2;
        if (segmentPoints.length > 0) {
          const midIdx = Math.floor(segmentPoints.length / 2);
          const pMid = segmentPoints[midIdx];
          const d = Math.sqrt(
            distancePointToLineSegmentSq(pMid, seg.start, seg.end)
          );
          const normal = { x: -chord.y, y: chord.x };
          const toP = subtract(pMid, seg.start);
          const dotN = dot(toP, normal);
          sagitta = d * (dotN > 0 ? 1 : -1);
        }
      }
      segments.push({
        startIdx: i,
        endIdx: i + 1,
        sagitta,
        points: segmentPoints
      });
      currentPointIdx = bestIdx;
    }
  } else {
    const startP = edge.original.points[0];
    const endP = edge.original.points[edge.original.points.length - 1];
    nodes.push({ x: startP.x, y: startP.y, fixed: true });
    nodes.push({ x: endP.x, y: endP.y, fixed: true });
    segments.push({
      startIdx: 0,
      endIdx: 1,
      sagitta: 0,
      points: edge.original.points
    });
  }
  if (onIteration) {
    onIteration(
      JSON.parse(JSON.stringify(nodes)),
      JSON.parse(JSON.stringify(segments)),
      "Initial"
    );
  }
  let changed = true;
  let loopCount = 0;
  while (changed && loopCount < 5) {
    changed = false;
    loopCount++;
    optimizeParameters(nodes, segments);
    if (onIteration) {
      onIteration(
        JSON.parse(JSON.stringify(nodes)),
        JSON.parse(JSON.stringify(segments)),
        `Iteration ${loopCount} - Optimized`
      );
    }
    const newSegments = [];
    let splitOccurred = false;
    for (const seg of segments) {
      const maxErr = getMaxError(seg, nodes);
      if (maxErr > CONFIG.SPLIT_THRESHOLD && seg.points.length > 4) {
        const splitRes = splitSegment(seg, nodes);
        newSegments.push(splitRes.left);
        newSegments.push(splitRes.right);
        splitOccurred = true;
        changed = true;
      } else {
        newSegments.push(seg);
      }
    }
    segments = newSegments;
    if (splitOccurred) {
      if (onIteration) {
        onIteration(
          JSON.parse(JSON.stringify(nodes)),
          JSON.parse(JSON.stringify(segments)),
          `Iteration ${loopCount} - Split`
        );
      }
      optimizeParameters(nodes, segments);
      if (onIteration) {
        onIteration(
          JSON.parse(JSON.stringify(nodes)),
          JSON.parse(JSON.stringify(segments)),
          `Iteration ${loopCount} - Re-optimized`
        );
      }
    }
  }
  optimizeParameters(nodes, segments);
  if (onIteration) {
    onIteration(
      JSON.parse(JSON.stringify(nodes)),
      JSON.parse(JSON.stringify(segments)),
      "Final"
    );
  }
  return {
    original: edge.original,
    segments: convertToSegments(nodes, segments)
  };
}
function optimizeParameters(nodes, segments) {
  for (let iter = 0; iter < CONFIG.ITERATIONS; iter++) {
    const nodeGrads = nodes.map(() => ({ x: 0, y: 0 }));
    const sagittaGrads = segments.map(() => 0);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pStart = nodes[seg.startIdx];
      const pEnd = nodes[seg.endIdx];
      const h = 0.1;
      const errBase = getSegmentError(seg, pStart, pEnd, seg.sagitta);
      const errPlus = getSegmentError(seg, pStart, pEnd, seg.sagitta + h);
      sagittaGrads[i] += (errPlus - errBase) / h * CONFIG.FIDELITY_WEIGHT;
      if (!pStart.fixed) {
        const pStartX = { ...pStart, x: pStart.x + h };
        const errX = getSegmentError(seg, pStartX, pEnd, seg.sagitta);
        nodeGrads[seg.startIdx].x += (errX - errBase) / h * CONFIG.FIDELITY_WEIGHT;
        const pStartY = { ...pStart, y: pStart.y + h };
        const errY = getSegmentError(seg, pStartY, pEnd, seg.sagitta);
        nodeGrads[seg.startIdx].y += (errY - errBase) / h * CONFIG.FIDELITY_WEIGHT;
      }
      if (!pEnd.fixed) {
        const pEndX = { ...pEnd, x: pEnd.x + h };
        const errX = getSegmentError(seg, pStart, pEndX, seg.sagitta);
        nodeGrads[seg.endIdx].x += (errX - errBase) / h * CONFIG.FIDELITY_WEIGHT;
        const pEndY = { ...pEnd, y: pEnd.y + h };
        const errY = getSegmentError(seg, pStart, pEndY, seg.sagitta);
        nodeGrads[seg.endIdx].y += (errY - errBase) / h * CONFIG.FIDELITY_WEIGHT;
      }
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pStart = nodes[seg.startIdx];
      const pEnd = nodes[seg.endIdx];
      const h = 0.1;
      if (Math.abs(seg.sagitta) < 1) {
        const dx = pEnd.x - pStart.x;
        const dy = pEnd.y - pStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-4) {
          const costBase = alignmentCost(pStart, pEnd);
          if (!pStart.fixed) {
            const costX = alignmentCost({ ...pStart, x: pStart.x + h }, pEnd);
            nodeGrads[seg.startIdx].x += (costX - costBase) / h * CONFIG.ALIGNMENT_STRENGTH;
            const costY = alignmentCost({ ...pStart, y: pStart.y + h }, pEnd);
            nodeGrads[seg.startIdx].y += (costY - costBase) / h * CONFIG.ALIGNMENT_STRENGTH;
          }
          if (!pEnd.fixed) {
            const costX = alignmentCost(pStart, { ...pEnd, x: pEnd.x + h });
            nodeGrads[seg.endIdx].x += (costX - costBase) / h * CONFIG.ALIGNMENT_STRENGTH;
            const costY = alignmentCost(pStart, { ...pEnd, y: pEnd.y + h });
            nodeGrads[seg.endIdx].y += (costY - costBase) / h * CONFIG.ALIGNMENT_STRENGTH;
          }
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].fixed) {
        nodes[i].x -= nodeGrads[i].x * CONFIG.LEARNING_RATE;
        nodes[i].y -= nodeGrads[i].y * CONFIG.LEARNING_RATE;
      }
    }
    for (let i = 0; i < segments.length; i++) {
      segments[i].sagitta -= sagittaGrads[i] * CONFIG.LEARNING_RATE;
    }
  }
}
function alignmentCost(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return 0;
  return Math.pow(dx * dy / lenSq, 2) * 100;
}
function getSegmentError(seg, start, end, sagitta) {
  let error = 0;
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  if (chordLen < 1e-6) return 0;
  const midChord = scale(add(start, end), 0.5);
  const normal = { x: -chord.y / chordLen, y: chord.x / chordLen };
  const arcMid = add(midChord, scale(normal, sagitta));
  if (Math.abs(sagitta) < 0.1) {
    for (const p of seg.points) {
      error += distancePointToLineSegmentSq(p, start, end);
    }
  } else {
    const R = (Math.pow(chordLen / 2, 2) + sagitta * sagitta) / (2 * Math.abs(sagitta));
    const centerDist = R - Math.abs(sagitta);
    const center = add(
      midChord,
      scale(normal, (R - Math.abs(sagitta)) * (sagitta > 0 ? -1 : 1))
    );
    for (const p of seg.points) {
      const d = Math.abs(distance(p, center) - R);
      error += d * d;
    }
  }
  return error;
}
function getMaxError(seg, nodes) {
  const start = nodes[seg.startIdx];
  const end = nodes[seg.endIdx];
  let maxErr = 0;
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  if (chordLen < 1e-6) return 0;
  const midChord = scale(add(start, end), 0.5);
  const normal = { x: -chord.y / chordLen, y: chord.x / chordLen };
  if (Math.abs(seg.sagitta) < 0.1) {
    for (const p of seg.points) {
      const d = Math.sqrt(distancePointToLineSegmentSq(p, start, end));
      if (d > maxErr) maxErr = d;
    }
  } else {
    const R = (Math.pow(chordLen / 2, 2) + seg.sagitta * seg.sagitta) / (2 * Math.abs(seg.sagitta));
    const center = add(
      midChord,
      scale(normal, (R - Math.abs(seg.sagitta)) * (seg.sagitta > 0 ? -1 : 1))
    );
    for (const p of seg.points) {
      const d = Math.abs(distance(p, center) - R);
      if (d > maxErr) maxErr = d;
    }
  }
  return maxErr;
}
function splitSegment(seg, nodes) {
  const start = nodes[seg.startIdx];
  const end = nodes[seg.endIdx];
  let maxErr = -1;
  let splitIdx = -1;
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  const midChord = scale(add(start, end), 0.5);
  const normal = { x: -chord.y / chordLen, y: chord.x / chordLen };
  let center = { x: 0, y: 0 };
  let R = 0;
  const isLine = Math.abs(seg.sagitta) < 0.1;
  if (!isLine) {
    R = (Math.pow(chordLen / 2, 2) + seg.sagitta * seg.sagitta) / (2 * Math.abs(seg.sagitta));
    center = add(
      midChord,
      scale(normal, (R - Math.abs(seg.sagitta)) * (seg.sagitta > 0 ? -1 : 1))
    );
  }
  for (let i = 0; i < seg.points.length; i++) {
    const p = seg.points[i];
    let d = 0;
    if (isLine) {
      d = Math.sqrt(distancePointToLineSegmentSq(p, start, end));
    } else {
      d = Math.abs(distance(p, center) - R);
    }
    if (d > maxErr) {
      maxErr = d;
      splitIdx = i;
    }
  }
  const splitPoint = seg.points[splitIdx];
  const newNodeIdx = nodes.length;
  nodes.push({ x: splitPoint.x, y: splitPoint.y, fixed: false });
  const leftPoints = seg.points.slice(0, splitIdx + 1);
  const rightPoints = seg.points.slice(splitIdx);
  return {
    left: {
      startIdx: seg.startIdx,
      endIdx: newNodeIdx,
      sagitta: seg.sagitta / 2,
      // Initial guess
      points: leftPoints
    },
    right: {
      startIdx: newNodeIdx,
      endIdx: seg.endIdx,
      sagitta: seg.sagitta / 2,
      // Initial guess
      points: rightPoints
    }
  };
}
function distancePointToLineSegmentSq(p, a, b) {
  const l2 = distanceSquared(a, b);
  if (l2 === 0) return distanceSquared(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y)
  };
  return distanceSquared(p, proj);
}
function distanceSquared(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}
function convertToSegments(nodes, optSegments) {
  return optSegments.map((seg) => {
    const start = nodes[seg.startIdx];
    const end = nodes[seg.endIdx];
    if (Math.abs(seg.sagitta) < 0.5) {
      return {
        type: "line",
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        line: {
          point: { x: start.x, y: start.y },
          direction: normalize(subtract(end, start))
        }
      };
    } else {
      const chord = subtract(end, start);
      const chordLen = magnitude(chord);
      if (chordLen < 1e-6) {
        return {
          type: "line",
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          line: {
            point: { x: start.x, y: start.y },
            direction: { x: 1, y: 0 }
          }
        };
      }
      const R = (Math.pow(chordLen / 2, 2) + seg.sagitta * seg.sagitta) / (2 * Math.abs(seg.sagitta));
      const midChord = scale(add(start, end), 0.5);
      const normal = { x: -chord.y / chordLen, y: chord.x / chordLen };
      const center = add(
        midChord,
        scale(normal, (R - Math.abs(seg.sagitta)) * (seg.sagitta > 0 ? -1 : 1))
      );
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      return {
        type: "arc",
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        arc: {
          center,
          radius: R,
          startAngle,
          endAngle,
          clockwise: seg.sagitta < 0
          // Convention: positive sagitta = CCW? Need to verify
        }
      };
    }
  });
}

// src/vectorize/line_fit.ts
var IncrementalLineFit = class {
  n = 0;
  sumX = 0;
  sumY = 0;
  sumXX = 0;
  sumYY = 0;
  sumXY = 0;
  points = [];
  /**
   * Add a point to the fit
   */
  addPoint(p) {
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
  getCount() {
    return this.n;
  }
  /**
   * Get all points in the fit
   */
  getPoints() {
    return [...this.points];
  }
  /**
   * Get the current fit result
   * Returns null if fewer than 2 points
   */
  getFit() {
    if (this.n < 2) {
      return null;
    }
    const centroid = {
      x: this.sumX / this.n,
      y: this.sumY / this.n
    };
    const covXX = this.sumXX - this.sumX * this.sumX / this.n;
    const covYY = this.sumYY - this.sumY * this.sumY / this.n;
    const covXY = this.sumXY - this.sumX * this.sumY / this.n;
    const trace = covXX + covYY;
    const det = covXX * covYY - covXY * covXY;
    const discriminant = trace * trace - 4 * det;
    if (discriminant < 0 || trace < 1e-10) {
      return null;
    }
    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    let direction;
    if (Math.abs(covXY) > 1e-10) {
      direction = normalize({ x: lambda1 - covYY, y: covXY });
    } else if (covXX > covYY) {
      direction = { x: 1, y: 0 };
    } else {
      direction = { x: 0, y: 1 };
    }
    const line = {
      point: centroid,
      direction
    };
    const errors = this.points.map((p) => {
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      return Math.abs(dx * direction.y - dy * direction.x);
    });
    const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
    const rmsError = Math.sqrt(sumSquaredErrors / errors.length);
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];
    return {
      line,
      rmsError,
      medianError,
      count: this.n,
      errors
    };
  }
  /**
   * Reset the fit to start over
   */
  reset() {
    this.n = 0;
    this.sumX = 0;
    this.sumY = 0;
    this.sumXX = 0;
    this.sumYY = 0;
    this.sumXY = 0;
    this.points = [];
  }
};

// src/vectorize/arc_fit.ts
var IncrementalCircleFit = class {
  n = 0;
  sumX = 0;
  sumY = 0;
  sumXX = 0;
  sumYY = 0;
  sumXY = 0;
  sumXXX = 0;
  sumXXY = 0;
  sumXYY = 0;
  sumYYY = 0;
  points = [];
  /**
   * Add a point to the fit
   */
  addPoint(p) {
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
  getCount() {
    return this.n;
  }
  /**
   * Get all points in the fit
   */
  getPoints() {
    return [...this.points];
  }
  /**
   * Get the current fit result
   * Returns null if fewer than 3 points
   */
  getFit() {
    if (this.n < 3) {
      return null;
    }
    const meanX = this.sumX / this.n;
    const meanY = this.sumY / this.n;
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
    const cx = (Mxz * Myy - Myz * Mxy) / det;
    const cy = (Myz * Mxx - Mxz * Mxy) / det;
    const center = {
      x: cx + meanX,
      y: cy + meanY
    };
    const radiusSquared = cx * cx + cy * cy + (Mxx + Myy);
    if (radiusSquared <= 0) {
      return null;
    }
    const radius = Math.sqrt(radiusSquared);
    const circle = { center, radius };
    const errors = this.points.map(
      (p) => Math.abs(distance(p, center) - radius)
    );
    const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
    const rmsError = Math.sqrt(sumSquaredErrors / errors.length);
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];
    const angles = this.points.map(
      (p) => Math.atan2(p.y - center.y, p.x - center.x)
    );
    const startAngle = angles[0];
    const endAngle = angles[angles.length - 1];
    let totalTurn = 0;
    for (let i = 1; i < angles.length; i++) {
      let delta = angles[i] - angles[i - 1];
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      totalTurn += delta;
    }
    const clockwise = totalTurn < 0;
    const sweepAngle = Math.abs(totalTurn);
    return {
      circle,
      rmsError,
      medianError,
      count: this.n,
      errors,
      startAngle,
      endAngle,
      sweepAngle,
      clockwise
    };
  }
  /**
   * Reset the fit to start over
   */
  reset() {
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
};

// src/vectorize/simplifier.ts
function segmentEdge(points) {
  const segments = [];
  let startIndex = 0;
  const TOLERANCE = 2;
  while (startIndex < points.length - 1) {
    let bestEndIndex = startIndex + 1;
    let bestType = "line";
    let bestLineFit = null;
    let bestArcFit = null;
    const lineFit = new IncrementalLineFit();
    const arcFit = new IncrementalCircleFit();
    lineFit.addPoint(points[startIndex]);
    arcFit.addPoint(points[startIndex]);
    for (let i = startIndex + 1; i < points.length; i++) {
      const p = points[i];
      lineFit.addPoint(p);
      arcFit.addPoint(p);
      const count = i - startIndex + 1;
      let lValid = false;
      let aValid = false;
      let lFit = null;
      let aFit = null;
      if (count >= 2) {
        lFit = lineFit.getFit();
        if (lFit) {
          const maxErr = Math.max(...lFit.errors);
          if (maxErr <= TOLERANCE) lValid = true;
        }
      }
      if (count >= 3) {
        aFit = arcFit.getFit();
        if (aFit) {
          const maxErr = Math.max(...aFit.errors);
          if (maxErr <= TOLERANCE && Math.abs(aFit.sweepAngle) <= Math.PI) {
            aValid = true;
          }
        }
      }
      if (!lValid && !aValid) {
        break;
      }
      bestEndIndex = i;
      if (lValid && aValid) {
        if (aFit.rmsError < lFit.rmsError * 0.8) {
          bestType = "arc";
          bestArcFit = aFit;
          bestLineFit = null;
        } else {
          bestType = "line";
          bestLineFit = lFit;
          bestArcFit = null;
        }
      } else if (lValid) {
        bestType = "line";
        bestLineFit = lFit;
        bestArcFit = null;
      } else {
        bestType = "arc";
        bestArcFit = aFit;
        bestLineFit = null;
      }
    }
    const startP = points[startIndex];
    const endP = points[bestEndIndex];
    if (bestType === "line") {
      if (!bestLineFit) {
        const dx = endP.x - startP.x;
        const dy = endP.y - startP.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        bestLineFit = {
          line: { point: startP, direction: { x: dx / len, y: dy / len } },
          rmsError: 0,
          medianError: 0,
          count: 2,
          errors: [0, 0]
        };
      }
      segments.push({
        type: "line",
        line: bestLineFit.line,
        start: startP,
        end: endP
      });
    } else {
      segments.push({
        type: "arc",
        arc: {
          center: bestArcFit.circle.center,
          radius: bestArcFit.circle.radius,
          startAngle: bestArcFit.startAngle,
          endAngle: bestArcFit.endAngle,
          clockwise: bestArcFit.clockwise
        },
        start: startP,
        end: endP
      });
    }
    startIndex = bestEndIndex;
  }
  return segments;
}
function simplifyGraph(graph, onIteration) {
  const simplifiedEdges = [];
  for (const edge of graph.edges) {
    if (edge.points.length < 2) {
      continue;
    }
    const initialSegments = segmentEdge(edge.points);
    const initial = {
      original: edge,
      segments: initialSegments
    };
    const optimized = optimizeEdge(
      initial,
      initialSegments,
      (nodes, segments, label) => {
        if (onIteration) onIteration(edge.id, nodes, segments, label);
      }
    );
    simplifiedEdges.push(optimized);
  }
  return {
    nodes: graph.nodes,
    edges: simplifiedEdges
  };
}

// browser-app/test_visualizer.ts
function binaryFromAscii(ascii) {
  const lines = ascii.split("\n");
  if (lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  const height = lines.length;
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const img = createBinaryImage(width, height);
  lines.forEach((line, y) => {
    line = line.trimEnd().trimStart();
    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char !== "." && char !== " ") {
        setPixelBin(img, x, y, 1);
      }
    }
  });
  return img;
}
var TEST_CASES = [
  {
    name: "Horizontal Line",
    ascii: `
    ..........
    .#####....
    ..........
    `
  },
  {
    name: "L-Shape (Corner)",
    ascii: `
    #.........
    #.........
    #.........
    #.........
    #.........
    ##########
    `
  },
  {
    name: "Diagonal Line",
    ascii: `
    #.........
    .#........
    ..#.......
    ...#......
    ....#.....
    `
  },
  {
    name: "Circle (Small)",
    ascii: `
    ...###...
    ..#...#..
    .#.....#.
    .#.....#.
    .#.....#.
    ..#...#..
    ...###...
    `
  }
];
function renderTestCase(container, testCase) {
  const div = document.createElement("div");
  div.className = "test-case";
  const h2 = document.createElement("h2");
  h2.textContent = testCase.name;
  div.appendChild(h2);
  const bin = binaryFromAscii(testCase.ascii);
  const graph = traceGraph(bin);
  const history = [];
  const simplified = simplifyGraph(graph, (edgeId, nodes, segments, label) => {
    history.push({ label, nodes, segments });
  });
  const SCALE = 20;
  const canvas = document.createElement("canvas");
  canvas.width = bin.width * SCALE;
  canvas.height = bin.height * SCALE;
  div.appendChild(canvas);
  const controls = document.createElement("div");
  controls.className = "controls";
  div.appendChild(controls);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(Math.max(0, history.length - 1));
  slider.value = String(Math.max(0, history.length - 1));
  slider.style.width = "300px";
  controls.appendChild(slider);
  const labelSpan = document.createElement("span");
  labelSpan.style.marginLeft = "10px";
  labelSpan.style.fontWeight = "bold";
  controls.appendChild(labelSpan);
  const infoDiv = document.createElement("div");
  infoDiv.style.fontFamily = "monospace";
  infoDiv.style.whiteSpace = "pre";
  infoDiv.style.marginTop = "10px";
  div.appendChild(infoDiv);
  const ctx = canvas.getContext("2d");
  function draw(stepIndex) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 1;
    for (let x = 0; x <= bin.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * SCALE, 0);
      ctx.lineTo(x * SCALE, bin.height * SCALE);
      ctx.stroke();
    }
    for (let y = 0; y <= bin.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * SCALE);
      ctx.lineTo(bin.width * SCALE, y * SCALE);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    for (let y = 0; y < bin.height; y++) {
      for (let x = 0; x < bin.width; x++) {
        if (getPixelBin(bin, x, y)) {
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
          ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
          ctx.beginPath();
          ctx.arc((x + 0.5) * SCALE, (y + 0.5) * SCALE, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
        }
      }
    }
    if (history.length === 0) return;
    const step = history[stepIndex];
    labelSpan.textContent = `${stepIndex + 1}/${history.length}: ${step.label}`;
    const segments = convertToSegments(step.nodes, step.segments);
    let info = "";
    segments.forEach((seg, i) => {
      info += `Segment ${i}: ${seg.type.toUpperCase()}
`;
      info += `  Start: (${seg.start.x.toFixed(2)}, ${seg.start.y.toFixed(2)})
`;
      info += `  End:   (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)})
`;
      if (seg.type === "arc") {
        info += `  Radius: ${seg.arc.radius.toFixed(2)}
`;
        info += `  Center: (${seg.arc.center.x.toFixed(2)}, ${seg.arc.center.y.toFixed(2)})
`;
      }
      const optSeg = step.segments[i];
      if (optSeg) {
        info += `  Sagitta: ${optSeg.sagitta.toFixed(4)}
`;
      }
      info += "\n";
    });
    infoDiv.textContent = info;
    const colors = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f1c40f"];
    segments.forEach((seg, i) => {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (seg.type === "line") {
        const startX2 = (seg.start.x + 0.5) * SCALE;
        const startY2 = (seg.start.y + 0.5) * SCALE;
        const endX2 = (seg.end.x + 0.5) * SCALE;
        const endY2 = (seg.end.y + 0.5) * SCALE;
        ctx.moveTo(startX2, startY2);
        ctx.lineTo(endX2, endY2);
      } else {
        const arc = seg.arc;
        const cx = (arc.center.x + 0.5) * SCALE;
        const cy = (arc.center.y + 0.5) * SCALE;
        const r = arc.radius * SCALE;
        ctx.arc(cx, cy, r, arc.startAngle, arc.endAngle, !arc.clockwise);
      }
      ctx.stroke();
      ctx.fillStyle = "black";
      const startX = (seg.start.x + 0.5) * SCALE;
      const startY = (seg.start.y + 0.5) * SCALE;
      const endX = (seg.end.x + 0.5) * SCALE;
      const endY = (seg.end.y + 0.5) * SCALE;
      ctx.beginPath();
      ctx.arc(startX, startY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(endX, endY, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  slider.addEventListener("input", () => {
    draw(parseInt(slider.value));
  });
  if (history.length > 0) {
    draw(history.length - 1);
  }
  container.appendChild(div);
}
function init() {
  const container = document.getElementById("container");
  if (!container) return;
  TEST_CASES.forEach((testCase) => {
    renderTestCase(container, testCase);
  });
}
init();
//# sourceMappingURL=test_visualizer_bundle.js.map
