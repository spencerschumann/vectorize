import numpy as np
from dataclasses import dataclass
from typing import List, Tuple, Set

@dataclass
class EndpointMatch:
    """Represents a matching endpoint from another path"""
    path_index: int  # Index of the path in the original list
    is_start: bool   # Whether this is the start point of the path
    point: Tuple[float, float]  # The actual endpoint coordinates
    distance: float  # Distance to the query point
    
@dataclass
class IndexEntry:
    """Entry in the spatial index"""
    x: float  # x coordinate for sorting
    y: float  # y coordinate
    path_index: int  # Index of the path this point belongs to
    is_start: bool  # Whether this is the start point of the path

class PathIndex:
    """Maintains a sorted index of path endpoints for efficient proximity queries"""
    
    def __init__(self, paths: List[List[Tuple[float, float]]]):
        """Initialize index from a list of paths
        
        Args:
            paths: List of paths, each path being a list of (x,y) points
        """
        self.paths = paths
        self.entries: List[IndexEntry] = []
        self.excluded: Set[int] = set()  # Paths to exclude from queries
        
        # Build initial index
        self._build_index()
        
    def _is_closed_path(self, path: List[Tuple[float, float]], tol=1e-6) -> bool:
        """Check if a path is closed (first point = last point)"""
        if len(path) < 3:
            return False
        return np.allclose(path[0], path[-1], rtol=tol)
    
    def _build_index(self):
        """Build the sorted endpoint index"""
        self.entries = []
        
        for i, path in enumerate(self.paths):
            if self._is_closed_path(path):
                self.excluded.add(i)
                continue
                
            if len(path) >= 2:
                # Add start point
                self.entries.append(IndexEntry(
                    x=path[0][0],
                    y=path[0][1],
                    path_index=i,
                    is_start=True
                ))
                # Add end point
                self.entries.append(IndexEntry(
                    x=path[-1][0],
                    y=path[-1][1],
                    path_index=i,
                    is_start=False
                ))
        
        # Sort by x coordinate
        self.entries.sort(key=lambda e: e.x)
    
    def find_endpoints_in_radius(self, point: Tuple[float, float], radius: float) -> List[EndpointMatch]:
        """Find all endpoints (start or end) within radius of point using x-coordinate binary search
        
        Args:
            point: (x,y) point to search near
            radius: Search radius
            
        Returns:
            List of EndpointMatch objects for points within radius, sorted by distance
        """
        results = []
        x = point[0]
        point_array = np.array(point)
        radius_squared = radius * radius
        
        # Binary search for leftmost point in range
        left = 0
        right = len(self.entries) - 1
        while left <= right:
            mid = (left + right) // 2
            if self.entries[mid].x < x - radius:
                left = mid + 1
            else:
                right = mid - 1
                
        # Scan through x-coordinate window and check actual distances
        i = left
        while i < len(self.entries) and self.entries[i].x <= x + radius:
            entry = self.entries[i]
            if entry.path_index not in self.excluded:
                # Check actual 2D distance
                entry_point = np.array((entry.x, entry.y))
                dist_squared = np.sum((point_array - entry_point) ** 2)
                
                if dist_squared <= radius_squared:
                    results.append(EndpointMatch(
                        path_index=entry.path_index,
                        is_start=entry.is_start,
                        point=(entry.x, entry.y),
                        distance=np.sqrt(dist_squared)
                    ))
            i += 1
        
        # Sort by distance
        results.sort(key=lambda m: m.distance)
        return results
    
    def remove_path(self, path_index: int):
        """Remove a path from the index
        
        Args:
            path_index: Index of the path to remove
        """
        self.excluded.add(path_index)
