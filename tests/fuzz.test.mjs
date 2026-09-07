import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Game } = require('../src/simulation.js');

// Deterministic mutation fuzz over the save parser: every accepted payload must stay
// playable, and every rejected payload must fail with a thrown Error — never a crash,
// hang, or half-loaded game. The seed is fixed so CI failures reproduce locally.
const ITERATIONS = 300;
const SEED = 0xc0ffee;

let lcg = SEED;
const rand = () => {
  lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
  return lcg / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const JUNK = [null, true, false, -3, 0.5, 1e18, -1e18, '', 'junk', 'x'.repeat(64), [], {}, [[]], { a: 1 }, [0, 1]];

function paths(value, base = []) {
  const out = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 40); i++) {
      out.push([...base, i]);
      out.push(...paths(value[i], [...base, i]));
    }
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      out.push([...base, k]);
      out.push(...paths(value[k], [...base, k]));
    }
  }
  return out;
}

function mutate(root) {
  const all = paths(root);
  const path = pick(all);
  let parent = root;
  for (const key of path.slice(0, -1)) parent = parent[key];
  const key = path[path.length - 1];
  const op = rand();
  if (op < 0.25) delete parent[key];
  else if (op < 0.75) parent[key] = structuredClone(pick(JUNK));
  else if (Array.isArray(parent[key])) parent[key] = parent[key].slice(0, Math.floor(rand() * parent[key].length));
  else if (typeof parent[key] === 'number') parent[key] = parent[key] * -1000 - 1;
  else parent[key] = 42;
  return path.join('.');
}

function corpus() {
  const fresh = new Game();
  const mid = new Game('hard', 1234);
  for (let i = 0; i < 400; i++) mid.update(0.05);
  const army = mid.own(0).filter((e) => e.type === 'ranger');
  mid.order(
    army.map((e) => e.id),
    'attackmove',
    2200,
    450,
  );
  for (let i = 0; i < 100; i++) mid.update(0.05);
  return [JSON.parse(fresh.save()), JSON.parse(mid.save())];
}

test('mutated saves either throw or load into a playable, re-saveable game', () => {
  const base = corpus();
  let rejected = 0,
    accepted = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const p = structuredClone(base[i % base.length]);
    const where = mutate(p);
    const context = `iteration ${i} (seed ${SEED}) mutated ${where}`;
    let loaded;
    try {
      loaded = Game.load(JSON.stringify(p));
    } catch (err) {
      assert.ok(err instanceof Error, `${context}: rejection must be a thrown Error`);
      rejected++;
      continue;
    }
    try {
      for (let t = 0; t < 10; t++) loaded.update(0.05);
      Game.load(loaded.save());
    } catch (err) {
      throw new Error(`${context}: accepted payload broke the game: ${err.message}`, { cause: err });
    }
    accepted++;
  }
  // The validator should reject most structural damage, but some mutations are benign
  // (e.g. shortening the events list). Both counters prove the fuzz exercised both paths.
  assert.ok(rejected > ITERATIONS / 2, `expected mostly rejections, got ${rejected}`);
  assert.ok(accepted > 0, 'expected at least one benign mutation to load');
});
