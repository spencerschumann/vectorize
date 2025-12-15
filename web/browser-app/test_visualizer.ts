import { createBinaryImage, setPixelBin, type BinaryImage, getPixelBin } from "../src/formats/binary.ts";
import { traceGraph } from "../src/vectorize/tracer.ts";
import { simplifyGraph, type Segment } from "../src/vectorize/simplifier.ts";

function binaryFromAscii(ascii: string): BinaryImage {
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

const TEST_CASES = [
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

function renderTestCase(container: HTMLElement, testCase: { name: string, ascii: string }) {
  const div = document.createElement("div");
  div.className = "test-case";
  
  const h2 = document.createElement("h2");
  h2.textContent = testCase.name;
  div.appendChild(h2);

  const bin = binaryFromAscii(testCase.ascii);
  const graph = traceGraph(bin);
  const simplified = simplifyGraph(graph);

  const SCALE = 20;
  const canvas = document.createElement("canvas");
  canvas.width = bin.width * SCALE;
  canvas.height = bin.height * SCALE;
  div.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;

  // 1. Draw Grid
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

  // 2. Draw Pixels
  ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
  for (let y = 0; y < bin.height; y++) {
    for (let x = 0; x < bin.width; x++) {
      if (getPixelBin(bin, x, y)) {
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        
        // Draw center point
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.beginPath();
        ctx.arc((x + 0.5) * SCALE, (y + 0.5) * SCALE, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      }
    }
  }

  // 3. Draw Graph Edges (Raw) - Optional, maybe faint
  /*
  ctx.strokeStyle = "rgba(0, 0, 255, 0.2)";
  ctx.lineWidth = 1;
  for (const edge of graph.edges) {
    ctx.beginPath();
    for (let i = 0; i < edge.points.length; i++) {
      const p = edge.points[i];
      const x = (p.x + 0.5) * SCALE;
      const y = (p.y + 0.5) * SCALE;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  */

  // 4. Draw Simplified Segments
  simplified.edges.forEach((edge, edgeIdx) => {
    // Cycle colors for different edges
    const colors = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f1c40f"];
    ctx.strokeStyle = colors[edgeIdx % colors.length];
    ctx.lineWidth = 3;

    for (const seg of edge.segments) {
      ctx.beginPath();
      if (seg.type === "line") {
        const startX = (seg.start.x + 0.5) * SCALE;
        const startY = (seg.start.y + 0.5) * SCALE;
        const endX = (seg.end.x + 0.5) * SCALE;
        const endY = (seg.end.y + 0.5) * SCALE;
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
      } else {
        const arc = seg.arc;
        const cx = (arc.center.x + 0.5) * SCALE;
        const cy = (arc.center.y + 0.5) * SCALE;
        const r = arc.radius * SCALE;
        
        // Canvas arc takes start/end angles.
        // Need to handle direction carefully.
        ctx.arc(cx, cy, r, arc.startAngle, arc.endAngle, !arc.clockwise);
      }
      ctx.stroke();

      // Draw endpoints
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
    }
  });

  container.appendChild(div);
}

function init() {
  const container = document.getElementById("container");
  if (!container) return;

  TEST_CASES.forEach(testCase => {
    renderTestCase(container, testCase);
  });
}

init();
