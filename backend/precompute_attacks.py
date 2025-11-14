"""Pre-compute attack analysis results for all regions"""
import json
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.state import app_state
from app.loader import load_and_build_graph
from app.filter import filter_graph_by_bbox
from app.attacks import simulate_attack
from app.metrics import get_stats

# Define regions
REGIONS = {
    'southeast-asia': {
        'name': 'Đông Nam Á',
        'bbox': {'minLat': -10, 'maxLat': 30, 'minLon': 90, 'maxLon': 150}
    },
    'asia': {
        'name': 'Châu Á',
        'bbox': {'minLat': -10, 'maxLat': 55, 'minLon': 60, 'maxLon': 150}
    },
    'europe': {
        'name': 'Châu Âu',
        'bbox': {'minLat': 35, 'maxLat': 72, 'minLon': -15, 'maxLon': 40}
    },
    'north-america': {
        'name': 'Bắc Mỹ',
        'bbox': {'minLat': 15, 'maxLat': 72, 'minLon': -170, 'maxLon': -50}
    }
}

def precompute_region(region_key: str, region_data: dict, k: int = 5):
    """Pre-compute attack analysis for a region"""
    print(f"\n=== Pre-computing {region_data['name']} ===")
    
    # Filter graph by bbox
    bbox = region_data.get('bbox')
    if bbox:
        G = filter_graph_by_bbox(app_state.graph, bbox)
    else:
        G = app_state.graph.copy()
    
    if len(G) == 0:
        print(f"  No nodes in region, skipping...")
        return None
    
    print(f"  Graph size: {len(G)} nodes, {G.number_of_edges()} edges")
    
    baseline = get_stats(G)
    print(f"  Baseline: LCC={baseline['lcc_norm']:.3f}, ASPL={baseline['aspl']:.2f}")
    
    results = {
        'region': region_key,
        'region_name': region_data['name'],
        'baseline': baseline,
        'k': k
    }
    
    # Random attack
    print(f"  Computing random attack...")
    try:
        random_curve = simulate_attack(G, "random", k, seed=42)
        results['random'] = random_curve
        print(f"    OK Random: {len(random_curve)} points")
    except Exception as e:
        print(f"    ERROR Random failed: {e}")
        results['random'] = []
    
    # Degree attack
    print(f"  Computing degree attack...")
    try:
        degree_curve = simulate_attack(G, "degree", k, adaptive=True)
        results['degree'] = degree_curve
        print(f"    OK Degree: {len(degree_curve)} points")
    except Exception as e:
        print(f"    ERROR Degree failed: {e}")
        results['degree'] = []
    
    # Betweenness attack (only for small graphs)
    results['betweenness'] = []
    if len(G) <= 50:
        print(f"  Computing betweenness attack...")
        try:
            betweenness_curve = simulate_attack(G, "betweenness", k, adaptive=True)
            results['betweenness'] = betweenness_curve
            print(f"    OK Betweenness: {len(betweenness_curve)} points")
        except Exception as e:
            print(f"    ERROR Betweenness failed: {e}")
    else:
        print(f"  Skipping betweenness (graph too large: {len(G)} nodes)")
    
    return results

def main():
    """Main pre-computation function"""
    print("Loading graph...")
    
    # Try to load graph
    paths = [
        "../openflights/data",
        "openflights/data",
        "../../openflights/data"
    ]
    
    for base_path in paths:
        airports_path = os.path.join(base_path, "airports.dat")
        routes_path = os.path.join(base_path, "routes.dat")
        
        if os.path.exists(airports_path) and os.path.exists(routes_path):
            try:
                app_state.graph = load_and_build_graph(airports_path, routes_path)
                print(f"✓ Loaded graph: {len(app_state.graph)} nodes, {app_state.graph.number_of_edges()} edges")
                break
            except Exception as e:
                print(f"Error loading from {base_path}: {e}")
    
    if app_state.graph is None:
        print("ERROR: Could not load graph!")
        return
    
    # Pre-compute for each region
    all_results = {}
    
    for region_key, region_data in REGIONS.items():
        try:
            result = precompute_region(region_key, region_data, k=5)
            if result:
                all_results[region_key] = result
        except Exception as e:
            print(f"ERROR computing {region_key}: {e}")
            continue
    
    # Save to file
    output_file = "precomputed_attacks.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    
    print(f"\nSaved results to {output_file}")
    print(f"  Regions computed: {len(all_results)}")

if __name__ == "__main__":
    main()

