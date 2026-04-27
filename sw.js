const APP_CACHE = "sagicor-app-v1";
const VIDEO_CACHE = "sagicor-videos-v1";
const MEDIA_BASE = "https://media.githubusercontent.com/media/EjMackSPD/Sagicor-BoardRoom/main/";
const APP_SHELL = [
  "/",
  "/index.html",
  "/sagicor-logo.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== APP_CACHE && key !== VIDEO_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "WARM_VIDEO_CACHE" || !Array.isArray(event.data.files)) return;
  event.waitUntil(warmVideoCache(event.data.files));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/videos/")) {
    event.respondWith(handleVideoRequest(event.request));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/sagicor-logo.svg")) {
    event.respondWith(cacheFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function warmVideoCache(files) {
  const cache = await caches.open(VIDEO_CACHE);
  for (const file of files) {
    const localUrl = new URL(`/videos/${encodeURIComponent(file)}`, self.location.origin).href;
    const existing = await cache.match(localUrl);
    if (existing) continue;

    try {
      const response = await fetch(MEDIA_BASE + encodeURIComponent(file), { mode: "cors" });
      if (response.ok && response.status === 200) {
        await cache.put(localUrl, response.clone());
      }
    } catch (error) {
      // Keep warming best-effort; streaming fallback remains available.
    }
  }
}

async function handleVideoRequest(request) {
  const url = new URL(request.url);
  const cache = await caches.open(VIDEO_CACHE);
  const cached = await cache.match(url.href);

  if (cached) {
    const range = request.headers.get("range");
    if (range) return buildRangeResponse(cached, range);
    return cached;
  }

  const file = decodeURIComponent(url.pathname.replace(/^\/videos\//, ""));
  const remoteUrl = MEDIA_BASE + encodeURIComponent(file);
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);

  return fetch(remoteUrl, { headers, mode: "cors" });
}

async function buildRangeResponse(response, rangeHeader) {
  const blob = await response.blob();
  const size = blob.size;
  const matches = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!matches) return response;

  let start = matches[1] ? Number(matches[1]) : 0;
  let end = matches[2] ? Number(matches[2]) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= size || end >= size) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`
      }
    });
  }

  const chunk = blob.slice(start, end + 1, "video/mp4");
  return new Response(chunk, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(chunk.size),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
