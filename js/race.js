/* ==========================================================================
   race.js — the simulation manager.

   Owns the field of cars, the fixed-timestep clock and the race states
   (countdown -> running -> finished). Because the whole simulation advances in
   fixed 1/60 s steps, the "speed" buttons (1x / 2x / 4x) simply run more steps
   per frame: the result of a race is identical at every playback speed.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;

  const FIXED_DT = 1 / 60;
  const MAX_STEPS_PER_FRAME = 12;     // don't freeze the tab if we fall behind

  class Race {
    /**
     * @param {object} opts
     *   track     Track instance
     *   drivers   [{name, genes, color}]
     *   duration  race length in seconds
     *   seed      number|string — fixed for tournaments, free in practice
     *   countdown seconds of lights-out before the clock starts
     */
    constructor(opts) {
      this.track = opts.track;
      this.duration = opts.duration || 90;
      this.seed = opts.seed;
      this.rng = new U.Rng(opts.seed);
      this.countdownLen = opts.countdown === undefined ? 3 : opts.countdown;
      this.collisionCars = opts.collisionCars !== false;

      this.cars = opts.drivers.map((d, i) => new GR.car.Car(d, i));
      this.cars.forEach((c) => c.reset(this.track, this.rng));

      this.time = 0;
      this.countdown = this.countdownLen;
      this.phase = this.countdownLen > 0 ? 'countdown' : 'running';
      this.accumulator = 0;
      this.finishOrder = null;
      this.world = { track: this.track, cars: this.cars, rng: this.rng, time: 0, collisionCars: this.collisionCars };
    }

    /** Advance the simulation by `elapsed` seconds of *race* time. */
    update(elapsed) {
      if (this.phase === 'finished') return;
      this.accumulator += elapsed;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.accumulator -= FIXED_DT;
        this._tick(FIXED_DT);
        steps++;
        if (this.phase === 'finished') break;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    _tick(dt) {
      if (this.phase === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) { this.countdown = 0; this.phase = 'running'; }
        return;
      }

      this.time += dt;
      this.world.time = this.time;
      this.world.collisionCars = this.collisionCars;

      for (const car of this.cars) car.step(this.world, dt);
      if (this.collisionCars !== false) GR.car.resolveCarContacts(this.cars);

      if (this.time >= this.duration) this._finish();
    }

    _finish() {
      this.phase = 'finished';
      this.time = this.duration;
      for (const car of this.cars) car.finished = true;
      this.finishOrder = this.standings();
    }

    /** Cars sorted by track progress (leader first). */
    standings() {
      const list = this.cars.slice().sort((a, b) => b.progress - a.progress);
      list.forEach((c, i) => { c.position = i + 1; });
      return list;
    }

    get timeLeft() { return Math.max(0, this.duration - this.time); }
    get leader() { return this.standings()[0]; }
  }

  GR.race = { Race, FIXED_DT };
})(window.GR);
