from svgpathtools import svg2paths, wsvg, parse_path
from svgpathtools import svg2paths2  # type: ignore
from shapely.geometry import LineString, Point
from shapely.ops import linemerge
import numpy as np
import argparse
from path_index import PathIndex

# PARAMETERS
d_tol = 50.0      # max distance for merging endpoints
a_tol = 15       # max angle difference (degrees) for merging collinear segments
simplify_tol = 1.01  # Douglas–Peucker tolerance

def line_angle(a, b):
    v = np.array(b) - np.array(a)
    return np.degrees(np.arctan2(v[1], v[0]))

def simplify_segments(segments):
    simplified = []
    for s in segments:
        ls = LineString(s)
        simp = list(ls.simplify(simplify_tol).coords)
        
        # if closed, see if the endpoint can be simplified out
        is_closed = len(simp) >= 4 and np.allclose(simp[0], simp[-1])
        if is_closed:
            ls = LineString([simp[-2], simp[0], simp[1]])
            ls = list(ls.simplify(simplify_tol).coords)
            if len(ls) == 2:
                # start/end point was removed by simplification - take it out
                simp = simp[1:-1]
                # close the path again
                simp.append(simp[0])
        simplified.append(simp)
    return simplified

def are_segments_collinear(seg1_end: tuple, seg1_dir: tuple, seg2_start: tuple, seg2_dir: tuple, angle_tol: float) -> bool:
    """Check if two segments are collinear at their potential merge point
    
    Args:
        seg1_end: Last two points of first segment if connecting at its end, or first two points if at start
        seg1_dir: Direction vector of first segment at connection point
        seg2_start: First two points of second segment if connecting at its start, or last two points if at end
        seg2_dir: Direction vector of second segment at connection point
        angle_tol: Maximum angle difference in degrees to consider collinear
        
    Returns:
        bool: True if segments are collinear within tolerance
    """
    # Compute angle between direction vectors
    dot = np.dot(seg1_dir, seg2_dir)
    angle = np.degrees(np.arccos(np.clip(abs(dot), -1.0, 1.0)))
    
    # Check if vectors are aligned (parallel or anti-parallel)
    return angle < angle_tol or abs(180 - angle) < angle_tol

def merge_paths(path1: list, path2: list, reverse1: bool, reverse2: bool) -> list:
    """Merge two paths with given orientations, handling duplicates at merge point
    
    Args:
        path1: First path to merge
        path2: Second path to merge
        reverse1: Whether to reverse first path
        reverse2: Whether to reverse second path
        
    Returns:
        list: Merged path with no duplicated points at junction
    """
    # Reverse paths if needed
    p1 = list(reversed(path1)) if reverse1 else list(path1)
    p2 = list(reversed(path2)) if reverse2 else list(path2)

    # Avoid duplicate at merge point
    if np.allclose(p1[-1], p2[0]):
        merged = p1 + p2[1:]
    else:
        merged = p1 + p2

    # Return merged path (no need for extra duplicate filtering)
    return merged

def should_close_path(path: list, merge_dist_tol: float, angle_tol: float = 10.0) -> bool:
    """Determine if a path should be closed based on endpoint proximity and collinearity
    
    Args:
        path: Path to check
        merge_dist_tol: Maximum distance between endpoints to consider closing
        angle_tol: Maximum angle difference to consider segments collinear
        
    Returns:
        bool: True if path should be closed
    """
    if len(path) < 3:  # Need at least 3 points for a closed path
        return False
        
    # Convert to numpy for consistent handling
    path_np = np.array(path)
    
    # Already closed (exactly or approximately)?
    if np.allclose(path_np[0], path_np[-1]):
        return False
        
    # Check endpoint distance
    start = path_np[0]
    end = path_np[-1]
    dist = np.linalg.norm(end - start)
    if dist > merge_dist_tol:
        return False
        
    # Check segment directions at endpoints
    try:
        start_segment = path_np[1] - start
        end_segment = path_np[-1] - path_np[-2]
        
        # Skip if segments are too small
        if (np.linalg.norm(start_segment) < 1e-6 or
            np.linalg.norm(end_segment) < 1e-6):
            return False
            
        # Normalize direction vectors
        start_dir = start_segment / np.linalg.norm(start_segment)
        end_dir = end_segment / np.linalg.norm(end_segment)
        
        # Check if segments would form a clean connection
        # We want them to point toward each other, so reverse end_dir
        dot = np.dot(start_dir, -end_dir)
        angle = np.degrees(np.arccos(np.clip(abs(dot), -1.0, 1.0)))
        
        return angle < angle_tol
        
    except (IndexError, ZeroDivisionError):
        return False

