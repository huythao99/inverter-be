// HINVLF v1 (inverter hybrid) — nhãn hiển thị trong CMS.
export const ST_LABEL: Record<string, string> = {
  RUN: 'Đang chạy',
  IDLE: 'Chờ',
  OFF: 'Chế độ tắt',
  STOP: 'Dừng từ app',
  FLT: 'Lỗi',
};

export const MODE_LABEL: Record<string, string> = {
  LOAD: 'Bám tải',
  EXPORT: 'Đẩy lưới',
  CHG: 'Sạc từ lưới',
  OFFGRID: 'Độc lập',
  OFF: 'Tắt',
};

export const IST_LABEL: Record<string, string> = {
  STANDBY: 'Chờ',
  POLTEST: 'Kiểm tra cực tính',
  OFFGRID: 'Phát độc lập',
  SYNC: 'Đồng bộ lưới',
  CLOSING: 'Đóng lưới',
  GRID: 'Đã hòa lưới',
  FAULT: 'Lỗi',
};

export const FLT_LABEL: Record<string, string> = {
  '1': 'F1 Quá dòng HW phía pin',
  '2': 'F2 Quá dòng sơ cấp',
  '3': 'F3 Pin quá áp',
  '4': 'F4 Pin yếu',
  '5': 'F5 Bão hòa biến áp',
  '6': 'F6 Sai cực tính',
  '7': 'F7 Lỗi CT lưới',
  '8': 'Quá nhiệt',
  '9': 'Hở mạch NTC',
  '10': 'Lỗi cảm biến',
  '11': 'Máy bị khóa',
  '12': 'Sai điện áp FW',
  '13': 'Sai sản phẩm FW',
};

export const NAK_LABEL: Record<string, string> = {
  CRC: 'Lỗi CRC (ESP gửi lại)',
  FORMAT: 'Sai cú pháp (lỗi firmware ESP)',
  UNSUP: 'Máy không hỗ trợ',
  KEY: 'Key lạ / chỉ đọc',
  VALUE: 'Không đọc được giá trị',
  RANGE: 'Ngoài dải / sai thứ tự ngưỡng',
  LOCAL: 'SRC=LOCAL (chưa chọn "Cai dat tu = APP")',
  BUSY: 'Người dùng đang ở menu máy',
  FLASH: 'Ghi flash thất bại',
};

export const CONFIG_LABEL: Record<string, [string, string]> = {
  MODE: ['Chế độ', ''],
  PCHG: ['CS sạc pin', 'W'],
  PEXP: ['CS đẩy lưới', 'W'],
  PIMP: ['CS nhận lưới', 'W'],
  VEXP: ['Áp ngừng đẩy', 'V'],
  VCUT: ['Pin ngắt xả', 'V'],
  VRES: ['Pin chạy lại', 'V'],
  PMAX: ['CS tối đa', 'W'],
  PCMAX: ['CS sạc tối đa', 'W'],
};

export const READONLY_LABEL: Record<string, [string, string]> = {
  VCV: ['Áp sạc', 'V'],
  VOVP: ['Quá áp pin', 'V'],
  SYS: ['Hệ pin', 'V'],
  FHZ: ['Tần số', 'Hz'],
  VGMAX: ['Áp lưới max', 'V'],
  VGMIN: ['Áp lưới min', 'V'],
  VBMAX: ['Áp pin max', 'V'],
  SRC: ['Cài đặt từ', ''],
};

export const fltText = (flt?: string | null) =>
  !flt || flt === '0' ? null : (FLT_LABEL[flt] ?? `Lỗi ${flt}`);

export const kwh = (wh: number) => (wh / 1000).toFixed(2);
