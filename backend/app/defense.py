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


# ============================================================================
# SCHNEIDER DEFENSE (Edge Swapping - Onion-like Structure)
# ============================================================================

class DSU:
    """
    Disjoint Set Union (Union-Find) data structure for efficient connected component tracking.
    
    DSU giúp tính toán LCC (Largest Connected Component) nhanh chóng bằng cách:
    - Theo dõi các node thuộc cùng một component
    - Union 2 components khi có edge kết nối
    - Find root của một node để biết nó thuộc component nào
    
    Tại sao dùng DSU?
    - Khi swap edges, cần tính lại LCC nhiều lần
    - DSU cho phép tính LCC trong O(n) thay vì O(n²) như DFS/BFS
    """
    __slots__ = ("p", "sz")
    
    def __init__(self, n: int):
        """
        Khởi tạo DSU với n nodes.
        
        Args:
            n: Số lượng nodes
        """
        self.p = list(range(n))  # parent[i] = parent của node i
        self.sz = [1] * n         # sz[i] = kích thước component chứa node i
    
    def find(self, a: int) -> int:
        """
        Tìm root của node a (với path compression để tối ưu).
        
        Path compression: khi tìm root, gán tất cả nodes trên đường đi trỏ về root.
        Giúp giảm độ phức tạp từ O(n) xuống gần O(1).
        
        Args:
            a: Index của node cần tìm root
        
        Returns:
            Root của node a
        """
        p = self.p
        while p[a] != a:
            p[a] = p[p[a]]  # Path compression: nhảy 2 bước một lúc
            a = p[a]
        return a
    
    def union(self, a: int, b: int) -> int:
        """
        Union 2 components chứa node a và b (với union by size).
        
        Union by size: luôn gắn component nhỏ hơn vào component lớn hơn.
        Giúp giữ cây cân bằng và giảm độ phức tạp.
        
        Args:
            a, b: Index của 2 nodes cần union
        
        Returns:
            Kích thước của component sau khi union
        """
        pa, pb = self.find(a), self.find(b)
        if pa == pb:
            return self.sz[pa]  # Đã cùng component, không cần union
        
        # Union by size: gắn component nhỏ vào component lớn
        if self.sz[pa] < self.sz[pb]:
            pa, pb = pb, pa
        
        self.p[pb] = pa
        self.sz[pa] += self.sz[pb]
        return self.sz[pa]


def R_index(fracs: np.ndarray, curve: np.ndarray) -> float:
    """
    Tính R-index (Robustness Index) bằng tích phân của robustness curve.
    
    R-index = ∫ S(f) df, với S(f) = LCC size / N0 tại fraction f
    
    R-index càng cao → network càng robust (giữ được LCC lớn khi bị tấn công).
    
    Args:
        fracs: Mảng các fraction values (0.0 đến 1.0)
        curve: Mảng LCC size tương ứng với mỗi fraction
    
    Returns:
        R-index value (diện tích dưới curve)
    """
    return float(np.trapz(curve, fracs))


def _static_order_by_degree(G: nx.Graph) -> List[Any]:
    """
    Tạo thứ tự tấn công static: xóa nodes theo degree từ cao xuống thấp.
    
    Static order: thứ tự này được fix trước, không đổi khi swap edges.
    Điều này quan trọng vì Schneider swap giữ nguyên degree của mỗi node.
    
    Args:
        G: Graph
    
    Returns:
        List các nodes được sắp xếp theo degree giảm dần
    """
    deg = dict(G.degree())
    # Sắp xếp: degree cao nhất trước, nếu cùng degree thì sort theo tên node
    return [n for n, _ in sorted(deg.items(), key=lambda x: (-x[1], str(x[0])))]


