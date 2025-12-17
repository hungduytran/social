# Giải Thích Chi Tiết: Phương Pháp Phòng Thủ Schneider (Edge Swapping)

## 📋 Tổng Quan

**Schneider Defense** là một phương pháp phòng thủ mạng bằng cách **swap (hoán đổi) edges** để tạo ra cấu trúc "onion-like" (giống như củ hành), giúp mạng lưới **robust hơn** khi bị tấn công.

### So Sánh với TER Defense:

| Đặc điểm | TER Defense | Schneider Defense |
|----------|-------------|-------------------|
| **Phương pháp** | Thêm edges mới | Swap edges hiện có |
| **Số nodes** | Giữ nguyên | Giữ nguyên |
| **Số edges** | Tăng lên (thêm k edges) | Giữ nguyên (chỉ swap) |
| **Mục tiêu** | Thêm backup edges giữa các hubs | Tạo cấu trúc onion (kết nối nodes có degree tương tự) |

---

## 🔍 Chi Tiết Từng Phần Code

### 1. **DSU (Disjoint Set Union) - Cấu Trúc Dữ Liệu**

```python
class DSU:
    def __init__(self, n: int):
        self.p = list(range(n))  # parent[i] = parent của node i
        self.sz = [1] * n         # sz[i] = kích thước component chứa node i
```

**Mục đích:** DSU giúp tính toán **LCC (Largest Connected Component)** nhanh chóng.

**Tại sao cần DSU?**
- Khi swap edges, cần tính lại LCC **nhiều lần** (hàng nghìn lần)
- Dùng DFS/BFS mỗi lần sẽ rất chậm (O(n²))
- DSU cho phép tính LCC trong **O(n)** với path compression

**Cách hoạt động:**
- `find(a)`: Tìm root của node `a` (component mà `a` thuộc về)
- `union(a, b)`: Gộp 2 components chứa `a` và `b` thành 1 component

**Ví dụ:**
```
Ban đầu: 4 nodes độc lập
DSU: [0, 1, 2, 3] (mỗi node là root của chính nó)

Union(0, 1): Gộp node 0 và 1
DSU: [0, 0, 2, 3] (node 1 trỏ về node 0)

Union(2, 3): Gộp node 2 và 3
DSU: [0, 0, 2, 2] (node 3 trỏ về node 2)

Union(0, 2): Gộp 2 components lớn
DSU: [0, 0, 0, 2] (node 2 trỏ về node 0)
→ Tất cả nodes thuộc cùng 1 component
```

---

### 2. **R-index (Robustness Index)**

```python
def R_index(fracs: np.ndarray, curve: np.ndarray) -> float:
    return float(np.trapz(curve, fracs))
```

**Mục đích:** Đo lường **độ robust** của mạng lưới bằng cách tính **diện tích dưới curve**.

**Giải thích:**
- `curve`: Mảng LCC size tại mỗi fraction (0.0 → 1.0)
- `fracs`: Mảng các fraction values
- `np.trapz`: Tính tích phân (diện tích dưới curve)

**Ví dụ:**
```
Fraction:  [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]
LCC size:  [1.0, 0.9, 0.8, 0.6, 0.4, 0.2]

R-index = Diện tích dưới curve
        = (1.0 + 0.9)/2 * 0.1 + (0.9 + 0.8)/2 * 0.1 + ...
        ≈ 0.65

R-index càng cao → Mạng càng robust (giữ được LCC lớn khi bị tấn công)
```

---

### 3. **Static Order (Thứ Tự Tấn Công Cố Định)**

```python
def _static_order_by_degree(G: nx.Graph) -> List[Any]:
    deg = dict(G.degree())
    return [n for n, _ in sorted(deg.items(), key=lambda x: (-x[1], str(x[0])))]
```

**Mục đích:** Tạo thứ tự tấn công **cố định**: xóa nodes theo degree từ cao xuống thấp.

**Tại sao "static" (cố định)?**
- Schneider swap **giữ nguyên degree** của mỗi node
- Nếu degree không đổi → thứ tự xóa nodes cũng không đổi
- Điều này cho phép tính R-index nhanh hơn (không cần tính lại order mỗi lần)

