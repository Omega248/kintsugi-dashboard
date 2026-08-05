/* =====================================================================
   Kintsugi motion — entrance animation for the dashboard pages.
   ---------------------------------------------------------------------
   Marks cards for entrance, counts hero numbers up, and draws seams as
   they scroll into view.

   SAFETY, in order of importance:
     1. Nothing is hidden until this script has run. The .k-anim-ready
        class on <html> is what enables the hidden state, and only this
        file sets it. If the script fails to load, every element stays
        visible - a broken animation must never mean a blank page.
     2. Only opacity and transform are animated. Both composite on the
        GPU and neither triggers layout.
     3. Table rows are never animated. Staggering hundreds of rows reads
        as broken, not premium.
     4. Reduced motion resolves everything instantly.
   ===================================================================== */

(function () {
  'use strict';

  var CARD_SELECTOR = [
    '.stat-box',
    '.cta-card',
    '.this-week-card',
    '.analytics-kpi-card',
    '.summary-card',
    '.data-card',
    '.chart-card'
  ].join(',');

  var NUMBER_SELECTOR = [
    '.stat-box p:not(.sub)',
    '.this-week-card-value',
    '.analytics-kpi-value'
  ].join(',');

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
           document.body.classList.contains('reduce-motion');
  }

  /* Parse "$1,284" or "1,284" into { prefix, value, suffix }, or null if
     it is not a plain number we can safely count. Anything unparseable is
     left completely alone rather than guessed at. */
  function parseNumeric(text) {
    var m = String(text).trim().match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return null;
    var n = Number(m[2].replace(/,/g, ''));
    if (!isFinite(n)) return null;
    return { prefix: m[1], value: n, suffix: m[3], decimals: (m[2].split('.')[1] || '').length };
  }

  function format(n, parts) {
    return parts.prefix +
           n.toLocaleString('en-US', {
             minimumFractionDigits: parts.decimals,
             maximumFractionDigits: parts.decimals
           }) +
           parts.suffix;
  }

  /* Count an element from 0 to whatever it already displays. The final
     value is written verbatim at the end so rounding can never leave a
     number different from the one the page computed. */
  function countUp(el) {
    if (!el || el.dataset.kCounted) return;
    var original = el.textContent;
    var parts = parseNumeric(original);
    if (!parts) return;                 // not a number, leave it be
    el.dataset.kCounted = '1';

    if (reduced()) return;              // already showing the right value

    var dur = 700, t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        el.textContent = format(parts.value * eased, parts);
        requestAnimationFrame(step);
      } else {
        el.textContent = original;      // exact original, not a rounding of it
      }
    }
    requestAnimationFrame(step);
  }

  function drawSeam(svg) {
    if (!svg || svg.dataset.kDrawn) return;
    svg.dataset.kDrawn = '1';
    var paths = svg.querySelectorAll('path');
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i], len;
      try { len = p.getTotalLength(); } catch (e) { continue; }
      if (reduced()) { p.style.strokeDasharray = 'none'; continue; }
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      /* eslint-disable no-unused-expressions */
      p.getBoundingClientRect();        // force layout so the transition runs
      p.style.transition = 'stroke-dashoffset 900ms cubic-bezier(0.4,0,0.2,1) ' + (i * 90) + 'ms';
      p.style.strokeDashoffset = '0';
    }
  }

  function reveal(el, delay) {
    if (el.classList.contains('k-entered')) return;
    setTimeout(function () {
      el.classList.add('k-entered');
      var nums = el.querySelectorAll(NUMBER_SELECTOR);
      for (var i = 0; i < nums.length; i++) countUp(nums[i]);
    }, delay || 0);
  }

  function init() {
    var cards = Array.prototype.slice.call(document.querySelectorAll(CARD_SELECTOR));
    var seams = Array.prototype.slice.call(document.querySelectorAll('.k-seam-divider'));

    if (!cards.length && !seams.length) return;

    // Only now is it safe to let CSS hide anything.
    cards.forEach(function (c) { c.setAttribute('data-k-enter', ''); });
    document.documentElement.classList.add('k-anim-ready');

    if (reduced()) {
      cards.forEach(function (c) { c.classList.add('k-entered'); });
      document.querySelectorAll(NUMBER_SELECTOR).forEach(function (n) { countUp(n); });
      seams.forEach(drawSeam);
      return;
    }

    if (!('IntersectionObserver' in window)) {
      cards.forEach(function (c, i) { reveal(c, i * 60); });
      seams.forEach(drawSeam);
      return;
    }

    // Above-the-fold cards stagger immediately; the rest wait for scroll.
    var vh = window.innerHeight || 800;
    var immediate = 0;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        if (e.target.classList.contains('k-seam-divider')) drawSeam(e.target);
        else reveal(e.target, 0);
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    cards.forEach(function (c) {
      if (c.getBoundingClientRect().top < vh) reveal(c, (immediate++) * 60);
      else io.observe(c);
    });

    seams.forEach(function (s) {
      if (s.getBoundingClientRect().top < vh) drawSeam(s);
      else io.observe(s);
    });

    /* Cards created later (tables re-rendering, filters applied) are
       shown immediately rather than animated - re-animating on every
       filter change would be maddening. */
    if ('MutationObserver' in window) {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes, function (n) {
            if (n.nodeType !== 1) return;
            if (n.matches && n.matches(CARD_SELECTOR)) n.classList.add('k-entered');
            if (n.querySelectorAll) {
              n.querySelectorAll(CARD_SELECTOR).forEach(function (c) {
                c.classList.add('k-entered');
              });
            }
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  window.kMotion = { init: init, countUp: countUp, drawSeam: drawSeam };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
