# Kintsugi gold — visual overhaul

**Date:** 2026-08-05
**Status:** Approved, ready for implementation planning
**Scope:** Presentation layer only. No data logic, no auth, no new features.

---

## 1. Why

The dashboard looks like a generic dark admin template. It is shown to
mechanics checking their pay, to management, and to prospective recruits —
so it is a shop window, not just a tool.

The brand concept has never been used. Kintsugi is the Japanese art of
repairing broken pottery by filling the cracks with gold, so the repair
becomes the most beautiful part of the object. This is a vehicle repair
business named after it, and the site currently expresses that as a 2px
gold underline.

The goal is a rich, cinematic dashboard built on that idea: black lacquer
surfaces, molten gold seams, gold numerals, real motion.

### Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Visual direction | Kintsugi gold | Only direction unique to this business; the concept also supplies the recruiting narrative |
| Motion | Full entrance on every load | Owner's explicit call; disciplined with a time budget (§4) |
| Implementation | Extend in place, no build step | Deploy pipeline untouched; a live payout system is the wrong place to add a bundler |
| Charts | Chart.js, re-themed | Already CDN-loaded on Analytics; the seam aesthetic is SVG/CSS, not chart-library work |
| Access control | Deliberately out of scope | Owner's call. Recorded as a known risk in §10 |

---

## 2. Design language

### 2.1 Palette

Added to `:root` in the theme layer. The existing semantic colours
(`--color-success`, `--color-warning`, `--color-error`, `--color-info`)
are unchanged.

```
Lacquer (base surfaces)
  --lacquer-0    #050404   page
  --lacquer-1    #080706   card
  --lacquer-2    #0e0c0a   raised card
  --lacquer-3    #141110   popover / modal

Gold (accent ramp)
  --gold-bright  #f4c430   highlights, gradient top stop
  --gold         #d4af37   primary accent, seams
  --gold-deep    #8a6f22   gradient bottom stop, borders
  --gold-glow    rgba(212, 175, 55, 0.45)
  --gold-wash    rgba(212, 175, 55, 0.08)

Text
  --text-primary   #f2efe8   near-white, warm. 17.5:1
  --text-secondary #a89f8c   7.7:1
  --text-tertiary  #8a8170   5.23:1 on lacquer-1, passes AA

Interactive (demoted from accent to functional)
  --accent-primary #4f46e5   links, focus rings
```

Gold carries meaning and is not decoration. It marks: live state, money
earned, the active nav item, the sorted column, and the seams. If gold is
applied to something that is none of those, it is wrong.

### 2.2 Depth

Three elevation levels. Each is a layered surface, an inner top highlight
and an outer glow — not a drop shadow. The inner highlight is what reads
as lacquer.

```
--elev-1  inset 0 1px 0 rgba(255,255,255,0.04),
          0 1px 2px rgba(0,0,0,0.6)
--elev-2  inset 0 1px 0 rgba(255,255,255,0.06),
          0 4px 16px rgba(0,0,0,0.7)
--elev-3  inset 0 1px 0 rgba(255,255,255,0.08),
          0 16px 48px rgba(0,0,0,0.8),
          0 0 0 1px var(--gold-wash)
```

### 2.3 Seams

The signature element. A seam is an inline SVG path, 1–1.2px stroke in
`--gold`, with `filter: drop-shadow(0 0 3px var(--gold-glow))`.

Rules:

- Paths are **hand-authored and irregular**. A smooth curve reads as a
  border; a crack reads as kintsugi. Each seam has 2–4 direction changes.
- A seam crosses a boundary — a card edge, a section break, the header.
  It never sits inside a card as ornament.
- Maximum **one seam per viewport-height** of page. This is the rule that
  keeps it premium instead of noisy.
- Seams are `aria-hidden="true"` and `pointer-events: none`.

Three reusable variants ship as inline SVG partials: `seam-horizontal`
(section divider), `seam-corner` (card top-left), `seam-hero` (large,
landing page only).

