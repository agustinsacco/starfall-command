'use strict';
// Shared by the sandboxed renderer, Node tests, and Electron's trusted save service.
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./simulation.js'));
  else root.StarfallSaveFormat = factory(root.Starfall);
})(globalThis, ({ Game, D, W, H }) => {
  const MAX_BYTES = 16 * 1024 * 1024;
  const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const FORMAT = 'starfall-operation';
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  const assertId = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) throw Error('Invalid operation ID');
    return id;
  };
  const name = (value) => {
    if (typeof value !== 'string') throw Error('Operation needs a name');
    const n = value.trim();
    if (!n || n.length > 48 || /[\u0000-\u001f\u007f]/.test(n)) throw Error('Use a name of 1–48 characters');
    return n;
  };
  const ids = (value) =>
    Array.isArray(value) && value.length <= 2048 && value.every((n) => Number.isInteger(n) && n > 0);
  function validateSnapshot(snapshot) {
    if (!object(snapshot) || snapshot.version !== 2 || typeof snapshot.simulation !== 'string')
      throw Error('Unsupported save snapshot');
    const game = Game.load(snapshot.simulation),
      v = snapshot.view;
    if (
      !object(v) ||
      !object(v.camera) ||
      !number(v.camera.x, 0, W) ||
      !number(v.camera.y, 0, H) ||
      !number(v.camera.z, 0.45, 1.8) ||
      !ids(v.selection) ||
      !object(v.groups) ||
      ![1, 1.5, 2].includes(v.speed) ||
      typeof v.sound !== 'boolean' ||
      !['actions', 'build'].includes(v.tab) ||
      !number(v.accumulator, 0, 0.051) ||
      typeof snapshot.paused !== 'boolean'
    )
      throw Error('Invalid saved view');
    for (const [key, group] of Object.entries(v.groups))
      if (!/^[1-5]$/.test(key) || !ids(group)) throw Error('Invalid control group');
    if (
      v.mode !== null &&
      (!object(v.mode) ||
        !((Object.hasOwn(D, v.mode.build) && D[v.mode.build].building) || ['move', 'attackmove'].includes(v.mode.type)))
    )
      throw Error('Invalid command mode');
    return game;
  }
  async function checksum(value) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
  }
  function summary(record, game) {
    return {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revision: record.revision,
      time: game.time,
      difficulty: game.difficulty,
      result: game.result,
      mapSeed: game.mapSeed,
      units: game.own(0).filter((e) => !D[e.type].building).length,
      buildings: game.own(0).filter((e) => D[e.type].building).length,
      minerals: Math.floor(game.teams[0].minerals),
      gas: Math.floor(game.teams[0].gas),
    };
  }
  async function makeRecord({ id = crypto.randomUUID(), name: title, snapshot }, previous = null) {
    assertId(id);
    const game = validateSnapshot(snapshot),
      now = new Date().toISOString();
    const record = {
      format: FORMAT,
      version: 2,
      id,
      name: name(title),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      revision: (previous?.revision || 0) + 1,
      snapshot,
    };
    record.checksum = await checksum(record);
    return { record, summary: summary(record, game) };
  }
  async function parseRecord(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES)
      throw Error('Save exceeds the 16 MB limit');
    const record = JSON.parse(raw);
    if (!object(record) || record.format !== FORMAT || record.version !== 2) throw Error('Unsupported save format');
    assertId(record.id);
    name(record.name);
    if (
      typeof record.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.updatedAt)) ||
      !Number.isInteger(record.revision) ||
      record.revision < 1 ||
      typeof record.checksum !== 'string'
    )
      throw Error('Invalid save metadata');
    const { checksum: expected, ...payload } = record;
    if ((await checksum(payload)) !== expected) throw Error('Save integrity check failed');
    const game = validateSnapshot(record.snapshot);
    return { record, summary: summary(record, game) };
  }
  function migrateLegacy(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) throw Error('Invalid legacy save');
    const legacy = JSON.parse(raw),
      game = Game.load(legacy.game),
      c = legacy.camera || {};
    const groups = Object.fromEntries(
      Object.entries(legacy.groups || {}).filter(([k, v]) => /^[1-5]$/.test(k) && ids(v)),
    );
    return {
      version: 2,
      simulation: game.save(),
      paused: true,
      view: {
        camera: {
          x: number(c.x, 0, W) ? c.x : 440,
          y: number(c.y, 0, H) ? c.y : 1280,
          z: number(c.z, 0.45, 1.8) ? c.z : 0.9,
        },
        groups,
        selection: game
          .own(0, 'hq')
          .slice(0, 1)
          .map((e) => e.id),
        speed: [1, 1.5, 2].includes(legacy.speed) ? legacy.speed : 1,
        sound: false,
        tab: 'actions',
        mode: null,
        accumulator: 0,
      },
    };
  }
  return { MAX_BYTES, ID, FORMAT, assertId, name, validateSnapshot, checksum, makeRecord, parseRecord, migrateLegacy };
});
