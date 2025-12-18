/**
 * Vectorization module - converts skeletonized binary images to vector paths
 */

import type { BinaryImage } from "../src/formats/binary.ts";
import { traceGraph } from "../src/vectorize/tracer.ts";
import { type Segment, simplifyGraph } from "../src/vectorize/simplifier.ts";

export interface SimplifiedPath {
  points: Array<{ x: number; y: number }>; // Just coordinates after simplification
  closed: boolean;
  segments: Segment[]; // Segment information for rendering arcs
}

export interface VectorizedImage {
  width: number;
  height: number;
  paths: SimplifiedPath[]; // Use SimplifiedPath after vectorization
}

/**
 * Convert a skeletonized binary image to vertices and connected paths
 * Single-pass algorithm that traces complete paths
 */
export function vectorizeSkeleton(binary: BinaryImage): VectorizedImage {
  const graph = traceGraph(binary);
  const simplified = simplifyGraph(graph);

  const paths: SimplifiedPath[] = simplified.edges.map((edge, index) => {
    console.log(`Path ${index}: ${edge.segments.length} segments`);
    edge.segments.forEach((seg, segIndex) => {
      if (seg.type === "circle") {
        console.log(
          `  [${segIndex}] CIRCLE: center=(${seg.circle.center.x.toFixed(2)}, ${
            seg.circle.center.y.toFixed(2)
          }) r=${seg.circle.radius.toFixed(2)}`,
        );
      } else if (seg.type === "line") {
        console.log(
          `  [${segIndex}] LINE: (${seg.start.x.toFixed(2)}, ${
            seg.start.y.toFixed(2)
          }) -> (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)})`,
        );
      } else {
        console.log(
          `  [${segIndex}] ARC: (${seg.start.x.toFixed(2)}, ${
            seg.start.y.toFixed(2)
          }) -> (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)}) R=${
            seg.arc.radius.toFixed(2)
          } CW=${seg.arc.clockwise}`,
        );
      }
    });

    // Collect all points from segments for the 'points' property
    const allPoints: Array<{ x: number; y: number }> = [];
    for (const seg of edge.segments) {
      allPoints.push(...seg.points);
    }

    // Determine if closed
    const firstSeg = edge.segments[0];
    const lastSeg = edge.segments[edge.segments.length - 1];
    const first = firstSeg.type === "circle"
      ? firstSeg.circle.center
      : firstSeg.start;
    const last = lastSeg.type === "circle"
      ? lastSeg.circle.center
      : lastSeg.end;
    const closed = Math.abs(first.x - last.x) < 1e-4 &&
      Math.abs(first.y - last.y) < 1e-4;

    return {
      points: allPoints,
      closed,
      segments: edge.segments,
    };
  });

  return {
    width: binary.width,
    height: binary.height,
    paths,
  };
}

export function renderVectorizedToSVG(
  image: VectorizedImage,
  svgElement: SVGElement,
  width?: number,
  height?: number,
) {
  // Clear existing content
  while (svgElement.firstChild) {
    svgElement.removeChild(svgElement.firstChild);
  }

  if (width && height) {
    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  } else {
    svgElement.setAttribute(
      "viewBox",
      `0 0 ${image.width} ${image.height}`,
    );
  }

  for (const path of image.paths) {
    // Draw segments
    let d = "";
    if (path.segments && path.segments.length > 0) {
      const first = path.segments[0];
      const firstX = first.type === "circle"
        ? first.circle.center.x + first.circle.radius
        : first.start.x;
      const firstY = first.type === "circle"
        ? first.circle.center.y
        : first.start.y;
      d += `M ${firstX + 0.5} ${firstY + 0.5} `;

      for (const seg of path.segments) {
        if (seg.type === "line") {
          d += `L ${seg.end.x + 0.5} ${seg.end.y + 0.5} `;
        } else if (seg.type === "circle") {
          // For a circle segment, render as two 180° arcs
          const r = seg.circle.radius;
          const cx = seg.circle.center.x;
          const cy = seg.circle.center.y;
          // Start from rightmost point (cx + r, cy)
          const midX = cx - r; // leftmost point
          const midY = cy;
          // First semicircle to left
          d += `A ${r} ${r} 0 1 0 ${midX + 0.5} ${midY + 0.5} `;
          // Second semicircle back to right
          d += `A ${r} ${r} 0 1 0 ${(cx + r) + 0.5} ${cy + 0.5} `;
        } else if (seg.type === "arc") {
          const r = seg.arc.radius;
          const isFullCircle = Math.abs(seg.start.x - seg.end.x) < 1e-4 &&
            Math.abs(seg.start.y - seg.end.y) < 1e-4;

          if (isFullCircle) {
            // For a full circle, split into two 180° arcs
            // First arc: start -> opposite point
            const angle = seg.arc.startAngle;
            const midAngle = angle + (seg.arc.clockwise ? -Math.PI : Math.PI);
            const midX = seg.arc.center.x + r * Math.cos(midAngle);
            const midY = seg.arc.center.y + r * Math.sin(midAngle);

            // First semicircle (large arc)
            d += `A ${r} ${r} 0 1 ${seg.arc.clockwise ? 1 : 0} ${midX + 0.5} ${
              midY + 0.5
            } `;
            // Second semicircle (large arc) back to start
            d += `A ${r} ${r} 0 1 ${seg.arc.clockwise ? 1 : 0} ${
              seg.start.x + 0.5
            } ${seg.start.y + 0.5} `;
          } else {
            // Regular arc
            const largeArc =
              Math.abs(seg.arc.endAngle - seg.arc.startAngle) > Math.PI ? 1 : 0;
            const sweep = seg.arc.clockwise ? 1 : 0;
            d += `A ${r} ${r} 0 ${largeArc} ${sweep} ${seg.end.x + 0.5} ${
              seg.end.y + 0.5
            } `;
          }
        }
      }
      if (path.closed) {
        d += "Z";
      }
    } else {
      // Fallback to points if no segments (shouldn't happen with new simplifier)
      if (path.points.length > 0) {
        d += `M ${path.points[0].x + 0.5} ${path.points[0].y + 0.5} `;
        for (let i = 1; i < path.points.length; i++) {
          d += `L ${path.points[i].x + 0.5} ${path.points[i].y + 0.5} `;
        }
        if (path.closed) d += "Z";
      }
    }

    // Create path element
    const pathEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", "red");
    pathEl.setAttribute("stroke-width", "1");
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    svgElement.appendChild(pathEl);

    // Draw vertices (endpoints of segments)
    for (const seg of path.segments) {
      const sx = seg.type === "circle" ? seg.circle.center.x : seg.start.x;
      const sy = seg.type === "circle" ? seg.circle.center.y : seg.start.y;
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", (sx + 0.5).toString());
      circle.setAttribute("cy", (sy + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "blue");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
    // Draw last endpoint
    if (path.segments.length > 0) {
      const last = path.segments[path.segments.length - 1];
      const ex = last.type === "circle" ? last.circle.center.x : last.end.x;
      const ey = last.type === "circle" ? last.circle.center.y : last.end.y;
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", (ex + 0.5).toString());
      circle.setAttribute("cy", (ey + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "blue");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
  }
}
