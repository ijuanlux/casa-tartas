// Service Worker — La Casa de las Tartas
// Cache-first para estáticos, network-only para Supabase (datos frescos).
// Sube CACHE_VERSION cuando cambies HTML/CSS/JS para forzar refresh.

const CACHE_VERSION = "v39";
const CACHE_NAME = `casa-tartas-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./pepino.js",
  "./config.js",
  "./manifest.json",
  "./logo-casa-tartas.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/gridstack@11.5.0/dist/gridstack-all.js",
  "https://cdn.jsdelivr.net/npm/gridstack@11.5.0/dist/gridstack.min.css",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Supabase API: siempre red, no cachear
  if (url.hostname.endsWith("supabase.co")) {
    return; // dejar pasar a red sin tocar
  }

  // Solo GET en cache
  if (event.request.method !== "GET") return;

  const sameOrigin = url.origin === self.location.origin;
  const isCode = sameOrigin && (url.pathname.endsWith("/") || /\.(html|js|css|json)$/.test(url.pathname));

  // CÓDIGO (HTML/JS/CSS/JSON): network-first → siempre lo último online, caché solo de respaldo offline
  if (isCode) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); }
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // RESTO (imágenes, fuentes, CDNs): cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && (sameOrigin || url.hostname === "cdn.jsdelivr.net")) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
