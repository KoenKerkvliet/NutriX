/* ============================================
   BRIGHTLY - Service worker
   Doel: sneller starten + offline voor bezochte pagina's.
   Strategie:
     - HTML + JS: network-first (online altijd verse code; offline uit cache)
     - overige same-origin assets (css/img/fonts): stale-while-revalidate (snel + zelf-verversend)
     - cross-origin (Supabase, fonts, Open Food Facts, CDN's): niet cachen, laat de browser het regelen
   JS bewust network-first zodat gepushte code-wijzigingen meteen zichtbaar zijn.
   Verhoog CACHE bij een grote wijziging om oude caches op te ruimen.
   ============================================ */
const CACHE = 'brightly-v8';

self.addEventListener('install', () => {
  self.skipWaiting();   // nieuwe versie meteen activeren
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // cross-origin: browser regelt caching

  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isJs = url.pathname.endsWith('.js');

  if (isHtml || isJs) {
    // Network-first: online zie je altijd de nieuwste pagina/code; offline val terug op cache.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match(req)) || (isHtml ? await caches.match('dashboard.html') : undefined) ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Overige same-origin assets (css/img/fonts): stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