**Ví dụ:**
```
Graph có 5 nodes với degree:
A: 10, B: 8, C: 5, D: 3, E: 2

Static order = [A, B, C, D, E]
→ Xóa A trước, E cuối cùng
```

---

### 4. **LCC Curve Calculation (Tính Robustness Curve)**

```python
def lcc_curve_static_dsu(G: nx.Graph, fracs: np.ndarray, order: List[Any]) -> np.ndarray:
    # Bắt đầu từ graph rỗng, thêm nodes ngược lại thứ tự xóa
    rev = list(reversed(order))  # [E, D, C, B, A] nếu order = [A, B, C, D, E]
    
    for t, u in enumerate(rev, start=1):
        active[iu] = True  # Đánh dấu node u đã được "thêm lại"
        
        # Union với các neighbors đã active
        for v in G.adj[u]:
            if active[iv]:
                max_cc = max(max_cc, dsu.union(iu, iv))
        
        k_removed = n - t  # Số nodes đã xóa
        lcc_after_k[k_removed] = max_cc
```

**Ý tưởng:** Thay vì xóa nodes và tính LCC mỗi lần (chậm), ta làm **ngược lại**:
- Bắt đầu từ graph rỗng
- Thêm nodes **ngược lại** thứ tự xóa
- Dùng DSU để track LCC size

**Ví dụ:**
```
Order = [A, B, C, D, E] (xóa A trước, E cuối)

Bước 1: Thêm E → LCC = {E} (size=1)
Bước 2: Thêm D → LCC = {D, E} nếu có edge (size=2)
Bước 3: Thêm C → LCC = {C, D, E} nếu có edge (size=3)
...
Bước 5: Thêm A → LCC = toàn bộ graph (size=5)

Mapping:
- k_removed = 0 → LCC size = 5 (chưa xóa gì)
- k_removed = 1 → LCC size = 4 (đã xóa A)
- k_removed = 2 → LCC size = 3 (đã xóa A, B)
- ...
```

---

### 5. **Schneider Optimizer (Tối Ưu Hóa)**

```python
def optimize_schneider_fast(G: nx.Graph, ...):
    # Chọn ngẫu nhiên 2 edges để swap
    e1, e2 = rng.sample(edges, 2)
    
    # Thử 2 cách swap:
    # 1. (A-B, C-D) → (A-C, B-D)
    # 2. (A-B, C-D) → (A-D, B-C)
    
    for ne1, ne2 in [((e1[0], e2[0]), (e1[1], e2[1])),
                     ((e1[0], e2[1]), (e1[1], e2[0]))]:
        # Áp dụng swap tạm thời
        Gr.remove_edge(*e1); Gr.remove_edge(*e2)
        Gr.add_edge(*ne1); Gr.add_edge(*ne2)
        
        # Tính R-index mới
        R_new = robustness_R_static_fast(Gr, fracs, order)
        
        # Revert: hoàn nguyên swap
        Gr.remove_edge(*ne1); Gr.remove_edge(*ne2)
        Gr.add_edge(*e1); Gr.add_edge(*e2)
        
        # Lưu swap tốt nhất
        if R_new > R_best:
            best_local = (R_new, ne1, ne2)
    
    # Chấp nhận swap nếu cải thiện
    if best_local[0] > R_best + min_delta_R:
        # Áp dụng swap vĩnh viễn
        Gr.remove_edge(*e1); Gr.remove_edge(*e2)
        Gr.add_edge(*ne1); Gr.add_edge(*ne2)
        R_best = R_new
```

**Ý tưởng chính:**
1. **Chọn ngẫu nhiên 2 edges** để swap
2. **Thử 2 cách swap** khác nhau
3. **Tính R-index** cho mỗi cách
4. **Chấp nhận swap** nếu R-index tăng đủ lớn
5. **Lặp lại** nhiều lần (max_trials)

**Ví dụ Swap:**
```
Trước swap:
- Edge 1: Hub (degree=10) - Node (degree=2)
- Edge 2: Hub (degree=10) - Node (degree=2)

Sau swap (variant 1):
- Edge 1: Hub (degree=10) - Hub (degree=10)  ← Tốt hơn!
- Edge 2: Node (degree=2) - Node (degree=2)   ← Tốt hơn!

→ Tạo cấu trúc "onion": hubs kết nối với hubs, nodes kết nối với nodes
```

