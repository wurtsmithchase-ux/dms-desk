/* DM's Desk campaign text files.
   Keeps a readable copy of every entry in Drive, in "DM's Desk/Campaign text", one Google Doc per entry plus _Index,
   so Claude can read and edit only what a request needs. Older plain .txt files are swapped for Docs as they're rewritten.
   Files changed outside the Desk are never overwritten: they wait on
   the review page, where each change is accepted or skipped. Uses the Desk's globals (S, ALL, FORMS, save, BOOT,
   dataVer...) and DeskStore.files from store.js. */
(function(){
"use strict";

/* ---------- MD5, the same fingerprint Drive reports as md5Checksum ---------- */
const MD5K=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0);
const MD5S=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
function md5(str){
  const b=new TextEncoder().encode(str),n=b.length,w=new Uint32Array((((n+8)>>6)+1)*16);
  for(let i=0;i<n;i++)w[i>>2]|=b[i]<<((i%4)*8);
  w[n>>2]|=0x80<<((n%4)*8);w[w.length-2]=(n*8)>>>0;w[w.length-1]=Math.floor(n/0x20000000);
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(let o=0;o<w.length;o+=16){
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++){
      const r=i>>4;let F,g;
      if(r===0){F=(B&C)|(~B&D);g=i}else if(r===1){F=(D&B)|(~D&C);g=(5*i+1)%16}else if(r===2){F=B^C^D;g=(3*i+5)%16}else{F=C^(B|~D);g=(7*i)%16}
      const s=MD5S[r*4+(i%4)];F=(F+A+MD5K[i]+w[o+g])>>>0;A=D;D=C;C=B;B=(B+((F<<s)|(F>>>(32-s))))>>>0}
    a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0}
  return [a0,b0,c0,d0].map(v=>[0,8,16,24].map(s=>((v>>>s)&255).toString(16).padStart(2,"0")).join("")).join("")}
window.deskMd5=md5;
/* overwrite protection depends on this hash matching Drive's, so check it against published test values */
const MD5_OK=[["","d41d8cd98f00b204e9800998ecf8427e"],["abc","900150983cd24fb0d6963f7d28e17f72"],
  ["The quick brown fox jumps over the lazy dog","9e107d9d372bb6826bd81d3542a419d6"],
  ["12345678901234567890123456789012345678901234567890123456789012345678901234567890","57edf4a22be3c955ac49da2e2107b67a"]
].every(([s,h])=>md5(s)===h);
if(!MD5_OK)console.error("Desk text files: the MD5 self-test failed, so the text files are switched off.");

/* ---------- what goes in a file ---------- */
const HEAD="DM's Desk entry | keep this line | ";
const HEAD_RE=/^DM's Desk entry \| keep this line \| ([a-z]+) \| ([A-Za-z0-9_-]+)\s*$/;
const NEW_HEAD="DM's Desk new entries | keep this line";
const FILE_COLS=["characters","notes","quests","events","threads","loot","maps","monsters","todos","clocks","tables"];
const MULTI=new Set(["textarea","textarea-tall","plain","plain-tall","checklist"]);
const ID_SELECT=new Set(["pc","holder","parent","a","b"]);
const LINKED="Linked (the Desk fills this in; edits here are ignored)";
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const oneLine=s=>String(s||"").replace(/\s+/g," ").trim();
const typeLabel=col=>col==="encounters"?"Encounter":FORMS[col].title;
/* id lookups, rebuilt only when the data changes */
const IX={ver:-1,m:new Map()};
function find(col,id){
  if(IX.ver!==dataVer){IX.ver=dataVer;IX.m.clear()}
  const arr=ALL[col]||[];let e=IX.m.get(col);
  if(!e||e.arr!==arr||e.n!==arr.length){e={arr,n:arr.length,m:new Map(arr.map(x=>[x.id,x]))};IX.m.set(col,e)}
  return e.m.get(id)}
/* one title for the file name and the "# heading", so they can't disagree. The first field comes first because the heading is read back into it */
function entryTitle(col,x){const fs=fieldsOf(col),k=fs[0]&&fs[0].k;return oneLine(k&&x[k])||oneLine(titleOf(col,x))||"Untitled"}

/* field lists depend on the data (some options are character names), so they're cached per data version */
const FC={ver:-1,m:new Map()};
function fieldsOf(col){
  if(FC.ver!==dataVer){FC.ver=dataVer;FC.m.clear()}
  if(!FC.m.has(col))FC.m.set(col,buildFields(col));
  return FC.m.get(col)}
function buildFields(col){
  if(!FORMS[col])return [];
  const fs=FORMS[col].fields(cal()).filter(f=>f[2]!=="image").map(([k,l,t,_s,opts])=>({k,l:String(l).trim(),t,opts:opts||{}}));
  if(!fs.some(f=>f.k==="secret"))fs.push({k:"secret",l:"DM secrets",t:"textarea",opts:{}});
  return fs}
