import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
let count = 0;
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(js|cjs|mjs)$/.test(file)) { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); count++; }
  }
}
for (const dir of ['src', 'electron', 'scripts', 'tests']) await walk(path.join(root, dir));
const html = await fs.readFile('index.html', 'utf8');
if (!/<meta charset="utf-8">/.test(html)) throw Error('The desktop document must declare UTF-8');
if (!html.includes("script-src 'self'") || /<script(?![^>]*src=)/.test(html)) throw Error('Scripts must be local files with a strict CSP');
for (const [, file] of html.matchAll(/(?:src|href)="((?:src|assets)\/[^"]+)"/g)) await fs.access(file);
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')), lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw Error('Lockfile version mismatch');
console.log(`${count} JavaScript files parse; all page assets exist; UTF-8, CSP and lockfile checks pass.`);
