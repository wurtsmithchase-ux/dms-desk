/* DM's Desk storage: a copy on this device, saved to one file in the user's Google Drive.
   The rest of the Desk talks to it through the same small db interface it always used. */
(function(){
  const CFG=window.DESK_CONFIG||{};
  const FILE_NAME="dms-desk-campaign.json";
  const SCOPE="https://www.googleapis.com/auth/drive.file";
  const SAVE_DELAY=1500;
  const TOKEN_KEY="desk.token";
  const ACCOUNT_KEY="desk.account";
  const RENEW_EARLY=5*60*1000;
  const RENEW_PAUSE=10*60*1000;
  /* A stored sign-in this close to ending is treated as already over, so a request never starts with one about to lapse.
     It is much smaller than RENEW_EARLY: renewal is offered from 5 minutes out, and this is the last-moment cutoff. */
  const TOKEN_SLACK=30*1000;

  /* ---------- Google Drive ---------- */
  const API="https://www.googleapis.com";
  let token=null;
  /* when the sign-in ends, also kept in memory in case the browser blocks storage (a private window, say) */
  let tokenExp=0;
  const failure=(code,message,extra)=>Object.assign(new Error(message||code),{code,...extra});
  function readToken(){
    try{
      const t=JSON.parse(localStorage.getItem(TOKEN_KEY)||"null");
      if(t&&t.exp>Date.now()+TOKEN_SLACK){tokenExp=t.exp;return t.value}
    }catch(_){}
    return null}
  function keepToken(value,seconds){
    token=value;tokenExp=Date.now()+seconds*1000;
    try{localStorage.setItem(TOKEN_KEY,JSON.stringify({value,exp:tokenExp}))}catch(_){}}
  function dropToken(){
    token=null;tokenExp=0;
    try{localStorage.removeItem(TOKEN_KEY)}catch(_){}}
  /* Google's sign-in for browser-only apps lasts about an hour and can't renew itself.
     The Desk renews it on the user's next tap instead (see "renewing sign-in" below). */
  function tokenEndsSoon(){
    let exp=token?tokenExp:0;
    try{const t=JSON.parse(localStorage.getItem(TOKEN_KEY)||"null");if(t&&t.exp>exp)exp=t.exp}catch(_){}
    return exp<Date.now()+RENEW_EARLY}
  /* the account's email, kept on this device only, so renewing skips Google's account picker */
  function account(){try{return localStorage.getItem(ACCOUNT_KEY)||""}catch(_){return""}}
  async function rememberAccount(){
    try{const r=await(await call(`${API}/drive/v3/about?fields=user(emailAddress)`)).json();
      if(r.user&&r.user.emailAddress)localStorage.setItem(ACCOUNT_KEY,r.user.emailAddress)}
    catch(e){console.warn("Desk couldn't note the Google account",e)}}
  let gisLoading=null;
  function gisReady(){return gisLoading||(gisLoading=new Promise((ok,bad)=>{
    if(window.google&&google.accounts&&google.accounts.oauth2)return ok();
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";
    s.onload=()=>ok();
    s.onerror=()=>{s.remove();gisLoading=null;bad(failure("offline"))};
    document.head.appendChild(s)}))}
  /* only one sign-in attempt at a time, whoever asks (a tap, the pill or the sign-in screen) */
  let signingIn=null;
  function signIn(){
    if(!signingIn)signingIn=doSignIn().finally(()=>{signingIn=null});
    return signingIn}
  async function doSignIn(){
    await gisReady();
    return new Promise((ok,bad)=>{
      const hint=account();
      const c=google.accounts.oauth2.initTokenClient({client_id:CFG.googleClientId,scope:SCOPE,...(hint?{login_hint:hint}:{}),
        callback:r=>{if(r&&r.access_token){keepToken(r.access_token,Number(r.expires_in)||3600);if(!hint)rememberAccount();ok()}else bad(failure("declined"))},
        /* a blocked popup isn't the user saying no, so it gets its own code */
        error_callback:e=>bad(failure(e&&e.type==="popup_failed_to_open"?"blocked":"declined"))});
      c.requestAccessToken({prompt:""})})}
  async function call(url,opts,retried){
    if(!token)throw failure("signin");
    const used=token;
    let r;
    /* only a failed network request counts as offline; any other TypeError is a bug and should surface as an error */
    try{r=await fetch(url,{...opts,headers:{...(opts&&opts.headers),Authorization:"Bearer "+used}})}
    catch(_){throw failure("offline")}
    if(r.status===401){
      /* the sign-in was renewed while this request was in flight: try once with the new one, and never delete it */
      if(token&&token!==used&&!retried)return call(url,opts,true);
      if(token===used)dropToken();
      throw failure("signin")}
    if(!r.ok)throw failure("drive","drive "+r.status,{status:r.status});
    return r}
  function multipart(meta,text,type="application/json"){
    const b="desk"+Math.random().toString(36).slice(2);
    return{type:"multipart/related; boundary="+b,body:`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`}}
  const quote=s=>"'"+String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'")+"'";
  const FOLDER="application/vnd.google-apps.folder",GDOC="application/vnd.google-apps.document";
  async function query(q,fields="id,name,md5Checksum,parents"){
    const out=[];let page="";
    do{const r=await(await call(`${API}/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=1000&fields=nextPageToken,files(${fields})${page?"&pageToken="+encodeURIComponent(page):""}`)).json();
      out.push(...(r.files||[]));page=r.nextPageToken||""}while(page);
    return out}
  /* "version" here means a fingerprint of the contents. Drive's own version number also rises for changes that aren't to the contents, which looked like edits from another device. */
  const tagged=f=>({id:f.id,version:f.md5Checksum});
  const googleDrive={
    hasToken:()=>!!(token=token||readToken()),
    signIn,
    /* true when this device has signed in before and the sign-in ends within five minutes or already has */
    renewDue:()=>!!account()&&tokenEndsSoon(),
    preload:()=>gisReady().catch(()=>{}),
    async find(){
      const q=encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
      const r=await(await call(`${API}/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,md5Checksum)`)).json();
      return r.files&&r.files[0]?tagged(r.files[0]):null},
    async version(id){return(await(await call(`${API}/drive/v3/files/${id}?fields=md5Checksum`)).json()).md5Checksum},
    async oldVersion(id){return(await(await call(`${API}/drive/v3/files/${id}?fields=version`)).json()).version},
    async read(id){return(await call(`${API}/drive/v3/files/${id}?alt=media`)).text()},
    async create(name,text,parent){const m=multipart({name,mimeType:"application/json",...(parent?{parents:[parent]}:{})},text);
      return tagged(await(await call(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum`,{method:"POST",headers:{"Content-Type":m.type},body:m.body})).json())},
    async update(id,text){
      return tagged(await(await call(`${API}/upload/drive/v3/files/${id}?uploadType=media&fields=id,md5Checksum`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:text})).json())},
    /* folders and text files; the drive.file permission only shows files this app made */
    async folder(name,parent){
      const q=`name=${quote(name)} and mimeType='${FOLDER}' and trashed=false`+(parent?` and ${quote(parent)} in parents`:"");
      const f=(await query(q,"id"))[0];if(f)return f.id;
      return(await(await call(`${API}/drive/v3/files?fields=id`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:FOLDER,...(parent?{parents:[parent]}:{})})})).json()).id},
    async parents(id){return(await(await call(`${API}/drive/v3/files/${id}?fields=parents`)).json()).parents||[]},
    async move(id,to,from){await call(`${API}/drive/v3/files/${id}?addParents=${encodeURIComponent(to)}${from&&from.length?"&removeParents="+encodeURIComponent(from.join(",")):""}&fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"})},
    async named(prefix){return(await query(`name contains ${quote(prefix)} and trashed=false`)).filter(f=>f.name.startsWith(prefix)).map(f=>({id:f.id,parents:f.parents||[]}))},
    /* props are Drive appProperties: hidden tags the Desk puts on its text files (which entry, and a fingerprint of what it wrote) */
    /* doc: a Google Doc, which has no md5Checksum, so textfiles.js compares its exported text instead; mod is Drive's modifiedTime */
    async list(folder){return(await query(`${quote(folder)} in parents and trashed=false`,"id,name,md5Checksum,mimeType,modifiedTime,appProperties")).map(f=>({id:f.id,name:f.name,md5:f.md5Checksum,doc:f.mimeType===GDOC,mod:f.modifiedTime,props:f.appProperties||{}}))},
    /* asDoc: a new file becomes a Google Doc (Drive converts the plain text), so Claude can edit it. An existing Doc stays one.
       modifiedTime is set to the Desk's write time, so a later edit by anyone else shows as a newer time */
    async writeText(id,name,text,parent,props,asDoc){
      const t=props&&props.t?{modifiedTime:new Date(+props.t).toISOString()}:{};
      const meta={name,appProperties:props,...t};
      /* only a new file gets a type and a folder; Drive converts the plain text to a Doc when mimeType is GDOC */
      if(!id)Object.assign(meta,{mimeType:asDoc?GDOC:"text/plain",parents:[parent]});
      const m=multipart(meta,text,"text/plain");
      const r=await(await call(`${API}/upload/drive/v3/files${id?"/"+id:""}?uploadType=multipart&fields=id,md5Checksum,modifiedTime`,{method:id?"PATCH":"POST",headers:{"Content-Type":m.type},body:m.body})).json();
      if(t.modifiedTime&&r.modifiedTime&&Date.parse(r.modifiedTime)!==Date.parse(t.modifiedTime))console.info("Desk text files: Drive kept its own modified time for",name);
      return{id:r.id,md5:r.md5Checksum,mod:r.modifiedTime}},
    async readText(id,doc){return(await call(doc?`${API}/drive/v3/files/${id}/export?mimeType=text%2Fplain`:`${API}/drive/v3/files/${id}?alt=media`)).text()},
    /* hidden tags only; modifiedTime is sent back unchanged so the file doesn't look edited. Returns the modified time Drive ended up with */
    async tag(id,props,mod){return(await(await call(`${API}/drive/v3/files/${id}?fields=id,modifiedTime`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({appProperties:props,...(mod?{modifiedTime:mod}:{})})})).json()).modifiedTime},
    async trash(id){await call(`${API}/drive/v3/files/${id}?fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})})}
  };
  const drive=window.DESK_DRIVE||(CFG.googleClientId?googleDrive:null);

  /* ---------- the copy on this device ---------- */
  const IDB="desk-store";
  function idb(){return new Promise((ok,bad)=>{const r=indexedDB.open(IDB,1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)})}
  async function localGet(){try{const d=await idb();return await new Promise(ok=>{const q=d.transaction("kv").objectStore("kv").get("campaign");q.onsuccess=()=>ok(q.result||null);q.onerror=()=>ok(null)})}catch(_){return null}}
  async function localPut(v){try{const d=await idb();await new Promise(ok=>{const t=d.transaction("kv","readwrite");t.objectStore("kv").put(v,"campaign");t.oncomplete=ok;t.onerror=ok})}catch(_){}}

  /* ---------- state ---------- */
  const st={docs:{},fileId:null,base:null,sent:null,dirty:false,busy:false,again:false,timer:null,status:"",conflict:false};
  const subs=new Map();
  const deep=o=>JSON.parse(JSON.stringify(o));
  function freeze(o){if(o&&typeof o==="object"){Object.values(o).forEach(freeze);Object.freeze(o)}return o}
  const snap=path=>({docs:Object.entries(st.docs[path]||{}).map(([id,d])=>({id,data:()=>d}))});
  const fire=path=>(subs.get(path)||[]).forEach(cb=>cb(snap(path)));
  const fireAll=()=>subs.forEach((_,p)=>fire(p));
  const serialize=(saved=new Date().toISOString())=>JSON.stringify({app:"dm-desk-store",version:1,saved,docs:st.docs});
  function adopt(text){
    const d=JSON.parse(text);if(!d||!d.docs)throw new Error("bad file");
    Object.values(d.docs).forEach(c=>Object.values(c).forEach(freeze));st.docs=d.docs}
  /* Writing the whole campaign to the device on every keystroke-sized change is wasteful, so edits are batched. remember() writes now and cancels any batched write. */
  const REMEMBER_DELAY=300;
  let rememberTimer=null;
  const remember=()=>{clearTimeout(rememberTimer);rememberTimer=null;return localPut({docs:st.docs,fileId:st.fileId,base:st.base,sent:st.sent,dirty:st.dirty})};
  const rememberSoon=()=>{if(!rememberTimer)rememberTimer=setTimeout(remember,REMEMBER_DELAY)};
  const flushRemember=()=>{if(rememberTimer)remember()};

  /* ---------- status pill and sign-in screen ---------- */
  const STYLE=`#ds-pill{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9000;font:600 12px/1.2 system-ui,sans-serif;padding:7px 10px;border-radius:999px;background:#2b2118;color:#f6ecd8;box-shadow:0 2px 8px #0005;border:0;opacity:.92}
#ds-pill.warn{background:#8a2c1d;color:#fff}#ds-pill.ok{opacity:.55}
@media (max-width:640px){#ds-pill{bottom:calc(78px + env(safe-area-inset-bottom))}}
body:has(#tablemode:not([hidden])) #ds-pill.ok{display:none}
#ds-gate{position:fixed;inset:0;z-index:9500;background:#1f1812;color:#f6ecd8;display:flex;align-items:center;justify-content:center;padding:20px;font:16px/1.5 system-ui,sans-serif}
#ds-gate>div{max-width:440px;width:100%;background:#2b2118;border:1px solid #5a4632;border-radius:12px;padding:24px}
#ds-gate h2{margin:0 0 8px;font-size:22px}#ds-gate p{margin:0 0 14px}
#ds-gate button{display:block;width:100%;margin-top:10px;padding:12px;border-radius:8px;border:1px solid #8a6f4d;background:#3a2c20;color:#f6ecd8;font:600 15px system-ui,sans-serif;cursor:pointer}
#ds-gate button.main{background:#c9a35c;color:#1f1812;border-color:#c9a35c}`;
  function pill(){let p=document.getElementById("ds-pill");if(!p){const s=document.createElement("style");s.textContent=STYLE;document.head.appendChild(s);p=document.createElement("button");p.id="ds-pill";p.type="button";p.onclick=()=>{if(st.status==="signin")reauth();else if(st.status==="offline"||st.status==="error")saveNow()};document.body.appendChild(p)}return p}
  const STATUS_TEXT={
    saved:["Saved to Drive","ok"],
    saving:["Saving...",""],
    pending:["Not saved yet",""],
    offline:["Offline: saved on this device only. Tap to retry","warn"],
    signin:["Sign in to save to Drive","warn"],
    error:["Couldn't save to Drive. Tap to retry","warn"],
    local:["This device only","warn"],
    conflict:["Choose which version to keep","warn"]};
  function setStatus(s){
    st.status=s;
    const p=pill(),m=STATUS_TEXT[s]||["",""];
    p.textContent=m[0];p.className=m[1];p.hidden=!m[0]}
  function gate(html){let g=document.getElementById("ds-gate");if(!g){g=document.createElement("div");g.id="ds-gate";document.body.appendChild(g)}g.innerHTML=`<div>${html}</div>`;return g}
  const ungate=()=>document.getElementById("ds-gate")?.remove();
  const btn=(g,id,fn)=>{const b=g.querySelector("#"+id);if(b)b.onclick=fn};

  /* ---------- the DM's Desk folder in Drive ---------- */
  const HOME_NAME="DM's Desk",TEXT_NAME="Campaign text";
  let homeP=null,textP=null,tidied=false;
  const canFolders=()=>!!(drive&&drive.folder);
  function home(){if(!homeP)homeP=drive.folder(HOME_NAME).catch(e=>{homeP=null;throw e});return homeP}
  function textFolder(){if(!textP)textP=home().then(h=>drive.folder(TEXT_NAME,h)).catch(e=>{textP=null;throw e});return textP}
  const homeOrRoot=()=>canFolders()?home().catch(()=>undefined):undefined;
  /* moves the campaign file and old conflict copies into the folder; it never holds up saving */
  async function tidy(){
    if(tidied||!canFolders()||!st.fileId||!drive.hasToken())return;tidied=true;
    try{
      const h=await home(),p=await drive.parents(st.fileId);
      if(!p.includes(h))await drive.move(st.fileId,h,p);
      for(const f of await drive.named("dms-desk-conflict-"))if(!f.parents.includes(h))await drive.move(f.id,h,f.parents);
    }catch(e){tidied=false;console.warn("Desk folder tidy failed",e)}}

  /* ---------- sync ---------- */
  let rechecking=false;
  function handle(e){
    if(e&&e.code==="signin"&&drive.hasToken()&&!rechecking){
      /* a fresh sign-in arrived while the request was failing, so don't ask again: just try once more */
      rechecking=true;setStatus("pending");
      setTimeout(()=>{sync().finally(()=>{rechecking=false})},0)}
    else if(e&&e.code==="signin")setStatus("signin");
    else if(!navigator.onLine||(e&&e.code==="offline"))setStatus("offline");
    else{console.error("Desk sync error",e);setStatus("error")}}
  async function reauth(){try{await drive.signIn();await sync()}catch(e){handle(e)}}
  function askConflict(){
    st.conflict=true;setStatus("conflict");
    const g=gate(`<h2>Two versions of your campaign</h2><p>Drive has changes from another device, and this device has changes that were never saved. Pick one to keep. The other is saved to Drive as a dated copy, so nothing is lost.</p><button class="main" id="ds-drive">Use the Drive version</button><button id="ds-local">Keep this device's version</button>`);
    btn(g,"ds-drive",()=>resolve("drive"));btn(g,"ds-local",()=>resolve("local"))}
  async function resolve(pick){
    const stamp=new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
    try{
      const remote=await drive.read(st.fileId);
      const where=await homeOrRoot();
      if(pick==="drive"){await drive.create(`dms-desk-conflict-${stamp}-this-device.json`,serialize(),where);adopt(remote);st.base=await drive.version(st.fileId);st.dirty=false;fireAll()}
      else{await drive.create(`dms-desk-conflict-${stamp}-from-drive.json`,remote,where);st.base=await drive.version(st.fileId);st.dirty=true}
      st.conflict=false;ungate();await remember();
      if(st.dirty)await saveNow();else setStatus("saved")
    }catch(e){st.conflict=false;ungate();handle(e)}}
  /* Drive differs from what this device last knew. It's only a real clash if someone else wrote it: a save whose reply never arrived (page closed or phone sleeping) leaves Drive holding this device's own work. */
  function driveIsMine(text){
    /* a file that can't be read can't be this device's save, so it goes to the two-versions prompt, where keeping this device's version repairs it */
    try{const d=JSON.parse(text);return !!st.sent&&d.saved===st.sent||JSON.stringify(d.docs)===JSON.stringify(st.docs)}
    catch(_){return false}}
  /* Drive's current fingerprint. Device copies from before fingerprints hold Drive's version number as their base: if that number hasn't moved, Drive hasn't changed. */
  async function driveVersion(){
    const v=await drive.version(st.fileId);
    if(v!==st.base&&st.base!=null&&drive.oldVersion&&!/^[0-9a-f]{32}$/.test(st.base)&&await drive.oldVersion(st.fileId)===st.base)st.base=v;
    return v}
  /* line this device up with Drive; used on opening and whenever the Desk comes back into view */
  /* The work of one sync. Returns a function to run once the lock is released (or nothing). */
  async function syncStep(){
    if(!st.fileId){
      const f=await drive.find();
      if(f){
        st.fileId=f.id;
        const text=await drive.read(f.id);
        if(st.dirty&&Object.keys(st.docs).length){
          if(!driveIsMine(text)){st.base=null;return askConflict}
          st.base=f.version;return saveNow}
        adopt(text);st.base=f.version;st.dirty=false;await remember();fireAll();setStatus("saved");
        return}
      st.sent=new Date().toISOString();await remember();
      const c=await drive.create(FILE_NAME,serialize(st.sent),await homeOrRoot());
      st.fileId=c.id;st.base=c.version;st.dirty=false;await remember();setStatus("saved");
      return}
    const v=await driveVersion();
    if(v!==st.base){
      /* read before looking at dirty: an edit made during the download must not be replaced by it */
      const text=await drive.read(st.fileId);
      if(st.dirty){if(!driveIsMine(text))return askConflict;st.base=v}
      else{adopt(text);st.base=v;await remember();fireAll()}}
    if(st.dirty)return saveNow;
    setStatus("saved")}
  async function sync(){
    if(!drive||st.busy||st.conflict)return;
    st.busy=true;
    let next=null;
    try{next=await syncStep()}
    catch(e){
      if(e&&e.status===404){st.fileId=null;st.base=null;st.dirty=true;next=sync}
      else handle(e)}
    finally{st.busy=false}
    if(st.fileId&&!st.conflict)tidy();
    /* a save asked for while this sync was running still has to happen */
    const waiting=st.again;st.again=false;
    if(!next&&waiting&&st.dirty&&!st.conflict)next=saveNow;
    if(next)return next()}
  async function saveNow(){
    clearTimeout(st.timer);st.timer=null;
    if(!drive){setStatus("local");return}
    if(st.busy){st.again=true;return}
    if(!st.dirty||st.conflict)return;
    if(!drive.hasToken()){setStatus("signin");return}
    if(!st.fileId||st.base==null){return sync()}
    st.busy=true;setStatus("saving");
    let next=null,sent=false;
    try{
      const v=await driveVersion();
      if(v!==st.base&&!driveIsMine(await drive.read(st.fileId)))next=askConflict;
      else{
        st.base=v;
        /* note the save before sending it, so a lost reply can be recognized after a reopen */
        st.sent=new Date().toISOString();await remember();
        const text=serialize(st.sent);st.dirty=false;
        const r=await drive.update(st.fileId,text);
        st.base=r.version;await remember();sent=true}
    }catch(e){st.dirty=true;await remember();handle(e)}
    finally{st.busy=false}
    if(next)return next();
    if(!sent)return;
    if(st.dirty||st.again){st.again=false;st.dirty=true;return saveNow()}
    setStatus("saved")}
  function changed(path){
    fire(path);st.dirty=true;rememberSoon();
    if(!drive){setStatus("local");return}
    setStatus("pending");clearTimeout(st.timer);st.timer=setTimeout(saveNow,SAVE_DELAY)}
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden"){flushRemember();if(st.dirty)saveNow()}
    else if(drive&&drive.hasToken())sync()});
  window.addEventListener("pagehide",flushRemember);

  /* ---------- renewing sign-in ----------
     Browsers only let a sign-in popup open straight after a tap, so renewal waits for the next one.
     Google already knows the account, so the popup usually closes by itself. Taps on the sign-in
     buttons are left alone because they sign in themselves. If renewal fails, it waits ten minutes
     before trying again, and the "Sign in to save to Drive" notice still works. */
  let renewing=false,renewAfter=0;
  document.addEventListener("click",e=>{
    if(!drive||typeof drive.renewDue!=="function"||renewing||st.conflict||!navigator.onLine||Date.now()<renewAfter)return;
    if(document.getElementById("ds-gate")||(e.target.closest&&e.target.closest("#ds-pill")))return;
    if(!drive.renewDue())return;
    renewing=true;
    drive.signIn()
      .then(()=>{if(st.status==="signin"||st.dirty)sync()},err=>{
        console.warn("Desk couldn't renew the sign-in",err);
        /* a blocked popup isn't a refusal, so the next tap may try again straight away */
        if(!(err&&err.code==="blocked"))renewAfter=Date.now()+RENEW_PAUSE})
      .finally(()=>{renewing=false})},true);
  window.addEventListener("online",()=>{if(drive&&drive.hasToken())sync()});
  window.addEventListener("beforeunload",e=>{if(st.dirty&&drive){saveNow();e.preventDefault();e.returnValue=""}});

  /* ---------- the db interface the Desk already uses ---------- */
  const db={collection(path){const q=filter=>({get:async()=>({docs:snap(path).docs.filter(filter)})});return{
    doc(id){return{
      set:async d=>{(st.docs[path]=st.docs[path]||{})[id]=freeze(deep(d));changed(path)},
      delete:async()=>{if(st.docs[path]&&id in st.docs[path]){delete st.docs[path][id];changed(path)}}}},
    onSnapshot(cb){if(!subs.has(path))subs.set(path,[]);subs.get(path).push(cb);setTimeout(()=>cb(snap(path)),0);return()=>{subs.set(path,subs.get(path).filter(x=>x!==cb))}},
    get:async()=>snap(path),
    where(f,_op,v){return q(d=>d.data()[f]===v)}}}};

  /* ---------- images are shrunk and kept inside the campaign file ---------- */
  const assets={upload:f=>new Promise((ok,bad)=>{
    if(!/^image\/(png|jpeg|webp|gif)$/.test(f.type))return bad({code:"unsupported_type"});
    const url=URL.createObjectURL(f),img=new Image();
    img.onerror=()=>{URL.revokeObjectURL(url);bad({code:"bad_image"})};
    img.onload=()=>{const max=1600,k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");
      c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);let d=c.toDataURL("image/webp",.82);if(!d.startsWith("data:image/webp"))d=c.toDataURL("image/jpeg",.82);ok({id:d,url:d})};
    img.src=url})};
  const downloads={save:async({filename,data})=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type:"application/json"}));a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}};

  /* ---------- opening ---------- */
  function waitForSignIn(){return new Promise(done=>{
    const g=gate(`<h2>DM's Desk</h2><p>Sign in with the Google account that holds your campaign.</p><button class="main" id="ds-in">Sign in with Google</button><p id="ds-msg"></p>`);
    btn(g,"ds-in",async()=>{const m=g.querySelector("#ds-msg");m.textContent="";try{await drive.signIn();ungate();done()}catch(_){m.textContent=navigator.onLine?"Sign-in didn't finish. Try again.":"You're offline. Connect to sign in."}})})}
  async function open(){
    pill();
    const c=await localGet();
    if(c&&c.docs){Object.values(c.docs).forEach(col=>Object.values(col).forEach(freeze));Object.assign(st,{docs:c.docs,fileId:c.fileId||null,base:c.base??null,sent:c.sent||null,dirty:!!c.dirty})}
    if(!drive){setStatus("local");return db}
    /* load Google's sign-in code now, so a later renewal opens its popup during the tap */
    if(drive.preload)drive.preload();
    if(!drive.hasToken()){
      if(c&&c.docs&&!navigator.onLine){setStatus("offline");return db}
      await waitForSignIn()}
    await sync();
    return db}

  /* ---------- campaign text files, used by textfiles.js ---------- */
  const files={
    available:()=>canFolders()&&!!drive.writeText,
    signedIn:()=>!!(drive&&drive.hasToken()),
    folder:textFolder,
    list:async()=>drive.list(await textFolder()),
    read:(id,doc)=>drive.readText?drive.readText(id,doc):drive.read(id),
    write:async(id,name,text,props,asDoc)=>drive.writeText(id,name,text,id?null:await textFolder(),props,asDoc),
    tag:(id,props,mod)=>drive.tag?drive.tag(id,props,mod):Promise.resolve(),
    trash:id=>drive.trash(id)};

  window.DeskStore={open,assets,downloads,files,status:()=>st.status,saveNow};
})();
