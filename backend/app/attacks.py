"""Attack strategies - Optimized for Southeast Asia"""
import networkx as nx
import numpy as np
from typing import List, Literal, Dict
from app.metrics import get_stats, get_lcc, lcc_size, diameter

def random_attack(G: nx.Graph, k: int, seed: int = None) -> List[int]:
    """Random node removal"""
    if seed is not None:
        np.random.seed(seed)
    nodes = list(G.nodes())
    if len(nodes) == 0:
        return []
    return np.random.choice(nodes, size=min(k, len(nodes)), replace=False).tolist()

def degree_targeted_attack(G: nx.Graph, k: int, adaptive: bool = True) -> List[int]:
    """Targeted attack: always remove node with highest degree"""
    removed = []
    G_copy = G.copy()
    
    for _ in range(min(k, len(G))):
        if len(G_copy) == 0:
            break
        degrees = dict(G_copy.degree())
        if not degrees:
            break
        target = max(degrees.items(), key=lambda x: x[1])[0]
        removed.append(target)
        if adaptive:
            G_copy.remove_node(target)
    
    return removed

def betweenness_targeted_attack(G: nx.Graph, k: int, adaptive: bool = True) -> List[int]:
    """Targeted attack: always remove node with highest betweenness centrality"""
    removed = []
    G_copy = G.copy()
    
    for _ in range(min(k, len(G))):
        if len(G_copy) < 2:
            break
        try:
            # Use approximation for large graphs to speed up
            if len(G_copy) > 100:
                sample_size = min(100, len(G_copy))
                betweenness = nx.betweenness_centrality(G_copy, k=sample_size)
            else:
                betweenness = nx.betweenness_centrality(G_copy)
            if not betweenness:
                break
            target = max(betweenness.items(), key=lambda x: x[1])[0]
            removed.append(target)
            if adaptive:
                G_copy.remove_node(target)
        except Exception as e:
            print(f"Error in betweenness_targeted_attack: {e}")
            break
    
    return removed

def simulate_attack(
    G: nx.Graph, 
    strategy: str, 
    fractions: List[float] = None,
    n_runs: int = 1,
    seed: int = None
) -> Dict:
    """Simulate attack and return robustness curves
    
    Args:
        G: NetworkX graph
        strategy: 'random_attack', 'degree_targeted_attack', 'betweenness_targeted_attack'
        fractions: List of fractions to remove (e.g., [0.0, 0.1, 0.2, ..., 1.0])
        n_runs: Number of runs for averaging (only for random_attack)
        seed: Random seed
    
    Returns:
        Dict with keys:
            - fraction_removed: List of fractions
            - relative_lcc_size: List of relative LCC sizes
            - diameter: List of diameters
    """
    if len(G) == 0:
        return {
            "fraction_removed": [],
            "relative_lcc_size": [],
            "diameter": []
        }
    
    # Default fractions: 0 to 0.5 in steps of 0.05 (11 points)
    if fractions is None:
        fractions = [round(i * 0.05, 2) for i in range(11)]  # [0.0, 0.05, ..., 0.5]
    
    original_size = len(G)
    results = {
        "fraction_removed": [],
        "relative_lcc_size": [],
        "diameter": []
    }
    
    # For random attack, average over n_runs
    if strategy == "random_attack" and n_runs > 1:
        all_lcc = {f: [] for f in fractions}
        all_diameter = {f: [] for f in fractions}
        
        for run in range(n_runs):
            run_seed = seed + run if seed is not None else None
            G_copy = G.copy()
            
            # Pre-select all nodes to remove for this run
            if strategy == "random_attack":
                all_nodes = random_attack(G_copy, original_size, seed=run_seed)
            
            current_removed = 0
            for fraction in fractions:
                target_removed = int(fraction * original_size)
                
                # Remove nodes up to target
                while current_removed < target_removed and all_nodes:
                    node = all_nodes.pop(0)
                    if node in G_copy:
                        G_copy.remove_node(node)
                        current_removed += 1
                
                # Calculate metrics
                stats = get_stats(G_copy)
                all_lcc[fraction].append(stats["lcc_norm"])
                all_diameter[fraction].append(stats["diameter"])
        
        # Average results
        for fraction in fractions:
            results["fraction_removed"].append(fraction)
            results["relative_lcc_size"].append(np.mean(all_lcc[fraction]))
            results["diameter"].append(np.mean(all_diameter[fraction]))
    
    else:
        # Single run for targeted attacks
        G_copy = G.copy()
        current_removed = 0
        
        # Pre-select nodes based on strategy
        if strategy == "random_attack":
            all_nodes = random_attack(G_copy, original_size, seed=seed)
        elif strategy == "degree_targeted_attack":
            all_nodes = degree_targeted_attack(G_copy, original_size, adaptive=True)
        elif strategy == "betweenness_targeted_attack":
            all_nodes = betweenness_targeted_attack(G_copy, original_size, adaptive=True)
        else:
            all_nodes = []
        
        for fraction in fractions:
            target_removed = int(fraction * original_size)
            
            # Remove nodes up to target
            while current_removed < target_removed and all_nodes:
                node = all_nodes.pop(0)
                if node in G_copy:
                    G_copy.remove_node(node)
                    current_removed += 1
            
            # Calculate metrics
            stats = get_stats(G_copy)
            results["fraction_removed"].append(fraction)
            results["relative_lcc_size"].append(stats["lcc_norm"])
            results["diameter"].append(stats["diameter"])
    
    return results
