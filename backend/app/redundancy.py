"""Redundancy suggestions"""
import networkx as nx
from typing import List, Tuple
from geopy.distance import great_circle
from app.metrics import get_lcc, lcc_size, aspl

def suggest_redundancy(G: nx.Graph, m: int = 10, max_distance_km: float = 3000) -> List[dict]:
    """Suggest m new edges to add for redundancy (TER-based sorting).

    This version ranks candidate non-edges by Effective Resistance (R_eff)
    computed on the LCC, which matches the TER method. It returns the top-m
    suggestions sorted by Reff desc. Falls back to a light heuristic if LU
    factorization fails.
    """
    if len(G) < 2:
        return []

    # Work on LCC only (stable & faster)
    lcc = get_lcc(G)
    H = G.subgraph(lcc).copy()

    # Try TER-based scoring using LU factorization
    try:
        from app.defense import _build_grounded_laplacian_lu, sample_candidate_edges, effective_resistance
        idx, g, ground_node, lu = _build_grounded_laplacian_lu(H, list(H.nodes()))

        # Sample candidate non-edges (respect distance)
        cand = sample_candidate_edges(H, max_candidates=min(20000, m * 1000), max_distance_km=max_distance_km, seed=123)
        scored = []
        for u, v, d in cand:
            try:
                reff = effective_resistance(lu, idx, g, u, v)
                nu, nv = H.nodes[u], H.nodes[v]
                scored.append({
                    "source": u,
                    "target": v,
                    "source_name": nu.get("name", ""),
                    "target_name": nv.get("name", ""),
                    "source_iata": nu.get("iata", ""),
                    "target_iata": nv.get("iata", ""),
                    "distance_km": float(d) if d is not None else None,
                    "Reff": float(reff),
                })
            except Exception:
                continue
        scored.sort(key=lambda x: x["Reff"], reverse=True)
        return scored[:m]
    except Exception:
        # Lightweight heuristic fallback (old implementation, trimmed for speed)
        suggestions = []
        nodes_list = list(H.nodes())
        existing_edges = set(tuple(sorted((u, v))) for u, v in H.edges())
        max_nodes_to_check = min(50, len(nodes_list))
        # Prefer high-degree nodes
        degrees = dict(H.degree())
        nodes_list = sorted(nodes_list, key=lambda n: degrees.get(n, 0), reverse=True)[:max_nodes_to_check]
        max_candidates = 200
        checked = 0
        for i, src in enumerate(nodes_list):
            if checked >= max_candidates:
                break
            for dst in nodes_list[i+1:]:
                if checked >= max_candidates:
                    break
                checked += 1
                if tuple(sorted((src, dst))) in existing_edges:
                    continue
                su, sv = H.nodes[src], H.nodes[dst]
                if "lat" not in su or "lon" not in su or "lat" not in sv or "lon" not in sv:
                    continue
                try:
                    dist = great_circle((su["lat"], su["lon"]), (sv["lat"], sv["lon"])) .kilometers
                except Exception:
                    continue
                if dist > max_distance_km:
                    continue
                score = (degrees.get(src, 0) + degrees.get(dst, 0)) / (dist + 1)
                suggestions.append({
                    "source": src,
                    "target": dst,
                    "source_name": su.get("name", ""),
                    "target_name": sv.get("name", ""),
                    "source_iata": su.get("iata", ""),
                    "target_iata": sv.get("iata", ""),
                    "distance_km": dist,
                    "score": score,
                    "Reff": None,
                })
        suggestions.sort(key=lambda x: x.get("score", 0), reverse=True)
        return suggestions[:m]

