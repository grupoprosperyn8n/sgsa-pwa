// SGSA PWA v8 — Service Worker with proper caching strategy
// Strategy: network-first for HTML, cache-first for hashed assets, network-only for API
const CACHE_V="sgsa-v8";
const CACHE_STATIC="sgsa-static-v8";
const STATIC_ASSETS=["/","/index.html","/pwa.css","/pwa.js","/manifest.webmanifest","/icons/icon128.png","/icons/icon48.png","/icons/icon16.png"];
const API="https://web-production-2584d.up.railway.app";

// ─── Install: pre-cache static assets ────────────────────────────────────
self.addEventListener("install",e=>{
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(c=>c.addAll(STATIC_ASSETS).catch(()=>{}))
      .then(()=>self.skipWaiting())
  );
});

// ─── Activate: clean old caches ──────────────────────────────────────────
self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE_STATIC&&k!==CACHE_V&&k!=="sgsa-v7"&&k!=="sgsa-v6"&&k!=="sgsa-v5")
          .map(k=>{console.log("[SW] deleting old cache:",k);return caches.delete(k)})
    )).then(()=>self.clients.claim())
  );
});

// ─── Fetch: routing by request type ──────────────────────────────────────
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;

  const url=new URL(e.request.url);

  // 1. API calls → network only, NEVER cache
  if(url.pathname.startsWith("/api/")||url.origin.includes("supabase")){
    e.respondWith(fetch(e.request));
    return;
  }

  // 2. HTML pages → network-first (never serve stale HTML)
  if(e.request.mode==="navigate"||e.request.headers.get("accept")?.includes("text/html")){
    e.respondWith(
      fetch(e.request)
        .then(r=>{
          // Cache a fresh copy for offline fallback
          if(r.ok){const cl=r.clone();caches.open(CACHE_V).then(c=>c.put(e.request,cl))}
          return r;
        })
        .catch(()=>{
          // Offline: serve cached version, or offline page
          return caches.match(e.request).then(c=>c||caches.match("/index.html"))
        })
    );
    return;
  }

  // 3. Static assets (JS/CSS/icons) → cache-first (safe to cache, files have hash)
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached)return cached;
      return fetch(e.request).then(r=>{
        if(r.ok){const cl=r.clone();caches.open(CACHE_STATIC).then(c=>c.put(e.request,cl))}
        return r;
      });
    })
  );
});

// ─── Badge checking (periodic) ───────────────────────────────────────────
async function checkAlerts(){
  try{
    const d=await fetch(API+"/api/alerts?leidas=false").then(r=>r.json());
    const count=(d.alerts||[]).filter(a=>!a.leida).length;
    if(self.registration&&self.registration.showNotification){
      // notification logic here
    }
  }catch{}
}
setInterval(checkAlerts,120000);
checkAlerts();
