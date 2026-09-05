import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/simulation.js', import.meta.url), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(source, context);
const { Game, D, W, H, COLS, TILE } = context.Starfall;
const advance = (g, seconds) => { for (let i = 0; i < Math.ceil(seconds / .1) && !g.result; i++) g.update(.1); };
const quiet = () => { const g = new Game(); g.ai = () => {}; return g; };
const rich = g => { g.teams[0].minerals = 10000; g.teams[0].gas = 10000; };
const findSite = (g, type, worker = g.own(0, 'drone')[0]) => {
  for (let y = 1030; y < 1530; y += 28) for (let x = 300; x < 850; x += 28) {
    if (g.placement(type, x, y, worker.team).ok) return { x, y };
  }
  throw Error('No placement site for ' + type);
};

test('both sides start with equal economy, units, and supply', () => {
  const g = new Game();
  assert.equal(g.own(0).length, 11);
  assert.equal(g.own(1).length, 11);
  assert.equal(g.teams[0].minerals, g.teams[1].minerals);
  assert.equal(g.supply(0).used, 8);
  assert.equal(g.supply(0).cap, 22);
  assert.equal(new Set(g.entities.map(e => e.id)).size, g.entities.length);
  assert.equal(g.isVisible(g.own(1, 'hq')[0], 0), false);
});

test('workers deliver real, depleted mineral cargo, rather than generating passive income', () => {
  const g = quiet();
  const before = g.resources.reduce((a, r) => a + r.amount, 0);
  advance(g, 25);
  const t = g.teams[0];
  assert.ok(t.minerals > 400);
  assert.equal(t.minerals - 400, t.stats.gathered);
  const depleted = before - g.resources.reduce((a, r) => a + r.amount, 0);
  const delivered = g.teams.reduce((a, t) => a + t.stats.gathered, 0);
  const cargo = g.entities.reduce((a, e) => a + e.cargo, 0);
  assert.equal(depleted, delivered + cargo);
  g.order(g.own(0, 'drone').map(e => e.id), 'idle', 0, 0);
  const stopped = t.minerals;
  advance(g, 5);
  assert.equal(t.minerals, stopped);
});

test('depleted patches retarget; last partial cargo gets delivered', () => {
  const g = quiet(), u = g.own(0, 'drone')[0], r = g.resource(u.order.target);
  r.amount = 3; u.x = r.x + 20; u.y = r.y;
  advance(g, 12);
  assert.equal(r.amount, 0);
  assert.ok(u.order.target !== r.id || u.cargo > 0);
  assert.ok(g.teams[0].stats.gathered > 0);
});

test('production costs resources, reserves supply, queues, trains, and cancels with full refund', () => {
  const g = quiet(), b = g.own(0, 'barracks')[0];
  assert.equal(g.train(b.id, 'ranger'), true);
  assert.equal(g.teams[0].minerals, 340);
  assert.equal(g.supply(0).used, 9);
  assert.equal(g.own(0, 'ranger').length, 2);
  advance(g, 12);
  assert.equal(g.own(0, 'ranger').length, 3);
  assert.equal(g.supply(0).used, 9);
  assert.equal(g.teams[0].stats.trained, 1);
  const before = g.teams[0].minerals;
  g.train(b.id, 'ranger');
  assert.equal(g.cancelQueue(b.id, 0), true);
  assert.equal(g.teams[0].minerals, before);
  assert.equal(g.supply(0).used, 9);
  assert.equal(g.cancelQueue(b.id, -1), false);
});

test('insufficient resources, supply caps, prerequisites, and full queues cannot be bypassed', () => {
  const g = quiet(), b = g.own(0, 'barracks')[0];
  assert.equal(g.train(b.id, 'lancer'), false);
  g.teams[0].minerals = 0;
  assert.equal(g.train(b.id, 'ranger'), false);
  rich(g);
  for (let i = 0; i < 5; i++) assert.equal(g.train(b.id, 'ranger'), true);
  assert.equal(g.train(b.id, 'ranger'), false);
  b.queue = [];
  for (let i = 0; i < 14; i++) g.add('ranger', 0, 1000 + i * 20, 1400);
  assert.equal(g.supply(0).used, 22);
  assert.equal(g.train(b.id, 'ranger'), false);
  assert.equal(g.train(b.id, 'tank'), false);
});

