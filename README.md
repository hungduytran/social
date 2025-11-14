# Airline Network Robustness Analysis

Hệ thống phân tích độ bền mạng hàng không dưới các kịch bản tấn công.

## Cấu trúc

- `backend/` - FastAPI backend với đầy đủ chức năng
- `frontend/` - React frontend đơn giản với Leaflet map
- `openflights/data/` - Dữ liệu OpenFlights

## Cài đặt

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `GET /graph/stats` - Thống kê đồ thị
- `GET /geojson/airports` - GeoJSON sân bay
- `GET /geojson/routes` - GeoJSON tuyến bay
- `POST /simulate` - Mô phỏng tấn công

## Tính năng

- Visualize sân bay và tuyến bay trên bản đồ địa lý
- Mô phỏng tấn công: random, degree, betweenness
- Tính toán metrics: LCC, diameter, ASPL
- Adaptive và non-adaptive attacks
