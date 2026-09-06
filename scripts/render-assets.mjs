import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launchNative } from '../tests/native-driver.mjs';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'starfall-art-studio-'));
const output = new URL('../assets/generated/', import.meta.url);
await fs.mkdir(output, { recursive: true });
let driver;
try {
  driver = await launchNative(profile);
  const assets = await driver.evaluate(`(()=>{
    const output={};
    for(const type of Object.keys(Starfall.D))output[type]=StarfallArt.thumbnail(type,0,384).toDataURL('image/png');
    const c=document.createElement('canvas');c.width=1600;c.height=1050;const g=c.getContext('2d');
    const bg=g.createLinearGradient(0,0,1600,1050);bg.addColorStop(0,'#15282c');bg.addColorStop(1,'#081317');g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);
    g.fillStyle='#a6dec0';g.font='12px monospace';g.fillText('VANGUARD / PROCEDURAL COMPONENT LIBRARY',55,48);
    g.font='500 43px system-ui';g.fillStyle='#e0ebe5';g.fillText('Built for the frontier.',55,108);
    g.font='14px system-ui';g.fillStyle='#91a59d';g.fillText('Original shaded geometry · material surfaces · animated units · no imported game assets',55,142);
    const types=['drone','ranger','lancer','mender','tank','wraith','hq','relay','barracks','refinery','factory','lab','airfield','turret'];
    for(let i=0;i<types.length;i++){
      const type=types[i],d=Starfall.D[type],col=i%7,row=Math.floor(i/7),x=40+col*218,y=190+row*400;
      g.fillStyle='#132326';g.fillRect(x,y,207,371);g.strokeStyle='#2d4544';g.strokeRect(x+.5,y+.5,206,370);
      const image=StarfallArt.thumbnail(type,0,384);g.drawImage(image,x+5,y+20,197,197);
      g.fillStyle='#badfc8';g.font='11px monospace';g.fillText(String(i+1).padStart(2,'0')+' / '+(d.building?'STRUCTURE':'UNIT'),x+15,y+260);
      g.fillStyle='#e5ede6';g.font='500 19px system-ui';g.fillText(d.name,x+15,y+296);
      g.fillStyle='#8ba69b';g.font='11px monospace';g.fillText(d.hp+' HP  /  '+d.m+' MINERALS',x+15,y+324);
    }
    g.fillStyle='#80988e';g.font='12px monospace';g.fillText('STARFALL COMMAND / DESKTOP EDITION 2.0',55,1030);output.roster=c.toDataURL('image/png');
    const icon=document.createElement('canvas');icon.width=1024;icon.height=1024;const q=icon.getContext('2d');
    q.beginPath();q.roundRect(38,38,948,948,210);const gradient=q.createLinearGradient(0,0,1024,1024);gradient.addColorStop(0,'#274c47');gradient.addColorStop(1,'#081b22');q.fillStyle=gradient;q.fill();
    q.strokeStyle='#80c9a2';q.lineWidth=8;q.beginPath();q.moveTo(512,150);q.lineTo(804,325);q.lineTo(804,697);q.lineTo(512,874);q.lineTo(220,697);q.lineTo(220,325);q.closePath();q.stroke();
    q.shadowColor='#82deb1';q.shadowBlur=18;q.fillStyle='#b9e9c6';q.beginPath();q.moveTo(512,258);q.lineTo(684,670);q.lineTo(512,559);q.lineTo(340,670);q.closePath();q.fill();q.shadowBlur=0;q.strokeStyle='#9acdac';q.lineWidth=9;q.beginPath();q.moveTo(512,644);q.lineTo(512,766);q.stroke();output['app-icon']=icon.toDataURL('image/png');
    return output;
  })()`);
  for (const [name, url] of Object.entries(assets)) {
    const bytes = Buffer.from(url.split(',')[1], 'base64');
    if (bytes.length < 500 || bytes.readUInt32BE(0) !== 0x89504e47) throw Error('Asset rendering failed: ' + name);
    await fs.writeFile(new URL(name + '.png', output), bytes);
  }
  await fs.writeFile(
    new URL('manifest.json', output),
    JSON.stringify(
      { generator: 'scripts/render-assets.mjs', version: 2, assets: Object.keys(assets), geometrySource: 'src/art.js' },
      null,
      2,
    ) + '\n',
  );
  console.log(`Generated ${Object.keys(assets).length} PNG assets in assets/generated/ from the actual game renderer.`);
  if (driver.errors.length) throw Error(driver.errors.join('\n'));
} finally {
  if (driver) await driver.stop();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
