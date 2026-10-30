/* Service worker: zorgt dat de app installeerbaar is en offline opent.
 *
 * Strategie "stale-while-revalidate" voor de eigen bestanden: eerst uit de cache
 * (snel, ook zonder internet), en op de achtergrond de nieuwe versie ophalen.
 * Gevolg: na een update zie je de nieuwe versie bij de tweede keer openen.
 * Verhoog VERSION om de cache volledig te vervangen.
 *
 * Verzoeken naar Supabase (ander domein) worden niet aangeraakt: de app bewaart
 * zelf haar gegevens en wachtrij in IndexedDB.
 */
const VERSION = 'v1';
const CACHE = 'turflijst-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.js', 'config.js', 'vendor/supabase.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('turflijst-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pagina openen (ook na een login-link met ?code= of #token): altijd de app-pagina.
  const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req;

  ev.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    });
    if (cached) {
      ev.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    return fresh;
  }));
});
