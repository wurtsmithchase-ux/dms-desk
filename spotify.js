/* Spotify soundboard for table mode. Separate from store.js on purpose.
   Sign-in uses Spotify's PKCE flow, so there is no secret: only the public Client ID in config.js.
   The Spotify login stays in this device's localStorage and never goes into the campaign file.
   Chosen playlists, labels and groups save in the campaign settings ("music"). */
(function(){
"use strict";
const AUTH="spotify.auth",PEND="spotify.pending",DEVK="spotify.device",EXP="spotify.expired";
const SCOPES="playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state";
const GROUPS=["Combat","Explore","Town","Rest","Mood"];
const cid=()=>(window.DESK_CONFIG&&window.DESK_CONFIG.spotifyClientId)||"";
const redirect=()=>location.origin+location.pathname.replace(/index\.html$/,"").replace(/\/?$/,"/");
const ls={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(_){}},del(k){try{localStorage.removeItem(k)}catch(_){}}};
const say=m=>{if(typeof toast==="function")toast(m)};
const E=s=>typeof esc==="function"?esc(s):String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

class SpErr extends Error{constructor(code,msg){super(msg);this.code=code}}
const MSG={nodevice:"Open Spotify on a device first",premium:"Spotify Premium is needed to control playback",signin:"Spotify sign-in expired. Connect Spotify again from the Campaign menu",limit:"Spotify asked us to slow down. Try again in a moment",offline:"Can't reach Spotify right now",setup:"Spotify isn't set up yet"};
const fail=(code,extra)=>new SpErr(code,MSG[code]||extra||"Spotify error");

/* ---------- sign-in ---------- */
const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const rand=n=>b64(crypto.getRandomValues(new Uint8Array(n)));
function saved(){try{return JSON.parse(ls.get(AUTH)||"null")}catch(_){return null}}
const connected=()=>{const a=saved();return !!(a&&a.refresh)};

async function connect(){
  if(!cid()){say(MSG.setup+". See SETUP.md");return}
  const v=rand(48),s=rand(12);
  const ch=b64(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
  ls.set(PEND,JSON.stringify({v,s,r:redirect()}));
  const q=new URLSearchParams({response_type:"code",client_id:cid(),scope:SCOPES,redirect_uri:redirect(),state:s,code_challenge_method:"S256",code_challenge:ch});
  location.href="https://accounts.spotify.com/authorize?"+q;
}
function disconnect(){ls.del(AUTH);ls.del(EXP);ls.del(DEVK);ST.state=null;ST.devices=[];ST.err=null;refresh()}

async function tokenCall(params){
  let r;
  try{r=await fetch("https://accounts.spotify.com/api/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cid(),...params})})}
  catch(_){throw fail("offline")}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    /* only a revoked or used-up login means "sign in again"; a setup mistake shows Spotify's own words */
    const e=fail(j.error==="invalid_grant"?"signin":"other",j.error_description||j.error||"Spotify sign-in failed");e.status=r.status;throw e}
  return j;
}
function keep(j,old){
  const a={access:j.access_token,refresh:j.refresh_token||(old&&old.refresh)||"",exp:Date.now()+(j.expires_in||3600)*1000};
  ls.set(AUTH,JSON.stringify(a));ls.del(EXP);return a;
}
let refreshing=null;
function token(force){
  const a=saved();
  if(!a||!a.refresh)return Promise.reject(fail("signin"));
  if(!force&&a.access&&a.exp-30000>Date.now())return Promise.resolve(a.access);
  if(!refreshing)refreshing=tokenCall({grant_type:"refresh_token",refresh_token:a.refresh}).then(j=>keep(j,a).access)
    .catch(e=>{if(e.code==="signin"){ls.del(AUTH);ls.set(EXP,"1")}throw e}).finally(()=>{refreshing=null});
  return refreshing;
}
/* when Spotify sends the person back to the Desk with ?code=... */
async function handleReturn(){
  const p=new URLSearchParams(location.search);
  if(!p.has("code")&&!p.has("error"))return;
  let pend=null;try{pend=JSON.parse(ls.get(PEND)||"null")}catch(_){}
  if(!pend||p.get("state")!==pend.s)return;   /* not ours: leave the address alone */
  ls.del(PEND);
  const clean=location.pathname+location.hash;history.replaceState(null,"",clean);
  if(p.get("error")){say("Spotify sign-in was cancelled");return}
  try{keep(await tokenCall({grant_type:"authorization_code",code:p.get("code"),redirect_uri:pend.r,code_verifier:pend.v}));say("Spotify connected");poll(true)}
  catch(e){say(e.message||"Spotify sign-in failed")}
}

/* ---------- Spotify calls ---------- */
let hold=0;   /* when Spotify says slow down, no polling until this time (ms) */
async function api(method,path,o,again){
  o=o||{};const t=await token();
  let url="https://api.spotify.com/v1"+path;
  if(o.query){const q=new URLSearchParams(o.query).toString();if(q)url+=(url.includes("?")?"&":"?")+q}
  let r;
  try{r=await fetch(url,{method,headers:{Authorization:"Bearer "+t,...(o.body?{"Content-Type":"application/json"}:{})},body:o.body?JSON.stringify(o.body):undefined})}
  catch(_){throw fail("offline")}
  if(r.status===401&&!again){await token(true);return api(method,path,o,true)}
  if(r.status===401){ls.del(AUTH);ls.set(EXP,"1");throw fail("signin")}
  if(r.status===204||r.status===202)return null;
  if(r.status===429){hold=Date.now()+(+r.headers.get("Retry-After")||5)*1000;throw fail("limit")}
  const j=await r.json().catch(()=>null);
  if(!r.ok){
    const er=(j&&j.error)||{};
    if(er.reason==="NO_ACTIVE_DEVICE"||(r.status===404&&/device/i.test(er.message||"")))throw fail("nodevice");
    if(er.reason==="PREMIUM_REQUIRED")throw fail("premium");
    throw fail("other",er.message||("Spotify error "+r.status));
  }
  return j;
}
const devices=async()=>((await api("GET","/me/player/devices"))||{}).devices||[];
async function playlists(){
  const out=[];let off=0;
  for(;;){
    const j=await api("GET","/me/playlists",{query:{limit:50,offset:off}});
    (j.items||[]).forEach(x=>{if(x&&x.id&&x.uri)out.push({id:x.id,uri:x.uri,name:x.name||"Untitled"})});
    if(!j.next||off>1000)break;off+=50;
  }
  return out;
}
async function playUri(uri){
  const pref=ls.get(DEVK);
  const body=uri?{context_uri:uri}:undefined;
  try{await api("PUT","/me/player/play",{body,query:ST.state&&ST.state.device?{}:(pref?{device_id:pref}:{})})}
  catch(e){
    if(e.code!=="nodevice")throw e;
    const ds=await devices();if(!ds.length)throw e;
    const d=ds.find(x=>x.id===pref)||ds.find(x=>x.is_active)||ds[0];
    await api("PUT","/me/player/play",{body,query:{device_id:d.id}});ls.set(DEVK,d.id);
  }
}

/* ---------- live state and the Music panel ---------- */
const ST={state:null,devices:[],err:null,n:0,last:0,busy:false};
const music=()=>{const m=(typeof S!=="undefined"&&S.settings&&S.settings.music)||{};return{items:Array.isArray(m.items)?m.items:[],def:m.def||""}};
const label=uri=>{const it=music().items.find(x=>x.uri===uri);return it?it.label:""};

async function poll(force){
  if(!connected()||ST.busy||(!force&&Date.now()<hold))return;
  ST.busy=true;
  try{
    ST.state=await api("GET","/me/player");
    if(force||ST.n++%5===0)ST.devices=await devices();
    ST.err=null;
  }catch(e){ST.err=e.message||"Spotify error"}
  ST.busy=false;ST.last=Date.now();refresh();
}
function body(){
  if(!cid())return `<p class="vempty">Spotify isn't set up on this Desk yet. SETUP.md explains the one step.</p>`;
  if(!connected())return `<p class="vempty">${ls.get(EXP)?"Spotify sign-in expired. ":""}Spotify isn't connected on this device.</p><div class="sp-bar"><button class="btn sm primary" data-sp="connect">Connect Spotify</button></div>`;
  const m=music(),s=ST.state,it=s&&s.item,ctx=s&&s.context&&s.context.uri;
  const np=it?`<b>${E(it.name)}</b>${it.artists?` · ${E(it.artists.map(a=>a.name).join(", "))}`:""}${label(ctx)?`<small> · ${E(label(ctx))}</small>`:""}`:`<span class="vempty">Nothing playing</span>`;
  let btns="";
  if(!m.items.length)btns=`<p class="vempty">No playlists chosen yet.</p>`;
  else{
    const btn=(x,i)=>`<button class="btn sm sp-b${ctx===x.uri?" on":""}" data-sp="play" data-i="${i}" title="${i<9?"Key "+(i+1):""}">${i<9?`<i>${i+1}</i>`:""}${E(x.label||"Playlist")}</button>`;
    const by={};m.items.forEach((x,i)=>{const g=GROUPS.includes(x.group)?x.group:"Mood";(by[g]=by[g]||[]).push(btn(x,i))});
    btns=GROUPS.filter(g=>by[g]).map(g=>`<div class="sp-g"><span class="sp-gl">${g}</span>${by[g].join("")}</div>`).join("");
  }
  const def=m.items.findIndex(x=>x.id===m.def);
  const ds=ST.devices,cur=s&&s.device&&s.device.id;
  const vol=s&&s.device&&s.device.supports_volume!==false&&s.device.volume_percent!=null?`<input type="range" min="0" max="100" value="${s.device.volume_percent}" data-sp-vol aria-label="Volume">`:"";
  return `<div class="sp-np">${np}</div>${btns}
    <div class="sp-bar">${def>=0?`<button class="btn sm" data-sp="play" data-i="${def}" title="Safe default playlist">Default</button>`:""}<button class="btn sm" data-sp="toggle">${s&&s.is_playing?"Pause":"Play"}</button><button class="btn sm" data-sp="next">Skip</button>${vol}</div>
    <div class="sp-bar"><select data-sp-dev aria-label="Play on">${cur?"":`<option value="">Choose a device…</option>`}${ds.map(d=>`<option value="${E(d.id)}" ${d.id===cur?"selected":""}>${E(d.name)}</option>`).join("")}</select><button class="btn sm" data-sp="setup">Choose playlists</button></div>
    ${ST.err?`<p class="sp-err">${E(ST.err)}</p>`:""}`;
}
let last="";   /* the panel HTML as last drawn, to skip redraws that change nothing */
function panel(){last=body();return `<section class="tm-s sp" id="sp-panel"><h3>Music</h3><div id="sp-body">${last}</div></section>`}
/* updates only the panel, never the whole page, so typing in Session notes is not interrupted.
   Background updates wait while a slider or menu in the panel has focus; force=true (after a tap) redraws anyway. */
function refresh(force){
  refreshBar(force);
  const el=document.getElementById("sp-body");if(!el)return;
  const a=document.activeElement,busy=a&&el.contains(a)&&/^(INPUT|SELECT)$/.test(a.tagName);
  if(busy){if(!force)return;a.blur()}   /* after a tap, let go of focus so later updates are not blocked */
  const h=body();if(h===last&&el.innerHTML)return;el.innerHTML=last=h;
}
function onScreen(){
  const p=document.getElementById("sp-panel")||document.getElementById("sp-top");if(!p||document.hidden||!p.offsetParent)return false;
  const r=p.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
}
/* every 5 seconds while music plays, every 15 when idle, to save battery and data */
setInterval(()=>{
  if(!onScreen())return;
  const playing=ST.state&&ST.state.is_playing;
  if(!playing&&ST.last&&Date.now()-ST.last<15000)return;
  poll();
},5000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&onScreen())poll(true)});
function watch(){
  const tm=document.getElementById("tablemode");if(!tm)return setTimeout(watch,500);
  let t=null;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(()=>{if(onScreen()&&Date.now()-ST.last>3000)poll(true)},250)}).observe(tm,{childList:true});
}

