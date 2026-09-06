import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Game } = require('../src/simulation.js');
const F = require('../src/save-format.js');
const { SaveStore } = require('../electron/save-store.cjs');
const tick = (g, n) => { for (let i = 0; i < n; i++) g.update(.05); };
function snapshot(g = new Game()) {
  return { version: 2, simulation: g.save(), paused: true, view: { camera: { x: 650, y: 1160, z: .9 }, selection: g.own(0, 'ranger').map(e => e.id), groups: { 1: g.own(0, 'drone').map(e => e.id) }, speed: 1.5, sound: true, mode: { type: 'attackmove' }, tab: 'actions', accumulator: .031 } };
}
async function setup(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starfall-save-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); const store = new SaveStore(dir); await store.init(); return { store, dir }; }

test('v2 restores every simulation field byte-for-byte, including paths, visibility timing, effects and AI', () => {
  const g = new Game('normal', 104729);
  g.train(g.own(0, 'barracks')[0].id, 'ranger');
  g.order(g.own(0, 'ranger').map(e => e.id), 'attackmove', 1250, 1200);
  tick(g, 617);
  const drone = g.own(0, 'drone')[0];
  g.teams[0].minerals += 500; g.build(drone.id, 'relay', 630, 1260);
  tick(g, 13);
  const save = g.save(), restored = Game.load(save);
  assert.equal(restored.save(), save);
  assert.ok(g.entities.some(e => e.path.length > 0));
  assert.ok(g.entities.some(e => !e.complete));
  assert.ok(g.visionClock > 0);
  // Both versions must make identical decisions, not merely look similar on the load frame.
  for (let i = 0; i < 1400; i++) { g.update(.05); restored.update(.05); if (i % 200 === 0) assert.equal(restored.save(), g.save()); }
  assert.equal(restored.save(), g.save());
});

test('portable envelope preserves complete view, commands, selection and checks its checksum', async () => {
  const data = snapshot(), id = randomUUID(), made = await F.makeRecord({ id, name: 'North Ridge', snapshot: data });
  const parsed = await F.parseRecord(JSON.stringify(made.record));
  assert.deepEqual(parsed.record.snapshot, data);
  assert.equal(parsed.summary.id, id);
  const changed = structuredClone(made.record); changed.snapshot.view.speed = 2;
  await assert.rejects(F.parseRecord(JSON.stringify(changed)), /integrity/);
  const badView = structuredClone(data); badView.view.camera.x = -10;
  assert.throws(() => F.validateSnapshot(badView), /view/);
});

test('malformed simulation fields cannot crash the game after being accepted', () => {
  const base = JSON.parse(new Game().save());
  const mutations = [p => { p.entities[0].order = null; }, p => { p.entities[0].path = [{ x: -5, y: 10 }]; }, p => { p.entities[1].id = p.entities[0].id; }, p => { p.nextId = 1; }, p => { p.teams[0].stats.kills = '<script>'; }, p => { p.resources[0].amount = -1; }, p => { p.visible[0][0] = 2; }, p => { p.difficulty = 'unknown'; }, p => { p.entities[0].queue = [{ kind: 'unit', type: 'tank', progress: .2, time: 5, m: 1, g: 0 }]; }];
  for (const mutate of mutations) { const p = structuredClone(base); mutate(p); assert.throws(() => Game.load(JSON.stringify(p)), /Invalid/); }
  assert.throws(() => Game.load('x'.repeat(12 * 1024 * 1024 + 1)), /size/);
});

test('legacy browser saves migrate without overwriting or losing game resources', async () => {
  const g = new Game(); tick(g, 127);
  const legacy = JSON.parse(g.save()); legacy.version = 1;
  for (const k of ['visible', 'visionClock', 'mapSeed', 'effects', 'events']) delete legacy[k];
  const raw = JSON.stringify({ game: JSON.stringify(legacy), camera: { x: 0, y: 0, z: .8 }, groups: { 1: [g.entities[0].id] }, speed: 2 });
  const migrated = F.migrateLegacy(raw), loaded = F.validateSnapshot(migrated);
  assert.equal(loaded.version, 2); assert.equal(loaded.time, g.time);
  assert.deepEqual(loaded.teams, g.teams);
  assert.equal(migrated.view.camera.x, 0, 'zero coordinates must not be replaced by defaults');
  const envelope = await F.makeRecord({ name: 'Migrated', snapshot: migrated });
  assert.ok((await F.parseRecord(JSON.stringify(envelope.record))).summary.time > 0);
});

