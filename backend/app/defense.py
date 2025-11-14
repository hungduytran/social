"""Defense strategies"""
import networkx as nx
from typing import List, Tuple
from geopy.distance import great_circle
from app.metrics import get_lcc, lcc_size

def reinforce_graph(G: nx.Graph, k: int = 10, max_distance_km: float = 2000) -> nx.Graph:
    """Reinforce graph by adding backup edges between top hubs
    
    Strategy:
    1. Identify top-k hubs by degree
    2. Add edges between hubs that are close (within max_distance_km)
    3. Prioritize hubs that are not already connected
    
    Args:
        G: Original graph
        k: Number of top hubs to consider
        max_distance_km: Maximum distance for backup edges
    
    Returns:
        Reinforced graph (copy with new edges added)
    """
    if len(G) < 2:
        return G.copy()
    
    G_reinforced = G.copy()
    
    # Get top-k hubs by degree
    degrees = dict(G.degree())
    top_hubs = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:k]
    hub_ids = [hub_id for hub_id, _ in top_hubs]
    
    # Get existing edges
    existing_edges = set()
    for u, v in G.edges():
        existing_edges.add(tuple(sorted([u, v])))
    
    # Add backup edges between hubs
    added_count = 0
    for i, src in enumerate(hub_ids):
        if added_count >= k:  # Limit number of edges added
            break
        for dst in hub_ids[i+1:]:
            if added_count >= k:
                break
            
            # Skip if already connected
            edge_tuple = tuple(sorted([src, dst]))
            if edge_tuple in existing_edges:
                continue
            
            # Check distance
            src_data = G.nodes[src]
            dst_data = G.nodes[dst]
            
            if "lat" not in src_data or "lon" not in src_data:
                continue
            if "lat" not in dst_data or "lon" not in dst_data:
                continue
            
            try:
                dist = great_circle(
                    (src_data["lat"], src_data["lon"]),
                    (dst_data["lat"], dst_data["lon"])
                ).kilometers
                
                if dist <= max_distance_km:
                    G_reinforced.add_edge(src, dst, distance_km=dist, backup=True)
                    added_count += 1
            except:
                continue
    
    return G_reinforced

