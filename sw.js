// Service Worker — La Casa de las Tartas
// Cache-first para estáticos, network-only para Supabase (datos frescos).
// Sube CACHE_VERSION cuando cambies HTML/CSS/JS para forzar refresh.

const CACHE_VERSION = "v9";
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
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
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

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Cachea respuestas exitosas same-origin y la CDN de Supabase JS
        if (res.ok && (url.origin === self.location.origin || url.hostname === "cdn.jsdelivr.net")) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => cached); // sin red y sin cache → fallback a undefined
    })
  );
});
