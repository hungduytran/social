"""Application state"""
import networkx as nx
from typing import Optional, Set, Tuple


class AppState:
    def __init__(self):
        self.graph: Optional[nx.Graph] = None  # Original graph
        self.removed_nodes: Set[int] = set()  # Removed node IDs
        self.removed_edges: Set[Tuple[int, int]] = set()  # Removed edge tuples
    
    def get_active_graph(self) -> Optional[nx.Graph]:
        """Get graph with removed nodes/edges excluded"""
        if self.graph is None:
            return None
        G = self.graph.copy()
        # Remove nodes
        G.remove_nodes_from(self.removed_nodes)
        # Remove edges
        G.remove_edges_from(self.removed_edges)
        return G
    
    def remove_node(self, node_id: int) -> bool:
        """Remove a node and all its connected edges"""
        if self.graph is None or node_id not in self.graph:
            return False
        self.removed_nodes.add(node_id)
        # Also remove all edges connected to this node
        if node_id in self.graph:
            neighbors = list(self.graph.neighbors(node_id))
            for neighbor in neighbors:
                edge = tuple(sorted([node_id, neighbor]))
                self.removed_edges.add(edge)
        return True
    
    def restore_node(self, node_id: int) -> bool:
        """Restore a node and all its connected edges"""
        if node_id in self.removed_nodes:
            self.removed_nodes.remove(node_id)
            # Also restore all edges connected to this node
            if self.graph and node_id in self.graph:
                neighbors = list(self.graph.neighbors(node_id))
                for neighbor in neighbors:
                    edge = tuple(sorted([node_id, neighbor]))
                    if edge in self.removed_edges:
                        self.removed_edges.remove(edge)
            return True
        return False
    
    def remove_edge(self, src: int, dst: int) -> bool:
        """Remove an edge"""
        if self.graph is None:
            return False
        # Normalize edge (undirected graph)
        edge = tuple(sorted([src, dst]))
        if edge[0] in self.graph and edge[1] in self.graph and self.graph.has_edge(edge[0], edge[1]):
            self.removed_edges.add(edge)
            return True
        return False
    
    def restore_edge(self, src: int, dst: int) -> bool:
        """Restore an edge"""
        edge = tuple(sorted([src, dst]))
        if edge in self.removed_edges:
            self.removed_edges.remove(edge)
            return True
        return False
    
    def reset(self):
        """Reset all removals"""
        self.removed_nodes.clear()
        self.removed_edges.clear()


app_state = AppState()


def load_data_on_startup():
    """Load data files from the OpenFlights folder next to the project root."""
    import os
    from pathlib import Path
    from app.loader import load_and_build_graph

    # Resolve project root: backend/app/state.py -> backend -> project root
    current_file = Path(__file__).resolve()
    backend_dir = current_file.parent.parent
    project_root = backend_dir.parent

    candidate_dirs = [
        project_root / "openflights" / "data",
        backend_dir / "openflights" / "data",
        project_root.parent / "openflights" / "data",
    ]

    print("Trying to load OpenFlights data from:")
    for d in candidate_dirs:
        print(f"  - {d}")

    for data_dir in candidate_dirs:
        airports_path = data_dir / "airports.dat"
        routes_path = data_dir / "routes.dat"

        if airports_path.exists() and routes_path.exists():
            try:
                app_state.graph = load_and_build_graph(
                    str(airports_path),
                    str(routes_path),
                )
                print(
                    f"Loaded graph from {data_dir}: "
                    f"{len(app_state.graph)} nodes, "
                    f"{app_state.graph.number_of_edges()} edges"
                )
                return
            except Exception as e:
                print(f"Error loading from {data_dir}: {e}")

    print("Warning: Could not load data files (airports.dat, routes.dat)")

