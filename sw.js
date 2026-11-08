/* Keeps the app itself available when the connection drops. Campaign data never passes through here. */
/* Bump this number whenever the list of files below changes, so old caches are removed. */
const CACHE="desk-app-2";
const FILES=["./","index.html","store.js","config.js","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin)return;
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r.ok){
        const copy=r.clone();
        e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{}))}
      return r})
    .catch(async()=>{
      const hit=await caches.match(e.request);
      if(hit)return hit;
      /* only a page may fall back to the app shell; a missing script or image must fail, not return HTML with a 200 */
      if(e.request.mode==="navigate")return caches.match("index.html");
      return Response.error()}));
});
