"""API routes"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List

import networkx as nx  # Needed for type hints and graph operations in helper functions

from app.state import app_state
from app.metrics import get_stats
from app.attacks import (
    simulate_attack,
    random_attack,
    degree_targeted_attack,
    betweenness_targeted_attack,
    pagerank_targeted_attack,
)
from app.defense import (
    reinforce_graph,
    add_edges_by_effective_resistance,
    reinforce_graph_schneider,
)
from app.geojson import to_geojson
from app.redundancy import suggest_redundancy
from app.filter import filter_graph_by_bbox

router = APIRouter()

class SimulateRequest(BaseModel):
    strategy: str  # random, degree, betweenness
    k: int
    seed: Optional[int] = None
    adaptive: bool = True

@router.get("/graph/stats")
async def graph_stats():
    """Get graph statistics"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    return get_stats(app_state.graph)

@router.get("/geojson/airports")
async def get_airports(
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get airports GeoJSON with optional bbox filter"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
    
    geojson = to_geojson(
        app_state.graph, 
        bbox=bbox,
        removed_nodes=app_state.removed_nodes,
        removed_edges=app_state.removed_edges
    )
    return geojson["airports"]

@router.get("/geojson/routes")
async def get_routes(
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get routes GeoJSON with optional bbox filter"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
    
    geojson = to_geojson(
        app_state.graph,
        bbox=bbox,
        removed_nodes=app_state.removed_nodes,
        removed_edges=app_state.removed_edges
    )
    return geojson["routes"]


@router.get("/airports/list")
async def list_airports(
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None),
):
    """
    Danh sách sân bay (dùng cho dropdown chọn sân bay trong FE).

    Có thể lọc theo bbox (region) giống các API geojson.
    """
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")

    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")

    # Filter by bbox if provided
    from app.filter import filter_graph_by_bbox
    import math

    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon,
        }
        G = filter_graph_by_bbox(G, bbox)

    airports = []
    for node_id, data in G.nodes(data=True):
        lat = data.get("lat")
        lon = data.get("lon")
        # Đảm bảo lat/lon là số hữu hạn để JSON không lỗi (NaN/inf -> None)
        if isinstance(lat, (int, float)) and math.isfinite(lat):
            safe_lat = float(lat)
        else:
            safe_lat = None
        if isinstance(lon, (int, float)) and math.isfinite(lon):
            safe_lon = float(lon)
        else:
            safe_lon = None

        # Các trường text có thể là NaN (float) -> convert an toàn sang chuỗi hoặc rỗng
        name = data.get("name", "")
        city = data.get("city", "")
        country = data.get("country", "")
        iata = data.get("iata", "")

        if not isinstance(name, str):
            name = "" if name is None else str(name)
        if not isinstance(city, str):
            city = "" if city is None else str(city)
        if not isinstance(country, str):
            country = "" if country is None else str(country)
        if not isinstance(iata, str):
            iata = "" if iata is None else str(iata)

        airports.append(
            {
                "id": int(node_id),
                "name": name,
                "city": city,
                "country": country,
                "iata": iata,
                "lat": safe_lat,
                "lon": safe_lon,
            }
        )

    return {"airports": airports}

@router.post("/simulate")
async def simulate(req: SimulateRequest):
    """Run attack simulation"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    
    if req.strategy not in ["random", "degree", "betweenness"]:
        raise HTTPException(400, "Invalid strategy")
    
    # Use active graph (with removals)
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    results = simulate_attack(
        G,
        req.strategy,
        req.k,
        seed=req.seed,
        adaptive=req.adaptive
    )
    
    return {
        "strategy": req.strategy,
        "k": req.k,
        "results": results
    }

@router.post("/attack/remove/node/{node_id}")
async def remove_node(node_id: int):
    """Remove a node (airport)"""
    print(f"API: Removing node {node_id}")
    print(f"Current removed_nodes: {app_state.removed_nodes}")
    if app_state.remove_node(node_id):
        print(f"Node {node_id} removed successfully")
        print(f"Updated removed_nodes: {app_state.removed_nodes}")
        print(f"Updated removed_edges: {app_state.removed_edges}")
        return {"success": True, "node_id": node_id}
    print(f"Failed to remove node {node_id}")
    raise HTTPException(400, "Node not found or already removed")

@router.post("/attack/restore/node/{node_id}")
async def restore_node(node_id: int):
    """Restore a node (airport)"""
    if app_state.restore_node(node_id):
        return {"success": True, "node_id": node_id}
    raise HTTPException(400, "Node not found in removed list")

@router.post("/attack/remove/edge")
async def remove_edge(src: int = Query(...), dst: int = Query(...)):
    """Remove an edge (route)"""
    print(f"API: Removing edge {src} -> {dst}")
    if app_state.remove_edge(src, dst):
        print(f"Edge {src} -> {dst} removed successfully")
        return {"success": True, "source": src, "target": dst}
    print(f"Failed to remove edge {src} -> {dst}")
    raise HTTPException(400, "Edge not found or already removed")

@router.post("/attack/restore/edge")
async def restore_edge(src: int = Query(...), dst: int = Query(...)):
    """Restore an edge (route)"""
    if app_state.restore_edge(src, dst):
        return {"success": True, "source": src, "target": dst}
    raise HTTPException(400, "Edge not found in removed list")

@router.get("/attack/removed")
async def get_removed():
    """Get list of removed nodes and edges"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    
    removed_nodes_info = []
    for node_id in app_state.removed_nodes:
        if node_id in app_state.graph:
            data = app_state.graph.nodes[node_id]
            removed_nodes_info.append({
                "id": node_id,
                "name": data.get("name", ""),
                "city": data.get("city", ""),
                "country": data.get("country", ""),
                "iata": data.get("iata", ""),
                "type": "node"
            })
    
    removed_edges_info = []
    for (src, dst) in app_state.removed_edges:
        if src in app_state.graph and dst in app_state.graph:
            src_data = app_state.graph.nodes[src]
            dst_data = app_state.graph.nodes[dst]
            removed_edges_info.append({
                "source": src,
                "target": dst,
                "source_name": src_data.get("name", ""),
                "target_name": dst_data.get("name", ""),
                "source_iata": src_data.get("iata", ""),
                "target_iata": dst_data.get("iata", ""),
                "type": "edge"
            })
    
    return {
        "nodes": removed_nodes_info,
        "edges": removed_edges_info
    }

