/* ==========================================================================
   app.js — UI wiring, game loop, practice mode and tournament mode.

   This is the only file that touches the DOM. Everything else (tracks, AI,
   physics, rendering, statistics, storage) is a self-contained module.
   ========================================================================== */
(function (GR) {
  'use strict';
  const U = GR.utils;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const TOURNAMENT_SEED = 'grand-final';

  /* ======================================================== APPLICATION STATE */
  const app = {
    mode: 'practice',
    driver: { name: 'My Team', genes: GR.genes.defaultGenes() },
    trackId: 'oval',
    duration: 90,
    seed: 'practice-1',
    speed: 1,
    paused: false,
    race: null,
    raceMode: null,           // 'practice' | 'tournament'
    overlays: { rays: true, line: true, brake: true, ghost: true },
    lastRun: null,            // stats summary of the previous practice run
    prevRun: null,            // the one before that (for the comparison chart)
    ghost: null,              // {recording:[x,y,h,...], trackId}
    lastTournament: null,
  };

  let renderer, confetti, lastFrame = 0;

  /* ================================================================== BOOT */
  function boot() {
    const s = GR.storage.settings.all();
    app.trackId = s.trackId;
    app.duration = s.duration;
    app.speed = s.speed;
    app.driver.name = s.teamName;
    app.overlays = { rays: s.showRays, line: s.showLine, brake: s.showBrake, ghost: s.showGhost };
    document.documentElement.dataset.theme = s.theme;
    $('#btnTheme').textContent = s.theme === 'dark' ? '☀️' : '🌙';

    renderer = new GR.render.Renderer($('#raceCanvas'));
    confetti = new GR.render.Confetti($('#fxCanvas'));

    buildTrackPicker();
    buildGeneSliders();
    bindControls();
    bindKeyboard();
    renderRoster();

    $('#teamName').value = app.driver.name;
    $('#duration').value = String(app.duration);
    $('#seed').value = app.seed;
    $('#tgRays').checked = app.overlays.rays;
    $('#tgLine').checked = app.overlays.line;
    $('#tgBrake').checked = app.overlays.brake;
    $('#tgGhost').checked = app.overlays.ghost;
    $$('.seg-btn').forEach((b) => b.classList.toggle('is-active', +b.dataset.speed === app.speed));

    syncTrackUi();
    syncGeneUi();
    renderStats();

    const ro = new ResizeObserver(() => { renderer.resize(); confetti.resize(); });
    ro.observe($('.stage-canvas-wrap'));
    renderer.resize();
    confetti.resize();

    showMessage('Press <b>Run Test</b> ▶ to watch your AI driver');
    requestAnimationFrame(frame);
  }

  /* ================================================================== LOOP */
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;

    if (app.race && !app.paused && app.race.phase !== 'finished') {
      app.race.update(dt * app.speed);
      if (app.race.phase === 'finished') onRaceFinished();
    }

    // Skid marks for cars that are sliding.
    if (app.race && app.race.phase === 'running') {
      for (const car of app.race.cars) if (car.slip > 0.12 || car.onGrass) renderer.addSkid(car);
    }

    drawFrame();
    updateHud();
    confetti.update(dt);
    requestAnimationFrame(frame);
  }

  function drawFrame() {
    const track = GR.tracks.get(app.trackId);
    const cars = app.race ? app.race.cars : [];
    const single = app.raceMode === 'practice';
    renderer.draw({
      track,
      cars,
      ghost: single && app.overlays.ghost ? ghostFrame() : null,
      showRays: single && app.overlays.rays,
      showLine: single && app.overlays.line,
      showBrake: single && app.overlays.brake,
      showLabels: !single && cars.length > 0,
    });
  }

  /** Interpolated position of the previous run's ghost car. */
  function ghostFrame() {
    if (!app.ghost || app.ghost.trackId !== app.trackId || !app.race) return null;
    const rec = app.ghost.recording;
    const idx = Math.floor(app.race.time * 30);
    const o = idx * 3;
    if (o + 2 >= rec.length) return null;
    return { x: rec[o], y: rec[o + 1], heading: rec[o + 2] };
  }

  /* ================================================================== HUD */
  function updateHud() {
    const race = app.race;
    const focus = race ? (app.raceMode === 'practice' ? race.cars[0] : race.leader) : null;

    $('#hudLap').textContent = focus ? Math.max(0, focus.laps) : 0;
    $('#hudTime').textContent = race ? U.formatClock(race.timeLeft) : U.formatClock(app.duration);
    const spd = focus ? Math.max(0, Math.round(focus.speed)) : 0;
    $('#hudSpeed').textContent = spd;
    $('#hudSpeedBar').style.width = focus ? U.clamp01(focus.speed / 400) * 100 + '%' : '0%';
    $('#hudBest').textContent = focus && isFinite(focus.bestLap) ? U.formatTime(focus.bestLap) : '—:—';

    // Driver state chip (practice only — it explains what the AI is thinking).
    const chip = $('#hudState');
    if (race && app.raceMode === 'practice' && race.phase === 'running') {
      const st = race.cars[0].state;
      chip.hidden = false;
      chip.querySelector('span').textContent = st.emoji;
      chip.querySelector('em').textContent = st.label;
      chip.style.borderColor = st.color;
      chip.style.background = `color-mix(in srgb, ${st.color} 30%, rgba(16,20,30,.78))`;
    } else {
      chip.hidden = true;
    }

    // Countdown
    const cd = $('#countdown');
    if (race && race.phase === 'countdown') {
      const n = Math.ceil(race.countdown);
      cd.hidden = false;
      const label = n <= 0 ? 'GO!' : String(n);
      if (cd.dataset.value !== label) {
        cd.dataset.value = label;
        cd.innerHTML = `<b class="${n <= 0 ? 'go' : ''}">${label}</b>`;
      }
    } else if (!cd.hidden) {
      if (race && race.phase === 'running' && race.time < 0.6) {
        if (cd.dataset.value !== 'GO!') { cd.dataset.value = 'GO!'; cd.innerHTML = '<b class="go">GO!</b>'; }
      } else {
        cd.hidden = true;
        cd.dataset.value = '';
      }
    }

    if (app.raceMode === 'tournament' && race) renderBoard(race);
  }

  function showMessage(html) {
    const el = $('#stageMessage');
    if (!html) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>${html}</span>`;
  }

  /* ========================================================= TRACK PICKER */
  function buildTrackPicker() {
    const grid = $('#trackGrid');
    grid.innerHTML = '';
    for (const t of GR.tracks.list) {
      const b = document.createElement('button');
      b.className = 'track-btn';
      b.dataset.track = t.id;
      b.innerHTML = `<b>${t.emoji} ${t.name}</b><small>${t.difficulty}</small>`;
      b.addEventListener('click', () => {
        app.trackId = t.id;
        GR.storage.settings.patch({ trackId: t.id });
        syncTrackUi();
        resetRace();
        renderer.clearSkids();
      });
      grid.appendChild(b);
    }
  }

  function syncTrackUi() {
    const info = GR.tracks.list.find((t) => t.id === app.trackId) || GR.tracks.list[0];
    $$('.track-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.track === app.trackId));
    $('#trackBlurb').textContent = info.blurb;
    $('#tourTrack').textContent = info.name;
    $('#tourDuration').textContent = app.duration + ' s';
    $('#tourSeed').textContent = TOURNAMENT_SEED;
  }

  /* ========================================================= GENE SLIDERS */
  function buildGeneSliders() {
    const list = $('#geneList');
    list.innerHTML = '';
    for (const g of GR.genes.GENES) {
      const row = document.createElement('div');
      row.className = 'gene';
      row.style.setProperty('--gene-color', g.color);
      row.innerHTML = `
        <div class="gene-head">
          <span class="gene-emoji">${g.emoji}</span>
          <span class="gene-name">${g.label}</span>
          <span class="gene-val" data-val="${g.key}">50</span>
        </div>
        <input type="range" min="0" max="100" step="1" value="50" data-gene="${g.key}"
               aria-label="${g.label}">
        <p class="gene-desc" data-desc="${g.key}">${g.short}</p>`;
      const input = row.querySelector('input');
      input.addEventListener('input', () => {
        app.driver.genes[g.key] = +input.value;
        syncGeneUi();
      });
      list.appendChild(row);
    }
  }

  function syncGeneUi() {
    for (const g of GR.genes.GENES) {
      const v = app.driver.genes[g.key];
      const input = $(`input[data-gene="${g.key}"]`);
      input.value = v;
      input.style.setProperty('--pct', v + '%');
      $(`[data-val="${g.key}"]`).textContent = v;
      // The description adapts to the current value so students always read the
      // trade-off that applies to *their* setting.
      const desc = $(`[data-desc="${g.key}"]`);
      desc.innerHTML = v >= 66 ? `<b>High:</b> ${g.high}`
        : v <= 33 ? `<b>Low:</b> ${g.low}`
          : g.short;
    }
    const style = GR.genes.styleLabel(app.driver.genes);
    $('#styleBadge').innerHTML = `<span>${style.emoji}</span> ${style.name}`;
  }

  /* ============================================================== CONTROLS */
  function bindControls() {
    // Mode tabs -------------------------------------------------------
    $$('.mode-tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

    // Stage toolbar ---------------------------------------------------
    $('#btnRun').addEventListener('click', onRunButton);
    $('#btnRun2').addEventListener('click', onRunButton);
    $('#btnReset').addEventListener('click', () => { resetRace(); renderer.clearSkids(); });
    $('#btnReplay').addEventListener('click', () => {
      if (app.raceMode === 'tournament') startTournament();
      else startPractice(true);
    });

    $$('.seg-btn').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));

    const tg = (id, key) => $(id).addEventListener('change', (e) => {
      app.overlays[key] = e.target.checked;
      GR.storage.settings.patch({
        showRays: app.overlays.rays, showLine: app.overlays.line,
        showBrake: app.overlays.brake, showGhost: app.overlays.ghost,
      });
    });
    tg('#tgRays', 'rays'); tg('#tgLine', 'line'); tg('#tgBrake', 'brake'); tg('#tgGhost', 'ghost');

    // Practice panel --------------------------------------------------
    $('#teamName').addEventListener('input', (e) => {
      app.driver.name = e.target.value.slice(0, 22);
      GR.storage.settings.patch({ teamName: app.driver.name });
    });
    $('#duration').addEventListener('change', (e) => {
      app.duration = +e.target.value;
      GR.storage.settings.patch({ duration: app.duration });
      syncTrackUi();
      resetRace();
    });
    $('#seed').addEventListener('change', (e) => { app.seed = e.target.value || 'practice-1'; });
    $('#btnSeed').addEventListener('click', () => {
      app.seed = 'seed-' + Math.floor(Math.random() * 9000 + 1000);
      $('#seed').value = app.seed;
      toast('New random seed: ' + app.seed);
    });

    $('#btnResetGenes').addEventListener('click', () => {
      app.driver.genes = GR.genes.defaultGenes();
      syncGeneUi();
      toast('Genes reset to the default driver');
    });
    $('#btnRandom').addEventListener('click', () => {
      app.driver.genes = GR.genes.randomGenes();
      syncGeneUi();
      toast('🎲 Random genes — try running a test!');
    });
    $('#btnSave').addEventListener('click', saveDriverDialog);
    $('#btnLoad').addEventListener('click', loadDriverDialog);
    $('#btnEnter').addEventListener('click', addCurrentToRoster);

    // Tournament panel ------------------------------------------------
    $('#btnStartTournament').addEventListener('click', startTournament);
    $('#btnAddCurrent').addEventListener('click', addCurrentToRoster);
    $('#btnImport').addEventListener('click', importDialog);
    $('#btnExport').addEventListener('click', exportRoster);
    $('#btnDemoField').addEventListener('click', addDemoBots);
    $('#btnClearRoster').addEventListener('click', () => {
      if (!GR.storage.roster.all().length) return;
      confirmDialog('Remove every entry?', 'The tournament entry list will be emptied.', () => {
        GR.storage.roster.clear();
        renderRoster();
        toast('Entry list cleared');
      });
    });

    // Podium ----------------------------------------------------------
    $('#btnPodiumClose').addEventListener('click', () => {
      $('#podiumOverlay').hidden = true;
      confetti.stop();
    });
    $('#btnPodiumAgain').addEventListener('click', () => {
      $('#podiumOverlay').hidden = true;
      confetti.stop();
      startTournament();
    });

    // Header ----------------------------------------------------------
    $('#btnTheme').addEventListener('click', toggleTheme);
    $('#btnHelp').addEventListener('click', helpDialog);

    // Modal dismissal --------------------------------------------------
    $('#modalRoot').addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-close')) closeModal();
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); onRunButton(); break;
        case 'r': resetRace(); renderer.clearSkids(); break;
        case 'g': $('#btnRandom').click(); break;
        case 's': saveDriverDialog(); break;
        case 'l': loadDriverDialog(); break;
        case 'd': toggleTheme(); break;
        case 'h': helpDialog(); break;
        case 't': setMode(app.mode === 'practice' ? 'tournament' : 'practice'); break;
        case '1': setSpeed(1); break;
        case '2': setSpeed(2); break;
        case '4': setSpeed(4); break;
        case 'escape': closeModal(); $('#podiumOverlay').hidden = true; confetti.stop(); break;
      }
    });
  }

  function setSpeed(v) {
    app.speed = v;
    GR.storage.settings.patch({ speed: v });
    $$('.seg-btn').forEach((b) => b.classList.toggle('is-active', +b.dataset.speed === v));
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    $('#btnTheme').textContent = next === 'dark' ? '☀️' : '🌙';
    GR.storage.settings.patch({ theme: next });
    renderStats();
  }

  function setMode(mode) {
    app.mode = mode;
    $$('.mode-tab').forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $('#panelPractice').hidden = mode !== 'practice';
    $('#panelTournament').hidden = mode !== 'tournament';
    $('#overlayToggles').style.display = mode === 'practice' ? '' : 'none';
    $('#btnRun').innerHTML = mode === 'practice' ? '<span>▶</span> Run Test' : '<span>🚦</span> Start';
    syncTrackUi();
    resetRace();
  }

  /* ================================================================ RACING */
  function onRunButton() {
    if (app.mode === 'tournament') {
      if (!app.race || app.race.phase === 'finished') startTournament();
      else togglePause();
      return;
    }
    if (!app.race || app.race.phase === 'finished') startPractice();
    else togglePause();
  }

  function togglePause() {
    app.paused = !app.paused;
    updateRunButton();
    showMessage(app.paused ? '⏸ Paused — press <b>Space</b> to continue' : '');
  }

  function updateRunButton() {
    const running = app.race && app.race.phase !== 'finished';
    const label = !running
      ? (app.mode === 'practice' ? '<span>▶</span> Run Test' : '<span>🚦</span> Start Tournament')
      : app.paused ? '<span>▶</span> Resume' : '<span>⏸</span> Pause';
    $('#btnRun').innerHTML = label;
    $('#btnRun2').innerHTML = !running ? '<span>▶</span> Run Test'
      : app.paused ? '<span>▶</span> Resume' : '<span>⏸</span> Pause';
  }

  function resetRace() {
    app.race = null;
    app.raceMode = null;
    app.paused = false;
    $('#liveBoard').hidden = true;
    $('#podiumOverlay').hidden = true;
    confetti.stop();
    updateRunButton();
    updateHud();
    showMessage(app.mode === 'practice'
      ? 'Press <b>Run Test</b> ▶ to watch your AI driver'
      : 'Press <b>Start Tournament</b> 🚦 when every team has entered');
  }

  /** Practice: exactly one car, all the teaching overlays switched on. */
  function startPractice(isReplay) {
    const track = GR.tracks.get(app.trackId);
    app.race = new GR.race.Race({
      track,
      drivers: [{ name: app.driver.name || 'My Team', genes: app.driver.genes, color: U.CAR_COLORS[0] }],
      duration: app.duration,
      seed: app.seed,
      countdown: 2,
    });
    app.raceMode = 'practice';
    app.paused = false;
    renderer.clearSkids();
    $('#liveBoard').hidden = true;
    updateRunButton();
    showMessage(isReplay ? '🎬 Replay of the same run (same seed = same result)' : '');
  }

  /** Tournament: the whole field, fixed seed, identical everything. */
  function startTournament() {
    const roster = GR.storage.roster.all();
    if (!roster.length) {
      toast('⚠️ No entries yet — add drivers first');
      setMode('tournament');
      return;
    }
    setMode('tournament');
    const track = GR.tracks.get(app.trackId);
    app.race = new GR.race.Race({
      track,
      drivers: roster,
      duration: app.duration,
      seed: TOURNAMENT_SEED,     // fixed: fairness beats variety here
      countdown: 3,
    });
    app.raceMode = 'tournament';
    app.paused = false;
    renderer.clearSkids();
    $('#liveBoard').hidden = false;
    $('#podiumOverlay').hidden = true;
    confetti.stop();
    updateRunButton();
    showMessage('');
  }

  function onRaceFinished() {
    updateRunButton();
    $('#btnReplay').disabled = false;

    if (app.raceMode === 'practice') {
      const car = app.race.cars[0];
      app.prevRun = app.lastRun;
      app.lastRun = GR.stats.summarize(car, app.race);
      app.ghost = { recording: car.recording.slice(), trackId: app.trackId };
      renderStats();
      const laps = Math.max(0, car.laps);
      showMessage(`🏁 ${laps} lap${laps === 1 ? '' : 's'} · best ${U.formatTime(car.bestLap)} · ` +
        `${car.stats.collisions} bump${car.stats.collisions === 1 ? '' : 's'} · ` +
        `${car.stats.offTrackTime.toFixed(1)} s off track`);
    } else {
      showTournamentResult(app.race);
    }
  }

  /* ============================================================== LEADERBOARD */
  function renderBoard(race) {
    const list = race.standings();
    const el = $('#boardList');
    if (el.childElementCount !== list.length) {
      el.innerHTML = list.map(() => '<li class="board-row"></li>').join('');
    }
    const rows = el.children;
    list.forEach((car, i) => {
      const row = rows[i];
      row.classList.toggle('is-lead', i === 0);
      const best = isFinite(car.bestLap) ? U.formatTime(car.bestLap) : '—';
      row.innerHTML =
        `<span class="board-pos">${i + 1}</span>` +
        `<span class="board-dot" style="background:${car.color}"></span>` +
        `<span class="board-name">${escapeHtml(car.name)}</span>` +
        `<span class="board-laps">L${Math.max(0, car.laps)} · ${best}</span>`;
    });
  }

  function showTournamentResult(race) {
    const order = race.finishOrder;
    app.lastTournament = order.map((c) => ({
      name: c.name, color: c.color, laps: Math.max(0, c.laps),
      best: c.bestLap, avg: c.avgSpeed, collisions: c.stats.collisions,
    }));

    // Sidebar classification
    $('#resultsList').innerHTML = app.lastTournament.map((r, i) => `
      <li class="result-row r-${i + 1}">
        <b>${i + 1}${i === 0 ? ' 🥇' : i === 1 ? ' 🥈' : i === 2 ? ' 🥉' : ''}</b>
        <span class="board-dot" style="background:${r.color}"></span>
        <span>${escapeHtml(r.name)}</span>
        <span class="r-meta">${r.laps} laps · ${isFinite(r.best) ? U.formatTime(r.best) : '—'}</span>
      </li>`).join('');

    // Podium
    const step = (r, place) => r ? `
      <div class="podium-step p${place}">
        <div class="podium-car" style="color:${r.color}">🏎️</div>
        <div class="podium-name">${escapeHtml(r.name)}</div>
        <div class="podium-meta">${r.laps} laps · ${isFinite(r.best) ? U.formatTime(r.best) : '—'}</div>
        <div class="podium-block">${place}</div>
      </div>` : '';
    const t = app.lastTournament;
    $('#podium').innerHTML = step(t[1], 2) + step(t[0], 1) + step(t[2], 3);
    $('#podiumRest').innerHTML = t.slice(3).map((r, i) => `
      <li class="result-row">
        <b>${i + 4}</b>
        <span class="board-dot" style="background:${r.color}"></span>
        <span>${escapeHtml(r.name)}</span>
        <span class="r-meta">${r.laps} laps</span>
      </li>`).join('');

    $('#podiumOverlay').hidden = false;
    confetti.burst(280);
    setTimeout(() => confetti.burst(160), 900);
  }

  /* ================================================================ STATS */
  function renderStats() {
    const cur = app.lastRun;
    const prev = app.prevRun;
    const grid = $('#statGrid');

    if (!cur) {
      grid.innerHTML = '<p class="muted small" style="grid-column:1/-1;margin:0">' +
        'Run a test and this panel fills with your driver\'s numbers: laps, average speed, ' +
        'collisions, time in the grass, braking events and steering smoothness.</p>';
      $('#statsHint').textContent = 'Run a test to see your numbers';
      GR.stats.drawCompare($('#chartCompare'), null, null);
      GR.stats.drawSpeedTrace($('#chartSpeed'), null, null);
      return;
    }

    const items = [
      { label: 'Laps', value: cur.laps, prev: prev && prev.laps, better: 'high', d: 0 },
      { label: 'Best lap', value: cur.bestLap, prev: prev && prev.bestLap, better: 'low', fmt: (v) => (v ? U.formatTime(v) : '—') },
      { label: 'Avg speed', value: cur.avgSpeed, prev: prev && prev.avgSpeed, better: 'high', d: 0 },
      { label: 'Collisions', value: cur.collisions, prev: prev && prev.collisions, better: 'low', d: 0 },
      { label: 'Off track', value: cur.offTrackTime, prev: prev && prev.offTrackTime, better: 'low', d: 1, suffix: ' s' },
      { label: 'Smoothness', value: cur.smoothness, prev: prev && prev.smoothness, better: 'high', d: 0, suffix: '%' },
    ];

    grid.innerHTML = items.map((it) => {
      const shown = it.fmt ? it.fmt(it.value) : it.value.toFixed(it.d === undefined ? 1 : it.d) + (it.suffix || '');
      let delta = '';
      if (prev && it.prev !== undefined && it.prev !== null && isFinite(it.prev)) {
        const diff = it.value - it.prev;
        if (Math.abs(diff) > 1e-6) {
          const good = it.better === 'high' ? diff > 0 : diff < 0;
          const mag = it.fmt ? Math.abs(diff).toFixed(2) + 's' : Math.abs(diff).toFixed(it.d === undefined ? 1 : it.d);
          delta = `<span class="stat-delta ${good ? 'delta-good' : 'delta-bad'}">${diff > 0 ? '▲' : '▼'} ${mag}</span>`;
        }
      }
      return `<div class="stat"><span class="stat-label">${it.label}</span>
              <span class="stat-value">${shown}</span>${delta}</div>`;
    }).join('');

    $('#statsHint').textContent = prev ? 'compared with your previous run' : 'run again to compare';
    GR.stats.drawCompare($('#chartCompare'), cur, prev);
    GR.stats.drawSpeedTrace($('#chartSpeed'), cur, prev);
  }

  /* =============================================================== ROSTER */
  function renderRoster() {
    const list = GR.storage.roster.all();
    $('#rosterCount').textContent = list.length;
    const el = $('#rosterList');
    if (!list.length) {
      el.innerHTML = '<li class="roster-empty">No entries yet.<br>' +
        'Use <b>Add current</b> or <b>Import</b> to build the grid.</li>';
      return;
    }
    el.innerHTML = list.map((d) => {
      const style = GR.genes.styleLabel(d.genes);
      const bars = GR.genes.KEYS.map((k) =>
        `<i style="height:${4 + (d.genes[k] / 100) * 18}px"></i>`).join('');
      return `<li class="roster-item">
        <span class="roster-dot" style="background:${d.color}"></span>
        <span>
          <span class="roster-name">${escapeHtml(d.name)}</span><br>
          <span class="roster-style">${style.emoji} ${style.name}</span>
        </span>
        <span class="gene-mini">${bars}</span>
        <button class="mini-btn" data-remove="${escapeHtml(d.name)}" title="Remove">✕</button>
      </li>`;
    }).join('');
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      GR.storage.roster.remove(b.dataset.remove);
      renderRoster();
    }));
  }

  function addCurrentToRoster() {
    const name = (app.driver.name || '').trim() || 'Team';
    const entry = GR.storage.roster.add({ name, genes: app.driver.genes });
    renderRoster();
    setMode('tournament');
    toast(`✅ "${entry.name}" entered in the tournament`);
  }

  function addDemoBots() {
    const bots = [
      { name: 'Speed Demon', genes: { maxSpeed: 95, acceleration: 80, braking: 20, turning: 60, anticipation: 30, overtaking: 85, safety: 15, recovery: 60 } },
      { name: 'Professor Careful', genes: { maxSpeed: 35, acceleration: 45, braking: 85, turning: 40, anticipation: 80, overtaking: 20, safety: 85, recovery: 50 } },
      { name: 'Smooth Sam', genes: { maxSpeed: 65, acceleration: 60, braking: 55, turning: 35, anticipation: 70, overtaking: 45, safety: 55, recovery: 55 } },
      { name: 'Corner Cutter', genes: { maxSpeed: 70, acceleration: 70, braking: 45, turning: 75, anticipation: 55, overtaking: 65, safety: 20, recovery: 70 } },
      { name: 'Steady Eddie', genes: { maxSpeed: 55, acceleration: 55, braking: 60, turning: 50, anticipation: 60, overtaking: 40, safety: 60, recovery: 45 } },
    ];
    bots.forEach((b) => GR.storage.roster.add(b));
    renderRoster();
    toast('🤖 Five practice bots added');
  }

  function exportRoster() {
    const list = GR.storage.roster.all();
    if (!list.length) { toast('⚠️ Nothing to export yet'); return; }
    U.downloadText('gene-racer-roster.json', GR.storage.exportDrivers(list, 'roster'));
    toast('📤 Roster exported as JSON');
  }

  /* =============================================================== MODALS */
  function openModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modalRoot').hidden = false;
  }
  function closeModal() { $('#modalRoot').hidden = true; }

  function saveDriverDialog() {
    openModal(`
      <h2>💾 Save driver</h2>
      <p>Store this gene set in this browser so you can come back to it later.</p>
      <label class="field"><span>Driver name</span>
        <input type="text" id="mSaveName" maxlength="22" value="${escapeHtml(app.driver.name)}"></label>
      <div class="modal-actions">
        <button class="btn" id="mDownload">⬇️ Download as file</button>
        <button class="btn btn-primary" id="mSave">Save</button>
      </div>`);
    const nameEl = $('#mSaveName');
    nameEl.focus();
    nameEl.select();
    $('#mSave').addEventListener('click', () => {
      const name = nameEl.value.trim() || 'Team';
      GR.storage.drivers.save({ name, genes: app.driver.genes });
      app.driver.name = name;
      $('#teamName').value = name;
      GR.storage.settings.patch({ teamName: name });
      closeModal();
      toast(`💾 Saved "${name}"`);
    });
    $('#mDownload').addEventListener('click', () => {
      const name = nameEl.value.trim() || 'Team';
      U.downloadText(`${name.replace(/[^\w-]+/g, '_')}.json`,
        GR.storage.exportDrivers([{ name, genes: app.driver.genes }], name));
      closeModal();
      toast('⬇️ Driver file downloaded');
    });
  }

  function loadDriverDialog() {
    const saved = GR.storage.drivers.all();
    const rows = saved.length ? saved.map((d) => {
      const style = GR.genes.styleLabel(d.genes);
      return `<li class="driver-item">
        <span><b>${escapeHtml(d.name)}</b><br><span class="muted small">${style.emoji} ${style.name}</span></span>
        <button class="btn" data-load="${escapeHtml(d.name)}">Load</button>
        <button class="mini-btn" data-del="${escapeHtml(d.name)}">🗑️</button>
      </li>`;
    }).join('') : '<li class="roster-empty">Nothing saved in this browser yet.</li>';

    openModal(`
      <h2>📂 Load driver</h2>
      <p>Pick one of your saved drivers, or open a driver file from another computer.</p>
      <ul class="driver-list">${rows}</ul>
      <div class="modal-actions">
        <button class="btn" id="mFromFile">📁 Open file…</button>
      </div>`);

    $('#modalBody').querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      const d = saved.find((x) => x.name === b.dataset.load);
      if (!d) return;
      app.driver.name = d.name;
      app.driver.genes = GR.genes.sanitize(d.genes);
      $('#teamName').value = d.name;
      syncGeneUi();
      closeModal();
      toast(`📂 Loaded "${d.name}"`);
    }));
    $('#modalBody').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      GR.storage.drivers.remove(b.dataset.del);
      loadDriverDialog();
    }));
    $('#mFromFile').addEventListener('click', () => pickFile((text) => {
      try {
        const list = GR.storage.parseDrivers(text);
        app.driver.name = list[0].name;
        app.driver.genes = list[0].genes;
        $('#teamName').value = list[0].name;
        syncGeneUi();
        closeModal();
        toast(`📂 Loaded "${list[0].name}"`);
      } catch (err) { toast('⚠️ ' + err.message); }
    }));
  }

  function importDialog() {
    openModal(`
      <h2>📥 Import drivers</h2>
      <p>Add one or many teams to the tournament. Open the JSON files the teams
         downloaded, or paste their contents in the box below.</p>
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="btn btn-primary" id="mPickFiles">📁 Open file(s)…</button>
      </div>
      <h3>…or paste JSON</h3>
      <textarea id="mPaste" placeholder='{"drivers":[{"name":"Team Rocket","genes":{"maxSpeed":80, "...":0}}]}'></textarea>
      <div class="modal-actions">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="mImport">Import</button>
      </div>`);

    $('#mPickFiles').addEventListener('click', () => pickFile((text) => doImport(text), true));
    $('#mImport').addEventListener('click', () => doImport($('#mPaste').value));
  }

  function doImport(text) {
    try {
      const list = GR.storage.parseDrivers(text);
      list.forEach((d) => GR.storage.roster.add(d));
      renderRoster();
      closeModal();
      setMode('tournament');
      toast(`📥 Imported ${list.length} driver${list.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast('⚠️ ' + err.message);
    }
  }

  function pickFile(cb, multiple) {
    const input = $('#fileInput');
    input.multiple = !!multiple;
    input.value = '';
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      let pending = files.length;
      const texts = [];
      files.forEach((f, i) => {
        const reader = new FileReader();
        reader.onload = () => {
          texts[i] = String(reader.result);
          if (--pending === 0) {
            // Merge multiple files into a single driver list.
            const all = [];
            for (const t of texts) {
              try { all.push(...GR.storage.parseDrivers(t)); } catch (e) { /* skip bad file */ }
            }
            cb(all.length ? JSON.stringify({ drivers: all }) : texts[0]);
          }
        };
        reader.readAsText(f);
      });
    };
    input.click();
  }

  function confirmDialog(title, body, onYes) {
    openModal(`
      <h2>${title}</h2><p>${body}</p>
      <div class="modal-actions">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-accent" id="mYes">Yes, do it</button>
      </div>`);
    $('#mYes').addEventListener('click', () => { closeModal(); onYes(); });
  }

  function helpDialog() {
    openModal(`
      <h2>❓ How Gene Racer works</h2>
      <p>Your car drives itself. You never write code — you only tune eight
         <b>genes</b>. The AI reads the track with virtual sensors, decides when
         to brake, which line to take and when to overtake. Change a gene and
         you change how it thinks.</p>

      <h3>The loop (about one hour)</h3>
      <ul>
        <li><b>1 · Test</b> — pick a track, press <b>Run Test</b>, and watch. The blue
            rays are what your car can "see"; the dashed white line is the racing
            line it is aiming for; red shading is a braking zone.</li>
        <li><b>2 · Read the report</b> — laps, collisions, seconds in the grass,
            braking events, smoothness. The chart compares the run with the last one.</li>
        <li><b>3 · Tune one gene at a time</b> — change too many at once and you
            will not know what helped.</li>
        <li><b>4 · Enter the tournament</b> — press <b>Enter in Tournament</b>, then the
            teacher starts the grand final with every team on the grid.</li>
      </ul>

      <h3>There is no perfect setting</h3>
      <p>Every gene trades something away. Maximum speed costs grip. Braking early
         is safe but slow. A tiny safety margin gives the quickest line and the most
         wall contact. The winning driver is the best <i>compromise</i> for the track
         you chose.</p>

      <h3>Keyboard shortcuts</h3>
      <div class="shortcut-grid">
        <span class="kbd">Space</span><span>Run / pause</span>
        <span class="kbd">R</span><span>Reset</span>
        <span class="kbd">G</span><span>Randomize genes</span>
        <span class="kbd">S</span> <span>Save driver</span>
        <span class="kbd">L</span><span>Load driver</span>
        <span class="kbd">T</span><span>Switch practice / tournament</span>
        <span class="kbd">1</span><span>Normal speed</span>
        <span class="kbd">2</span> <span>Double speed</span>
        <span class="kbd">4</span><span>Quadruple speed</span>
        <span class="kbd">D</span><span>Dark mode</span>
        <span class="kbd">H</span><span>This help</span>
      </div>

      <h3>Fairness</h3>
      <p>The tournament always uses the fixed seed <code>${TOURNAMENT_SEED}</code>, the same
         track and the same physics for everyone. Practice runs may use any seed you like.</p>
      <div class="modal-actions"><button class="btn btn-primary" data-close>Got it!</button></div>`);
  }

  /* ================================================================ TOASTS */
  let toastHost;
  function toast(msg) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      document.body.appendChild(toastHost);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(() => el.remove(), 2900);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ go! */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.GR);
