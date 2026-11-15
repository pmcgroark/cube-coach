/* Cube Coach — service worker: keeps a complete copy of the app on the device so it opens and works
 * with no internet (after the first visit), e.g. from the iPhone home screen.
 *
 * - Precaches every app file below under a versioned cache name ('cube-coach-' + VERSION).
 * - Cache-first for same-origin GET requests; page loads (navigations) fall back to the cached
 *   index.html, so the app opens offline whatever the URL (?sw=1, #/route…).
 * - A new version installs in the background and then WAITS. The app (js/app.js) shows
 *   "A new version is ready — Reload"; pressing Reload posts {type:'SKIP_WAITING'}, the new
 *   version takes over and the page reloads. Old caches are deleted when a version activates.
 * - {type:'STATUS'} replies { version, cached, total, ready } (ready = every file is cached),
 *   for Settings › On your phone ("Offline ready ✓").
 *
 * Registered by js/app.js only on https (not on localhost, so development with serve.py never
 * serves stale files) unless the URL has ?sw=1. Paths are relative: the site lives under /cube-coach/.
 *
 * VERSION and PRECACHE are written by `node tests/platform.test.js --stamp` (run it before
 * publishing an update: a changed VERSION is what makes phones pick up the new files).
 * tests/platform.test.js checks that every app file is listed.
 */
'use strict';

var VERSION = '2026-11-15.523bdac9';
var CACHE_PREFIX = 'cube-coach-';
var CACHE = CACHE_PREFIX + VERSION;
var INDEX = 'index.html';

var PRECACHE = [
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/coach.js',
  'js/cube.js',
  'js/gym.js',
  'js/lessons.js',
  'js/render3d.js',
  'js/scanner.js',
  'js/screens/drills.js',
  'js/screens/gym.js',
  'js/screens/home.js',
  'js/screens/learn.js',
  'js/screens/scan.js',
  'js/screens/settings.js',
  'js/screens/solve.js',
  'js/screens/stats.js',
  'js/solver.js',
  'js/storage.js',
  'js/topview.js',
  'vendor/three.min.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/qr-cube-coach.svg'
];

function swNoop() {}

function swInScopeRoot(url) {
  // '/cube-coach/' or '/cube-coach/index.html' (any query): the app's own page
  var scope = new URL(self.registration ? self.registration.scope : './', self.location.href);
  return url.pathname === scope.pathname || url.pathname === new URL(INDEX, scope).pathname;
}

function swPrecache() {
  return caches.open(CACHE).then(function (cache) {
    // cache: 'reload' skips the browser's HTTP cache, so a new version never mixes in old files
    return cache.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  });
}

function swCleanup() {
  return caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) {
      return n.indexOf(CACHE_PREFIX) === 0 && n !== CACHE;
    }).map(function (n) { return caches.delete(n); }));
  });
}

function swNavigate(request) {
  var url = new URL(request.url);
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (swInScopeRoot(url)) {
        return cache.match(INDEX).then(function (index) { return index || fetch(request); });
      }
      // Some other page (e.g. a developer page): try the network, else the app.
      return fetch(request).catch(function (err) {
        return cache.match(INDEX).then(function (index) { if (index) return index; throw err; });
      });
    });
  });
}

function swCacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(swNoop);
        return res;
      });
    });
  });
}

function swStatus() {
  return caches.open(CACHE).then(function (cache) {
    return Promise.all(PRECACHE.map(function (u) { return cache.match(u).then(function (r) { return !!r; }); }));
  }).then(function (hits) {
    var cached = hits.filter(Boolean).length;
    return { type: 'STATUS', version: VERSION, cache: CACHE, cached: cached, total: PRECACHE.length, ready: cached === PRECACHE.length };
  });
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', function (event) {
    event.waitUntil(swPrecache());
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(swCleanup().then(function () { return self.clients.claim(); }));
  });

  self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;
    var url;
    try { url = new URL(request.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return; // other sites: leave to the browser
    event.respondWith(request.mode === 'navigate' ? swNavigate(request) : swCacheFirst(request));
  });

  self.addEventListener('message', function (event) {
    var msg = event.data || {};
    if (msg.type === 'SKIP_WAITING') {
      self.skipWaiting();
    } else if (msg.type === 'STATUS') {
      var done = swStatus().catch(function (err) {
        return { type: 'STATUS', version: VERSION, cache: CACHE, cached: 0, total: PRECACHE.length, ready: false, error: String(err && err.message || err) };
      }).then(function (status) {
        if (event.ports && event.ports[0]) event.ports[0].postMessage(status);
        else if (event.source && event.source.postMessage) event.source.postMessage(status);
      });
      if (event.waitUntil) event.waitUntil(done);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VERSION: VERSION, CACHE: CACHE, CACHE_PREFIX: CACHE_PREFIX, PRECACHE: PRECACHE, INDEX: INDEX };
}
