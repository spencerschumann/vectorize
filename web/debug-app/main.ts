/**
 * Debug UI (standalone) using SVG overlays.
 * Build: deno task build:debug-app
 * Then open debug-app/index.html in a browser.
 */

import { TEST_CASES } from "../src/vectorize/cases.ts";
import { buildStrokesFromCanvas } from "../src/vectorize/test_pipeline_core.ts";
import { globalFit } from "../src/vectorize/global_fitter.ts";
import { BUILD_INFO } from "./build-info.ts";
import type { BinaryImage } from "../src/formats/binary.ts";
import type { Primitive } from "../src/vectorize/global_fitter.ts";
import type { Point } from "../src/vectorize/geometry.ts";

interface RenderData {
  width: number;
  height: number;
  binary?: BinaryImage;
  skeleton?: BinaryImage;
  rawPixels?: Point[];
  dpPath?: Point[];
  primitives?: Primitive[];
}

const viewer = document.getElementById("viewer")!;
const info = document.getElementById("info")!;
const detail = document.getElementById("detail")! as HTMLPreElement;
const buildInfoEl = document.getElementById("build-info")!;
const caseSelect = document.getElementById("case-select") as HTMLSelectElement;
const runBtn = document.getElementById("run-btn")!;
const zoomSlider = document.getElementById("zoom-slider") as HTMLInputElement;
const zoomValue = document.getElementById("zoom-value")!;
const toggleInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("#toggles input[type=checkbox]"),
);

let currentZoom = parseFloat(zoomSlider.value) || 10;

const layerVisibility = {
  binary: true,
  skeleton: true,
  raw: true,
  dp: true,
  prims: true,
};

let lastRenderData: RenderData | null = null;

function populateCases() {
  for (const c of TEST_CASES.filter((c) => c.browserSupported !== false)) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    caseSelect.appendChild(opt);
  }
}

function binaryRects(img: BinaryImage, color: string) {
  const rects: string[] = [];
  const bytes = img.data;
  const width = img.width;
  const margin = 0.1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const byteIndex = idx >> 3;
      const bitIndex = 7 - (idx & 7);
      if ((bytes[byteIndex] >> bitIndex) & 1) {
        rects.push(`<rect x="${x+margin}" y="${y+margin}" width="${1-2*margin}" height="${1-2*margin}" fill="${color}" pointer-events="all" />`);
      }
    }
  }
  return rects.join("");
}

function polyline(points: Point[], color: string, width = 1.5, extraAttrs = "") {
  const pts = points.map((p) => `${p.x},${p.y}`).join(" ");
  return `<polyline fill="none" stroke="${color}" stroke-width="${width}" points="${pts}" pointer-events="stroke" ${extraAttrs} />`;
}

function primitivesToSvg(prims: Primitive[], colorLine: string, colorArc: string, width = 2) {
  const parts: string[] = [];
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    if (p.type === "line") {
      parts.push(`<line x1="${p.p0.x}" y1="${p.p0.y}" x2="${p.p1.x}" y2="${p.p1.y}" stroke="${colorLine}" stroke-width="${width}" pointer-events="stroke" data-kind="prim" data-type="line" data-index="${i}" data-p0="${p.p0.x},${p.p0.y}" data-p1="${p.p1.x},${p.p1.y}" />`);
    } else {
      // Approximate arc via polyline samples
      const samples = Math.max(8, Math.ceil(Math.abs(p.endAngle - p.startAngle) * p.r / 3));
      const pts: Point[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const angle = p.startAngle + t * (p.endAngle - p.startAngle);
        pts.push({ x: p.cx + p.r * Math.cos(angle), y: p.cy + p.r * Math.sin(angle) });
      }
      const ptsStr = pts.map((pt) => `${pt.x},${pt.y}`).join(" ");
      parts.push(`<polyline fill="none" stroke="${colorArc}" stroke-width="${width}" points="${ptsStr}" pointer-events="stroke" data-kind="prim" data-type="arc" data-index="${i}" data-center="${p.cx},${p.cy}" data-r="${p.r}" data-angles="${p.startAngle},${p.endAngle}" />`);
    }
  }
  return parts.join("");
}