### 2.4 Typography

Type scale from the previous pass is retained (11/12/13/14/16/20/26/32).

Hero numerals — the primary figure on any stat card — get:

```
font-size: clamp(28px, 4vw, 44px);
font-weight: 600;
letter-spacing: -0.02em;
font-variant-numeric: tabular-nums;
background: linear-gradient(135deg, #fff6d9, var(--gold));
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
```

`tabular-nums` is required: without it, counting-up numbers visibly jitter
as glyph widths change.

Labels above hero numerals are 11px, uppercase, `letter-spacing: 0.12em`,
in `--text-tertiary`.

---

## 3. Components

| Component | Change |
|---|---|
| Stat tile | Becomes a hero tile: uppercase label, gold gradient numeral, trend delta, optional sparkline, corner seam |
| Nav | Active pill filled gold with dark text; inactive unchanged |
| Card | Lacquer surface, `--elev-2`, gold hairline top border on hover |
| Table | Gold sorted-column indicator and header underline; rows unchanged |
| Button primary | Gold gradient fill, dark text |
| Button secondary | Lacquer fill, gold border on hover |
| Input / select | Gold focus ring replacing indigo |
| Chart | Gold theme (§3.1) |
| Section divider | `seam-horizontal` replacing `border-top` |

New components: `seam-*` (3 SVG partials), `hero-number`, `sparkline`,
`trend-delta`.

### 3.1 Chart theme

A single `kintsugiChartTheme()` applied via `Chart.defaults`, so all
charts inherit it and no chart is styled ad hoc:

- Line: `--gold` stroke, 2px, with a vertical gradient fill fading to
  transparent.
- Bar: gold gradient fill, top-rounded 4px.
- Grid: `rgba(255,255,255,0.04)`, no border.
- Tooltip: `--lacquer-3` background, gold top border, 8px radius.
- Points: hidden by default, gold on hover.
- Multi-series: gold for the primary series, `--text-tertiary` for
  comparison series. Gold always means "the thing you care about".

---

## 4. Motion

Full entrance on every page load.

### 4.1 Budget

| Stage | Duration | Delay |
|---|---|---|
| Card rise + fade | 400ms | staggered 60ms per card |
| Seam draw | 900ms | 200ms |
| Number count-up | 700ms | 300ms |
| Chart line draw | 800ms | 400ms |

Total under 1.2s. Tokens: `--motion-enter`, `--motion-seam`,
`--motion-count`, `--motion-stagger`, so the whole system tunes from one
place.

### 4.2 Non-negotiable rules

1. **Content is in the DOM and readable from frame one.** Elements animate
   in place via `opacity` and `transform` only. Nothing is `display: none`
   or `visibility: hidden` pending animation. A slow connection or a
   failed script must never leave a blank page.
2. **Only `opacity` and `transform` are animated** — both compositor
   properties. Never animate `width`, `height`, `top` or `left`.
3. **Table rows never animate.** Page furniture animates; data rows appear
   instantly. Staggering 500 rows reads as broken, not premium.
4. **Below the fold animates on scroll** via `IntersectionObserver`, not
   all at once on load.
5. **Error states do not animate.** A pulsing glow on a failure implies
   activity and is a lie.

### 4.3 Reduced motion

Both `@media (prefers-reduced-motion: reduce)` and the existing
`body.reduce-motion` setting disable all entrance animation. Content
renders in its final state immediately. This is a correctness
requirement, not a nice-to-have.

---

## 5. Architecture

Two new files. No dependencies added.

```
shared-styles.css      unchanged tokens + components  (loads 1st)
kintsugi-theme.css     gold layer, overrides by design (loads 2nd)
kintsugi-motion.js     entrance orchestration          (loads last)
```

`kintsugi-theme.css` loads **after** `shared-styles.css` on every page, so
it overrides intentionally. This is the opposite of the `bank-style.css`
problem, where a page stylesheet silently redefined shared tokens; here
the override is a documented, single, deliberate layer.

