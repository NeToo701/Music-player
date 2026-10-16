// Інтерфейс і програвач Тембру.
(function () {
  'use strict';

  const C = window.TEMBR_CONFIG || {};
  const fbc = C.firebase || {};
  const configured = !!(fbc.apiKey && fbc.projectId && fbc.appId && C.googleClientId);
  const Store = window.CloudStore;
  const esc = window.U.esc;
  const fmt = window.U.fmt;
  const hash = window.U.hash;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const body = document.body;
  const audio = new Audio();
  audio.preload = 'auto';
  const fileInput = $('#file');

  const PAL = [
    ['#7dd3fc', '#0c4a6e'], ['#94a3b8', '#1e293b'], ['#fbbf77', '#7c2d12'], ['#86efac', '#14532d'],
    ['#f9a8d4', '#701a45'], ['#c4b5fd', '#3b0764'], ['#fca5a5', '#7f1d1d'], ['#5eead4', '#134e4a']
  ];

  let tracks = [];
  let curId = null;
  let loadedId = null;
  let playing = false;
  let loadTok = 0;
  let pos = 0;
  let dur = 0;
  let shuffle = false;
  let repeat = 'off';       // off | all | one
  let query = '';
  let uploading = false;
  let history = [];
  let toastTimer = null;

  // ---------- допоміжні ----------

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* сховище недоступне */ }
    return null;
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
  }

  function errText(e) {
    const m = String((e && e.message) || e || '');
    const code = e && e.code ? String(e.code) : '';
    if (code === 'auth/unauthorized-domain') return 'Адресу сайту не додано в Firebase → Authentication → Settings → Authorized domains.';
    if (code === 'auth/operation-not-allowed') return 'У Firebase не ввімкнено вхід через Google (Authentication → Sign-in method).';
    if (code === 'auth/invalid-credential' || code === 'auth/invalid-idp-response' || code === 'auth/internal-error') {
      return 'Firebase не прийняв вхід через Google. Перевірте, що googleClientId у config.js — це «Web client (auto created by Google Service)» того самого проєкту.';
    }
    if (code === 'auth/network-request-failed') return 'Немає з’єднання з мережею.';
    if (code === 'permission-denied') return 'Firestore відхилив запит. Перевірте правила бази (README, крок 1.4).';
    if (/popup_failed_to_open/i.test(m)) return 'Браузер заблокував вікно Google. Дозвольте спливні вікна для цього сайту й натисніть ще раз.';
    if (/popup_closed|user_cancel/i.test(m)) return 'Вікно Google закрито до завершення входу.';
    if (/access_denied/i.test(m)) return 'Доступ до Google Диска не надано.';
    if (/no_token/i.test(m)) return 'Потрібно відновити доступ до Google Диска: натисніть ▶ ще раз.';
    if (e && e.status === 404) return 'Файл не знайдено на Google Диску (можливо, його видалили).';
    if (e && (e.status === 401 || e.status === 403)) {
      return 'Немає доступу до Google Диска' + (e.detail ? ': ' + e.detail : '') + '.';
    }
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Немає з’єднання з мережею.';
    return 'Помилка: ' + m;
  }

  const cur = () => tracks.find((t) => t.id === curId) || null;
  const byId = (id) => tracks.find((t) => t.id === id) || null;
  const idxOf = (id) => tracks.findIndex((t) => t.id === id);

  function coverCss(t) {
    if (t.cover) return "center / cover no-repeat url('" + t.cover + "')";
    const i = hash(String(t.id));
    const p = PAL[i % PAL.length];
    return 'linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
  }

  // ---------- відображення ----------

  function rowHtml(t, i) {
    const act = t.id === curId;
    const id = esc(t.id);
    const title = esc(t.title || 'Без назви');
    return '<div class="row' + (act ? ' active' : '') + '">' +
      '<button class="r-main" data-play-id="' + id + '">' +
      '<span class="n"><span class="eq"><i></i><i></i><i></i></span><b>' + (i + 1) + '</b></span>' +
      '<span class="cv" style="background:' + coverCss(t) + '"></span>' +
      '<span class="x"><span class="t">' + title + '</span><span class="a">' + esc(t.artist || 'Невідомий виконавець') + '</span></span>' +
      '<span class="d">' + (t.duration ? fmt(t.duration) : '—:—') + '</span>' +
      '</button>' +
      '<button class="del" data-del="' + id + '" aria-label="Видалити «' + title + '»"><svg class="ic"><use href="#i-trash"/></svg></button>' +
      '</div>';
  }

  function blankHtml() {
    return '<div class="blank"><svg class="ic"><use href="#i-music"/></svg><h3>Бібліотека порожня</h3>' +
      '<p>Завантажте музику: файли збережуться на вашому Google Диску, а список треків у Firebase.</p>' +
      '<button class="up" data-upload><svg class="ic"><use href="#i-up"/></svg><span>Завантажити</span></button></div>';
  }

  function render() {
    const q = query.trim().toLowerCase();
    const items = tracks.map((t, i) => ({ t, i })).filter((o) =>
      !q || ((o.t.title || '') + ' ' + (o.t.artist || '') + ' ' + (o.t.album || '')).toLowerCase().includes(q));
    const host = $('[data-list]');
    if (!tracks.length) host.innerHTML = blankHtml();
    else if (!items.length) host.innerHTML = '<div class="blank"><p>Нічого не знайдено</p></div>';
    else host.innerHTML = items.map((o) => rowHtml(o.t, o.i)).join('');
    $$('[data-count]').forEach((e) => { e.textContent = tracks.length; });
  }

  function meta() {
    const t = cur();
    const title = t ? (t.title || 'Без назви') : 'Немає треків';
    const artist = t ? (t.artist || 'Невідомий виконавець') : 'Додайте музику, щоб почати';
    $$('[data-title]').forEach((e) => { e.textContent = title; });
    $$('[data-artist]').forEach((e) => { e.textContent = artist; });
    $$('[data-cover]').forEach((e) => {
      e.style.background = t ? coverCss(t) : '';
      e.classList.toggle('empty', !t);
    });
    document.title = t && playing ? title + ' — Тембр' : 'Тембр';
    updateSession();
  }

  function tick() {
    const p = dur ? Math.min(100, (pos / dur) * 100) : 0;
    $$('[data-cur]').forEach((e) => { e.textContent = fmt(pos); });
    $$('[data-dur]').forEach((e) => { e.textContent = dur ? fmt(dur) : '0:00'; });
    $$('[data-fill]').forEach((e) => { e.style.width = p + '%'; });
    $$('[data-seek]').forEach((e) => e.setAttribute('aria-valuenow', String(Math.round(p))));
  }

  function setPlayState() {
    body.classList.toggle('playing', playing);
    $$('[data-play]').forEach((b) => b.setAttribute('aria-label', playing ? 'Пауза' : 'Відтворити'));
    const t = cur();
    document.title = playing && t ? (t.title || 'Тембр') + ' — Тембр' : 'Тембр';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }

  function setStatus(txt) {
    $$('[data-status]').forEach((e) => { e.textContent = txt; });
  }

  function setLoading(on) {
    body.classList.toggle('loading', on);
    if (!on) setStatus('');
  }

  // ---------- режим вікна: розгорнутий / компактний ----------

  const mq = window.matchMedia('(max-width:860px)');

  function viewKey() { return 'tembr.view.' + (mq.matches ? 'm' : 'd'); }

  function applyView() {
    let v = store(viewKey());
    if (v !== 'expanded' && v !== 'compact') v = mq.matches ? 'compact' : 'expanded';
    body.dataset.view = v;
  }

  function setView(v) {
    body.dataset.view = v;
    store(viewKey(), v);
  }

  // ---------- відтворення ----------

  function hardStop() {
    loadTok++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    loadedId = null;
    playing = false;
    pos = 0;
    setLoading(false);
    setPlayState();
  }

  function startPlay() {
    if (!curId) return;
    const p = audio.play();
    if (p && p.catch) {
      p.catch((err) => {
        playing = false;
        setPlayState();
        if (!err || err.name !== 'AbortError') toast('Не вдалося почати відтворення. Натисніть ▶ ще раз.');
      });
    }
  }

  function pausePlay() {
    audio.pause();
    playing = false;
    setPlayState();
  }

  async function load(id, autoplay) {
    const t = byId(id);
    if (!t) return;
    const tok = ++loadTok;
    audio.pause();
    playing = false;
    loadedId = null;
    curId = id;
    store('tembr.last', id);
    pos = 0;
    dur = t.duration || 0;
    if (history[history.length - 1] !== id) history.push(id);
    if (history.length > 50) history.shift();
    render();
    meta();
    tick();
    setPlayState();
    setLoading(true);

    let url = null;
    try {
      url = await Store.getAudioUrl(t, (p) => {
        if (tok === loadTok) setStatus('Завантаження з Диска… ' + Math.round(p * 100) + '%');
      });
    } catch (e) {
      if (tok !== loadTok) return;
      setLoading(false);
      toast(errText(e));
      return;
    }
    if (tok !== loadTok) return;
    setLoading(false);
    loadedId = id;
    audio.src = url;
    if (autoplay) startPlay();
    prefetchNext();
  }

  function prefetchNext() {
    if (shuffle || !Store.prefetch) return;
    const id = nextId(true);
    const n = id && id !== curId ? byId(id) : null;
    if (n) Store.prefetch(n);
  }

  function nextId(auto) {
    if (!tracks.length) return null;
    const i = idxOf(curId);
    if (shuffle && tracks.length > 1) {
      let j;
      do { j = Math.floor(Math.random() * tracks.length); } while (j === i);
      return tracks[j].id;
    }
    const n = i + 1;
    if (n >= tracks.length) return (repeat === 'all' || !auto) ? tracks[0].id : null;
    return tracks[n].id;
  }

  function next() {
    const id = nextId(false);
    if (id) load(id, true);
  }

  function prev() {
    if (!tracks.length) return;
    if (pos > 3 && loadedId === curId) { seekTo(0); return; }
    if (shuffle && history.length > 1) {
      history.pop();
      load(history.pop(), true);
      return;
    }
    const i = idxOf(curId);
    load(tracks[(i - 1 + tracks.length) % tracks.length].id, true);
  }

  function onEnded() {
    if (repeat === 'one') {
      audio.currentTime = 0;
      startPlay();
      return;
    }
    const id = nextId(true);
    if (id) {
      load(id, true);
    } else {
      pausePlay();
      pos = 0;
      audio.currentTime = 0;
      tick();
    }
  }

  function togglePlay() {
    if (!curId || body.classList.contains('loading')) return;
    if (loadedId !== curId) { load(curId, true); return; }
    if (playing) pausePlay(); else startPlay();
  }

  function seekTo(ratio) {
    if (!dur || loadedId !== curId) return;
    pos = Math.max(0, Math.min(1, ratio)) * dur;
    audio.currentTime = pos;
    tick();
  }

  function bindSeek(el) {
    let drag = false;
    const apply = (e) => {
      const r = el.getBoundingClientRect();
      seekTo((e.clientX - r.left) / r.width);
    };
    el.addEventListener('pointerdown', (e) => {
      drag = true;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* не критично */ }
      apply(e);
    });
    el.addEventListener('pointermove', (e) => { if (drag) apply(e); });
    const end = () => { drag = false; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      if (!dur) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); seekTo((pos + 5) / dur); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo((pos - 5) / dur); }
    });
  }

  function toggleShuffle() {
    shuffle = !shuffle;
    store('tembr.shuffle', shuffle ? '1' : '0');
    syncModes();
  }

  function cycleRepeat() {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    store('tembr.repeat', repeat);
    syncModes();
  }

  function syncModes() {
    $$('[data-shuffle]').forEach((b) => {
      b.classList.toggle('on', shuffle);
      b.setAttribute('aria-pressed', String(shuffle));
    });
    const label = { off: 'Повтор: вимкнено', all: 'Повтор: усі треки', one: 'Повтор: один трек' }[repeat];
    $$('[data-repeat]').forEach((b) => {
      b.dataset.state = repeat;
      b.setAttribute('aria-label', label);
    });
  }

  // ---------- системні елементи керування (екран блокування, гарнітура) ----------

  function updateSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const t = cur();
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || 'Без назви',
        artist: t.artist || '',
        album: t.album || 'Тембр',
        artwork: t.cover ? [{ src: t.cover, sizes: '256x256', type: 'image/jpeg' }] : []
      });
    } catch (e) { /* не критично */ }
  }

  function bindSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* не підтримується */ } };
    set('play', togglePlay);
    set('pause', togglePlay);
    set('previoustrack', prev);
    set('nexttrack', next);
    set('seekto', (d) => { if (dur && d && d.seekTime != null) seekTo(d.seekTime / dur); });
  }

  // ---------- завантаження файлів ----------

  function showUpl(s) {
    const el = $('#upl');
    el.hidden = false;
    const stage = { meta: 'читаю теги', upload: 'завантажую на Диск', save: 'зберігаю', done: 'готово' }[s.stage] || '';
    const pct = s.stage === 'upload' ? ' ' + Math.round(s.progress * 100) + '%' : '';
    $('.upl-t', el).textContent = 'Файл ' + (s.i + 1) + ' з ' + s.n + ' · ' + s.name + ' · ' + stage + pct;
    const frac = s.stage === 'upload' ? s.progress * 0.9 : (s.stage === 'save' || s.stage === 'done') ? 1 : 0;
    $('.upl-b i', el).style.width = Math.round(((s.i + frac) / s.n) * 100) + '%';
  }

  // Google дозволяє відкрити вікно доступу лише після кліку, тому токен
  // відновлюємо тут, до вибору файлів, а не після нього.
  async function requestUpload() {
    if (!Store.hasToken()) {
      try {
        await Store.ensureToken();
        toast('Доступ до Диска відновлено. Натисніть «Завантажити» ще раз.');
      } catch (e) {
        toast(errText(e));
      }
      return;
    }
    fileInput.click();
  }

  async function handleFiles(list) {
    const files = Array.from(list || []).filter((f) =>
      /^audio\//.test(f.type) || /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav)$/i.test(f.name));
    if (!files.length) { toast('Серед вибраних файлів немає аудіо.'); return; }
    if (!Store.hasToken()) {
      toast('Потрібно відновити доступ до Диска: натисніть кнопку «Завантажити».');
      return;
    }
    if (uploading) { toast('Зачекайте, поки завершиться поточне завантаження.'); return; }
    uploading = true;
    try {
      const res = await Store.addFiles(files, showUpl);
      if (res.added && !res.failed) toast('Додано треків: ' + res.added);
      else if (res.added) toast('Додано: ' + res.added + ', не вдалося: ' + res.failed + '. ' + (res.errors[0] || ''));
      else toast('Не вдалося додати файли. ' + (res.errors[0] || ''));
    } catch (e) {
      toast(errText(e));
    }
    uploading = false;
    $('#upl').hidden = true;
  }

  async function del(id) {
    const t = byId(id);
    if (!t) return;
    if (!window.confirm('Видалити «' + (t.title || 'Без назви') + '»? Файл також буде видалено з Google Диска.')) return;
    try {
      await Store.removeTrack(t);
      toast('Видалено');
    } catch (e) {
      toast(errText(e));
    }
  }

  // ---------- акаунт ----------

  function toggleMenu(force) {
    const m = $('#userMenu');
    const open = force !== undefined ? force : m.hidden;
    m.hidden = !open;
    $('#userBtn').setAttribute('aria-expanded', String(open));
  }

  function onAuth(u) {
    if (!u) {
      hardStop();
      curId = null;
      body.dataset.auth = 'out';
      $('#authMsg').textContent = '';
      return;
    }
    body.dataset.auth = 'in';
    const img = $('#avatarImg');
    const txt = $('#avatarTxt');
    if (u.photo) {
      img.src = u.photo;
      img.hidden = false;
      txt.hidden = true;
    } else {
      img.hidden = true;
      txt.hidden = false;
      txt.textContent = (u.name || 'Т').trim().charAt(0).toUpperCase();
    }
    $('#muName').textContent = u.name || '';
    $('#muMail').textContent = u.email || '';
  }

  function onTracks(list) {
    tracks = list;
    body.toggleAttribute('data-empty', !tracks.length);
    if (curId && !byId(curId)) { hardStop(); curId = null; }
    if (!curId && tracks.length) {
      const last = store('tembr.last');
      const t = (last && byId(last)) || tracks[0];
      curId = t.id;
      pos = 0;
      dur = t.duration || 0;
    }
    if (!tracks.length) { dur = 0; pos = 0; }
    render();
    meta();
    tick();
  }

  function onError(msg) {
    if (body.dataset.auth === 'loading') {
      body.dataset.auth = 'out';
      $('[data-signin]').hidden = true;
      $('#authMsg').textContent = msg;
    } else {
      toast(msg);
    }
  }

  async function signIn() {
    const msg = $('#authMsg');
    msg.textContent = '';
    try {
      await Store.signIn();
    } catch (e) {
      msg.textContent = errText(e);
    }
  }

  // ---------- події ----------

  document.addEventListener('click', (e) => {
    const t = e.target;
    let el = t.closest('[data-del]');
    if (el) { del(el.dataset.del); return; }
    el = t.closest('[data-play-id]');
    if (el) {
      const id = el.dataset.playId;
      if (id === curId && loadedId === curId) togglePlay(); else load(id, true);
      return;
    }
    if (t.closest('[data-upload]')) { requestUpload(); return; }
    if (t.closest('[data-play]')) { togglePlay(); return; }
    if (t.closest('[data-prev]')) { prev(); return; }
    if (t.closest('[data-next]')) { next(); return; }
    if (t.closest('[data-shuffle]')) { toggleShuffle(); return; }
    if (t.closest('[data-repeat]')) { cycleRepeat(); return; }
    if (t.closest('[data-expand]')) { setView('expanded'); return; }
    if (t.closest('[data-collapse]')) { setView('compact'); return; }
    if (t.closest('[data-signin]')) { signIn(); return; }
    if (t.closest('[data-signout]')) { toggleMenu(false); Store.signOut(); return; }
    if (t.closest('#userBtn')) { toggleMenu(); return; }
    if (!t.closest('#userMenu')) toggleMenu(false);
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
    if (e.key === 'Escape') {
      toggleMenu(false);
      if (mq.matches && body.dataset.view === 'expanded') setView('compact');
      return;
    }
    if (body.dataset.auth !== 'in') return;
    if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); }
    else if (e.shiftKey && e.key === 'ArrowRight') next();
    else if (e.shiftKey && e.key === 'ArrowLeft') prev();
  });

  $('#q').addEventListener('input', (e) => { query = e.target.value; render(); });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  $$('[data-vol]').forEach((v) => {
    const saved = store('tembr.vol');
    if (saved != null && saved !== '') v.value = saved;
    audio.volume = v.value / 100;
    v.addEventListener('input', () => {
      audio.volume = v.value / 100;
      store('tembr.vol', v.value);
    });
  });

  $$('[data-seek]').forEach(bindSeek);

  // перетягування файлів у вікно
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0 && body.dataset.auth === 'in') {
      e.preventDefault();
      body.classList.add('drag');
    }
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) body.classList.remove('drag'); });
  document.addEventListener('drop', (e) => {
    if (!body.classList.contains('drag')) return;
    e.preventDefault();
    body.classList.remove('drag');
    handleFiles(e.dataTransfer.files);
  });

  audio.addEventListener('play', () => { playing = true; setPlayState(); meta(); });
  audio.addEventListener('pause', () => { playing = false; setPlayState(); });
  audio.addEventListener('timeupdate', () => { if (loadedId === curId) { pos = audio.currentTime; tick(); } });
  audio.addEventListener('loadedmetadata', () => {
    if (isFinite(audio.duration) && audio.duration > 0) { dur = audio.duration; tick(); }
  });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    playing = false;
    setPlayState();
    toast('Не вдалося відтворити цей файл (формат не підтримується браузером?).');
  });

  mq.addEventListener('change', applyView);

  // ---------- старт ----------

  shuffle = store('tembr.shuffle') === '1';
  repeat = ['off', 'all', 'one'].indexOf(store('tembr.repeat')) >= 0 ? store('tembr.repeat') : 'off';
  body.setAttribute('data-empty', '');
  syncModes();
  applyView();
  bindSession();
  meta();
  tick();
  setPlayState();

  if (!configured || !Store) {
    body.dataset.auth = 'out';
    $('[data-signin]').hidden = true;
    $('#authMsg').textContent = 'Не заповнено config.js: вкажіть ключі Firebase та Google Client ID (див. README.md).';
    return;
  }

  Store.init({ onAuth, onTracks, onError });

  setTimeout(() => {
    if (body.dataset.auth === 'loading') {
      onError('Не вдається підключитися до Firebase і Google. Перевірте з’єднання, вимкніть блокувальники реклами й оновіть сторінку.');
    }
  }, 15000);
})();
