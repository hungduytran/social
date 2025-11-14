"""Network metrics"""
import networkx as nx

def get_lcc(G: nx.Graph):
    """Largest connected component"""
    if len(G) == 0:
        return set()
    return max(nx.connected_components(G), key=len, default=set())

def lcc_size(G: nx.Graph) -> float:
    """Normalized LCC size"""
    if len(G) == 0:
        return 0.0
    return len(get_lcc(G)) / len(G)

def diameter(G: nx.Graph) -> float:
    """Diameter of LCC"""
    lcc_nodes = get_lcc(G)
    if len(lcc_nodes) < 2:
        return 0.0
    lcc = G.subgraph(lcc_nodes)
    try:
        return nx.diameter(lcc)
    except:
        return 0.0

def aspl(G: nx.Graph) -> float:
    """Average shortest path length"""
    lcc_nodes = get_lcc(G)
    if len(lcc_nodes) < 2:
        return 0.0
    lcc = G.subgraph(lcc_nodes)
    try:
        return nx.average_shortest_path_length(lcc)
    except:
        return 0.0

def get_stats(G: nx.Graph) -> dict:
    """Get all stats"""
    return {
        "nodes": len(G),
        "edges": G.number_of_edges(),
        "lcc_norm": lcc_size(G),
        "diameter": diameter(G),
        "aspl": aspl(G),
        "components": nx.number_connected_components(G)
    }

