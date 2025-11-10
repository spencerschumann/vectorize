import unittest
import numpy as np
from path_index import PathIndex, IndexEntry, EndpointMatch

class TestPathIndex(unittest.TestCase):
    def test_basic_indexing(self):
        """Test that paths are correctly indexed"""
        paths = [
            [(0, 0), (1, 1)],  # Path 0
            [(2, 2), (3, 3)],  # Path 1
            [(4, 4), (5, 5)]   # Path 2
        ]
        index = PathIndex(paths)
        
        # Should have start and end points for each path
        self.assertEqual(len(index.entries), 6)
        
        # Entries should be sorted by x coordinate
        xs = [e.x for e in index.entries]
        self.assertEqual(xs, sorted(xs))
        
        # Should have correct start/end points
        starts = [e for e in index.entries if e.is_start]
        ends = [e for e in index.entries if not e.is_start]
        self.assertEqual(len(starts), 3)
        self.assertEqual(len(ends), 3)
        
        # Check first path's points
        path0_points = [e for e in index.entries if e.path_index == 0]
        self.assertEqual(len(path0_points), 2)
        self.assertEqual((path0_points[0].x, path0_points[0].y), (0, 0))
        self.assertEqual((path0_points[1].x, path0_points[1].y), (1, 1))

    def test_closed_path_exclusion(self):
        """Test that closed paths are automatically excluded"""
        paths = [
            [(0, 0), (1, 0), (1, 1), (0, 0)],  # Closed path
            [(2, 2), (3, 3)],  # Open path
            [(0, 2), (1, 2), (1, 3), (0, 2)]   # Another closed path
        ]
        index = PathIndex(paths)
        
        # Should only index the open path
        self.assertEqual(len(index.entries), 2)  # Start and end of path 1
        self.assertEqual(len(index.excluded), 2)  # Two closed paths
        self.assertIn(0, index.excluded)
        self.assertIn(2, index.excluded)
        
        # Check that the open path was indexed
        self.assertTrue(all(e.path_index == 1 for e in index.entries))

    def test_endpoint_radius_search(self):
        """Test finding endpoints within a radius"""
        paths = [
            [(0, 0), (2, 0)],      # Horizontal path
            [(1, -1), (1, 1)],     # Vertical path
            [(3, 3), (4, 4)]       # Distant path
        ]
        index = PathIndex(paths)
        
        # Search near origin with radius 0.5
        matches = index.find_endpoints_in_radius((0, 0), 0.5)
        self.assertEqual(len(matches), 1)  # Just the start of path 0
        self.assertTrue(matches[0].is_start)
        self.assertEqual(matches[0].path_index, 0)
        
        # Search at (1, 0) with radius 1.5
        matches = index.find_endpoints_in_radius((1, 0), 1.5)
        self.assertEqual(len(matches), 4)  # Should find all points of paths 0 and 1
        
        # Results should be sorted by distance
        distances = [m.distance for m in matches]
        self.assertEqual(distances, sorted(distances))
        
        # Search near distant path
        matches = index.find_endpoints_in_radius((3.5, 3.5), 1.0)
        self.assertEqual(len(matches), 2)  # Both endpoints of path 2
        self.assertEqual({m.path_index for m in matches}, {2})

    def test_path_removal(self):
        """Test removing paths from the index"""
        paths = [
            [(0, 0), (1, 1)],
            [(2, 2), (3, 3)]
        ]
        index = PathIndex(paths)
        
        # Initially should find all points
        center = (1.5, 1.5)
        radius = 2.5  # Increased radius to ensure we catch all points
        matches = index.find_endpoints_in_radius(center, radius)
        self.assertEqual(len(matches), 4)  # All endpoints from both paths
        
        # Remove first path
        index.remove_path(0)
        
        # Now should only find points from second path
        matches = index.find_endpoints_in_radius(center, radius)
        self.assertEqual(len(matches), 2)  # Only endpoints from path 1
        self.assertTrue(all(m.path_index == 1 for m in matches))

    def test_empty_and_invalid_paths(self):
        """Test handling of empty and invalid paths"""
        paths = [
            [],                     # Empty path
            [(0, 0)],              # Single point
            [(1, 1), (2, 2)],      # Valid path
        ]
        
        index = PathIndex(paths)
        
        # Should only index the valid path
        self.assertEqual(len(index.entries), 2)  # Start and end of the valid path
        self.assertTrue(all(e.path_index == 2 for e in index.entries))

    def test_collinear_endpoints(self):
        """Test finding endpoints of collinear paths"""
        paths = [
            [(0, 0), (1, 1)],      # Path at 45 degrees
            [(1, 1), (2, 2)],      # Collinear continuation
            [(2, 2), (3, 3)]       # Another collinear continuation
        ]
        index = PathIndex(paths)
        
        # Search at middle point (1, 1)
        matches = index.find_endpoints_in_radius((1, 1), 0.1)
        self.assertEqual(len(matches), 2)  # End of path 0 and start of path 1
        
        # Both points should be exactly at (1, 1)
        self.assertTrue(all(np.allclose(m.point, (1, 1)) for m in matches))
        
        # Should be from different paths
        path_indices = {m.path_index for m in matches}
        self.assertEqual(len(path_indices), 2)
        
        # One should be an end point, one a start point
        self.assertEqual(len([m for m in matches if m.is_start]), 1)
        self.assertEqual(len([m for m in matches if not m.is_start]), 1)

if __name__ == '__main__':
    unittest.main()
