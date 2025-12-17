"""Attack strategies - inspired by b4_airline_robustness_nhom3.py"""

import networkx as nx
import numpy as np
from typing import List, Dict

from app.metrics import get_stats, get_lcc, diameter


def random_attack(G: nx.Graph, k: int, seed: int = None) -> List[int]:
    """Random node removal."""
    if seed is not None:
        np.random.seed(seed)
    nodes = list(G.nodes())
    if len(nodes) == 0:
        return []
    return np.random.choice(nodes, size=min(k, len(nodes)), replace=False).tolist()


def degree_targeted_attack(G: nx.Graph, k: int, adaptive: bool = True) -> List[int]:
    """Targeted attack: luôn xoá node có degree cao nhất hiện tại."""
    removed: List[int] = []
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


def pagerank_targeted_attack(G: nx.Graph, k: int, adaptive: bool = True) -> List[int]:
    """
    Targeted attack theo PageRank:
    - Luôn xoá node có PageRank cao nhất trên đồ thị hiện tại.
    - Nếu PageRank không hội tụ, fallback về degree.
    """
    removed: List[int] = []
    G_copy = G.copy()

    for _ in range(min(k, len(G))):
        if len(G_copy) == 0:
            break
        try:
            pr = nx.pagerank(G_copy, alpha=0.85)
        except Exception:
            # Fallback: degree nếu PageRank không hội tụ
            pr = dict(G_copy.degree())
        if not pr:
            break
        target = max(pr.items(), key=lambda x: x[1])[0]
        removed.append(target)
        if adaptive:
            G_copy.remove_node(target)

    return removed


def betweenness_targeted_attack(G: nx.Graph, k: int, adaptive: bool = True) -> List[int]:
    """
    Targeted attack: luôn xoá node có betweenness centrality cao nhất.
    Dùng xấp xỉ cho đồ thị lớn để tránh timeout.
    """
    removed: List[int] = []
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
    seed: int = None,
) -> Dict:
    """
    Simulate attack and return robustness curves (LCC, diameter).

    Args:
        G: NetworkX graph
        strategy:
            - 'random_attack'
            - 'degree_targeted_attack'
            - 'pagerank_targeted_attack'
            - 'betweenness_targeted_attack'
        fractions: List các tỉ lệ node bị xoá (vd: [0.0, 0.1, 0.2, ...]).
        n_runs: số lần lặp để lấy trung bình (chỉ dùng cho random_attack).
        seed: random seed.

    Returns:
        Dict với các keys:
            - fraction_removed
            - relative_lcc_size
            - diameter
    """
    if len(G) == 0:
        return {
            "fraction_removed": [],
            "relative_lcc_size": [],
            "diameter": [],
        }

    # Default fractions: 0 -> 0.5, bước 0.05 (11 điểm)
    if fractions is None:
        fractions = [round(i * 0.05, 2) for i in range(11)]

    original_size = len(G)
    # IMPORTANT: Normalize LCC size theo số node ban đầu (N0), không phải số node hiện tại
    # Để đảm bảo khi so sánh Original vs Reinforced, cả 2 đều bắt đầu từ 1.0
    N0 = original_size
    
    results: Dict[str, list] = {
        "fraction_removed": [],
        "relative_lcc_size": [],
        "diameter": [],
    }

    # Random attack: average qua nhiều runs
    if strategy == "random_attack" and n_runs > 1:
        all_lcc = {f: [] for f in fractions}
        all_diameter = {f: [] for f in fractions}

        for run in range(n_runs):
            run_seed = seed + run if seed is not None else None
            G_copy = G.copy()

            # Pre-select toàn bộ thứ tự xoá node cho run này
            all_nodes = random_attack(G_copy, original_size, seed=run_seed)

            current_removed = 0
            local_nodes = list(all_nodes)
            for fraction in fractions:
                target_removed = int(fraction * original_size)

                # Remove nodes up to target
                while current_removed < target_removed and local_nodes:
                    node = local_nodes.pop(0)
                    if node in G_copy:
                        G_copy.remove_node(node)
                        current_removed += 1

                # Calculate LCC size normalized by N0 (original size), not current size
                lcc_nodes = get_lcc(G_copy)
                lcc_size_normalized = len(lcc_nodes) / N0 if N0 > 0 else 0.0
                diameter_val = diameter(G_copy)
                
                all_lcc[fraction].append(lcc_size_normalized)
                all_diameter[fraction].append(diameter_val)

        # Lấy trung bình
        for fraction in fractions:
            results["fraction_removed"].append(fraction)
            results["relative_lcc_size"].append(float(np.mean(all_lcc[fraction])))
            results["diameter"].append(float(np.mean(all_diameter[fraction])))

    else:
        # Single run cho các chiến lược targeted
        G_copy = G.copy()
        current_removed = 0

        # Pre-select nodes theo strategy
        if strategy == "random_attack":
            all_nodes = random_attack(G_copy, original_size, seed=seed)
        elif strategy == "degree_targeted_attack":
            all_nodes = degree_targeted_attack(G_copy, original_size, adaptive=True)
        elif strategy == "pagerank_targeted_attack":
            all_nodes = pagerank_targeted_attack(G_copy, original_size, adaptive=True)
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

            # Calculate LCC size normalized by N0 (original size), not current size
            lcc_nodes = get_lcc(G_copy)
            lcc_size_normalized = len(lcc_nodes) / N0 if N0 > 0 else 0.0
            diameter_val = diameter(G_copy)
            
            results["fraction_removed"].append(fraction)
            results["relative_lcc_size"].append(lcc_size_normalized)
            results["diameter"].append(diameter_val)

    return results
