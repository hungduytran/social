"""Defense strategies using TER (Effective Resistance)"""
import networkx as nx
import numpy as np
import random
from typing import List, Tuple, Dict, Optional, Any
from geopy.distance import great_circle
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import splu


def _build_grounded_laplacian_lu(G: nx.Graph, node_list: List[Any]) -> Tuple[Dict[Any, int], int, Any, Any]:
    """
    Build grounded Laplacian and return LU factorization.
    
    Returns:
      idx: node->0..n-1 mapping
      g: ground index
      ground_node: the ground node
      lu: LU factorization of grounded Laplacian (n-1 x n-1)
    """
    n = len(node_list)
    idx = {u: i for i, u in enumerate(node_list)}
    g = n - 1  # choose last node as ground
    ground_node = node_list[g]

    # Build adjacency matrix (unweighted, conductance=1)
    rows, cols, data = [], [], []
    deg = np.zeros(n, dtype=float)

    for u, v in G.edges():
        iu, iv = idx[u], idx[v]
        w = 1.0
        if iu == iv:
            continue
        # off-diagonals -w
        rows += [iu, iv]
        cols += [iv, iu]
        data += [-w, -w]
        # diagonals accumulate degree
        deg[iu] += w
        deg[iv] += w

    # add diagonals
    rows += list(range(n))
    cols += list(range(n))
    data += deg.tolist()

    L = csr_matrix((data, (rows, cols)), shape=(n, n))

    # grounded Laplacian: remove row/col g -> SPD if connected
    mask = np.ones(n, dtype=bool)
    mask[g] = False
    Lg = L[mask][:, mask].tocsc()

    lu = splu(Lg)  # sparse LU; works well for n~few thousands
    return idx, g, ground_node, lu


def effective_resistance(lu, idx: Dict[Any, int], g: int, u: Any, v: Any) -> float:
    """
    Exact effective resistance for unweighted graph using one Laplacian solve:
      Solve L x = e_u - e_v with x_ground=0 (grounding removes singularity).
      R_eff(u,v) = (e_u - e_v)^T x = x[u] - x[v]
    """
    n = len(idx)
    iu, iv = idx[u], idx[v]

    # build b (n-1)
    b = np.zeros(n - 1, dtype=float)

    def red(i):
        # map full index -> reduced index (skip ground g)
        return i if i < g else i - 1

    if iu != g:
        b[red(iu)] += 1.0
    if iv != g:
        b[red(iv)] -= 1.0

    x = lu.solve(b)  # reduced solution

    def x_full(i):
        if i == g:
            return 0.0
        return x[red(i)]

    return float(x_full(iu) - x_full(iv))


def geo_dist_km(G: nx.Graph, u: Any, v: Any) -> Optional[float]:
    """Calculate geographical distance between two nodes in kilometers."""
    nu, nv = G.nodes[u], G.nodes[v]
    if ("lat" in nu and "lon" in nu and "lat" in nv and "lon" in nv):
        try:
            return float(great_circle((nu["lat"], nu["lon"]), (nv["lat"], nv["lon"])).kilometers)
        except Exception:
            return None
    return None


def sample_candidate_edges(
    G: nx.Graph,
    max_candidates: int = 20000,
    max_distance_km: Optional[float] = 3000.0,
    seed: int = 0
) -> List[Tuple[Any, Any, Optional[float]]]:
    """
    Randomly sample non-edges as candidates, filtered by distance if coords exist.
    """
    rng = random.Random(seed)
    nodes = list(G.nodes())
    n = len(nodes)
    existing = set((u, v) if u <= v else (v, u) for u, v in G.edges())

    candidates = []
    tries = 0
    max_tries = max_candidates * 50  # avoid infinite loop

    while len(candidates) < max_candidates and tries < max_tries:
        tries += 1
        u = nodes[rng.randrange(n)]
        v = nodes[rng.randrange(n)]
        if u == v:
            continue
        a, b = (u, v) if u <= v else (v, u)
        if (a, b) in existing:
            continue

        d = geo_dist_km(G, u, v)
        if max_distance_km is not None and d is not None and d > max_distance_km:
            continue

        candidates.append((u, v, d))
        existing.add((a, b))  # prevent duplicates in candidate list too

    return candidates


def add_edges_by_effective_resistance(
    G: nx.Graph,
    k: int = 200,
    max_candidates: int = 20000,
    max_distance_km: Optional[float] = 3000.0,
    seed: int = 0
) -> Tuple[nx.Graph, List[Tuple[Any, Any, Dict[str, Any]]]]:
    """
    Build candidate edges, compute R_eff(u,v), add top-k edges with highest effective resistance.
    
    This implements TER (Topological Effective Resistance) defense strategy.
    
    Args:
        G: Original graph
        k: Number of edges to add
        max_candidates: Maximum number of candidate edges to evaluate
        max_distance_km: Maximum geographical distance for candidate edges
        seed: Random seed for candidate sampling
    
    Returns:
        Reinforced graph (copy with new edges added)
        List of added edges with metadata
    """
    if G.number_of_nodes() < 2:
        return G.copy(), []

    # work on LCC only (recommended)
    lcc = max(nx.connected_components(G), key=len)
    H = G.subgraph(lcc).copy()

    node_list = list(H.nodes())
    
    try:
        idx, g, ground_node, lu = _build_grounded_laplacian_lu(H, node_list)
    except Exception as e:
        # Fallback to simple method if LU factorization fails
        # Return LCC only (matching notebook implementation)
        print(f"Warning: LU factorization failed, using simple defense: {e}")
        H_reinforced = reinforce_graph_simple(H, k, max_distance_km)
        # Return LCC with added edges
        added = [(u, v, {"defense": "simple", "backup": True}) 
                 for u, v in H_reinforced.edges() if not H.has_edge(u, v)]
        return H_reinforced, added

    cand = sample_candidate_edges(H, max_candidates=max_candidates,
                                  max_distance_km=max_distance_km, seed=seed)

    scored = []
    for u, v, d in cand:
        try:
            reff = effective_resistance(lu, idx, g, u, v)
            scored.append((reff, u, v, d))
        except Exception:
            continue

    scored.sort(reverse=True, key=lambda x: x[0])

    # Follow notebook implementation: work on LCC and return LCC (with added edges)
    # This ensures same number of nodes as input LCC
    Hr = H.copy()  # Start with LCC subgraph
    added = []
    for reff, u, v, d in scored[:k]:
        meta = {"defense": "TER_like", "Reff": float(reff)}
        if d is not None:
            meta["distance_km"] = float(d)
        Hr.add_edge(u, v, **meta)
        added.append((u, v, meta))

    return Hr, added


def reinforce_graph_simple(G: nx.Graph, k: int = 10, max_distance_km: float = 2000) -> nx.Graph:
    """Simple fallback defense: add edges between top hubs by degree"""
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
        if added_count >= k:
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


def reinforce_graph(G: nx.Graph, k: int = 200, max_distance_km: float = 3000.0) -> nx.Graph:
    """
    Main defense function using TER (Effective Resistance) method.
    
    Args:
        G: Original graph
        k: Number of edges to add (default 200, matching notebook)
        max_distance_km: Maximum distance for candidate edges (default 3000km)
    
    Returns:
        Reinforced graph
    """
    # Use TER method with reasonable defaults
    G_reinforced, _ = add_edges_by_effective_resistance(
        G,
        k=k,
        max_candidates=min(20000, k * 100),  # Scale candidates with k
        max_distance_km=max_distance_km,
        seed=123
    )
    return G_reinforced
