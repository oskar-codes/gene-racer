/* ==========================================================================
   tracks.js — track definitions + the geometry engine used by the AI, the
   physics and the renderer.

   A track is stored as a *closed centre line*: a dense list of evenly spaced
   samples, each carrying its tangent, normal, arc-length and curvature.
   Everything else in the game is expressed relative to that line:

       lateral offset  0            -> exactly on the centre line
       |lateral| <= halfWidth       -> on asphalt
       |lateral| <= wallHalf        -> on the run-off (grass): big speed penalty
       |lateral| >  wallHalf        -> wall collision

   This "road-space" representation makes sensors, lap counting, the racing
   line and collision detection all cheap and robust.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;

  /** World is a fixed 1600x1000 box; the renderer scales it to the canvas. */
  const WORLD_W = 1600;
  const WORLD_H = 1000;

  /* ------------------------------------------------------------------------
     Helper: build control points on a modulated ellipse. Radial "star shaped"
     loops can never self-intersect, which keeps the road-space maths valid.
     ------------------------------------------------------------------------ */
  function radialLoop(cx, cy, rx, ry, count, modFn) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * U.TAU;
      const r = modFn ? modFn(a) : 1;
      pts.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]);
    }
    return pts;
  }

  /* ------------------------------------------------------------------------
     Track definitions
     ------------------------------------------------------------------------ */
  /*
     Layout rule of thumb: the outer wall sits `wallHalf` from the centre line,
     so the road-space mapping is only single-valued while wallHalf stays below
     the tightest corner radius. Every layout below keeps wallHalf / minRadius
     under ~0.75 (printed to the console on load) — that margin is what stops
     cars from being teleported into phantom walls inside hairpins.
  */
  const TRACK_DEFS = [
    {
      id: 'oval',
      name: 'Easy Oval',
      emoji: '🟢',
      difficulty: 'Beginner',
      blurb: 'Wide, fast and forgiving. Perfect for seeing what top speed does.',
      width: 140,          // asphalt
      runoff: 46,          // grass shoulder on each side
      theme: { grass: '#7fce6f', grassDark: '#6cb95d', sand: '#f2d492', asphalt: '#4a4e57' },
      controls: radialLoop(800, 500, 600, 370, 20, (a) => 1 + 0.03 * Math.sin(2 * a)),
      barriers: [],
    },
    {
      id: 'technical',
      name: 'Technical Circuit',
      emoji: '🟡',
      difficulty: 'Medium',
      blurb: 'Fast sweepers linked by slower corners. This is where braking starts to matter.',
      width: 106,
      runoff: 42,
      theme: { grass: '#6fc7d8', grassDark: '#5cb2c4', sand: '#ffe08a', asphalt: '#474b54' },
      controls: radialLoop(800, 500, 580, 355, 24, (a) =>
        1 + 0.10 * Math.sin(2 * a + 1.0) + 0.04 * Math.sin(4 * a + 0.4)),
      barriers: [
        { t: 0.34, off: 0.52, r: 12 },
        { t: 0.72, off: -0.52, r: 12 },
      ],
    },
    {
      id: 'chicane',
      name: 'Chicane Track',
      emoji: '🟠',
      difficulty: 'Hard',
      blurb: 'Long straights broken by quick left-right flicks. Rewards smooth steering.',
      width: 102,
      runoff: 39,
      theme: { grass: '#8f8fd6', grassDark: '#7d7dc4', sand: '#ffd6e0', asphalt: '#464a53' },
      // A 4th harmonic on a long ellipse: four S-bends, two per long side.
      controls: radialLoop(800, 500, 625, 340, 32, (a) => 1 + 0.06 * Math.sin(4 * a)),
      barriers: [{ t: 0.30, off: 0.5, r: 11 }, { t: 0.80, off: -0.5, r: 11 }],
    },
    {
      id: 'mountain',
      name: 'Mountain Road',
      emoji: '🔴',
      difficulty: 'Expert',
      blurb: 'Narrow, twisty and unforgiving. Only a well-balanced driver survives here.',
      width: 94,
      runoff: 35,
      theme: { grass: '#a8894f', grassDark: '#957a45', sand: '#e8d5a3', asphalt: '#494d56' },
      controls: radialLoop(800, 500, 580, 350, 30, (a) =>
        1 + 0.07 * Math.sin(3 * a + 0.6) + 0.04 * Math.sin(5 * a + 2.1) - 0.04 * Math.cos(2 * a)),
      barriers: [
        { t: 0.18, off: 0.5, r: 11 },
        { t: 0.46, off: -0.5, r: 11 },
        { t: 0.63, off: 0.5, r: 11 },
        { t: 0.88, off: -0.45, r: 11 },
      ],
    },
    {
      id: 'volcanic',
      name: 'Volcanic Gauntlet',
      emoji: '🔥',
      difficulty: 'Nightmare',
      blurb: 'Ultra-tight hairpins, sudden direction changes and packed barriers. Only the most balanced driver can survive it.',
      width: 90,
      runoff: 27,
      // width: 68,
      // runoff: 24,
      theme: { grass: '#b86a4b', grassDark: '#9e563b', sand: '#f1c27a', asphalt: '#3f434c' },
      controls: radialLoop(800, 500, 560, 300, 42, (a) =>
        1 + 0.16 * Math.sin(5 * a + 0.25)
          + 0.09 * Math.sin(9 * a + 1.35)
          - 0.06 * Math.cos(3 * a + 0.8)),
      barriers: [
        { t: 0.08, off: 0.52, r: 11 },
        { t: 0.14, off: -0.50, r: 11 },
        { t: 0.22, off: 0.56, r: 12 },
        { t: 0.31, off: -0.58, r: 12 },
        { t: 0.44, off: 0.54, r: 11 },
        { t: 0.57, off: -0.53, r: 11 },
        { t: 0.68, off: 0.58, r: 12 },
        { t: 0.79, off: -0.54, r: 11 },
        { t: 0.91, off: 0.50, r: 11 },
      ],
    },
  ];

  /* ------------------------------------------------------------------------
     Track — the built geometry + query helpers.
     ------------------------------------------------------------------------ */
  class Track {
    constructor(def) {
      this.def = def;
      this.id = def.id;
      this.name = def.name;
      this.theme = def.theme;
      this.halfWidth = def.width / 2;
      this.wallHalf = def.width / 2 + def.runoff;

      this._buildCenterline();
      this._buildCurvature();
      this._buildLookupGrid();
      this._buildBarriers();
    }

    /* --------------------------------------------------- centre line ----- */
    _buildCenterline() {
      const SPACING = 5;                                  // px between samples
      const pts = U.closedSpline(this.def.controls, SPACING);
      const n = pts.length;

      this.n = n;
      this.px = new Float64Array(n);
      this.py = new Float64Array(n);
      this.tx = new Float64Array(n);                      // unit tangent
      this.ty = new Float64Array(n);
      this.nx = new Float64Array(n);                      // unit normal (left)
      this.ny = new Float64Array(n);
      this.sArr = new Float64Array(n);                    // arc length at i
      this.ds = new Float64Array(n);                      // length of segment i

      for (let i = 0; i < n; i++) { this.px[i] = pts[i][0]; this.py[i] = pts[i][1]; }

      let acc = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = this.px[j] - this.px[i];
        const dy = this.py[j] - this.py[i];
        const len = Math.hypot(dx, dy) || 1e-6;
        this.ds[i] = len;
        this.tx[i] = dx / len;
        this.ty[i] = dy / len;
        this.nx[i] = -this.ty[i];                         // rotate tangent +90°
        this.ny[i] = this.tx[i];
        this.sArr[i] = acc;
        acc += len;
      }
      this.length = acc;
    }

    /* ----------------------------------------------------- curvature ----- */
    _buildCurvature() {
      const n = this.n;
      const raw = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // signed turn rate: positive = curving left
        const dAng = U.wrapAngle(Math.atan2(this.ty[j], this.tx[j]) - Math.atan2(this.ty[i], this.tx[i]));
        raw[i] = dAng / (this.ds[i] || 1e-6);
      }
      // Smooth over ~40 px so single-sample noise doesn't scare the AI.
      const win = 4;
      this.k = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let o = -win; o <= win; o++) sum += raw[(i + o + n * 2) % n];
        this.k[i] = sum / (win * 2 + 1);
      }
      // Minimum corner radius — used to sanity-check the layout while tuning.
      let maxK = 0;
      for (let i = 0; i < n; i++) maxK = Math.max(maxK, Math.abs(this.k[i]));
      this.minRadius = 1 / (maxK || 1e-6);
    }

    /* ---------------------------------------------- fast nearest lookup --- */
    /**
     * A uniform grid over the world storing, for every cell, the index of the
     * nearest centre-line sample. Turns `project()` into an O(1) lookup plus a
     * tiny local refinement — vital because sensor ray-marching hammers it.
     */
    _buildLookupGrid() {
      const CS = 20;
      this.cell = CS;
      this.gw = Math.ceil(WORLD_W / CS) + 2;
      this.gh = Math.ceil(WORLD_H / CS) + 2;
      this.grid = new Int32Array(this.gw * this.gh);
      const n = this.n;
      for (let gy = 0; gy < this.gh; gy++) {
        for (let gx = 0; gx < this.gw; gx++) {
          const wx = (gx - 1) * CS + CS / 2;
          const wy = (gy - 1) * CS + CS / 2;
          let best = 0, bestD = Infinity;
          for (let i = 0; i < n; i++) {
            const d = U.dist2(wx, wy, this.px[i], this.py[i]);
            if (d < bestD) { bestD = d; best = i; }
          }
          this.grid[gy * this.gw + gx] = best;
        }
      }
    }

    /**
     * Barriers live in road space so they always sit on the track. They are
     * deliberately kept off the centre line: an obstacle in the middle of the
     * road with a clear path on neither side is a trap, not a challenge.
     */
    _buildBarriers() {
      this.barriers = (this.def.barriers || []).map((b) => {
        const idx = Math.floor(b.t * this.n) % this.n;
        const off = U.sign(b.off || 1) * U.clamp(Math.abs(b.off), 0.35, 0.75);
        const lat = off * this.halfWidth;
        return {
          x: this.px[idx] + this.nx[idx] * lat,
          y: this.py[idx] + this.ny[idx] * lat,
          r: b.r,
          idx,
          lat,
          s: this.sArr[idx],
        };
      });
    }

    /* --------------------------------------------------------- queries --- */

    /** Grid-accelerated nearest-sample index for any world point. */
    nearestIndex(x, y) {
      const gx = U.clamp(Math.floor(x / this.cell) + 1, 0, this.gw - 1);
      const gy = U.clamp(Math.floor(y / this.cell) + 1, 0, this.gh - 1);
      return this.grid[gy * this.gw + gx];
    }

    /**
     * Project a world point onto the centre line.
     * @param hint optional previous index — makes the result continuous for a
     *             moving car (essential for lap counting).
     * @returns {{index:number, s:number, lateral:number, ang:number, k:number}}
     */
    project(x, y, hint) {
      const n = this.n;
      // The grid is exact for a cell centre, so the true nearest sample is at
      // most ~1 cell diagonal (≈6 samples) away. With a hint from the previous
      // frame an even smaller window is enough — a car moves under 2 samples
      // per tick. Keeping these windows tight matters: ray-marching calls this
      // thousands of times per frame.
      let center, win;
      if (hint === undefined || hint === null) {
        center = this.nearestIndex(x, y); win = 8;
      } else {
        center = hint; win = 10;
      }
      let best = center, bestD = Infinity;
      for (let o = -win; o <= win; o++) {
        const i = (center + o + n * 4) % n;
        const d = U.dist2(x, y, this.px[i], this.py[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      // Refine: project onto the segment leaving `best` and the one entering it.
      let bi = best, bt = 0, bDist = Infinity;
      for (const i of [(best - 1 + n) % n, best]) {
        const dx = x - this.px[i], dy = y - this.py[i];
        let t = (dx * this.tx[i] + dy * this.ty[i]) / (this.ds[i] || 1e-6);
        t = U.clamp(t, 0, 1);
        const cxp = this.px[i] + this.tx[i] * this.ds[i] * t;
        const cyp = this.py[i] + this.ty[i] * this.ds[i] * t;
        const d = U.dist2(x, y, cxp, cyp);
        if (d < bDist) { bDist = d; bi = i; bt = t; }
      }
      const lateral = (x - this.px[bi]) * this.nx[bi] + (y - this.py[bi]) * this.ny[bi];
      return {
        index: bi,
        s: this.sArr[bi] + this.ds[bi] * bt,
        lateral,
        ang: Math.atan2(this.ty[bi], this.tx[bi]),
        k: this.k[bi],
      };
    }

    /** Index of the sample `d` metres (px) further along from index i. */
    advance(i, d) {
      // Samples are ~5px apart; use the local ds for a good approximation.
      return (i + Math.round(d / (this.ds[i] || 5)) % this.n + this.n * 2) % this.n;
    }

    /** World position of the centre line at sample index (+ lateral offset). */
    pointAt(i, lateral) {
      i = ((i % this.n) + this.n) % this.n;
      lateral = lateral || 0;
      return {
        x: this.px[i] + this.nx[i] * lateral,
        y: this.py[i] + this.ny[i] * lateral,
      };
    }

    /** Is this world point on the asphalt? */
    isOnTrack(x, y, hint) {
      return Math.abs(this.project(x, y, hint).lateral) <= this.halfWidth;
    }

    /**
     * Sphere-traced ray march against the walls.
     * Because the distance to the wall is ~ (wallHalf - |lateral|), we can take
     * big confident steps and converge in a handful of iterations.
     * @returns distance to the wall along the ray, capped at maxDist.
     */
    rayToWall(ox, oy, dx, dy, maxDist) {
      let t = 0;
      for (let iter = 0; iter < 24; iter++) {
        const x = ox + dx * t, y = oy + dy * t;
        const p = this.project(x, y);
        const clearance = this.wallHalf - Math.abs(p.lateral);
        if (clearance <= 1.5) return t;
        t += Math.max(4, clearance * 0.75);
        if (t >= maxDist) return maxDist;
      }
      return Math.min(t, maxDist);
    }

    /** Starting grid slot `i` (0 = pole), returns {x, y, heading, s, index}. */
    gridSlot(i) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const back = 55 + row * 46;                       // px behind the line
      const lat = (col === 0 ? -1 : 1) * this.halfWidth * 0.33;
      const idx = ((this.n - Math.round(back / 5)) % this.n + this.n) % this.n;
      const p = this.pointAt(idx, lat);
      return {
        x: p.x, y: p.y,
        heading: Math.atan2(this.ty[idx], this.tx[idx]),
        index: idx,
        s: this.sArr[idx],
      };
    }
  }

  /* ------------------------------------------------------------------------
     Public API — tracks are built lazily and cached (the lookup grid costs a
     few milliseconds to build).
     ------------------------------------------------------------------------ */
  const cache = new Map();

  GR.tracks = {
    WORLD_W, WORLD_H,
    list: TRACK_DEFS.map((d) => ({
      id: d.id, name: d.name, emoji: d.emoji, difficulty: d.difficulty, blurb: d.blurb,
    })),
    get(id) {
      if (!cache.has(id)) {
        const def = TRACK_DEFS.find((d) => d.id === id) || TRACK_DEFS[0];
        cache.set(id, new Track(def));
      }
      return cache.get(id);
    },
    Track,
  };
})(window.GR);
