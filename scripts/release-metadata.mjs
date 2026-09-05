import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { metadata } from './release-contract.mjs';
const info = await metadata();
await mkdir('release', { recursive: true });
await writeFile('release/release-info.json', JSON.stringify(info, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${info.version}\nsha=${info.sha}\n`);
console.log(JSON.stringify(info));
