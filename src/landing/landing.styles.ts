// Styles of the public landing page (GET /). Light-blue theme.
export const LANDING_CSS = `
:root {
  color-scheme: light;
  --bg: #f4f9ff;
  --bg-soft: #e8f3fd;
  --card: #ffffff;
  --ink: #0f2742;
  --muted: #52667d;
  --line: #d6e7f7;
  --primary: #0b84d8;
  --primary-strong: #066bb2;
  --primary-soft: #dcefff;
  --sky: #38bdf8;
  --sun: #f59e0b;
  --sun-soft: #fff4dc;
  --ok: #16a34a;
  --ok-soft: #dcfce7;
  --warn: #b45309;
  --warn-soft: #fef3c7;
  --radius: 18px;
  --shadow: 0 1px 2px rgba(15, 39, 66, .06), 0 8px 24px rgba(15, 39, 66, .06);
  --shadow-lg: 0 18px 50px rgba(11, 132, 216, .16);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; scroll-padding-top: 80px; }
body {
  font-family: 'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
a { color: inherit; text-decoration: none; }
img, svg { display: block; max-width: 100%; }
.container { width: 100%; max-width: 1160px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 32px); }

/* ---- Header ---- */
.site-header {
  position: sticky; top: 0; z-index: 50;
  background: rgba(244, 249, 255, .82);
  backdrop-filter: saturate(1.4) blur(14px);
  -webkit-backdrop-filter: saturate(1.4) blur(14px);
  border-bottom: 1px solid transparent;
  transition: border-color .2s, box-shadow .2s;
}
.site-header.scrolled { border-bottom-color: var(--line); box-shadow: 0 4px 20px rgba(15, 39, 66, .05); }
.nav { display: flex; align-items: center; gap: 24px; height: 68px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.1rem; white-space: nowrap; }
.brand-mark {
  width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--sky), var(--primary)); color: #fff;
  box-shadow: 0 6px 16px rgba(11, 132, 216, .35);
}
.brand b { color: var(--primary); font-weight: 700; }
.nav-links { display: flex; gap: 22px; margin-left: auto; font-size: .95rem; color: var(--muted); }
.nav-links a:hover { color: var(--primary); }
.nav-cta { display: flex; gap: 10px; }
.nav-toggle {
  display: none; margin-left: auto; width: 42px; height: 42px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer;
  align-items: center; justify-content: center;
}

/* ---- Buttons ---- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 20px; border-radius: 12px; font-weight: 600; font-size: .95rem;
  border: 1px solid transparent; cursor: pointer; transition: transform .15s, box-shadow .2s, background .2s;
  white-space: nowrap;
}
.btn:hover { transform: translateY(-2px); }
.btn-primary { background: var(--primary); color: #fff; box-shadow: 0 8px 20px rgba(11, 132, 216, .28); }
.btn-primary:hover { background: var(--primary-strong); }
.btn-ghost { background: var(--card); color: var(--ink); border-color: var(--line); }
.btn-ghost:hover { border-color: var(--primary); color: var(--primary); }
.btn-lg { padding: 14px 24px; font-size: 1rem; }

/* ---- Hero ---- */
.hero {
  position: relative; overflow: hidden;
  background:
    radial-gradient(900px 420px at 85% -10%, rgba(56, 189, 248, .28), transparent 60%),
    radial-gradient(700px 380px at -10% 20%, rgba(11, 132, 216, .14), transparent 60%),
    linear-gradient(180deg, var(--bg-soft), var(--bg));
}
.hero-grid {
  display: grid; grid-template-columns: 1.05fr .95fr; align-items: center;
  gap: clamp(24px, 5vw, 56px); padding-top: clamp(40px, 7vw, 88px); padding-bottom: clamp(48px, 7vw, 96px);
}
.status {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  font-size: .85rem; font-weight: 600; margin-bottom: 18px;
}
.status.ok { background: var(--ok-soft); color: var(--ok); }
.status.warn { background: var(--warn-soft); color: var(--warn); }
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; position: relative; }
.status.ok .dot::after {
  content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid currentColor;
  opacity: 0; animation: ping 2s ease-out infinite;
}
@keyframes ping { 0% { transform: scale(.6); opacity: .8; } 100% { transform: scale(1.8); opacity: 0; } }
.hero h1 {
  font-size: clamp(2rem, 4.6vw, 3.4rem); line-height: 1.15; font-weight: 800; letter-spacing: -.02em;
}
.hero h1 .grad {
  background: linear-gradient(90deg, var(--primary), var(--sky));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero p.lead { margin-top: 16px; font-size: clamp(1rem, 1.6vw, 1.15rem); color: var(--muted); max-width: 560px; }
.hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.hero-art { position: relative; }
.hero-art svg { width: 100%; height: auto; filter: drop-shadow(0 24px 40px rgba(11, 132, 216, .18)); }
.sun-rays { transform-origin: 90px 70px; animation: spin 24s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.flow { stroke-dasharray: 6 8; animation: flow 1.4s linear infinite; }
@keyframes flow { to { stroke-dashoffset: -28; } }
.bar { transform-origin: bottom; transform-box: fill-box; animation: grow 2.8s ease-in-out infinite alternate; }
.bar:nth-child(2) { animation-delay: .3s; } .bar:nth-child(3) { animation-delay: .6s; }
.bar:nth-child(4) { animation-delay: .9s; } .bar:nth-child(5) { animation-delay: 1.2s; }
@keyframes grow { from { transform: scaleY(.45); } to { transform: scaleY(1); } }

/* ---- Stats ---- */
.stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 16px;
  margin-top: -44px; position: relative; z-index: 2;
}
.stat {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 22px 24px; box-shadow: var(--shadow);
}
.stat .num { font-size: clamp(1.8rem, 3.4vw, 2.4rem); font-weight: 800; color: var(--primary); line-height: 1.1; }
.stat .lbl { color: var(--muted); font-size: .95rem; margin-top: 4px; }

/* ---- Sections ---- */
section.block { padding: clamp(56px, 8vw, 96px) 0; }
.eyebrow { color: var(--primary); font-weight: 700; font-size: .85rem; letter-spacing: .08em; text-transform: uppercase; }
.section-title { font-size: clamp(1.6rem, 3.2vw, 2.3rem); font-weight: 800; line-height: 1.2; margin-top: 8px; letter-spacing: -.01em; }
.section-sub { color: var(--muted); margin-top: 10px; max-width: 640px; }
.section-head { margin-bottom: clamp(28px, 4vw, 44px); }
.center { text-align: center; } .center .section-sub { margin-left: auto; margin-right: auto; }

/* ---- Products ---- */
.products { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 20px; }
.product {
  position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 22px;
  padding: clamp(22px, 3vw, 32px); box-shadow: var(--shadow); overflow: hidden;
  transition: transform .25s, box-shadow .25s;
}
.product:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
.product-top { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.product-icon { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0; }
.product-icon.blue { background: var(--primary-soft); color: var(--primary); }
.product-icon.sun { background: var(--sun-soft); color: var(--sun); }
.product h3 { font-size: 1.25rem; font-weight: 700; line-height: 1.3; }
.tag { display: inline-block; font-size: .75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; margin-top: 4px; }
.tag.live { background: var(--ok-soft); color: var(--ok); }
.tag.soon { background: var(--sun-soft); color: #b45309; }
.product p { color: var(--muted); }
.checks { list-style: none; margin-top: 16px; display: grid; gap: 10px; }
.checks li { display: flex; gap: 10px; align-items: flex-start; }
.checks svg { flex-shrink: 0; margin-top: 3px; color: var(--primary); }
.product.soon { border-color: #fde7b0; background: linear-gradient(180deg, #fffdf6, #fff); }
.product.soon .checks svg { color: var(--sun); }
.product.soon::after {
  content: ''; position: absolute; width: 220px; height: 220px; right: -70px; top: -70px; border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 158, 11, .18), transparent 70%); pointer-events: none;
}

/* ---- Features ---- */
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.feature {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px;
  transition: transform .25s, border-color .25s, box-shadow .25s;
}
.feature:hover { transform: translateY(-4px); border-color: #b9dcf7; box-shadow: var(--shadow-lg); }
.feature .ic { width: 46px; height: 46px; border-radius: 12px; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; margin-bottom: 14px; }
.feature h3 { font-size: 1.08rem; font-weight: 700; margin-bottom: 6px; }
.feature p { color: var(--muted); font-size: .95rem; }

/* ---- Steps ---- */
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; counter-reset: step; }
.step { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 26px 24px 24px; }
.step::before {
  counter-increment: step; content: counter(step);
  width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-weight: 800;
  background: var(--primary); color: #fff; margin-bottom: 14px; box-shadow: 0 6px 14px rgba(11, 132, 216, .3);
}
.step h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: 6px; }
.step p { color: var(--muted); font-size: .95rem; }

/* ---- App download ---- */
.download {
  border-radius: 28px; padding: clamp(28px, 5vw, 56px);
  background: linear-gradient(120deg, var(--primary) 0%, #1aa3ec 55%, var(--sky) 100%);
  color: #fff; display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; align-items: center;
  box-shadow: var(--shadow-lg); position: relative; overflow: hidden;
}
.download::after {
  content: ''; position: absolute; right: -80px; bottom: -120px; width: 320px; height: 320px; border-radius: 50%;
  background: rgba(255, 255, 255, .12);
}
.download h2 { font-size: clamp(1.5rem, 3vw, 2.1rem); font-weight: 800; line-height: 1.2; }
.download p { opacity: .92; margin-top: 10px; }
.store-btns { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; position: relative; z-index: 1; }
.store {
  display: inline-flex; align-items: center; gap: 10px; background: #0f2742; color: #fff;
  padding: 10px 18px; border-radius: 12px; min-width: 180px; transition: transform .15s, background .2s;
}
.store:hover { transform: translateY(-2px); background: #081a2e; }
.store small { display: block; font-size: .7rem; opacity: .8; line-height: 1.1; }
.store strong { display: block; font-size: 1.02rem; line-height: 1.2; }
.store.web { background: rgba(255, 255, 255, .18); border: 1px solid rgba(255, 255, 255, .45); }
.store.web:hover { background: rgba(255, 255, 255, .28); }

/* ---- Contact ---- */
.contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 18px; }
.contact-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; }
.contact-card h3 { display: flex; align-items: center; gap: 10px; font-size: 1.05rem; font-weight: 700; margin-bottom: 12px; color: var(--primary); }
.contact-card dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; }
.contact-card dt { color: var(--muted); }
.contact-card dd { font-weight: 500; overflow-wrap: anywhere; }
.contact-card a { color: var(--primary); }
.contact-card a:hover { text-decoration: underline; }

/* ---- Footer ---- */
footer { border-top: 1px solid var(--line); padding: 28px 0; margin-top: 24px; color: var(--muted); font-size: .9rem; }
.foot { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; justify-content: space-between; }
.foot-links { display: flex; flex-wrap: wrap; gap: 18px; }
.foot-links a:hover { color: var(--primary); }
.ver { background: var(--primary-soft); color: var(--primary); padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; }

/* ---- Reveal on scroll (only when JS runs) ---- */
.js .reveal { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s ease; }
.js .reveal.in { opacity: 1; transform: none; }

/* ---- Responsive ---- */
@media (max-width: 960px) {
  .hero-grid { grid-template-columns: 1fr; }
  .hero-art { max-width: 520px; margin: 0 auto; width: 100%; }
  .features, .steps { grid-template-columns: repeat(2, 1fr); }
  .download { grid-template-columns: 1fr; }
  .store-btns { justify-content: flex-start; }
}
@media (max-width: 760px) {
  .nav-links, .nav-cta { display: none; }
  .nav-toggle { display: inline-flex; }
  .site-header.nav-open .nav { flex-wrap: wrap; height: auto; padding-top: 13px; padding-bottom: 13px; row-gap: 8px; }
  .site-header.nav-open .nav-toggle { order: 1; }
  .site-header.nav-open .nav-links { order: 2; }
  .site-header.nav-open .nav-cta { order: 3; }
  .site-header.nav-open { max-height: 100vh; overflow-y: auto; }
  .site-header.nav-open .nav-links,
  .site-header.nav-open .nav-cta { display: flex; flex-direction: column; width: 100%; margin: 0; gap: 4px; }
  .site-header.nav-open .nav-links a { padding: 10px 4px; border-bottom: 1px solid var(--line); }
  .site-header.nav-open .nav-cta { padding: 10px 0 4px; }
  .site-header.nav-open .nav-cta .btn { width: 100%; }
}
@media (max-width: 600px) {
  .features, .steps { grid-template-columns: 1fr; }
  .hero-cta .btn { flex: 1 1 100%; }
  .stats { margin-top: -28px; }
  .store { flex: 1 1 100%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  .js .reveal { opacity: 1; transform: none; }
}
`;