test('construction checks visibility, obstacles, costs, and requires an active builder', () => {
  const g = quiet(), u = g.own(0, 'drone')[0]; rich(g);
  assert.equal(g.placement('relay', 2200, 800, 0).ok, false);
  assert.equal(g.placement('relay', 440, 1280, 0).ok, false);
  const p = findSite(g, 'relay'), cap = g.supply(0).cap;
  const b = g.build(u.id, 'relay', p.x, p.y);
  assert.ok(b);
  assert.equal(g.supply(0).cap, cap);
  g.order([u.id], 'idle', 0, 0);
  advance(g, 5);
  assert.equal(b.progress, 0);
  g.order([u.id], 'context', b.x, b.y, b.id);
  advance(g, 40);
  assert.equal(b.complete, true);
  assert.equal(b.progress, 1);
  assert.equal(g.supply(0).cap, cap + 10);
  assert.equal(g.teams[0].stats.built, 1);
});

test('abandoned construction can be resumed by another drone; cancellation refunds 75%', () => {
  const g = quiet(); rich(g);
  const [u, u2] = g.own(0, 'drone'), p = findSite(g, 'lab');
  const b = g.build(u.id, 'lab', p.x, p.y);
  g.order([u.id], 'idle', 0, 0);
  g.order([u2.id], 'context', b.x, b.y, b.id);
  advance(g, 45);
  assert.equal(b.complete, true);
  const p2 = findSite(g, 'relay'), money = g.teams[0].minerals;
  const relay = g.build(u.id, 'relay', p2.x, p2.y);
  assert.ok(relay);
  assert.equal(g.cancelBuild(relay.id), true);
  assert.equal(g.teams[0].minerals, money - 90 + Math.floor(90 * .75));
  assert.equal(g.entity(relay.id), undefined);
});

test('gas needs an extractor; right-clicking the completed extractor assigns harvesting', () => {
  const g = quiet(), u = g.own(0, 'drone')[0]; rich(g);
  const vent = g.resources.find(r => r.type === 'gas');
  g.order([u.id], 'context', vent.x, vent.y, vent.id);
  assert.notEqual(u.order.target, vent.id);
  assert.equal(g.placement('refinery', 410, 1120, 0).ok, false);
  const b = g.build(u.id, 'refinery', vent.x + 12, vent.y);
  assert.ok(b); assert.equal(b.x, vent.x); assert.equal(b.vent, vent.id);
  advance(g, 42);
  assert.equal(b.complete, true);
  const u2 = g.own(0, 'drone')[1];
  g.order([u2.id], 'context', b.x, b.y, b.id);
  assert.equal(u2.order.type, 'gather');
  assert.equal(u2.order.target, vent.id);
  const initialGas = g.teams[0].gas;
  advance(g, 15);
  assert.ok(g.teams[0].gas > initialGas);
  assert.ok(vent.amount < 3000);
});

test('changing resource assignments deposits existing cargo without converting its type', () => {
  const g = quiet(), u = g.own(0, 'drone')[0];
  const vent = g.resources.find(r => r.type === 'gas');
  const extractor = g.add('refinery', 0, vent.x, vent.y); extractor.vent = vent.id;
  const hq = g.own(0, 'hq')[0];
  u.x = hq.x + 65; u.y = hq.y; u.cargo = 5; u.cargoType = 'mineral';
  g.order([u.id], 'context', extractor.x, extractor.y, extractor.id);
  const minerals = g.teams[0].minerals, gas = g.teams[0].gas;
  g.worker(u, .1);
  assert.equal(u.cargo, 0);
  assert.equal(g.teams[0].minerals, minerals + 5);
  assert.equal(g.teams[0].gas, gas);
  u.x = extractor.x + 45; u.y = extractor.y; u.cargo = 5; u.cargoType = 'gas';
  const crystal = g.resources.find(r => r.type === 'mineral');
  g.order([u.id], 'context', crystal.x, crystal.y, crystal.id);
  g.worker(u, .1);
  assert.equal(u.cargo, 0);
  assert.equal(g.teams[0].minerals, minerals + 5);
  assert.equal(g.teams[0].gas, gas + 5);
});

