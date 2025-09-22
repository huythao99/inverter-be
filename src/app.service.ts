import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return this.getLandingPageHTML();
  }

  private getLandingPageHTML(): string {
    return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Giabao Inverter - Hệ thống quản lý biến tần</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            color: white;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        header {
            text-align: center;
            margin-bottom: 3rem;
        }

        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
            margin-bottom: 2rem;
        }

        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin: 3rem 0;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            transition: transform 0.3s ease;
        }

        .feature-card:hover {
            transform: translateY(-5px);
        }

        .feature-icon {
            font-size: 2.5rem;
            margin-bottom: 1rem;
        }

        .feature-title {
            font-size: 1.3rem;
            margin-bottom: 1rem;
            color: #FFD700;
        }

        .api-info {
            background: rgba(255, 255, 255, 0.05);
            padding: 2rem;
            border-radius: 15px;
            margin: 2rem 0;
            border-left: 4px solid #FFD700;
        }

        .api-endpoints {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }

        .endpoint {
            background: rgba(0, 0, 0, 0.2);
            padding: 1rem;
            border-radius: 8px;
            font-family: monospace;
            font-size: 0.9rem;
        }

        .method {
            color: #4CAF50;
            font-weight: bold;
        }

        .status {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            display: inline-block;
            margin: 1rem 0;
            font-weight: bold;
        }

        footer {
            text-align: center;
            margin-top: 3rem;
            opacity: 0.8;
        }

        @media (max-width: 768px) {
            h1 { font-size: 2rem; }
            .container { padding: 1rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🔌 Giabao Inverter</h1>
            <p class="subtitle">Hệ thống quản lý và giám sát biến tần thông minh</p>
            <div class="status">✅ Hệ thống đang hoạt động</div>
        </header>

        <div class="features">
            <div class="feature-card">
                <div class="feature-icon">📊</div>
                <h3 class="feature-title">Giám sát dữ liệu</h3>
                <p>Theo dõi thời gian thực các thông số của inverter, bao gồm điện áp, dòng điện, công suất và hiệu suất.</p>
            </div>

            <div class="feature-card">
                <div class="feature-icon">⚙️</div>
                <h3 class="feature-title">Cấu hình thiết bị</h3>
                <p>Quản lý và điều chỉnh các thông số cấu hình của inverter từ xa một cách dễ dàng và an toàn.</p>
            </div>

            <div class="feature-card">
                <div class="feature-icon">📅</div>
                <h3 class="feature-title">Lập lịch hoạt động</h3>
                <p>Thiết lập lịch trình hoạt động tự động cho hệ thống inverter theo nhu cầu sử dụng.</p>
            </div>

            <div class="feature-card">
                <div class="feature-icon">📈</div>
                <h3 class="feature-title">Báo cáo thống kê</h3>
                <p>Tạo báo cáo chi tiết về hiệu suất hoạt động và thống kê sử dụng năng lượng hàng ngày.</p>
            </div>
        </div>

        <div class="api-info">
            <h2>👤 Thông tin chủ sở hữu</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin-top: 1rem;">
                <div style="background: rgba(0, 0, 0, 0.2); padding: 1.5rem; border-radius: 12px;">
                    <h3 style="color: #FFD700; margin-bottom: 1rem;">🏢 Thông tin công ty</h3>
                    <p><strong>Tên:</strong> Công ty TNHH Giabao Technology</p>
                    <p><strong>Địa chỉ:</strong> Việt Nam</p>
                    <p><strong>Chuyên ngành:</strong> Hệ thống năng lượng tái tạo</p>
                </div>
                <div style="background: rgba(0, 0, 0, 0.2); padding: 1.5rem; border-radius: 12px;">
                    <h3 style="color: #FFD700; margin-bottom: 1rem;">👤 Chủ sở hữu</h3>
                    <p><strong>Tên:</strong> Ngô Văn Bảo</p>
                    <p><strong>Số điện thoại:</strong> 0346905569</p>
                    <p><strong>Website:</strong> giabao-inverter.com</p>
                </div>
            </div>
        </div>

        <footer>
            <p>&copy; 2024 Giabao Inverter System - Phiên bản 0.2.9</p>
            <p>Hệ thống quản lý biến tần thông minh</p>
        </footer>
    </div>
</body>
</html>`;
  }
}
