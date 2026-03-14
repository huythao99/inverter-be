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
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Roboto', sans-serif;
            background: linear-gradient(135deg, #0d47a1 0%, #1565c0 50%, #1976d2 100%);
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
            padding-top: 2rem;
        }

        .logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
            box-shadow: 0 8px 32px rgba(255, 152, 0, 0.4);
        }

        .logo .material-icons {
            font-size: 48px;
            color: white;
        }

        h1 {
            font-size: 3rem;
            font-weight: 300;
            margin-bottom: 0.5rem;
            letter-spacing: -1px;
        }

        h1 span {
            font-weight: 700;
            color: #ffb74d;
        }

        .subtitle {
            font-size: 1.2rem;
            font-weight: 300;
            opacity: 0.9;
            margin-bottom: 2rem;
        }

        .status-badge {
            background: linear-gradient(135deg, #4caf50 0%, #43a047 100%);
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 50px;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 500;
            box-shadow: 0 4px 16px rgba(76, 175, 80, 0.4);
        }

        .status-badge .material-icons {
            font-size: 20px;
        }

        /* Stats Section */
        .stats-section {
            display: flex;
            justify-content: center;
            gap: 3rem;
            margin: 3rem 0;
            flex-wrap: wrap;
        }

        .stat-card {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 2rem 3rem;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .stat-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
        }

        .stat-card.highlight {
            background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
            border: none;
        }

        .stat-number {
            font-size: 3.5rem;
            font-weight: 700;
            display: block;
            line-height: 1;
        }

        .stat-label {
            font-size: 1rem;
            font-weight: 400;
            opacity: 0.9;
            margin-top: 0.5rem;
        }

        .stat-icon {
            font-size: 32px;
            margin-bottom: 0.5rem;
            opacity: 0.9;
        }

        /* Features Grid */
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin: 3rem 0;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }

        .feature-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #ff9800, #ffb74d);
            transform: scaleX(0);
            transition: transform 0.3s ease;
        }

        .feature-card:hover {
            transform: translateY(-8px);
            background: rgba(255, 255, 255, 0.15);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        }

        .feature-card:hover::before {
            transform: scaleX(1);
        }

        .feature-icon-wrapper {
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, rgba(255, 152, 0, 0.2) 0%, rgba(255, 183, 77, 0.2) 100%);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.25rem;
        }

        .feature-icon-wrapper .material-icons {
            font-size: 28px;
            color: #ffb74d;
        }

        .feature-title {
            font-size: 1.25rem;
            font-weight: 500;
            margin-bottom: 0.75rem;
            color: white;
        }

        .feature-desc {
            font-size: 0.95rem;
            line-height: 1.6;
            opacity: 0.85;
            font-weight: 300;
        }

        /* Info Section */
        .info-section {
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 2.5rem;
            margin: 3rem 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .info-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .info-header .material-icons {
            font-size: 32px;
            color: #ffb74d;
        }

        .info-header h2 {
            font-size: 1.5rem;
            font-weight: 500;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
        }

        .info-card {
            background: rgba(0, 0, 0, 0.2);
            padding: 1.75rem;
            border-radius: 16px;
            border-left: 4px solid #ff9800;
        }

        .info-card h3 {
            font-size: 1.1rem;
            font-weight: 500;
            margin-bottom: 1rem;
            color: #ffb74d;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .info-card p {
            margin: 0.5rem 0;
            font-weight: 300;
            opacity: 0.9;
        }

        .info-card strong {
            font-weight: 500;
        }

        /* Footer */
        footer {
            text-align: center;
            margin-top: 4rem;
            padding: 2rem 0;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        footer p {
            opacity: 0.7;
            font-weight: 300;
            margin: 0.25rem 0;
        }

        footer .version {
            display: inline-block;
            background: rgba(255, 255, 255, 0.1);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.85rem;
            margin-top: 0.5rem;
        }

        @media (max-width: 768px) {
            h1 { font-size: 2rem; }
            .container { padding: 1rem; }
            .stat-card { padding: 1.5rem 2rem; }
            .stat-number { font-size: 2.5rem; }
            .stats-section { gap: 1rem; }
        }

        /* Animations */
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .feature-card, .stat-card, .info-section {
            animation: fadeInUp 0.6s ease-out forwards;
        }

        .feature-card:nth-child(1) { animation-delay: 0.1s; }
        .feature-card:nth-child(2) { animation-delay: 0.2s; }
        .feature-card:nth-child(3) { animation-delay: 0.3s; }
        .feature-card:nth-child(4) { animation-delay: 0.4s; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">
                <span class="material-icons">bolt</span>
            </div>
            <h1>Giabao <span>Inverter</span></h1>
            <p class="subtitle">Hệ thống quản lý và giám sát biến tần thông minh</p>
            <div class="status-badge">
                <span class="material-icons">check_circle</span>
                Hệ thống đang hoạt động
            </div>
        </header>

        <div class="stats-section">
            <div class="stat-card highlight">
                <span class="material-icons stat-icon">devices</span>
                <span class="stat-number">2000+</span>
                <span class="stat-label">Thiết bị đã bán</span>
            </div>
            <div class="stat-card">
                <span class="material-icons stat-icon">verified</span>
                <span class="stat-number">99.9%</span>
                <span class="stat-label">Uptime hệ thống</span>
            </div>
            <div class="stat-card">
                <span class="material-icons stat-icon">support_agent</span>
                <span class="stat-number">24/7</span>
                <span class="stat-label">Hỗ trợ kỹ thuật</span>
            </div>
        </div>

        <div class="features">
            <div class="feature-card">
                <div class="feature-icon-wrapper">
                    <span class="material-icons">monitoring</span>
                </div>
                <h3 class="feature-title">Giám sát dữ liệu</h3>
                <p class="feature-desc">Theo dõi thời gian thực các thông số của inverter, bao gồm điện áp, dòng điện, công suất và hiệu suất.</p>
            </div>

            <div class="feature-card">
                <div class="feature-icon-wrapper">
                    <span class="material-icons">settings</span>
                </div>
                <h3 class="feature-title">Cấu hình thiết bị</h3>
                <p class="feature-desc">Quản lý và điều chỉnh các thông số cấu hình của inverter từ xa một cách dễ dàng và an toàn.</p>
            </div>

            <div class="feature-card">
                <div class="feature-icon-wrapper">
                    <span class="material-icons">schedule</span>
                </div>
                <h3 class="feature-title">Lập lịch hoạt động</h3>
                <p class="feature-desc">Thiết lập lịch trình hoạt động tự động cho hệ thống inverter theo nhu cầu sử dụng.</p>
            </div>

            <div class="feature-card">
                <div class="feature-icon-wrapper">
                    <span class="material-icons">analytics</span>
                </div>
                <h3 class="feature-title">Báo cáo thống kê</h3>
                <p class="feature-desc">Tạo báo cáo chi tiết về hiệu suất hoạt động và thống kê sử dụng năng lượng hàng ngày.</p>
            </div>
        </div>

        <div class="info-section">
            <div class="info-header">
                <span class="material-icons">business</span>
                <h2>Thông tin chủ sở hữu</h2>
            </div>
            <div class="info-grid">
                <div class="info-card">
                    <h3><span class="material-icons">apartment</span> Thông tin công ty</h3>
                    <p><strong>Tên:</strong> Công ty TNHH Giabao Technology</p>
                    <p><strong>Địa chỉ:</strong> Việt Nam</p>
                    <p><strong>Chuyên ngành:</strong> Hệ thống năng lượng tái tạo</p>
                </div>
                <div class="info-card">
                    <h3><span class="material-icons">person</span> Chủ sở hữu</h3>
                    <p><strong>Tên:</strong> Ngô Văn Bảo</p>
                    <p><strong>Số điện thoại:</strong> 0346905569</p>
                    <p><strong>Website:</strong> giabao-inverter.com</p>
                </div>
            </div>
        </div>

        <footer>
            <p>&copy; 2024 Giabao Inverter System</p>
            <p>Hệ thống quản lý biến tần thông minh</p>
            <span class="version">Phiên bản 1.1.0</span>
        </footer>
    </div>
</body>
</html>`;
  }
}
