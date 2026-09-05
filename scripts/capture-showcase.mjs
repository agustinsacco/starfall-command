import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launchNative, sleep } from '../tests/native-driver.mjs';

// Marketing scenes use the shipped simulation/renderer, staged only to show the available units.
// No player profiles or saved operations are read. All scenario saves are temporary.
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'starfall-showcase-'));
const output = new URL('../docs/screenshots/', import.meta.url);
await fs.mkdir(output, { recursive: true });
let driver;
async function screenshot(name) {
  await sleep(400);
  const shot = await driver.call('Page.captureScreenshot', { format: 'jpeg', quality: 91 });
  await fs.writeFile(new URL(name + '.jpg', output), Buffer.from(shot.data, 'base64'));
}
async function loadView(camera, selection) {
  await driver.evaluate(`(async()=>{const snapshot=starfallApp.captureState();snapshot.view.camera=${JSON.stringify(camera)};snapshot.view.selection=${JSON.stringify(selection)};snapshot.view.mode=null;const current=starfallApp.operation;await starfallDesktop.saves.write({id:current.id,name:current.name,snapshot});await starfallApp.showLibrary();})()`);
  const id = await driver.evaluate('starfallApp.operation.id');
  await driver.wait(`!!document.querySelector('[data-save-id="${id}"]')`, 'showcase operation card');
  await driver.click(`[data-save-id="${id}"] [data-action="load"]`);
  await driver.wait('document.querySelector("#modal").hidden === false && !!document.querySelector("#resume-btn")', 'loaded operation pause menu');
  await driver.wait('document.querySelectorAll("#messages .message").length === 0', 'transient notices dismissed', 6500);
  await driver.click('#resume-btn');
}
try {
  driver = await launchNative(profile);
  await driver.call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await driver.evaluate('document.querySelector("#operation-name").value="Iron Dawn"');
  await driver.click('[data-diff="hard"]'); await driver.click('#deploy-btn');
  await driver.wait('starfallApp.operation?.name === "Iron Dawn" && !starfallApp.paused', 'showcase deployment');
  const ids = await driver.evaluate(`(()=>{
    const g=starfallApp.game;g.time=496;g.aiClock=10000;g.nextAttack=10000;
    g.teams[0].minerals=1280;g.teams[0].gas=445;g.teams[0].up={weapons:2,armor:1,mobility:1};
    const extractor=g.add('refinery',0,690,1380);extractor.vent=g.resources.find(r=>r.type==='gas'&&r.x===690).id;
    const factory=g.add('factory',0,775,1150);g.add('lab',0,870,1330);g.add('airfield',0,1030,1445);
    for(const [x,y] of [[480,1510],[680,1540],[860,1530],[1090,1300]])g.add('relay',0,x,y);
    g.add('turret',0,935,1180);g.add('turret',0,585,1010);
    for(let i=0;i<6;i++){const d=g.add('drone',0,355+i*18,1350);d.order={type:'gather',target:g.nearestResource(d,'mineral').id};}
    for(const worker of g.own(0,'drone').slice(-3))worker.order={type:'gather',target:extractor.vent};
    for(let i=0;i<8;i++)g.add('ranger',0,1035+(i%4)*30,1175+Math.floor(i/4)*35);
    for(let i=0;i<3;i++)g.add('lancer',0,1010+i*28,1260);
    for(let i=0;i<2;i++)g.add('mender',0,985+i*35,1230);
    const tanks=[];for(let i=0;i<3;i++)tanks.push(g.add('tank',0,895+i*55,1080).id);
    for(let i=0;i<3;i++)g.add('wraith',0,1110+i*50,1345);
    g.rebuildGrid(true);g.updateVision();g.train(factory.id,'tank');
    return {factory:factory.id,tanks};
  })()`);
  await loadView({ x: 710, y: 1275, z: 1.12 }, [ids.factory]);
  await screenshot('forward-base');
  await driver.evaluate(`(()=>{
    const g=starfallApp.game;
    for(const [i,t] of g.own(0,'tank').entries()){t.x=1100+i*45;t.y=1100+i*30;t.siege=true;t.order={type:'hold'};}
    for(const [i,r] of g.own(0,'ranger').entries()){r.x=1190+(i%4)*24;r.y=1175+Math.floor(i/4)*24;}
    for(const [i,u] of g.own(0,'lancer').entries()){u.x=1120+i*28;u.y=1255;}
    for(const [i,u] of g.own(0,'mender').entries()){u.x=1100+i*25;u.y=1215;}
    for(const [i,u] of g.own(0,'wraith').entries()){u.x=1270+i*43;u.y=1320;}
    for(let i=0;i<14;i++)g.add('ranger',1,1365+(i%5)*26,1150+Math.floor(i/5)*32);
    for(let i=0;i<3;i++)g.add('tank',1,1460+i*40,1030+i*42);
    for(let i=0;i<3;i++)g.add('wraith',1,1460+i*42,1260+i*24);
    g.updateVision();
    g.order(g.own(1).filter(e=>!Starfall.D[e.type].building&&e.type!=='drone').map(e=>e.id),'attackmove',1130,1190);
    g.order(g.own(0).filter(e=>['ranger','lancer','wraith'].includes(e.type)).map(e=>e.id),'attackmove',1390,1190);
  })()`);
  await loadView({ x: 1240, y: 1145, z: 1.35 }, ids.tanks);
  await sleep(950); await screenshot('combined-arms');
  await driver.evaluate(`(async()=>{
    await starfallApp.saveGame();
    for(const [name,difficulty,time] of [['Basin Defense','normal',212]]){
      const game=new Starfall.Game(difficulty,7481);game.time=time;
      const snapshot=starfallApp.captureState();snapshot.simulation=game.save();snapshot.view.selection=[game.own(0,'hq')[0].id];snapshot.view.groups={};
      await starfallDesktop.saves.write({id:crypto.randomUUID(),name,snapshot});
    }
    await starfallApp.showLibrary();
  })()`);
  await driver.wait('document.querySelectorAll(".save-card").length === 2', 'independent operation cards');
  await driver.wait('document.querySelectorAll("#messages .message").length === 0', 'library notices dismissed', 6500);
  await screenshot('operation-library');
  if (driver.errors.length) throw Error(driver.errors.join('\n'));
  console.log('Captured three real-renderer showcase images in docs/screenshots/. Combat scenarios are staged.');
} finally {
  if (driver) await driver.stop();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