async function act(f,okPoll){
  try{await f();ST.err=null}catch(e){ST.err=e.message||"Spotify error";say(ST.err)}
  refresh(true);setTimeout(()=>poll(),okPoll||700);
}
// the All playlists popup closes on a tap outside it or Escape
document.addEventListener("click",e=>{if(barOpen&&!e.target.closest(".sp-pop, [data-sp=all]")){barOpen=false;refreshBar(true)}},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&barOpen){barOpen=false;refreshBar(true);e.stopPropagation()}},true);
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-sp]");if(!t)return;
  e.preventDefault();e.stopPropagation();
  const a=t.dataset.sp,m=music();
  if(a==="connect")connect();
  else if(a==="disconnect"){disconnect();if(typeof campaignSheet==="function"&&!document.getElementById("modal").hidden)campaignSheet()}
  else if(a==="setup"){barOpen=false;openSetup()}
  else if(a==="all"){barOpen=!barOpen;refreshBar(true)}
  else if(a==="star")star(+t.dataset.i);
  else if(a==="play"){const x=m.items[+t.dataset.i];if(x)act(()=>playUri(x.uri))}
  else if(a==="toggle")act(()=>ST.state&&ST.state.is_playing?api("PUT","/me/player/pause"):playUri());
  else if(a==="next")act(()=>api("POST","/me/player/next"));
  else if(a==="up"||a==="down")moveRow(+t.dataset.i,a==="up"?-1:1);
},true);
document.addEventListener("change",e=>{
  const el=e.target;
  if(el.matches&&el.matches("[data-sp-vol]")){act(()=>api("PUT","/me/player/volume",{query:{volume_percent:el.value}}),500);return}
  if(el.matches&&el.matches("[data-sp-dev]")&&el.value){ls.set(DEVK,el.value);act(()=>api("PUT","/me/player",{body:{device_ids:[el.value],play:!!(ST.state&&ST.state.is_playing)}}),900)}
},true);
/* number keys 1 to 9 play the soundboard buttons while table mode is open */
document.addEventListener("keydown",e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||!/^[1-9]$/.test(e.key))return;
  if(!(document.getElementById("sp-panel")||document.getElementById("sp-top"))||!connected())return;
  const tm=document.getElementById("tablemode"),md=document.getElementById("modal");
  if(!tm||tm.hidden||(md&&!md.hidden))return;
  const a=document.activeElement;if(a&&(a.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))return;
  const x=music().items[+e.key-1];if(!x)return;
  e.preventDefault();act(()=>playUri(x.uri));
});

