from svgpathtools import svg2paths, wsvg, parse_path
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

def point_to_line_distance(point: np.ndarray, line_point: np.ndarray, line_dir: np.ndarray) -> float:
    """Calculate perpendicular distance from a point to a line
    
    Args:
        point: The point to measure from
        line_point: A point on the line
        line_dir: Direction vector of the line (should be normalized)
        
    Returns:
        float: Perpendicular distance from point to line
    """
    # Vector from line_point to point
    v = point - line_point
    # Project v onto line_dir to get the parallel component
    parallel_component = np.dot(v, line_dir) * line_dir
    # Perpendicular component is the remainder
    perpendicular = v - parallel_component
    return np.linalg.norm(perpendicular)

def are_segments_offset(seg1_point: np.ndarray, seg1_dir: np.ndarray, 
                       seg2_point: np.ndarray, offset_tol: float) -> bool:
    """Check if two parallel segments are offset (not on the same line)
    
    Args:
        seg1_point: A point on the first segment
        seg1_dir: Direction vector of first segment (normalized)
        seg2_point: A point on the second segment
        offset_tol: Maximum perpendicular distance to consider segments on same line
        
    Returns:
        bool: True if segments are offset beyond tolerance
    """
    perp_dist = point_to_line_distance(seg2_point, seg1_point, seg1_dir)
    return perp_dist > offset_tol

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

def try_merge_at_endpoint(path: list, idx: int, at_start: bool, segments: list, 
                         active: list, path_index: PathIndex, 
                         merge_dist_tol: float, angle_tol: float) -> tuple:
    """Try to merge a path at one of its endpoints
    
    Args:
        path: The path to try merging
        idx: Index of the path in segments array
        at_start: True to merge at start, False to merge at end
        segments: All segments (will be modified if merge succeeds)
        active: List of active segment indices
        path_index: Spatial index for finding nearby endpoints
        merge_dist_tol: Distance tolerance for merging
        angle_tol: Angle tolerance for collinearity check
        
    Returns:
        tuple: (merged_path or None, matched_index or None)
    """
    # Get the endpoint to search from
    endpoint = tuple(path[0] if at_start else path[-1])
    matches = path_index.find_endpoints_in_radius(endpoint, merge_dist_tol)
    
    for match in matches:
        j = match.path_index
        if j == idx or j not in active or len(segments[j]) < 2:
            continue
            
        seg = segments[j]
        
        # Get direction vectors for both segments
        if at_start:
            dir1 = np.array(path[1]) - np.array(path[0])
            path_points = path[0:2]
            path_point = np.array(path[0])
        else:
            dir1 = np.array(path[-1]) - np.array(path[-2])
            path_points = path[-2:]
            path_point = np.array(path[-1])
        
        if match.is_start:
            dir2 = np.array(seg[1]) - np.array(seg[0])
            seg_points = seg[0:2]
            seg_point = np.array(seg[0])
        else:
            dir2 = np.array(seg[-1]) - np.array(seg[-2])
            seg_points = seg[-2:]
            seg_point = np.array(seg[-1])
        
        # Check if direction vectors are valid
        if np.linalg.norm(dir1) <= 1e-8 or np.linalg.norm(dir2) <= 1e-8:
            continue
            
        # Normalize direction vectors
        dir1 = dir1 / np.linalg.norm(dir1)
        dir2 = dir2 / np.linalg.norm(dir2)
        
        # Check collinearity
        if not are_segments_collinear(path_points, dir1, seg_points, dir2, angle_tol):
            continue
        
        # Check if segments are offset (parallel but not on same line)
        offset_tol = merge_dist_tol * 0.5
        if are_segments_offset(path_point, dir1, seg_point, offset_tol):
            continue  # Skip this merge - segments are parallel but offset
        
        # Perform the merge
        path_index.remove_path(idx)
        path_index.remove_path(j)
        
        if at_start:
            merged_path = merge_paths(seg, path, not match.is_start, False)
        else:
            merged_path = merge_paths(path, seg, False, not match.is_start)
        
        segments[idx] = merged_path
        path_index.insert_path(merged_path, idx)
        
        # Remove j from active
        if j in active:
            active.remove(j)
        
        return merged_path, j
    
    return None, None

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

        merged = False
        i = 0
        while i < len(active):
            idx = active[i]
            path = segments[idx]
            
            # Try to merge at end
            merged_path, _ = try_merge_at_endpoint(
                path, idx, at_start=False, segments=segments, active=active,
                path_index=path_index, merge_dist_tol=merge_dist_tol, angle_tol=angle_tol
            )
            
            if merged_path is not None:
                merged = True
                continue  # Try to merge this path again
            
            # Try to merge at start
            merged_path, _ = try_merge_at_endpoint(
                path, idx, at_start=True, segments=segments, active=active,
                path_index=path_index, merge_dist_tol=merge_dist_tol, angle_tol=angle_tol
            )
            
            if merged_path is not None:
                merged = True
                continue  # Try to merge this path again
            
            i += 1
        
        if not merged:
            break

    # After no more merges are possible, close any paths that should be closed
    to_remove = []
    for idx in list(active):
        path = segments[idx]
        if should_close_path(path, merge_dist_tol, angle_tol):
            closed_path = path + [tuple(path[0])]
            segments[idx] = closed_path
            merged_paths.append(closed_path)
            path_index.remove_path(idx)
            to_remove.append(idx)
    for idx in to_remove:
        if idx in active:
            active.remove(idx)

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

def main(input_svg, output_svg, stroke_color='black', stroke_width=1.0):
    print(f"Processing SVG: {input_svg} -> {output_svg}")
    print(f"Stroke color: {stroke_color}, Stroke width: {stroke_width}")
   
    paths, attrs = svg2paths(input_svg)
    segments = svg_lines_to_segments(paths)
    segments = simplify_segments(segments)
    segments = merge_collinear(segments, merge_dist_tol=d_tol, angle_tol=a_tol)
    # simplify again after merging
    segments = simplify_segments(segments)

    # Build SVG output - convert segments back to path objects (in original pixel units)
    out_paths = []
    path_attributes = []
    for seg in segments:
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
    
    if not out_paths:
        print("Warning: No valid paths found. Creating empty SVG.")
        # Create minimal SVG manually since wsvg requires paths
        import xml.etree.ElementTree as ET
        svg = ET.Element('svg', xmlns="http://www.w3.org/2000/svg")
        tree = ET.ElementTree(svg)
        tree.write(output_svg)
    else:
        wsvg(out_paths, filename=output_svg, attributes=path_attributes)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean SVG lines into simplified paths.")
    parser.add_argument("input_svg", nargs="?", default="input.svg", help="Input SVG file")
    parser.add_argument("output_svg", nargs="?", default="output_clean.svg", help="Output SVG file")
    parser.add_argument("--stroke-color", default="black",
                        help="Stroke color for paths (default: black)")
    parser.add_argument("--stroke-width", type=float, default=1.0,
                        help="Stroke width for paths (default: 1.0)")
    args = parser.parse_args()
    main(args.input_svg, args.output_svg, stroke_color=args.stroke_color, stroke_width=args.stroke_width)