function renderSvg(data: RenderData) {
  const { width, height, binary, skeleton, rawPixels, dpPath, primitives } = data;
  const layers: string[] = [];
  if (binary && layerVisibility.binary) layers.push(binaryRects(binary, "#000"));
  if (skeleton && layerVisibility.skeleton) layers.push(binaryRects(skeleton, "#0ff"));
  if (rawPixels && layerVisibility.raw) {
    const dots = rawPixels.map((p) => `<rect x="${p.x}" y="${p.y}" width="1" height="1" fill="#f88" opacity="0.6" data-kind="raw" data-x="${p.x}" data-y="${p.y}" pointer-events="all" />`).join("");
    layers.push(dots);
  }
  if (dpPath && dpPath.length > 1 && layerVisibility.dp) layers.push(polyline(dpPath, "#f90", 1.5, `data-kind="dp" data-points="${dpPath.length}"`));
  if (primitives && layerVisibility.prims) layers.push(primitivesToSvg(primitives, "#0c0", "#f0f", 2));

  const scaledWidth = width * currentZoom;
  const scaledHeight = height * currentZoom;

  return `<svg width="${scaledWidth}" height="${scaledHeight}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${layers.join("")}</svg>`;
}

async function runSelectedCase() {
  const name = caseSelect.value;
  const tc = TEST_CASES.find((c) => c.name === name);
  if (!tc) return;
  const t0 = performance.now();
  const { strokes, skeleton, binary } = buildStrokesFromCanvas(
    tc.width,
    tc.height,
    tc.draw,
    tc.pipeline,
  );
  const stroke = strokes[0];
  const fit = globalFit(stroke, tc.fit);
  const t1 = performance.now();

  lastRenderData = {
    width: tc.width,
    height: tc.height,
    binary,
    skeleton,
    rawPixels: stroke.rawPixels,
    dpPath: stroke.dpPoints,
    primitives: fit.primitives,
  };

  info.textContent = `${tc.name} – ${fit.primitives.length} prims, DP ${stroke.dpPoints.length} pts, ${(t1 - t0).toFixed(1)} ms`;
  redraw();
}