def merge_collinear(segments: list, merge_dist_tol: float = 1.0, angle_tol: float = 10.0) -> list:
    """Merge collinear segments that have endpoints within merge_dist_tol distance.
    
    Args:
        segments: List of line segments, each a list of points
    """
    merged_paths = []
    if not segments:
        return merged_paths

    n = len(segments)
    used = [False] * n
    path_index = PathIndex(segments)
    active = [i for i in range(n) if len(segments[i]) >= 2]

    while active:
        # Check for self-closing paths in active, move them to merged_paths
        to_remove = []
        for idx in active:
            path = segments[idx]
            if should_close_path(path, merge_dist_tol, angle_tol):
                # Close the path by adding a copy of the exact start point
                closed_path = path + [tuple(path[0])]
                segments[idx] = closed_path
                merged_paths.append(closed_path)
                path_index.remove_path(idx)
                to_remove.append(idx)
        # Remove by value, not by position
        for idx in to_remove:
            if idx in active:
                active.remove(idx)
        if not active:
            break

        merged = False
        i = 0
        while i < len(active):
            idx = active[i]  # idx is always the original segment index
            path = segments[idx]
            # Try to merge at end
            end = tuple(path[-1])
            matches = path_index.find_endpoints_in_radius(end, merge_dist_tol)
            merged_this_path = False
            for match in matches:
                j = match.path_index  # j is also an original segment index
                if j == idx or j not in active or len(segments[j]) < 2:
                    continue
                seg = segments[j]
                if match.is_start:
                    dir2 = np.array(seg[1]) - np.array(seg[0])
                else:
                    dir2 = np.array(seg[-1]) - np.array(seg[-2])
                dir1 = np.array(path[-1]) - np.array(path[-2])
                if np.linalg.norm(dir1) > 1e-8 and np.linalg.norm(dir2) > 1e-8:
                    dir1 = dir1 / np.linalg.norm(dir1)
                    dir2 = dir2 / np.linalg.norm(dir2)
                    if are_segments_collinear(path[-2:], dir1,
                                            seg[0:2] if match.is_start else seg[-2:],
                                            dir2, angle_tol):
                        path_index.remove_path(idx)
                        path_index.remove_path(j)
                        path = merge_paths(path, seg, False, not match.is_start)
                        segments[idx] = path
                        path_index.insert_path(path, idx)
                        # Remove j from active by value, not by position
                        if j in active:
                            active.remove(j)
                        merged = True
                        merged_this_path = True
                        break
            if merged_this_path:
                continue  # Try to merge this path again
            # Try to merge at start
            start = tuple(path[0])
            matches = path_index.find_endpoints_in_radius(start, merge_dist_tol)
            for match in matches:
                j = match.path_index
                if j == idx or j not in active or len(segments[j]) < 2:
                    continue
                seg = segments[j]
                if match.is_start:
                    dir2 = np.array(seg[1]) - np.array(seg[0])
                else:
                    dir2 = np.array(seg[-1]) - np.array(seg[-2])
                dir1 = np.array(path[1]) - np.array(path[0])
                if np.linalg.norm(dir1) > 1e-8 and np.linalg.norm(dir2) > 1e-8:
                    dir1 = dir1 / np.linalg.norm(dir1)
                    dir2 = dir2 / np.linalg.norm(dir2)
                    if are_segments_collinear(path[0:2], dir1,
                                            seg[0:2] if match.is_start else seg[-2:],
                                            dir2, angle_tol):
                        path_index.remove_path(idx)
                        path_index.remove_path(j)
                        path = merge_paths(seg, path, not match.is_start, False)
                        segments[idx] = path
                        path_index.insert_path(path, idx)
                        if j in active:
                            active.remove(j)
                        merged = True
                        merged_this_path = True
                        break
            if merged_this_path:
                continue  # Try to merge this path again
            i += 1
        if not merged:
            break

    # Add any remaining open paths
    for idx in active:
        merged_paths.append(segments[idx])
    return merged_paths