/* ---------- Campaign menu entry ---------- */
function menu(){
  const on=connected();
  return `<div class="taper"></div><h3 class="vh">Music (Spotify)</h3>
  <p class="tool-d">${on?"Spotify is connected on this device. The login stays here and is never saved in your campaign. To cut off access completely, also remove the app at spotify.com/account/apps.":"Connect Spotify once on each device. It uses your Premium account to start playlists on any device running Spotify."}${ls.get(EXP)&&!on?" The last sign-in expired.":""}</p>
  <div class="tool-acts">${on?`<button class="btn" data-sp="setup">Choose soundboard playlists</button><button class="btn" data-sp="disconnect">Disconnect Spotify</button>`:`<button class="btn" data-sp="connect">Connect Spotify</button>`}</div>`;
}

/* ---------- Music page: choose the soundboard ---------- */
let ED=null;
async function openSetup(){
  if(!connected()){connect();return}
  const note=inner=>showSheet(`<div class="sheet"><h2>Music soundboard</h2>${inner}<div class="foot"><span class="grow"></span><button type="button" class="btn" data-act="close">Close</button></div></div>`,true);
  note(`<p class="vempty">Loading your playlists…</p>`);
  let pls;
  try{pls=await playlists()}catch(e){note(`<p class="sp-err">${E(e.message)}</p>`);return}
  const m=JSON.parse(JSON.stringify(music())),rows=[],seen=new Set();
  m.items.forEach(x=>{const p=pls.find(q=>q.id===x.id);seen.add(x.id);rows.push({id:x.id,uri:x.uri,name:p?p.name:"(no longer in your library)",on:true,label:x.label||"",group:x.group||"Mood"})});
  pls.forEach(p=>{if(!seen.has(p.id))rows.push({id:p.id,uri:p.uri,name:p.name,on:false,label:"",group:"Mood"})});
  ED={rows,def:m.def};drawSetup();
}
function drawSetup(){
  const n=ED.rows.filter(r=>r.on).length;
  showSheet(`<form class="sheet" data-spform><h2>Music soundboard</h2>
  <p class="tool-d">Tick the playlists you want as buttons (${n} chosen). Give each a short label and a mood group, set the order, and mark one as the safe default. Buttons 1 to 9 follow this order.</p>
  <div class="sp-rows">${ED.rows.map((r,i)=>`<div class="sp-row${r.on?" on":""}">
    <label class="sp-tick"><input type="checkbox" data-spr="on" data-i="${i}" ${r.on?"checked":""}><span class="sp-nm">${E(r.name)}</span></label>
    <input data-spr="label" data-i="${i}" value="${E(r.label)}" maxlength="24" placeholder="Short label" aria-label="Label">
    <select data-spr="group" data-i="${i}" aria-label="Mood group">${GROUPS.map(g=>`<option ${g===r.group?"selected":""}>${g}</option>`).join("")}</select>
    <span class="sp-mv"><button type="button" class="btn sm" data-sp="up" data-i="${i}" aria-label="Move up">↑</button><button type="button" class="btn sm" data-sp="down" data-i="${i}" aria-label="Move down">↓</button></span>
    <label class="sp-def"><input type="radio" name="spdef" data-spr="def" data-i="${i}" ${ED.def===r.id?"checked":""}> Default</label></div>`).join("")}</div>
  <div class="foot"><span class="grow"></span><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`,true);
}
function moveRow(i,d){
  if(!ED)return;const j=i+d;if(j<0||j>=ED.rows.length)return;
  const sc=document.querySelector("#modal .sheet");const y=sc?sc.scrollTop:0;
  [ED.rows[i],ED.rows[j]]=[ED.rows[j],ED.rows[i]];drawSetup();
  const s2=document.querySelector("#modal .sheet");if(s2)s2.scrollTop=y;
}
document.addEventListener("input",e=>{const el=e.target;if(!ED||!el.dataset||!el.dataset.spr)return;const r=ED.rows[+el.dataset.i];if(!r)return;
  if(el.dataset.spr==="label")r.label=el.value;
  else if(el.dataset.spr==="group")r.group=el.value;
  else if(el.dataset.spr==="on"){r.on=el.checked;el.closest(".sp-row").classList.toggle("on",r.on)}
  else if(el.dataset.spr==="def"){ED.def=r.id;r.on=true;const c=el.closest(".sp-row").querySelector('[data-spr="on"]');if(c)c.checked=true}
},true);
document.addEventListener("submit",async e=>{
  const f=e.target.closest("[data-spform]");if(!f)return;
  e.preventDefault();e.stopPropagation();
  if(!ED)return;
  const was=music().items;const items=ED.rows.filter(r=>r.on).map(r=>({id:r.id,uri:r.uri,label:(r.label||r.name).trim().slice(0,24),group:r.group,...((was.find(x=>x.id===r.id)||{}).fav?{fav:true}:{})}));
  const def=items.some(x=>x.id===ED.def)?ED.def:"";
  try{await save("settings","music",{items,def,updated:Date.now()})}
  catch(_){say("Could not save the soundboard. Your choices are still on screen");return}
  ED=null;closeSheet();say("Soundboard saved");
  if(typeof TM!=="undefined"&&TM&&typeof renderTable==="function")renderTable();
},true);

