# InverterData API

## Cài đặt và chạy

1. Cài đặt dependencies:
```bash
npm install
```

2. Đảm bảo MongoDB đang chạy trên localhost:27017

3. Chạy ứng dụng:
```bash
npm run start:dev
```

## API Endpoints

### 1. Tạo InverterData mới
**POST** `/inverter-data`

Body:
```json
{
  "id": "inverter_001",
  "value": "active",
  "totalACapacity": 100.5,
  "totalA2Capacity": 200.3
}
```

### 2. Lấy tất cả InverterData
**GET** `/inverter-data`

### 3. Lấy InverterData theo ID
**GET** `/inverter-data/:id`

### 4. Cập nhật InverterData
**PATCH** `/inverter-data/:id`

Body (các trường tùy chọn):
```json
{
  "value": "inactive",
  "totalACapacity": 150.0
}
```

### 5. Xóa InverterData
**DELETE** `/inverter-data/:id`

## Cấu trúc dữ liệu

```typescript
interface InverterData {
  id: string;              // ID duy nhất
  value: string;           // Giá trị trạng thái
  totalACapacity: number;  // Tổng công suất A
  totalA2Capacity: number; // Tổng công suất A2
  updatedAt: Date;         // Thời gian cập nhật
}
```

## Validation

- `id`: Bắt buộc, kiểu string
- `value`: Bắt buộc, kiểu string
- `totalACapacity`: Bắt buộc, kiểu number
- `totalA2Capacity`: Bắt buộc, kiểu number 