`kintsugi-motion.js` exposes:

```js
kMotion.init()          // called on DOMContentLoaded, idempotent
kMotion.countUp(el)     // delegates to the existing animateNumber()
kMotion.drawSeam(el)    // stroke-dashoffset animation
kMotion.observe(el)     // register for scroll-triggered entrance
```

It reuses the six currently-dead helpers in `ui-enhancements.js`:
`animateNumber`, `createTrendIndicator`, `createProgressBar`,
`createBadge`, `smoothScrollTo`, `showEnhancedLoader`. All six have zero
call sites today.

**Data flow is unchanged.** Same fetches, same parsing, same numbers.
Sparklines reuse the per-week series Analytics already computes.

---

## 6. States

| State | Treatment |
|---|---|
| Loading | Lacquer skeleton with a gold shimmer sweep |
| Empty | Small seam illustration, message, and an action where one exists |
| Error | Static. Red border, no glow, no pulse. Retry button |
| Disabled | 45% opacity, no pointer events (already implemented) |

---

## 7. Accessibility

Requirements, not aspirations:

- Measured contrast against `--lacquer-1` (#080706):

  | Pair | Ratio | AA normal |
  |---|---|---|
  | `--gold` #d4af37 | 9.57:1 | pass |
  | `--gold-bright` #f4c430 | 12.25:1 | pass |
  | `--text-primary` #f2efe8 | 17.53:1 | pass |
  | `--text-secondary` #a89f8c | 7.67:1 | pass |
  | `--text-tertiary` #8a8170 | 5.23:1 | pass |
  | dark #2b1f04 on gold fill | 7.68:1 | pass |

  Every pairing passes AA for normal text, so gold is not restricted to
  large text. It stays reserved for the meanings in §2.1 by design, not by
  contrast limitation. The original `--text-tertiary` of #6f6858 measured
  3.64:1 and failed; it was lightened to #8a8170 because §2.4 uses it for
  11px labels.
- Gold gradient numerals need a solid `color` fallback declared before the
  `background-clip` properties, for browsers that do not support it.
- Reduced motion fully honoured (§4.3).
- Seams are `aria-hidden="true"`.
- Focus rings remain visible against lacquer; gold focus ring at 2px with
  a 2px offset.
- The skip links, landmarks and `aria-current` from the previous pass are
  preserved.

---

## 8. Verification

No browser is available in the implementing environment, which has been
the standing weakness of this work. Mitigation:

1. **`preview.html`** — a single page rendering every component in every
   state against the real stylesheets. One file to open, whole system
   visible, no clicking through six pages hunting for regressions. This is
   the primary review artefact.
2. All CSS variables resolve (scripted check, as run previously).
3. Every runtime class referenced by JS still has a CSS rule.
4. `npm test` unchanged: 23 + 6 + 15 passing, 1 known pre-existing failure.
5. Contrast spot-check on gold text pairings.

---

## 9. Out of scope

Deliberately not in this slice, each a candidate for its own spec:

- Trends and week-over-week comparison
- Anomaly detection
- Leaderboards, streaks, records
- Customer entities (officer, plate, department aggregates)
- Forecasting
- Access control and the `TRIGGER_TOKEN` exposure
- Worker-side sheet caching

---

## 10. Known risks

| Risk | Mitigation |
|---|---|
| Site is fully public and `/bot-config.js` serves `TRIGGER_TOKEN` to anyone | Explicitly deferred by the owner. Unchanged by this work, neither improved nor worsened |
| Heavy pages (Payouts, Bank) feel slow with entrance animation | Table rows excluded from animation; `IntersectionObserver` for below-fold |
| Gold gradient text unsupported in older browsers | Solid colour fallback declared first |
| Seam overuse making it look noisy | Hard rule: max one seam per viewport height |
| Theme layer drifting from base tokens | Single documented override layer; no page stylesheet may redefine tokens |
