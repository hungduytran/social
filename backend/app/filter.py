"""Graph filtering utilities"""
import networkx as nx
from typing import Optional
import math

def filter_graph_by_bbox(G: nx.Graph, bbox: Optional[dict] = None) -> nx.Graph:
    """Filter graph to only include nodes and edges within bbox (optimized)"""
    if bbox is None:
        return G.copy()
    
    min_lat = bbox.get("minLat")
    max_lat = bbox.get("maxLat")
    min_lon = bbox.get("minLon")
    max_lon = bbox.get("maxLon")
    
    def in_bbox(lat: float, lon: float) -> bool:
        """Check if coordinates are in bbox"""
        if min_lat is not None and lat < min_lat:
            return False
        if max_lat is not None and lat > max_lat:
            return False
        if min_lon is not None and lon < min_lon:
            return False
        if max_lon is not None and lon > max_lon:
            return False
        return True
    
    # Filter nodes (optimized - use set for faster lookup)
    nodes_in_bbox = set()
    for node_id, data in G.nodes(data=True):
        if "lat" in data and "lon" in data:
            lat, lon = data["lat"], data["lon"]
            if (not math.isnan(lat) and not math.isnan(lon) and
                -90 <= lat <= 90 and -180 <= lon <= 180 and
                in_bbox(lat, lon)):
                nodes_in_bbox.add(node_id)
    
    # Create subgraph (only include edges where both endpoints are in bbox)
    G_filtered = G.subgraph(nodes_in_bbox).copy()
    
    return G_filtered