---

### 6. **Prefilter (Lọc Trước)**

```python
def score_degree_mixing(e1, e2, ne1, ne2) -> int:
    old = abs(deg[a] - deg[b]) + abs(deg[c] - deg[d])
    new = abs(deg[x1] - deg[y1]) + abs(deg[x2] - deg[y2])
    return new - old  # Âm = tốt hơn

if prefilter:
    if score_degree_mixing(e1, e2, ne1, ne2) >= 0:
        continue  # Skip swap không tốt hơn
```

**Mục đích:** **Tối ưu tốc độ** bằng cách bỏ qua các swap không cải thiện degree-mixing.

**Giải thích:**
- Tính điểm degree-mixing: tổng chênh lệch degree của 2 edges
- Swap tốt: giảm chênh lệch (âm)
- Swap xấu: tăng chênh lệch (dương)
- Nếu swap xấu → skip luôn, không cần tính R-index (tiết kiệm thời gian)

**Ví dụ:**
```
Edge 1: Hub(10) - Node(2) → chênh lệch = |10-2| = 8
Edge 2: Hub(10) - Node(2) → chênh lệch = |10-2| = 8
Tổng cũ = 8 + 8 = 16

Swap thành:
Edge 1: Hub(10) - Hub(10) → chênh lệch = |10-10| = 0
Edge 2: Node(2) - Node(2) → chênh lệch = |2-2| = 0
Tổng mới = 0 + 0 = 0

Score = 0 - 16 = -16 (âm → tốt hơn!)
```

---

## 🎯 Tóm Tắt Quy Trình

1. **Khởi tạo:** Copy graph, tính R-index ban đầu
2. **Vòng lặp tối ưu:**
   - Chọn ngẫu nhiên 2 edges
   - Thử 2 cách swap
   - Prefilter: Bỏ qua swap không tốt
   - Tính R-index cho swap tốt
   - Chấp nhận nếu R-index tăng đủ lớn
3. **Dừng:** Khi đạt max_trials hoặc không cải thiện sau `patience` lần thử
4. **Kết quả:** Graph đã được tối ưu với cấu trúc onion-like

---

## 📊 So Sánh Kết Quả

### Trước Schneider:
- Cấu trúc: Hub-Node, Hub-Node (chênh lệch degree lớn)
- Robustness: Thấp (dễ bị tấn công)

### Sau Schneider:
- Cấu trúc: Hub-Hub, Node-Node (chênh lệch degree nhỏ)
- Robustness: Cao hơn (khó bị tấn công hơn)

---

## 🔧 Tham Số Tùy Chỉnh

- `max_trials`: Số lần thử swap tối đa (default: 20000)
- `patience`: Dừng nếu không cải thiện sau N lần (default: 5000)
- `min_delta_R`: Cải thiện tối thiểu để chấp nhận swap (default: 1e-6)
- `prefilter`: Bật/tắt prefilter để tối ưu tốc độ (default: True)

---

## 📝 Lưu Ý

1. **Schneider giữ nguyên số edges:** Chỉ swap, không thêm/xóa
2. **Schneider giữ nguyên degree:** Mỗi node vẫn có cùng số connections
3. **Schneider chậm hơn TER:** Cần tính R-index nhiều lần
4. **Schneider phù hợp cho:** Mạng lớn, không muốn thêm edges mới

---

## 🚀 Cách Sử Dụng

### Backend API:
```bash
GET /defense/impact-schneider?max_trials=20000&patience=5000&attack_strategy=degree_targeted_attack
```

### Python Code:
```python
from app.defense import reinforce_graph_schneider

G_optimized, info = reinforce_graph_schneider(
    G,
    max_trials=20000,
    patience=5000,
    seed=123
)

print(f"Accepted swaps: {info['accepted_swaps']}")
print(f"R-index: {info['R_best_static']}")
```

---

## 📚 Tài Liệu Tham Khảo

- Schneider, C. M., et al. "Mitigation of malicious attacks on networks." *PNAS* (2011)
- Onion-like structure: Kết nối nodes có degree tương tự để tăng robustness

