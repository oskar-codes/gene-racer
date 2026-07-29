/* ==========================================================================
   car.js — the autonomous driver.

   Two clearly separated halves:

     1. THINK  — sense the world with virtual rays, run a small finite state
                 machine, and produce two numbers: steering and throttle.
                 Absolutely no machine learning: waypoint following +
                 steering behaviours + weighted decisions.

     2. MOVE   — a simple but honest vehicle model (bicycle steering + a
                 friction "grip circle"), surface penalties and collisions.

   The whole thing is deterministic: same genes + same seed + same fixed
   timestep => byte-identical race. That is what makes the tournament fair.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;

  const CAR_LEN = 30;
  const CAR_W = 16;
  const CAR_R = 11;               // collision radius
  const MAX_YAW = 3.4;            // rad/s — the physical steering lock

  /** The directions of the virtual distance sensors, in degrees. */
  const RAY_ANGLES = [-70, -40, -18, 0, 18, 40, 70].map((d) => (d * Math.PI) / 180);

  /** Driver states — surfaced in the UI so students can read the AI's mind. */
  const STATE = {
    PUSH: { id: 'PUSH', label: 'Full attack', color: '#06d6a0', emoji: '🏎️' },
    BRAKE: { id: 'BRAKE', label: 'Braking for corner', color: '#ff4d6d', emoji: '🛑' },
    APEX: { id: 'APEX', label: 'Turning in', color: '#ffd166', emoji: '🎯' },
    PASS: { id: 'PASS', label: 'Overtaking', color: '#ff9f1c', emoji: '⚔️' },
    HOLD: { id: 'HOLD', label: 'Stuck behind', color: '#4cc9f0', emoji: '⏳' },
    OFF: { id: 'OFF', label: 'Off track!', color: '#b388ff', emoji: '🌱' },
    SHAKEN: { id: 'SHAKEN', label: 'Recovering', color: '#f15bb5', emoji: '💫' },
    UNSTICK: { id: 'UNSTICK', label: 'Reversing', color: '#8d99ae', emoji: '↩️' },
  };

  class Car {
    /**
     * @param {object} driver {name, genes, color}
     * @param {number} slot   starting-grid position (0 = pole)
     */
    constructor(driver, slot) {
      this.name = driver.name || 'Driver';
      this.genes = GR.genes.sanitize(driver.genes);
      this.p = GR.genes.toParams(this.genes);
      this.color = driver.color || U.CAR_COLORS[slot % U.CAR_COLORS.length];
      this.slot = slot;
      this.number = slot + 1;
    }

    /* -------------------------------------------------------------- setup */
    reset(track, rng) {
      const g = track.gridSlot(this.slot);
      this.track = track;
      this.rng = rng;

      // Kinematic state
      this.x = g.x; this.y = g.y;
      this.heading = g.heading;
      this.speed = 0;
      this.yawRate = 0;
      this.steer = 0;
      this.throttle = 0;
      this.brake = 0;
      this.slip = 0;                       // 0..1, how much grip is exceeded

      // Road-space state
      this.hint = g.index;
      this.proj = track.project(this.x, this.y, this.hint);
      this.prevS = this.proj.s;
      this.laps = -1;                      // becomes 0 on the start-line crossing
      this.progress = -track.length + this.proj.s;
      this.finished = false;

      // Timing
      this.lapStart = 0;
      this.bestLap = Infinity;
      this.lastLap = 0;

      // Behaviour
      this.state = STATE.PUSH;
      this.stun = 0;
      this.stuckTime = 0;
      this.unstickTimer = 0;
      this._senseTick = this.slot % 2;
      this.targetSpeed = 0;
      this.aimX = this.x; this.aimY = this.y;
      this.desiredLat = 0;
      this.brakeZone = 0;                  // px of track ahead flagged for braking
      this.rays = RAY_ANGLES.map((a) => ({ ang: a, dist: 0, range: 1, type: 'wall' }));

      // Telemetry
      this.stats = {
        distance: 0, speedSum: 0, ticks: 0, topSpeed: 0,
        collisions: 0, offTrackTime: 0, brakeEvents: 0, steerWork: 0,
        timeAtLimit: 0, rescues: 0,
      };
      this.trace = [];                     // speed samples for the graph
      this.recording = [];                 // ghost/replay frames
      this._wasBraking = false;
      this._prevSteer = 0;
      this._sampleAcc = 0;
    }

    /* ================================================================ SENSE */
    _sense(world) {
      const track = this.track;
      const range = 70 + this.speed * 0.75;
      const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
      const nx = this.x + cos * (CAR_LEN * 0.4);
      const ny = this.y + sin * (CAR_LEN * 0.4);

      let minLeft = range, minRight = range, minFront = range;
      let carAhead = null, carAheadDist = Infinity;

      // Shortlist the opponents that can possibly be hit by any ray, once,
      // instead of re-testing the whole field for every single ray.
      const near = [];
      const reach = (range + 30) * (range + 30);
      for (const other of world.cars) {
        if (other !== this && !other.finished && U.dist2(nx, ny, other.x, other.y) <= reach) near.push(other);
      }

      for (let i = 0; i < this.rays.length; i++) {
        const ray = this.rays[i];
        const a = this.heading + ray.ang;
        const dx = Math.cos(a), dy = Math.sin(a);

        let d = track.rayToWall(nx, ny, dx, dy, range);
        let type = 'wall';

        // Static barriers
        for (const b of track.barriers) {
          const t = U.rayCircle(nx, ny, dx, dy, b.x, b.y, b.r + CAR_R * 0.6);
          if (t < d) { d = t; type = 'barrier'; }
        }
        // Opponent cars
        for (const other of near) {
          const t = U.rayCircle(nx, ny, dx, dy, other.x, other.y, CAR_R + 4);
          if (t < d) {
            d = t; type = 'car';
            if (Math.abs(ray.ang) < 0.5 && t < carAheadDist) { carAheadDist = t; carAhead = other; }
          }
        }

        ray.dist = d;
        ray.range = range;
        ray.type = type;

        if (ray.ang < -0.1) minLeft = Math.min(minLeft, d);
        else if (ray.ang > 0.1) minRight = Math.min(minRight, d);
        else minFront = Math.min(minFront, d);
      }

      this.sensors = { range, left: minLeft, right: minRight, front: minFront, carAhead, carAheadDist };
    }

    /* ================================================================ THINK */
    _think(world, dt) {
      const track = this.track;
      const p = this.p;
      const proj = this.proj;
      const onGrass = Math.abs(proj.lateral) > track.halfWidth;
      const s = this.sensors;

      /* --- 1. How fast may I be, given the corners ahead? --------------- */
      // "Usable" is how far off the centre line the driver is willing to place
      // the car, measured to the *edge of the bodywork* — aiming the centre of
      // the car at the white line would put half of it in the grass.
      const usable = Math.max(0, track.halfWidth - CAR_R - 3) * p.usableFrac;
      let target = p.topSpeed;
      let brakePoint = p.scanDist;
      const stepPx = 14;
      for (let d = 0; d <= p.scanDist; d += stepPx) {
        const i = (proj.index + Math.round(d / 5)) % track.n;
        const k = Math.abs(track.k[i]);
        if (k < 1e-5) continue;
        // Apexing widens the effective radius — a car that uses the whole road
        // can carry more speed through the same corner.
        const radius = 1 / k + usable * 0.35;
        const vCorner = Math.sqrt(p.gripPlan * radius);
        // How fast could I be *here* and still slow down in time?
        const allowed = Math.sqrt(vCorner * vCorner + 2 * p.brakePower * p.planTrust * d);
        if (allowed < target) { target = allowed; brakePoint = d; }
      }
      target = Math.min(target, p.topSpeed);
      if (onGrass) target = Math.min(target, p.topSpeed * 0.45);

      /* --- 2. Where on the road do I want to be? (racing line) ---------- */
      // Pure pursuit: aim at a point some distance ahead. The look-ahead also
      // has to stay short compared with the corner radius, otherwise the aim
      // point sits across the corner and the car simply cuts the grass — so it
      // is capped at roughly half a radian of arc.
      let aimAhead = p.aimBase + Math.max(0, this.speed) * p.aimSpeed;
      const kLocal = Math.abs(this._avgCurvature(proj.index, 60));
      if (kLocal > 1e-4) aimAhead = Math.min(aimAhead, 0.5 / kLocal);
      aimAhead = Math.max(22, aimAhead);
      this.aimAhead = aimAhead;
      const kNow = this._avgCurvature(proj.index, aimAhead * 0.6);
      const kSoon = this._avgCurvature((proj.index + Math.round(aimAhead * 1.6 / 5)) % track.n, aimAhead);
      const inside = U.sign(kNow) * Math.min(1, Math.abs(kNow) * 170);
      const outside = U.sign(kSoon) * Math.min(1, Math.abs(kSoon) * 170);
      let desiredLat = usable * U.clamp(inside * 0.95 - outside * 0.6, -1, 1);

      /* --- 3. Traffic: pass, or tuck in behind? ------------------------- */
      let blocked = null, blockDist = Infinity;
      for (const other of world.cars) {
        if (other === this || other.finished) continue;
        const rel = this._relative(other);
        if (rel.ahead > 0 && rel.ahead < p.followGap * 2.2 && Math.abs(rel.side - proj.lateral) < CAR_W * 2.4) {
          if (rel.ahead < blockDist) { blockDist = rel.ahead; blocked = other; }
        }
      }
      let passing = false;
      if (blocked) {
        // Which side has more road? Prefer the roomier one, weighted by urge.
        const theirLat = blocked.proj.lateral;
        const roomLeft = usable + theirLat;      // space on the negative-lateral side
        const roomRight = usable - theirLat;
        const side = roomRight > roomLeft ? 1 : -1;
        const urge = p.passUrge * U.clamp01(1.4 - blockDist / (p.followGap * 2.2));
        if (urge > 0.18) {
          desiredLat = U.lerp(desiredLat, theirLat + side * (CAR_W * 2.3), Math.min(0.95, urge));
          passing = true;
        }
        // Not committed enough to pass? Then match speed and wait.
        if (!passing || blockDist < p.followGap * 0.75) {
          const cap = blocked.speed + 12 + 90 * p.passUrge - p.liftOff * 60;
          target = Math.min(target, Math.max(40, cap));
        }
      }

      /* --- 4. Steering: aim at a waypoint, then dodge what's close ------ */
      desiredLat = U.clamp(desiredLat, -usable, usable);

      // Static obstacles are handled last, so that a timid driver's narrow
      // "usable" corridor can still be overridden — going round the barrier is
      // never optional. Rays alone cannot solve this either: an obstacle
      // straight ahead reads the same distance left and right, the avoidance
      // terms cancel, and the car drives politely into it.
      const room = Math.max(0, track.halfWidth - CAR_R - 2);
      for (const b of track.barriers) {
        let ds = b.s - proj.s;
        if (ds < -track.length / 2) ds += track.length;
        else if (ds > track.length / 2) ds -= track.length;
        if (ds < -CAR_LEN || ds > aimAhead + 110) continue;
        const clear = b.r + CAR_R + 8;
        if (Math.abs(desiredLat - b.lat) < clear) {
          const side = b.lat > 0 ? -1 : 1;              // duck to the roomier side
          desiredLat = U.clamp(b.lat + side * clear, -room, room);
        }
      }
      this.desiredLat = desiredLat;

      const aimIdx = (proj.index + Math.round(aimAhead / 5)) % track.n;
      const aim = track.pointAt(aimIdx, desiredLat);
      this.aimX = aim.x; this.aimY = aim.y;

      const aimDx = aim.x - this.x, aimDy = aim.y - this.y;
      const aimDist = Math.max(18, Math.hypot(aimDx, aimDy));
      const angErr = U.wrapAngle(Math.atan2(aimDy, aimDx) - this.heading);

      // Pure pursuit: the arc through the aim point has curvature
      // 2*sin(error)/distance. Turning that into the fraction of the car's
      // cornering ability we need gives a controller that is stable at every
      // speed instead of one gain that is wrong at half of them.
      const vRef = Math.max(Math.abs(this.speed), 40);
      const maxYawNow = Math.min(3.4, (p.grip * p.turnFactor) / vRef);
      const yawNeeded = (2 * Math.sin(angErr) / aimDist) * vRef;

      // Wall-avoidance steering behaviour, scaled by the safety gene.
      const lc = 1 - U.clamp01(s.left / s.range);
      const rc = 1 - U.clamp01(s.right / s.range);
      const avoid = (lc - rc) * p.wallFear * 0.55;

      let cmd = (yawNeeded / maxYawNow) * p.steerResponse + avoid - p.steerDamp * this.yawRate * 0.2;

      /* --- 5. Finite state machine ------------------------------------- */
      let throttle = 0, brake = 0;
      let state;

      if (this.unstickTimer > 0) {
        // Reverse out of trouble. Backing up flips the direction the nose
        // swings, so the steering command is inverted here.
        state = STATE.UNSTICK;
        this.unstickTimer -= dt;
        throttle = -0.6;
        cmd = -U.clamp(2.2 * angErr, -1, 1);
      } else if (onGrass) {
        state = STATE.OFF;
        // Head back to the centre line. The aim point is closer than on the
        // road (a lost car wants to rejoin, not to set a good line), and the
        // urgency comes straight from the recovery gene.
        const back = track.pointAt(proj.index + Math.round((34 + Math.max(0, this.speed) * 0.22) / 5), 0);
        const backErr = U.wrapAngle(Math.atan2(back.y - this.y, back.x - this.x) - this.heading);
        cmd = p.recoverSteer * backErr;
        throttle = p.recoverThrottle;
        if (this.speed > target) { brake = 0.6; throttle = 0; }
      } else if (this.stun > 0) {
        state = STATE.SHAKEN;
        throttle = 0.35;
      } else if (this.speed > target * 1.03) {
        state = STATE.BRAKE;
        brake = U.clamp01((this.speed - target) / (18 + this.speed * 0.25));
      } else {
        throttle = U.clamp01((target - this.speed) / 22);
        if (passing) state = STATE.PASS;
        else if (blocked) state = STATE.HOLD;
        else if (Math.abs(kNow) > 0.004) state = STATE.APEX;
        else state = STATE.PUSH;
      }

      /* --- 6. Commit: rate-limit the steering wheel --------------------- */
      cmd = U.clamp(cmd, -1, 1);
      this.steer = U.approach(this.steer, cmd, p.steerRate * dt);
      this.throttle = throttle;
      this.brake = brake;
      this.targetSpeed = target;
      this.brakeZone = brakePoint;
      this.state = state;
      this.onGrass = onGrass;

      // Telemetry: braking events + steering smoothness.
      if (brake > 0.35 && !this._wasBraking) this.stats.brakeEvents++;
      this._wasBraking = brake > 0.35;
      this.stats.steerWork += Math.abs(this.steer - this._prevSteer);
      this._prevSteer = this.steer;
    }

    /** Mean signed curvature over the next `dist` px. */
    _avgCurvature(idx, dist) {
      const track = this.track;
      const n = Math.max(1, Math.round(dist / 5));
      let sum = 0;
      for (let i = 0; i < n; i++) sum += track.k[(idx + i) % track.n];
      return sum / n;
    }

    /** Position of `other` relative to me, in road space. */
    _relative(other) {
      const track = this.track;
      let ds = other.proj.s - this.proj.s;
      if (ds > track.length / 2) ds -= track.length;
      if (ds < -track.length / 2) ds += track.length;
      return { ahead: ds, side: other.proj.lateral };
    }

    /* ================================================================= MOVE */
    _move(world, dt) {
      const track = this.track;
      const p = this.p;

      const grassGrip = this.onGrass ? 0.55 : 1;
      const grip = p.grip * grassGrip * (this.stun > 0 ? 0.75 : 1);
      const effTop = p.topSpeed * (this.onGrass ? 0.42 : 1) * (this.stun > 0 ? 0.6 : 1);

      // --- longitudinal demand -----------------------------------------
      const accelAvail = p.accel * U.clamp01(1 - this.speed / effTop);
      let aLong = this.throttle * accelAvail - this.brake * p.brakePower;
      if (this.throttle < 0) aLong = this.throttle * p.accel * 0.5;   // reverse gear

      // Rolling resistance. On grass the penalty is proportional to speed
      // rather than a flat deceleration: a fast car is punished hard, while a
      // gentle car can still crawl back to the road instead of being trapped
      // there for the rest of the race.
      const rolling = this.onGrass ? 25 : 18;
      if (this.speed > 1) aLong -= rolling;
      else if (this.speed < -1) aLong += rolling;
      if (this.onGrass) aLong -= this.speed * 1.8;

      // --- lateral demand ------------------------------------------------
      // `steer` is a *fraction of the cornering ability the driver is willing
      // to use*, not a wheel angle. The tightest turn is therefore limited
      // either by grip (at speed) or by the steering lock (when crawling).
      // A driver fighting to get back on the road is not choosing a smooth
      // line any more, so the turning gene stops holding it back there.
      const fighting = this.onGrass || this.unstickTimer > 0;
      const latCapacity = grip * (fighting ? Math.max(1, p.turnFactor) : p.turnFactor);
      const maxYaw = Math.min(MAX_YAW, latCapacity / Math.max(Math.abs(this.speed), 45));
      // Reversing swings the nose the other way — same wheel, opposite spin.
      let yawWanted = this.steer * maxYaw * (this.speed < 0 ? -1 : 1);
      let aLat = yawWanted * this.speed;

      // --- friction circle: the car cannot do everything at once ---------
      // The budget has a little headroom above nominal grip, so a driver with a
      // very high turning gene really can corner harder — but then there is
      // nothing left for the throttle or the brakes.
      const budget = grip * 1.10;
      const demand = Math.hypot(aLat, aLong);
      this.slip = 0;
      if (demand > budget && demand > 1) {
        const scale = budget / demand;
        aLat *= scale;
        aLong *= scale;
        yawWanted *= scale;
        this.slip = U.clamp01(demand / budget - 1);
        this.stats.timeAtLimit += dt;
      }

      // --- integrate -----------------------------------------------------
      this.speed += aLong * dt;
      if (this.speed > effTop) this.speed = U.approach(this.speed, effTop, 400 * dt);
      if (this.speed < -70) this.speed = -70;
      if (Math.abs(this.speed) < 0.6 && this.throttle === 0) this.speed = 0;

      // Cornering scrub: leaning on the tyres costs speed, and it bites hard
      // near the limit (cubic). This is the price of "turning aggressiveness".
      const load = Math.abs(aLat) / grip;
      this.speed -= this.speed * load * load * load * p.scrub * dt;

      this.yawRate = yawWanted;
      this.heading += this.yawRate * dt;
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.y += Math.sin(this.heading) * this.speed * dt;

      if (this.stun > 0) this.stun -= dt;

      // --- collisions ----------------------------------------------------
      this._collideWalls();
      this._collideBarriers();

      // --- stuck detection -----------------------------------------------
      // Three escalating stages, so no car can ever be lost for a whole race:
      //   < 1.0 s crawling  → carry on, it is probably just a slow corner
      //   > 1.0 s           → shift into reverse and try to back out
      //   > 3.0 s           → marshals lift it back onto the centre line
      if (Math.abs(this.speed) < 30) this.stuckTime += dt;
      else this.stuckTime = 0;

      if (this.stuckTime > 3.0) this._rescue();
      else if (this.stuckTime > 1.0 && this.unstickTimer <= 0) this.unstickTimer = 0.6;
    }

    /** Last resort: put the car back on the centre line, facing forward. */
    _rescue() {
      const track = this.track;
      const i = this.proj.index;
      const p = track.pointAt(i, 0);
      this.x = p.x; this.y = p.y;
      this.heading = Math.atan2(track.ty[i], track.tx[i]);
      this.speed = 45;
      this.steer = 0;
      this.yawRate = 0;
      this.stuckTime = 0;
      this.unstickTimer = 0;
      this.stun = Math.max(this.stun, 0.7);
      this.stats.rescues++;
    }

    /*
       Contact rule used everywhere below: the heavy penalty fires once, on the
       tick the contact *starts*. While the car keeps scraping along, it only
       loses a little speed each tick. Re-applying the full penalty every tick
       (the obvious way to write this) multiplies out to a dead stop within a
       handful of frames and glues the car to the scenery for the whole race.
    */
    _collideWalls() {
      const track = this.track;
      const proj = track.project(this.x, this.y, this.hint);
      const over = Math.abs(proj.lateral) - track.wallHalf + CAR_R * 0.55;
      if (over > 0) {
        const sgn = U.sign(proj.lateral) || 1;
        const i = proj.index;
        // Push back inside the wall...
        this.x -= track.nx[i] * sgn * (over + 0.5);
        this.y -= track.ny[i] * sgn * (over + 0.5);
        // ...bleed off speed and nudge the nose back toward the road.
        if (this.hitFlash > 0) {
          this.speed *= 0.97;                                // still scraping
          this.heading = U.lerp(this.heading, proj.ang - sgn * 0.12, 0.10);
        } else {
          this.speed *= 0.55;                                // fresh impact
          this.heading = U.lerp(this.heading, proj.ang - sgn * 0.25, 0.35);
          this.stun = Math.max(this.stun, this.p.stunTime * 0.55);
          this.stats.collisions++;
        }
        this.hitFlash = 0.35;
      }
    }

    _collideBarriers() {
      for (const b of this.track.barriers) {
        const d = U.dist(this.x, this.y, b.x, b.y);
        const min = b.r + CAR_R;
        if (d < min && d > 0.001) {
          const nx = (this.x - b.x) / d, ny = (this.y - b.y) / d;
          this.x = b.x + nx * min;
          this.y = b.y + ny * min;
          if (this.hitFlash > 0) {
            this.speed *= 0.96;
          } else {
            this.speed *= 0.45;
            this.stun = Math.max(this.stun, this.p.stunTime * 0.8);
            this.stats.collisions++;
          }
          this.hitFlash = 0.35;
        }
      }
    }

    /* ============================================================ BOOKKEEP */
    _bookkeep(world, dt) {
      const track = this.track;
      const proj = track.project(this.x, this.y, this.hint);
      this.hint = proj.index;
      this.proj = proj;

      // Lap counting: detect the wrap of arc-length past the start line.
      let ds = proj.s - this.prevS;
      if (ds < -track.length / 2) { ds += track.length; this._crossLine(world); }
      else if (ds > track.length / 2) { ds -= track.length; this.laps--; }
      this.prevS = proj.s;
      this.progress = this.laps * track.length + proj.s;

      // Telemetry
      const st = this.stats;
      st.distance += Math.abs(this.speed) * dt;
      st.speedSum += this.speed;
      st.ticks++;
      if (this.speed > st.topSpeed) st.topSpeed = this.speed;
      if (this.onGrass) st.offTrackTime += dt;
      if (this.hitFlash > 0) this.hitFlash -= dt;

      // Ghost / replay recording + speed trace (sub-sampled to stay light).
      this._sampleAcc += dt;
      if (this._sampleAcc >= 1 / 30) {
        this._sampleAcc = 0;
        this.recording.push(this.x, this.y, this.heading);
        this.trace.push(this.speed);
      }
    }

    _crossLine(world) {
      this.laps++;
      if (this.laps === 0) {
        this.lapStart = world.time;
      } else {
        this.lastLap = world.time - this.lapStart;
        if (this.lastLap < this.bestLap) this.bestLap = this.lastLap;
        this.lapStart = world.time;
      }
    }

    /* ------------------------------------------------------------ public */
    step(world, dt) {
      if (this.finished) { this.speed *= 0.94; return; }
      // Sensors run at 30 Hz rather than 60 — plenty for driving decisions and
      // it halves the cost of the most expensive part of the simulation.
      this._senseTick ^= 1;
      if (this._senseTick === 0 || !this.sensors) this._sense(world);
      this._think(world, dt);
      this._move(world, dt);
      this._bookkeep(world, dt);
    }

    get avgSpeed() { return this.stats.ticks ? this.stats.speedSum / this.stats.ticks : 0; }
  }

  /**
   * Resolve car-vs-car contact for the whole field. Called once per tick after
   * every car has moved, so the result does not depend on iteration order.
   */
  function resolveCarContacts(cars) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = CAR_R * 2;
        if (d >= min || d < 0.001) continue;
        const nx = dx / d, ny = dy / d;
        const push = (min - d) / 2 + 0.2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        // Contact costs both drivers speed.
        const loss = 0.90;
        a.speed *= loss; b.speed *= loss;
        // Only score a *new* collision — otherwise cars running side by side
        // would rack up 60 "collisions" per second.
        if (!(a.hitFlash > 0)) a.stats.collisions++;
        if (!(b.hitFlash > 0)) b.stats.collisions++;
        a.hitFlash = 0.25; b.hitFlash = 0.25;
        a.stun = Math.max(a.stun, a.p.stunTime * 0.25);
        b.stun = Math.max(b.stun, b.p.stunTime * 0.25);
      }
    }
  }

  GR.car = { Car, resolveCarContacts, STATE, CAR_LEN, CAR_W, CAR_R, RAY_ANGLES };
})(window.GR);
