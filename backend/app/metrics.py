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
    """Diameter of LCC (on LCC only)"""
    lcc_nodes = get_lcc(G)
    if len(lcc_nodes) < 2:
        return 0.0
    lcc = G.subgraph(lcc_nodes)
    try:
        return nx.diameter(lcc)
    except Exception:
        return 0.0


def aspl(G: nx.Graph) -> float:
    """
    Average shortest path length (DISABLED in online app).

    Tính ASPL chính xác trên đồ thị lớn rất tốn thời gian, đặc biệt khi
    mô phỏng nhiều bước tấn công. Theo yêu cầu, trong web demo ta bỏ qua
    metric này để tránh timeout – hàm luôn trả về 0.0.

    Nếu cần phân tích sâu offline, có thể dùng lại notebook
    `b4_airline_robustness_nhom3.py` để tính ASPL chi tiết.
    """
    return 0.0


def get_stats(G: nx.Graph) -> dict:
    """Get all stats used by the API (không tính ASPL để tối ưu thời gian)."""
    return {
        "nodes": len(G),
        "edges": G.number_of_edges(),
        "lcc_norm": lcc_size(G),
        "diameter": diameter(G),
        "aspl": aspl(G),
        "components": nx.number_connected_components(G),
    }

