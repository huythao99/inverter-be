import { LANDING_CSS } from './landing.styles';

export interface LandingContext {
  /** Broker + database reachable. */
  healthy: boolean;
  /** Distinct devices registered (0 = unknown). */
  deviceCount: number;
  version: string;
  year: number;
  playStoreUrl: string | null;
  appStoreUrl: string | null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );

// Stroke icons (24x24, lucide style).
const ICONS: Record<string, string> = {
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  login:
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  sliders:
    '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  chart:
    '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  shield:
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  inverter:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4"/><path d="M7 13h2"/><path d="M14 15c1-2 2-2 3 0"/><circle cx="16" cy="9" r="1.5"/>',
  battery:
    '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="m10 9-2 3h4l-2 3"/>',
  building:
    '<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1"/>',
  phone:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  headset:
    '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
};
const icon = (name: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

const check = (text: string) =>
  `<li>${icon('check', 18)}<span>${text}</span></li>`;

// Hero illustration: sun -> panel -> inverter -> phone with a live chart.
const HERO_ART = `
<svg viewBox="0 0 520 400" role="img" aria-label="Tấm pin mặt trời, biến tần và ứng dụng theo dõi">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e6fc2"/><stop offset="1" stop-color="#0b4f96"/></linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef7ff"/></linearGradient>
  </defs>
  <g class="sun-rays" stroke="#f59e0b" stroke-width="5" stroke-linecap="round" opacity=".8">
    <path d="M90 18v14M90 108v14M38 70h14M128 70h14M53 33l10 10M117 97l10 10M53 107l10-10M117 43l10-10"/>
  </g>
  <circle cx="90" cy="70" r="26" fill="#fbbf24"/>
  <g transform="translate(40 150)">
    <path d="M20 0h170l-30 110H-10z" fill="url(#panel)"/>
    <g stroke="#7cc4ff" stroke-opacity=".55" stroke-width="2">
      <path d="M62 0 40 110M104 0 88 110M146 0 132 110M14 22h172M8 45h172M2 68h172M-4 90h172"/>
    </g>
    <path d="M85 110v40M65 150h40" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/>
  </g>
  <path class="flow" d="M200 215 C 240 215, 250 200, 285 200" stroke="#0b84d8" stroke-width="4" fill="none" stroke-linecap="round"/>
  <g transform="translate(285 150)">
    <rect width="96" height="110" rx="14" fill="url(#card)" stroke="#bfe0fb" stroke-width="2"/>
    <rect x="14" y="16" width="44" height="8" rx="4" fill="#0b84d8" opacity=".85"/>
    <rect x="14" y="32" width="28" height="6" rx="3" fill="#94c9f2"/>
    <circle cx="70" cy="74" r="14" fill="#dcefff"/><path d="M63 74l5 5 9-10" stroke="#0b84d8" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="22" cy="92" r="4" fill="#16a34a"/>
  </g>
  <path class="flow" d="M381 205 C 410 205, 410 170, 425 150" stroke="#38bdf8" stroke-width="4" fill="none" stroke-linecap="round"/>
  <g transform="translate(410 40)">
    <rect width="100" height="190" rx="18" fill="#0f2742"/>
    <rect x="7" y="12" width="86" height="166" rx="12" fill="#f4f9ff"/>
    <rect x="16" y="24" width="50" height="7" rx="3.5" fill="#0f2742" opacity=".7"/>
    <rect x="16" y="38" width="30" height="5" rx="2.5" fill="#94a3b8"/>
    <text x="16" y="72" font-family="system-ui, sans-serif" font-size="18" font-weight="800" fill="#0b84d8">2,4 kW</text>
    <g transform="translate(16 90)">
      <rect class="bar" x="0"  y="40" width="10" height="40" rx="3" fill="#38bdf8"/>
      <rect class="bar" x="14" y="22" width="10" height="58" rx="3" fill="#0b84d8"/>
      <rect class="bar" x="28" y="30" width="10" height="50" rx="3" fill="#38bdf8"/>
      <rect class="bar" x="42" y="10" width="10" height="70" rx="3" fill="#0b84d8"/>
      <rect class="bar" x="56" y="26" width="10" height="54" rx="3" fill="#38bdf8"/>
    </g>
  </g>
  <g transform="translate(40 330)">
    <rect width="150" height="46" rx="12" fill="#fff" stroke="#d6e7f7"/>
    <circle cx="24" cy="23" r="12" fill="#dcfce7"/><path d="M18 23l4 4 8-8" stroke="#16a34a" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="44" y="20" font-family="system-ui, sans-serif" font-size="11" fill="#52667d">Trạng thái</text>
    <text x="44" y="35" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0f2742">Đang hòa lưới</text>
  </g>
</svg>`;

export function renderLanding(ctx: LandingContext): string {
  const status = ctx.healthy
    ? '<span class="status ok"><span class="dot"></span>Hệ thống đang hoạt động</span>'
    : '<span class="status warn"><span class="dot"></span>Hệ thống đang bảo trì</span>';

  // Registered devices, rounded down to a hundred ("2.300+").
  const devices =
    ctx.deviceCount >= 100
      ? Math.floor(ctx.deviceCount / 100) * 100
      : ctx.deviceCount;
  const deviceStat =
    devices > 0
      ? `<div class="stat reveal"><div class="num" data-count="${devices}" data-suffix="+">${devices.toLocaleString('vi-VN')}+</div><div class="lbl">Thiết bị đã kết nối hệ thống</div></div>`
      : '';

  const stores = [
    ctx.playStoreUrl
      ? `<a class="store" href="${esc(ctx.playStoreUrl)}" target="_blank" rel="noopener"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.6 2.2 13.4 12l-9.8 9.8c-.4-.2-.6-.6-.6-1.1V3.3c0-.5.2-.9.6-1.1zm11 11 2.4 2.4-10.8 6.2 8.4-8.6zm3.6-3.7 2.9 1.6c.8.5.8 1.3 0 1.8l-2.9 1.6-2.7-2.5 2.7-2.5zM6.2 2.2 17 8.4l-2.4 2.4-8.4-8.6z"/></svg><span><small>Tải trên</small><strong>Google Play</strong></span></a>`
      : '',
    ctx.appStoreUrl
      ? `<a class="store" href="${esc(ctx.appStoreUrl)}" target="_blank" rel="noopener"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9s-1.9-.8-3.1-.8c-1.6 0-3 .9-3.9 2.3-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.4 3 2.4 1.2-.1 1.6-.8 3.1-.8s1.8.8 3.1.8 2.1-1.2 2.9-2.4c.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.7-3.9zM14.1 5.5c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z"/></svg><span><small>Tải trên</small><strong>App Store</strong></span></a>`
      : '',
    `<a class="store web" href="/app">${icon('globe')}<span><small>Dùng trên</small><strong>Trình duyệt web</strong></span></a>`,
  ].join('');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Giabao Inverter – Giám sát biến tần &amp; bộ sạc năng lượng mặt trời</title>
<meta name="description" content="Theo dõi và điều khiển biến tần hòa lưới Giabao theo thời gian thực trên điện thoại và web: sản lượng điện, cài đặt công suất, lịch hoạt động, cập nhật firmware từ xa. Sắp ra mắt bộ sạc MPPT.">
<meta name="theme-color" content="#0b84d8">
<meta property="og:type" content="website">
<meta property="og:title" content="Giabao Inverter – Hệ thống giám sát năng lượng mặt trời">
<meta property="og:description" content="Theo dõi, điều khiển biến tần hòa lưới và bộ sạc MPPT Giabao mọi lúc, mọi nơi.">
<meta property="og:url" content="https://giabao-inverter.com/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${LANDING_CSS}</style>
<script src="/landing.js" defer></script>
</head>
<body>

<header class="site-header">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Giabao Inverter – trang chủ">
      <span class="brand-mark">${icon('bolt', 20)}</span>
      <span>Giabao <b>Inverter</b></span>
    </a>
    <nav class="nav-links" aria-label="Điều hướng">
      <a href="#san-pham">Sản phẩm</a>
      <a href="#tinh-nang">Tính năng</a>
      <a href="#cach-dung">Cách sử dụng</a>
      <a href="#tai-ung-dung">Tải ứng dụng</a>
      <a href="#lien-he">Liên hệ</a>
    </nav>
    <div class="nav-cta">
      <a class="btn btn-primary" href="/app">${icon('login', 18)} Đăng nhập</a>
    </div>
    <button class="nav-toggle" type="button" aria-label="Mở menu" aria-expanded="false">${icon('menu')}</button>
  </div>
</header>

<main>
  <section class="hero">
    <div class="container hero-grid">
      <div>
        ${status}
        <h1>Năng lượng mặt trời, <span class="grad">trong lòng bàn tay</span></h1>
        <p class="lead">Theo dõi sản lượng, cài đặt công suất và lịch hoạt động của biến tần hòa lưới Giabao theo thời gian thực – trên điện thoại hoặc trình duyệt, ở bất cứ đâu.</p>
        <div class="hero-cta">
          <a class="btn btn-primary btn-lg" href="/app">${icon('login', 18)} Đăng nhập hệ thống</a>
          <a class="btn btn-ghost btn-lg" href="#tai-ung-dung">${icon('download', 18)} Tải ứng dụng</a>
        </div>
      </div>
      <div class="hero-art">${HERO_ART}</div>
    </div>
  </section>

  <div class="container">
    <div class="stats">
      ${deviceStat}
      <div class="stat reveal"><div class="num">1 giây</div><div class="lbl">Dữ liệu cập nhật liên tục</div></div>
      <div class="stat reveal"><div class="num">24/7</div><div class="lbl">Giám sát thiết bị mọi lúc</div></div>
      <div class="stat reveal"><div class="num">OTA</div><div class="lbl">Cập nhật phần mềm từ xa</div></div>
    </div>
  </div>

  <section class="block" id="san-pham">
    <div class="container">
      <div class="section-head center reveal">
        <div class="eyebrow">Sản phẩm</div>
        <h2 class="section-title">Một ứng dụng cho cả hệ thống điện mặt trời</h2>
        <p class="section-sub">Biến tần hòa lưới đang được hàng nghìn gia đình sử dụng, và bộ sạc MPPT – thành viên mới sắp ra mắt – quản lý chung trong cùng một ứng dụng.</p>
      </div>
      <div class="products">
        <article class="product reveal">
          <div class="product-top">
            <div class="product-icon blue">${icon('inverter', 26)}</div>
            <div><h3>Biến tần hòa lưới Giabao</h3><span class="tag live">Đang phân phối</span></div>
          </div>
          <p>Đưa điện từ pin lưu trữ và tấm pin lên lưới gia đình, giảm tiền điện mỗi tháng.</p>
          <ul class="checks">
            ${check('Theo dõi điện áp, tần số, công suất và sản lượng theo từng giây')}
            ${check('Cài đặt công suất xả và ngưỡng điện áp pin từ xa')}
            ${check('Lịch hoạt động nhiều khung giờ, bật/tắt hòa lưới một chạm')}
            ${check('Chia sẻ công suất giữa nhiều biến tần trong nhóm')}
            ${check('Thống kê điện năng xả, lấy lưới và tiêu thụ theo ngày, tháng')}
          </ul>
        </article>
        <article class="product soon reveal">
          <div class="product-top">
            <div class="product-icon sun">${icon('battery', 26)}</div>
            <div><h3>Bộ sạc năng lượng mặt trời MPPT</h3><span class="tag soon">Sắp ra mắt</span></div>
          </div>
          <p>Sạc pin lưu trữ trực tiếp từ tấm pin với hiệu suất tối ưu, theo dõi và điều khiển ngay trong ứng dụng Giabao.</p>
          <ul class="checks">
            ${check('Thuật toán MPPT bám điểm công suất cực đại, tận dụng tối đa tấm pin')}
            ${check('Xem điện áp, dòng, công suất tấm pin và dòng sạc pin theo thời gian thực')}
            ${check('Cài đặt ngưỡng sạc ngay trên ứng dụng, thiết bị cập nhật tức thì')}
            ${check('Cảnh báo lỗi, khóa/mở thiết bị từ xa')}
            ${check('Bảo mật từng thiết bị: tài khoản riêng, kết nối mã hóa')}
          </ul>
        </article>
      </div>
    </div>
  </section>

  <section class="block" id="tinh-nang" style="background: linear-gradient(180deg, var(--bg), var(--bg-soft));">
    <div class="container">
      <div class="section-head center reveal">
        <div class="eyebrow">Tính năng</div>
        <h2 class="section-title">Mọi thứ bạn cần để làm chủ hệ thống</h2>
      </div>
      <div class="features">
        <div class="feature reveal"><div class="ic">${icon('activity')}</div><h3>Giám sát thời gian thực</h3><p>Số liệu từ thiết bị truyền về mỗi giây, biết ngay khi thiết bị ngắt kết nối.</p></div>
        <div class="feature reveal"><div class="ic">${icon('sliders')}</div><h3>Điều khiển từ xa</h3><p>Thay đổi công suất, ngưỡng điện áp, bật/tắt hòa lưới – thiết bị nhận lệnh trong tích tắc.</p></div>
        <div class="feature reveal"><div class="ic">${icon('clock')}</div><h3>Lịch hoạt động</h3><p>Đặt nhiều khung giờ chạy khác nhau trong ngày, thiết bị tự động thực hiện.</p></div>
        <div class="feature reveal"><div class="ic">${icon('chart')}</div><h3>Biểu đồ &amp; thống kê</h3><p>Biểu đồ điện năng theo ngày trong tháng, tổng xả, lấy lưới và tiêu thụ.</p></div>
        <div class="feature reveal"><div class="ic">${icon('refresh')}</div><h3>Cập nhật firmware từ xa</h3><p>Thiết bị luôn có phiên bản mới nhất qua mạng, không cần mang đi bảo hành.</p></div>
        <div class="feature reveal"><div class="ic">${icon('shield')}</div><h3>Bảo mật</h3><p>Đăng nhập tài khoản riêng, dữ liệu truyền qua kết nối mã hóa, chỉ bạn thấy thiết bị của mình.</p></div>
      </div>
    </div>
  </section>

  <section class="block" id="cach-dung">
    <div class="container">
      <div class="section-head center reveal">
        <div class="eyebrow">Cách sử dụng</div>
        <h2 class="section-title">Bắt đầu chỉ trong vài phút</h2>
      </div>
      <div class="steps">
        <div class="step reveal"><h3>Lắp đặt thiết bị</h3><p>Kỹ thuật viên lắp biến tần (hoặc bộ sạc) vào hệ thống điện mặt trời của bạn.</p></div>
        <div class="step reveal"><h3>Kết nối WiFi qua ứng dụng</h3><p>Mở ứng dụng, chọn “Thêm thiết bị”, nhập WiFi nhà – thiết bị tự vào tài khoản của bạn.</p></div>
        <div class="step reveal"><h3>Theo dõi &amp; điều khiển</h3><p>Xem số liệu, đổi cài đặt, đặt lịch mọi lúc trên điện thoại hoặc trình duyệt.</p></div>
      </div>
    </div>
  </section>

  <section class="block" id="tai-ung-dung" style="padding-top: 0;">
    <div class="container">
      <div class="download reveal">
        <div>
          <h2>Tải ứng dụng Giabao</h2>
          <p>Miễn phí cho khách hàng sử dụng biến tần và bộ sạc Giabao. Một tài khoản dùng chung cho điện thoại và web.</p>
        </div>
        <div class="store-btns">${stores}</div>
      </div>
    </div>
  </section>

  <section class="block" id="lien-he" style="padding-top: 0;">
    <div class="container">
      <div class="section-head reveal">
        <div class="eyebrow">Liên hệ</div>
        <h2 class="section-title">Giabao Technology</h2>
      </div>
      <div class="contact">
        <div class="contact-card reveal">
          <h3>${icon('building', 20)} Thông tin công ty</h3>
          <dl>
            <dt>Tên</dt><dd>Công ty TNHH Giabao Technology</dd>
            <dt>Lĩnh vực</dt><dd>Hệ thống năng lượng tái tạo</dd>
            <dt>Địa chỉ</dt><dd>Việt Nam</dd>
          </dl>
        </div>
        <div class="contact-card reveal">
          <h3>${icon('phone', 20)} Hỗ trợ khách hàng</h3>
          <dl>
            <dt>Đại diện</dt><dd>Ngô Văn Bảo</dd>
            <dt>Hotline</dt><dd><a href="tel:0346905569">0346 905 569</a></dd>
            <dt>Website</dt><dd><a href="https://giabao-inverter.com">giabao-inverter.com</a></dd>
          </dl>
        </div>
        <div class="contact-card reveal">
          <h3>${icon('headset', 20)} Hỗ trợ phần mềm</h3>
          <dl>
            <dt>Phụ trách</dt><dd>Ngô Huy Thao</dd>
            <dt>Zalo</dt><dd><a href="https://zalo.me/0375336663" target="_blank" rel="noopener">0375 336 663</a></dd>
            <dt>Hỗ trợ</dt><dd>Ứng dụng, kết nối WiFi thiết bị, cập nhật firmware</dd>
          </dl>
        </div>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="container foot">
    <div>© ${ctx.year} Giabao Technology · Hệ thống giám sát năng lượng mặt trời</div>
    <div class="foot-links">
      <a href="#san-pham">Sản phẩm</a>
      <a href="#tai-ung-dung">Tải ứng dụng</a>
      <a href="/app">Đăng nhập</a>
      <span class="ver">Phiên bản ${esc(ctx.version)}</span>
    </div>
  </div>
</footer>
</body>
</html>`;
}

// Browser-tab icon (same mark as the header logo).
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0b84d8"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/><path d="M17.5 5 8 18h7l-1 9 10-13h-7l.5-9z" fill="#fff"/></svg>`;
