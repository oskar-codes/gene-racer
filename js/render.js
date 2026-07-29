/* ==========================================================================
   render.js — all canvas drawing.

   Two canvases sit on top of each other:
     #raceCanvas  the world (track, cars, debug overlays)
     #fxCanvas    confetti and full-screen effects

   The track never changes during a race, so it is painted once into an
   offscreen canvas and blitted every frame. Everything is drawn in world
   coordinates (1600x1000) through a single scale/translate transform.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;
  const { CAR_LEN, CAR_W, CAR_R } = GR.car;
  const W = GR.tracks.WORLD_W;
  const H = GR.tracks.WORLD_H;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.trackCache = null;
      this.cachedTrackId = null;
      this.cachedScale = 0;
      this.skids = [];
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    }

    /* ------------------------------------------------------------- layout */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(320, rect.width);
      const h = Math.max(240, rect.height);
      this.cssW = w; this.cssH = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.scale = Math.min(w / W, h / H);
      this.ox = (w - W * this.scale) / 2;
      this.oy = (h - H * this.scale) / 2;
    }

    _applyTransform(ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(this.ox, this.oy);
      ctx.scale(this.scale, this.scale);
    }

    /* ------------------------------------------------------- track cache */
    _centerPath(ctx, track) {
      ctx.beginPath();
      ctx.moveTo(track.px[0], track.py[0]);
      for (let i = 1; i < track.n; i++) ctx.lineTo(track.px[i], track.py[i]);
      ctx.closePath();
    }

    _buildTrackCache(track) {
      const s = this.scale * this.dpr;
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(W * s);
      cv.height = Math.ceil(H * s);
      const ctx = cv.getContext('2d');
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      const th = track.theme;

      // --- grass, with soft mown stripes -------------------------------
      ctx.fillStyle = th.grass;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = th.grassDark;
      for (let x = 0; x < W; x += 96) ctx.fillRect(x, 0, 48, H);
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#ffffff';
      for (let y = 0; y < H; y += 160) ctx.fillRect(0, y, W, 60);
      ctx.globalAlpha = 1;

      // --- wall ring ----------------------------------------------------
      this._centerPath(ctx, track);
      ctx.strokeStyle = '#2b303b';
      ctx.lineWidth = track.wallHalf * 2 + 18;
      ctx.stroke();

      // --- run-off (sand/grass) ----------------------------------------
      this._centerPath(ctx, track);
      ctx.strokeStyle = th.sand;
      ctx.lineWidth = track.wallHalf * 2;
      ctx.stroke();

      // --- curbs: white base, then red dashes on top --------------------
      this._centerPath(ctx, track);
      ctx.strokeStyle = '#f6f7fb';
      ctx.lineWidth = track.halfWidth * 2 + 16;
      ctx.stroke();
      ctx.save();
      this._centerPath(ctx, track);
      ctx.setLineDash([28, 28]);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = track.halfWidth * 2 + 16;
      ctx.stroke();
      ctx.restore();

      // --- asphalt ------------------------------------------------------
      this._centerPath(ctx, track);
      ctx.strokeStyle = th.asphalt;
      ctx.lineWidth = track.halfWidth * 2;
      ctx.stroke();

      // subtle asphalt sheen
      ctx.save();
      this._centerPath(ctx, track);
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = track.halfWidth * 0.9;
      ctx.stroke();
      ctx.restore();

      // --- dashed centre line ------------------------------------------
      ctx.save();
      this._centerPath(ctx, track);
      ctx.setLineDash([22, 26]);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // --- start / finish: a checkered band across the road -------------
      this._drawStartLine(ctx, track);

      // --- barriers -----------------------------------------------------
      for (const b of track.barriers) this._drawBarrier(ctx, b);

      this.trackCache = cv;
      this.cachedTrackId = track.id;
      this.cachedScale = s;
    }

    _drawStartLine(ctx, track) {
      const i = 0;
      const nx = track.nx[i], ny = track.ny[i];
      const tx = track.tx[i], ty = track.ty[i];
      const cx = track.px[i], cy = track.py[i];
      const half = track.halfWidth;
      const cols = 10, rows = 3;
      const cw = (half * 2) / cols;
      const ch = 9;
      ctx.save();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lat = -half + cw * (c + 0.5);
          const along = -ch * rows * 0.5 + ch * (r + 0.5);
          const x = cx + nx * lat + tx * along;
          const y = cy + ny * lat + ty * along;
          ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#1b1f27';
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(ty, tx));
          ctx.fillRect(-ch / 2, -cw / 2, ch, cw);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    _drawBarrier(ctx, b) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(2, 3, b.r, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#22252d';
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#3a3f4b';
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.62, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.82, 0, U.TAU); ctx.stroke();
      ctx.restore();
    }

    /* --------------------------------------------------------- main draw */
    /**
     * @param {object} view
     *   track, cars, ghost, showRays, showLine, showBrake, showLabels,
     *   phase, countdown, replayFrame
     */
    draw(view) {
      const ctx = this.ctx;
      const track = view.track;
      const s = this.scale * this.dpr;
      if (!this.trackCache || this.cachedTrackId !== track.id || Math.abs(this.cachedScale - s) > 0.01) {
        this._buildTrackCache(track);
      }

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);

      // Blit the cached track.
      ctx.drawImage(this.trackCache, this.ox, this.oy, W * this.scale, H * this.scale);

      this._applyTransform(ctx);

      this._drawSkids(ctx);

      if (view.showLine && view.cars.length) this._drawRacingLine(ctx, track, view.cars[0]);
      if (view.showBrake && view.cars.length) this._drawBrakeZone(ctx, track, view.cars[0]);

      if (view.ghost) this._drawGhost(ctx, view.ghost);

      for (const car of view.cars) {
        if (view.showRays) this._drawRays(ctx, car);
      }
      for (const car of view.cars) this._drawCar(ctx, car, view);
      if (view.showRays && view.cars.length === 1) this._drawSteerArrow(ctx, view.cars[0]);
    }

    /* ------------------------------------------------------------- skids */
    addSkid(car) {
      if (this.skids.length > 900) this.skids.splice(0, 200);
      const c = Math.cos(car.heading), s = Math.sin(car.heading);
      const px = -c * CAR_LEN * 0.3, py = -s * CAR_LEN * 0.3;
      const nx = -s * CAR_W * 0.35, ny = c * CAR_W * 0.35;
      this.skids.push(
        { x: car.x + px + nx, y: car.y + py + ny, a: 0.5 },
        { x: car.x + px - nx, y: car.y + py - ny, a: 0.5 }
      );
    }

    _drawSkids(ctx) {
      ctx.save();
      for (const m of this.skids) {
        m.a -= 0.0035;
        if (m.a <= 0) continue;
        ctx.globalAlpha = m.a * 0.6;
        ctx.fillStyle = '#1a1c22';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.6, 0, U.TAU);
        ctx.fill();
      }
      ctx.restore();
      if (this.skids.length && this.skids[0].a <= 0) {
        this.skids = this.skids.filter((m) => m.a > 0);
      }
    }

    clearSkids() { this.skids.length = 0; }

    /* -------------------------------------------------------------- debug */
    _drawRays(ctx, car) {
      if (!car.sensors) return;
      const c = Math.cos(car.heading), s = Math.sin(car.heading);
      const ox = car.x + c * CAR_LEN * 0.4;
      const oy = car.y + s * CAR_LEN * 0.4;
      ctx.save();
      ctx.lineWidth = 2;
      for (const ray of car.rays) {
        const a = car.heading + ray.ang;
        const ex = ox + Math.cos(a) * ray.dist;
        const ey = oy + Math.sin(a) * ray.dist;
        const t = U.clamp01(ray.dist / ray.range);
        const col = ray.type === 'car' ? '255,159,28' : ray.type === 'barrier' ? '244,63,94' : '76,201,240';
        ctx.strokeStyle = `rgba(${col},${0.20 + 0.55 * (1 - t)})`;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},${0.35 + 0.6 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(ex, ey, 3.4, 0, U.TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    /** The line the AI is currently trying to follow, from its own genes. */
    _drawRacingLine(ctx, track, car) {
      const p = car.p;
      const usable = track.halfWidth * p.usableFrac;
      ctx.save();
      ctx.beginPath();
      const start = car.proj ? car.proj.index : 0;
      const count = Math.round(track.n * 0.55);
      for (let step = 0; step <= count; step++) {
        const i = (start + step) % track.n;
        const kNow = avgK(track, i, p.aimAhead * 0.6);
        const kSoon = avgK(track, (i + Math.round(p.aimAhead * 1.6 / 5)) % track.n, p.aimAhead);
        const inside = U.sign(kNow) * Math.min(1, Math.abs(kNow) * 170);
        const outside = U.sign(kSoon) * Math.min(1, Math.abs(kSoon) * 170);
        const lat = usable * U.clamp(inside * 0.95 - outside * 0.6, -1, 1);
        const pt = track.pointAt(i, lat);
        if (step === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 10]);
      ctx.stroke();
      ctx.restore();

      // The waypoint the car is steering at right now.
      if (car.aimX !== undefined) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.fillStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(car.aimX, car.aimY, 7, 0, U.TAU); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    /** Paint the stretch of road the AI has decided to brake for. */
    _drawBrakeZone(ctx, track, car) {
      if (!car.proj) return;
      const braking = car.state && car.state.id === 'BRAKE';
      const len = Math.max(40, car.brakeZone || 0);
      const steps = Math.round(len / 5);
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineWidth = track.halfWidth * 2 - 6;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const idx = (car.proj.index + i) % track.n;
        if (i === 0) ctx.moveTo(track.px[idx], track.py[idx]);
        else ctx.lineTo(track.px[idx], track.py[idx]);
      }
      ctx.strokeStyle = braking ? 'rgba(239,68,68,0.30)' : 'rgba(6,214,160,0.16)';
      ctx.stroke();
      ctx.restore();
    }

    _drawSteerArrow(ctx, car) {
      const len = 34 + Math.abs(car.speed) * 0.09;
      const a = car.heading + car.steer * 0.8;
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(CAR_LEN * 0.5, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(len + 9, 0);
      ctx.lineTo(len - 3, -6);
      ctx.lineTo(len - 3, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /* --------------------------------------------------------------- cars */
    _drawGhost(ctx, ghost) {
      if (!ghost) return;
      ctx.save();
      ctx.globalAlpha = 0.38;
      this._carShape(ctx, ghost.x, ghost.y, ghost.heading, '#9aa4b2', 0, false);
      ctx.restore();
    }

    _drawCar(ctx, car, view) {
      const flash = car.hitFlash > 0;
      this._carShape(ctx, car.x, car.y, car.heading, car.color, car.steer, true, flash, car.slip);

      if (view.showLabels) {
        ctx.save();
        const label = `${car.position ? car.position + '. ' : ''}${car.name}`;
        ctx.font = '600 15px "Baloo 2", system-ui, sans-serif';
        const w = ctx.measureText(label).width + 16;
        const y = car.y - 30;
        ctx.fillStyle = 'rgba(15,18,26,0.72)';
        roundRect(ctx, car.x - w / 2, y - 13, w, 22, 8);
        ctx.fill();
        ctx.fillStyle = car.color;
        ctx.fillRect(car.x - w / 2, y - 13, 4, 22);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, car.x + 2, y - 1);
        ctx.restore();
      }
    }

    _carShape(ctx, x, y, heading, color, steer, detail, flash, slip) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      roundRect(ctx, -CAR_LEN / 2 + 2, -CAR_W / 2 + 3, CAR_LEN, CAR_W, 6);
      ctx.fill();

      if (detail) {
        // wheels
        ctx.fillStyle = '#191c23';
        const wheel = (wx, wy, ang) => {
          ctx.save();
          ctx.translate(wx, wy);
          ctx.rotate(ang);
          roundRect(ctx, -6, -3.2, 12, 6.4, 2.5);
          ctx.fill();
          ctx.restore();
        };
        const sa = (steer || 0) * 0.5;
        wheel(CAR_LEN * 0.30, -CAR_W * 0.52, sa);
        wheel(CAR_LEN * 0.30, CAR_W * 0.52, sa);
        wheel(-CAR_LEN * 0.30, -CAR_W * 0.52, 0);
        wheel(-CAR_LEN * 0.30, CAR_W * 0.52, 0);
      }

      // body
      ctx.fillStyle = color;
      roundRect(ctx, -CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 6);
      ctx.fill();

      // nose highlight + cockpit
      ctx.fillStyle = U.shade(color, 0.18);
      roundRect(ctx, CAR_LEN * 0.16, -CAR_W / 2 + 1.5, CAR_LEN * 0.3, CAR_W - 3, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,24,33,0.85)';
      roundRect(ctx, -CAR_LEN * 0.14, -CAR_W * 0.30, CAR_LEN * 0.26, CAR_W * 0.6, 3);
      ctx.fill();

      // rear wing
      ctx.fillStyle = U.shade(color, -0.22);
      roundRect(ctx, -CAR_LEN / 2 - 2, -CAR_W * 0.58, 5, CAR_W * 1.16, 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.4;
      roundRect(ctx, -CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 6);
      ctx.stroke();

      if (flash) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, CAR_R + 6, 0, U.TAU);
        ctx.stroke();
      }
      if (slip > 0.15) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, slip)})`;
        ctx.beginPath();
        ctx.arc(-CAR_LEN * 0.45, 0, 5 + slip * 6, 0, U.TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /* -------------------------------------------------------------- helpers */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function avgK(track, idx, dist) {
    const n = Math.max(1, Math.round(dist / 5));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += track.k[(idx + i) % track.n];
    return sum / n;
  }

  /* ------------------------------------------------------------- confetti */

  class Confetti {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.parts = [];
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.running = false;
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.w = rect.width; this.h = rect.height;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }
    burst(count) {
      this.resize();
      const colors = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c', '#f72585'];
      for (let i = 0; i < (count || 220); i++) {
        this.parts.push({
          x: this.w * Math.random(),
          y: -20 - Math.random() * this.h * 0.6,
          vx: (Math.random() - 0.5) * 90,
          vy: 90 + Math.random() * 190,
          rot: Math.random() * U.TAU,
          vr: (Math.random() - 0.5) * 9,
          w: 6 + Math.random() * 8,
          h: 9 + Math.random() * 12,
          c: colors[(Math.random() * colors.length) | 0],
          life: 4.5 + Math.random() * 2.5,
        });
      }
      this.running = true;
    }
    update(dt) {
      if (!this.running) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      let alive = 0;
      for (const p of this.parts) {
        p.life -= dt;
        if (p.life <= 0) continue;
        alive++;
        p.vy += 130 * dt;
        p.vx *= 0.995;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = U.clamp01(p.life);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.5 + 0.5 * Math.abs(Math.cos(p.rot))));
        ctx.restore();
      }
      if (alive === 0) { this.stop(); }
    }
    stop() {
      this.running = false;
      this.parts.length = 0;
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  GR.render = { Renderer, Confetti, roundRect };
})(window.GR);
