// Хмарне сховище: вхід через Google, файли на Google Диску, метадані у Firestore.
//
// Схема входу: Google Identity Services видає access token з правом drive.file,
// цим самим токеном виконується вхід у Firebase Auth (GoogleAuthProvider.credential).
// Так користувач підтверджує доступ один раз, а токен для Диска можна оновлювати без Firebase-popup.
(function () {
  'use strict';

  const C = window.TEMBR_CONFIG || {};
  const FB_VERSION = '10.14.1';
  const FB = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';
  const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const CACHE_LIMIT = 5;

  const MIME = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', wma: 'audio/x-ms-wma'
  };

  let H = null;
  let AU = null;
  let FS = null;
  let auth = null;
  let db = null;
  let user = null;
  let unsub = null;
  let tokenClient = null;
  let token = null;
  let tokenExp = 0;
  let tokenPromise = null;
  let pending = null;
  let folderId = null;
  const cache = new Map();     // trackId -> objectURL (порядок = свіжість)
  const inflight = new Map();  // trackId -> Promise<string>

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не вдалося завантажити ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- токен Google ----------

  function requestToken(opts) {
    return new Promise((resolve, reject) => {
      pending = {
        ok(r) {
          pending = null;
          if (r && r.access_token) {
            token = r.access_token;
            tokenExp = Date.now() + ((+r.expires_in || 3600) - 60) * 1000;
            resolve(token);
          } else {
            reject(new Error((r && r.error) || 'token_error'));
          }
        },
        fail(e) {
          pending = null;
          reject(new Error((e && e.type) || 'popup_failed_to_open'));
        }
      };
      try {
        tokenClient.requestAccessToken(opts || {});
      } catch (e) {
        pending = null;
        reject(e);
      }
    });
  }

  function getToken(silent) {
    if (token && Date.now() < tokenExp) return Promise.resolve(token);
    if (silent) return Promise.reject(new Error('no_token'));
    if (!tokenPromise) {
      const opts = { prompt: '' };
      if (user && user.email) opts.login_hint = user.email;
      tokenPromise = requestToken(opts).finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  // ---------- Google Диск ----------

  async function driveFetch(url, opts, silent) {
    const run = async () => {
      const t = await getToken(silent);
      const headers = Object.assign({}, opts && opts.headers, { Authorization: 'Bearer ' + t });
      return fetch(url, Object.assign({}, opts, { headers }));
    };
    let r = await run();
    if (r.status === 401) {
      token = null;
      r = await run();
    }
    if (!r.ok) {
      const e = new Error('Drive ' + r.status);
      e.status = r.status;
      try { e.detail = (await r.json()).error.message; } catch (x) { /* без деталей */ }
      throw e;
    }
    return r;
  }

  async function ensureFolder() {
    if (folderId) return folderId;
    const name = (C.driveFolderName || 'Тембр').replace(/'/g, "\\'");
    const uref = FS.doc(db, 'users', user.uid);

    try {
      const snap = await FS.getDoc(uref);
      const saved = snap.exists() ? snap.data().driveFolderId : null;
      if (saved) {
        const r = await driveFetch(API + 'files/' + encodeURIComponent(saved) + '?fields=id,trashed');
        const j = await r.json();
        if (!j.trashed) { folderId = saved; return folderId; }
      }
    } catch (e) {
      if (e && e.status !== 404) throw e;
    }

    const q = encodeURIComponent("name='" + name + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const found = await (await driveFetch(API + 'files?q=' + q + '&fields=files(id)&spaces=drive')).json();
    if (found.files && found.files[0]) {
      folderId = found.files[0].id;
    } else {
      const created = await (await driveFetch(API + 'files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: C.driveFolderName || 'Тембр', mimeType: 'application/vnd.google-apps.folder' })
      })).json();
      folderId = created.id;
    }
    await FS.setDoc(uref, { driveFolderId: folderId }, { merge: true });
    return folderId;
  }

  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return MIME[ext] || 'audio/mpeg';
  }

  async function uploadMultipart(file, meta, t, mime) {
    const b = 'tembr' + Date.now();
    const head = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n';
    const body = new Blob([head, file, '\r\n--' + b + '--']);
    const r = await fetch(UPLOAD + '?uploadType=multipart&fields=id,size,mimeType', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'multipart/related; boundary=' + b },
      body
    });
    if (!r.ok) {
      const e = new Error('Drive ' + r.status);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  async function uploadFile(file, folder, onProgress) {
    const t = await getToken();
    const mime = file.type || guessMime(file.name);
    const meta = { name: file.name, parents: [folder], mimeType: mime };

    const init = await fetch(UPLOAD + '?uploadType=resumable&fields=id,size,mimeType', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + t,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(file.size)
      },
      body: JSON.stringify(meta)
    });
    if (!init.ok) {
      if (init.status === 401) token = null;
      const e = new Error('Drive ' + init.status);
      e.status = init.status;
      throw e;
    }
    const loc = init.headers.get('Location');
    if (!loc) return uploadMultipart(file, meta, t, mime);

    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', loc);
      x.setRequestHeader('Content-Type', mime);
      x.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
        } else {
          const e = new Error('Drive ' + x.status);
          e.status = x.status;
          reject(e);
        }
      };
      x.onerror = () => reject(new Error('Failed to fetch'));
      x.send(file);
    });
  }

  function remember(id, url) {
    if (cache.has(id)) cache.delete(id);
    cache.set(id, url);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      URL.revokeObjectURL(cache.get(oldest));
      cache.delete(oldest);
    }
  }

  // ---------- Firestore ----------

  function stopSub() {
    if (unsub) { unsub(); unsub = null; }
  }

  function startSub() {
    const q = FS.query(FS.collection(db, 'users', user.uid, 'tracks'), FS.orderBy('addedAt', 'desc'));
    unsub = FS.onSnapshot(
      q,
      (snap) => H.onTracks(snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))),
      (e) => H.onError('Firestore: ' + e.message)
    );
  }

  // ---------- публічний інтерфейс ----------

  window.CloudStore = {
    mode: 'cloud',

    async init(handlers) {
      H = handlers;
      try {
        const res = await Promise.all([
          import(FB + 'firebase-app.js'),
          import(FB + 'firebase-auth.js'),
          import(FB + 'firebase-firestore.js'),
          loadScript('https://accounts.google.com/gsi/client')
        ]);
        AU = res[1];
        FS = res[2];
        const app = res[0].initializeApp(C.firebase);
        auth = AU.getAuth(app);
        db = FS.getFirestore(app);

        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: C.googleClientId,
          scope: SCOPE,
          callback: (r) => { if (pending) pending.ok(r); },
          error_callback: (e) => { if (pending) pending.fail(e); }
        });

        AU.onAuthStateChanged(auth, (u) => {
          user = u;
          stopSub();
          if (u) {
            startSub();
            H.onAuth({ name: u.displayName || u.email || 'Користувач', email: u.email || '', photo: u.photoURL || null, uid: u.uid });
          } else {
            folderId = null;
            token = null;
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
            H.onTracks([]);
            H.onAuth(null);
          }
        });
      } catch (e) {
        H.onError('Не вдалося запустити Firebase: ' + (e && e.message ? e.message : e));
      }
    },

    async signIn() {
      const t = await requestToken({ prompt: 'select_account' });
      const cred = AU.GoogleAuthProvider.credential(null, t);
      await AU.signInWithCredential(auth, cred);
    },

    async signOut() {
      token = null;
      await AU.signOut(auth);
    },

    hasToken() {
      return !!(token && Date.now() < tokenExp);
    },

    ensureToken() {
      return getToken(false);
    },

    async addFiles(files, onStatus) {
      const folder = await ensureFolder();
      let added = 0;
      let failed = 0;
      const errors = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const base = { i, n: files.length, name: f.name };
        try {
          onStatus({ ...base, stage: 'meta', progress: 0 });
          const m = await window.readMeta(f);
          onStatus({ ...base, stage: 'upload', progress: 0 });
          const up = await uploadFile(f, folder, (p) => onStatus({ ...base, stage: 'upload', progress: p }));
          onStatus({ ...base, stage: 'save', progress: 1 });
          await FS.addDoc(FS.collection(db, 'users', user.uid, 'tracks'), {
            title: m.title,
            artist: m.artist || '',
            album: m.album || '',
            duration: m.duration || 0,
            cover: m.cover || null,
            driveFileId: up.id,
            fileName: f.name,
            mimeType: up.mimeType || f.type || guessMime(f.name),
            size: +up.size || f.size,
            addedAt: Date.now()
          });
          added++;
        } catch (e) {
          failed++;
          errors.push(f.name + ': ' + (e && e.message ? e.message : e));
          if (e && e.status === 403 && /quota|storage/i.test(e.detail || '')) break;
        }
      }
      return { added, failed, errors };
    },

    async getAudioUrl(t, onProgress, opts) {
      if (cache.has(t.id)) {
        const url = cache.get(t.id);
        remember(t.id, url);
        return url;
      }
      if (inflight.has(t.id)) return inflight.get(t.id);

      const job = (async () => {
        const r = await driveFetch(API + 'files/' + encodeURIComponent(t.driveFileId) + '?alt=media', {}, opts && opts.silent);
        const type = t.mimeType || 'audio/mpeg';
        const total = +r.headers.get('Content-Length') || t.size || 0;
        let blob;
        if (r.body && r.body.getReader && onProgress && total) {
          const reader = r.body.getReader();
          const chunks = [];
          let got = 0;
          for (;;) {
            const step = await reader.read();
            if (step.done) break;
            chunks.push(step.value);
            got += step.value.length;
            onProgress(Math.min(1, got / total));
          }
          blob = new Blob(chunks, { type });
        } else {
          blob = new Blob([await r.arrayBuffer()], { type });
        }
        const url = URL.createObjectURL(blob);
        remember(t.id, url);
        return url;
      })();

      inflight.set(t.id, job);
      const clear = () => inflight.delete(t.id);
      job.then(clear, clear);
      return job;
    },

    prefetch(t) {
      this.getAudioUrl(t, null, { silent: true }).catch(() => {});
    },

    async removeTrack(t) {
      try {
        await driveFetch(API + 'files/' + encodeURIComponent(t.driveFileId), { method: 'DELETE' });
      } catch (e) {
        if (!e || e.status !== 404) throw e;
      }
      await FS.deleteDoc(FS.doc(db, 'users', user.uid, 'tracks', t.id));
      if (cache.has(t.id)) {
        URL.revokeObjectURL(cache.get(t.id));
        cache.delete(t.id);
      }
    }
  };
})();