function wireToggles() {
  for (const input of toggleInputs) {
    input.addEventListener("change", () => {
      const key = input.dataset.layer as keyof typeof layerVisibility;
      layerVisibility[key] = input.checked;
      runSelectedCase();
    });
  }
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function setZoom(z: number, anchor?: { x: number; y: number }) {
  const max = parseFloat(zoomSlider.max) || 20;
  const min = parseFloat(zoomSlider.min) || 1;
  const newZoom = clamp(z, min, max);
  currentZoom = newZoom;
  zoomSlider.value = `${currentZoom}`;
  zoomValue.textContent = `${currentZoom}x`;
  redraw();
}

function attachSvgHandlers(svg: SVGSVGElement) {
  svg.addEventListener("click", (e) => {
    console.log("Click event fired on SVG");
    const target = (e.target as HTMLElement).closest("[data-kind]") as HTMLElement | null;
    console.log("Target after closest:", target, "e.target:", e.target);
    if (target) console.log("Target data-kind:", target.dataset.kind);
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const docX = vb.x + ((e.clientX - rect.left) * vb.width) / rect.width;
    const docY = vb.y + ((e.clientY - rect.top) * vb.height) / rect.height;
    console.log("docX:", docX, "docY:", docY);
    if (!target) {
      console.log("No target, showing position");
      detail.textContent = `Position: (${docX.toFixed(2)}, ${docY.toFixed(2)})`;
      return;
    }
    const kind = target.dataset.kind;
    console.log("Kind:", kind);
    if (kind === "raw") {
      detail.textContent = `Raw pixel @ (${target.dataset.x}, ${target.dataset.y})\nCursor: (${docX.toFixed(2)}, ${docY.toFixed(2)})`;
    } else if (kind === "dp") {
      detail.textContent = `DP path (${target.dataset.points} points)\nCursor: (${docX.toFixed(2)}, ${docY.toFixed(2)})`;
    } else if (kind === "prim") {
      const type = target.dataset.type;
      if (type === "line") {
        detail.textContent = `Primitive #${target.dataset.index} line\np0=${target.dataset.p0}\np1=${target.dataset.p1}\nCursor: (${docX.toFixed(2)}, ${docY.toFixed(2)})`;
      } else {
        detail.textContent = `Primitive #${target.dataset.index} arc\ncenter=${target.dataset.center}\nr=${target.dataset.r}\nangles=${target.dataset.angles}\nCursor: (${docX.toFixed(2)}, ${docY.toFixed(2)})`;
      }
    } else {
      console.log("Unknown kind, showing position");
      detail.textContent = `Position: (${docX.toFixed(2)}, ${docY.toFixed(2)})`;
    }
  });

  // Let native scrolling work for wheel events (no preventDefault here)
}

function redraw() {
  if (!lastRenderData) return;
  console.log("Redraw called, rendering SVG...");
  const svg = renderSvg(lastRenderData);
  viewer.innerHTML = svg;
  const svgEl = viewer.querySelector("svg");
  console.log("SVG element found:", svgEl);
  if (svgEl) {
    console.log("Attaching handlers to SVG");
    attachSvgHandlers(svgEl as SVGSVGElement);
  }
}

const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDist = 0;

function updatePointer(e: PointerEvent) {
  const svg = viewer.querySelector("svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const vb = (svg as SVGSVGElement).viewBox.baseVal;
  const x = vb.x + ((e.clientX - rect.left) * vb.width) / rect.width;
  const y = vb.y + ((e.clientY - rect.top) * vb.height) / rect.height;
  return { x, y, screenX: e.clientX, screenY: e.clientY } as { x: number; y: number; screenX: number; screenY: number };
}

// pointerdown event handling is preventing clicks on SVG elements - disable for now
false && viewer.addEventListener("pointerdown", (e) => {
  const svg = viewer.querySelector("svg");
  if (!svg) return;
  viewer.setPointerCapture(e.pointerId);
  const pos = updatePointer(e);
  if (!pos) return;
  activePointers.set(e.pointerId, pos);
});

viewer.addEventListener("pointermove", (e) => {
  const svg = viewer.querySelector("svg");
  if (!svg) return;
  const pos = updatePointer(e);
  if (pos) activePointers.set(e.pointerId, pos);

  if (activePointers.size >= 2) {
    const pts = Array.from(activePointers.values());
    const dx = pts[0].screenX - pts[1].screenX;
    const dy = pts[0].screenY - pts[1].screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastPinchDist > 0) {
      const factor = dist / lastPinchDist;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      setZoom(currentZoom * factor, mid);
    }
    lastPinchDist = dist;
    return;
  }

});

// pointerup event handling is preventing clicks on SVG elements - disable for now
false && viewer.addEventListener("pointerup", (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) lastPinchDist = 0;
  viewer.releasePointerCapture(e.pointerId);
});

zoomSlider.addEventListener("input", () => {
  setZoom(parseFloat(zoomSlider.value));
});

caseSelect.addEventListener("change", () => runSelectedCase());

populateCases();
wireToggles();
runBtn.addEventListener("click", () => runSelectedCase());
runSelectedCase();

// Display build timestamp
buildInfoEl.textContent = `Built: ${new Date(BUILD_INFO.timestamp).toLocaleString()}`;
console.log("Build timestamp:", BUILD_INFO.timestamp);
