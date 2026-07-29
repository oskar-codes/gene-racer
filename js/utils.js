/* ==========================================================================
   utils.js — small math / random / geometry helpers shared by every module.
   No dependencies. Everything is attached to the global `GR` namespace so the
   game can be opened directly from the file system (file://) without ES module
   CORS problems.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';

  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- numbers */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

  /** Shortest signed difference between two angles, in (-PI, PI]. */
  function wrapAngle(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  /** Move `a` toward `b` by at most `maxDelta` (linear, not angular). */
  function approach(a, b, maxDelta) {
    const d = b - a;
    if (Math.abs(d) <= maxDelta) return b;
    return a + Math.sign(d) * maxDelta;
  }

  const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

  /* ---------------------------------------------------------------- random */

  /**
   * mulberry32 — tiny, fast, deterministic PRNG. Identical output for identical
   * seeds on every machine, which is what makes tournaments reproducible.
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Turn any string ("kestrel-7") into a 32-bit seed. */
  function seedFromString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Convenience wrapper around mulberry32. */
  class Rng {
    constructor(seed) {
      this.seed = typeof seed === 'string' ? seedFromString(seed) : (seed >>> 0);
      this._next = mulberry32(this.seed);
    }
    unit() { return this._next(); }                       // [0,1)
    range(a, b) { return a + (b - a) * this._next(); }     // [a,b)
    int(a, b) { return Math.floor(this.range(a, b + 1)); } // inclusive ints
    pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
    /** Approximately normal, mean 0, sd 1 (sum of 3 uniforms). */
    gauss() { return (this._next() + this._next() + this._next() - 1.5) * 1.4142; }
  }

  /* -------------------------------------------------------------- geometry */

  /**
   * Centripetal Catmull-Rom interpolation between p1 and p2 (p0/p3 are the
   * neighbouring control points). Centripetal (alpha = 0.5) is used because it
   * never overshoots — important here, since overshoot would create corners
   * tighter than the track is wide.
   */
  function catmullRomPoint(p0, p1, p2, p3, t, alpha) {
    const tj = (pa, pb, ti) => ti + Math.pow(dist(pa[0], pa[1], pb[0], pb[1]), alpha);
    const t0 = 0;
    const t1 = tj(p0, p1, t0);
    const t2 = tj(p1, p2, t1);
    const t3 = tj(p2, p3, t2);
    const tt = lerp(t1, t2, t);

    const a1x = ((t1 - tt) * p0[0] + (tt - t0) * p1[0]) / (t1 - t0 || 1);
    const a1y = ((t1 - tt) * p0[1] + (tt - t0) * p1[1]) / (t1 - t0 || 1);
    const a2x = ((t2 - tt) * p1[0] + (tt - t1) * p2[0]) / (t2 - t1 || 1);
    const a2y = ((t2 - tt) * p1[1] + (tt - t1) * p2[1]) / (t2 - t1 || 1);
    const a3x = ((t3 - tt) * p2[0] + (tt - t2) * p3[0]) / (t3 - t2 || 1);
    const a3y = ((t3 - tt) * p2[1] + (tt - t2) * p3[1]) / (t3 - t2 || 1);

    const b1x = ((t2 - tt) * a1x + (tt - t0) * a2x) / (t2 - t0 || 1);
    const b1y = ((t2 - tt) * a1y + (tt - t0) * a2y) / (t2 - t0 || 1);
    const b2x = ((t3 - tt) * a2x + (tt - t1) * a3x) / (t3 - t1 || 1);
    const b2y = ((t3 - tt) * a2y + (tt - t1) * a3y) / (t3 - t1 || 1);

    return [
      ((t2 - tt) * b1x + (tt - t1) * b2x) / (t2 - t1 || 1),
      ((t2 - tt) * b1y + (tt - t1) * b2y) / (t2 - t1 || 1),
    ];
  }

  /**
   * Take a closed list of control points and return a dense, *evenly spaced*
   * polyline following a smooth closed curve through them.
   * @returns {Array<[number,number]>} points spaced ~`spacing` px apart.
   */
  function closedSpline(controls, spacing) {
    const n = controls.length;
    const fine = [];
    const STEPS = 32;
    for (let i = 0; i < n; i++) {
      const p0 = controls[(i - 1 + n) % n];
      const p1 = controls[i];
      const p2 = controls[(i + 1) % n];
      const p3 = controls[(i + 2) % n];
      for (let s = 0; s < STEPS; s++) {
        fine.push(catmullRomPoint(p0, p1, p2, p3, s / STEPS, 0.5));
      }
    }
    // Resample the fine curve at a uniform arc-length spacing.
    const m = fine.length;
    const cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      const a = fine[i], b = fine[(i + 1) % m];
      cum[i + 1] = cum[i] + dist(a[0], a[1], b[0], b[1]);
    }
    const total = cum[m];
    const count = Math.max(32, Math.round(total / spacing));
    const step = total / count;
    const out = [];
    let seg = 0;
    for (let i = 0; i < count; i++) {
      const target = i * step;
      while (seg < m - 1 && cum[seg + 1] < target) seg++;
      const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      const a = fine[seg], b = fine[(seg + 1) % m];
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    }
    return out;
  }

  /**
   * Ray / circle intersection. Returns the distance along the ray to the first
   * hit, or Infinity. Ray is (ox,oy) + t*(dx,dy) with (dx,dy) normalised.
   */
  function rayCircle(ox, oy, dx, dy, cx, cy, r) {
    const mx = ox - cx, my = oy - cy;
    const b = mx * dx + my * dy;
    const c = mx * mx + my * my - r * r;
    if (c > 0 && b > 0) return Infinity;      // origin outside & pointing away
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t < 0 ? 0 : t;
  }

  /* ------------------------------------------------------------ formatting */

  /** 83.4 -> "1:23.40" */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '—:—';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
  }

  /** 83.4 -> "83.4" (short clock for the big countdown) */
  function formatClock(seconds) {
    seconds = Math.max(0, seconds);
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds - m * 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* ----------------------------------------------------------------- files */

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------------------------------------------- colors */

  /** 24 bright, well-separated car colours. */
  const CAR_COLORS = [
    '#ff4d6d', '#4cc9f0', '#ffd166', '#06d6a0', '#b388ff', '#ff8fab',
    '#ff9f1c', '#3a86ff', '#8ac926', '#f15bb5', '#00bbf9', '#fee440',
    '#e76f51', '#2ec4b6', '#c77dff', '#ff5400', '#38b000', '#ef476f',
    '#00b4d8', '#f4a261', '#9d4edd', '#40916c', '#f72585', '#48cae4',
  ];

  /** Slightly darker version of a hex colour, for outlines/shadows. */
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(Math.round(r + 255 * amount), 0, 255);
    g = clamp(Math.round(g + 255 * amount), 0, 255);
    b = clamp(Math.round(b + 255 * amount), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  GR.utils = {
    TAU, clamp, clamp01, lerp, invLerp, smoothstep, sign, wrapAngle, approach,
    dist, dist2, mulberry32, seedFromString, Rng, closedSpline, rayCircle,
    formatTime, formatClock, ordinal, downloadText, CAR_COLORS, shade,
  };
})(window.GR);
