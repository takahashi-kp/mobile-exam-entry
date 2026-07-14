const CACHE = "mobile-exam-entry-v52";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20260714-06",
  "./app.js?v=20260714-06",
  "./guidance.js?v=20260713-01",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
