/* ==========================================================================
   genes.js — the eight tunable "genes", their classroom-facing descriptions,
   and the translation from 0-100 slider values into concrete physics / AI
   numbers.

   Design rule: every gene must be a genuine TRADE-OFF. There is no setting
   where 100 (or 0) is simply better. Each entry documents both directions so
   students can be told *why* their change helped or hurt.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;

  /** Ordered list — the slider UI is generated straight from this. */
  const GENES = [
    {
      key: 'maxSpeed',
      label: 'Maximum Speed',
      emoji: '🚀',
      short: 'How fast the car can go flat out.',
      high: 'Huge speed on straights — but heavier and harder to slow down.',
      low: 'Slow on straights, yet very easy to keep under control.',
      color: '#ff4d6d',
    },
    {
      key: 'acceleration',
      label: 'Acceleration',
      emoji: '⚡',
      short: 'How quickly it reaches top speed.',
      high: 'Rockets out of corners, but spins its wheels when steering hard.',
      low: 'Gentle and stable, but loses time after every slow corner.',
      color: '#ffd166',
    },
    {
      key: 'braking',
      label: 'Braking Aggressiveness',
      emoji: '🛑',
      short: 'How early it starts braking for a corner.',
      high: 'Brakes very early — super safe, but throws away lap time.',
      low: 'Brakes at the last moment — fast when it works, off-track when it doesn\'t.',
      color: '#4cc9f0',
    },
    {
      key: 'turning',
      label: 'Turning Aggressiveness',
      emoji: '🎯',
      short: 'How sharply it turns the steering wheel.',
      high: 'Snappy and precise, but wobbles and scrubs off speed.',
      low: 'Smooth and calm, but runs wide and misses tight corners.',
      color: '#06d6a0',
    },
    {
      key: 'anticipation',
      label: 'Corner Anticipation',
      emoji: '🔭',
      short: 'How far ahead the AI looks.',
      high: 'Plans a long way ahead — but slows for corners that are still far away.',
      low: 'Reacts to what is right in front — often too late for a tight turn.',
      color: '#b388ff',
    },
    {
      key: 'overtaking',
      label: 'Overtaking Aggressiveness',
      emoji: '⚔️',
      short: 'How willing it is to pass rivals.',
      high: 'Dives into every gap — and bangs wheels a lot.',
      low: 'Waits patiently behind slower cars and loses places.',
      color: '#ff9f1c',
    },
    {
      key: 'safety',
      label: 'Safety Margin',
      emoji: '🛡️',
      short: 'How much space it keeps from the walls.',
      high: 'Glued to the middle of the road: safe, but the long way round.',
      low: 'Uses every centimetre of track for a perfect line — and kisses walls.',
      color: '#3a86ff',
    },
    {
      key: 'recovery',
      label: 'Recovery Speed',
      emoji: '🔧',
      short: 'How hard it fights back after a mistake.',
      high: 'Snaps back onto the track fast — and sometimes slides straight off again.',
      low: 'Calm recovery, but spends a long time crawling through the grass.',
      color: '#f15bb5',
    },
  ];

  const KEYS = GENES.map((g) => g.key);

  /** A balanced, deliberately mediocre starting driver. */
  function defaultGenes() {
    return {
      maxSpeed: 50, acceleration: 50, braking: 50, turning: 50,
      anticipation: 50, overtaking: 50, safety: 50, recovery: 50,
    };
  }

  /** Random but plausible genes (used by the Randomize button). */
  function randomGenes(rng) {
    const r = rng || new U.Rng(Math.floor(Math.random() * 1e9));
    const g = {};
    for (const k of KEYS) g[k] = Math.round(U.clamp(r.range(15, 90), 0, 100));
    return g;
  }

  /** Force any object into a valid, clamped, complete gene set. */
  function sanitize(obj) {
    const g = defaultGenes();
    if (obj && typeof obj === 'object') {
      for (const k of KEYS) {
        const v = Number(obj[k]);
        if (isFinite(v)) g[k] = U.clamp(Math.round(v), 0, 100);
      }
    }
    return g;
  }

  /* ------------------------------------------------------------------------
     Gene -> physics translation.

     All values are in world units: pixels and seconds. A car is ~34 px long,
     so 300 px/s reads as a believable racing speed on a 3000 px lap.
     ------------------------------------------------------------------------ */
  function toParams(genes) {
    const g = {};
    for (const k of KEYS) g[k] = U.clamp01(genes[k] / 100);

    // --- Straight-line performance -------------------------------------
    const topSpeed = 165 + 215 * g.maxSpeed;             // 165 .. 380 px/s
    const accel = 130 + 430 * g.acceleration;            // 130 .. 560 px/s^2

    // Grip is the currency every gene spends. Chasing raw speed or violent
    // acceleration costs grip, which is what makes those genes a trade-off.
    // Tuned so a 120 px radius corner needs roughly half of maximum speed.
    const grip = 285 * (1 - 0.20 * g.maxSpeed) * (1 - 0.12 * g.acceleration);

    // --- Steering -------------------------------------------------------
    // turnFactor is the share of the friction budget the driver spends on
    // cornering. Below 1 it corners lazily and keeps grip in reserve for the
    // throttle and the brakes; above 1 it corners harder than the tyres really
    // like — quick, but it scrubs speed off and leaves nothing for accelerating.
    const turnFactor = 0.66 + 0.39 * g.turning;          // 0.66 .. 1.05
    // steerResponse multiplies the steering the pure-pursuit controller asks
    // for: below 1 the car turns in lazily and runs wide, above 1 it
    // over-rotates and saws at the wheel.
    const steerResponse = 0.72 + 0.56 * g.turning;       // 0.72 .. 1.28
    const steerRate = 3.2 + 6.0 * g.turning;             // how fast the wheel moves
    const steerDamp = 0.50 - 0.30 * g.turning;           // derivative term (calms wobble)
    const scrub = 0.12 + 0.33 * g.turning;               // speed lost at the cornering limit

    // --- Braking --------------------------------------------------------
    // Stopping power barely changes (it is limited by grip). What the gene
    // really controls is *when* the AI decides to brake: a low value makes the
    // planner over-confident, a high value makes it timid.
    const brakePower = 300 + 260 * g.braking;
    const planTrust = 1.7 - 1.2 * g.braking;             // 1.7 (late) .. 0.5 (early)
    const cornerConfidence = 1.00 - 0.18 * g.braking;    // optimism about corner speed
    const gripPlan = grip * turnFactor * cornerConfidence;

    // --- Planning horizon ----------------------------------------------
    // Pure-pursuit style: the aim point stretches out with speed as well.
    const scanDist = 70 + 430 * g.anticipation;          // curvature look-ahead
    const aimBase = 24 + 46 * g.anticipation;
    const aimSpeed = 0.10 + 0.26 * g.anticipation;

    // --- Racing line ----------------------------------------------------
    // Safety margin squeezes the usable width toward the centre line.
    const usableFrac = 0.92 - 0.84 * g.safety;           // fraction of half-width it will use
    const wallFear = 0.15 + 1.4 * g.safety;              // strength of wall-avoidance steering

    // --- Duelling -------------------------------------------------------
    const passUrge = g.overtaking;                       // 0..1 weight for gap seeking
    const followGap = 105 - 60 * g.overtaking;           // px it wants to keep behind a rival
    const liftOff = 0.85 - 0.75 * g.overtaking;          // how much throttle it gives up when blocked

    // --- Mistakes -------------------------------------------------------
    const recoverSteer = 0.9 + 3.4 * g.recovery;
    const recoverThrottle = 0.28 + 0.62 * g.recovery;
    const stunTime = 1.15 - 0.85 * g.recovery;           // seconds of "shaken" after a hit

    return {
      topSpeed, accel, grip, gripPlan, turnFactor,
      brakePower, planTrust, cornerConfidence,
      steerResponse, steerRate, steerDamp, scrub,
      scanDist, aimBase, aimSpeed,
      usableFrac, wallFear, passUrge, followGap, liftOff,
      recoverSteer, recoverThrottle, stunTime,
      raw: g,
    };
  }

  /**
   * A rough "style" label so students get instant feedback about the character
   * of their driver instead of just eight numbers.
   */
  function styleLabel(genes) {
    const g = genes;
    const risk = (g.maxSpeed + g.overtaking + (100 - g.braking) + (100 - g.safety)) / 4;
    const smooth = (g.anticipation + (100 - g.turning) + g.safety) / 3;
    if (risk > 72) return { name: 'Daredevil', emoji: '🔥' };
    if (risk < 30) return { name: 'Cruiser', emoji: '🐢' };
    if (smooth > 68) return { name: 'Smooth Operator', emoji: '🎿' };
    if (g.turning > 72 && g.anticipation < 40) return { name: 'Twitchy', emoji: '⚡' };
    if (g.overtaking > 70) return { name: 'Brawler', emoji: '🥊' };
    if (g.safety > 70) return { name: 'Careful Driver', emoji: '🛡️' };
    return { name: 'All-Rounder', emoji: '⚖️' };
  }

  GR.genes = { GENES, KEYS, defaultGenes, randomGenes, sanitize, toParams, styleLabel };
})(window.GR);