@router.post("/attack/reset")
async def reset_attacks():
    """Reset all removals"""
    app_state.reset()
    return {"success": True}

@router.get("/graph/stats")
async def graph_stats():
    """Get graph statistics"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    return get_stats(G)

@router.get("/attack/top-hubs")
async def get_top_hubs(
    k: int = 10,
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get top-k hubs by degree and betweenness (filtered by region)"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox if provided
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    
    import networkx as nx
    
    # Top by degree
    degrees = dict(G.degree())
    top_degree = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:k]
    
    # Top by betweenness (approximate for large graphs) - skip if too large
    top_betweenness = []
    if len(G) <= 50:  # Only calculate for small graphs
        try:
            betweenness = nx.betweenness_centrality(G)
            top_betweenness = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:k]
        except Exception as e:
            print(f"Error calculating betweenness: {e}")
            top_betweenness = []
    
    hubs_degree = []
    for node_id, deg in top_degree:
        if node_id in G:
            data = G.nodes[node_id]
            hubs_degree.append({
                "id": node_id,
                "name": data.get("name", ""),
                "city": data.get("city", ""),
                "country": data.get("country", ""),
                "iata": data.get("iata", ""),
                "degree": deg,
                "type": "degree"
            })
    
    hubs_betweenness = []
    for node_id, bet in top_betweenness:
        if node_id in G:
            data = G.nodes[node_id]
            hubs_betweenness.append({
                "id": node_id,
                "name": data.get("name", ""),
                "city": data.get("city", ""),
                "country": data.get("country", ""),
                "iata": data.get("iata", ""),
                "betweenness": bet,
                "type": "betweenness"
            })
    
    return {
        "by_degree": hubs_degree,
        "by_betweenness": hubs_betweenness
    }

@router.get("/defend/redundancy")
async def get_redundancy_suggestions(
    m: int = 10,
    max_distance_km: float = 3000,
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get redundancy suggestions (filtered by region)"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox if provided
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    
    suggestions = suggest_redundancy(G, m=m, max_distance_km=max_distance_km)
    return {"suggestions": suggestions}

@router.get("/attack/impact")
async def get_attack_impact(
    region: Optional[str] = Query(None),
    k: int = 10,
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get pre-computed attack impact or compute on-the-fly"""
    import json
    import os
    
    # Try to load pre-computed results first
    import pathlib
    precomputed_file = pathlib.Path(__file__).parent.parent / "precomputed_attacks.json"
    
    # Determine region key from bbox or region parameter
    region_key = region
    if not region_key:
        # Map bbox to region
        if any([minLat, maxLat, minLon, maxLon]):
            # Try to match bbox to known regions
            bbox = {"minLat": minLat, "maxLat": maxLat, "minLon": minLon, "maxLon": maxLon}
            if (bbox.get("minLat") == -10 and bbox.get("maxLat") == 30 and 
                bbox.get("minLon") == 90 and bbox.get("maxLon") == 150):
                region_key = "southeast-asia"
            elif (bbox.get("minLat") == -10 and bbox.get("maxLat") == 55 and
                  bbox.get("minLon") == 60 and bbox.get("maxLon") == 150):
                region_key = "asia"
            elif (bbox.get("minLat") == 35 and bbox.get("maxLat") == 72 and
                  bbox.get("minLon") == -15 and bbox.get("maxLon") == 40):
                region_key = "europe"
            elif (bbox.get("minLat") == 15 and bbox.get("maxLat") == 72 and
                  bbox.get("minLon") == -170 and bbox.get("maxLon") == -50):
                region_key = "north-america"
    
    # Try to load pre-computed data
    if region_key and precomputed_file.exists():
        try:
            with open(precomputed_file, 'r', encoding='utf-8') as f:
                precomputed = json.load(f)
                if region_key in precomputed:
                    print(f"Using pre-computed data for {region_key}")
                    return precomputed[region_key]
        except Exception as e:
            print(f"Error loading pre-computed data: {e}")
    
    # Compute on-the-fly - Optimized for Southeast Asia
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox (default to Southeast Asia)
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    else:
        # Default to Southeast Asia
        bbox = {"minLat": -10, "maxLat": 30, "minLon": 90, "maxLon": 150}
        G = filter_graph_by_bbox(G, bbox)
    
    if len(G) == 0:
        raise HTTPException(400, "No nodes in region")
    
    print(f"Computing attack impact for {len(G)} nodes, {G.number_of_edges()} edges")
    
    baseline = get_stats(G)
    
    # Define fractions: 0 to 0.5 in steps of 0.05 (11 points)
    fractions = [round(i * 0.05, 2) for i in range(11)]
    
    # Run main attack strategies
    print("Running random_attack...")
    random_result = simulate_attack(G, "random_attack", fractions=fractions, n_runs=5, seed=42)
    
    print("Running degree_targeted_attack...")
    degree_result = simulate_attack(G, "degree_targeted_attack", fractions=fractions, n_runs=1)

    print("Running pagerank_targeted_attack...")
    pagerank_result = simulate_attack(G, "pagerank_targeted_attack", fractions=fractions, n_runs=1)
    
    print("Running betweenness_targeted_attack...")
    betweenness_result = None
    if len(G) <= 200:  # Only for smaller graphs
        try:
            betweenness_result = simulate_attack(G, "betweenness_targeted_attack", fractions=fractions, n_runs=1)
        except Exception as e:
            print(f"Betweenness attack failed: {e}")
            betweenness_result = None
    else:
        print(f"Skipping betweenness attack (graph too large: {len(G)} nodes)")
    
    return {
        "baseline": baseline,
        "random_attack": random_result,
        "degree_targeted_attack": degree_result,
        "pagerank_targeted_attack": pagerank_result,
        "betweenness_targeted_attack": betweenness_result
    }

