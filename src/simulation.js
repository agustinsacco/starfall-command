'use strict';
(() => {
const W=2688,H=1792,TILE=32,COLS=W/TILE,ROWS=H/TILE;
const D={
 drone:{name:'Drone',role:'Worker · construction & harvesting',icon:'⛏',hp:65,r:10,speed:76,damage:5,range:31,rate:1.2,sight:205,m:50,g:0,supply:1,time:9,producer:'hq'},
 ranger:{name:'Ranger',role:'Infantry · all-purpose rifle squad',icon:'⌖',hp:100,r:10,speed:68,damage:11,range:135,rate:.85,sight:225,m:60,g:0,supply:1,time:11,producer:'barracks'},
 lancer:{name:'Lancer',role:'Specialist · long-range precision',icon:'⟐',hp:80,r:10,speed:61,damage:34,range:220,rate:2,sight:275,m:100,g:45,supply:2,time:17,producer:'barracks',req:'lab'},
 mender:{name:'Mender',role:'Support · automatically heals allies',icon:'✚',hp:85,r:10,speed:71,damage:0,range:115,rate:.7,sight:215,m:70,g:40,supply:1,time:14,producer:'barracks',req:'lab'},
 tank:{name:'Bastion',role:'Armor · toggle siege for artillery',icon:'▰',hp:340,r:18,speed:44,damage:42,range:180,rate:1.8,sight:270,m:165,g:85,supply:3,time:23,producer:'factory',armor:3},
 wraith:{name:'Wraith',role:'Aircraft · flies over obstacles',icon:'⋏',hp:180,r:16,speed:110,damage:22,range:155,rate:.8,sight:310,m:145,g:100,supply:3,time:23,producer:'airfield',flying:true},
 hq:{name:'Command Spire',role:'Economy · drone production & drop-off',icon:'⬡',hp:1800,r:58,m:350,g:0,time:44,building:true,cap:12,sight:310,trains:['drone']},
 relay:{name:'Supply Relay',role:'Infrastructure · provides 10 supply',icon:'◈',hp:420,r:29,m:90,g:0,time:15,building:true,cap:10,sight:190,req:'hq'},
 refinery:{name:'Extractor',role:'Economy · build on a gas vent',icon:'♧',hp:620,r:34,m:95,g:0,time:18,building:true,sight:180,req:'hq'},
 barracks:{name:'Infantry Bay',role:'Production · infantry & specialists',icon:'▤',hp:950,r:43,m:150,g:0,time:24,building:true,sight:230,req:'hq',trains:['ranger','lancer','mender']},
 factory:{name:'Foundry',role:'Production · Bastion armor',icon:'▰',hp:1100,r:47,m:200,g:90,time:31,building:true,sight:230,req:'barracks',trains:['tank']},
 airfield:{name:'Flight Deck',role:'Production · Wraith aircraft',icon:'⋏',hp:1000,r:48,m:210,g:120,time:32,building:true,sight:260,req:'factory',trains:['wraith']},
 lab:{name:'Research Lab',role:'Technology · upgrades & specialist units',icon:'⚛',hp:720,r:36,m:140,g:65,time:24,building:true,sight:215,req:'barracks'},
 turret:{name:'Sentry',role:'Defense · anti-ground & anti-air',icon:'⊹',hp:650,r:25,m:125,g:25,time:19,building:true,sight:280,damage:23,range:235,rate:.85,req:'barracks',armor:2}
};
const UP={weapons:{name:'Weapons',icon:'⌖',desc:'+3 attack damage per level.',m:120,g:80},armor:{name:'Plating',icon:'⬡',desc:'Reduce incoming damage by 1 per level.',m:100,g:85},mobility:{name:'Servos',icon:'»',desc:'+12% movement speed per level.',m:100,g:65}};
const AI={
 easy:{think:3.6,workers:9,stageEvery:60,firstWave:280,wave:190,waveMin:8,armyCap:16,upEvery:340},
 normal:{think:2.4,workers:12,stageEvery:34,firstWave:200,wave:135,waveMin:7,armyCap:40,upEvery:230},
 hard:{think:1.4,workers:16,stageEvery:20,firstWave:125,wave:80,waveMin:7,armyCap:200,upEvery:170}
};
const tuning=d=>AI[d]||AI.normal;
const DIST=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
class Game{
 constructor(difficulty='normal',seed=7481){
  this.version=2;this.mapSeed=seed>>>0;this.seed=seed>>>0;this.difficulty=difficulty;this.time=0;this.nextId=1;this.entities=[];this.resources=[];this.rocks=[];this.effects=[];this.events=[];this.result=null;this.grid=new Uint8Array(COLS*ROWS);this.visible=[new Uint8Array(COLS*ROWS),new Uint8Array(COLS*ROWS)];this.explored=[new Uint8Array(COLS*ROWS),new Uint8Array(COLS*ROWS)];this.visionClock=0;this.aiClock=0;this.aiWave=0;this.nextAttack=tuning(difficulty).firstWave;this.aiStage=0;
  this.teams=[0,1].map(()=>({minerals:400,gas:0,up:{weapons:0,armor:0,mobility:0},stats:{kills:0,lost:0,gathered:0,built:0,trained:0}}));
  const clusters=[[220,1190],[2415,540],[1140,1450],[1550,300],[1310,1040]];
  for(const [cx,cy] of clusters)for(let i=0;i<6;i++){let a=i*1.02;this.resources.push({id:this.nextId++,type:'mineral',x:cx+Math.cos(a)*60,y:cy+Math.sin(a)*62,r:14,amount:1450});}
  for(const [x,y] of [[690,1380],[1990,370],[1020,1510],[1670,290]])this.resources.push({id:this.nextId++,type:'gas',x,y,r:29,amount:3000});
  for(const [x,y,r] of [[760,970,110],[920,830,73],[1250,620,115],[1440,640,77],[1800,1220,118],[1630,1260,68],[470,420,130],[520,530,70],[2170,1390,145],[2320,1250,70],[1000,280,82],[1520,1610,69]])this.rocks.push({x,y,r});
  const starts=[[440,1280],[2220,450]];
  starts.forEach(([x,y],team)=>{
   const h=this.add('hq',team,x,y);h.rally={x:x+(team?-125:125),y:y+(team?110:-110)};
   this.add('relay',team,x+(team?-105:105),y+(team?-80:90));
   this.add('barracks',team,x+(team?-150:155),y+(team?100:-115));
   for(let i=0;i<6;i++){let u=this.add('drone',team,x+(team?85:-85)+(i%3)*23,y+Math.floor(i/3)*23);u.order={type:'gather',target:this.nearestResource(u,'mineral').id};}
   for(let i=0;i<2;i++)this.add('ranger',team,x+(team?-170:190)+i*25,y+(team?170:-190));
  });
  this.rebuildGrid();this.updateVision();
 }
 rand(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 add(type,team,x,y,complete=true){const d=D[type];if(!d)throw Error('Unknown entity type');const e={id:this.nextId++,type,team,x,y,hp:complete?d.hp:d.hp*.1,complete,progress:complete?1:0,order:{type:'idle'},queue:[],path:[],pathGoal:null,cool:0,mine:0,cargo:0,cargoType:'mineral',angle:team?2.6:-.6,siege:false,rally:null};this.entities.push(e);return e;}
 entity(id){return this.entities.find(e=>e.id===id&&e.hp>0);}
 resource(id){return this.resources.find(e=>e.id===id);}
 own(team,type,complete=false){return this.entities.filter(e=>e.team===team&&e.hp>0&&(!type||e.type===type)&&(!complete||e.complete));}
 supply(team){let used=0,cap=0;for(const e of this.own(team)){const d=D[e.type];used+=d.supply||0;if(e.complete)cap+=d.cap||0;for(const q of e.queue)if(q.kind==='unit')used+=D[q.type].supply;}return{used,cap:Math.min(200,cap)};}
 canPay(team,m,g=0){return this.teams[team].minerals>=m&&this.teams[team].gas>=g;}
 pay(team,m,g=0){if(!this.canPay(team,m,g))return false;this.teams[team].minerals-=m;this.teams[team].gas-=g;return true;}
 emit(text,team=0,warn=false){if(team===0)this.events.push({text,warn,time:this.time});if(this.events.length>15)this.events.shift();}
 available(type,team){let d=D[type];return !d.req||this.own(team,d.req,true).length>0;}
 train(id,type){const b=this.entity(id),d=D[type];if(!b||!d||!b.complete||!D[b.type].trains?.includes(type))return false;let reason='';const s=this.supply(b.team);if(!this.available(type,b.team))reason='Requires '+D[d.req].name;else if(b.queue.length>=5)reason='Production queue full';else if(s.used+d.supply>s.cap)reason='Supply limit reached — build a Supply Relay';else if(!this.canPay(b.team,d.m,d.g))reason='Not enough '+(this.teams[b.team].minerals<d.m?'minerals':'aether gas');if(reason){this.emit(reason,b.team,true);return false;}this.pay(b.team,d.m,d.g);b.queue.push({kind:'unit',type,progress:0,time:d.time,m:d.m,g:d.g});return true;}
 research(id,key){const b=this.entity(id),up=UP[key];if(!b||b.type!=='lab'||!b.complete||!up)return false;const t=this.teams[b.team],level=t.up[key];if(level>=3){this.emit('Maximum research level reached',b.team,true);return false;}if(this.own(b.team).some(e=>e.queue.some(q=>q.kind==='research'&&q.type===key))){this.emit('Upgrade already in progress',b.team,true);return false;}if(b.queue.length>=5)return false;const m=up.m*(level+1),g=up.g*(level+1);if(!this.pay(b.team,m,g)){this.emit('Insufficient resources for research',b.team,true);return false;}b.queue.push({kind:'research',type:key,progress:0,time:30+level*12,m,g});return true;}
 cancelQueue(id,index){const b=this.entity(id);if(!b||index<0||index>=b.queue.length)return false;const [q]=b.queue.splice(index,1);this.teams[b.team].minerals+=q.m;this.teams[b.team].gas+=q.g;return true;}
 nearestResource(u,type){return this.resources.filter(r=>r.type===type&&r.amount>0&&(type!=='gas'||this.own(u.team,'refinery',true).some(b=>b.vent===r.id))).sort((a,b)=>DIST(u,a)-DIST(u,b))[0];}
 placement(type,x,y,team){const d=D[type];if(!d?.building)return{ok:false,reason:'Invalid structure'};let vent=null;if(type==='refinery'){vent=this.resources.find(r=>r.type==='gas'&&r.amount>0&&Math.hypot(r.x-x,r.y-y)<65);if(!vent)return{ok:false,reason:'Place an Extractor on a gas vent'};x=vent.x;y=vent.y;}
  if(x<d.r+25||y<d.r+25||x>W-d.r-25||y>H-d.r-25)return{ok:false,reason:'Too close to map edge'};
  const cell=Math.floor(y/TILE)*COLS+Math.floor(x/TILE);if(!this.visible[team][cell])return{ok:false,reason:'Explore this location first'};
  if(this.rocks.some(r=>Math.hypot(r.x-x,r.y-y)<r.r+d.r+15))return{ok:false,reason:'Terrain is obstructed'};
  if(this.entities.some(e=>e.hp>0&&D[e.type].building&&Math.hypot(e.x-x,e.y-y)<D[e.type].r+d.r+24))return{ok:false,reason:'Structure is too close'};
  if(this.resources.some(r=>r.amount>0&&r!==vent&&Math.hypot(r.x-x,r.y-y)<r.r+d.r+24))return{ok:false,reason:'Resource field is obstructed'};
  return{ok:true,x,y,vent};
 }
 build(workerId,type,x,y){const u=this.entity(workerId),d=D[type];if(!u||u.type!=='drone'||!d?.building)return false;if(!this.available(type,u.team)){this.emit('Requires '+D[d.req].name,u.team,true);return false;}const p=this.placement(type,x,y,u.team);if(!p.ok){this.emit(p.reason,u.team,true);return false;}if(!this.pay(u.team,d.m,d.g)){this.emit('Not enough resources for '+d.name,u.team,true);return false;}const b=this.add(type,u.team,p.x,p.y,false);if(p.vent)b.vent=p.vent.id;u.order={type:'build',target:b.id};u.path=[];u.pathGoal=null;this.rebuildGrid();return b;}
 cancelBuild(id){const e=this.entity(id);if(!e||e.complete||!D[e.type].building)return false;this.teams[e.team].minerals+=Math.floor(D[e.type].m*.75);this.teams[e.team].gas+=Math.floor(D[e.type].g*.75);e.hp=0;this.entities=this.entities.filter(x=>x.id!==id);this.rebuildGrid();return true;}
 // Returns the strongest order kind actually issued so the UI can acknowledge the command; null means nothing was ordered.
 order(ids,type,x,y,target=null){let units=ids.map(id=>this.entity(id)).filter(Boolean);const cols=Math.ceil(Math.sqrt(units.length));let i=0;const rank={attack:6,gather:5,repair:4,build:4,attackmove:3,move:2,rally:1};let ack=null;const note=k=>{if(rank[k]&&(!ack||rank[k]>rank[ack]))ack=k;};for(const u of units){const d=D[u.type];if(d.building){if(['move','attackmove','context'].includes(type)){u.rally={x:clamp(x,20,W-20),y:clamp(y,20,H-20)};note('rally');}continue;}if(type==='siege'){if(u.type==='tank'){u.siege=!u.siege;u.path=[];u.order={type:'hold'};}continue;}let next=type,tx=x,ty=y,t=target?this.entity(target)||this.resource(target):null;if(type==='context'){if(t?.amount!==undefined&&u.type==='drone'){if(t.type==='gas'&&!this.own(u.team,'refinery',true).some(b=>b.vent===t.id)){this.emit('Build an Extractor on this vent first',u.team,true);continue;}next='gather';}else if(t?.team!==undefined&&t.team!==u.team)next='attack';else if(t?.team===u.team&&D[t.type].building&&u.type==='drone'){if(t.type==='refinery'&&t.complete){next='gather';target=t.vent;}else next=t.complete?'repair':'build';}else next='move';}
   if(next==='attack'&&(!t||!this.isVisible(t,u.team)))continue;
   if(['move','attackmove'].includes(next)){u.siege=false;tx=clamp(x+(i%cols-(cols-1)/2)*25,16,W-16);ty=clamp(y+(Math.floor(i/cols)-(Math.ceil(units.length/cols)-1)/2)*25,16,H-16);i++;}
   u.order={type:next,x:tx,y:ty,target:target||undefined};u.path=[];u.pathGoal=null;note(next);
  }
  return ack;
 }
 rebuildGrid(preservePaths=false){this.grid.fill(0);const block=(x,y,r)=>{for(let gy=Math.max(0,Math.floor((y-r-20)/TILE));gy<=Math.min(ROWS-1,Math.ceil((y+r+20)/TILE));gy++)for(let gx=Math.max(0,Math.floor((x-r-20)/TILE));gx<=Math.min(COLS-1,Math.ceil((x+r+20)/TILE));gx++)if(Math.hypot((gx+.5)*TILE-x,(gy+.5)*TILE-y)<r+12)this.grid[gy*COLS+gx]=1;};for(const r of this.rocks)block(r.x,r.y,r.r);for(const e of this.entities)if(e.hp>0&&D[e.type].building)block(e.x,e.y,D[e.type].r);if(!preservePaths)for(const e of this.entities){e.path=[];e.pathGoal=null;}}
 freeCell(x,y){let gx=clamp(Math.floor(x/TILE),0,COLS-1),gy=clamp(Math.floor(y/TILE),0,ROWS-1);if(!this.grid[gy*COLS+gx])return gy*COLS+gx;for(let r=1;r<9;r++){let best=-1,dist=Infinity;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;const a=gx+dx,b=gy+dy;if(a<0||b<0||a>=COLS||b>=ROWS||this.grid[b*COLS+a])continue;let dd=Math.hypot((a+.5)*TILE-x,(b+.5)*TILE-y);if(dd<dist){best=b*COLS+a;dist=dd;}}if(best>=0)return best;}return-1;}
 pathfind(u,x,y){if(D[u.type].flying)return[{x,y}];const start=this.freeCell(u.x,u.y),goal=this.freeCell(x,y);if(start<0||goal<0)return[];if(start===goal)return this.grid[Math.floor(y/TILE)*COLS+Math.floor(x/TILE)]?[]:[{x,y}];const heap=[],cost=new Float32Array(COLS*ROWS).fill(Infinity),parent=new Int32Array(COLS*ROWS).fill(-1),closed=new Uint8Array(COLS*ROWS);const gx=goal%COLS,gy=Math.floor(goal/COLS);const h=n=>Math.hypot(n%COLS-gx,Math.floor(n/COLS)-gy);const push=(n,f)=>{let a={n,f},i=heap.length;heap.push(a);while(i>0){let p=(i-1)>>1;if(heap[p].f<=f)break;heap[i]=heap[p];i=p;}heap[i]=a;};const pop=()=>{let root=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(last.f<=heap[j].f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return root.n;};cost[start]=0;push(start,h(start));let found=false;
  for(let tries=0;heap.length&&tries<6000;tries++){const cur=pop();if(closed[cur])continue;closed[cur]=1;if(cur===goal){found=true;break;}const cx=cur%COLS,cy=Math.floor(cur/COLS);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy,n=ny*COLS+nx;if(nx<0||ny<0||nx>=COLS||ny>=ROWS||this.grid[n]||closed[n])continue;if(dx&&dy&&(this.grid[cy*COLS+nx]||this.grid[ny*COLS+cx]))continue;const c=cost[cur]+(dx&&dy?1.414:1);if(c>=cost[n])continue;cost[n]=c;parent[n]=cur;push(n,c+h(n));}}
  if(!found)return[];let path=[],n=goal;while(n!==start&&n>=0){path.push({x:(n%COLS+.5)*TILE,y:(Math.floor(n/COLS)+.5)*TILE});n=parent[n];}path.reverse();if(!this.grid[Math.floor(y/TILE)*COLS+Math.floor(x/TILE)])path.push({x,y});return path;
 }
 move(u,x,y,dt,stop=5){const dist=Math.hypot(u.x-x,u.y-y);if(dist<=stop)return true;if(u.siege)return false;const key=Math.floor(x/32)+','+Math.floor(y/32);if(u.pathGoal!==key){u.path=this.pathfind(u,x,y);u.pathGoal=key;}if(!u.path.length)return dist<stop+TILE;const p=u.path[0],dx=p.x-u.x,dy=p.y-u.y,len=Math.hypot(dx,dy),speed=D[u.type].speed*(1+this.teams[u.team].up.mobility*.12),step=Math.min(speed*dt,len);if(len){u.x+=dx/len*step;u.y+=dy/len*step;u.angle=Math.atan2(dy,dx);}if(len<speed*dt+2)u.path.shift();return false;}
 updateVision(){for(let team=0;team<2;team++){const v=this.visible[team];v.fill(0);for(const e of this.own(team)){const r=D[e.type].sight*(e.complete?1:.6);for(let y=Math.max(0,Math.floor((e.y-r)/TILE));y<=Math.min(ROWS-1,Math.floor((e.y+r)/TILE));y++)for(let x=Math.max(0,Math.floor((e.x-r)/TILE));x<=Math.min(COLS-1,Math.floor((e.x+r)/TILE));x++)if(Math.hypot((x+.5)*TILE-e.x,(y+.5)*TILE-e.y)<r)v[y*COLS+x]=1;}for(let i=0;i<v.length;i++)if(v[i])this.explored[team][i]=1;}}
 isVisible(e,team=0){return e.team===team||!!this.visible[team][clamp(Math.floor(e.y/TILE),0,ROWS-1)*COLS+clamp(Math.floor(e.x/TILE),0,COLS-1)];}
 damage(target,amount,attacker){if(target.hp<=0)return;const armor=(D[target.type].armor||0)+this.teams[target.team].up.armor;target.hp-=Math.max(1,amount-armor);target.hit=.15;if(target.hp<=0){target.hp=0;this.teams[attacker.team].stats.kills++;this.teams[target.team].stats.lost++;this.effects.push({type:'blast',x:target.x,y:target.y,r:D[target.type].r*1.8,life:.65,max:.65});if(D[target.type].building)this.emit(D[target.type].name+' destroyed',target.team,true);}else if(target.team===0&&D[target.type].building&&(this.lastAlert===undefined||this.time-this.lastAlert>12)){this.lastAlert=this.time;this.emit('Base under attack — defend your structures!',0,true);}}
 fire(u,t){const d=D[u.type];u.angle=Math.atan2(t.y-u.y,t.x-u.x);u.cool=u.siege?3:d.rate;let amount=(u.siege?72:d.damage)+this.teams[u.team].up.weapons*3;this.effects.push({type:u.type==='tank'?'shell':'shot',x:u.x,y:u.y,tx:t.x,ty:t.y,team:u.team,life:u.type==='tank'?.28:.13,max:u.type==='tank'?.28:.13});this.damage(t,amount,u);if(u.type==='tank')for(const other of this.entities)if(other.id!==t.id&&other.team!==u.team&&other.hp>0&&!D[other.type].flying&&DIST(other,t)<(u.siege?62:38))this.damage(other,amount*.4,u);}
 combat(u,dt){const d=D[u.type];if(u.type==='mender'){if(u.order.type==='move')return false;const target=this.own(u.team).filter(e=>e.id!==u.id&&!D[e.type].building&&e.hp<D[e.type].hp&&DIST(u,e)<d.range).sort((a,b)=>a.hp/D[a.type].hp-b.hp/D[b.type].hp)[0];if(target){if(u.cool<=0){target.hp=Math.min(D[target.type].hp,target.hp+15);u.cool=.7;this.effects.push({type:'heal',x:u.x,y:u.y,tx:target.x,ty:target.y,life:.25,max:.25});}return true;}return false;}
  if(!d.damage||!u.complete||['move','gather','build','repair'].includes(u.order.type))return false;
  const range=u.siege?340:d.range;let target=u.order.type==='attack'?this.entity(u.order.target):null;if(target&&(!this.isVisible(target,u.team)||(u.type==='tank'&&D[target.type].flying)))target=null;
  if(!target){let best=Infinity;for(const e of this.entities){if(e.team===u.team||e.hp<=0||!this.isVisible(e,u.team)||(u.type==='tank'&&D[e.type].flying))continue;let dist=DIST(u,e)-D[e.type].r;const reach=u.order.type==='hold'||d.building||u.siege?range:range+60;if(dist<reach){let score=dist+(D[e.type].building?60:0);if(score<best){best=score;target=e;}}}}
  if(!target)return false;let distance=DIST(u,target)-D[target.type].r;if(distance<=range){if(u.cool<=0)this.fire(u,target);return true;}if(!d.building&&u.order.type!=='hold'&&!u.siege){this.move(u,target.x,target.y,dt,range+D[target.type].r-5);return true;}return false;
 }
 worker(u,dt){const o=u.order;if(o.type==='build'||o.type==='repair'){const b=this.entity(o.target);if(!b||b.team!==u.team){u.order={type:'idle'};return;}if(this.move(u,b.x,b.y,dt,D[b.type].r+uRadius(u)+18)){if(!b.complete){const delta=dt/D[b.type].time;b.progress=Math.min(1,b.progress+delta);b.hp=Math.min(D[b.type].hp,b.hp+D[b.type].hp*.9*delta);if(b.progress>=1){b.complete=true;this.teams[b.team].stats.built++;this.emit(D[b.type].name+' online',b.team);u.order={type:'idle'};if(b.type==='refinery')u.order={type:'gather',target:b.vent};}}else if(b.hp<D[b.type].hp){const n=Math.min(dt*22,D[b.type].hp-b.hp,this.teams[u.team].minerals*4);b.hp+=n;this.teams[u.team].minerals-=n/4;if(n===0)this.emit('Repair paused — insufficient minerals',u.team,true);}else u.order={type:'idle'};}return;}
  if(o.type!=='gather')return;let r=this.resource(o.target);if((!r||r.amount<=0)&&!u.cargo){r=this.nearestResource(u,r?.type||'mineral');if(r){o.target=r.id;u.pathGoal=null;}else{u.order={type:'idle'};return;}}
  if(u.cargo>=10||u.cargo>0&&(!r||r.amount<=0||r.type!==u.cargoType)){const deposits=this.own(u.team,u.cargoType==='gas'?'refinery':'hq',true);const b=deposits.sort((a,b)=>DIST(u,a)-DIST(u,b))[0];if(!b){u.order={type:'idle'};return;}if(this.move(u,b.x,b.y,dt,D[b.type].r+18)){const t=this.teams[u.team];t[u.cargoType==='gas'?'gas':'minerals']+=u.cargo;t.stats.gathered+=u.cargo;u.cargo=0;u.pathGoal=null;}return;}
  if(r.type==='gas'&&!this.own(u.team,'refinery',true).some(b=>b.vent===r.id)){u.order={type:'idle'};return;}if(this.move(u,r.x,r.y,dt,r.type==='gas'?D.refinery.r+20:28)){u.mine+=dt;if(u.mine>=.8){u.mine=0;const n=Math.min(5,r.amount);r.amount-=n;u.cargo+=n;u.cargoType=r.type;this.effects.push({type:'mine',x:u.x,y:u.y,tx:r.x,ty:r.y,life:.14,max:.14});}}else u.mine=0;
 }
 update(dt){if(this.result)return;dt=clamp(dt,0,.2);this.time+=dt;this.visionClock-=dt;if(this.visionClock<=0){this.updateVision();this.visionClock=.25;}
  for(const e of this.entities){if(e.hp<=0)continue;e.cool-=dt;e.hit=Math.max(0,(e.hit||0)-dt);const d=D[e.type];if(d.building){if(!e.complete)continue;if(e.queue.length){let q=e.queue[0];q.progress+=dt/q.time;if(q.progress>=1){e.queue.shift();if(q.kind==='research'){this.teams[e.team].up[q.type]++;this.emit(UP[q.type].name+' upgrade complete',e.team);}else{let cell=this.freeCell(e.x+(e.team?-1:1)*(d.r+42),e.y+30);const u=this.add(q.type,e.team,cell<0?e.x+90:(cell%COLS+.5)*TILE,cell<0?e.y+90:(Math.floor(cell/COLS)+.5)*TILE);this.teams[e.team].stats.trained++;if(q.type==='drone'){const r=this.nearestResource(u,'mineral');if(r)u.order={type:'gather',target:r.id};}else if(e.rally)u.order={type:'attackmove',x:e.rally.x,y:e.rally.y};this.emit(D[q.type].name+' ready',e.team);}}}this.combat(e,dt);continue;}
   if(e.type==='drone'&&['gather','build','repair'].includes(e.order.type)){this.worker(e,dt);continue;}if(this.combat(e,dt))continue;const o=e.order;if(o.type==='move'||o.type==='attackmove'){if(this.move(e,o.x,o.y,dt,8))e.order={type:'idle'};}else if(o.type==='attack'){const t=this.entity(o.target);if(!t||!this.isVisible(t,e.team))e.order={type:'idle'};else this.move(e,t.x,t.y,dt,(d.range||30)+D[t.type].r);}
  }
  const units=this.entities.filter(e=>e.hp>0&&!D[e.type].building);for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){const a=units[i],b=units[j];if(!!D[a.type].flying!==!!D[b.type].flying)continue;let dx=a.x-b.x,dy=a.y-b.y,dist=Math.hypot(dx,dy),min=(D[a.type].r+D[b.type].r)*.78;if(dist<min){if(dist<.01){dx=.1;dy=.07;dist=Math.hypot(dx,dy);}const push=Math.min((min-dist)*.3,dt*22);for(const [u,sign]of [[a,1],[b,-1]]){if(u.siege)continue;let x=clamp(u.x+dx/dist*push*sign,8,W-8),y=clamp(u.y+dy/dist*push*sign,8,H-8);if(D[u.type].flying||!this.grid[Math.floor(y/TILE)*COLS+Math.floor(x/TILE)]){u.x=x;u.y=y;}}}}
  const destroyed=this.entities.some(e=>e.hp<=0&&D[e.type].building);this.entities=this.entities.filter(e=>e.hp>0);if(destroyed)this.rebuildGrid();this.effects=this.effects.filter(f=>(f.life-=dt)>0);this.aiClock-=dt;if(this.aiClock<=0){this.aiClock=tuning(this.difficulty).think;this.ai();}
  const buildings=[0,1].map(t=>this.own(t).filter(e=>D[e.type].building).length);if(!buildings[0]||!buildings[1]){this.result=buildings[0]?'victory':'defeat';this.emit(this.result==='victory'?'Opposing command eliminated. Sector secured.':'All command structures lost.',0,this.result==='defeat');}
 }
 ai(){const team=1,t=this.teams[team],hq=this.own(team,'hq',true)[0];if(!hq)return;const cfg=tuning(this.difficulty),workers=this.own(team,'drone'),army=this.own(team).filter(e=>!D[e.type].building&&e.type!=='drone');const gas=this.own(team,'refinery',true)[0];
  for(const u of workers)if(u.order.type==='idle'){const needGas=gas&&workers.filter(x=>x.order.type==='gather'&&this.resource(x.order.target)?.type==='gas').length<3;const r=needGas?this.resource(gas.vent):this.nearestResource(u,'mineral');if(r)u.order={type:'gather',target:r.id};}
  if(workers.length+hq.queue.length<cfg.workers&&hq.queue.length<2)this.train(hq.id,'drone');
  const supply=this.supply(team);let type=null;const has=k=>this.own(team,k).length;const plans=['refinery','lab','factory','barracks','airfield','turret'];if(supply.cap-supply.used<5&&supply.cap<200&&!this.own(team).some(e=>e.type==='relay'&&!e.complete))type='relay';else if(!has('barracks'))type='barracks';else if(this.time>20+this.aiStage*cfg.stageEvery&&this.aiStage<plans.length){const p=plans[this.aiStage];if((p==='barracks'&&has(p)<2)||!has(p))type=p;else this.aiStage++;}
  if(type&&this.available(type,team)&&this.canPay(team,D[type].m,D[type].g)){const worker=workers.find(u=>u.order.type!=='build'&&u.order.type!=='repair'&&this.resource(u.order.target)?.type!=='gas');if(worker){let p=null;if(type==='refinery'){const vents=this.resources.filter(r=>r.type==='gas').sort((a,b)=>DIST(a,hq)-DIST(b,hq));for(const r of vents)if(this.placement(type,r.x,r.y,team).ok){p=r;break;}}else{for(let i=0;i<70;i++){const a=this.rand()*Math.PI*2,r=135+this.rand()*195,x=hq.x+Math.cos(a)*r,y=hq.y+Math.sin(a)*r;if(this.placement(type,x,y,team).ok){p={x,y};break;}}}if(p)this.build(worker.id,type,p.x,p.y);}}
  const lab=this.own(team,'lab',true)[0],totalUp=Object.values(t.up).reduce((a,b)=>a+b,0),upgradeDue=lab&&!lab.queue.length&&totalUp<Math.min(9,Math.floor(this.time/cfg.upEvery));
  if(upgradeDue){const key=Object.keys(UP).sort((a,b)=>t.up[a]-t.up[b])[0];this.research(lab.id,key);}else if(army.length+this.own(team).reduce((n,b)=>n+b.queue.filter(q=>q.kind==='unit'&&q.type!=='drone').length,0)<cfg.armyCap){const count=type=>this.own(team,type).length+this.own(team).reduce((n,b)=>n+b.queue.filter(q=>q.kind==='unit'&&q.type===type).length,0);let choice='ranger';for(const [unit,ratio]of [['wraith',10],['tank',6],['mender',9],['lancer',6]])if(this.own(team,D[unit].producer,true).length&&this.available(unit,team)&&count(unit)<Math.ceil(army.length/ratio)){choice=unit;break;}const producer=this.own(team,D[choice].producer,true).filter(b=>b.queue.length<2).sort((a,b)=>a.queue.length-b.queue.length)[0];if(producer)this.train(producer.id,choice);}
  const threats=this.own(0).filter(e=>this.isVisible(e,1)&&DIST(e,hq)<480);if(threats.length){const target=threats.sort((a,b)=>DIST(a,hq)-DIST(b,hq))[0];for(const u of army)if(DIST(u,hq)<800)this.order([u.id],'attackmove',target.x,target.y);return;}
  if(this.time>=this.nextAttack&&army.length>=cfg.waveMin){this.aiWave++;const known=this.own(0).filter(e=>D[e.type].building&&this.isVisible(e,1));const target=known[0]||{x:440,y:1280};this.order(army.map(e=>e.id),'attackmove',target.x,target.y);this.nextAttack=this.time+cfg.wave;this.emit('Long-range sensors: hostile strike force inbound.',0,true);}
 }
 save(){
  const copy={};
  for(const k of STATE_FIELDS)if(this[k]!==undefined)copy[k]=this[k];
  copy.explored=this.explored.map(v=>Array.from(v));
  copy.visible=this.visible.map(v=>Array.from(v));
  return JSON.stringify(copy);
 }
 static load(json){
  if(typeof json!=='string'||json.length>12*1024*1024)throw Error('Invalid save size');
  const p=JSON.parse(json);validateState(p);
  const game=Object.create(Game.prototype);
  for(const k of STATE_FIELDS)if(p[k]!==undefined)game[k]=p[k];
  game.version=2;game.mapSeed=p.mapSeed??7481;
  game.grid=new Uint8Array(COLS*ROWS);
  game.explored=p.explored.map(v=>Uint8Array.from(v));
  game.visible=p.visible?p.visible.map(v=>Uint8Array.from(v)):[new Uint8Array(COLS*ROWS),new Uint8Array(COLS*ROWS)];
  game.effects=p.effects||[];game.events=p.events||[];game.visionClock=p.visionClock??0;
  game.rebuildGrid(true);
  if(!p.visible)game.updateVision();
  return game;
 }
}
function uRadius(u){return D[u.type].r;}
const STATE_FIELDS=['version','mapSeed','seed','difficulty','time','nextId','entities','resources','rocks','teams','result','aiClock','aiWave','nextAttack','aiStage','lastAlert','visionClock','effects','events'];
function validateState(p){
 const fail=()=>{throw Error('Invalid or incompatible simulation save');};
 const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const num=(v,min=0,max=1e9)=>Number.isFinite(v)&&v>=min&&v<=max;
 const int=(v,min=0,max=1e9)=>Number.isInteger(v)&&num(v,min,max);
 const point=v=>obj(v)&&num(v.x,0,W-.001)&&num(v.y,0,H-.001);
 const cells=v=>Array.isArray(v)&&v.length===2&&v.every(a=>Array.isArray(a)&&a.length===COLS*ROWS&&a.every(n=>n===0||n===1));
 if(!obj(p)||![1,2].includes(p.version)||!['easy','normal','hard'].includes(p.difficulty)||!num(p.time)||!int(p.seed,0,4294967295)||!int(p.nextId,1)||!Array.isArray(p.entities)||p.entities.length>2048||!Array.isArray(p.resources)||p.resources.length>2048||!Array.isArray(p.rocks)||p.rocks.length>512||!Array.isArray(p.teams)||p.teams.length!==2||!cells(p.explored)||![null,'victory','defeat'].includes(p.result))fail();
 if(p.version===2&&(!cells(p.visible)||!int(p.mapSeed,0,4294967295)||!num(p.visionClock,-1,1)))fail();
 for(const k of ['aiClock','nextAttack'])if(!num(p[k],-10))fail();
 for(const k of ['aiStage','aiWave'])if(!int(p[k]))fail();
 if(p.lastAlert!==undefined&&!num(p.lastAlert))fail();
 const ids=new Set();const id=v=>{if(!int(v,1)||v>=p.nextId||ids.has(v))fail();ids.add(v);};
 for(const r of p.resources){if(!point(r)||!['mineral','gas'].includes(r.type)||!num(r.amount)||!num(r.r,1,100))fail();id(r.id);}
 for(const r of p.rocks)if(!point(r)||!num(r.r,1,300))fail();
 const orders=['idle','hold','move','attackmove','attack','gather','build','repair'];
 for(const e of p.entities){
  if(!point(e)||!Object.hasOwn(D,e.type)||![0,1].includes(e.team)||!num(e.hp)||typeof e.complete!=='boolean'||!num(e.progress,0,1)||typeof e.siege!=='boolean'||!num(e.angle,-1e9,1e9)||!num(e.cool,-1e9)||!num(e.mine,0,2)||!num(e.cargo,0,15)||!['mineral','gas'].includes(e.cargoType)||!Array.isArray(e.path)||e.path.length>8192||!e.path.every(point)||!(e.pathGoal===null||typeof e.pathGoal==='string'&&e.pathGoal.length<50)||!obj(e.order)||!orders.includes(e.order.type)||!Array.isArray(e.queue)||e.queue.length>5)fail();
  id(e.id);if(e.rally!==null&&!point(e.rally))fail();
  if(['move','attackmove'].includes(e.order.type)&&!point(e.order))fail();
  if(['attack','gather','build','repair'].includes(e.order.type)&&!int(e.order.target,1))fail();
  if(e.vent!==undefined&&!p.resources.some(r=>r.id===e.vent&&r.type==='gas'))fail();
  if(e.hit!==undefined&&!num(e.hit,0,1))fail();
  for(const q of e.queue){if(!obj(q)||!num(q.progress,0,1)||!num(q.time,.1,3600)||!num(q.m)||!num(q.g))fail();if(q.kind==='unit'){if(!D[e.type].trains?.includes(q.type))fail();}else if(q.kind==='research'){if(e.type!=='lab'||!Object.hasOwn(UP,q.type))fail();}else fail();}
 }
 for(const t of p.teams){if(!obj(t)||!num(t.minerals)||!num(t.gas)||!obj(t.up)||!obj(t.stats))fail();for(const k of Object.keys(UP))if(!int(t.up[k],0,3))fail();for(const k of ['kills','lost','gathered','built','trained'])if(!num(t.stats[k]))fail();}
 if(p.version===2&&(!Array.isArray(p.effects)||!Array.isArray(p.events)))fail();
 if(p.effects){if(p.effects.length>4096)fail();for(const f of p.effects){if(!point(f)||!['blast','shell','shot','heal','mine'].includes(f.type)||!num(f.life,0,10)||!num(f.max,.001,10))fail();if(f.type==='blast'){if(!num(f.r,0,300))fail();}else if(!point({x:f.tx,y:f.ty}))fail();}}
 if(p.events){if(p.events.length>100)fail();for(const e of p.events)if(!obj(e)||typeof e.text!=='string'||e.text.length>500||typeof e.warn!=='boolean'||!num(e.time))fail();}
}
const api={Game,D,UP,W,H,TILE,COLS,ROWS,DIST,clamp};
if(typeof module==='object'&&module.exports)module.exports=api;else globalThis.Starfall=api;
})();