test('separate named operations persist through a fresh store instance', async t => {
  const { store, dir } = await setup(t), a = randomUUID(), b = randomUUID();
  await store.write({ id: a, name: 'First Expedition', snapshot: snapshot() });
  const g = new Game('hard', 77); tick(g, 40);
  await store.write({ id: b, name: 'Second Expedition', snapshot: snapshot(g) });
  const reopened = new SaveStore(dir), rows = await reopened.list();
  assert.equal(rows.length, 2); assert.equal((await reopened.read(a)).summary.time, 0);
  assert.equal((await reopened.read(b)).summary.difficulty, 'hard');
  assert.equal((await reopened.read(b)).record.snapshot.simulation, g.save());
});

test('concurrent saves are serialized, with monotonic revisions and a last-known-good backup', async t => {
  const { store, dir } = await setup(t), id = randomUUID();
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.write({ id, name: 'Revision ' + i, snapshot: snapshot() })));
  const latest = await store.read(id); assert.equal(latest.record.revision, 8); assert.equal(latest.record.name, 'Revision 7');
  const backup = await F.parseRecord(await fs.readFile(path.join(dir, id + '.json.bak'), 'utf8'));
  assert.equal(backup.record.revision, 7);
  assert.deepEqual((await fs.readdir(dir)).sort(), [id + '.json', id + '.json.bak'].sort());
});

test('a truncated primary recovers from backup; malformed files never erase another game', async t => {
  const { store, dir } = await setup(t), id = randomUUID();
  await store.write({ id, name: 'Before', snapshot: snapshot() });
  await store.write({ id, name: 'After', snapshot: snapshot() });
  await fs.writeFile(path.join(dir, id + '.json'), '{truncated');
  const restored = await store.read(id); assert.equal(restored.recovered, true); assert.equal(restored.record.name, 'Before');
  assert.equal((await store.list())[0].recovered, true);
  await store.write({ id, name: 'Repaired', snapshot: restored.record.snapshot });
  assert.equal((await store.read(id)).recovered, false);
  await fs.writeFile(path.join(dir, id + '.json.bak'), '{bad'); await fs.rm(path.join(dir, id + '.json'));
  await assert.rejects(store.write({ id, name: 'Do not overwrite', snapshot: snapshot() }), /unreadable/);
  assert.equal((await store.list())[0].corrupt, true);
});

test('failed final write retains the previous save and can be retried', async t => {
  const { store } = await setup(t), id = randomUUID();
  await store.write({ id, name: 'Preserved', snapshot: snapshot() });
  const original = store.atomicWrite.bind(store);
  store.atomicWrite = async (file, data) => { if (file.endsWith('.json')) throw Error('Disk full'); return original(file, data); };
  await assert.rejects(store.write({ id, name: 'Not committed', snapshot: snapshot() }), /Disk full/);
  assert.equal((await store.read(id)).record.name, 'Preserved');
  store.atomicWrite = original;
  await store.write({ id, name: 'Retry succeeded', snapshot: snapshot() });
  assert.equal((await store.read(id)).record.name, 'Retry succeeded');
});

test('rename, portable export/import, legacy import and deletion are isolated', async t => {
  const { store } = await setup(t), id = randomUUID();
  await store.write({ id, name: 'Original', snapshot: snapshot() });
  await store.rename(id, 'Renamed'); assert.equal((await store.read(id)).record.name, 'Renamed');
  const exported = await store.export(id), imported = await store.import(exported);
  assert.notEqual(imported.id, id, 'import must create a new game, not overwrite its source');
  assert.equal((await store.read(imported.id)).record.snapshot.simulation, (await store.read(id)).record.snapshot.simulation);
  const legacy = await store.import(JSON.stringify({ game: new Game().save() }));
  assert.equal((await store.list()).length, 3);
  await store.delete(id); assert.equal((await store.list()).length, 2);
  assert.ok(await store.read(legacy.id)); await assert.rejects(store.read(id));
});

test('path traversal, unsupported formats and invalid names are rejected', async t => {
  const { store } = await setup(t);
  for (const id of ['../escape', '/tmp/x', '__proto__', randomUUID() + '/../../x']) {
    await assert.rejects(store.read(id), /ID/); await assert.rejects(store.delete(id), /ID/);
  }
  await assert.rejects(store.import('{}'));
  await assert.rejects(store.import(' '.repeat(F.MAX_BYTES + 1)), /limit/);
  await assert.rejects(store.write({ id: randomUUID(), name: '', snapshot: snapshot() }), /name/);
  await assert.rejects(store.write({ id: randomUUID(), name: 'x'.repeat(49), snapshot: snapshot() }), /name/);
});