@router.get("/defense/impact")
async def get_defense_impact(
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None),
    k_hubs: int = Query(10, description="Number of top hubs to reinforce"),
    n_runs: int = Query(5, description="Number of runs for random attack averaging")
):
    """Get defense impact: compare attacks on original vs reinforced graph"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox (default to Southeast Asia)
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    else:
        bbox = {"minLat": -10, "maxLat": 30, "minLon": 90, "maxLon": 150}
        G = filter_graph_by_bbox(G, bbox)
    
    if len(G) == 0:
        raise HTTPException(400, "No nodes in region")
    
    # IMPORTANT: Filter to LCC only (matching notebook implementation)
    from app.metrics import get_lcc
    lcc_nodes = get_lcc(G)
    G_lcc = G.subgraph(lcc_nodes).copy()
    N0_original = len(G_lcc)
    
    print(f"Computing defense impact for LCC: {N0_original} nodes (original graph had {len(G)} nodes)")
    
    # Reinforce graph (TER method works on LCC and returns LCC)
    G_reinforced, added_edges_list = add_edges_by_effective_resistance(
        G_lcc, 
        k=k_hubs, 
        max_candidates=min(20000, k_hubs * 100),
        max_distance_km=2000, 
        seed=123
    )
    added_edges_count = len(added_edges_list)
    print(f"Reinforced graph: {G_reinforced.number_of_edges()} edges (original LCC: {G_lcc.number_of_edges()}, added: {added_edges_count})")
    
    baseline_original = get_stats(G_lcc)
    baseline_reinforced = get_stats(G_reinforced)
    
    fractions = [round(i * 0.05, 2) for i in range(11)]
    
    # Test degree attack on both (both are LCC with same nodes)
    print(f"Testing degree attack on original LCC (N0={N0_original})...")
    degree_original = simulate_attack(G_lcc, "degree_targeted_attack", fractions=fractions, n_runs=1)
    
    print(f"Testing degree attack on reinforced LCC (N0={len(G_reinforced)})...")
    degree_reinforced = simulate_attack(G_reinforced, "degree_targeted_attack", fractions=fractions, n_runs=1)
    
    return {
        "baseline_original": baseline_original,
        "baseline_reinforced": baseline_reinforced,
        "degree_attack_original": degree_original,
        "degree_attack_reinforced": degree_reinforced
    }

@router.get("/attack/top-k-impact")
async def get_top_k_impact(
    k: int = Query(10, description="Number of top hubs to remove"),
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None),
    strategy: str = Query("degree", description="Strategy: 'degree' or 'betweenness'")
):
    """Analyze impact of removing top-k hubs
    
    Returns:
        - Top-k hubs list
        - Impact metrics after removing each hub sequentially
        - Robustness curve showing degradation
    """
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox (default to Southeast Asia)
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    else:
        bbox = {"minLat": -10, "maxLat": 30, "minLon": 90, "maxLon": 150}
        G = filter_graph_by_bbox(G, bbox)
    
    if len(G) == 0:
        raise HTTPException(400, "No nodes in region")
    
    import networkx as nx
    from app.metrics import get_stats
    
    baseline = get_stats(G)
    
    # Get top-k hubs
    if strategy == "degree":
        degrees = dict(G.degree())
        top_hubs = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:k]
        hub_list = [node_id for node_id, _ in top_hubs]
    elif strategy == "betweenness":
        # Use approximation for large graphs to speed up
        try:
            if len(G) > 50:
                # Use sampling for large graphs (approximate betweenness)
                sample_size = min(50, len(G))
                print(f"Using approximate betweenness centrality (sample_size={sample_size}) for graph with {len(G)} nodes")
                betweenness = nx.betweenness_centrality(G, k=sample_size)
            else:
                # Exact calculation for small graphs
                betweenness = nx.betweenness_centrality(G)
            top_hubs = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:k]
            hub_list = [node_id for node_id, _ in top_hubs]
        except Exception as e:
            print(f"Error calculating betweenness: {e}")
            raise HTTPException(400, f"Error calculating betweenness centrality: {str(e)}")
    else:
        raise HTTPException(400, "Invalid strategy. Use 'degree' or 'betweenness'")
    
    # Get hub details
    hubs_info = []
    for node_id in hub_list:
        if node_id in G:
            data = G.nodes[node_id]
            hubs_info.append({
                "id": node_id,
                "name": data.get("name", ""),
                "city": data.get("city", ""),
                "country": data.get("country", ""),
                "iata": data.get("iata", ""),
                "lat": data.get("lat"),
                "lon": data.get("lon")
            })
    
    # Simulate sequential removal
    G_copy = G.copy()
    impact_curve = []
    impact_curve.append({
        "step": 0,
        "removed": 0,
        "fraction_removed": 0.0,
        **baseline
    })
    
    for step, node_id in enumerate(hub_list[:k], 1):
        if node_id in G_copy:
            G_copy.remove_node(node_id)
            stats = get_stats(G_copy)
            impact_curve.append({
                "step": step,
                "removed": step,
                "fraction_removed": step / len(G) if len(G) > 0 else 0,
                **stats
            })
    
    return {
        "baseline": baseline,
        "strategy": strategy,
        "k": k,
        "hubs": hubs_info,
        "impact_curve": impact_curve
    }

@router.get("/attack/impact-custom")
async def get_attack_impact_custom(
    strategy: str = Query(
        ...,
        description=(
            "Attack strategy: 'random_attack', 'degree_targeted_attack', "
            "'pagerank_targeted_attack', 'betweenness_targeted_attack'"
        ),
    ),
    max_fraction: float = Query(0.5, description="Maximum fraction to remove (0.0 to 1.0)"),
    n_runs: int = Query(5, description="Number of runs for averaging (only for random_attack)"),
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get attack impact with custom parameters"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    if strategy not in [
        "random_attack",
        "degree_targeted_attack",
        "pagerank_targeted_attack",
        "betweenness_targeted_attack",
    ]:
        raise HTTPException(400, "Invalid strategy")
    
    # Filter by bbox (default to Southeast Asia)
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    else:
        bbox = {"minLat": -10, "maxLat": 30, "minLon": 90, "maxLon": 150}
        G = filter_graph_by_bbox(G, bbox)
    
    if len(G) == 0:
        raise HTTPException(400, "No nodes in region")
    
    baseline = get_stats(G)
    
    # Define fractions
    num_points = 11
    fractions = [round(i * max_fraction / (num_points - 1), 3) for i in range(num_points)]
    
    # Run attack (betweenness is already approximated inside simulate_attack for large graphs)
    result = simulate_attack(
        G,
        strategy,
        fractions=fractions,
        n_runs=n_runs if strategy == "random_attack" else 1,
        seed=42,
    )
    
    return {
        "baseline": baseline,
        "strategy": strategy,
        "max_fraction": max_fraction,
        "result": result
    }

@router.get("/defense/impact-custom")
async def get_defense_impact_custom(
    k_hubs: int = Query(10, description="Number of top hubs to reinforce"),
    max_distance_km: float = Query(2000, description="Maximum distance for backup edges"),
    attack_strategy: str = Query("degree_targeted_attack", description="Attack strategy to test"),
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """Get defense impact with custom parameters"""
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox (default to Southeast Asia)
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    else:
        bbox = {"minLat": -10, "maxLat": 30, "minLon": 90, "maxLon": 150}
        G = filter_graph_by_bbox(G, bbox)
    
    if len(G) == 0:
        raise HTTPException(400, "No nodes in region")
    
    print(f"Computing defense impact: k_hubs={k_hubs}, max_distance={max_distance_km}km")
    
    # IMPORTANT: Filter to LCC only (matching notebook implementation)
    # This ensures both Original and Reinforced work on the same set of nodes
    from app.metrics import get_lcc
    lcc_nodes = get_lcc(G)
    G_lcc = G.subgraph(lcc_nodes).copy()
    N0_original = len(G_lcc)
    
    print(f"Working on LCC: {N0_original} nodes (original graph had {len(G)} nodes)")
    
    # Reinforce graph (TER method works on LCC and returns LCC)
    G_reinforced, added_edges_list = add_edges_by_effective_resistance(
        G_lcc, 
        k=k_hubs, 
        max_candidates=min(20000, k_hubs * 100),
        max_distance_km=max_distance_km, 
        seed=123
    )
    added_edges = len(added_edges_list)
    
    # Verify both graphs have the same number of nodes (both should be LCC)
    if len(G_reinforced) != N0_original:
        print(f"Warning: Reinforced graph has {len(G_reinforced)} nodes, LCC has {N0_original} nodes")
    else:
        print(f"Verified: Both graphs have {N0_original} nodes")
    
    # Use LCC for both original and reinforced (both have same nodes)
    baseline_original = get_stats(G_lcc)
    baseline_reinforced = get_stats(G_reinforced)
    
    fractions = [round(i * 0.05, 2) for i in range(11)]
    
    # Test attack on both (both will normalize by N0_original, which is the same)
    print(f"Testing {attack_strategy} on original LCC (N0={N0_original})...")
    attack_original = simulate_attack(G_lcc, attack_strategy, fractions=fractions, n_runs=1)
    
    print(f"Testing {attack_strategy} on reinforced LCC (N0={len(G_reinforced)})...")
    attack_reinforced = simulate_attack(G_reinforced, attack_strategy, fractions=fractions, n_runs=1)
    
    return {
        "baseline_original": baseline_original,
        "baseline_reinforced": baseline_reinforced,
        "added_edges": added_edges,
        "k_hubs": k_hubs,
        "max_distance_km": max_distance_km,
        "attack_strategy": attack_strategy,
        "attack_original": attack_original,
        "attack_reinforced": attack_reinforced,
    }


@router.get("/defense/impact-schneider")
async def get_defense_impact_schneider(
    max_trials: int = Query(20000, description="Maximum number of swap trials"),
    patience: int = Query(5000, description="Stop if no improvement after N trials"),
    attack_strategy: str = Query("degree_targeted_attack", description="Attack strategy to test"),
    minLat: Optional[float] = Query(None),
    maxLat: Optional[float] = Query(None),
    minLon: Optional[float] = Query(None),
    maxLon: Optional[float] = Query(None)
):
    """
    Get Schneider defense impact (edge swapping method).
    
    Schneider defense:
    - Swaps edges to create "onion-like" structure (connect similar-degree nodes)
    - Preserves number of nodes and edges (only swaps, no add/remove)
    - Optimizes R-index (robustness index) by trying many swaps
    """
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G = app_state.get_active_graph()
    if G is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Filter by bbox (default to Southeast Asia)
    bbox = None
    if any([minLat, maxLat, minLon, maxLon]):
        bbox = {
            "minLat": minLat,
            "maxLat": maxLat,
            "minLon": minLon,
            "maxLon": maxLon
        }
        G = filter_graph_by_bbox(G, bbox)
    else:
        bbox = {"minLat": -10, "maxLat": 30, "minLon": 90, "maxLon": 150}
        G = filter_graph_by_bbox(G, bbox)
    
    if len(G) == 0:
        raise HTTPException(400, "No nodes in region")
    
    print(f"Computing Schneider defense impact: max_trials={max_trials}, patience={patience}")
    
    # IMPORTANT: Filter to LCC only (matching notebook implementation)
    from app.metrics import get_lcc
    lcc_nodes = get_lcc(G)
    G_lcc = G.subgraph(lcc_nodes).copy()
    N0_original = len(G_lcc)
    
    print(f"Working on LCC: {N0_original} nodes (original graph had {len(G)} nodes)")
    
    # Apply Schneider defense (works on LCC and returns LCC)
    G_optimized, schneider_info = reinforce_graph_schneider(
        G_lcc,
        max_trials=max_trials,
        patience=patience,
        seed=123
    )
    
    # Verify both graphs have the same number of nodes (both should be LCC)
    if len(G_optimized) != N0_original:
        print(f"Warning: Optimized graph has {len(G_optimized)} nodes, LCC has {N0_original} nodes")
    else:
        print(f"Verified: Both graphs have {N0_original} nodes")
    
    # Note: Schneider swaps edges, so edge count may change slightly
    swapped_edges_info = {
        "original_edges": G_lcc.number_of_edges(),
        "optimized_edges": G_optimized.number_of_edges(),
        "accepted_swaps": schneider_info.get("accepted_swaps", 0),
        "R_best": schneider_info.get("R_best_static", 0.0),
    }
    
    # Use LCC for both original and optimized (both have same nodes)
    baseline_original = get_stats(G_lcc)
    baseline_optimized = get_stats(G_optimized)
    
    fractions = [round(i * 0.05, 2) for i in range(11)]
    
    # Test attack on both (both will normalize by N0_original, which is the same)
    print(f"Testing {attack_strategy} on original LCC (N0={N0_original})...")
    attack_original = simulate_attack(G_lcc, attack_strategy, fractions=fractions, n_runs=1)
    
    print(f"Testing {attack_strategy} on Schneider-optimized LCC (N0={len(G_optimized)})...")
    attack_optimized = simulate_attack(G_optimized, attack_strategy, fractions=fractions, n_runs=1)
    
    return {
        "baseline_original": baseline_original,
        "baseline_optimized": baseline_optimized,
        "swapped_edges_info": swapped_edges_info,
        "schneider_info": schneider_info,
        "attack_strategy": attack_strategy,
        "attack_original": attack_original,
        "attack_optimized": attack_optimized,
    }


@router.get("/case/route-metrics")
async def route_metrics(
    src_iata: str = Query(..., description="Source airport IATA code, e.g. 'FRA'"),
    dst_iata: str = Query(..., description="Destination airport IATA code, e.g. 'SGN'"),
    with_defense: bool = Query(False, description="Also evaluate on reinforced graph"),
):
    """
    Case-study metric: đường đi A -> B.

    - Đo số bước (hops) và số đường đi ngắn nhất giữa 2 sân bay.
    - Tuỳ chọn: so sánh trước/sau khi thêm defense (reinforce_graph).
    """
    import networkx as nx

    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G_full = app_state.get_active_graph()
    if G_full is None:
        raise HTTPException(400, "Graph not loaded")

    # Ensure edge weights for weighted routing
    G_full = _ensure_edge_weights(G_full.copy())

    # Tìm node id theo IATA
    def find_airport_id(iata: str) -> int:
        iata_up = iata.strip().upper()
        for node_id, data in G_full.nodes(data=True):
            if str(data.get("iata", "")).upper() == iata_up:
                return int(node_id)
        raise HTTPException(404, f"Airport with IATA '{iata}' not found")

    try:
        src_id = find_airport_id(src_iata)
        dst_id = find_airport_id(dst_iata)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Error looking up airports: {e}")

    def compute_metrics(G):
        try:
            path = nx.shortest_path(G, source=src_id, target=dst_id)
            hops = len(path) - 1
            # Đếm số đường đi ngắn nhất (độ dài = hops)
            num_shortest = 0
            for _p in nx.all_shortest_paths(G, source=src_id, target=dst_id):
                num_shortest += 1
            path_iata = [G.nodes[n].get("iata", str(n)) for n in path]
            return {
                "connected": True,
                "hops": hops,
                "num_shortest_paths": num_shortest,
                "path_iata": path_iata,
            }
        except nx.NetworkXNoPath:
            return {
                "connected": False,
                "hops": None,
                "num_shortest_paths": 0,
                "path_iata": [],
            }

    baseline = compute_metrics(G_full)

    defense_metrics = None
    added_edges = 0
    if with_defense:
        # Work on the connected component that actually contains src and dst.
        # If no path exists between src and dst, do NOT raise; just skip defense metrics.
        import networkx as nx
        if nx.has_path(G_full, src_id, dst_id):
            comp_nodes = nx.node_connected_component(G_full, src_id)
            G_comp = G_full.subgraph(comp_nodes).copy()

            # Reinforce the connected component (TER method expects a connected graph)
            G_def, added_edges_list = add_edges_by_effective_resistance(
                G_comp,
                k=10,
                max_candidates=2000,
                max_distance_km=3000,
                seed=123,
            )
            added_edges = len(added_edges_list)
            defense_metrics = compute_metrics(G_def)
        else:
            # Keep defense_metrics=None when src/dst are disconnected
            defense_metrics = None
            added_edges = 0

    return {
        "src_iata": src_iata.upper(),
        "dst_iata": dst_iata.upper(),
        "baseline": baseline,
        "with_defense": defense_metrics,
        "added_edges": added_edges,
    }


def _ensure_edge_weights(G: nx.Graph) -> nx.Graph:
    """
    Đảm bảo tất cả edges có trọng số 'weight' (khoảng cách km).
    Nếu chưa có, tính từ distance_km hoặc từ tọa độ.
    """
    from geopy.distance import great_circle
    
    for u, v, data in G.edges(data=True):
        if "weight" not in data:
            # Thử dùng distance_km nếu có
            if "distance_km" in data and data["distance_km"] is not None:
                data["weight"] = float(data["distance_km"])
            else:
                # Tính từ tọa độ
                u_data = G.nodes[u]
                v_data = G.nodes[v]
                if "lat" in u_data and "lon" in u_data and "lat" in v_data and "lon" in v_data:
                    try:
                        dist = great_circle(
                            (u_data["lat"], u_data["lon"]),
                            (v_data["lat"], v_data["lon"])
                        ).kilometers
                        data["weight"] = dist
                    except:
                        data["weight"] = 99999.0
                else:
                    data["weight"] = 99999.0
    return G


@router.get("/case/route-attack-simulation")
async def route_attack_simulation(
    src_iata: str = Query(..., description="Source airport IATA code"),
    dst_iata: str = Query(..., description="Destination airport IATA code"),
    with_defense: bool = Query(True, description="Also evaluate on defended graph"),
    defense_method: str = Query("TER", description="Defense method: TER or Schneider"),
    defense_k: int = Query(500, description="Number of backup edges to add for TER defense"),
    combo_iata: Optional[str] = Query(None, description="Optional comma-separated IATA codes to remove together for the combo attack (e.g., 'DUB,GLA')"),
    debug: bool = Query(False, description="Return debug info for combo scenario"),
):
    """
    Adaptive attack simulation: Tấn công từng node trên đường đi và so sánh Original vs Defended.
    
    Trả về:
    - Baseline route (không tấn công)
    - Kết quả khi tấn công từng transit node
    - Kết quả khi tấn công combo nodes
    - Bar chart data để vẽ biểu đồ so sánh
    """
    import networkx as nx
    
    if app_state.graph is None:
        raise HTTPException(400, "Graph not loaded")
    G_full = app_state.get_active_graph()
    if G_full is None:
        raise HTTPException(400, "Graph not loaded")
    
    # Đảm bảo edges có weight
    G_full = _ensure_edge_weights(G_full.copy())
    
    # Tìm node id theo IATA
    def find_airport_id(iata: str) -> int:
        iata_up = iata.strip().upper()
        for node_id, data in G_full.nodes(data=True):
            if str(data.get("iata", "")).upper() == iata_up:
                return int(node_id)
        raise HTTPException(404, f"Airport with IATA '{iata}' not found")
    
    try:
        src_id = find_airport_id(src_iata)
        dst_id = find_airport_id(dst_iata)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Error looking up airports: {e}")
    
    # Tìm đường đi ban đầu
    try:
        path = nx.shortest_path(G_full, source=src_id, target=dst_id, weight="weight")
        baseline_distance = nx.shortest_path_length(G_full, source=src_id, target=dst_id, weight="weight")
        path_iata = [G_full.nodes[n].get("iata", str(n)) for n in path]
    except nx.NetworkXNoPath:
        raise HTTPException(400, f"No path found between {src_iata} and {dst_iata}")
    
    # Lấy các transit nodes (bỏ src và dst)
    transit_ids = path[1:-1] if len(path) > 2 else []
    transit_iata = [G_full.nodes[nid].get("iata", str(nid)) for nid in transit_ids]

    # Xác định combo attack targets
    combo_targets_iata: List[str] = []
    cfn_neighbors_iata: List[str] = []
    if combo_iata:
        combo_targets_iata = [c.strip().upper() for c in combo_iata.split(',') if c.strip()]
    elif src_iata.strip().upper() == "CFN" or dst_iata.strip().upper() == "CFN":
        # Donegal study: always test DUB + GLA
        combo_targets_iata = ["DUB", "GLA"]
    else:
        combo_targets_iata = transit_iata[:2]

    # Map combo IATA -> node ids (chỉ lấy những node tồn tại trong graph)
    combo_targets_ids: List[int] = []
    for code in combo_targets_iata:
        try:
            nid = [n for n, d in G_full.nodes(data=True) if str(d.get("iata", "")).upper() == code]
            if len(nid) > 0:
                combo_targets_ids.append(int(nid[0]))
        except Exception:
            pass
    
    # Chuẩn bị defended graph nếu cần
    G_def = None
    if with_defense:
        from app.metrics import get_lcc
        lcc_nodes = get_lcc(G_full)
        G_lcc = G_full.subgraph(lcc_nodes).copy()
        
        if src_id not in G_lcc or dst_id not in G_lcc:
            raise HTTPException(400, f"Airports {src_iata} and/or {dst_iata} are not in the largest connected component")
        
        if defense_method == "TER":
            # Allow configuring how many backup edges to add; higher k makes defended graph more robust
            G_def, _ = add_edges_by_effective_resistance(
                G_lcc,
                k=defense_k,
                max_candidates=min(20000, defense_k * 100),
                max_distance_km=3000,
                seed=123
            )
        elif defense_method == "Schneider":
            G_def, _ = reinforce_graph_schneider(
                G_lcc,
                max_trials=10000,
                patience=3000,
                seed=123
            )
        else:
            raise HTTPException(400, f"Unknown defense method: {defense_method}")
        
        G_def = _ensure_edge_weights(G_def)

    # Nếu là kịch bản CFN và có combo targets, đảm bảo defended có ít nhất 1 đường dự phòng sau khi xoá combo
    if G_def and (src_iata.strip().upper() == "CFN" or dst_iata.strip().upper() == "CFN") and len(combo_targets_ids) >= 1:
        try:
            import math
            from geopy.distance import great_circle
            CFN_CODE = "CFN"
            # Xác định id CFN theo đầu mút
            cfn_id = src_id if str(G_full.nodes[src_id].get("iata", "")).upper() == CFN_CODE else dst_id
            # Nếu sau khi xoá combo mà vẫn còn đường thì không cần ép thêm cạnh
            G_check = G_def.copy()
            G_check.remove_nodes_from(combo_targets_ids)
            if not nx.has_path(G_check, src_id, dst_id):
                # Tìm ứng viên gần nhất để nối CFN (không phải các node combo)
                candidates = [n for n in G_def.nodes if n not in set(combo_targets_ids + [cfn_id])]
                best = None
                best_dist = float('inf')
                cfn_lat = G_def.nodes[cfn_id].get('lat'); cfn_lon = G_def.nodes[cfn_id].get('lon')
                if cfn_lat is not None and cfn_lon is not None:
                    for n in candidates:
                        lat = G_def.nodes[n].get('lat'); lon = G_def.nodes[n].get('lon')
                        if lat is None or lon is None:
                            continue
                        try:
                            dkm = great_circle((cfn_lat, cfn_lon), (lat, lon)).kilometers
                        except Exception:
                            continue
                        if dkm < best_dist:
                            best = n; best_dist = dkm
                # Nối cạnh dự phòng nếu tìm được ứng viên
                if best is not None and math.isfinite(best_dist):
                    G_def.add_edge(cfn_id, best, distance_km=best_dist, weight=float(best_dist))
        except Exception as _:
            pass
    
    # Hàm tính path length sau khi tấn công
    def attack_and_measure(G, attack_node_ids):
        G_attack = G.copy()
        G_attack.remove_nodes_from(attack_node_ids)
        try:
            new_path = nx.shortest_path(G_attack, source=src_id, target=dst_id, weight="weight")
            new_dist = nx.shortest_path_length(G_attack, source=src_id, target=dst_id, weight="weight")
            new_path_iata = [G.nodes[n].get("iata", str(n)) for n in new_path]
            return {
                "connected": True,
                "distance_km": new_dist,
                "path_iata": new_path_iata,
                "hops": len(new_path) - 1
            }
        except nx.NetworkXNoPath:
            return {
                "connected": False,
                "distance_km": None,
                "path_iata": [],
                "hops": None
            }
    
    # Baseline (không tấn công)
    baseline_original = {
        "connected": True,
        "distance_km": baseline_distance,
        "path_iata": path_iata,
        "hops": len(path) - 1
    }
    
    baseline_defended = None
    if G_def:
        try:
            def_path = nx.shortest_path(G_def, source=src_id, target=dst_id, weight="weight")
            def_dist = nx.shortest_path_length(G_def, source=src_id, target=dst_id, weight="weight")
            baseline_defended = {
                "connected": True,
                "distance_km": def_dist,
                "path_iata": [G_def.nodes[n].get("iata", str(n)) for n in def_path],
                "hops": len(def_path) - 1
            }
        except nx.NetworkXNoPath:
            baseline_defended = {
                "connected": False,
                "distance_km": None,
                "path_iata": [],
                "hops": None
            }
    
    # Kết quả tấn công từng node
    attack_results = []
    
    # Scenario 0: Baseline
    attack_results.append({
        "scenario": "Baseline",
        "target_iata": None,
        "target_ids": [],
        "original": baseline_original,
        "defended": baseline_defended
    })
    
    # Scenario 1..N: Tấn công từng transit node
    for transit_id, transit_code in zip(transit_ids, transit_iata):
        orig_result = attack_and_measure(G_full, [transit_id])
        def_result = None
        if G_def:
            def_result = attack_and_measure(G_def, [transit_id])
        
        attack_results.append({
            "scenario": f"Remove {transit_code}",
            "target_iata": transit_code,
            "target_ids": [transit_id],
            "original": orig_result,
            "defended": def_result
        })
    
    # Scenario Combo: sử dụng danh sách combo được chọn (ưu tiên tham số hoặc CFN => DUB+GLA)
    if len(combo_targets_ids) >= 1:
        orig_result = attack_and_measure(G_full, combo_targets_ids)
        def_result = None
        if G_def:
            def_result = attack_and_measure(G_def, combo_targets_ids)
        combo_label = f"Combo: {', '.join(combo_targets_iata)}" if combo_targets_iata else "Combo"
        attack_results.append({
            "scenario": combo_label,
            "target_iata": ", ".join(combo_targets_iata) if combo_targets_iata else None,
            "target_ids": combo_targets_ids,
            "original": orig_result,
            "defended": def_result
        })
    
    # Chuẩn bị data cho bar chart
    chart_data = []
    labels = []
    for result in attack_results:
        labels.append(result["scenario"])
        orig_dist = result["original"]["distance_km"] if result["original"]["connected"] else None
        def_dist = result["defended"]["distance_km"] if result["defended"] and result["defended"]["connected"] else None
        
        chart_data.append({
            "scenario": result["scenario"],
            "original_km": orig_dist,
            "defended_km": def_dist,
            "original_connected": result["original"]["connected"],
            "defended_connected": result["defended"]["connected"] if result["defended"] else None
        })
    
    return {
        "src_iata": src_iata.upper(),
        "dst_iata": dst_iata.upper(),
        "baseline_original": baseline_original,
        "baseline_defended": baseline_defended,
        "transit_nodes": transit_iata,
        "attack_results": attack_results,
        "chart_data": chart_data,
        "labels": labels,
        "defense_method": defense_method if with_defense else None
    }

