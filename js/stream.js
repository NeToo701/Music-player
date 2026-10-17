// Місток до service worker: стрімінг треків із Диска й передача токена.
(function () {
  'use strict';

  const secure = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const supported = 'serviceWorker' in navigator && secure;

  let reg = null;
  let active = false;
  let provider = null;

  function post(msg) {
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (c) c.postMessage(msg);
  }

  function boot() {
    if (!supported) return Promise.resolve(false);
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'need-token' || !e.ports || !e.ports[0]) return;
      const t = provider ? provider() : null;
      e.ports[0].postMessage(t && t.token ? { token: t.token, exp: t.exp } : null);
    });
    return navigator.serviceWorker.register('sw.js')
      .then((r) => { reg = r; return navigator.serviceWorker.ready; })
      .then(() => {
        if (navigator.serviceWorker.controller) return true;
        return new Promise((resolve) => {
          const done = () => resolve(!!navigator.serviceWorker.controller);
          navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
          setTimeout(done, 3000);
        });
      })
      .then((ok) => { active = !!ok; return active; })
      .catch(() => false);
  }

  window.Stream = {
    supported,
    ready: boot(),
    active() { return active; },
    setProvider(fn) { provider = fn; },
    setToken(token, exp) { post({ type: 'token', token: token || null, exp: exp || 0 }); },
    url(t) {
      const base = reg ? reg.scope : new URL('./', location.href).href;
      return base + '__stream/' + encodeURIComponent(t.driveFileId) +
        '?s=' + (+t.size || 0) + '&t=' + encodeURIComponent(t.mimeType || 'audio/mpeg');
    }
  };
})();