/* ---------- the Session Table's top-bar music (design screen A) ----------
   Play or pause, what's on, starred playlists in the bar, and All playlists with a star to keep one in the bar. Stars save in settings/music (item.fav). */
let barOpen=false,lastBar="";
const favs=()=>{const it=music().items.map((x,i)=>({x,i})),f=it.filter(o=>o.x.fav);return f.length?f:it.slice(0,5)};
function barBody(){
  if(!cid())return `<span class="sp-off">Music isn't set up (see SETUP.md)</span>`;
  if(!connected())return `<button type="button" class="btn sm" data-sp="connect">Connect Spotify</button>`;
  const m=music(),s=ST.state,it=s&&s.item,ctx=s&&s.context&&s.context.uri,on=!!(s&&s.is_playing);
  const ico=on?'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>':'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
  const grp={};m.items.forEach((x,i)=>{const g=GROUPS.includes(x.group)?x.group:"Mood";(grp[g]=grp[g]||[]).push({x,i})});
  return `<button type="button" class="sp-pp" data-sp="toggle" aria-label="${on?"Pause music":"Play music"}">${ico}</button>
    <span class="sp-now"><small>${on?"Playing":s&&it?"Paused":"Nothing playing"}${label(ctx)?` · ${E(label(ctx))}`:""}</small><b>${it?E(it.name):"—"}</b></span>
    <div class="sp-favs" aria-label="Favourite playlists, scroll sideways for more">${favs().map(o=>`<button type="button" data-sp="play" data-i="${o.i}" aria-pressed="${ctx===o.x.uri}">${E(o.x.label||"Playlist")}</button>`).join("")}</div>
    <button type="button" class="sp-all" data-sp="all" aria-expanded="${barOpen}">All playlists ▾</button>
    ${barOpen?`<div class="sp-pop"><div class="sp-poph"><b>All playlists</b><small>Tap to play · ★ to keep it in the top bar</small></div>${m.items.length?`<div class="sp-popg">${GROUPS.filter(g=>grp[g]).map(g=>`<div><span class="sp-gl">${g}</span>${grp[g].map(o=>`<div class="sp-pr"><button type="button" data-sp="play" data-i="${o.i}">${E(o.x.label||"Playlist")}</button><button type="button" class="sp-star" data-sp="star" data-i="${o.i}" aria-pressed="${!!o.x.fav}" aria-label="${o.x.fav?"Take out of":"Keep in"} the top bar: ${E(o.x.label||"Playlist")}">★</button></div>`).join("")}</div>`).join("")}</div>`:`<p class="vempty">No playlists chosen yet.</p>`}<div class="sp-bar"><button type="button" class="btn sm" data-sp="setup">Choose playlists</button></div></div>`:""}
    ${ST.err?`<span class="sp-err">${E(ST.err)}</span>`:""}`;
}
function bar(){lastBar=barBody();return `<div id="sp-top" class="sp-top" role="group" aria-label="Music">${lastBar}</div>`}
function refreshBar(force){const el=document.getElementById("sp-top");if(!el)return;if(!force&&el.contains(document.activeElement))return;const h=barBody();if(h===lastBar&&el.innerHTML)return;el.innerHTML=lastBar=h}
async function star(i){const m=music(),items=m.items.map((x,j)=>j===i?{...x,fav:!x.fav}:x);
  try{await save("settings","music",{items,def:m.def,updated:Date.now()})}catch(_){say("Could not save the star");return}
  if(typeof project==="function")project();refreshBar(true)}
