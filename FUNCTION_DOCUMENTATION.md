# Hướng Dẫn Sử Dụng Các Chức Năng

Tài liệu này giải thích chi tiết về từng nút bấm và khu vực chức năng trong ứng dụng web.

## I. Bố Cục Chính

Giao diện được chia thành 2 phần:
- **Panel Trái**: Bản đồ tương tác.
- **Panel Phải**: Panel điều khiển và hiển thị kết quả. Panel này có thể **kéo giãn** bằng cách giữ chuột vào mép trái và di chuyển.

---

## II. Panel Trái - Điều Khiển Bản Đồ

Nằm ở góc trên bên trái của bản đồ.

#### 1. **Khu vực phân tích (Analysis Region)**
- **Chức năng**: Dropdown để chọn khu vực địa lý của mạng lưới hàng không cần phân tích.
- **Các lựa chọn**:
    - `Toàn thế giới (Global)`: Tải và phân tích toàn bộ mạng lưới OpenFlights.
    - `Đông Nam Á`, `Châu Âu`, `Châu Á`, `Bắc Mỹ`: Lọc các sân bay và tuyến bay trong một khu vực cụ thể.
- **Ảnh hưởng**: Mọi phân tích sau đó (tấn công, phòng thủ, case study) sẽ được thực hiện trên đồ thị đã được lọc theo khu vực này.

#### 2. **Airports & Routes**
- **Checkbox**: Bật/tắt hiển thị các sân bay hoặc tuyến bay trên bản đồ.
- **Slider**: Điều chỉnh tỷ lệ phần trăm các đối tượng được hiển thị (chỉ ảnh hưởng đến giao diện, không ảnh hưởng đến dữ liệu phân tích).

---

## III. Panel Phải - Điều Khiển & Phân Tích

Đây là khu vực chính để chạy các mô phỏng.

### 1. **Quick Analysis**

#### Nút `Where to Add Redundancy (TER)`
- **Chức năng**: Gợi ý các cạnh (tuyến bay) backup nên được thêm vào để gia cố mạng lưới.
- **Điều kiện**: Nút này **chỉ được bật sau khi** bạn đã chạy **"Run TER Defense"** ít nhất một lần.
- **Phương pháp**: Sắp xếp các cặp node chưa có kết nối dựa trên **Effective Resistance (TER)** giảm dần. Các cạnh có R_eff cao nhất là những ứng viên tốt nhất để thêm vào.
- **Kết quả**: Mở một popup hiển thị danh sách các tuyến bay được đề xuất, ưu tiên các tuyến có R_eff cao nhất.

### 2. **Custom Attack**
- **Chức năng**: Mô phỏng một cuộc tấn công có chủ đích và vẽ biểu đồ suy giảm của mạng lưới.
- **Controls**:
    - `Strategy`: Chọn chiến lược tấn công (Random, Degree, PageRank, Betweenness).
    - `Max Fraction`: Tỷ lệ node tối đa sẽ bị xóa (từ 10% đến 100%).
- **Nút `Run Custom Attack`**:
    - **Chức năng**: Chạy mô phỏng với các tham số đã chọn.
    - **Kết quả**: Hiển thị 2 biểu đồ (LCC và Diameter) trong **Charts Section** (phần có thể cuộn bên dưới).

### 3. **🛡️ TER Defense (Effective Resistance)**
- **Chức năng**: So sánh độ robust của mạng lưới **trước và sau** khi áp dụng phương pháp phòng thủ TER.
- **Phương pháp**: **Thêm cạnh backup**. Chọn ra `k` cạnh mới có **Effective Resistance** cao nhất và thêm vào đồ thị.
- **Controls**:
    - `Số cạnh backup (k)`: Số lượng cạnh mới sẽ được thêm vào.
    - `Max Distance`: Giới hạn khoảng cách địa lý của các cạnh backup được đề xuất.
    - `Test Attack`: Chọn chiến lược tấn công để đánh giá hiệu quả của TER.
- **Nút `Run TER Defense`**:
    - **Chức năng**: Chạy mô phỏng.
    - **Kết quả**: Hiển thị biểu đồ so sánh "Original" vs "Reinforced" trong **Charts Section**. Sau khi chạy xong, nút `Where to Add Redundancy (TER)` sẽ được kích hoạt.

### 4. **🔄 Schneider Defense (Edge Swapping)**
- **Chức năng**: So sánh độ robust **trước và sau** khi áp dụng phương pháp phòng thủ Schneider.
- **Phương pháp**: **Hoán đổi (swap) các cạnh** hiện có để tạo ra cấu trúc "onion-like" (hub kết nối với hub, node thường kết nối với node thường), giúp tăng R-index.
- **Controls**:
    - `Max Trials`: Số lần thử swap tối đa (càng cao càng tối ưu nhưng càng chậm).
    - `Patience`: Dừng nếu không tìm thấy swap tốt hơn sau N lần thử.
    - `Test Attack`: Chọn chiến lược tấn công để đánh giá.
- **Nút `Run Schneider Defense`**:
    - **Chức năng**: Chạy mô phỏng.
    - **Kết quả**: Hiển thị biểu đồ so sánh "Original" vs "Optimized" trong **Charts Section**.

### 5. **Route Case Study**
- **Chức năng**: Phân tích một tuyến đường bay cụ thể và mô phỏng các cuộc tấn công vào tuyến đó.
- **Controls**:
    - `From/To`: Chọn quốc gia và sân bay cho điểm đi và đến.
    - `Compare with Defense`: Bật/tắt so sánh với đồ thị đã được phòng thủ.
    - `Defense Method`: Chọn phương pháp phòng thủ (TER hoặc Schneider) để so sánh.
- **Các nút**:
    - `Analyze Route`: Phân tích các chỉ số cơ bản của tuyến đường (số đường đi ngắn nhất, số hops).
    - `Attack Simulation`: Chạy mô phỏng tấn công thích nghi (adaptive attack) vào các node trung chuyển (transit nodes) trên tuyến đường.
- **Kết quả**:
    - **Analyze Route**: Hiển thị tóm tắt ngay bên dưới nút bấm.
    - **Attack Simulation**: Hiển thị một biểu đồ cột nhỏ trong **Charts Section**. **Click vào biểu đồ này** để mở một **popup lớn (Full Report)** với biểu đồ chi tiết và bảng kết quả phân tích.

---