/* =====================================================================
   Kintsugi intro — loading screen for the dashboard.
   ---------------------------------------------------------------------
   Builds the overlay, then reports genuine progress: each stage moves
   when the real fetch/parse work moves, not on a timer. The seam network
   draws in step with it.

   Public API (all no-ops if the overlay was never built):
     kIntro.stage(id, 'active' | 'done' | 'failed', note)
     kIntro.finish()      dismiss with the completion flare
     kIntro.dismiss()     dismiss immediately, no flare

   SAFETY: the overlay can never trap someone.
     - a hard failsafe dismisses it after FAILSAFE_MS no matter what
     - any failed stage reveals a "Continue anyway" button
     - the button also appears if loading overruns SLOW_MS
     - Escape dismisses it
   ===================================================================== */

(function () {
  'use strict';

  // Opt-in, not path-sniffing: a page asks for the intro by putting
  // data-kintsugi-intro on <html>. Explicit, and it means the preview
  // harness can exercise this exactly as the real page does.
  if (!document.documentElement.hasAttribute('data-kintsugi-intro')) return;

  // Pacing. The stage list finishes arriving at ~1.6s, so dismissing
  // much before ~3.4s means nobody ever reads it. On a warm cache the
  // data is ready in ~150ms, so MIN_SHOW_MS is what actually governs
  // how long this is on screen almost every time.
  var FAILSAFE_MS = 14000;  // absolute ceiling before we let go regardless
  var SLOW_MS     = 5000;   // offer the escape hatch after this
  var MIN_SHOW_MS = 3400;   // floor, so the screen is readable not a flash
  var HOLD_MS     = 900;    // beat after 100% before dismissing

  var STAGES = [
    { id: 'connect', label: 'Connecting to records' },
    { id: 'jobs',    label: 'Loading job history'   },
    { id: 'config',  label: 'Reading configuration' },
    { id: 'compute', label: 'Computing payouts'     }
  ];

  // Hand-drawn irregular paths. Smooth curves read as borders; cracks
  // read as kintsugi, so each has several direction changes.
  var SEAM_PATHS = [
    'M-20,140 C120,120 190,232 330,208 C452,187 520,66 660,92 C790,116 880,44 1020,62',
    'M-20,690 C140,672 236,560 372,590 C500,618 590,712 726,690 C860,668 930,742 1020,720',
    'M120,-20 C150,120 96,206 140,320 C180,424 128,520 160,660 C186,772 140,830 152,900',
    'M880,-20 C856,110 906,190 872,300 C840,404 890,498 862,620 C838,724 880,800 868,900'
  ];
  var HAIR_PATHS = [
    'M330,208 C356,282 300,330 322,404',
    'M726,690 C700,610 748,566 720,494',
    'M140,320 C210,344 262,300 330,318',
    'M872,300 C806,326 760,286 700,306'
  ];

  var root, rule, pct, escapeBtn, seamEls = [];
  var built = false, done = false;
  var shownAt = 0, failsafeTimer = null, slowTimer = null;
  var current = 0, tweenId = null;

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
           document.body.classList.contains('reduce-motion');
  }

  function build() {
    if (built) return;
    built = true;
    shownAt = Date.now();

    root = document.createElement('div');
    root.className = 'k-intro';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Loading the Kintsugi Motorworks dashboard');

    var seamSvg =
      '<svg class="k-intro-seams" viewBox="0 0 1000 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      SEAM_PATHS.map(function (d) { return '<path class="k-seam" d="' + d + '" stroke-width="1.15"/>'; }).join('') +
      HAIR_PATHS.map(function (d) { return '<path class="k-seam k-seam--hair" d="' + d + '"/>'; }).join('') +
      '</svg>';

    var word = 'KINTSUGI';
    var letters = word.split('').map(function (ch, i) {
      return '<span style="animation-delay:' + (140 + i * 55) + 'ms">' + ch + '</span>';
    }).join('');

    var stageList = STAGES.map(function (s, i) {
      return '<li class="k-stage" data-stage="' + s.id + '"' +
             ' style="animation-delay:' + (1320 + i * 130) + 'ms">' +
               '<span class="k-stage-dot" aria-hidden="true"></span>' +
               '<span class="k-stage-label">' + s.label + '</span>' +
               '<span class="k-stage-note"></span>' +
             '</li>';
    }).join('');

    root.innerHTML =
      seamSvg +
      '<div class="k-intro-core">' +
        '<h1 class="k-intro-mark">' + letters + '</h1>' +
        '<p class="k-intro-sub">Motorworks</p>' +
        '<div class="k-intro-rule"><i></i></div>' +
        '<div class="k-intro-readout">' +
          '<span class="k-intro-pct">0<sup>%</sup></span>' +
        '</div>' +
        '<ul class="k-intro-stages">' + stageList + '</ul>' +
        '<button type="button" class="k-intro-escape">Continue anyway</button>' +
      '</div>';

    document.body.appendChild(root);
    document.body.classList.add('k-intro-open');

    rule      = root.querySelector('.k-intro-rule i');
    pct       = root.querySelector('.k-intro-pct');
    escapeBtn = root.querySelector('.k-intro-escape');
    seamEls   = Array.prototype.slice.call(root.querySelectorAll('.k-seam'));

    // Seams start undrawn and fill as progress arrives
    seamEls.forEach(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray  = len;
      p.style.strokeDashoffset = len;
      p.dataset.len = len;
      if (!reduced()) p.style.transition = 'stroke-dashoffset 620ms cubic-bezier(0.4,0,0.2,1)';
    });

    if (!reduced()) motes();

    escapeBtn.addEventListener('click', function () { api.dismiss(); });
    document.addEventListener('keydown', onKey);

    failsafeTimer = setTimeout(function () { api.dismiss(); }, FAILSAFE_MS);
    slowTimer     = setTimeout(offerEscape, SLOW_MS);

    if (reduced()) setProgress(1);
  }

  function onKey(e) {
    if (e.key === 'Escape' && !done) api.dismiss();
  }

  function motes() {
    for (var i = 0; i < 14; i++) {
      var m = document.createElement('i');
      m.className = 'k-mote';
      m.style.left = (6 + Math.random() * 88) + '%';
      m.style.top  = (72 + Math.random() * 28) + '%';
      m.style.animationDuration = (7 + Math.random() * 9) + 's';
      m.style.animationDelay    = (Math.random() * 6) + 's';
      root.appendChild(m);
    }
  }

  function offerEscape() {
    if (!escapeBtn || done) return;
    escapeBtn.classList.add('is-shown');
  }

  function paint(frac) {
    if (rule) rule.style.width = (frac * 100) + '%';
    if (pct)  pct.innerHTML = Math.round(frac * 100) + '<sup>%</sup>';
    seamEls.forEach(function (p) {
      var len = Number(p.dataset.len) || 0;
      p.style.strokeDashoffset = len * (1 - frac);
    });
  }

  // Stages settle in jumps of 25%. Tweening between them keeps the
  // number and the seams moving continuously instead of ticking.
  function setProgress(target) {
    target = Math.max(0, Math.min(1, target));
    if (reduced()) { current = target; paint(target); return; }

    var from = current, delta = target - from, t0 = null, DUR = 620;
    if (tweenId) cancelAnimationFrame(tweenId);

    tweenId = requestAnimationFrame(function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / DUR);
      var eased = 1 - Math.pow(1 - k, 3);        // ease-out cubic
      current = from + delta * eased;
      paint(current);
      if (k < 1) tweenId = requestAnimationFrame(step);
      else { current = target; tweenId = null; }
    });
  }

  function recompute() {
    if (!root) return;
    var nodes = root.querySelectorAll('.k-stage');
    var settled = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].classList.contains('is-done') ||
          nodes[i].classList.contains('is-failed')) settled++;
    }
    setProgress(nodes.length ? settled / nodes.length : 1);
  }

  var api = {
    stage: function (id, state, note) {
      if (!root || done) return;
      var el = root.querySelector('.k-stage[data-stage="' + id + '"]');
      if (!el) return;

      el.classList.remove('is-active', 'is-done', 'is-failed');
      if (state) el.classList.add('is-' + state);

      var noteEl = el.querySelector('.k-stage-note');
      if (noteEl && note != null) noteEl.textContent = note;

      // A failure must always leave a way out
      if (state === 'failed') offerEscape();

      recompute();
    },

    finish: function () {
      if (!root || done) return;
      setProgress(1);
      root.classList.add('is-complete');

      // Never dismiss before MIN_SHOW_MS, and always leave a beat at 100%
      // so the seams flare and the numbers land before it lifts away.
      var elapsed = Date.now() - shownAt;
      var wait = reduced() ? 0 : Math.max(0, MIN_SHOW_MS - elapsed) + HOLD_MS;
      setTimeout(api.dismiss, wait);
    },

    dismiss: function () {
      if (!root || done) return;
      done = true;
      clearTimeout(failsafeTimer);
      clearTimeout(slowTimer);
      document.removeEventListener('keydown', onKey);

      root.classList.add('is-done');
      document.body.classList.remove('k-intro-open');

      var remove = function () {
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
        // Hand focus to the page so keyboard users land somewhere sensible
        var main = document.getElementById('main');
        if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
      };

      if (reduced()) remove();
      else setTimeout(remove, 720);
    },

    isActive: function () { return !!root && !done; }
  };

  window.kIntro = api;

  // Build as early as possible so there is no flash of the raw dashboard.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