test('research has prerequisites, costs, exclusivity, and a three-level cap', () => {
  const g = quiet(); rich(g);
  const lab = g.add('lab', 0, 870, 1340), lab2 = g.add('lab', 0, 970, 1340);
  assert.equal(g.available('lancer', 0), true);
  const funds = g.teams[0].minerals;
  assert.equal(g.research(lab.id, 'weapons'), true);
  assert.equal(g.teams[0].minerals, funds - 120);
  assert.equal(g.research(lab2.id, 'weapons'), false);
  advance(g, 31);
  assert.equal(g.teams[0].up.weapons, 1);
  assert.equal(g.research(lab.id, 'weapons'), true);
  advance(g, 43);
  assert.equal(g.teams[0].up.weapons, 2);
  assert.equal(g.research(lab.id, 'weapons'), true);
  advance(g, 55);
  assert.equal(g.teams[0].up.weapons, 3);
  assert.equal(g.research(lab.id, 'weapons'), false);
});

test('A* navigation goes around rocks and structures; formations do not share a destination', () => {
  const g = quiet(), u = g.own(0, 'ranger')[0];
  u.x = 700; u.y = 1120;
  const path = g.pathfind(u, 1000, 650);
  assert.ok(path.length > 5);
  for (const p of path) assert.equal(g.grid[Math.floor(p.y / TILE) * COLS + Math.floor(p.x / TILE)], 0);
  g.order([u.id], 'move', 1000, 650);
  advance(g, 20);
  assert.ok(Math.hypot(u.x - 1000, u.y - 650) < 45);
  const units = g.own(0, 'ranger');
  g.order(units.map(u => u.id), 'attackmove', 1200, 1000);
  assert.notEqual(units[0].order.x, units[1].order.x);
  assert.ok(units.every(u => u.x >= 0 && u.x < W && u.y >= 0 && u.y < H));
});

test('combat, armor, healing, hold orders, siege splash, and aircraft targeting rules work', () => {
  const g = quiet();
  const a = g.add('ranger', 0, 1200, 920), b = g.add('ranger', 1, 1300, 920);
  g.updateVision();
  const hp = b.hp;
  advance(g, 1);
  assert.ok(b.hp < hp);
  const medic = g.add('mender', 0, 1190, 950); a.hp = 20;
  g.order([a.id], 'hold', 0, 0); g.order([b.id], 'move', 1600, 800);
  advance(g, 3);
  assert.ok(a.hp > 20);
  const tank = g.add('tank', 0, 1000, 1400), e1 = g.add('ranger', 1, 1250, 1400), e2 = g.add('ranger', 1, 1250, 1425);
  g.order([tank.id], 'siege', 0, 0); g.updateVision();
  assert.equal(tank.siege, true);
  const x = tank.x; g.combat(tank, .1);
  assert.ok(e1.hp < D.ranger.hp); assert.ok(e2.hp < D.ranger.hp);
  assert.equal(tank.x, x);
  const air = g.add('wraith', 1, 1020, 1400), airHp = air.hp;
  e1.hp = 0; e2.hp = 0; tank.cool = 0; g.updateVision();
  g.combat(tank, .1); assert.equal(air.hp, airHp);
  const before = medic.hp; g.teams[0].up.armor = 2;
  g.damage(medic, 10, b); assert.equal(medic.hp, before - 8);
});

test('move-only does not auto-attack, and unseen enemies cannot be targeted', () => {
  const g = quiet(), u = g.own(0, 'ranger')[0], enemy = g.own(1, 'hq')[0];
  g.order([u.id], 'attack', enemy.x, enemy.y, enemy.id);
  assert.notEqual(u.order.type, 'attack');
  const target = g.add('ranger', 1, u.x + 30, u.y); target.order = { type: 'hold' };
  g.updateVision(); g.order([u.id], 'move', u.x + 180, u.y + 100);
  const hp = target.hp; g.combat(u, .1);
  assert.equal(target.hp, hp);
  const pos = { x: u.x, y: u.y };
  g.order([u.id], 'hold', 0, 0); target.x += 155;
  g.combat(u, .1);
  assert.equal(u.x, pos.x); assert.equal(u.y, pos.y);
});

