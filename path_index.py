import numpy as np
from dataclasses import dataclass
from typing import List, Tuple, Set
from sortedcontainers import SortedList


@dataclass
class EndpointMatch:
    path_index: int
    is_start: bool
    point: Tuple[float, float]
    distance: float


@dataclass
class IndexEntry:
    x: float
    y: float
    path_index: int
    is_start: bool


class PathIndex:
    """Spatial index for path endpoints using dual SortedLists (x and y)."""

    def __init__(self, paths: List[List[Tuple[float, float]]]):
        self.paths = paths
        self.excluded: Set[int] = set()

        # Each SortedList stores (coordinate, IndexEntry)
        self.entries_x = SortedList(key=lambda e: e.x)
        self.entries_y = SortedList(key=lambda e: e.y)

        self._build_index()

    def _is_closed_path(self, path: List[Tuple[float, float]], tol=1e-6) -> bool:
        return len(path) >= 3 and np.allclose(path[0], path[-1], rtol=tol)

    def _build_index(self):
        self.entries_x.clear()
        self.entries_y.clear()
        self.excluded.clear()

        for i, path in enumerate(self.paths):
            if self._is_closed_path(path):
                self.excluded.add(i)
                continue
            if len(path) >= 2:
                for pt, is_start in [(path[0], True), (path[-1], False)]:
                    entry = IndexEntry(x=pt[0], y=pt[1], path_index=i, is_start=is_start)
                    self.entries_x.add(entry)
                    self.entries_y.add(entry)

    # ------------------ Query ------------------

    def find_endpoints_in_radius(
        self, point: Tuple[float, float], radius: float
    ) -> List[EndpointMatch]:
        """Find nearby endpoints within radius, using the axis with the smallest range."""
        x0, y0 = point
        r = radius

        # Candidate sets for each axis
        [left_x, right_x] = self._range_query(self.entries_x, x0 - r, x0 + r, axis="x")
        [left_y, right_y] = self._range_query(self.entries_y, y0 - r, y0 + r, axis="y")
        
        # Pick smaller set to refine
        if (right_x - left_x) < (right_y - left_y):
            candidates = self.entries_x[left_x:right_x]
        else:
            candidates = self.entries_y[left_y:right_y]

        results = []
        r2 = r * r
        for entry in candidates:
            if entry.path_index in self.excluded:
                continue
            dx = entry.x - x0
            dy = entry.y - y0
            d2 = dx * dx + dy * dy
            if d2 <= r2:
                results.append(
                    EndpointMatch(
                        path_index=entry.path_index,
                        is_start=entry.is_start,
                        point=(entry.x, entry.y),
                        distance=np.sqrt(d2),
                    )
                )
        results.sort(key=lambda m: m.distance)
        return results

    def _range_query(self, sorted_list: SortedList, lo: float, hi: float, axis: str):
        """Return entries within coordinate range [lo, hi] on given axis."""
        # Find index range in SortedList
        other_axis = "y" if axis == "x" else "x"
        left = sorted_list.bisect_left(IndexEntry(**{axis: lo, other_axis: 0, "path_index": 0, "is_start": False}))
        right = sorted_list.bisect_right(IndexEntry(**{axis: hi, other_axis: 0, "path_index": 0, "is_start": False}))
        return [left, right]

    # ------------------ Dynamic updates ------------------

    def insert_path(self, path: List[Tuple[float, float]], path_index: int):
        """Insert endpoints for a new or updated path."""
        # Remove from excluded set if it was there
        self.excluded.discard(path_index)
        
        if self._is_closed_path(path):
            self.excluded.add(path_index)
            return

        for pt, is_start in [(path[0], True), (path[-1], False)]:
            entry = IndexEntry(x=pt[0], y=pt[1], path_index=path_index, is_start=is_start)
            self.entries_x.add(entry)
            self.entries_y.add(entry)

    def remove_path(self, path_index: int):
        """Remove all entries for a given path."""
        self.excluded.add(path_index)
        # Lazy removal: they’ll be ignored in queries.
        # If memory pressure matters, you can physically remove them:
        # self.entries_x = SortedList([e for e in self.entries_x if e.path_index != path_index], key=lambda e: e.x)
        # self.entries_y = SortedList([e for e in self.entries_y if e.path_index != path_index], key=lambda e: e.y)
