/* ==========================================================================
   stats.js — post-run analysis and the two little comparison charts.

   The point of these numbers is pedagogical: after every test run students
   should be able to say *why* the lap time changed ("we went faster but we
   spent 8 seconds in the grass").
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;

  /** Build a plain, serialisable summary of one car's run. */
  function summarize(car, race) {
    const st = car.stats;
    const t = Math.max(0.001, race.time);
    const steerPerSec = st.steerWork / t;
    return {
      laps: Math.max(0, car.laps),
      lapFraction: car.track ? (car.proj.s / car.track.length) : 0,
      distance: st.distance,
      avgSpeed: car.avgSpeed,
      topSpeed: st.topSpeed,
      bestLap: isFinite(car.bestLap) ? car.bestLap : 0,
      collisions: st.collisions,
      offTrackTime: st.offTrackTime,
      brakeEvents: st.brakeEvents,
      smoothness: U.clamp(100 - steerPerSec * 11, 0, 100),
      timeAtLimit: st.timeAtLimit,
      trace: car.trace.slice(),
      genes: Object.assign({}, car.genes),
      trackId: car.track.id,
      duration: race.duration,
      seed: String(race.seed),
    };
  }

  /**
   * The five headline metrics, with the direction that counts as "better" so
   * the chart can colour improvements green and regressions red.
   */
  const METRICS = [
    { key: 'laps', label: 'Laps', better: 'high', fmt: (v, s) => (v + (s ? '' : '')) + '', decimals: 0 },
    { key: 'avgSpeed', label: 'Avg speed', better: 'high', unit: ' px/s', decimals: 0 },
    { key: 'collisions', label: 'Collisions', better: 'low', decimals: 0 },
    { key: 'offTrackTime', label: 'Off track', better: 'low', unit: ' s', decimals: 1 },
    { key: 'brakeEvents', label: 'Brakings', better: 'low', decimals: 0 },
    { key: 'smoothness', label: 'Smoothness', better: 'high', unit: '%', decimals: 0 },
  ];

  function fmtMetric(m, v) {
    const d = m.decimals === undefined ? 1 : m.decimals;
    return v.toFixed(d) + (m.unit || '');
  }

  /* ------------------------------------------------------------------ charts */

  function prepCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(160, rect.width);
    const h = Math.max(80, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      text: cs.getPropertyValue('--text-dim').trim() || '#6b7280',
      grid: cs.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.08)',
      prev: cs.getPropertyValue('--chart-prev').trim() || '#c7cbd4',
      cur: cs.getPropertyValue('--accent').trim() || '#5b7cfa',
      good: '#16a34a',
      bad: '#ef4444',
    };
  }

  /** Grouped bars: previous run (grey) vs current run (accent). */
  function drawCompare(canvas, cur, prev) {
    const { ctx, w, h } = prepCanvas(canvas);
    if (!cur) return;
    const C = themeColors();
    const pad = { l: 8, r: 8, t: 18, b: 26 };
    const cols = METRICS.length;
    const colW = (w - pad.l - pad.r) / cols;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i < cols; i++) {
      const m = METRICS[i];
      const cv = cur[m.key] || 0;
      const pv = prev ? (prev[m.key] || 0) : 0;
      const max = Math.max(cv, pv, 1e-6);
      const x = pad.l + colW * i;
      const bw = Math.min(16, colW * 0.28);
      const base = h - pad.b;
      const maxH = base - pad.t;

      // previous
      if (prev) {
        const ph = (pv / max) * maxH;
        ctx.fillStyle = C.prev;
        GR.render.roundRect(ctx, x + colW / 2 - bw - 3, base - ph, bw, Math.max(2, ph), 3);
        ctx.fill();
      }
      // current
      const ch = (cv / max) * maxH;
      const improved = prev
        ? (m.better === 'high' ? cv > pv : cv < pv)
        : null;
      ctx.fillStyle = prev && cv !== pv ? (improved ? C.good : C.bad) : C.cur;
      GR.render.roundRect(ctx, x + colW / 2 + (prev ? 3 : -bw / 2), base - ch, bw, Math.max(2, ch), 3);
      ctx.fill();

      ctx.fillStyle = C.text;
      ctx.fillText(m.label, x + colW / 2, h - 14);
      ctx.fillStyle = C.cur;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText(fmtMetric(m, cv), x + colW / 2, 12);
      ctx.font = '600 10px system-ui, sans-serif';
    }
  }

  /** Speed over time: dashed grey = previous run, solid = current run. */
  function drawSpeedTrace(canvas, cur, prev) {
    const { ctx, w, h } = prepCanvas(canvas);
    if (!cur || !cur.trace.length) return;
    const C = themeColors();
    const pad = { l: 26, r: 8, t: 10, b: 18 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    let vmax = 1;
    for (const v of cur.trace) vmax = Math.max(vmax, v);
    if (prev) for (const v of prev.trace) vmax = Math.max(vmax, v);
    vmax = Math.ceil(vmax / 50) * 50;

    // grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 2; i++) {
      const y = pad.t + (ih * i) / 2;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(Math.round(vmax * (1 - i / 2)), pad.l - 5, y + 3);
    }
    ctx.textAlign = 'center';
    ctx.fillText('time →', pad.l + iw / 2, h - 5);

    const line = (trace, color, dash, width) => {
      if (!trace || !trace.length) return;
      ctx.save();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const n = trace.length;
      for (let i = 0; i < n; i++) {
        const x = pad.l + (iw * i) / Math.max(1, n - 1);
        const y = pad.t + ih * (1 - U.clamp01(trace[i] / vmax));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };
    if (prev) line(prev.trace, C.prev, [5, 4], 2);
    line(cur.trace, C.cur, [], 2.4);
  }

  GR.stats = { summarize, METRICS, fmtMetric, drawCompare, drawSpeedTrace };
})(window.GR);
