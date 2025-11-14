# Pre-compute Attack Analysis

Để tránh timeout khi phân tích tấn công, chạy script pre-compute trước:

## Cách chạy:

```bash
cd backend
python precompute_attacks.py
```

Script sẽ:
1. Load graph từ data files
2. Tính toán robustness curves cho từng khu vực (Đông Nam Á, Châu Á, Châu Âu, Bắc Mỹ)
3. Lưu kết quả vào file `precomputed_attacks.json`

## Kết quả:

File `precomputed_attacks.json` sẽ chứa:
- Baseline metrics (LCC, ASPL, diameter)
- Robustness curves cho Random attack
- Robustness curves cho Degree-based attack  
- Robustness curves cho Betweenness attack (nếu graph đủ nhỏ)

## Sử dụng:

Sau khi chạy pre-compute, khi user nhấn "Phân tích tấn công" trong frontend:
- Backend sẽ đọc file `precomputed_attacks.json` thay vì tính toán real-time
- Kết quả hiển thị ngay lập tức (không timeout)

## Lưu ý:

- Chạy lại script này nếu data thay đổi
- File sẽ được tạo trong thư mục `backend/`

