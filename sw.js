// Service worker Тембру.
// 1) Стрімінг із Google Диска: <audio> просить /__stream/<id>, воркер додає токен і віддає
//    відповідь частинами (Range), тому трек грає одразу, а не після повного завантаження.
// 2) Приймання файлів із меню «Поділитися» (Web Share Target) у встановленому застосунку.
'use strict';

const API = 'https://www.googleapis.com/drive/v3/files/';
const SHARE_CACHE = 'tembr-share';

let token = null;
let tokenExp = 0;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'token') {
    token = d.token || null;
    tokenExp = d.exp || 0;
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method === 'GET' && url.pathname.indexOf('/__stream/') >= 0) {
    e.respondWith(handleStream(e, url));
  }
});

// ---------- токен ----------

function askClient(client) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 8000);
    ch.port1.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data || null); };
    try { client.postMessage({ type: 'need-token' }, [ch.port2]); } catch (err) { clearTimeout(timer); resolve(null); }
  });
}

async function fetchToken(clientId) {
  const list = [];
  if (clientId) {
    const c = await self.clients.get(clientId);
    if (c) list.push(c);
  }
  const all = await self.clients.matchAll({ type: 'window' });
  all.forEach((c) => { if (!list.some((x) => x.id === c.id)) list.push(c); });
  for (const c of list) {
    const r = await askClient(c);
    if (r && r.token) {
      token = r.token;
      tokenExp = r.exp || 0;
      return token;
    }
  }
  return null;
}

async function getToken(clientId, force) {
  if (!force && token && Date.now() < tokenExp - 15000) return token;
  return fetchToken(clientId);
}

// ---------- стрімінг ----------

function driveFetch(id, range, tok) {
  const headers = { Authorization: 'Bearer ' + tok };
  if (range) headers.Range = range;
  return fetch(API + encodeURIComponent(id) + '?alt=media', { headers });
}

async function handleStream(e, url) {
  const id = decodeURIComponent(url.pathname.split('/__stream/')[1] || '');
  const size = +url.searchParams.get('s') || 0;
  const type = url.searchParams.get('t') || 'audio/mpeg';
  const range = e.request.headers.get('range');

  let tok = await getToken(e.clientId, false);
  if (!tok) return new Response('Немає токена', { status: 401 });
  let r;
  try {
    r = await driveFetch(id, range, tok);
    if (r.status === 401) {
      tok = await getToken(e.clientId, true);
      if (!tok) return new Response('Немає токена', { status: 401 });
      r = await driveFetch(id, range, tok);
    }
  } catch (err) {
    return new Response('Помилка мережі', { status: 502 });
  }
  if (!r.ok) return new Response('Помилка Диска', { status: r.status });

  // Заголовки Content-Range/Length у CORS-відповіді можуть бути недоступні, тому рахуємо самі.
  const h = new Headers();
  h.set('Content-Type', type);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'no-store');

  let status = r.status;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && size && r.status === 206) {
    let start;
    let end;
    if (m[1] === '') {
      start = Math.max(0, size - +m[2]);
      end = size - 1;
    } else {
      start = +m[1];
      end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1);
    }
    h.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    h.set('Content-Length', String(end - start + 1));
  } else if (r.status === 206) {
    const cr = r.headers.get('Content-Range');
    const cl = r.headers.get('Content-Length');
    if (cr) h.set('Content-Range', cr);
    if (cl) h.set('Content-Length', cl);
  } else {
    status = 200;
    const cl = r.headers.get('Content-Length') || (size ? String(size) : '');
    if (cl) h.set('Content-Length', cl);
  }
  return new Response(r.body, { status, headers: h });
}

// ---------- прийом файлів з меню «Поділитися» ----------

async function handleShare(req) {
  try {
    const fd = await req.formData();
    const files = fd.getAll('files').filter((f) => f && typeof f !== 'string' && f.name);
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await cache.put(
        new Request(new URL('__shared/' + stamp + '-' + i, self.registration.scope).href),
        new Response(f, {
          headers: {
            'Content-Type': f.type || 'application/octet-stream',
            'X-Name': encodeURIComponent(f.name)
          }
        })
      );
    }
  } catch (err) { /* порожній прийом: просто відкриємо застосунок */ }
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}
