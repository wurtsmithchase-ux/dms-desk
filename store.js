/* DM's Desk storage: a copy on this device, saved to one file in the user's Google Drive.
   The rest of the Desk talks to it through the same small db interface it always used. */
(function(){
  const CFG=window.DESK_CONFIG||{};
  const FILE_NAME="dms-desk-campaign.json";
  const SCOPE="https://www.googleapis.com/auth/drive.file";
  const SAVE_DELAY=1500;
  const TOKEN_KEY="desk.token";

  /* ---------- Google Drive ---------- */
  const API="https://www.googleapis.com";
  let token=null;
  function readToken(){try{const t=JSON.parse(localStorage.getItem(TOKEN_KEY)||"null");if(t&&t.exp>Date.now()+30000)return t.value}catch(_){}return null}
  function keepToken(value,seconds){token=value;try{localStorage.setItem(TOKEN_KEY,JSON.stringify({value,exp:Date.now()+seconds*1000}))}catch(_){}}
  function dropToken(){token=null;try{localStorage.removeItem(TOKEN_KEY)}catch(_){}}
  function gisReady(){return new Promise((ok,bad)=>{
    if(window.google&&google.accounts&&google.accounts.oauth2)return ok();
    const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.onload=()=>ok();s.onerror=()=>bad(new Error("offline"));document.head.appendChild(s)})}
  async function signIn(){
    await gisReady();
    return new Promise((ok,bad)=>{
      const c=google.accounts.oauth2.initTokenClient({client_id:CFG.googleClientId,scope:SCOPE,
        callback:r=>{if(r&&r.access_token){keepToken(r.access_token,Number(r.expires_in)||3600);ok()}else bad(new Error("declined"))},
        error_callback:()=>bad(new Error("declined"))});
      c.requestAccessToken({prompt:""})})}
  async function call(url,opts){
    if(!token)throw Object.assign(new Error("signin"),{code:"signin"});
    const r=await fetch(url,{...opts,headers:{...(opts&&opts.headers),Authorization:"Bearer "+token}});
    if(r.status===401){dropToken();throw Object.assign(new Error("signin"),{code:"signin"})}
    if(!r.ok)throw Object.assign(new Error("drive "+r.status),{code:"drive",status:r.status});
    return r}
  function multipart(meta,text){
    const b="desk"+Math.random().toString(36).slice(2);
    return{type:"multipart/related; boundary="+b,body:`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`}}
  /* "version" here means a fingerprint of the contents. Drive's own version number also rises for changes that aren't to the contents, which looked like edits from another device. */
  const tagged=f=>({id:f.id,version:f.md5Checksum});
  const googleDrive={
    hasToken:()=>!!(token=token||readToken()),
    signIn,
    async find(){
      const q=encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
      const r=await(await call(`${API}/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,md5Checksum)`)).json();
      return r.files&&r.files[0]?tagged(r.files[0]):null},
    async version(id){return(await(await call(`${API}/drive/v3/files/${id}?fields=md5Checksum`)).json()).md5Checksum},
    async read(id){return(await call(`${API}/drive/v3/files/${id}?alt=media`)).text()},
    async create(name,text){const m=multipart({name,mimeType:"application/json"},text);
      return tagged(await(await call(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum`,{method:"POST",headers:{"Content-Type":m.type},body:m.body})).json())},
    async update(id,text){
      return tagged(await(await call(`${API}/upload/drive/v3/files/${id}?uploadType=media&fields=id,md5Checksum`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:text})).json())}
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
  const remember=()=>localPut({docs:st.docs,fileId:st.fileId,base:st.base,sent:st.sent,dirty:st.dirty});

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
  function setStatus(s){st.status=s;const p=pill();const m={saved:["Saved to Drive","ok"],saving:["Saving...",""],pending:["Not saved yet",""],offline:["Offline: saved on this device only. Tap to retry","warn"],signin:["Sign in to save to Drive","warn"],error:["Couldn't save to Drive. Tap to retry","warn"],local:["This device only","warn"],conflict:["Choose which version to keep","warn"]}[s]||["",""];p.textContent=m[0];p.className=m[1];p.hidden=!m[0]}
  function gate(html){let g=document.getElementById("ds-gate");if(!g){g=document.createElement("div");g.id="ds-gate";document.body.appendChild(g)}g.innerHTML=`<div>${html}</div>`;return g}
  const ungate=()=>document.getElementById("ds-gate")?.remove();
  const btn=(g,id,fn)=>{const b=g.querySelector("#"+id);if(b)b.onclick=fn};

  /* ---------- sync ---------- */
  function handle(e){
    if(e&&e.code==="signin")setStatus("signin");
    else if(!navigator.onLine||(e&&e.message==="offline")||e instanceof TypeError)setStatus("offline");
    else setStatus("error")}
  async function reauth(){try{await drive.signIn();await sync()}catch(e){handle(e)}}
  function askConflict(){
    st.conflict=true;setStatus("conflict");
    const g=gate(`<h2>Two versions of your campaign</h2><p>Drive has changes from another device, and this device has changes that were never saved. Pick one to keep. The other is saved to Drive as a dated copy, so nothing is lost.</p><button class="main" id="ds-drive">Use the Drive version</button><button id="ds-local">Keep this device's version</button>`);
    btn(g,"ds-drive",()=>resolve("drive"));btn(g,"ds-local",()=>resolve("local"))}
  async function resolve(pick){
    const stamp=new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
    try{
      const remote=await drive.read(st.fileId);
      if(pick==="drive"){await drive.create(`dms-desk-conflict-${stamp}-this-device.json`,serialize());adopt(remote);st.base=await drive.version(st.fileId);st.dirty=false;fireAll()}
      else{await drive.create(`dms-desk-conflict-${stamp}-from-drive.json`,remote);st.base=await drive.version(st.fileId);st.dirty=true}
      st.conflict=false;ungate();await remember();
      if(st.dirty)await saveNow();else setStatus("saved")
    }catch(e){st.conflict=false;ungate();handle(e)}}
  /* Drive differs from what this device last knew. It's only a real clash if someone else wrote it: a save whose reply never arrived (page closed or phone sleeping) leaves Drive holding this device's own work. */
  async function driveIsMine(){
    const d=JSON.parse(await drive.read(st.fileId));
    return !!st.sent&&d.saved===st.sent||JSON.stringify(d.docs)===JSON.stringify(st.docs)}
  /* line this device up with Drive; used on opening and whenever the Desk comes back into view */
  async function sync(){
    if(!drive||st.busy||st.conflict)return;
    st.busy=true;
    try{
      if(!st.fileId){const f=await drive.find();
        if(f){st.fileId=f.id;
          if(st.dirty&&Object.keys(st.docs).length){st.base=null;st.busy=false;askConflict();return}
          adopt(await drive.read(f.id));st.base=f.version;st.dirty=false;await remember();fireAll();setStatus("saved");st.busy=false;return}
        const c=await drive.create(FILE_NAME,serialize());st.fileId=c.id;st.base=c.version;st.dirty=false;await remember();setStatus("saved");st.busy=false;return}
      const v=await drive.version(st.fileId);
      if(v!==st.base){
        if(st.dirty){if(!await driveIsMine()){st.busy=false;askConflict();return}st.base=v}
        else{adopt(await drive.read(st.fileId));st.base=v;await remember();fireAll()}}
      st.busy=false;
      if(st.dirty)await saveNow();else setStatus("saved")
    }catch(e){st.busy=false;if(e&&e.status===404){st.fileId=null;st.base=null;st.dirty=true;return sync()}handle(e)}}
  async function saveNow(){
    clearTimeout(st.timer);st.timer=null;
    if(!drive){setStatus("local");return}
    if(st.busy){st.again=true;return}
    if(!st.dirty||st.conflict)return;
    if(!drive.hasToken()){setStatus("signin");return}
    if(!st.fileId||st.base==null){return sync()}
    st.busy=true;setStatus("saving");
    try{
      const v=await drive.version(st.fileId);
      if(v!==st.base){if(!await driveIsMine()){st.busy=false;askConflict();return}st.base=v}
      /* note the save before sending it, so a lost reply can be recognized after a reopen */
      st.sent=new Date().toISOString();await remember();
      const text=serialize(st.sent);st.dirty=false;
      const r=await drive.update(st.fileId,text);
      st.base=r.version;await remember();st.busy=false;
      if(st.dirty||st.again){st.again=false;st.dirty=true;return saveNow()}
      setStatus("saved")
    }catch(e){st.busy=false;st.dirty=true;await remember();handle(e)}}
  function changed(path){
    fire(path);st.dirty=true;remember();
    if(!drive){setStatus("local");return}
    setStatus("pending");clearTimeout(st.timer);st.timer=setTimeout(saveNow,SAVE_DELAY)}
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){if(st.dirty)saveNow()}else if(drive&&drive.hasToken())sync()});
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
    img.onload=()=>{const max=2000,k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");
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
    if(!drive.hasToken()){
      if(c&&c.docs&&!navigator.onLine){setStatus("offline");return db}
      await waitForSignIn()}
    await sync();
    return db}

  window.DeskStore={open,assets,downloads,status:()=>st.status,saveNow};
})();