const rawVal=(col,f,x)=>col==="events"&&f.k==="date"?(x.m!=null?{y:x.y,m:x.m,d:x.d}:null):x[f.k];
function valOut(f,v){
  if(f.t==="check")return v?"Yes":"No";
  if(v==null||v==="")return "";
  switch(f.t){
    case"select":{const l=f.opts[String(v)];return l!=null?oneLine(l):String(v)}
    case"igdate":{if(typeof v!=="object")return "";const mo=cal().months[v.m];return `${v.d} ${mo?mo.name:"Month "+(v.m+1)} ${v.y}`}
    case"dates":return Array.isArray(v)?v.join(", "):String(v);
    case"checklist":return String(v).split("\n").filter(s=>s.trim()).map(s=>/^\[x\] /i.test(s)?"[x] "+s.slice(4):"[ ] "+s).join("\n");
    default:return String(v)}}
const isSection=(f,v)=>MULTI.has(f.t)||f.k==="secret"||v.includes("\n");

function entryFile(col,x,linked,relOf){
  const fs=fieldsOf(col),out=[HEAD+col+" | "+x.id,"# "+entryTitle(col,x)],secs=[];
  fs.slice(1).forEach(f=>{const v=valOut(f,rawVal(col,f,x));if(v==="")return;
    if(isSection(f,v))secs.push(`\n## ${f.l}\n${v.trim()}`);else out.push(`${f.l}: ${v}`)});
  if(col==="characters"){
    const rel=(relOf?relOf(x.id):S.links.filter(r=>r.a===x.id||r.b===x.id)).map(r=>{const o=find("characters",r.a===x.id?r.b:r.a);return o?`- ${REL[r.kind]||"Linked"}: ${o.name}${r.label?" ("+oneLine(r.label)+")":""}`:""}).filter(Boolean);
    if(rel.length)secs.push("\n## Relationships (edit these in the Desk)\n"+rel.join("\n"))}
  if(linked.length)secs.push(`\n## ${LINKED}\n`+linked.map(n=>"- "+n).join("\n"));
  return out.concat(secs).join("\n")+"\n"}
function encounterFile(x){return `DM's Desk entry | read only, edit in the Desk | encounters | ${x.id}\n`+entryText("encounters",x,true)+"\n"}

/* a few short facts for the index line */
function brief(col,x){
  return fieldsOf(col).slice(1).filter(f=>!MULTI.has(f.t)&&f.k!=="secret"&&f.t!=="check"&&!ID_SELECT.has(f.k)).map(f=>valOut(f,rawVal(col,f,x))).filter(v=>v&&v.length<=40).slice(0,3).join(", ")}