def lcc_curve_static_dsu(G: nx.Graph, fracs: np.ndarray, order: List[Any]) -> np.ndarray:
    """
    Tính robustness curve S(f) = |LCC|/N0 cho static-order removal bằng DSU.
    
    Ý tưởng: Thay vì xóa nodes và tính LCC mỗi lần (chậm),
    ta làm ngược lại: bắt đầu từ graph rỗng, thêm nodes ngược lại thứ tự xóa,
    và dùng DSU để track LCC size.
    
    Ví dụ: Nếu order = [A, B, C, D] (xóa A trước, D cuối)
    - Bước 1: Thêm D → LCC = {D} (size=1)
    - Bước 2: Thêm C → LCC = {C, D} nếu có edge (size=2)
    - ...
    - Bước 4: Thêm A → LCC = toàn bộ graph
    
    Args:
        G: Graph
        fracs: Mảng các fraction values (0.0 đến 1.0)
        order: Thứ tự xóa nodes (từ đầu đến cuối)
    
    Returns:
        Mảng LCC size tương ứng với mỗi fraction
    """
    node_list = list(G.nodes())
    idx = {u: i for i, u in enumerate(node_list)}  # node → index mapping
    n = len(node_list)
    if n == 0:
        return np.zeros_like(fracs, dtype=float)
    
    # active[i] = True nếu node i đã được "thêm lại" (trong quá trình add-back)
    active = [False] * n
    dsu = DSU(n)
    max_cc = 0  # Kích thước LCC lớn nhất hiện tại
    
    # lcc_after_k[k] = LCC size khi đã xóa k nodes
    # k removed = n - t active, với t = số nodes đã thêm lại
    lcc_after_k = np.zeros(n + 1, dtype=int)
    lcc_after_k[n] = 0  # Xóa hết → LCC = 0
    
    # Thêm nodes ngược lại thứ tự xóa (add-back process)
    rev = list(reversed(order))  # [D, C, B, A] nếu order = [A, B, C, D]
    
    for t, u in enumerate(rev, start=1):
        iu = idx[u]
        active[iu] = True  # Đánh dấu node u đã active
        
        # Union với các neighbors đã active
        for v in G.adj[u]:
            iv = idx[v]
            if active[iv]:  # Neighbor v đã được thêm trước đó
                # Union u và v → có thể tạo component lớn hơn
                max_cc = max(max_cc, dsu.union(iu, iv))
        
        max_cc = max(max_cc, 1)  # Ít nhất có 1 node (chính u)
        
        # k_removed = số nodes đã xóa = tổng nodes - số nodes đã thêm lại
        k_removed = n - t
        lcc_after_k[k_removed] = max_cc
    
    # Chuyển đổi từ số nodes xóa sang fraction
    ks = np.clip(np.rint(fracs * n).astype(int), 0, n)
    return lcc_after_k[ks].astype(float) / float(n)


def robustness_R_static_fast(G: nx.Graph, fracs: np.ndarray, order: List[Any]) -> float:
    """
    Tính R-index nhanh cho static-order removal.
    
    Args:
        G: Graph
        fracs: Mảng các fraction values
        order: Thứ tự xóa nodes
    
    Returns:
        R-index value
    """
    curve = lcc_curve_static_dsu(G, fracs, order)
    return R_index(fracs, curve)


