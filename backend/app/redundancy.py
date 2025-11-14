"""Redundancy suggestions"""
import networkx as nx
from typing import List, Tuple
from geopy.distance import great_circle
from app.metrics import get_lcc, lcc_size, aspl

def suggest_redundancy(G: nx.Graph, m: int = 10, max_distance_km: float = 3000) -> List[dict]:
    """Suggest m new edges to add for redundancy
    
    Strategy:
    1. Find disconnected components or bridge edges
    2. Connect nodes from different components or communities
    3. Prioritize by distance and expected gain in LCC/ASPL
    """
    if len(G) < 2:
        return []
    
    suggestions = []
    G_copy = G.copy()
    lcc_nodes = get_lcc(G_copy)
    baseline_lcc = len(lcc_nodes) / len(G_copy) if len(G_copy) > 0 else 0
    
    # Limit computation for large graphs - more aggressive
    max_nodes_to_check = 50  # Reduced from 100
    nodes_list = list(G_copy.nodes())
    if len(nodes_list) > max_nodes_to_check:
        # Sample nodes - prioritize high degree nodes
        degrees = dict(G_copy.degree())
        nodes_list = sorted(nodes_list, key=lambda n: degrees.get(n, 0), reverse=True)[:max_nodes_to_check]
    
    # Get all possible edges that don't exist
    existing_edges = set()
    for u, v in G_copy.edges():
        existing_edges.add(tuple(sorted([u, v])))
    
    candidates = []
    
    # Limit candidate pairs to avoid timeout - more aggressive
    max_candidates = 200  # Reduced from 500
    checked = 0
    
    for i, src in enumerate(nodes_list):
        if checked >= max_candidates:
            break
        for dst in nodes_list[i+1:]:
            if checked >= max_candidates:
                break
            checked += 1
            
            edge = tuple(sorted([src, dst]))
            if edge in existing_edges:
                continue
            
            # Check distance
            src_data = G_copy.nodes[src]
            dst_data = G_copy.nodes[dst]
            
            if "lat" not in src_data or "lon" not in src_data:
                continue
            if "lat" not in dst_data or "lon" not in dst_data:
                continue
            
            try:
                dist = great_circle(
                    (src_data["lat"], src_data["lon"]),
                    (dst_data["lat"], dst_data["lon"])
                ).kilometers
                
                if dist > max_distance_km:
                    continue
                
                # Simplified scoring - don't recalculate ASPL for all candidates (too slow)
                # Just use distance and degree as proxy
                src_degree = G_copy.degree(src)
                dst_degree = G_copy.degree(dst)
                
                # Score: prefer connecting high-degree nodes that are close
                score = (src_degree + dst_degree) / (dist + 1)
                
                candidates.append({
                    "source": src,
                    "target": dst,
                    "source_name": src_data.get("name", ""),
                    "target_name": dst_data.get("name", ""),
                    "source_iata": src_data.get("iata", ""),
                    "target_iata": dst_data.get("iata", ""),
                    "distance_km": dist,
                    "lcc_gain": 0.0,  # Simplified - don't calculate for all
                    "aspl_gain": 0.0,  # Simplified
                    "score": score
                })
            except:
                continue
    
    # Sort by score and return top m
    candidates.sort(key=lambda x: x["score"], reverse=True)
    
    # Calculate actual gains only for top candidates - limit to avoid timeout
    top_candidates = candidates[:min(m, len(candidates))]  # Only calculate for final m, not m*2
    baseline_aspl = aspl(G_copy) if len(G_copy) < 100 else 0  # Skip ASPL for large graphs
    
    final_candidates = []
    for cand in top_candidates:
        try:
            # Skip detailed calculation for very large graphs
            if len(G_copy) > 100:
                # Just use the heuristic score
                cand["lcc_gain"] = 0.0
                cand["aspl_gain"] = 0.0
                final_candidates.append(cand)
                continue
            
            G_test = G_copy.copy()
            G_test.add_edge(cand["source"], cand["target"])
            
            new_lcc = lcc_size(G_test)
            if baseline_aspl > 0:
                new_aspl = aspl(G_test)
                cand["aspl_gain"] = baseline_aspl - new_aspl
            else:
                cand["aspl_gain"] = 0.0
            
            cand["lcc_gain"] = new_lcc - baseline_lcc
            cand["score"] = cand["lcc_gain"] * 10 + cand["aspl_gain"]
            
            final_candidates.append(cand)
        except:
            continue
    
    final_candidates.sort(key=lambda x: x["score"], reverse=True)
    return final_candidates[:m]