const safeName=s=>oneLine(s).replace(/[\\/:*?"<>|]/g,"-").slice(0,80)||"Untitled";

/* every file the Desk wants in the folder, keyed col:id */
function wanted(){
  const rows=listRows();nameRows(rows);
  const nameOf=new Map(rows.map(r=>[r.col+":"+r.x.id,r.name]));
  const links=buildLinks(rows,nameOf);
  const relByChar=new Map();
  S.links.forEach(r=>[r.a,r.b].forEach(id=>{if(!relByChar.has(id))relByChar.set(id,[]);relByChar.get(id).push(r)}));
  const W=new Map(),idx=[];
  rows.forEach(r=>{const key=r.col+":"+r.x.id;
    const linked=[...links.get(key)].map(k=>nameOf.get(k)).filter(Boolean).sort();
    W.set(key,{name:r.name,text:r.col==="encounters"?encounterFile(r.x):entryFile(r.col,r.x,linked,id=>relByChar.get(id)||[])});
    const b=r.col==="encounters"?"":brief(r.col,r.x);idx.push({col:r.col,line:`- ${r.name}${b?" | "+b:""}`})});
  indexFiles(idx).forEach((v,k)=>W.set(k,{...v,always:true}));
  W.set("_new",{name:"_New entries",text:NEW_TEMPLATE()});
  return W}
function listRows(){
  const rows=[];
  FILE_COLS.forEach(col=>ALL[col].slice().sort((a,b)=>a.id<b.id?-1:1).forEach(x=>rows.push({col,x})));
  (ALL.encounters||[]).forEach(x=>rows.push({col:"encounters",x}));
  return rows}
/* "Type - Name"; a repeated name gets " (2)" */
function nameRows(rows){
  const used=new Set();
  rows.forEach(r=>{const base=`${typeLabel(r.col)} - ${safeName(entryTitle(r.col,r.x))}`;let name=base,i=1;
    while(used.has(name.toLowerCase()))name=`${base} (${++i})`;used.add(name.toLowerCase());r.name=name})}
/* links: names this entry mentions, entries that mention it, picked characters or places, relationships */
function buildLinks(rows,nameOf){
  const fwd=new Map(rows.map(r=>[r.col+":"+r.x.id,new Set()]));
  const add=(a,b)=>{if(a!==b&&fwd.has(a)&&nameOf.has(b))fwd.get(a).add(b)};
  rows.forEach(r=>{if(r.col==="encounters")return;const key=r.col+":"+r.x.id,fs=fieldsOf(r.col);
    const text=fs.map(f=>{const v=rawVal(r.col,f,r.x);return typeof v==="string"?v:""}).join("\n");
    try{backlinksFrom(text).forEach(t=>add(key,t.type+":"+t.id))}catch(e){console.warn("Desk text files: couldn't read links in",key,e)}
    fs.filter(f=>ID_SELECT.has(f.k)&&r.x[f.k]).forEach(f=>{["characters","notes"].forEach(c=>{if(find(c,r.x[f.k]))add(key,c+":"+r.x[f.k])})})});
  S.links.forEach(l=>{add("characters:"+l.a,"characters:"+l.b);add("characters:"+l.b,"characters:"+l.a)});
  const links=new Map([...fwd.keys()].map(k=>[k,new Set(fwd.get(k))]));
  fwd.forEach((set,a)=>set.forEach(b=>{if(links.has(b))links.get(b).add(a)}));
  return links}

function labelsLine(col){
  return fieldsOf(col).slice(1).map(f=>{
    if(ID_SELECT.has(f.k))return f.l+" (a name)";
    if(f.t==="select"){const o=Object.values(f.opts).map(oneLine).filter(v=>v&&v!=="—"&&!/^— /.test(v));return o.length&&o.length<=10?`${f.l} (${o.join(", ")})`:f.l}
    if(f.t==="check")return f.l+" (Yes/No)";
    if(f.t==="igdate")return f.l+" (day month year)";
    if(f.t==="date"||f.t==="dates")return f.l+" (YYYY-MM-DD)";
    if(f.t==="checklist")return f.l+" ([x] or [ ] lines)";
    return f.l}).join("; ")}
/* a short main index pointing to one index per type, so Claude reads only the list it needs */
function indexFiles(idx){
  const out=new Map(),groups=new Map();
  idx.forEach(i=>{if(!groups.has(i.col))groups.set(i.col,[]);groups.get(i.col).push(i.line)});
  const main=[`DM's Desk campaign index: ${S.settings.campaign?.name||"Campaign"}`,
    "Entry files are Google Docs named \"Type - Name\". Find one by name first; open a type's index only to browse or when the name is unknown. Then open only the entries needed, plus their Linked entries.",
    "Editing: edit the Doc's text in place and keep its first line. Short fields are \"Label: value\" lines; long ones are \"## Label\" sections. A field left out stays as it is; \"Label:\" with nothing after it clears it. Formatting is ignored. The DM accepts each change in the Desk.",
    "New entries go in \"_New entries\". Each type's index lists its field labels.","","Type indexes:"];
  groups.forEach((lines,col)=>{const name=`_Index - ${typeLabel(col)}`;main.push(`- ${name} (${lines.length})`);
    out.set("_index:"+col,{name,text:[`${typeLabel(col)} entries`,col==="encounters"?"Read only: edit encounters in the Desk.":`Fields: ${labelsLine(col)}`,"",...lines].join("\n")+"\n"})});
  out.set("_index",{name:"_Index",text:main.join("\n")+"\n"});
  return out}
const NEW_TEMPLATE=()=>[NEW_HEAD,
  "Add new entries below this line. Start each with \"Type: <type>\" and \"# Name\", then fields as in the other files.",
  "Separate entries with a line holding only ---. The Desk asks the DM before adding anything.",
  "Types: "+FILE_COLS.map(c=>FORMS[c].title).join(", "),"---",""].join("\n");

/* ---------- reading a file back ---------- */
function valIn(f,s,warn){
  s=String(s).replace(/\s+$/,"");const bad=()=>{warn.push(`"${f.l}: ${oneLine(s).slice(0,40)}" isn't something the Desk understands, so it was left as it is.`);return undefined};
  switch(f.t){
    case"check":if(/^(yes|y|true|x|done|on)$/i.test(s.trim()))return true;if(/^(no|n|false|off|)$/i.test(s.trim()))return false;return bad();
    case"number":{if(!s.trim())return null;const n=num(s);return n==null?bad():n}
    case"select":{const t=norm(s);if(!t)return "" in f.opts?"":undefined;
      const k=Object.keys(f.opts).find(o=>norm(f.opts[o])===t||norm(o)===t);return k!=null?k:bad()}
    case"igdate":{if(!s.trim())return null;const m=s.trim().match(/^(\d+)\s+(.+?)\s+(-?\d+)$/);if(!m)return bad();
      const ms=cal().months;let mi=ms.findIndex(x=>norm(x.name)===norm(m[2]));if(mi<0){const g=m[2].match(/^month (\d+)$/i);if(g)mi=+g[1]-1}
      return mi>=0&&mi<ms.length?{y:+m[3],m:mi,d:Math.max(1,+m[1])}:bad()}
    case"date":{const t=s.trim();return !t?"":/^\d{4}-\d{2}-\d{2}$/.test(t)?t:bad()}
    case"dates":{const ds=s.split(/[,\s]+/).filter(Boolean);if(ds.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)))return bad();return [...new Set(ds)].sort()}
    case"checklist":return s.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.match(/^\[(x| )\]\s*(.*)$/i);if(m)return m[1].toLowerCase()==="x"?"[x] "+m[2]:m[2];return l.replace(/^[-*]\s+/,"")}).filter(l=>l&&l!=="[x] ").join("\n");
    case"text":return oneLine(s);
    default:return s.replace(/^\n+/,"")}}