def optimize_schneider_fast(
    G: nx.Graph,
    fracs: Optional[np.ndarray] = None,
    max_trials: int = 20000,
    patience: int = 5000,
    min_delta_R: float = 1e-6,
    seed: int = 0,
    prefilter: bool = True
) -> Tuple[nx.Graph, Dict[str, Any]]:
    """
    Tối ưu graph bằng Schneider method: swap edges để tạo cấu trúc "onion-like".
    
    Ý tưởng chính:
    - Swap 2 edges: (A-B, C-D) → (A-C, B-D) hoặc (A-D, B-C)
    - Mục tiêu: Kết nối các nodes có degree tương tự (assortative mixing)
    - Giữ nguyên số lượng nodes và edges (chỉ swap, không thêm/xóa)
    - Tối ưu R-index: chọn swap làm tăng robustness nhất
    
    Ví dụ swap:
    - Trước: Hub (degree=10) - Node (degree=2), Hub (degree=10) - Node (degree=2)
    - Sau:  Hub (degree=10) - Hub (degree=10), Node (degree=2) - Node (degree=2)
    → Tạo cấu trúc "onion": hubs kết nối với hubs, nodes kết nối với nodes
    
    Args:
        G: Original graph (sẽ được copy và modify)
        fracs: Mảng fraction values để tính R-index (default: 0.0 đến 0.3, 21 điểm)
        max_trials: Số lần thử swap tối đa
        patience: Dừng nếu không cải thiện sau bao nhiêu lần thử
        min_delta_R: Cải thiện tối thiểu để chấp nhận swap
        seed: Random seed
        prefilter: Nếu True, chỉ thử swap cải thiện degree-mixing (nhanh hơn)
    
    Returns:
        Optimized graph và thông tin về quá trình tối ưu
    """
    if fracs is None:
        fracs = np.linspace(0, 0.3, 21)  # 0.0 đến 0.3, 21 điểm
    
    rng = random.Random(seed)
    Gr = G.copy()  # Copy để không modify graph gốc
    
    # IMPORTANT: Static order được fix vì swap giữ nguyên degree
    # Nếu degree không đổi, thứ tự xóa nodes cũng không đổi
    order = _static_order_by_degree(Gr)
    deg = dict(Gr.degree())  # Lưu degree của mỗi node
    
    # Tính R-index ban đầu
    R_best = robustness_R_static_fast(Gr, fracs, order)
    edges = list(Gr.edges())
    
    accepted = 0      # Số swap được chấp nhận
    no_improve = 0    # Số lần thử không cải thiện liên tiếp
    r_evals = 1       # Số lần tính R-index (đã tính 1 lần ban đầu)
    
    def score_degree_mixing(e1, e2, ne1, ne2) -> int:
        """
        Tính điểm degree-mixing: thấp hơn = tốt hơn (onion-like).
        
        Onion-like: Kết nối nodes có degree tương tự
        - Tốt: Hub-Hub, Node-Node
        - Xấu: Hub-Node (chênh lệch degree lớn)
        
        Args:
            e1, e2: 2 edges cũ (A-B, C-D)
            ne1, ne2: 2 edges mới sau swap (A-C, B-D)
        
        Returns:
            Điểm số: âm = tốt hơn, dương = xấu hơn
        """
        (a, b), (c, d) = e1, e2
        (x1, y1), (x2, y2) = ne1, ne2
        
        # Điểm cũ: tổng chênh lệch degree của 2 edges
        old = abs(deg[a] - deg[b]) + abs(deg[c] - deg[d])
        
        # Điểm mới: tổng chênh lệch degree của 2 edges sau swap
        new = abs(deg[x1] - deg[y1]) + abs(deg[x2] - deg[y2])
        
        return new - old  # Âm = tốt hơn (giảm chênh lệch)
    
    # Vòng lặp tối ưu
    for t in range(1, max_trials + 1):
        # Dừng nếu không cải thiện quá lâu hoặc không đủ edges
        if no_improve >= patience or Gr.number_of_edges() < 2:
            break
        
        # Chọn ngẫu nhiên 2 edges để swap
        e1, e2 = rng.sample(edges, 2)
        
        # Kiểm tra: 2 edges phải có 4 nodes khác nhau
        # Ví dụ: (A-B, A-C) không được vì chỉ có 3 nodes
        if len(set(e1 + e2)) < 4:
            no_improve += 1
            continue
        
        # Thử 2 cách swap:
        # 1. (A-B, C-D) → (A-C, B-D)
        # 2. (A-B, C-D) → (A-D, B-C)
        best_local = None  # (R_new, ne1, ne2)
        
        for ne1, ne2 in [((e1[0], e2[0]), (e1[1], e2[1])),  # Swap variant 1
                         ((e1[0], e2[1]), (e1[1], e2[0]))]:  # Swap variant 2
            
            # Kiểm tra tính hợp lệ của swap
            if ne1[0] == ne1[1] or ne2[0] == ne2[1]:  # Self-loop
                continue
            if Gr.has_edge(*ne1) or Gr.has_edge(*ne2):  # Edge đã tồn tại
                continue
            if set(ne1) == set(ne2):  # 2 edges giống nhau
                continue
            
            # Prefilter: Bỏ qua swap không cải thiện degree-mixing
            if prefilter:
                if score_degree_mixing(e1, e2, ne1, ne2) >= 0:
                    continue  # Không tốt hơn, skip
            
            # Áp dụng swap tạm thời
            Gr.remove_edge(*e1)
            Gr.remove_edge(*e2)
            Gr.add_edge(*ne1)
            Gr.add_edge(*ne2)
            
            # Tính R-index mới
            R_new = robustness_R_static_fast(Gr, fracs, order)
            r_evals += 1
            
            # Revert: hoàn nguyên swap
            Gr.remove_edge(*ne1)
            Gr.remove_edge(*ne2)
            Gr.add_edge(*e1)
            Gr.add_edge(*e2)
            
            # Lưu swap tốt nhất trong 2 variants
            if best_local is None or R_new > best_local[0]:
                best_local = (R_new, ne1, ne2)
        
        # Chấp nhận swap nếu cải thiện đủ lớn
        if best_local is not None and best_local[0] > R_best + min_delta_R:
            R_new, ne1, ne2 = best_local
            
            # Áp dụng swap vĩnh viễn
            Gr.remove_edge(*e1)
            Gr.remove_edge(*e2)
            Gr.add_edge(*ne1)
            Gr.add_edge(*ne2)
            
            R_best = R_new
            accepted += 1
            no_improve = 0
            edges = list(Gr.edges())  # Cập nhật danh sách edges
        else:
            no_improve += 1
    
    info = {
        "R_best_static": float(R_best),
        "accepted_swaps": accepted,
        "trials_done": t,
        "R_evaluations": r_evals,
        "stopped_by_patience": (no_improve >= patience),
        "fracs_points": int(len(fracs)),
        "prefilter": prefilter,
    }
    return Gr, info


def reinforce_graph_schneider(
    G: nx.Graph,
    max_trials: int = 20000,
    patience: int = 5000,
    seed: int = 123
) -> Tuple[nx.Graph, Dict[str, Any]]:
    """
    Wrapper function cho Schneider defense (tương tự reinforce_graph cho TER).
    
    Args:
        G: Original graph
        max_trials: Số lần thử swap tối đa
        patience: Dừng nếu không cải thiện sau bao nhiêu lần
        seed: Random seed
    
    Returns:
        Optimized graph và thông tin
    """
    # Work on LCC only (matching notebook implementation)
    lcc = max(nx.connected_components(G), key=len)
    G_lcc = G.subgraph(lcc).copy()
    
    G_optimized, info = optimize_schneider_fast(
        G_lcc,
        fracs=np.linspace(0, 0.3, 21),
        max_trials=max_trials,
        patience=patience,
        seed=seed,
        prefilter=True
    )
    
    return G_optimized, info