def svg_lines_to_segments(paths):
    segments = []
    for path in paths:
        # Extract points from each segment and handle line commands properly
        current_points = []
        
        for seg in path:
            start_point = (seg.start.real, seg.start.imag)
            
            # If this is a line segment and we have a current sequence
            if hasattr(seg, 'end') and current_points:
                # Check if this is a continuation of the current path
                if current_points[-1] == start_point:
                    current_points.append((seg.end.real, seg.end.imag))
                else:
                    # This is a new subpath - save the previous one and start new
                    if len(current_points) > 1:
                        segments.append(current_points)
                    current_points = [start_point, (seg.end.real, seg.end.imag)]
            else:
                # This is the first segment or a move command
                if current_points and len(current_points) > 1:
                    segments.append(current_points)
                current_points = [start_point, (seg.end.real, seg.end.imag)]
        
        # Add the last segment if it has more than one point
        if len(current_points) > 1:
            segments.append(current_points)
    
    return segments

def main(input_svg, output_svg, scale_to_mm=False, source_dpi=200.0, stroke_color='black', stroke_width=1.0):
    print(f"Processing SVG: {input_svg} -> {output_svg}")
    print(f"Scale to mm: {scale_to_mm}, Source DPI: {source_dpi}")
    print(f"Stroke color: {stroke_color}, Stroke width: {stroke_width}")
   
    root_svg_attrs = {}
    paths, attrs, root_svg_attrs = svg2paths2(input_svg)
    segments = svg_lines_to_segments(paths)
    segments = simplify_segments(segments)
    segments = merge_collinear(segments, merge_dist_tol=d_tol, angle_tol=a_tol)
    # simplify again after merging
    segments = simplify_segments(segments)

    # Build SVG output - convert segments back to path objects
    # Optionally scale all coordinates from source units (e.g., 200 dpi) to millimeters
    mm_per_inch = 25.4
    scale = (mm_per_inch / source_dpi) if scale_to_mm else 1.0

    scaled_segments = []
    for seg in segments:
        scaled = [(p[0] * scale, p[1] * scale) for p in seg]
        scaled_segments.append(scaled)

    # Prefer using the source SVG's viewBox/width/height from svg2paths2, scaled to mm if requested.
    viewbox_tuple = None
    width_attr = None
    height_attr = None

    def parse_len_to_mm(val: str):
        if val is None:
            return None
        s = str(val).strip()
        try:
            if s.endswith('mm'):
                return float(s[:-2])
            if s.endswith('cm'):
                return float(s[:-2]) * 10.0
            if s.endswith('in'):
                return float(s[:-2]) * mm_per_inch
            if s.endswith('pt'):
                return float(s[:-2]) * (mm_per_inch / 72.0)
            if s.endswith('px'):
                return float(s[:-2]) * scale
            # unitless -> assume px
            return float(s) * scale
        except Exception:
            return None

    vb_attr = None
    if isinstance(root_svg_attrs, dict):
        vb_attr = root_svg_attrs.get('viewBox') or root_svg_attrs.get('viewbox')
        w_attr = root_svg_attrs.get('width')
        h_attr = root_svg_attrs.get('height')
        
        # Only convert width/height to mm if scaling is requested
        if scale_to_mm:
            w_from_attr = parse_len_to_mm(w_attr) if w_attr is not None else None
            h_from_attr = parse_len_to_mm(h_attr) if h_attr is not None else None
            if w_from_attr is not None:
                width_attr = w_from_attr
            if h_from_attr is not None:
                height_attr = h_from_attr
        else:
            # Preserve original width/height attributes
            if w_attr is not None:
                width_attr = w_attr
            if h_attr is not None:
                height_attr = h_attr

        if vb_attr:
            parts = vb_attr.replace(',', ' ').split()
            if len(parts) == 4:
                try:
                    min_x_px, min_y_px, w_px, h_px = [float(p) for p in parts]
                    min_x = min_x_px * scale
                    min_y = min_y_px * scale
                    vw = max(1e-3, w_px * scale)
                    vh = max(1e-3, h_px * scale)
                    viewbox_tuple = (min_x, min_y, vw, vh)
                except Exception:
                    viewbox_tuple = None

    out_paths = []
    path_attributes = []
    for seg in scaled_segments:
        if len(seg) < 2:
            continue  # Skip segments with less than 2 points
            
        # Create path data string
        path_data = 'M ' + f"{seg[0][0]},{seg[0][1]}"
        for point in seg[1:]:
            path_data += f" L {point[0]},{point[1]}"
        
        try:
            # Convert the path string back to a path object
            path_obj = parse_path(path_data)
            out_paths.append(path_obj)
            # Collect stroke attributes for this path
            path_attributes.append({
                'stroke': stroke_color,
                'stroke-width': str(stroke_width),
                'fill': 'none'
            })
        except Exception as e:
            print(f"Warning: Could not parse path {path_data}: {e}")
            continue
    
    # If no valid paths were created, create a minimal SVG
    svg_attrs = {}
    if scale_to_mm:
        # When scaling to mm, set width/height with mm units
        w = width_attr if width_attr is not None else 1.0
        h = height_attr if height_attr is not None else 1.0
        svg_attrs['width'] = f"{w}mm"
        svg_attrs['height'] = f"{h}mm"
    else:
        # Preserve original width/height attributes if present
        if width_attr is not None:
            svg_attrs['width'] = width_attr
        if height_attr is not None:
            svg_attrs['height'] = height_attr
    
    # Only include viewBox if the source had one
    if viewbox_tuple is not None:
        svg_attrs['viewBox'] = f"{viewbox_tuple[0]} {viewbox_tuple[1]} {viewbox_tuple[2]} {viewbox_tuple[3]}"
    
    if not out_paths:
        print("Warning: No valid paths found. Creating empty SVG.")
        # Create minimal SVG manually since wsvg requires paths
        import xml.etree.ElementTree as ET
        svg = ET.Element('svg', svg_attrs if svg_attrs else {})
        if viewbox_tuple:
            svg.set('viewBox', f"{viewbox_tuple[0]} {viewbox_tuple[1]} {viewbox_tuple[2]} {viewbox_tuple[3]}")
        tree = ET.ElementTree(svg)
        tree.write(output_svg)
    else:
        wsvg(out_paths, filename=output_svg, attributes=path_attributes, svg_attributes=svg_attrs if svg_attrs else None,
             viewbox=viewbox_tuple if viewbox_tuple is not None else None)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean SVG lines into simplified paths.")
    parser.add_argument("input_svg", nargs="?", default="input.svg", help="Input SVG file")
    parser.add_argument("output_svg", nargs="?", default="output_clean.svg", help="Output SVG file")
    parser.add_argument("--scale-to-mm", action="store_true", 
                        help="Scale coordinates to millimeters (assumes 200 dpi input)")
    parser.add_argument("--source-dpi", type=float, default=200.0,
                        help="Source DPI for scaling (default: 200.0)")
    parser.add_argument("--stroke-color", default="black",
                        help="Stroke color for paths (default: black)")
    parser.add_argument("--stroke-width", type=float, default=1.0,
                        help="Stroke width for paths (default: 1.0)")
    args = parser.parse_args()
    main(args.input_svg, args.output_svg, scale_to_mm=args.scale_to_mm, source_dpi=args.source_dpi,
         stroke_color=args.stroke_color, stroke_width=args.stroke_width)