/* ---------- styles for the panel and the page ---------- */
const css=document.createElement("style");css.textContent=`
.sp-np{font-size:18px;margin-bottom:8px;line-height:1.3}.sp-np small{color:var(--muted)}
.sp-g{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}
.sp-gl{font:700 12px var(--ui);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);flex:0 0 100%}
.sp-b{min-height:48px;padding:4px 14px;font-size:15px}
.sp-bar .btn,.sp-mv .btn{min-height:48px}.sp-mv .btn{min-width:48px}
.sp-bar select{min-height:44px}
.sp-b i{font:700 11px var(--ui);opacity:.65;margin-right:6px;font-style:normal}
.sp-b.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.sp-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.sp-bar select{flex:1 1 140px;min-width:0;max-width:100%}
.sp-bar input[type=range]{flex:1 1 120px;min-width:80px;height:32px}
.sp-err{color:var(--blood);font-size:14px;margin:8px 0 0}
.sp-rows{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.sp-row{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;padding:6px 8px;border:1px solid var(--line);opacity:.75}
.sp-row.on{opacity:1;background:var(--paper)}
.sp-tick{display:flex;gap:8px;align-items:center;flex:1 1 100%;min-width:0}.sp-nm{overflow-wrap:anywhere}
.sp-row input[data-spr=label]{flex:1 1 130px;min-width:0}
.sp-mv{display:flex;gap:4px}.sp-def{font-size:14px;display:flex;gap:6px;align-items:center;min-height:48px}
`;
document.head.appendChild(css);

window.DeskSpotify={panel,bar,menu,connect,disconnect,connected,poll,state:ST};
handleReturn();watch();
})();
