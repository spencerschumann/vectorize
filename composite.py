from svgpathtools import svg2paths, wsvg, parse_path
try:
    from svgpathtools import svg2paths2  # type: ignore
except Exception:
    svg2paths2 = None
import numpy as np
import argparse
from typing import List, Tuple, Optional, Dict

def parse_len_to_px(val: str, scale: float = 1.0, mm_per_inch: float = 25.4) -> Optional[float]:
    """Parse a length value with units to pixels
    
    Args:
        val: String value with optional units (mm, cm, in, pt, px, or unitless)
        scale: Scale factor to apply (for converting to target units)
        mm_per_inch: Millimeters per inch conversion factor
        
    Returns:
        Float value in pixels, or None if parsing fails
    """
    if val is None:
        return None
    s = str(val).strip()
    try:
        if s.endswith('mm'):
            return float(s[:-2]) / scale if scale != 0 else float(s[:-2])
        if s.endswith('cm'):
            return (float(s[:-2]) * 10.0) / scale if scale != 0 else float(s[:-2]) * 10.0
        if s.endswith('in'):
            return (float(s[:-2]) * mm_per_inch) / scale if scale != 0 else float(s[:-2]) * mm_per_inch
        if s.endswith('pt'):
            return (float(s[:-2]) * (mm_per_inch / 72.0)) / scale if scale != 0 else float(s[:-2]) * (mm_per_inch / 72.0)
        if s.endswith('px'):
            return float(s[:-2])
        # unitless -> assume px
        return float(s)
    except Exception:
        return None

def load_svg_with_metadata(svg_path: str) -> Tuple[List, List, Dict]:
    """Load SVG file and extract paths and root attributes
    
    Args:
        svg_path: Path to SVG file
        
    Returns:
        Tuple of (paths, path_attributes, root_svg_attrs)
    """
    root_svg_attrs = {}
    if svg2paths2 is not None:
        try:
            paths, attrs, root_svg_attrs = svg2paths2(svg_path)
            return paths, attrs, root_svg_attrs
        except Exception:
            pass
    
    # Fallback to svg2paths
    paths, attrs = svg2paths(svg_path)
    return paths, attrs, {}

def composite_svgs(input_svgs: List[str], output_svg: str, scale_to_mm: bool = False, 
                   source_dpi: float = 200.0):
    """Composite multiple SVG files into a single output SVG
    
    Args:
        input_svgs: List of input SVG file paths
        output_svg: Output SVG file path
        scale_to_mm: Whether to scale coordinates to millimeters
        source_dpi: Source DPI for scaling (default: 200.0)
    """
    print(f"Compositing {len(input_svgs)} SVG files -> {output_svg}")
    print(f"Scale to mm: {scale_to_mm}, Source DPI: {source_dpi}")
    
    mm_per_inch = 25.4
    scale = (mm_per_inch / source_dpi) if scale_to_mm else 1.0
    
    all_paths = []
    all_attrs = []
    
    # Determine output viewBox from first input (or compute from all paths)
    viewbox_tuple = None
    width_attr = None
    height_attr = None
    
    for idx, svg_file in enumerate(input_svgs):
        print(f"  Loading {svg_file}...")
        paths, attrs, root_svg_attrs = load_svg_with_metadata(svg_file)
        
        # Extract viewBox from first file
        if idx == 0 and isinstance(root_svg_attrs, dict):
            vb_attr = root_svg_attrs.get('viewBox') or root_svg_attrs.get('viewbox')
            w_attr = root_svg_attrs.get('width')
            h_attr = root_svg_attrs.get('height')
            
            # Parse and optionally scale width/height
            if scale_to_mm:
                if w_attr:
                    w_px = parse_len_to_px(w_attr, 1.0, mm_per_inch)
                    if w_px is not None:
                        width_attr = w_px * scale
                if h_attr:
                    h_px = parse_len_to_px(h_attr, 1.0, mm_per_inch)
                    if h_px is not None:
                        height_attr = h_px * scale
            else:
                width_attr = w_attr
                height_attr = h_attr
            
            # Parse viewBox
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
                        pass
        
        # Scale paths if needed
        for path_idx, path in enumerate(paths):
            if scale != 1.0:
                # Scale each segment in the path
                scaled_path = []
                for seg in path:
                    # Scale complex coordinates
                    start = seg.start * scale
                    end = seg.end * scale
                    # Reconstruct segment with scaled coordinates
                    seg_type = type(seg).__name__
                    if seg_type == 'Line':
                        from svgpathtools import Line
                        scaled_path.append(Line(start, end))
                    elif seg_type == 'Arc':
                        from svgpathtools import Arc
                        scaled_path.append(Arc(start, complex(seg.radius.real * scale, seg.radius.imag * scale),
                                              seg.rotation, seg.large_arc, seg.sweep, end))
                    elif seg_type == 'CubicBezier':
                        from svgpathtools import CubicBezier
                        scaled_path.append(CubicBezier(start, seg.control1 * scale, seg.control2 * scale, end))
                    elif seg_type == 'QuadraticBezier':
                        from svgpathtools import QuadraticBezier
                        scaled_path.append(QuadraticBezier(start, seg.control * scale, end))
                    else:
                        # Fallback: just append the segment
                        scaled_path.append(seg)
                
                from svgpathtools import Path
                all_paths.append(Path(*scaled_path))
            else:
                all_paths.append(path)
            
            # Preserve original stroke attributes from source SVG
            if path_idx < len(attrs):
                all_attrs.append(attrs[path_idx])
            else:
                # Fallback to basic attributes if missing
                all_attrs.append({'stroke': 'black', 'fill': 'none'})
    
    print(f"  Total paths: {len(all_paths)}")
    
    # Build SVG attributes
    svg_attrs = {}
    if scale_to_mm:
        w = width_attr if width_attr is not None else 1.0
        h = height_attr if height_attr is not None else 1.0
        svg_attrs['width'] = f"{w}mm"
        svg_attrs['height'] = f"{h}mm"
    else:
        if width_attr is not None:
            svg_attrs['width'] = width_attr
        if height_attr is not None:
            svg_attrs['height'] = height_attr
    
    if viewbox_tuple is not None:
        svg_attrs['viewBox'] = f"{viewbox_tuple[0]} {viewbox_tuple[1]} {viewbox_tuple[2]} {viewbox_tuple[3]}"
    
    # Write output
    if not all_paths:
        print("Warning: No paths found. Creating empty SVG.")
        import xml.etree.ElementTree as ET
        svg = ET.Element('svg', svg_attrs if svg_attrs else {'xmlns': 'http://www.w3.org/2000/svg'})
        tree = ET.ElementTree(svg)
        tree.write(output_svg)
    else:
        wsvg(all_paths, filename=output_svg, attributes=all_attrs, 
             svg_attributes=svg_attrs if svg_attrs else None,
             viewbox=viewbox_tuple if viewbox_tuple is not None else None)
    
    print(f"Composite SVG written to {output_svg}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Composite multiple SVG files into one.")
    parser.add_argument("input_svgs", nargs="+", help="Input SVG files to composite")
    parser.add_argument("-o", "--output", required=True, help="Output SVG file")
    parser.add_argument("--scale-to-mm", action="store_true",
                        help="Scale coordinates to millimeters (assumes 200 dpi input)")
    parser.add_argument("--source-dpi", type=float, default=200.0,
                        help="Source DPI for scaling (default: 200.0)")
    args = parser.parse_args()
    
    composite_svgs(args.input_svgs, args.output, scale_to_mm=args.scale_to_mm,
                   source_dpi=args.source_dpi)
