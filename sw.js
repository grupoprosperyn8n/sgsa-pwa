// SGSA PWA v4 — Service Worker
const CACHE="sgsa-v4",ASSETS=["/","/index.html","/pwa.css","/pwa.js","/manifest.webmanifest","/icons/icon128.png","/icons/icon48.png","/icons/icon16.png"];
const API="https://web-production-2584d.up.railway.app";
let badgeInterval=null;

self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(CACHE).then(x=>x.put(e.request,cl))}return r})))});

// ─── Periodic alert checking for badge/notifications ──────────────────────
async function checkAlerts(){
  try{
    const d=await fetch(API+"/api/alerts?leidas=false").then(r=>r.json());
    const count=(d.alerts||[]).filter(a=>!a.leida).length;
    if(self.registration&&self.registration.showNotification){
      // Show notification for new alerts (only if count increased)
    }
  }catch{}
}

// Check every 2 minutes
setInterval(checkAlerts,120000);
checkAlerts();
