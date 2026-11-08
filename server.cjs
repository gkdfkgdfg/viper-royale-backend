// Local arena for the downloaded Viper Royale browser client. No npm packages.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const ROOT = __dirname, WEB = path.join(ROOT, 'web');
const STATE = path.join(ROOT, 'settings.json');
const defaults = { language:'ru', nickname: 'Player', currency: 'USDT', currencyIcon:'none', balance: 10000, entryFee: 50, pelletPrice: 1, botCount: 18, difficulty: 1, worldHalfSize: 1800, cashoutMultiplier: 50, skinCode: 0, mode:'cash',stakeBase:250,tournamentSeconds:180,quality:'original',hideCurrency:false,hideAmounts:false,hideDollar:false,hideNicknames:false,hideMapLeaderboard:false,hideLabels:false,hideExitHints:false,showStartHint:true,currencyDisplay:'full',background:'original',backgroundColor:'#07131a',wormPrimary:'#22ef82',wormSecondary:'#08784a',wormPattern:'gradient_stripe',wormFlag:'none',wormSkin:'default' };
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
function validate(value) {
  const result = { ...defaults };
  for (const [key,min,max] of [['balance',0,1e12],['entryFee',0,1e8],['pelletPrice',0.001,1e6],['botCount',1,60],['difficulty',0,2],['worldHalfSize',800,4000],['cashoutMultiplier',1,50],['skinCode',0,30],['stakeBase',.005,2e7],['tournamentSeconds',30,3600]]) {
    const n=Number(value[key] ?? defaults[key]);
    if (!Number.isFinite(n)) throw new Error('Invalid '+key);
    result[key]=clamp(n,min,max);
  }
  for(const key of ['botCount','difficulty','skinCode']) result[key]=Math.round(result[key]);
  result.nickname=String(value.nickname||'Player').trim().slice(0,24);
  result.currency=String(value.currency??'USDT').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,12)||'USDT';
  result.currencyIcon=['BTC','SOL','USDT'].includes(value.currencyIcon)?value.currencyIcon:'none';
  result.cashoutMultiplier=50;
  for(const [key,options] of Object.entries({language:['ru','en','es','sr','ro','it'],mode:['practice','cash','tournaments'],quality:['original','reduced'],background:['original','neon','purple','gold','custom','image'],wormPattern:['gradient_stripe','circle','neon','plasma','scales'],wormFlag:['none','sweden','romania','spain','colombia','serbia','argentina','venezuela']})) result[key]=options.includes(value[key])?value[key]:(key==='language'?'ru':defaults[key]);
  for(const key of ['hideCurrency','hideAmounts','hideDollar','hideNicknames','hideMapLeaderboard','hideLabels','hideExitHints'])result[key]=value[key]===true;
  result.showStartHint=value.showStartHint!==false;
  result.currencyDisplay=result.hideAmounts?'hidden':result.hideCurrency?'amount':'full';
  for(const key of ['backgroundColor','wormPrimary','wormSecondary'])result[key]=/^#[0-9a-f]{6}$/i.test(value[key])?value[key]:defaults[key];
  const legacySkin=value.wormFlag==='serbia'?'serbia':'default';
  result.wormSkin=['default','serbia'].includes(value.wormSkin)?value.wormSkin:uploadedAsset('skins',value.wormSkin)?value.wormSkin:legacySkin;
  if(uploadedAsset('backgrounds',value.background))result.background=value.background;
  result.tournamentSeconds=Math.round(result.tournamentSeconds);
  return result;
}
const CATALOG=path.join(WEB,'uploads','catalog.json');
function readCatalog(){try{const data=JSON.parse(fs.readFileSync(CATALOG,'utf8'));return{skins:Array.isArray(data.skins)?data.skins:[],backgrounds:Array.isArray(data.backgrounds)?data.backgrounds:[]};}catch{return{skins:[],backgrounds:[]};}}
function uploadedAsset(kind,id){if(typeof id!=='string'||!/^(skin|bg)-[a-f0-9]{16}$/.test(id))return null;const asset=readCatalog()[kind]?.find(a=>a.id===id);return asset&&fs.existsSync(path.join(WEB,asset.url))?asset:null;}
function configView(source=settings){const skin=uploadedAsset('skins',source.wormSkin),background=uploadedAsset('backgrounds',source.background);return{...source,skinImage:skin?.url||(source.wormSkin==='serbia'?'/skins/serbia.png':'/assets/default-Bx4xt8yz.webp'),skinSpan:skin?.span||(source.wormSkin==='serbia'?1.6:4),backgroundImage:background?.url||(source.background==='image'?'/local/background-image.jpg':null)};}
let settings;
try { settings=validate(JSON.parse(fs.readFileSync(STATE,'utf8'))); } catch { settings={...defaults}; }
function originAllowed(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  const configured=String(process.env.VIPER_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(configured.includes('*')||configured.includes(origin))return true;
  try{
    const parsed=new URL(origin);
    if(parsed.protocol==='http:'||parsed.protocol==='https:'){
      if(parsed.host===req.headers.host)return true;
      if(parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1')return true;
      if(parsed.hostname.endsWith('.trycloudflare.com'))return true;
    }
  }catch{}
  return false;
}
const rand=(a,b)=>a+Math.random()*(b-a);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const normalize=(a)=>Math.atan2(Math.sin(a),Math.cos(a));
const names=['Cobra','Mamba','Python','Neon Fang','Viper','Anaconda','Serpent','Copperhead','King Snake','Boa','Sidewinder','Night Coil','Green Bite','Rattler','Coral','Venom','Emerald','Royal','Basilisk','Naga'];
const INITIAL_FOOD=50;
const CASHOUT_MULTIPLIER=50,BOOST_BURN_SECONDS=1.75,PHYSICS_HZ=60,NETWORK_HZ=30;

class Arena {
  constructor(config,send,charge=()=>{},now=()=>Date.now()) {
    // Stakes scale the local economy, while all players start with the same body.
    this.config={...config,cashoutMultiplier:CASHOUT_MULTIPLIER,pelletPrice:config.pelletPrice*(config.entryFee>0?config.entryFee/50:1)*3};this.send=send;this.accountCharge=charge;this.walletBalance=Number(config.balance)||0;this.now=now;
    this.snakes=new Map();this.foods=new Map();this.nextFood=1;this.tick=0;
    this.playerId='local-player';this.running=false;this.totalKills=0;this.earned=0;this.eliminated=[];this.networkElapsed=0;this.statusElapsed=0;
  }
  point(){const h=this.config.worldHalfSize-120;return{x:rand(-h,h),y:rand(-h,h)};}
  foodTarget(){return Math.round((this.config.quality==='reduced'?550:850)*clamp((this.config.worldHalfSize/1800)**2,.4,2.5));}
  food(point=this.point(),value=Math.random()<.1?2:1,lifetime=0){const f={id:this.nextFood++,...point,value};if(lifetime)f.expiresAt=this.now()+lifetime;this.foods.set(f.id,f);return f;}
  botFood(id){const slot=Number(String(id).replace('bot-',''))%10;return Math.round(slot===0?rand(550,850):slot===1?rand(240,400):slot===2?rand(1200,1600):rand(35,160));}
  spawnPath(pos,angle,foodHeld){
    const length=3*(8.25+.425*foodHeld),edge=this.config.worldHalfSize-65,headToTail=[{...pos}];let x=pos.x,y=pos.y,back=angle+Math.PI;
    for(let d=4;d<=length;d+=4){
      if(Math.min(edge-Math.abs(x),edge-Math.abs(y))<210)back+=clamp(normalize(Math.atan2(-y,-x)-back),-.04,.04);
      x+=Math.cos(back)*4;y+=Math.sin(back)*4;headToTail.push({x,y});
    }
    return headToTail.reverse();
  }
  spawn(id,name,player=false,skin=0){
    let pos=player?{x:0,y:0}:this.point();
    for(let attempt=0;attempt<30&&[...this.snakes.values()].some(s=>distance(s,pos)<170);attempt++)pos=this.point();
    const angle=rand(-Math.PI,Math.PI);
    const foodHeld=player?INITIAL_FOOD:this.botFood(id);
    let points=this.spawnPath(pos,angle,foodHeld);
    // Keep a large bot's initial body clear of the player, not only its head.
    if(!player){const me=this.snakes.get(this.playerId);for(let attempt=0;me&&attempt<40&&points.some(p=>distance(p,me)<160);attempt++){pos=this.point();points=this.spawnPath(pos,angle,foodHeld);}}
    const s={id,name,...pos,angle,foodHeld,initialFood:foodHeld,skinCode:skin,path:points,boost:false,graceUntil:this.now()+2500,burn:0,aiAt:0,heading:angle,cashoutAt:null,exitOpen:false};
    this.snakes.set(id,s);return s;
  }
  radius(s){return Math.min(28,10.2+Math.pow(Math.max(0,s.foodHeld-50),0.42)*0.95);}
  points(s){return Math.max(0,s.foodHeld-s.initialFood);}
  value(s){return Math.max(0,this.config.entryFee+(s.foodHeld-INITIAL_FOOD)*this.config.pelletPrice);}
  cashoutTargetPoints(){return INITIAL_FOOD+Math.max(1,this.config.entryFee*CASHOUT_MULTIPLIER-this.config.entryFee)/this.config.pelletPrice;}
  snapshot(s,kind='sync'){return{type:kind,id:s.id,name:s.name,x:s.x,y:s.y,angle:s.angle,food_held:s.foodHeld,points:this.points(s),skin_code:s.skinCode,is_boosting:s.boost,base_radius:this.radius(s),head_radius:this.radius(s)*1.04,cashout_flags:this.flags(s),countdown:s.cashoutAt?Math.max(0,Math.ceil((s.cashoutAt-this.now())/1000)):undefined,cashout_window:s.exitOpen?null:undefined,...(kind==='spawn'?{path:s.path}:{}),server_time:this.simTime??this.now(),tick:this.tick};}
  flags(s){return (this.config.mode!=='tournaments'&&this.value(s)+1e-7>=this.config.entryFee*CASHOUT_MULTIPLIER?1:0)|(s.cashoutAt?2:0)|(s.exitOpen?4:0);}
  applyBalance(delta){this.walletBalance=Math.round(Math.max(0,this.walletBalance+delta)*1000)/1000;this.accountCharge?.(delta,this.walletBalance);}
  start(name,skin){
    if(this.running)return;
    this.running=true;this.startedAt=this.now();this.simTime=this.startedAt;if(this.config.mode!=='practice')this.applyBalance(-this.config.entryFee);
    if(this.config.mode==='tournaments')this.endsAt=this.startedAt+this.config.tournamentSeconds*1000;
    const p=this.spawn(this.playerId,name||this.config.nickname,true,skin||0);
    for(let i=0;i<this.config.botCount;i++)this.spawn('bot-'+i,names[i%names.length]+(i>=names.length?' '+(i+1):''),false,1+i%25);
    // Reserve a small part of the food for the starting area; it counts toward
    // the same map budget instead of adding another dense field on top.
    const nearby=Math.min(60,Math.round(this.foodTarget()*.08));
    for(let i=0;i<nearby;i++)this.food({x:rand(-650,650),y:rand(-650,650)});
    while(this.foods.size<this.foodTarget())this.food();
    this.send({type:'welcome',id:p.id,x:p.x,y:p.y,version:7,world_half_size:this.config.worldHalfSize,tick_rate:NETWORK_HZ});
    this.send({type:'economics_info',entry_fee:this.config.entryFee,pellet_price:this.config.pelletPrice,big_pellet_price:this.config.pelletPrice*2,initial_food:INITIAL_FOOD,cashout_target_points:this.cashoutTargetPoints()});
    this.send({type:'initial_state',server_time:this.now(),snakes:[],foods:[],tick:0});
    for(const s of this.snakes.values())this.send(this.snapshot(s,'spawn'));
    this.send({type:'foods_snapshot',server_time:this.now(),foods:[...this.foods.values()],seq:0});
    this.status();
  }
  input(dx,dy,boost){const s=this.snakes.get(this.playerId);if(!s)return;if(Math.hypot(dx,dy)>0.001)s.heading=Math.atan2(dy,dx);s.boost=!!boost&&s.foodHeld>20;}
  // Share a spatial index between bots. Only nearby bodies enter the route search.
  indexBodies(){
    this.bodyGrid=new Map();
    for(const s of this.snakes.values()){const radius=this.radius(s);for(let i=0;i<s.path.length;i+=2){
      const p=s.path[i],key=Math.floor(p.x/160)+','+Math.floor(p.y/160);
      if(!this.bodyGrid.has(key))this.bodyGrid.set(key,[]);
      this.bodyGrid.get(key).push({x:p.x,y:p.y,r:radius,id:s.id});
    }}
  }
  nearbyBodies(s,range=460){
    const out=[];
    for(let x=Math.floor((s.x-range)/160);x<=Math.floor((s.x+range)/160);x++)
      for(let y=Math.floor((s.y-range)/160);y<=Math.floor((s.y+range)/160);y++)
        for(const p of this.bodyGrid?.get(x+','+y)||[])if(p.id!==s.id&&(p.x-s.x)**2+(p.y-s.y)**2<range*range)out.push(p);
    return out;
  }
  aim(s){
    const now=this.now(),level=this.config.difficulty;
    if(now<s.aiAt)return;s.aiAt=now+[210,140,100][level];
    s.turnSide??=(Number(s.id.replace('bot-',''))%2?1:-1);
    const body=this.nearbyBodies(s),heads=[...this.snakes.values()].filter(o=>o!==s&&distance(s,o)<650);
    const edge=this.config.worldHalfSize-this.radius(s)-8;
    // A target behind the turning circle is deliberately skipped. Chasing the
    // nearest pellet behind the head was the cause of the old endless circles.
    if(!s.progressAt||now-s.progressAt>2200){
      if(s.progressFrom&&distance(s,s.progressFrom)<100){s.goal=null;s.exploreUntil=now+1400;s.aiMode='explore';}
      s.progressFrom={x:s.x,y:s.y};s.progressAt=now;
    }
    const old=s.goal?.foodId?this.foods.get(s.goal.foodId):s.goal;
    if(!old||distance(s,old)<28||now>s.goalUntil||Math.abs(normalize(Math.atan2(old.y-s.y,old.x-s.x)-s.angle))>2.35){
      let target=null,best=-Infinity;
      if(!(s.exploreUntil>now))for(const f of this.foods.values()){
        const d=distance(s,f),turn=Math.abs(normalize(Math.atan2(f.y-s.y,f.x-s.x)-s.angle));
        if(d<28||d<95&&turn>1.15||turn>2.35)continue;
        const wall=Math.min(edge-Math.abs(f.x),edge-Math.abs(f.y));if(wall<55)continue;
        const score=210*Math.min(f.value,4)/(d+75)-turn*.8-(d>900?1:0);
        if(score>best){best=score;target=f;}
      }
      s.goal=target?{x:target.x,y:target.y,foodId:target.id}:{x:clamp(s.x+Math.cos(s.angle)*500,-edge+180,edge-180),y:clamp(s.y+Math.sin(s.angle)*500,-edge+180,edge-180)};
      s.goalUntil=now+(target?3400:1700);s.aiMode=target?'forage':'explore';
      // Stronger bots sometimes cut across a rival's predicted path. Safety
      // planning below still rejects a head-on charge or an occupied route.
      if(level>0&&now>=(s.attackAfter||0)){
        const rival=heads.find(o=>{const d=distance(s,o);return d>190&&d<440&&s.foodHeld>o.foodHeld*.85&&Math.cos(normalize(o.angle-s.angle))>.15;});
        if(rival&&Math.random()<(level===2?.65:.18)){
          const lead=level===2?1.15:.85,v=rival.boost?271.796:138.516;
          s.goal={x:clamp(rival.x+Math.cos(rival.angle)*v*lead,-edge+100,edge-100),y:clamp(rival.y+Math.sin(rival.angle)*v*lead,-edge+100,edge-100)};
          s.goalUntil=now+1100;s.attackAfter=now+3200;s.aiMode='intercept';
        }
      }
    }
    if(Math.min(edge-Math.abs(s.x),edge-Math.abs(s.y))<320){
      s.goal={x:clamp(s.x,-edge+420,edge-420),y:clamp(s.y,-edge+420,edge-420)};
      s.goalUntil=now+1400;s.aiMode='escape';
    }
    const desired=Math.atan2(s.goal.y-s.y,s.goal.x-s.x),initialDistance=distance(s,s.goal),radius=this.radius(s);
    const route=(heading,speed)=>{
      let x=s.x,y=s.y,angle=s.angle,clearance=Infinity,risk=0,wallRisk=0,blocked=false;
      const dt=.12,steps=14;
      for(let j=1;j<=steps;j++){
        angle+=clamp(normalize(heading-angle),-3.4*dt,3.4*dt);
        x+=Math.cos(angle)*speed*dt;y+=Math.sin(angle)*speed*dt;
        const wallGap=Math.min(edge-Math.abs(x),edge-Math.abs(y));let gap=wallGap;
        if(wallGap<0){wallRisk+=100000+(steps-j)*6500;clearance=wallGap;break;}
        if(wallGap<120)wallRisk+=(120-wallGap)*.8;
        for(const p of body){const dx=x-p.x,dy=y-p.y;if(Math.abs(dx)<100&&Math.abs(dy)<100)gap=Math.min(gap,Math.hypot(dx,dy)-(radius+p.r)*.82-7);}
        for(const o of heads){const v=o.boost?271.796:138.516,t=j*dt,px=o.x+Math.cos(o.angle)*v*t,py=o.y+Math.sin(o.angle)*v*t;gap=Math.min(gap,Math.hypot(x-px,y-py)-(radius+this.radius(o))*.82-10);}
        clearance=Math.min(clearance,gap);
        if(gap<0&&!blocked){risk+=10000+(steps-j)*650;blocked=true;}
        if(gap<65)risk+=(65-gap)*[.24,.42,.6][level];
      }
      const gain=initialDistance-Math.hypot(s.goal.x-x,s.goal.y-y);
      const turn=normalize(heading-s.angle);
      return {heading,clearance,wallRisk,risk:risk+wallRisk,score:gain*.8-risk-wallRisk-Math.abs(turn)*12+(Math.sign(turn)===s.turnSide?1.5:0)};
    };
    const angles=[desired,...[0,.35,-.35,.7,-.7,1.1,-1.1,1.65,-1.65,2.25,-2.25,2.8,-2.8,Math.PI].map(a=>s.angle+a)];
    const escaping=s.aiMode==='escape'&&Math.cos(normalize(Math.atan2(-s.y,-s.x)-s.angle))<.25;
    if(escaping)s.escapeTurnSide??=(normalize(Math.atan2(-s.y,-s.x)-s.angle)>=0?1:-1);else s.escapeTurnSide=null;
    const plans=angles.map(a=>{const p=route(a,138.516);if(escaping&&Math.sign(normalize(a-s.angle))!==s.escapeTurnSide)p.score-=50000;return p;}).sort((a,b)=>Math.min(edge-Math.abs(s.x),edge-Math.abs(s.y))<320?a.wallRisk-b.wallRisk||b.score-a.score:b.score-a.score),best=plans[0];
    s.heading=normalize(best.heading);s.boost=false;
    const danger=plans.find(p=>Math.abs(normalize(p.heading-s.angle))<.01)?.clearance<35;
    if(danger)s.aiMode='escape';
    if(level>0&&s.foodHeld>35&&Math.min(edge-Math.abs(s.x),edge-Math.abs(s.y))>400&&(danger||s.aiMode==='intercept')&&Math.abs(normalize(s.heading-s.angle))<.55){
      const fast=route(s.heading,271.796);s.boost=fast.clearance>35&&fast.risk<12;
    }
    if(best.risk>5000){s.goal=null;s.goalUntil=0;} // replan immediately if trapped
  }
  trim(s){let remaining=3*(8.25+.425*s.foodHeld);for(let i=s.path.length-1;i>0;i--){remaining-=distance(s.path[i],s.path[i-1]);if(remaining<=0){s.path.splice(0,i-1);break;}}if(s.path.length>900)s.path.splice(0,s.path.length-900);}
  die(s,killer,reason){
    if(!this.snakes.has(s.id))return;
    this.snakes.delete(s.id);this.eliminated.unshift({...s,eliminatedAt:this.now()});
    const dropped=[];let remaining=Math.min(s.foodHeld,1440),i=0;
    while(remaining>1e-9&&i<900){const p=s.path[Math.floor(i/Math.max(1,s.foodHeld/1.72)*s.path.length)%s.path.length]||s;const v=Math.min(remaining,Math.random()<.72?2:1);remaining-=v;dropped.push(this.food({x:p.x+rand(-13,13),y:p.y+rand(-13,13)},v,40000));i++;}
    this.send({type:'kill',victim_id:s.id,victim_name:s.name,killer_id:killer?.id||'',killer_name:reason||killer?.name||'boundary',x:s.x,y:s.y,tick:this.tick});
    this.send({type:'foods',added:dropped,removed:[]});
    if(killer?.id===this.playerId)this.totalKills++;
    if(s.id===this.playerId){this.lastResult={result:'death',reason:reason||killer?.name||'boundary',value:this.value(s)};this.status();}
    else if(this.config.mode!=='tournaments'){const timer=setTimeout(()=>{if(!this.running)return;const b=this.spawn(s.id,s.name,false,s.skinCode);this.send(this.snapshot(b,'spawn'));},1300);timer.unref?.();}
  }
  cashout(){const p=this.snakes.get(this.playerId);if(!p)return;
    if(this.config.mode==='tournaments'){this.send({type:'cashout_response',success:false,reason:'tournament'});return;}
    if(!(this.flags(p)&1)){this.send({type:'cashout_response',success:false,reason:'insufficient_food'});return;}
    if(p.cashoutAt||p.exitOpen)return;
    p.cashoutAt=this.now()+30000;
    this.send({type:'cashout_response',success:true});
  }
  finish(p){const amount=Math.round(this.value(p)*1000)/1000;if(this.config.mode!=='practice')this.applyBalance(amount);this.earned=amount;this.snakes.delete(p.id);this.lastResult={result:'cashout',value:amount};this.send({type:'cashout_success',snake_id:p.id,name:p.name,amount,x:p.x,y:p.y});this.status();}
  standings(){return [...this.snakes.values()].sort((a,b)=>b.foodHeld-a.foodHeld).concat(this.eliminated).map((s,i)=>({id:s.id,name:s.name,food_held:s.foodHeld,score:s.foodHeld,rank:i+1,alive:this.snakes.has(s.id)}));}
  tournamentBoard(){const entries=this.standings().map(s=>({...s,username:s.name,total_cashouts:s.score*this.config.pelletPrice,me:s.id===this.playerId}));this.send({type:'tournament_leaderboard',tournament_id:'local-tournament',status:this.tournamentEnded?'finished':'active',entries,total_players:this.config.botCount+1,prize_pool:this.config.entryFee*(this.config.botCount+1),ends_at:this.endsAt,time_remaining_seconds:Math.max(0,Math.ceil((this.endsAt-this.now())/1000))});}
  endTournament(){if(this.tournamentEnded)return;this.tournamentEnded=true;const entries=this.standings(),p=this.snakes.get(this.playerId),rank=entries.find(e=>e.id===this.playerId)?.rank||entries.length,share=[.5,.3,.2][rank-1]||0,amount=p?Math.round(this.config.entryFee*(this.config.botCount+1)*share*1000)/1000:0;this.tournamentBoard();if(p&&amount>0){this.applyBalance(amount);this.earned=amount;this.snakes.delete(p.id);this.lastResult={result:'tournament',rank,value:amount};this.send({type:'cashout_success',snake_id:p.id,name:p.name,amount,x:p.x,y:p.y});this.status();}else if(p){this.die(p,null,'Tournament: #'+rank);}this.running=false;}
  step(dt=1/PHYSICS_HZ){if(!this.running)return;this.tick++;this.simTime=(this.simTime??this.now())+dt*1000;const removed=[],added=[],collectors={};const now=this.now();
    for(const [id,f] of this.foods)if(f.expiresAt&&now>=f.expiresAt){this.foods.delete(id);removed.push(id);collectors[id]=null;}
    if(!this.bodyGrid)this.indexBodies();
    for(const s of [...this.snakes.values()]){
      if(s.id!==this.playerId)this.aim(s);
      s.angle+=clamp(normalize(s.heading-s.angle),-3.4*dt,3.4*dt);
      const boosting=s.boost&&s.foodHeld>20,targetSpeed=boosting?271.796:138.516;
      s.moveSpeed??=138.516;s.moveSpeed+=(targetSpeed-s.moveSpeed)*(1-Math.exp(-dt*(boosting?11:14)));
      s.x+=Math.cos(s.angle)*s.moveSpeed*dt;s.y+=Math.sin(s.angle)*s.moveSpeed*dt;
      const previous=s.path[s.path.length-1];if(!previous||distance(s,previous)>=4)s.path.push({x:s.x,y:s.y});
      if(boosting){s.burn+=dt;while(s.burn+1e-9>=BOOST_BURN_SECONDS&&s.foodHeld>20){s.burn=Math.max(0,s.burn-BOOST_BURN_SECONDS);const spent=Math.min(1,s.foodHeld-20);s.foodHeld-=spent;const p=s.path[0];added.push(this.food({...p},spent,20000));}}else s.burn=0;
      this.trim(s);
      if(s.cashoutAt&&now>=s.cashoutAt){s.cashoutAt=null;s.exitOpen=true;this.send({type:'cashout_window_open'});}
      const h=this.config.worldHalfSize;
      if(Math.abs(s.x)>=h-this.radius(s)||Math.abs(s.y)>=h-this.radius(s)){
        if(s.id===this.playerId&&s.exitOpen)this.finish(s);else this.die(s,null,'boundary');continue;
      }
      const reach=this.radius(s)+10;
      for(const [id,f] of this.foods){if(Math.abs(s.x-f.x)<reach&&Math.abs(s.y-f.y)<reach&&distance(s,f)<reach){s.foodHeld+=f.value;this.foods.delete(id);removed.push(id);collectors[id]=s.id;}}
    }
    // Head-to-body collisions, including heads; spawn protection gives room to turn.
    this.indexBodies();const alive=[...this.snakes.values()];
    for(const s of alive){if(!this.snakes.has(s.id)||now<s.graceUntil)continue;
      let killer=null;
      for(const p of this.nearbyBodies(s,64)){const o=this.snakes.get(p.id);if(!o||now<o.graceUntil)continue;const hit=(this.radius(s)+p.r)*.82;if(distance(s,p)<hit){killer=o;break;}}
      if(!killer)for(const o of alive){if(o!==s&&this.snakes.has(o.id)&&now>=o.graceUntil&&distance(s,o)<(this.radius(s)+this.radius(o))*.82){killer=o;break;}}
      if(killer)this.die(s,killer);
    }
    if(this.config.mode==='tournaments'&&now>=this.endsAt){this.endTournament();return;}
    while(this.foods.size<this.foodTarget())added.push(this.food());
    if(removed.length||added.length)this.send({type:'foods',added,removed,collectors});
    this.networkElapsed+=dt;if(this.networkElapsed+1e-9>=1/NETWORK_HZ){this.networkElapsed=Math.max(0,this.networkElapsed-Math.floor((this.networkElapsed+1e-9)*NETWORK_HZ)/NETWORK_HZ);this.send({type:'batch',server_time:this.simTime,messages:[...this.snakes.values()].map(s=>this.snapshot(s))});}
    this.statusElapsed+=dt;if(this.statusElapsed+1e-9>=.5){this.statusElapsed=Math.max(0,this.statusElapsed-Math.floor((this.statusElapsed+1e-9)/.5)*.5);if(this.config.mode==='tournaments')this.tournamentBoard();this.send({type:'leaderboard',entries:[...this.snakes.values()].sort((a,b)=>b.foodHeld-a.foodHeld).slice(0,10).map(s=>({id:s.id,name:s.name,food_held:s.foodHeld}))});this.send({type:'local_minimap',seq:this.tick,snakes:[...this.snakes.values()].map(s=>({x:s.x,y:s.y,sizeClass:s.foodHeld>200?2:s.foodHeld>80?1:0,isCashingOut:!!(s.cashoutAt||s.exitOpen),hasGoldenBall:false}))});this.status();}
  }
  status(){const p=this.snakes.get(this.playerId);this.send({type:'local_status',balance:this.walletBalance,currency:this.config.currency,entryFee:this.config.entryFee,pelletPrice:this.config.pelletPrice,cashoutMultiplier:this.config.cashoutMultiplier,foodHeld:p?.foodHeld||0,value:p?this.value(p):0,botCount:[...this.snakes.values()].filter(s=>s.id!==this.playerId).length,kills:this.totalKills,x:p?.x,y:p?.y,worldHalfSize:this.config.worldHalfSize,countdown:p?.cashoutAt?Math.max(0,Math.ceil((p.cashoutAt-this.now())/1000)):null,exitOpen:p?.exitOpen||false,points:p?this.points(p):0,cashoutTargetPoints:this.cashoutTargetPoints(),result:this.lastResult||null});}
  stop(){this.running=false;}
}

function frame(data,opcode=1){const payload=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data));let head;if(payload.length<126){head=Buffer.from([0x80|opcode,payload.length]);}else if(payload.length<65536){head=Buffer.alloc(4);head[0]=0x80|opcode;head[1]=126;head.writeUInt16BE(payload.length,2);}else{head=Buffer.alloc(10);head[0]=0x80|opcode;head[1]=127;head.writeBigUInt64BE(BigInt(payload.length),2);}return Buffer.concat([head,payload]);}
function consume(buffer,callback){let offset=0;while(buffer.length-offset>=2){const a=buffer[offset],b=buffer[offset+1];let length=b&127,n=2;if(length===126){if(buffer.length-offset<4)break;length=buffer.readUInt16BE(offset+2);n=4;}else if(length===127){if(buffer.length-offset<10)break;length=Number(buffer.readBigUInt64BE(offset+2));n=10;}if(length>2e6)throw Error('Frame too large');const masked=!!(b&128),header=n+(masked?4:0);if(buffer.length-offset<header+length)break;const data=Buffer.from(buffer.subarray(offset+header,offset+header+length));if(masked){const mask=buffer.subarray(offset+n,offset+n+4);for(let i=0;i<data.length;i++)data[i]^=mask[i%4];}callback(a&15,data);offset+=header+length;}return buffer.subarray(offset);}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
function networkUrls(port){return Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal&&!i.address.startsWith('169.254.')).map(i=>'http://'+i.address+':'+port);}
function createServer(){
  const arenas=new Set();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');
    // The offline copy is constrained to local resources, including sockets.
    res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'");
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(['/local/media/skins','/local/media/backgrounds'].includes(url.pathname)){
      const kind=url.pathname.endsWith('/skins')?'skins':'backgrounds';
      if(req.method==='GET')return json(readCatalog()[kind]);
      if(req.method==='POST'){
        if(!originAllowed(req))return json({error:'Invalid origin'},403);
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)return json({error:'Размер изображения больше 4 МБ'},413);chunks.push(chunk);}
        const data=Buffer.concat(chunks),signature=Buffer.from([137,80,78,71,13,10,26,10]);
        if(data.length<24||!data.subarray(0,8).equals(signature))return json({error:'Нужно изображение PNG'},400);
        const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
        if(!width||!height||width>4096||height>4096)return json({error:'Слишком большое разрешение изображения'},400);
        const id=(kind==='skins'?'skin-':'bg-')+crypto.randomBytes(8).toString('hex'),assetUrl='/uploads/'+kind+'/'+id+'.png',imagePath=path.join(WEB,assetUrl);
        let name;try{name=decodeURIComponent(String(req.headers['x-asset-name']||''));}catch{name='';}
        name=name.replace(/[\x00-\x1f<>]/g,'').replace(/\.[^.]+$/,'').trim().slice(0,64)||(kind==='skins'?'Мой скин':'Мой фон');
        fs.mkdirSync(path.dirname(imagePath),{recursive:true});fs.writeFileSync(imagePath,data);
        const asset={id,name,url:assetUrl,span:clamp(width/height,.5,8)},catalog=readCatalog();catalog[kind].push(asset);fs.writeFileSync(CATALOG,JSON.stringify(catalog,null,2));
        return json(asset,201);
      }
      return json({error:'Method not allowed'},405);
    }
    if(url.pathname==='/local/network')return json({urls:networkUrls(server.address()?.port||8765)});
    if(url.pathname==='/local/background.svg'){
      const selected=url.searchParams.get('theme')||settings.background;
      const customColor=/^#[0-9a-f]{6}$/i.test(url.searchParams.get('color')||'')?url.searchParams.get('color'):'#07131a';
      const theme={neon:['#07131a','#16ce8c'],purple:['#160a29','#974fff'],gold:['#21190b','#e1b347'],custom:[customColor,'#16ce8c']}[selected]||['#07131a','#16ce8c'];
      res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${theme[0]}"/><defs><pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="${theme[1]}" stroke-opacity=".16" stroke-width="1"/><circle cx="0" cy="0" r="2" fill="${theme[1]}" fill-opacity=".32"/></pattern></defs><rect width="512" height="512" fill="url(#grid)"/></svg>`);
    }
    if(['/local/background-image','/local/background-image.jpg'].includes(url.pathname)){
      const imagePath=path.join(WEB,'backgrounds','custom.jpg');
      if(req.method==='GET'){const exists=fs.existsSync(imagePath);res.writeHead(200,{'Content-Type':exists?'image/jpeg':'image/png'});return res.end(fs.readFileSync(exists?imagePath:path.join(WEB,'assets','bg3-BZGvx7Ar.png')));}
      if(req.method==='POST'){
        if(!originAllowed(req))return json({error:'Invalid origin'},403);
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)return json({error:'Image too large'},413);chunks.push(chunk);}
        const data=Buffer.concat(chunks);if(data.length<4||data[0]!==255||data[1]!==216)return json({error:'JPEG required'},400);
        fs.mkdirSync(path.dirname(imagePath),{recursive:true});fs.writeFileSync(imagePath,data);return json({success:true});
      }
    }
    if(url.pathname==='/local/profile') {
      if(req.method!=='POST')return json({error:'Method not allowed'},405);
      if(!originAllowed(req))return json({error:'Invalid origin'},403);
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return json({error:'Request too large'},413);}
      try{const profile=validate({...settings,...JSON.parse(body)});return json(configView(profile));}catch(e){return json({error:e.message},400);}
    }
    if(url.pathname==='/local/config'){
      if(req.method==='GET')return json(configView());
      if(req.method==='POST'){
        const origin=req.headers.origin;
        if(!originAllowed(req))return json({error:'Invalid origin'},403);
        let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return json({error:'Request too large'},413);}
        // Legacy clients may still POST here. Normalize their profile without
        // changing the default profile or another player's game.
        try{return json(configView(validate({...settings,...JSON.parse(body)})));}catch(e){return json({error:e.message},400);}
      }
    }
    if(url.pathname==='/local/stats')return json({arenas:arenas.size,players:[...arenas].map(a=>({tick:a.tick,snakes:a.snakes.size,foods:a.foods.size,player:a.snakes.has(a.playerId),result:a.lastResult||null}))});
    if(url.pathname.startsWith('/api/'))return json({success:true,servers:[],tiers:[],balance:settings.balance,currency:'USD'});
    if(['/arenas','/arenas/','/lobby','/lobby/'].includes(url.pathname))url.pathname='/';
    let target=path.resolve(WEB,'.'+decodeURIComponent(url.pathname));
    if(target!==WEB&&!target.startsWith(WEB+path.sep)){res.writeHead(403);return res.end();}
    try{if(fs.statSync(target).isDirectory())target=path.join(target,'index.html');const data=fs.readFileSync(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
  });
  server.on('upgrade',(req,socket,head)=>{
    if(new URL(req.url,'http://localhost').pathname!=='/ws')return socket.destroy();
    if(!originAllowed(req))return socket.destroy();
    const key=req.headers['sec-websocket-key'];if(!key)return socket.destroy();
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const send=(data)=>{if(!socket.destroyed&&socket.writable)socket.write(frame(data));};
    let arena=null;let clientConfig=null;let buffer=Buffer.alloc(0);
    const handle=(opcode,data)=>{
      if(opcode===8){socket.end(frame(data,8));return;}
      if(opcode===9){socket.write(frame(data,10));return;}
      if(opcode===2&&data[0]===73){let i=1;while(i<data.length&&(data[i++]&128)){}if(i+5<=data.length&&arena)arena.input(data.readInt16LE(i)/32767,data.readInt16LE(i+2)/32767,!!data[i+4]);return;}
      if(opcode!==1)return;
      let message;try{message=JSON.parse(data.toString());}catch{return;}
      if(message.type==='hello'){
        if(arena)return;
        try{clientConfig=validate(message.config&&typeof message.config==='object'?{...settings,...message.config}:settings);}catch(error){send({type:'error',code:'invalid_config',message:error.message});return;}
        const charge=(delta)=>{clientConfig.balance=Math.round(Math.max(0,clientConfig.balance+delta)*1000)/1000;};
        arena=new Arena(clientConfig,send,charge);arenas.add(arena);
        if(arena.config.mode!=='practice'&&clientConfig.balance<arena.config.entryFee){send({type:'error',code:'insufficient_balance',message:'Insufficient local balance'});send({type:'local_status',balance:clientConfig.balance});return;}
        arena.start(message.name,message.skin_code);
      }else if(message.type==='input'&&arena)arena.input(message.dx,message.dy,message.boost);
      else if(message.type==='ping')send({type:'pong',client_time:message.t,server_time:Date.now()});
      else if(message.type==='cashout'&&arena)arena.cashout();
      else if(message.type==='request_food_snapshot'&&arena)send({type:'foods_snapshot',server_time:Date.now(),foods:[...arena.foods.values()],seq:arena.tick});
    };
    socket.on('data',chunk=>{try{buffer=consume(Buffer.concat([buffer,chunk]),handle);}catch{socket.destroy();}});
    if(head.length)buffer=consume(head,handle);
    let lastStep=performance.now(),accumulator=0;
    const timer=setInterval(()=>{const current=performance.now();accumulator+=Math.min(.1,(current-lastStep)/1000);lastStep=current;if(!arena){accumulator=0;return;}let steps=0;while(accumulator+1e-9>=1/PHYSICS_HZ&&steps++<6){arena.step(1/PHYSICS_HZ);accumulator-=1/PHYSICS_HZ;}},1000/PHYSICS_HZ);timer.unref();
    const close=()=>{clearInterval(timer);if(arena){arena.stop();arenas.delete(arena);arena=null;}};socket.on('close',close);socket.on('error',close);
  });
  return server;
}
if(require.main===module){const port=Number(process.env.VIPER_PORT)||8765;const lan=process.argv.includes('--lan');const host=process.env.VIPER_HOST||(lan?'0.0.0.0':'127.0.0.1');const address='http://'+(host==='0.0.0.0'?'127.0.0.1':host)+':'+port;const open=()=>{if(process.argv.includes('--open'))require('node:child_process').execFile('rundll32.exe',['url.dll,FileProtocolHandler',address],{windowsHide:true},()=>{});};const server=createServer();server.on('error',error=>{if(error.code==='EADDRINUSE'){console.log('Viper Royale is already running: '+address);open();}else{console.error(error.message);process.exitCode=1;}});server.listen(port,host,()=>{console.log('Viper Royale Local: '+address+'\n'+(lan?networkUrls(port).map(url=>'PHONE / Wi-Fi: '+url).join('\n')+'\n':'')+'Keep this window open. Press Ctrl+C to stop.');open();});}
module.exports={Arena,validate,defaults,frame,consume,createServer};