test('fog retains exploration after units leave, without revealing hidden contacts', () => {
  const g = quiet(), u = g.own(0, 'ranger')[0];
  u.x = 1300; u.y = 1000; g.updateVision();
  const cell = Math.floor(u.y / TILE) * COLS + Math.floor(u.x / TILE);
  assert.equal(g.visible[0][cell], 1);
  u.x = 440; u.y = 1280; g.updateVision();
  assert.equal(g.visible[0][cell], 0);
  assert.equal(g.explored[0][cell], 1);
});

test('saving restores the actual simulation: resources, orders, queues, upgrades, exploration, and RNG', () => {
  const g = quiet(); rich(g);
  g.train(g.own(0, 'barracks')[0].id, 'ranger'); advance(g, 4);
  g.teams[0].up.armor = 2;
  const save = g.save(), loaded = Game.load(save);
  assert.equal(loaded.time, g.time);
  assert.equal(loaded.seed, g.seed);
  assert.equal(JSON.stringify(loaded.teams), JSON.stringify(g.teams));
  assert.equal(JSON.stringify(loaded.resources), JSON.stringify(g.resources));
  assert.equal(JSON.stringify(loaded.own(0, 'barracks')[0].queue), JSON.stringify(g.own(0, 'barracks')[0].queue));
  assert.deepEqual(Array.from(loaded.explored[0]), Array.from(g.explored[0]));
  assert.equal(loaded.rand(), g.rand());
  loaded.ai = () => {}; advance(loaded, 8);
  assert.equal(loaded.own(0, 'ranger').length, 3);
  assert.throws(() => Game.load('{}'), /Invalid/);
  assert.throws(() => Game.load('{no'), /JSON|property/);
  const bad = JSON.parse(save); bad.entities[0].type = '<invalid>';
  assert.throws(() => Game.load(JSON.stringify(bad)), /Invalid/);
});

test('victory/defeat is based on all structures, and a finished game is frozen', () => {
  for (const [loser, result] of [[1, 'victory'], [0, 'defeat']]) {
    const g = quiet();
    g.own(loser, 'hq')[0].hp = 0; advance(g, .1);
    assert.equal(g.result, null, 'HQ loss alone is not defeat');
    g.own(loser).filter(e => D[e.type].building).forEach(e => { e.hp = 0; });
    advance(g, .1); assert.equal(g.result, result);
    const time = g.time; g.update(.1); assert.equal(g.time, time);
  }
});

test('computer develops its economy, tech, and sends an attack without free resource grants', () => {
  const g = new Game('hard');
  advance(g, 240);
  const t = g.teams[1];
  assert.ok(g.aiWave >= 1, 'AI launched at least one wave');
  assert.ok(t.stats.trained > 8, 'AI trains units');
  assert.ok(t.stats.built >= 2, 'AI builds tech/infrastructure');
  assert.ok(t.stats.gathered > 500, 'AI pays for its economy through harvesting');
  assert.ok(t.minerals >= 0 && t.gas >= 0);
  const spentUnits = g.own(1).filter(e => !D[e.type].building).length;
  assert.ok(spentUnits > 8 || t.stats.lost > 0);
});

test('in a prolonged match the AI fields advanced units and researches upgrades', { timeout: 120000 }, () => {
  const g = new Game('normal');
  // Keep one target alive so this test observes late-game planning, not the early victory condition.
  g.own(0, 'hq')[0].hp = 10000000;
  advance(g, 480);
  assert.ok(g.own(1, 'tank').length > 0, 'AI must save for armored units');
  assert.ok(g.own(1, 'wraith').length > 0, 'AI must save for aircraft');
  assert.ok(g.own(1, 'lancer').length > 0, 'AI must field specialists');
  assert.ok(Object.values(g.teams[1].up).reduce((a, b) => a + b, 0) >= 1, 'AI must complete research');
  assert.ok(g.aiWave >= 2);
});

test('an unattended full match reaches defeat against the computer', { timeout: 120000 }, () => {
  const g = new Game('normal');
  advance(g, 1000);
  assert.equal(g.result, 'defeat', 'The AI must be able to finish a real match');
  assert.ok(g.time > 120);
  assert.ok(g.teams[1].stats.kills > 3);
});