function parseBody(col,lines,warn){
  const fs=fieldsOf(col),byLabel=new Map(fs.map(f=>[norm(f.l),f]));
  const vals={};let cur=null,buf=[],skip=false,titled=false;
  const flush=()=>{if(cur){const v=valIn(cur,buf.join("\n"),warn);if(v!==undefined)vals[cur.k]=v}cur=null;buf=[]};
  for(const line of lines){
    const h=line.match(/^##\s+(.+?)\s*$/);
    if(h){const lab=norm(h[1].replace(/\s*\(.*\)\s*$/,""));
      if(lab==="linked"||lab==="relationships"){flush();skip=true;continue}
      const f=byLabel.get(lab);if(f&&f!==fs[0]){flush();skip=false;cur=f;continue}
      if(!cur){if(!skip)warn.push(`The section "${oneLine(h[1]).slice(0,40)}" isn't a field the Desk knows, so it was left out.`);skip=true;continue}}
    if(skip)continue;
    if(cur){buf.push(line);continue}
    const t=line.match(/^#\s+(.+?)\s*$/);if(t&&!titled){titled=true;vals[fs[0].k]=fs[0].t==="text"?oneLine(t[1]):t[1];continue}
    if(!line.trim())continue;
    const m=line.match(/^([^:]{1,40}):(.*)$/),f=m&&byLabel.get(norm(m[1]));
    if(f&&f!==fs[0]){const v=valIn(f,m[2].trim(),warn);if(v!==undefined)vals[f.k]=v;continue}
    warn.push(`The line "${oneLine(line).slice(0,50)}" isn't a field the Desk knows, so it was left out.`)}
  flush();return vals}
function parseEntry(text){
  const lines=String(text).replace(/\r\n?/g,"\n").split("\n"),m=(lines[0]||"").match(HEAD_RE);
  if(!m||!FORMS[m[1]]||!FILE_COLS.includes(m[1]))return null;
  const warn=[];return{col:m[1],id:m[2],vals:parseBody(m[1],lines.slice(1),warn),warn}}
const colOfType=t=>FILE_COLS.find(c=>norm(FORMS[c].title)===norm(t)||norm(FORMS[c].title)+"s"===norm(t)||norm(c)===norm(t));
function parseNew(text){
  const body=String(text).replace(/\r\n?/g,"\n").replace(/^DM's Desk new entries[^\n]*\n/,""),out=[];
  const blocks=body.split(/^-{3,}\s*$/m);
  /* the template's instructions sit above the first --- */
  if(/^Add new entries below/m.test(blocks[0]||""))blocks.shift();
  blocks.forEach(b=>{const lines=b.split("\n");if(!lines.some(l=>l.trim()))return;
    const ti=lines.findIndex(l=>/^type\s*:/i.test(l.trim())),warn=[];
    const col=ti>=0?colOfType(lines[ti].split(":").slice(1).join(":").trim()):null;
    if(!col){out.push({col:null,warn:["This entry has no \"Type:\" line the Desk understands, so it can't be added."],raw:oneLine(b).slice(0,80)});return}
    lines.splice(ti,1);const vals=parseBody(col,lines,warn);
    if(!vals[fieldsOf(col)[0].k])warn.push("It has no \"# Name\" line.");
    out.push({col,id:null,vals,warn})});
  return out}

/* ---------- comparing with the Desk ---------- */
function diff(col,x,vals){
  return fieldsOf(col).filter(f=>f.k in vals).map(f=>{const nv=vals[f.k],ov=x?rawVal(col,f,x):undefined;
    const before=x?valOut(f,ov):"",after=valOut(f,nv);return sameText(before,after)?null:{k:f.k,l:f.l,before,after}}).filter(Boolean)}
/* spaces at line ends don't count: Google Docs and copy-paste can drop them */
const sameText=(a,b)=>a===b||a.replace(/[ \t]+$/gm,"").replace(/\s+$/,"")===b.replace(/[ \t]+$/gm,"").replace(/\s+$/,"");
function toRecord(col,base,vals){
  const d=JSON.parse(JSON.stringify(base||{}));delete d.id;Object.assign(d,JSON.parse(JSON.stringify(vals)));
  if(col==="events"&&"date" in d){if(d.date)Object.assign(d,d.date);delete d.date}
  return d}
function newDefaults(col,vals){
  const d={};if(col==="todos")d.kind="todo";if(col==="clocks"){d.segments="6";d.filled=0}
  d.dmOnly=!((col==="characters"&&vals.kind==="pc")||(col==="notes"&&vals.category==="session")||col==="loot");return d}

/* ---------- keeping Drive in step ---------- */
const ST={busy:false,ver:-1,dirty:false,dirtyAt:0,lastRun:0,started:false,force:new Set(),cards:[],status:"",again:false};
const files=()=>window.DeskStore&&DeskStore.files;
/* Docs: h is the hash of what the Desk wrote, e (when set) the hash of a later export that matched the Desk anyway */
const outside=f=>!!(f.props.h&&f.md5&&f.md5!==(f.doc&&f.props.e||f.props.h));
/* Google Docs have no md5Checksum, and their exported text can differ from what was uploaded in small ways (a byte order mark, \r\n line ends,
   trailing spaces), so they're hashed after evening those out. A Doc whose modified time isn't after the Desk's last write is unchanged;
   any other is exported once and hashed. SEEN keeps those results, keyed by modified time. The hashes (not the text) are kept on this
   device too, so a reload doesn't export every Doc still waiting on the review page again. */
const SEEN_KEY="desk.textSeen";
const SEEN=new Map((()=>{try{const o=JSON.parse(localStorage.getItem(SEEN_KEY))||{};
  return Object.entries(o).filter(([,v])=>v&&typeof v.mod==="string"&&typeof v.md5==="string")}catch(_){return []}})());
function keepSeen(){try{const o={};SEEN.forEach((v,id)=>{o[id]={mod:v.mod,md5:v.md5}});localStorage.setItem(SEEN_KEY,JSON.stringify(o))}catch(_){}}
/* the Desk sends its write time as the Doc's modified time, and after a write t is set to the time Drive actually kept (fixTime).
   If Drive moves the time on when the Desk tags the file, a Doc still counts as unchanged up to this long after its tag. An outside edit
   inside this window would be missed, so it stays short */
const MOD_SLACK=2000;
/* makes t match the modified time Drive kept, and returns Drive's final time. Best effort: if tagging fails, the Doc is only exported once later */
async function fixTime(F,id,t,mod){
  if(!mod||Date.parse(mod)===+t)return mod;
  try{const after=await F.tag(id,{t:String(Date.parse(mod))},mod);
    if(after&&Date.parse(after)!==Date.parse(mod))console.info("Desk text files: tagging moved the modified time of",id);
    return after||mod}
  catch(e){console.warn("Desk text files: couldn't tag",e);return mod}}
/* evens out what a Docs export changes: byte order mark, \r\n line ends, non-breaking spaces, spaces at line ends, final newlines */
const normText=s=>String(s||"").replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").replace(/\u00A0/g," ").split("\n").map(l=>l.replace(/[ \t]+$/,"")).join("\n").replace(/\n+$/,"")+"\n";
const docHash=s=>md5(normText(s));
/* a connection or sign-in problem stops the run; any other export failure (a Doc deleted meanwhile, no access) only skips that file */
const fatal=e=>!!(e&&(e.code==="offline"||e.code==="signin"));
async function fingerprint(F,list){
  const need=[];
  list.forEach(f=>{if(!f.doc)return;const base=f.props.e||f.props.h,s=SEEN.get(f.id);
    if(!f.props.h||(f.mod&&f.props.t&&Date.parse(f.mod)<=+f.props.t+MOD_SLACK)){f.md5=base;return}
    if(s&&s.mod===f.mod){f.md5=s.md5;if(s.text!=null)f.text=s.text;return}
    need.push(f)});
  const same=[];
  await pool(need.map(f=>async()=>{
    let text;
    try{text=normText(await F.read(f.id,true))}
    catch(e){if(fatal(e))throw e;console.warn("Desk text files: couldn't export",f.name,e);f.unreadable=true;return}
    const m=md5(text);SEEN.set(f.id,{mod:f.mod,md5:m,text});f.md5=m;f.text=text;
    if(m===(f.props.e||f.props.h)&&f.mod)same.push(f)}),WRITERS);
  /* touched but the same text (Drive kept its own time, or an edit was undone): move the time tag up so the next visit needn't export it */
  if(same.length)await pool(same.map(f=>()=>F.tag(f.id,{t:String(Date.parse(f.mod))},f.mod)),WRITERS).catch(e=>console.warn("Desk text files: couldn't tag",e))}
const WRITERS=4,QUIET_MS=60000,RECHECK_MS=120000,TICK_MS=5000,RERUN_MS=800,ARM_MS=4000;
/* runs tasks n at a time. After the first failure no new task starts; in-flight ones finish, then the first error is thrown, so the next run never overlaps a leftover write */
async function pool(tasks,n){
  let i=0,err=null,failed=false;
  const one=async()=>{while(!failed&&i<tasks.length){try{await tasks[i++]()}catch(e){if(!failed){failed=true;err=e}}}};
  await Promise.all(Array.from({length:Math.min(n,tasks.length)},one));
  if(failed)throw err}
function setStatus(s){ST.status=s;const el=document.getElementById("tx-st");if(el)el.textContent=statusText()}
function statusText(){
  const F=files();if(!F||!F.available())return "Text files need Google Drive.";
  if(!F.signedIn())return "Sign in to update the text files.";
  return {busy:"Updating the text files...",ok:"Text files are up to date.",error:"Couldn't update the text files. The Desk will try again.",offline:"Offline. The text files will update when you're back online."}[ST.status]||"Text files update about a minute after you stop editing."}
async function run(){
  const F=files();
  if(!F||!F.available()||!F.signedIn()||!BOOT.ready||!MD5_OK)return;
  if(ST.busy){ST.again=true;return}
  ST.busy=true;ST.lastRun=Date.now();setStatus("busy");
  try{
    /* Docs first, so if a switch from .txt was cut short the Doc is kept and the old file is the extra one. Then newest first, so when two
       devices made the same Doc at once the same one is always kept */
    const list=(await F.list()).sort((a,b)=>((b.doc?1:0)-(a.doc?1:0))||((Date.parse(b.mod)||0)-(Date.parse(a.mod)||0))),have=new Map(),extra=[];
    const ids=new Set(list.map(f=>f.id));SEEN.forEach((_,id)=>{if(!ids.has(id))SEEN.delete(id)});
    await fingerprint(F,list);
    list.forEach(f=>{const k=f.props.k;if(!k)return;if(have.has(k))extra.push(f);else have.set(k,f)});
    /* links come from S, which catches up with ALL on the next frame; bring it up to date first so a file never misses its links */
    if(COLS.some(c=>S[c]!==ALL[c])){project();ST.ver=dataVer}
    const W=wanted(),edited=[],jobs=[];let skipped=0;
    /* a file that couldn't be exported is left completely alone (never written over or trashed) and tried again next cycle */
    const unread=f=>f&&f.unreadable&&++skipped;
    W.forEach((w,k)=>{const f=have.get(k);if(unread(f))return;
      if(f&&!w.always&&outside(f)&&!ST.force.has(k)){edited.push({k,f});return}
      const h=docHash(w.text);if(f&&f.doc&&f.props.h===h&&f.name===w.name&&!outside(f)){ST.force.delete(k);return}
      jobs.push(async()=>{await writeEntry(F,k,w,h,f);ST.force.delete(k)})});
    have.forEach((f,k)=>{if(W.has(k)||unread(f))return;
      if(outside(f)&&!ST.force.has(k)&&!k.startsWith("_index"))edited.push({k,f});else jobs.push(async()=>{await F.trash(f.id);ST.force.delete(k)})});
    /* a leftover duplicate is trashed, unless it was changed outside the Desk: then it gets its own review card first */
    extra.forEach(f=>{if(unread(f))return;const k=f.props.k,dk=k+DUP+f.id;
      if(outside(f)&&!ST.force.has(dk)&&!k.startsWith("_index"))edited.push({k:dk,f});else jobs.push(async()=>{await F.trash(f.id);ST.force.delete(dk)})});
    await pool(jobs,WRITERS);
    await buildCards(edited);
    if(skipped){ST.dirty=true;ST.dirtyAt=Date.now();setStatus("error")}else setStatus("ok")
  }catch(e){console.warn("Desk text files",e);setStatus(e&&e.code==="offline"?"offline":e&&e.code==="signin"?"":"error");ST.dirty=true;ST.dirtyAt=Date.now()}
  finally{ST.busy=false;keepSeen()}
  if(ST.again){ST.again=false;return run()}}
/* card key for a leftover duplicate file: the entry's key, then this, then the file's id */
const DUP="#dup:";
const keyOf=k=>k.split(DUP)[0];
/* writes one entry's file. A Doc is rewritten in place (clearing e). A missing file, or an old .txt, gets a new Doc, and the .txt is
   trashed only once the Doc exists, so a swap that's cut short leaves an extra file (trashed next run), never a missing one.
   Fixing the time tag comes last and is best effort */
async function writeEntry(F,k,w,h,f){
  const t=String(Date.now());
  if(f&&f.doc){
    const r=await F.write(f.id,w.name,w.text,{k,h,t,e:null});SEEN.set(f.id,{mod:r.mod,md5:h});
    SEEN.set(f.id,{mod:await fixTime(F,f.id,t,r.mod),md5:h});return}
  const r=await F.write(null,w.name,w.text,{k,h,t},true);SEEN.set(r.id,{mod:r.mod,md5:h});
  if(f)await F.trash(f.id);
  SEEN.set(r.id,{mod:await fixTime(F,r.id,t,r.mod),md5:h})}
function tick(){
  if(!BOOT.ready)return;
  if(dataVer!==ST.ver){ST.ver=dataVer;if(ST.started){ST.dirty=true;ST.dirtyAt=Date.now()}}
  if(!ST.started){ST.started=true;run();return}
  if(ST.dirty&&Date.now()-ST.dirtyAt>=QUIET_MS){ST.dirty=false;run()}}
setInterval(tick,TICK_MS);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden"){if(ST.dirty){ST.dirty=false;run()}}
  else if(ST.started&&Date.now()-ST.lastRun>RECHECK_MS)run()});
const soon=()=>setTimeout(run,RERUN_MS);

/* ---------- review page ---------- */
async function buildCards(edited){
  const F=files(),cards=[],texts=new Map(),failed=new Set(),retag=[];
  /* cards already shown for this exact file stay as they are, so an accepted new entry can't come back */
  const prevOf=k=>ST.cards.filter(c=>c.key===k&&c.src!=="paste");
  const reads=edited.filter(({k,f})=>{const p=prevOf(k);return !(p.length&&p[0].md5===f.md5)});
  await pool(reads.map(({k,f})=>async()=>{
    try{texts.set(k,f.text!=null?f.text:f.doc?normText(await F.read(f.id,true)):await F.read(f.id,false))}
    catch(e){console.warn("Desk text files: couldn't read",f.name,e);failed.add(k)}}),WRITERS);
  /* a file that couldn't be read keeps whatever cards it had and is tried again on the next cycle */
  if(failed.size){ST.dirty=true;ST.dirtyAt=Date.now()}
  for(const {k,f} of edited){
    const prev=prevOf(k);
    if(failed.has(k)||(prev.length&&prev[0].md5===f.md5)){cards.push(...prev);continue}
    const text=texts.get(k);
    const base={key:k,file:f.name,md5:f.md5};
    if(keyOf(k)==="_new"){parseNew(text).forEach(p=>cards.push({...p,...base,src:"new"}));continue}
    const p=parseEntry(text);
    if(!p){cards.push({...base,col:null,src:"drive",warn:[k.startsWith("encounters:")?"Encounters are edited in the Desk's encounter builder. Skip this to put the file back.":"The first line was changed or removed, so the Desk can't tell which entry this is. Skip it to put the file back."]});continue}
    const x=find(p.col,p.id);
    const card={...p,...base,src:"drive",gone:!x,both:!!(x&&x.updated&&+f.props.t&&x.updated>+f.props.t)};
    card.changes=diff(p.col,x,p.vals);
    if(k!==keyOf(k)&&card.changes.length)card.warn=[...(card.warn||[]),"This is an extra copy of the entry's file. Accept or skip it, and the copy goes to the Drive trash."];
    /* nothing really changed (spacing only, say): a .txt file gets the Desk's copy back without asking. A Doc is left as it is and
       tagged with this export's hash and time, so it isn't exported or rewritten again (a Doc's text may never match the upload exactly) */
    if(x&&!card.changes.length&&!card.warn.length){
      if(f.doc){const props={e:f.md5,...(f.mod?{t:String(Date.parse(f.mod))}:{})};retag.push(async()=>{await F.tag(f.id,props,f.mod);SEEN.set(f.id,{mod:f.mod,md5:f.md5})})}
      else ST.force.add(k);continue}
    cards.push(card)}
  if(retag.length)await pool(retag,WRITERS).catch(e=>console.warn("Desk text files: couldn't tag",e));
  ST.cards=ST.cards.filter(c=>c.src==="paste").concat(cards);
  if(edited.some(e=>ST.force.has(e.k)))soon();
  notice();if(document.getElementById("tx-review"))showReview()}
function notice(){
  const n=new Set(ST.cards.filter(c=>c.src!=="paste").map(c=>c.key)).size;let b=document.getElementById("tx-note");
  if(!n){if(b)b.remove();return}
  if(!b){if(!document.getElementById("tx-css")){const s=document.createElement("style");s.id="tx-css";s.textContent=CSS;document.head.appendChild(s)}
    b=document.createElement("button");b.id="tx-note";b.type="button";b.dataset.tx="review";document.body.appendChild(b)}
  b.textContent=`${n} text file${n===1?"":"s"} changed. Review`}
const CSS=`#tx-note{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:8999;font:600 12px/1.2 system-ui,sans-serif;padding:7px 12px;border-radius:999px;background:var(--blood,#8a2c1d);color:#fff;border:0;box-shadow:0 2px 8px #0005;cursor:pointer}
@media (max-width:640px){#tx-note{bottom:calc(78px + env(safe-area-inset-bottom))}}
body:has(#tx-review) #tx-note{display:none}
.tx-card{border:1px solid var(--line,#0002);border-radius:10px;padding:12px;margin:0 0 12px}
.tx-card h3{margin:0 0 4px;font-size:16px}.tx-card .tx-src{color:var(--muted,#776);font-size:13px;margin:0 0 8px}
.tx-ch{margin:8px 0}.tx-ch b{display:block;font-size:13px}
.tx-ch pre{white-space:pre-wrap;word-break:break-word;margin:2px 0;padding:6px 8px;border-radius:6px;font:13px/1.4 var(--ui,system-ui);max-height:220px;overflow:auto}
.tx-old{background:#b0303014;text-decoration:line-through;text-decoration-color:#b0303080}.tx-new{background:#30803018}
.tx-warn{color:var(--blood,#8a2c1d);font-size:13px;margin:6px 0}
.tx-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#tx-paste-ta{width:100%;min-height:180px;box-sizing:border-box;font:13px/1.4 var(--mono,monospace)}`;
const h=s=>esc(String(s==null?"":s));
function cardHtml(c,i){
  const kind=c.col?`${c.gone?"Deleted ":c.src==="new"||!c.id?"New ":""}${typeLabel(c.col).toLowerCase()}`:"";
  const title=c.col?`${kind.charAt(0).toUpperCase()+kind.slice(1)}: ${oneLine(c.vals[fieldsOf(c.col)[0].k]||(c.id&&find(c.col,c.id)&&titleOf(c.col,find(c.col,c.id)))||"Untitled")}`:"A file the Desk can't read";
  const src=c.src==="paste"?"Pasted text":`From ${c.file}`;
  const ch=c.col&&!c.id?fieldsOf(c.col).filter(f=>f.k in c.vals).map(f=>({l:f.l,before:"",after:valOut(f,c.vals[f.k])})).filter(x=>x.after):c.changes||[];
  const can=!!c.col&&(c.id?c.changes.length||c.gone:true);
  return `<div class="tx-card"><h3>${h(title)}</h3><p class="tx-src">${h(src)}</p>
    ${c.both?`<p class="tx-warn">This entry was also changed in the Desk after the file was written. Accepting replaces only the fields shown.</p>`:""}
    ${c.gone?`<p class="tx-warn">This entry was deleted in the Desk. Accepting brings it back with the file's contents.</p>`:""}
    ${ch.map(x=>`<div class="tx-ch"><b>${h(x.l)}</b>${x.before?`<pre class="tx-old">${h(x.before)}</pre>`:""}<pre class="tx-new">${h(x.after||"(cleared)")}</pre></div>`).join("")}
    ${c.raw?`<pre class="tx-old">${h(c.raw)}</pre>`:""}
    ${(c.warn||[]).map(w=>`<p class="tx-warn">${h(w)}</p>`).join("")}
    <div class="tx-acts">${can?`<button type="button" class="btn primary" data-tx="accept" data-i="${i}">Accept</button>`:""}<button type="button" class="btn" data-tx="skip" data-i="${i}">${c.src==="paste"?"Remove":"Skip"}</button></div></div>`}
function showReview(){
  const cards=ST.cards;
  showSheet(`<div class="sheet" role="dialog" aria-label="Text changes" id="tx-review"><h2>Text changes</h2>
    <p class="tool-d">${cards.length?"Changes made to the campaign text files outside the Desk. Accept a change to save it, or skip it to put the Desk's version back in the file.":"No text files have changed outside the Desk."}</p>
    ${cards.map(cardHtml).join("")}
    <div class="foot"><span class="grow"></span><button type="button" class="btn" data-act="close">Close</button></div></div>`)}
function showPaste(){
  showSheet(`<div class="sheet" role="dialog" aria-label="Paste text to import" id="tx-paste"><h2>Paste text to import</h2>
    <p class="tool-d">Paste entries from a Claude chat: changed entry files (they start with "DM's Desk entry"), or new entries that start with "Type:". Nothing is saved until you accept it.</p>
    <textarea id="tx-paste-ta" aria-label="Text to import"></textarea>
    <div class="foot"><span class="grow"></span><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn primary" data-tx="check">Check</button></div></div>`)}
function readPaste(text){
  const t=String(text).replace(/\r\n?/g,"\n"),cards=[];
  if(/^DM's Desk entry \|/m.test(t)){
    t.split(/^(?=DM's Desk entry \|)/m).forEach(part=>{if(!part.trim())return;const p=parseEntry(part);
      if(!p){if(/^DM's Desk entry/.test(part))cards.push({col:null,src:"paste",warn:["This entry's first line isn't one the Desk understands."],raw:oneLine(part).slice(0,80)});return}
      const x=find(p.col,p.id),changes=diff(p.col,x,p.vals);cards.push({...p,src:"paste",gone:!x,changes})})}
  else parseNew(t).forEach(p=>cards.push({...p,src:"paste"}));
  return cards}
function arm(t,label){if(t.classList.contains("armed"))return true;t.classList.add("armed");t.dataset.label=t.textContent;t.textContent=label;setTimeout(()=>{if(t.isConnected&&t.classList.contains("armed")){t.classList.remove("armed");t.textContent=t.dataset.label}},ARM_MS);return false}
function settle(c){
  ST.cards=ST.cards.filter(x=>x!==c);
  if(c.src!=="paste"&&!ST.cards.some(x=>x.key===c.key&&x.src!=="paste"))ST.force.add(c.key);
  notice();showReview();soon()}
async function accept(c){
  if(c.id){const x=find(c.col,c.id);
    /* only the fields that really changed, so untouched ones keep their exact stored form */
    const vals=x?Object.fromEntries(diff(c.col,x,c.vals).map(d=>[d.k,c.vals[d.k]])):c.vals;
    await save(c.col,c.id,toRecord(c.col,x||newDefaults(c.col,vals),vals))}
  else await save(c.col,uid(),toRecord(c.col,newDefaults(c.col,c.vals),c.vals));
  toast("Saved")}
document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-tx]");if(!t)return;const a=t.dataset.tx,c=ST.cards[+t.dataset.i];
  if(a==="review"){if(!document.getElementById("tx-review")&&!ST.busy)run();showReview()}
  else if(a==="now"){ST.dirty=false;await run();toast(ST.status==="ok"?"Text files updated":statusText())}
  else if(a==="paste")showPaste();
  else if(a==="check"){const cards=readPaste(document.getElementById("tx-paste-ta").value);if(!cards.length){toast("Nothing the Desk can import was found.");return}
    ST.cards=ST.cards.filter(x=>x.src!=="paste").concat(cards);showReview()}
  else if(a==="accept"&&c){if(!arm(t,"Click again to accept"))return;t.disabled=true;
    try{await accept(c)}
    catch(err){console.warn("Desk text files: accept failed",err);toast("Couldn't save that change. Try again.");t.disabled=false;t.classList.remove("armed");t.textContent=t.dataset.label||"Accept";return}
    settle(c)}
  else if(a==="skip"&&c){if(c.src!=="paste"&&!arm(t,c.key!==keyOf(c.key)?"Sure? Trash this copy":"Sure? Put the Desk's version back"))return;settle(c)}
});

window.DeskText={run,status:statusText,parseEntry,parseNew,diff,wanted,md5,state:ST};
})();
