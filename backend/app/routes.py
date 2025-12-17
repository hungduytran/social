"""API routes"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from app.state import app_state
from app.metrics import get_stats
from app.attacks import (
    simulate_attack,
    random_attack,
    degree_targeted_attack,
    betweenness_targeted_attack,
    pagerank_targeted_attack,
)
from app.defense import reinforce_graph
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
    
    print(f"Computing defense impact for {len(G)} nodes")
    
    # Reinforce graph
    G_reinforced = reinforce_graph(G, k=k_hubs, max_distance_km=2000)
    print(f"Reinforced graph: {G_reinforced.number_of_edges()} edges (original: {G.number_of_edges()})")
    
    baseline_original = get_stats(G)
    baseline_reinforced = get_stats(G_reinforced)
    
    fractions = [round(i * 0.05, 2) for i in range(11)]
    
    # Test degree attack on both
    print("Testing degree attack on original graph...")
    degree_original = simulate_attack(G, "degree_targeted_attack", fractions=fractions, n_runs=1)
    
    print("Testing degree attack on reinforced graph...")
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
    
    # Reinforce graph
    G_reinforced = reinforce_graph(G, k=k_hubs, max_distance_km=max_distance_km)
    added_edges = G_reinforced.number_of_edges() - G.number_of_edges()
    
    baseline_original = get_stats(G)
    baseline_reinforced = get_stats(G_reinforced)
    
    fractions = [round(i * 0.05, 2) for i in range(11)]
    
    # Test attack on both
    print(f"Testing {attack_strategy} on original graph...")
    attack_original = simulate_attack(G, attack_strategy, fractions=fractions, n_runs=1)
    
    print(f"Testing {attack_strategy} on reinforced graph...")
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
        G_def = reinforce_graph(G_full, k=10, max_distance_km=3000)
        added_edges = G_def.number_of_edges() - G_full.number_of_edges()
        defense_metrics = compute_metrics(G_def)

    return {
        "src_iata": src_iata.upper(),
        "dst_iata": dst_iata.upper(),
        "baseline": baseline,
        "with_defense": defense_metrics,
        "added_edges": added_edges,
    }

