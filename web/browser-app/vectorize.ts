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
      if (seg.type === "line") {
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
    const first = edge.segments[0].start;
    const last = edge.segments[edge.segments.length - 1].end;
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
      d += `M ${first.start.x + 0.5} ${first.start.y + 0.5} `;

      for (const seg of path.segments) {
        if (seg.type === "line") {
          d += `L ${seg.end.x + 0.5} ${seg.end.y + 0.5} `;
        } else if (seg.type === "arc") {
          const r = seg.arc.radius;
          const largeArc =
            Math.abs(seg.arc.endAngle - seg.arc.startAngle) > Math.PI ? 1 : 0;
          const sweep = seg.arc.clockwise ? 1 : 0;
          d += `A ${r} ${r} 0 ${largeArc} ${sweep} ${seg.end.x + 0.5} ${
            seg.end.y + 0.5
          } `;
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
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", (seg.start.x + 0.5).toString());
      circle.setAttribute("cy", (seg.start.y + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "blue");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
    // Draw last endpoint
    if (path.segments.length > 0) {
      const last = path.segments[path.segments.length - 1];
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", (last.end.x + 0.5).toString());
      circle.setAttribute("cy", (last.end.y + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "blue");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
  }
}
