// Script of the public landing page, served as /landing.js (the CSP allows
// scripts from 'self' only, no inline script). Progressive enhancement: the
// page is fully readable without it.
export const LANDING_JS = `(function () {
  // Wait for the DOM (works with defer, async or an inline copy in <head>).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  function init() {
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Header: shadow once scrolled, mobile menu toggle.
  var header = document.querySelector('.site-header');
  var onScroll = function () { if (header) header.classList.toggle('scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  var toggle = document.querySelector('.nav-toggle');
  if (toggle && header) {
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    header.querySelectorAll('.nav-links a, .nav-cta a').forEach(function (a) {
      a.addEventListener('click', function () {
        header.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Count-up numbers ([data-count], optional data-suffix).
  var fmt = function (n) { return Math.round(n).toLocaleString('vi-VN'); };
  var countUp = function (el) {
    var target = Number(el.getAttribute('data-count')) || 0;
    var suffix = el.getAttribute('data-suffix') || '';
    if (reduce || target <= 0) { el.textContent = fmt(target) + suffix; return; }
    var start = null, dur = 1400;
    var tick = function (t) {
      if (start === null) start = t;
      var p = Math.min(1, (t - start) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  var items = document.querySelectorAll('.reveal, [data-count]');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); if (el.hasAttribute('data-count')) countUp(el); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.hasAttribute('data-count')) countUp(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });
  items.forEach(function (el) { io.observe(el); });
  }
})();
`;
