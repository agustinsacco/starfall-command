'use strict';
/* Original procedural models. No imported sprites, textures, or remote assets.
 * Faceted geometry is lit in model space and rasterized into a bounded high-DPI atlas.
 * Gameplay positions and collision radii remain independent of the artwork. */
(() => {
  const TEAM = [[118, 228, 196], [255, 136, 92]];
  const MAT = { hull: [85, 107, 119], edge: [157, 169, 163], dark: [27, 40, 48], rubber: [29, 33, 34], plate: [118, 130, 126], glass: [42, 109, 132], concrete: [67, 75, 72], white: [189, 198, 180], gold: [177, 146, 78], rust: [109, 80, 55] };
  const cache = new Map(), LIMIT = 384;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = (v, k = 1, a = 1) => `rgba(${v.map(n => Math.round(clamp(n * k, 0, 255))).join(',')},${a})`;
  const hash = (x, y = 0) => { let n = Math.imul(x ^ Math.imul(y, 374761393), 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
  const random = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  function polygon(c, p) { c.beginPath(); p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); }
  function ellipse(c, x, y, rx, ry, fill) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); }
  const rotate = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
  const project = ([x, y, z]) => [x, y * .74 - z * .9];
  function normal(p) { const a = p[1].map((v, i) => v - p[0][i]), b = p[2].map((v, i) => v - p[0][i]); let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; const len = Math.hypot(...n) || 1; return n.map(v => v / len); }
  class Model {
    constructor(angle = 0) { this.faces = []; this.angle = angle; }
    face(points, material, detail = false, glow = false) {
      const p = points.map(v => rotate(v, this.angle)), n = normal(p);
      // Camera looks from above/south. Cull back-facing surfaces, not top faces.
      if (n[1] * .65 + n[2] * .76 < -.08) return;
      this.faces.push({ p, n, material, detail, glow, depth: p.reduce((s, v) => s + v[1] + v[2] * .7, 0) / p.length });
    }
    prism(outline, z, h, material = MAT.hull, detail = false, bevel = 1) {
      const center = outline.reduce((s, p) => [s[0] + p[0] / outline.length, s[1] + p[1] / outline.length], [0, 0]);
      const inner = outline.map(([x, y]) => { const len = Math.hypot(x - center[0], y - center[1]) || 1; return [x - (x - center[0]) / len * bevel, y - (y - center[1]) / len * bevel]; });
      for (let i = 0; i < outline.length; i++) { const j = (i + 1) % outline.length, a = outline[i], b = outline[j], ai = inner[i], bi = inner[j];
        this.face([[...a, z], [...b, z], [...b, z + h - bevel], [...a, z + h - bevel]], material, detail);
        if (bevel) this.face([[...a, z + h - bevel], [...b, z + h - bevel], [...bi, z + h], [...ai, z + h]], material.map(n => n * 1.12));
      }
      this.face(inner.map(p => [...p, z + h]), material, detail);
    }
    box(x, y, z, w, d, h, mat = MAT.hull, detail = false, bevel = 1) { this.prism([[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]], z, h, mat, detail, bevel); }
    cylinder(x, y, z, r, h, mat = MAT.hull, sides = 12, bevel = 1) { const p = Array.from({ length: sides }, (_, i) => [x + Math.cos(i / sides * Math.PI * 2) * r, y + Math.sin(i / sides * Math.PI * 2) * r]); this.prism(p, z, h, mat, false, bevel); }
    lamp(x, y, z, w, d, color) { this.face([[x - w / 2, y - d / 2, z], [x + w / 2, y - d / 2, z], [x + w / 2, y + d / 2, z], [x - w / 2, y + d / 2, z]], color, false, true); }
    beam(a, b, radius, mat) {
      const dir = b.map((v, i) => v - a[i]), len = Math.hypot(...dir) || 1, d = dir.map(v => v / len);
      let side = Math.abs(d[2]) > .9 ? [1, 0, 0] : [-d[1], d[0], 0]; const sl = Math.hypot(...side); side = side.map(v => v / sl * radius);
      const up = [d[1] * side[2] - d[2] * side[1], d[2] * side[0] - d[0] * side[2], d[0] * side[1] - d[1] * side[0]];
      const ring = pos => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, u]) => pos.map((v, i) => v + side[i] * s + up[i] * u));
      const ra = ring(a), rb = ring(b); for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.face([ra[i], ra[j], rb[j], rb[i]], mat); } this.face(rb.reverse(), mat);
    }
    sphere(x, y, z, r, mat, rings = 5, segments = 14) {
      for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) {
        const point = (a, b) => [x + Math.cos(a) * Math.cos(b) * r, y + Math.sin(a) * Math.cos(b) * r, z + Math.sin(b) * r];
        const a = i / segments * Math.PI * 2, b = j / rings * Math.PI / 2, next = (j + 1) / rings * Math.PI / 2;
        this.face([point(a, b), point(a + Math.PI * 2 / segments, b), point(a + Math.PI * 2 / segments, next), point(a, next)], mat);
      }
    }
    render(c) {
      this.faces.sort((a, b) => a.depth - b.depth);
      for (let index = 0; index < this.faces.length; index++) {
        const f = this.faces[index], p = f.p.map(project), light = f.glow ? 1.13 : .52 + .61 * Math.max(0, f.n[0] * -.48 + f.n[1] * -.4 + f.n[2] * .79);
        const xs = p.map(p => p[0]), ys = p.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
        c.save(); polygon(c, p);
        const gradient = c.createLinearGradient(x - 4, y - 4, x + w + 6, y + h + 8);
        gradient.addColorStop(0, rgb(f.material, light * 1.13)); gradient.addColorStop(.52, rgb(f.material, light)); gradient.addColorStop(1, rgb(f.material, light * .77));
        if (f.glow) { c.shadowBlur = 5; c.shadowColor = rgb(f.material); }
        c.fillStyle = gradient; c.fill(); c.shadowBlur = 0;
        c.lineWidth = .45; c.strokeStyle = f.glow ? rgb(f.material, 1.25, .7) : 'rgba(5,13,19,.5)'; c.stroke();
        if (f.detail && w > 7 && h > 4) {
          c.clip(); c.lineWidth = .4;
          for (let i = 0; i < 12; i++) { const u = hash(index * 51 + i), v = hash(index * 31 + i, 3); c.strokeStyle = i % 3 ? 'rgba(2,12,17,.24)' : 'rgba(216,222,196,.22)'; c.beginPath(); c.moveTo(x + u * w, y + v * h); c.lineTo(x + u * w + 1 + hash(i, index) * 7, y + v * h + .5); c.stroke(); }
          if (f.detail === true && w > 20) { c.strokeStyle = 'rgba(7,16,19,.35)'; c.lineWidth = .65; for (let xx = x + 8; xx < x + w; xx += 12) { c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); } }
          if (f.detail === true) for (const [xx, yy] of [[x + 2, y + 2], [x + w - 2, y + 2], [x + 2, y + h - 2], [x + w - 2, y + h - 2]]) { ellipse(c, xx, yy, .7, .55, '#111f25'); ellipse(c, xx - .2, yy - .25, .4, .3, '#a8b3a2'); }
        }
        c.restore();
      }
    }
  }
  function vents(m, x, y, z, count = 5) { m.box(x, y, z, count * 3 + 3, 10, 1, MAT.dark, false, .2); for (let i = 0; i < count; i++) m.box(x + (i - (count - 1) / 2) * 3, y, z + 1, 1.5, 8, .7, MAT.edge, false, .2); }
  function hazard(m, x, y, z, count = 5) { for (let i = 0; i < count; i++) m.box(x + (i - (count - 1) / 2) * 5, y, z, 4, 4, .5, i % 2 ? MAT.dark : MAT.gold, false, .1); }
  function foundation(m, radius, n = 8) { const p = Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2 + Math.PI / 8) * radius, Math.sin(i / n * Math.PI * 2 + Math.PI / 8) * radius * .9]); m.prism(p, 0, 5, MAT.concrete, true, 2); }
  function structure(type, team, angle = 0) {
    const m = new Model(), color = TEAM[team], R = Starfall.D[type].r;
    foundation(m, R + 7);
    if (type === 'hq') {
      m.cylinder(0, 0, 5, 49, 15, MAT.hull, 8, 3); m.box(0, -4, 20, 72, 61, 13, MAT.plate, true, 3);
      for (const x of [-42, 42]) { m.box(x, 1, 5, 19, 48, 17, MAT.edge, true, 3); vents(m, x, -6, 23, 3); m.lamp(x, 18, 23, 11, 4, color); }
      m.box(0, -5, 33, 52, 43, 8, MAT.dark, true, 3); m.box(0, -6, 41, 44, 35, 5, MAT.edge, false, 2);
      m.prism([[-18, -21], [18, -21], [19, 9], [-19, 9]], 46, 2, MAT.glass, false, .7);
      for (let i = -1; i <= 1; i++) m.box(i * 10, -6, 48, .9, 28, .8, MAT.edge, false, .1);
      m.lamp(0, -6, 49, 6, 9, color); m.box(0, 43, 3, 43, 24, 4, MAT.plate, true, .5); hazard(m, 0, 53, 8, 8);
      m.box(0, 29, 11, 28, 3, 16, MAT.dark, true); for (const x of [-13, 13]) m.lamp(x, 30, 28, 2, 3, color);
      for (const x of [-29, 29]) { m.cylinder(x, -26, 34, 3, 24, MAT.edge, 6, .5); m.beam([x, -26, 57], [x + 5, -26, 76], .7, MAT.edge); m.lamp(x + 5, -26, 77, 2, 2, color); }
      m.box(-22, 14, 35, 11, 7, 5, MAT.hull, true); vents(m, 22, 12, 34, 3);
    } else if (type === 'relay') {
      m.box(0, 0, 5, 30, 27, 12, MAT.hull, true, 2); m.cylinder(0, 0, 17, 10, 25, MAT.plate, 8, 1);
      for (let z = 23; z < 40; z += 6) m.lamp(0, 8, z, 9, 3, color);
      for (const side of [-1, 1]) { m.beam([0, 0, 22], [side * 27, 0, 14], 1.4, MAT.edge); m.box(side * 24, 0, 14, 17, 31, 1.5, MAT.dark, false, .3); for (let x = -1; x <= 1; x++) for (let y = -2; y <= 2; y++) m.box(side * 24 + x * 4.5, y * 5, 15.5, 4, 4.5, .4, [53, 83, 108], false, .1); }
      m.beam([0, 0, 42], [0, 0, 71], .7, MAT.edge); m.beam([-12, 0, 62], [12, 0, 62], .7, MAT.edge); m.beam([-8, 0, 54], [8, 0, 54], .6, MAT.edge); m.lamp(0, 0, 72, 2, 2, color);
    } else if (type === 'barracks') {
      m.box(0, -3, 5, 80, 56, 18, MAT.hull, true, 3); m.box(0, -8, 23, 76, 43, 11, MAT.plate, true, 3);
      for (let i = -1; i <= 1; i++) { m.box(i * 24, 25, 5, 21, 7, 16, MAT.dark, true); m.box(i * 24, 31, 4, 20, 13, 2, MAT.edge, true, .4); m.lamp(i * 24, 26, 22, 14, 2, color); hazard(m, i * 24, 36, 7, 4); }
      for (let i = -2; i <= 2; i++) m.box(i * 14, -8, 34, 3, 40, 2, MAT.edge, false, .4);
      vents(m, -22, -9, 37, 3); vents(m, 22, -9, 37, 3); m.box(-41, -10, 4, 8, 27, 17, MAT.dark, true); m.cylinder(37, -25, 6, 5, 30, MAT.edge, 8); m.lamp(0, -8, 37, 6, 12, color);
    } else if (type === 'refinery') {
      m.box(0, 0, 5, 63, 49, 8, MAT.hull, true, 2);
      for (const x of [-18, 18]) { m.cylinder(x, -3, 13, 13, 29, MAT.plate, 16, 2); m.cylinder(x, -3, 20, 13.7, 2, MAT.dark, 16, .4); m.cylinder(x, -3, 37, 13.7, 2, MAT.edge, 16, .4); m.cylinder(x, -3, 42, 7, 3, MAT.dark, 12, 1); m.lamp(x, -3, 46, 8, 5, color); m.beam([x, 10, 15], [x, 27, 9], 2.2, MAT.gold); }
      m.box(0, 20, 7, 22, 19, 15, MAT.hull, true, 2); vents(m, 0, 20, 22, 4);
      for (const x of [-6, 6]) { m.cylinder(x, -23, 8, 3.5, 43, MAT.edge, 10); m.cylinder(x, -23, 51, 5, 2, MAT.dark, 10); }
    } else if (type === 'factory') {
      m.box(0, 0, 5, 87, 65, 18, MAT.hull, true, 3); m.box(-11, -5, 23, 57, 47, 16, MAT.plate, true, 3);
      m.box(-7, 29, 5, 46, 5, 24, MAT.dark, true); m.box(-7, 35, 5, 45, 15, 2, MAT.edge, true); hazard(m, -7, 41, 8, 8); m.lamp(-7, 30, 28, 32, 3, [255, 173, 86]);
      for (const y of [-20, 5]) { m.cylinder(29, y, 23, 6, 40, MAT.plate, 10, 1); m.cylinder(29, y, 62, 8, 3, MAT.dark, 10); m.lamp(29, y, 65, 5, 6, [243, 153, 80]); }
      for (const x of [-32, 13]) { m.box(x, -10, 39, 4, 5, 20, MAT.gold, false, .5); m.beam([x, -10, 43], [x, 20, 54], 1, MAT.edge); }
      m.box(-10, -10, 57, 54, 6, 4, MAT.gold, true, .7); m.beam([-5, -10, 57], [-5, -10, 43], .5, MAT.dark); vents(m, -10, 10, 40, 7); m.lamp(-32, 25, 24, 5, 5, color);
    } else if (type === 'airfield') {
      m.cylinder(0, 0, 5, 48, 3, MAT.hull, 8, 1); m.cylinder(0, 0, 8, 34, 1, MAT.dark, 32, .2);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; m.box(Math.cos(a) * 34, Math.sin(a) * 34, 9, 4, 4, .5, MAT.white, false, .1); }
      m.box(-8, 0, 10, 3, 22, .5, MAT.white, false, .1); m.box(8, 0, 10, 3, 22, .5, MAT.white, false, .1); m.box(0, 0, 10, 16, 3, .5, MAT.white, false, .1);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; m.lamp(Math.cos(a) * 46, Math.sin(a) * 46, 9, 3, 3, color); }
      m.box(35, -28, 5, 21, 20, 40, MAT.hull, true, 2); m.box(35, -28, 45, 26, 25, 6, MAT.edge, true); m.box(35, -27, 51, 21, 19, 7, MAT.glass, false, 1); m.box(35, -28, 58, 28, 25, 2, MAT.edge); m.beam([35, -28, 61], [35, -28, 78], .7, MAT.edge); m.lamp(35, -28, 79, 2, 2, color);
    } else if (type === 'lab') {
      m.cylinder(0, 0, 5, 29, 13, MAT.hull, 12, 2); m.cylinder(0, 0, 18, 27, 4, MAT.edge, 16, 1);
      m.sphere(0, 0, 22, 23, [61, 137, 148], 6, 20);
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; let last = [Math.cos(a) * 23, Math.sin(a) * 23, 22]; for (let j = 1; j <= 6; j++) { const b = j / 6 * Math.PI / 2, p = [Math.cos(a) * Math.cos(b) * 23.5, Math.sin(a) * Math.cos(b) * 23.5, 22 + Math.sin(b) * 23.5]; m.beam(last, p, .6, MAT.edge); last = p; } }
      for (const x of [-28, 28]) { m.box(x, 5, 5, 12, 33, 11, MAT.plate, true); vents(m, x, 5, 16, 3); }
      m.lamp(0, 0, 46, 4, 4, color); m.box(0, 26, 6, 24, 13, 8, MAT.dark, true); m.lamp(0, 29, 15, 15, 2, color);
    } else if (type === 'turret') {
      m.cylinder(0, 0, 5, 18, 9, MAT.hull, 8, 2); m.cylinder(0, 0, 14, 11, 13, MAT.edge, 12, 1);
      const base = m.angle; m.angle = angle; m.box(0, 0, 25, 22, 18, 9, MAT.hull, true, 2);
      for (const y of [-5, 5]) { m.box(20, y, 28, 35, 3, 4, MAT.edge, true, .4); m.box(36, y, 27, 5, 5, 6, MAT.dark, false, .5); }
      m.lamp(-4, 0, 35, 7, 9, color); m.angle = base;
    }
    return m;
  }
  function soldier(type, team, angle, phase, siege = false) {
    const m = new Model(angle), color = TEAM[team], walk = [0, 3, 0, -3][phase], bright = type === 'mender' ? MAT.white : type === 'lancer' ? [104, 115, 104] : MAT.hull;
    if (type === 'drone') {
      for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) { const off = (i % 2 ? -1 : 1) * walk * side, a = [i * 7, side * 5, 8], b = [i * 10 + off, side * 11, 9], foot = [i * 10 + 3 + off, side * 17, 1.5]; m.beam(a, b, 1.3, MAT.edge); m.beam(b, foot, 1, MAT.hull); m.box(foot[0], foot[1], 0, 5, 4, 2, MAT.dark, false, .5); m.cylinder(b[0], b[1], 8, 2, 3, MAT.gold, 8, .2); }
      m.box(-1, 0, 7, 22, 17, 7, MAT.hull, true, 2); m.box(-2, 0, 14, 13, 14, 3, MAT.plate, true, 1); hazard(m, -2, 0, 18, 3); vents(m, -6, 0, 19, 2);
      m.box(10, 0, 9, 9, 12, 6, MAT.edge, true); m.lamp(12, 0, 16, 4, 7, color); for (const y of [-5, 5]) { m.beam([12, y, 10], [21, y * 1.4, 5], 1.1, MAT.gold); m.box(22, y * 1.4, 3, 7, 2, 3, MAT.edge, false, .3); }
    } else if (type === 'tank') {
      for (const y of [-15, 15]) { m.box(-1, y, 0, 47, 9, 9, MAT.rubber, true, 2); for (let i = -4; i <= 4; i++) { m.box(i * 5 + (phase % 2), y, 8, 3.5, 9.5, 1.5, MAT.edge, false, .2); }
        for (let i = -3; i <= 3; i++) { const points = Array.from({ length: 10 }, (_, j) => [i * 6 + Math.cos(j / 10 * Math.PI * 2) * 3, y + 4.6, 4.5 + Math.sin(j / 10 * Math.PI * 2) * 3]); m.face(points, MAT.hull); }
      }
      m.box(0, 0, 7, 41, 23, 8, MAT.hull, true, 3); m.cylinder(-2, 0, 15, 12, 7, MAT.plate, 8, 1); m.box(1, 0, 22, 21, 17, 5, MAT.hull, true, 2); m.box(siege ? 26 : 22, 0, 22, siege ? 39 : 31, 4, 4, MAT.edge, true, .5); m.box(siege ? 45 : 36, 0, 21, 6, 6, 6, MAT.dark, false, .7); vents(m, -13, 0, 17, 3); m.lamp(-4, 0, 28, 7, 7, color);
      for (const y of [-9, 9]) m.lamp(16, y, 16, 5, 3, color);
      if (siege) for (const x of [-1, 1]) for (const y of [-1, 1]) { m.beam([x * 13, y * 10, 13], [x * 26, y * 25, 2], 2, MAT.gold); m.box(x * 26, y * 25, 0, 9, 7, 2, MAT.dark, true, .5); }
    } else if (type === 'wraith') {
      m.prism([[34, 0], [-17, 8], [-28, 4], [-28, -4], [-17, -8]], 7, 7, MAT.hull, true, 1.5);
      for (const side of [-1, 1]) {
        let wing = [[21, side * 3], [-16, side * 29], [-29, side * 26], [-17, side * 11], [-21, side * 5]]; if (side < 0) wing.reverse(); m.prism(wing, 7, 2, MAT.edge, true, .5);
        m.box(-16, side * 15, 6, 26, 7, 7, MAT.dark, true, 2); m.box(-18, side * 15, 13, 18, 6, 2, MAT.hull, true, .8); m.lamp(-29, side * 15, 11, 3, 5, [116, 217, 249]); m.box(-3, side * 14, 3, 14, 2, 3, MAT.white, false, .7); m.lamp(-21, side * 25, 10, 3, 2, color);
      }
      m.prism([[20, 0], [3, 5], [-10, 4], [-10, -4], [3, -5]], 14, 5, MAT.glass, false, 1.5); m.lamp(5, 0, 20, 9, 1.5, color); m.beam([-23, 0, 13], [-28, 0, 24], 1, MAT.edge);
    } else {
      for (const side of [-1, 1]) { const x = walk * side, hip = [-2, side * 3.7, 12], knee = [x + 1, side * 4.7, 6], foot = [x, side * 5, 1.5]; m.beam(hip, knee, 2.2, bright); m.beam(knee, foot, 1.7, MAT.dark); m.box(x + 1, side * 5, 0, 8, 4.5, 3, bright, true, .8); m.box(-1, side * 8, 18, 9, 5, 5, bright, true, 1.5); m.beam([1, side * 8, 18], [8, side * 6, 14], 1.8, bright); }
      m.box(-1, 0, 11, 10, 11, 10, bright, true, 2); m.box(-7, 0, 12, 4, 9, 11, MAT.dark, true, .6); m.cylinder(0, 0, 21, 2.5, 2, MAT.dark, 8, .2); m.box(1, 0, 23, 9, 9, 6, bright, true, 2);
      m.lamp(3.5, 0, 29, 3, 6, color); m.box(6, 0, 25, 1, 7, 2, MAT.glass, false, .2);
      m.box(10, 5, 14, type === 'lancer' ? 16 : 12, 3, 4, MAT.dark, true, .5); m.box(type === 'lancer' ? 23 : 18, 5, 15, type === 'lancer' ? 15 : 7, 1.5, 2, MAT.edge, false, .2); m.box(9, 5, 19, 4, 2, 2, MAT.glass, false, .3);
      if (type === 'mender') { m.box(-1, 0, 21, 6, 2, .7, [186, 77, 67], false, .1); m.box(-1, 0, 21, 2, 6, .7, [186, 77, 67], false, .1); m.cylinder(-8, -4, 11, 2.5, 11, MAT.white, 8, .3); m.lamp(-8, -4, 23, 3, 3, color); }
      if (type === 'lancer') { m.box(-4, -8, 14, 11, 2, 9, [75, 84, 69], true, .5); m.beam([-5, -7, 23], [-7, -7, 33], .4, MAT.edge); }
    }
    return m;
  }
  function cached(key, render, size = 240) {
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
    const image = document.createElement('canvas'); image.width = size * 2; image.height = size * 2;
    const c = image.getContext('2d'); c.scale(2, 2); c.translate(size / 2, size * .64); render(c);
    const value = { image, size }; cache.set(key, value); if (cache.size > LIMIT) cache.delete(cache.keys().next().value); return value;
  }
  function sprite(c, entry, x, y) { c.drawImage(entry.image, x - entry.size / 2, y - entry.size * .64, entry.size, entry.size); }
  function shadow(c, x, y, r, height = 10) {
    c.save(); c.translate(x + height * .35, y + height * .22); const g = c.createRadialGradient(0, 0, r * .1, 0, 0, r * 1.25); g.addColorStop(0, '#02080bd9'); g.addColorStop(.6, '#02080b75'); g.addColorStop(1, '#02080b00'); c.scale(1, .62); c.fillStyle = g; c.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8); c.restore();
  }
  function glow(c, x, y, r, color, alpha = .3) { c.save(); const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgb(color, 1, alpha)); g.addColorStop(1, rgb(color, 1, 0)); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore(); }
  function smoke(c, x, y, t, scale = 1, color = [111, 127, 131], seed = 1) {
    for (let i = 0; i < 5; i++) { const p = (t * .23 + i * .2 + hash(seed) * .3) % 1, r = (4 + p * 13) * scale; glow(c, x + p * 21 * scale + Math.sin(p * 5 + i) * 3, y - p * 44 * scale, r, color, (1 - p) * .16); }
  }
  function building(c, e, t, ghost = false) {
    const d = Starfall.D[e.type], bin = e.type === 'turret' ? Math.round((e.angle || 0) * 24 / Math.PI) : 0;
    const entry = cached(`b/${e.type}/${e.team}/${bin}`, c => structure(e.type, e.team, bin * Math.PI / 24).render(c));
    if (!ghost) shadow(c, e.x, e.y + 8, d.r + 6, 38);
    c.save(); if (!e.complete && !ghost) c.globalAlpha = .27 + .73 * e.progress; sprite(c, entry, e.x, e.y); c.restore();
    if (e.complete && !ghost) {
      const color = TEAM[e.team]; glow(c, e.x, e.y - (e.type === 'hq' ? 43 : 22), 20, color, .06 + .025 * Math.sin(t * 2));
      if (e.type === 'refinery') smoke(c, e.x - 4, e.y - 64, t, .8, [137, 177, 156], e.id);
      if (e.type === 'factory') { smoke(c, e.x + 29, e.y - 71, t, 1, [127, 123, 109], e.id); smoke(c, e.x + 29, e.y - 52, t + 2, .7, [127, 123, 109], e.id); }
      if (e.hp < d.hp * .55) { smoke(c, e.x - 13, e.y - 18, t * 1.2, 1.25, [62, 65, 64], e.id); glow(c, e.x - 12, e.y - 17, 12, [255, 150, 65], .2 + .08 * Math.sin(t * 17)); }
      if (e.queue?.length) { c.save(); c.strokeStyle = rgb(color, 1, .42); c.lineWidth = 1; c.setLineDash([3, 7]); c.beginPath(); c.ellipse(e.x, e.y + 4, d.r + 7, (d.r + 7) * .72, 0, t * .3, t * .3 + Math.PI * 2 * e.queue[0].progress); c.stroke(); c.restore(); }
    }
    if (!e.complete && !ghost) { c.save(); c.strokeStyle = rgb(TEAM[e.team], 1, .6); c.lineWidth = .7; c.setLineDash([3, 4]); c.strokeRect(e.x - d.r, e.y - d.r - 28, d.r * 2, d.r * 1.5 + 30); c.setLineDash([]); const scan = (t * .3) % 1; c.fillStyle = rgb(TEAM[e.team], 1, .1); c.fillRect(e.x - d.r, e.y - d.r - 28 + scan * d.r * 1.5, d.r * 2, 2); c.restore(); }
  }
  function unit(c, e, t) {
    const d = Starfall.D[e.type], bin = Math.round(e.angle * 24 / Math.PI), phase = e.path?.length ? Math.floor(t * 9) % 4 : 0;
    const entry = cached(`u/${e.type}/${e.team}/${bin}/${phase}/${!!e.siege}`, c => soldier(e.type, e.team, bin * Math.PI / 24, phase, e.siege).render(c), 116);
    const fly = d.flying ? 14 + Math.sin(t * 2.5 + e.id) * 2 : 0;
    shadow(c, e.x, e.y + 3, d.r * 1.25, fly + 9); sprite(c, entry, e.x, e.y - fly);
    if (e.type === 'wraith') for (const y of [-15, 15]) { const p = project(rotate([-30, y, 10], e.angle)); glow(c, e.x + p[0], e.y - fly + p[1], 9 + Math.sin(t * 30) * 1.5, [95, 188, 255], .5); }
    if (e.cargo) { const p = project(rotate([-8, 0, 19], e.angle)); glow(c, e.x + p[0], e.y + p[1], 7, e.cargoType === 'gas' ? [120, 228, 144] : [117, 215, 242], .45); }
    if (e.hit > 0) glow(c, e.x, e.y - fly - 8, d.r * 1.7, [255, 191, 114], .45);
  }
  function resource(c, r, t) {
    if (r.amount <= 0) return;
    if (r.type === 'gas') {
      shadow(c, r.x, r.y, 30, 0); const g = c.createRadialGradient(r.x, r.y, 3, r.x, r.y, 31); g.addColorStop(0, '#091b12'); g.addColorStop(.5, '#18362a'); g.addColorStop(.68, '#567062'); g.addColorStop(.8, '#202f29'); g.addColorStop(1, '#202d2600'); ellipse(c, r.x, r.y, 34, 24, g); glow(c, r.x, r.y - 3, 24, [93, 212, 132], .16); smoke(c, r.x, r.y - 3, t, .8, [119, 203, 137], r.id); return;
    }
    const entry = cached('r/' + r.id % 8, c => {
      const m = new Model(), rand = random(r.id % 8 + 887);
      for (let i = 0; i < 6; i++) {
        const x = (rand() - .5) * 28, y = (rand() - .5) * 20, h = 15 + rand() * 24, radius = 4 + rand() * 4, ring = Array.from({ length: 5 }, (_, k) => [x + Math.cos(k / 5 * Math.PI * 2) * radius, y + Math.sin(k / 5 * Math.PI * 2) * radius]);
        m.prism(ring, 1, h * .65, [61 + rand() * 30, 154 + rand() * 35, 183 + rand() * 20], false, .3);
        for (let k = 0; k < 5; k++) { const j = (k + 1) % 5; m.face([[...ring[k], h * .65], [...ring[j], h * .65], [x + 1, y - 1, h]], [122, 211, 228]); }
      }
      m.render(c);
    }, 100);
    shadow(c, r.x, r.y + 4, 23, 18); glow(c, r.x, r.y + 1, 29, [73, 168, 203], .14); sprite(c, entry, r.x, r.y);
    const spark = (t * .23 + r.id * .13) % 1; if (spark < .13) glow(c, r.x - 6, r.y - 29, 4, [182, 239, 252], (1 - spark / .13) * .7);
  }
  function noise(x, y, seed) { const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy, u = dx * dx * (3 - 2 * dx), v = dy * dy * (3 - 2 * dy); return (hash(ix + seed, iy) * (1 - u) + hash(ix + 1 + seed, iy) * u) * (1 - v) + (hash(ix + seed, iy + 1) * (1 - u) + hash(ix + 1 + seed, iy + 1) * u) * v; }
  function terrain(c, game) {
    const { W, H } = Starfall, seed = game.mapSeed || 7481, rand = random(seed);
    const texture = document.createElement('canvas'); texture.width = W / 3; texture.height = Math.ceil(H / 3); const tc = texture.getContext('2d'), pixels = tc.createImageData(texture.width, texture.height);
    for (let y = 0; y < texture.height; y++) for (let x = 0; x < texture.width; x++) {
      let n = noise(x / 65, y / 65, seed) * .47 + noise(x / 19, y / 19, seed + 7) * .28 + noise(x / 5, y / 5, seed + 19) * .17 + hash(x + seed, y) * .08;
      const slope = noise((x - 1) / 5, (y - 1) / 5, seed + 19) - noise((x + 1) / 5, (y + 1) / 5, seed + 19), value = 32 + n * 20 + slope * 8, i = (y * texture.width + x) * 4;
      pixels.data[i] = value * .91; pixels.data[i + 1] = value * .99; pixels.data[i + 2] = value * .97; pixels.data[i + 3] = 255;
    }
    tc.putImageData(pixels, 0, 0); c.drawImage(texture, 0, 0, W, H);
    for (let i = 0; i < 33000; i++) { const x = rand() * W, y = rand() * H, n = rand(); c.fillStyle = n < .5 ? '#06120e26' : '#b2ad8b16'; c.fillRect(x, y, n < .8 ? 1 : 2, 1); }
    c.lineCap = 'round';
    for (const [x, y, xx, yy] of [[440, 1280, 2220, 450], [440, 1280, 1140, 1450], [2220, 450, 1550, 300]]) {
      for (let j = 0; j < 4; j++) { c.strokeStyle = j % 2 ? '#131e1c18' : '#93887509'; c.lineWidth = 95 - j * 20; c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.stroke(); }
      c.save(); c.strokeStyle = '#111b1833'; c.lineWidth = 2.5; c.setLineDash([3, 4]); for (const d of [-19, 19]) { c.beginPath(); c.moveTo(x + d, y + d); c.lineTo(xx + d, yy + d); c.stroke(); } c.restore();
    }
    for (let i = 0; i < 950; i++) {
      const x = rand() * W, y = rand() * H, r = 2 + rand() * 8; if (game.resources.some(n => Math.hypot(n.x - x, n.y - y) < 70)) continue;
      shadow(c, x, y, r, r / 2); const p = [[x - r, y], [x - r * .45, y - r * .7], [x + r * .4, y - r], [x + r, y - r * .2], [x + r * .5, y + r * .5]];
      polygon(c, p); c.fillStyle = '#4b5148'; c.fill(); polygon(c, [p[1], p[2], p[3], [x, y]]); c.fillStyle = '#687064'; c.fill();
    }
    for (const [cx, cy] of [[440, 1280], [2220, 450], [1150, 1450], [1560, 300]]) {
      c.save(); c.translate(cx, cy); c.strokeStyle = '#a5a38b35'; c.lineWidth = 2; c.setLineDash([15, 12]); c.beginPath(); c.ellipse(0, 0, 144, 112, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#b0ac8639'; c.font = '10px monospace'; c.textAlign = 'center'; c.fillText('VANGUARD / LZ-' + Math.floor(cx / 100), 0, 139);
      for (const x of [-95, 95]) for (const y of [-69, 69]) { c.strokeStyle = '#a9ab8740'; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x, y + 6); c.moveTo(x - 6, y); c.lineTo(x + 6, y); c.stroke(); } c.restore();
    }
    for (const rock of game.rocks) {
      const m = new Model(), rand = random(Math.floor(rock.x * 11 + rock.y + seed)), rings = [], count = 15;
      for (let j = 0; j < 5; j++) { const ring = []; for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2, r = rock.r * (1.02 - j * .085) * (.87 + rand() * .18); ring.push([Math.cos(a) * r, Math.sin(a) * r, j * 11 + (j ? rand() * 7 : 0)]); } rings.push(ring); }
      for (let j = 0; j < 4; j++) for (let i = 0; i < count; i++) { const k = (i + 1) % count; m.face([rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]], j % 2 ? [83, 88, 78] : [68, 75, 67], 'rock'); }
      const top = [0, 0, 60]; for (let i = 0; i < count; i++) m.face([rings[4][i], rings[4][(i + 1) % count], top], [96, 100, 85], 'rock');
      shadow(c, rock.x + 17, rock.y + 15, rock.r * 1.12, 45); c.save(); c.translate(rock.x, rock.y); m.render(c); c.restore();
    }
  }
  function effect(c, f) {
    const p = 1 - f.life / f.max;
    if (f.type === 'blast') {
      glow(c, f.x, f.y - 6, f.r * (1 + p), [255, 128, 52], (1 - p) * .56);
      for (let i = 0; i < 12; i++) { const a = hash(i, Math.floor(f.x)) * Math.PI * 2, dist = f.r * p * (hash(i, Math.floor(f.y)) + .3), x = f.x + Math.cos(a) * dist, y = f.y + Math.sin(a) * dist * .65 - Math.sin(p * Math.PI) * 20; glow(c, x, y, (3 + p * 10) * (f.r / 30), i % 3 ? [239, 159, 83] : [106, 107, 92], (1 - p) * .7); }
      c.save(); c.strokeStyle = `rgba(219,189,137,${(1 - p) * .4})`; c.lineWidth = 1; c.beginPath(); c.ellipse(f.x, f.y, f.r * (p + .25), f.r * (p + .25) * .65, 0, 0, Math.PI * 2); c.stroke(); c.restore();
    } else if (f.type === 'shell') {
      const x = f.x + (f.tx - f.x) * p, y = f.y + (f.ty - f.y) * p - Math.sin(p * Math.PI) * 35 - 14;
      glow(c, x, y, 11, [255, 187, 97], .8); ellipse(c, x, y, 2.7, 1.7, '#fff1c9'); glow(c, f.x, f.y - 15, 20, [255, 176, 88], (1 - p) * .55);
    } else {
      const color = f.type === 'heal' ? [109, 236, 177] : f.type === 'mine' ? [106, 220, 242] : [255, 211, 137];
      c.save(); c.globalAlpha = 1 - p; c.strokeStyle = rgb(color, 1, .85); c.shadowColor = rgb(color); c.shadowBlur = 5; c.lineWidth = f.type === 'heal' ? 1.3 : .8; c.beginPath(); c.moveTo(f.x, f.y - 14); c.lineTo(f.tx, f.ty - 10); c.stroke(); c.restore();
      glow(c, f.type === 'mine' ? f.tx : f.x, (f.type === 'mine' ? f.ty : f.y) - 13, 9, color, (1 - p) * .65);
    }
  }
  function ambient(c, camera, width, height, time) {
    const bounds = [camera.x - width / camera.z / 2, camera.y - height / camera.z / 2];
    for (let i = 0; i < 19; i++) { const x = bounds[0] + (hash(i, 73) * width / camera.z + time * (3 + i % 4)) % (width / camera.z), y = bounds[1] + hash(i, 17) * height / camera.z + Math.sin(time * .2 + i) * 9; ellipse(c, x, y, .7, .4, '#d5cfab22'); }
  }
  globalThis.StarfallArt = { building, unit, resource, terrain, effect, ambient, get cacheSize() { return cache.size; }, clearCache() { cache.clear(); },
    thumbnail(type, team = 0, size = 256) { const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const c = canvas.getContext('2d'), d = Starfall.D[type], span = d.building ? 155 : ['tank','wraith'].includes(type) ? 96 : 80; c.translate(size / 2, size * .68); c.scale(size / span, size / span); shadow(c,0,3,d.r*1.25,d.building?25:10); (d.building?structure(type,team):soldier(type,team,-.55,0)).render(c); return canvas; } };
})();
