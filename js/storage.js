/* ==========================================================================
   storage.js — everything that survives a page reload.

   Uses localStorage only (no backend). Three buckets:
     gr.drivers   the team's saved drivers  ("Save Driver" / "Load Driver")
     gr.roster    the tournament entry list
     gr.settings  UI preferences (theme, last track, speed, overlays)

   Drivers are also exchanged as JSON files so a whole classroom can hand its
   entries to the teacher's laptop on a USB stick.
   ========================================================================== */
window.GR = window.GR || {};

(function (GR) {
  'use strict';
  const U = GR.utils;

  const KEY_DRIVERS = 'gr.drivers.v1';
  const KEY_ROSTER = 'gr.roster.v1';
  const KEY_SETTINGS = 'gr.settings.v1';

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val === null || val === undefined ? fallback : val;
    } catch (e) {
      console.warn('[storage] could not read', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[storage] could not write', key, e);
      return false;
    }
  }

  /** Normalise anything that claims to be a driver. */
  function normalizeDriver(obj, index) {
    const name = String((obj && obj.name) || 'Team ' + ((index || 0) + 1)).slice(0, 22).trim() || 'Team';
    return {
      name,
      genes: GR.genes.sanitize(obj && obj.genes),
      color: (obj && obj.color) || U.CAR_COLORS[(index || 0) % U.CAR_COLORS.length],
      savedAt: (obj && obj.savedAt) || Date.now(),
    };
  }

  /* ------------------------------------------------------------- drivers */
  const drivers = {
    all() { return read(KEY_DRIVERS, []).map(normalizeDriver); },
    save(driver) {
      const list = drivers.all();
      const i = list.findIndex((d) => d.name.toLowerCase() === driver.name.toLowerCase());
      const entry = normalizeDriver(driver, i < 0 ? list.length : i);
      entry.savedAt = Date.now();
      if (i >= 0) list[i] = entry; else list.push(entry);
      write(KEY_DRIVERS, list);
      return entry;
    },
    remove(name) {
      write(KEY_DRIVERS, drivers.all().filter((d) => d.name !== name));
    },
    clear() { write(KEY_DRIVERS, []); },
  };

  /* -------------------------------------------------------------- roster */
  const roster = {
    all() { return read(KEY_ROSTER, []).map(normalizeDriver); },
    set(list) { write(KEY_ROSTER, list.map(normalizeDriver)); },
    add(driver) {
      const list = roster.all();
      const base = String(driver.name || 'Team').trim() || 'Team';
      let name = base, n = 2;
      while (list.some((d) => d.name.toLowerCase() === name.toLowerCase())) name = `${base} ${n++}`;
      const entry = normalizeDriver(Object.assign({}, driver, { name }), list.length);
      entry.color = driver.color || U.CAR_COLORS[list.length % U.CAR_COLORS.length];
      list.push(entry);
      roster.set(list);
      return entry;
    },
    remove(name) { roster.set(roster.all().filter((d) => d.name !== name)); },
    clear() { roster.set([]); },
  };

  /* ------------------------------------------------------------ settings */
  const settings = {
    all() {
      return Object.assign({
        theme: 'light',
        trackId: 'oval',
        duration: 90,
        speed: 1,
        showRays: true,
        showLine: true,
        showBrake: true,
        showGhost: true,
        tournamentCarCollisions: true,
        teamName: 'My Team',
      }, read(KEY_SETTINGS, {}));
    },
    patch(obj) { write(KEY_SETTINGS, Object.assign(settings.all(), obj)); },
  };

  /* ------------------------------------------------------ import / export */

  /**
   * Accepts several shapes so students can't easily get it wrong:
   *   {name, genes}                       one driver
   *   [{name, genes}, ...]                a list
   *   {drivers:[...]} / {roster:[...]}    a wrapper object
   */
  function parseDrivers(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('That is not valid JSON. Copy the whole file, including { and }.'); }

    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.drivers)) list = data.drivers;
    else if (data && Array.isArray(data.roster)) list = data.roster;
    else if (data && data.genes) list = [data];

    if (!list || !list.length) throw new Error('No drivers found in that file.');
    return list.map(normalizeDriver);
  }

  function exportDrivers(list, label) {
    return JSON.stringify({
      format: 'gene-racer-drivers',
      version: 1,
      label: label || 'drivers',
      exportedAt: new Date().toISOString(),
      drivers: list.map((d) => ({ name: d.name, genes: d.genes, color: d.color })),
    }, null, 2);
  }

  GR.storage = { drivers, roster, settings, parseDrivers, exportDrivers, normalizeDriver };
})(window.GR);
