/* funziona anche senza connessione: tiene una copia dell'app sul telefono.
   Pagine e codice: prima la rete (così gli aggiornamenti arrivano subito), se offline la copia. */
const V="ab-v60";
const SHELL=["./","index.html","style.css","app.js","config.js","logos.js","manifest.webmanifest","img/logo.webp","img/train.webp","img/match.webp","icons/icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(/supabase\.co$/.test(u.hostname))return; /* dati: sempre dal database */
  const fonts=/fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(u.hostname);
  if(fonts){e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{const cp=res.clone();caches.open(V).then(ca=>ca.put(r,cp));return res})));return}
  if(u.origin!==location.origin)return;
  e.respondWith(fetch(u.href,{cache:"no-cache",credentials:"same-origin"}).then(res=>{if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r).then(c=>c||caches.match("index.html"))));
});
