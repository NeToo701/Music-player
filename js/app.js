// Інтерфейс і програвач Тембру.
(function () {
  'use strict';

  const C = window.TEMBR_CONFIG || {};
  const fbc = C.firebase || {};
  const Store = window.CloudStore;

  // Повертає опис проблеми з налаштуванням або порожній рядок, якщо все гаразд.
  function setupProblem() {
    if (!window.TEMBR_CONFIG) {
      return 'Файл config.js не завантажився: його немає в репозиторії поруч з index.html, або браузер показує стару копію (спробуйте Ctrl+F5).';
    }
    const need = [];
    if (!fbc.apiKey) need.push('firebase.apiKey');
    if (!fbc.projectId) need.push('firebase.projectId');
    if (!fbc.appId) need.push('firebase.appId');
    if (!C.googleClientId) need.push('googleClientId');
    if (need.length) return 'У config.js не заповнено: ' + need.join(', ') + '.';
    if (!Store) {
      return 'Не завантажився файл js/store-cloud.js: перевірте, що він є в папці js репозиторію, і оновіть сторінку (Ctrl+F5).';
    }
    return '';
  }
  const esc = window.U.esc;
  const fmt = window.U.fmt;
  const hash = window.U.hash;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const body = document.body;
  let audio = null;         // елемент, який зараз грає
  let spare = null;         // елемент із підвантаженим наступним треком

  const PAL = [
    ['#7dd3fc', '#0c4a6e'], ['#94a3b8', '#1e293b'], ['#fbbf77', '#7c2d12'], ['#86efac', '#14532d'],
    ['#f9a8d4', '#701a45'], ['#c4b5fd', '#3b0764'], ['#fca5a5', '#7f1d1d'], ['#5eead4', '#134e4a']
  ];

  let tracks = [];          // у порядку додавання: нові першими
  let playlists = [];
  let settings = { order: [], plOrder: [] };
  let me = null;
  let curId = null;
  let loadedId = null;
  let playing = false;
  let loadTok = 0;
  let pos = 0;
  let dur = 0;
  let shuffle = false;
  let repeat = 'off';       // off | all | one
  let query = '';
  let sortMode = 'new';     // new | old | az | za | custom
  let page = 'library';     // library | playlists | stats
  let plId = null;          // відкритий плейлист
  let uploading = false;
  let toastTimer = null;
  let spareId = null;       // id треку, підвантаженого у spare
  let resumeHint = false;   // перемикання не вдалося у фоні: нагадати натиснути ▶
  let pfTok = 0;
  let curAuto = false;      // чи потрібно грати одразу після завантаження
  let fallbackFor = null;   // трек, для якого вже пробували запасне завантаження
  let sharedChecked = false;
  let queueReady = false;
  let volume = 0.85;
  let wakeLock = null;
  let lyrOn = false;
  let lyrShown = null;      // { id, text }
  let lyrRaf = 0;
  let statsCtl = null;
  let plView = (function () { const v = store('tembr.plview'); return v === 'small' || v === 'list' ? v : 'big'; })();
  let plReorder = false;    // режим зміни порядку карток плейлистів
  const sel = new Set();    // вибрані пісні (множинний вибір)
  let advUntil = 0;         // до цього часу триває автоперемикання треку
  let wdTimer = 0;          // сторожовий таймер автоперемикання
  let plDragging = false;   // іде перетягування картки плейлиста
  let lpBlock = false;      // після довгого натискання гасимо наступний клік

  const Q = window.Queue.create();

  // ---------- журнал відтворення (для діагностики у фоні) ----------

  const LOGKEY = 'tembr.log';
  let logBuf = [];
  try { logBuf = JSON.parse(localStorage.getItem(LOGKEY) || '[]'); if (!Array.isArray(logBuf)) logBuf = []; } catch (e) { logBuf = []; }

  function plog(msg) {
    const d = new Date();
    const p = (n, l) => String(n).padStart(l || 2, '0');
    logBuf.push(p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3) + ' ' +
      (document.visibilityState === 'hidden' ? '[фон] ' : '') + msg);
    if (logBuf.length > 150) logBuf = logBuf.slice(-150);
    try { localStorage.setItem(LOGKEY, JSON.stringify(logBuf)); } catch (e) { /* не критично */ }
  }

  const tname = (id) => { const t = id && tracks.find((x) => x.id === id); return t ? '«' + (t.title || '?') + '»' : String(id); };

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
    if (code === 'permission-denied') return 'Firestore відхилив запит. Оновіть правила бази (README, крок 1.4).';
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

  const artistsOf = (t) => (t.artists && t.artists.length ? t.artists.slice() : String(t.artist || '').split(',').map((s) => s.trim()).filter(Boolean));

  function coverCss(t) {
    if (t.cover) return "center / cover no-repeat url('" + t.cover + "')";
    const i = hash(String(t.id));
    const p = PAL[i % PAL.length];
    return 'linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
  }

  // ---------- списки: сортування, плейлисти ----------

  function customOrdered() {
    const idx = new Map((settings.order || []).map((id, i) => [id, i]));
    const known = tracks.filter((t) => idx.has(t.id)).sort((a, b) => idx.get(a.id) - idx.get(b.id));
    const fresh = tracks.filter((t) => !idx.has(t.id));
    return fresh.concat(known);
  }

  function sortedTracks() {
    const cmp = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'uk', { numeric: true, sensitivity: 'base' });
    switch (sortMode) {
      case 'old': return tracks.slice().reverse();
      case 'az': return tracks.slice().sort(cmp);
      case 'za': return tracks.slice().sort(cmp).reverse();
      case 'custom': return customOrdered();
      default: return tracks.slice();
    }
  }

  const FAV = 'favorites';

  function favorites() {
    return playlists.find((p) => p.id === FAV) || { id: FAV, name: 'Улюблені', kind: 'favorites', trackIds: [] };
  }

  // «Улюблені» закріплені зверху за замовчуванням; решту закріплює користувач.
  const isPinned = (p) => (p.id === FAV ? p.pinned !== false : !!p.pinned);

  function plList() {
    const others = playlists.filter((p) => p.id !== FAV).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const all = [favorites()].concat(others);
    const idx = new Map((settings.plOrder || []).map((id, i) => [id, i]));
    const rank = (p, i) => (idx.has(p.id) ? idx.get(p.id) : (p.id === FAV ? -1 : 100000 + i));
    return all
      .map((p, i) => ({ p, g: isPinned(p) ? 0 : 1, r: rank(p, i) }))
      .sort((a, b) => a.g - b.g || a.r - b.r)
      .map((x) => x.p);
  }

  const plById = (id) => plList().find((p) => p.id === id) || null;
  const plTracks = (p) => (p.trackIds || []).map(byId).filter(Boolean);
  const isFav = (id) => (favorites().trackIds || []).indexOf(id) >= 0;

  function savePl(p, ids) {
    return Store.savePlaylist({ id: p.id, name: p.name, kind: p.kind, trackIds: ids });
  }

  // ---------- відображення ----------

  const ICON_MORE = '<svg class="ic"><use href="#i-more"/></svg>';

  function rowHtml(t, i) {
    const act = t.id === curId;
    const id = esc(t.id);
    const title = esc(t.title || 'Без назви');
    return '<div class="row' + (act ? ' active' : '') + (sel.has(t.id) ? ' sel' : '') + '" data-id="' + id + '">' +
      '<button class="grip" data-grip aria-label="Перетягнути" tabindex="-1"><svg class="ic"><use href="#i-grip"/></svg></button>' +
      '<button class="r-main" data-play-id="' + id + '">' +
      '<span class="n"><span class="eq"><i></i><i></i><i></i></span><b>' + (i + 1) + '</b></span>' +
      '<span class="cv" style="background:' + coverCss(t) + '"><i class="chk"><svg class="ic"><use href="#i-check"/></svg></i></span>' +
      '<span class="x"><span class="t">' + title + '</span><span class="a">' + esc(t.artist || 'Невідомий виконавець') + '</span></span>' +
      '<span class="d">' + (t.duration ? fmt(t.duration) : '—:—') + '</span>' +
      '</button>' +
      '<button class="more" data-more="' + id + '" aria-label="Меню «' + title + '»" aria-haspopup="menu">' + ICON_MORE + '</button>' +
      '</div>';
  }

  function blankHtml() {
    return '<div class="blank"><svg class="ic"><use href="#i-music"/></svg><h3>Бібліотека порожня</h3>' +
      '<p>Завантажте музику: файли збережуться на вашому Google Диску, а список треків у Firebase.</p>' +
      '<button class="up" data-upload><svg class="ic"><use href="#i-up"/></svg><span>Завантажити</span></button></div>';
  }

  function covMosaic(list) {
    const c = list.slice(0, 4);
    if (!c.length) return '<div class="pl-cv empty"><svg class="ic"><use href="#i-music"/></svg></div>';
    if (c.length < 4) return '<div class="pl-cv one"><i style="background:' + coverCss(c[0]) + '"></i></div>';
    return '<div class="pl-cv">' + c.map((t) => '<i style="background:' + coverCss(t) + '"></i>').join('') + '</div>';
  }

  function renderLibrary() {
    const q = query.trim().toLowerCase();
    const sorted = sortedTracks();
    const items = sorted.map((t, i) => ({ t, i })).filter((o) =>
      !q || ((o.t.title || '') + ' ' + (o.t.artist || '') + ' ' + (o.t.album || '')).toLowerCase().includes(q));
    const host = $('[data-list]');
    host.classList.toggle('drag-on', sortMode === 'custom' && !q);
    if (!tracks.length) host.innerHTML = blankHtml();
    else if (!items.length) host.innerHTML = '<div class="blank"><p>Нічого не знайдено</p></div>';
    else host.innerHTML = items.map((o) => rowHtml(o.t, o.i)).join('');
  }

  function plMeta(list) {
    const sec = list.reduce((a, t) => a + (t.duration || 0), 0);
    const mins = Math.round(sec / 60);
    return list.length + ' ' + pluralTr(list.length) + (mins ? ' · ' + (mins >= 60 ? Math.floor(mins / 60) + ' год ' + (mins % 60) + ' хв' : mins + ' хв') : '');
  }

  function pluralTr(n) {
    const a = n % 100;
    const b = n % 10;
    if (a > 10 && a < 20) return 'треків';
    if (b > 1 && b < 5) return 'треки';
    if (b === 1) return 'трек';
    return 'треків';
  }

  function plCardHtml(p) {
    const list = plTracks(p);
    const id = esc(p.id);
    const pin = isPinned(p);
    const cv = p.id === FAV
      ? '<div class="pl-cv fav-cv"><svg class="ic"><use href="#i-heart"/></svg></div>'
      : covMosaic(list);
    const name = esc(p.name || 'Без назви');
    return '<div class="pl-card' + (pin ? ' pinned' : '') + '" data-open-pl="' + id + '" data-pl-id="' + id + '" data-pin="' + (pin ? 1 : 0) + '" tabindex="0" role="button">' +
      '<button class="pl-grip" data-pl-grip aria-label="Перетягнути" tabindex="-1"><svg class="ic"><use href="#i-grip"/></svg></button>' +
      cv +
      '<span class="pl-info"><span class="pl-name">' + name + '</span>' +
      '<span class="pl-cnt">' + (pin ? '<svg class="ic pin-i" aria-label="Закріплено"><use href="#i-pin"/></svg>' : '') + list.length + ' ' + pluralTr(list.length) + '</span></span>' +
      '<button class="pl-more" data-pl-more="' + id + '" aria-label="Меню «' + name + '»" aria-haspopup="menu">' + ICON_MORE + '</button></div>';
  }

  const VIEWS = [['big', 'i-v-big', 'Великі плитки'], ['small', 'i-v-small', 'Малі плитки'], ['list', 'i-v-list', 'Список']];

  function renderPlaylists() {
    const host = $('[data-pls]');
    const cards = plList().map(plCardHtml).join('');
    host.innerHTML = '<div class="pls-h"><h3>Плейлисти</h3>' +
      '<div class="pls-tools"><div class="seg" role="group" aria-label="Вигляд">' +
      VIEWS.map((v) => '<button data-pl-view="' + v[0] + '" class="' + (plView === v[0] ? 'on' : '') + '" aria-label="' + v[2] + '" title="' + v[2] + '" aria-pressed="' + (plView === v[0]) + '"><svg class="ic"><use href="#' + v[1] + '"/></svg></button>').join('') +
      '</div><button class="ghost alt' + (plReorder ? ' on' : '') + '" data-pl-reorder aria-label="Змінити порядок" title="Змінити порядок"><svg class="ic"><use href="#i-grip"/></svg></button>' +
      '<button class="up" data-new-pl><svg class="ic"><use href="#i-plus"/></svg><span>Новий плейлист</span></button></div></div>' +
      (plReorder ? '<div class="pl-hint"><span>Перетягніть картку за значок ⋮⋮. Закріплені лишаються зверху.</span><button class="selbtn main" data-pl-reorder-done>Готово</button></div>' : '') +
      '<div class="pl-grid v-' + plView + (plReorder ? ' reorder' : '') + '">' + cards +
      '<div class="pl-card new" data-new-pl tabindex="0" role="button"><div class="pl-cv new-cv"><svg class="ic"><use href="#i-plus"/></svg></div><span class="pl-info"><span class="pl-name">Створити плейлист</span></span></div></div>';
  }

  function renderPlaylistDetail() {
    const p = plById(plId);
    if (!p) { setPage('playlists'); return; }
    const list = plTracks(p);
    const head = $('[data-plh]');
    head.innerHTML =
      '<button class="ghost alt" data-pl-back aria-label="До плейлистів"><svg class="ic"><use href="#i-back"/></svg></button>' +
      '<div class="plh-t"><b>' + esc(p.name) + '</b><small>' + plMeta(list) + '</small></div>' +
      '<button class="up" data-pl-play' + (list.length ? '' : ' disabled') + '><svg class="ic"><use href="#i-play"/></svg><span>Відтворити</span></button>' +
      '<button class="ghost alt" data-pl-shuffle aria-label="Перемішати"' + (list.length ? '' : ' disabled') + '><svg class="ic"><use href="#i-shuffle"/></svg></button>' +
      '<button class="ghost alt" data-pl-menu aria-label="Меню плейлиста" aria-haspopup="menu">' + ICON_MORE + '</button>';
    const host = $('[data-list]');
    host.classList.remove('drag-on');
    host.innerHTML = list.length
      ? list.map((t, i) => rowHtml(t, i)).join('')
      : '<div class="blank"><svg class="ic"><use href="#i-music"/></svg><h3>У плейлисті поки порожньо</h3><p>Додавайте треки через меню «⋮» біля треку в бібліотеці' + (p.id === FAV ? ' або кнопку ♥ у плеєрі' : '') + '.</p></div>';
  }

  function render() {
    $$('[data-count]').forEach((e) => { e.textContent = tracks.length; });
    if (page === 'library') renderLibrary();
    else if (page === 'playlists') { if (plId) renderPlaylistDetail(); else renderPlaylists(); }
    updateSelUI();
  }

  function setPage(p, id) {
    page = p;
    plId = p === 'playlists' ? (id || null) : null;
    sel.clear();
    plReorder = false;
    body.dataset.page = p;
    const detail = p === 'playlists' && !!plId;
    $('[data-plh]').hidden = !detail;
    $('[data-list]').hidden = !(p === 'library' || detail);
    $('[data-pls]').hidden = !(p === 'playlists' && !plId);
    $('[data-stats]').hidden = p !== 'stats';
    $$('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === (p === 'stats' ? '' : p)));
    if (p !== 'stats') statsCtl = null;
    render();
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
    updateFav();
    syncLyrics();
    updateSession();
  }

  function updateFav() {
    const on = !!curId && isFav(curId);
    $$('[data-fav]').forEach((b) => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Прибрати з «Улюблених»' : 'Додати в «Улюблені»');
      b.disabled = !curId;
    });
  }

  function tick() {
    const p = dur ? Math.min(100, (pos / dur) * 100) : 0;
    $$('[data-cur]').forEach((e) => { e.textContent = fmt(pos); });
    $$('[data-dur]').forEach((e) => { e.textContent = dur ? fmt(dur) : '0:00'; });
    $$('[data-fill]').forEach((e) => { e.style.width = p + '%'; });
    $$('[data-seek]').forEach((e) => e.setAttribute('aria-valuenow', String(Math.round(p))));
    if (lyrOn && lyrView) lyrView.update(pos);
  }

  function setPlayState() {
    body.classList.toggle('playing', playing);
    $$('[data-play]').forEach((b) => b.setAttribute('aria-label', playing ? 'Пауза' : 'Відтворити'));
    const t = cur();
    document.title = playing && t ? (t.title || 'Тембр') + ' — Тембр' : 'Тембр';
    // Під час автоперемикання на наступний трек не показуємо системі «паузу»: це може скинути сеанс.
    const keep = !playing && Date.now() < advUntil;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = (playing || keep) ? 'playing' : 'paused';
    lyrLoopSync();
  }

  function setStatus(txt) {
    $$('[data-status]').forEach((e) => { e.textContent = txt; });
  }

  function setLoading(on) {
    body.classList.toggle('loading', on);
    if (!on) setStatus('');
  }

  // ---------- текст пісні ----------

  const lyrView = window.Lyrics.View($('#lyr'), {
    onSeek: (t) => { if (dur && loadedId === curId) seekTo(t / dur); },
    onAdd: () => { if (curId) editLyrics(curId); }
  });

  function syncLyrics() {
    const t = cur();
    const text = t ? (t.lyrics || '') : '';
    const id = t ? t.id : null;
    if (lyrShown && lyrShown.id === id && lyrShown.text === text) return;
    lyrShown = { id, text };
    lyrView.set(text);
    if (lyrOn) lyrView.update(pos);
  }

  function setLyrOn(on) {
    lyrOn = on;
    store('tembr.lyr', on ? '1' : '0');
    body.classList.toggle('lyr-on', on);
    $$('[data-lyrics-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    if (on) { syncLyrics(); lyrView.update(pos); setTimeout(() => lyrView.recenter(), 30); }
    lyrLoopSync();
  }

  // Плавне заповнення слів потребує частіших оновлень, ніж timeupdate (~4 рази на секунду).
  function lyrLoopSync() {
    const need = lyrOn && playing && !document.hidden && lyrView.isSynced();
    if (need && !lyrRaf) {
      const step = () => {
        lyrRaf = 0;
        if (!(lyrOn && playing && !document.hidden)) return;
        lyrView.update(audio.currentTime);
        lyrRaf = requestAnimationFrame(step);
      };
      lyrRaf = requestAnimationFrame(step);
    } else if (!need && lyrRaf) {
      cancelAnimationFrame(lyrRaf);
      lyrRaf = 0;
    }
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

  // ---------- статистика прослуховувань ----------

  const tr = { id: null, sec: 0, pend: 0, last: null, counted: false };

  function flushStats(count) {
    if (!tr.id || !Store.recordPlay) return Promise.resolve();
    const plays = count ? 1 : 0;
    const sec = tr.pend;
    if (!plays && sec < 3) return Promise.resolve();
    tr.pend = 0;
    return Promise.resolve(Store.recordPlay(window.Stats.keys(new Date()), tr.id, plays, sec)).catch(() => {});
  }

  function trReset(id) {
    flushStats(false);
    tr.id = id;
    tr.sec = 0;
    tr.pend = 0;
    tr.last = null;
    tr.counted = false;
  }

  // Прослуховування зараховується, коли награно 30 секунд (або половину короткого треку).
  function trTick(ct) {
    if (!tr.id || !playing) { tr.last = null; return; }
    if (tr.last != null) {
      const d = ct - tr.last;
      if (d > 0 && d < 2.5) { tr.sec += d; tr.pend += d; }
    }
    tr.last = ct;
    if (!tr.counted && tr.sec >= Math.min(30, (dur || 60) * 0.5)) {
      tr.counted = true;
      flushStats(true);
    }
  }

  // ---------- черга ----------

  const qKey = () => 'tembr.q.' + (me && me.uid ? me.uid : 'x');

  function saveQueue() {
    try { localStorage.setItem(qKey(), JSON.stringify(Q.serialize())); } catch (e) { /* не критично */ }
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem(qKey());
      return raw ? Q.restore(JSON.parse(raw)) : false;
    } catch (e) { return false; }
  }

  // Будує чергу з контексту (бібліотека, плейлист, статистика) і запускає трек.
  function startContext(id, key, ids) {
    Q.build(ids, id, shuffle, key);
    saveQueue();
    load(id, true);
  }

  function libraryIds() { return sortedTracks().map((t) => t.id); }

  function resetQueue() {
    if (!tracks.length) return;
    const id = curId && byId(curId) ? curId : tracks[0].id;
    Q.build(libraryIds(), id, shuffle, 'library');
    saveQueue();
    prefetchNext();
    toast(shuffle ? 'Чергу скинуто й перемішано заново' : 'Чергу скинуто: тепер вона йде за порядком бібліотеки');
  }

  // ---------- відтворення ----------

  function hardStop() {
    loadTok++;
    pfTok++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    clearSpare();
    loadedId = null;
    playing = false;
    pos = 0;
    setLoading(false);
    setPlayState();
  }

  function clearSpare() {
    spareId = null;
    if (spare.getAttribute('src')) {
      spare.removeAttribute('src');
      spare.load();
    }
  }

  const isStreamUrl = (u) => String(u || '').indexOf('/__stream/') >= 0;

  function startPlay(attempt) {
    if (!curId) return;
    const a = audio;
    const n = attempt || 1;
    const p = a.play();
    if (p && p.then) p.then(() => plog('play() ок: ' + tname(curId) + (n > 1 ? ' (спроба ' + n + ')' : '')), () => {});
    if (p && p.catch) {
      p.catch((err) => {
        plog('play() відхилено: ' + (err && err.name) + ' ' + ((err && err.message) || '') + ' [' + tname(curId) + ', спроба ' + n + ']');
        // AbortError: трек змінили; NotSupportedError: про це повідомить подія error самого елемента.
        if (err && (err.name === 'AbortError' || err.name === 'NotSupportedError')) { playing = false; setPlayState(); return; }
        // У фоні браузер іноді відхиляє перший виклик: пробуємо ще.
        if (n < 4 && a === audio && !a.ended) {
          setTimeout(() => { if (a === audio && a.paused && curAuto) startPlay(n + 1); }, 350 * n);
          return;
        }
        playing = false;
        advUntil = 0;
        setPlayState();
        if (document.visibilityState === 'hidden') resumeHint = true;
        else toast('Не вдалося почати відтворення. Натисніть ▶ ще раз.');
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
    pfTok++;
    plog('завантаження ' + tname(id) + ' (autoplay=' + !!autoplay + ', у запасі: ' + (spareId === id ? 'так' : 'ні') + ', на пристрої: ' + (Store.isCached && Store.isCached(id) ? 'так' : 'ні') + ')');
    audio.pause();
    playing = false;
    loadedId = null;
    curId = id;
    curAuto = !!autoplay;
    fallbackFor = null;
    store('tembr.last', id);
    pos = 0;
    dur = t.duration || 0;
    trReset(id);
    render();
    meta();
    tick();
    setPlayState();

    // Трек уже підвантажено у запасний елемент: міняємо місцями, грає одразу.
    if (spareId === id && spare.getAttribute('src')) {
      const old = audio;
      audio = spare;
      spare = old;
      clearSpare();
      loadedId = id;
      if (isFinite(audio.duration) && audio.duration > 0) dur = audio.duration;
      tick();
      if (audio.readyState >= 3 || !autoplay) {
        setLoading(false);
      } else {
        setLoading(true);
        setStatus('Буферизація…');
      }
      if (autoplay) startPlay();
      prefetchNext();
      return;
    }

    setLoading(true);
    if (Store.streaming && Store.streaming()) setStatus('Підключення до Диска…');

    let url = null;
    try {
      // Коли екран вимкнено, вікно Google відкрити неможливо: не чекаємо його, а лишаємо трек на паузі.
      url = await Store.getAudioUrl(t, (p) => {
        if (tok === loadTok) setStatus('Завантаження з Диска… ' + Math.round(p * 100) + '%');
      }, { silent: document.visibilityState === 'hidden' });
    } catch (e) {
      if (tok !== loadTok) return;
      setLoading(false);
      plog('getAudioUrl помилка: ' + String((e && e.message) || e));
      if (document.visibilityState === 'hidden' || /no_token|popup/i.test(String((e && e.message) || ''))) resumeHint = true;
      if (document.visibilityState !== 'hidden') toast(errText(e));
      return;
    }
    if (tok !== loadTok) return;
    resumeHint = false;
    loadedId = id;
    audio.src = url;
    if (!autoplay) setLoading(false);
    if (autoplay) startPlay();
    prefetchNext();
  }

  // Підвантажує наступний трек черги у запасний елемент, щоб перемикання було миттєвим.
  async function prefetchNext() {
    const tk = ++pfTok;
    warmTok++;          // черга змінилась: завантаження наперед почнемо заново
    warmFor = null;
    if (repeat === 'one') { clearSpare(); return; }
    const id = Q.peekNext(repeat, true);
    const n = id && id !== curId ? byId(id) : null;
    if (!n) { clearSpare(); return; }
    if (spareId === n.id) return;
    try {
      const url = await Store.getAudioUrl(n, null, { silent: true });
      if (tk !== pfTok) return;
      spare.src = url;
      spare.load();
      spareId = n.id;
    } catch (e) { plog('підвантаження наступного не вдалось: ' + String((e && e.message) || e)); }
  }

  // ---------- завантаження наперед ----------
  // Кілька наступних треків качаються цілком і лежать у пам'яті. Тоді черга грає далі навіть зі вимкненим
  // екраном і після завершення години дії токена Google: мережа й вікно входу для цього не потрібні.

  let warmTok = 0;
  let warmFor = null;      // для якого поточного треку вже запущено завантаження наперед

  // Завжди 4 наперед: менша кількість (наприклад, через «Заощадження трафіку») означала б зупинку черги у фоні.
  const aheadCount = () => 4;

  async function warmAhead() {
    const tk = ++warmTok;
    warmFor = curId;
    const ids = Q.peekAhead(aheadCount(), repeat);
    for (let k = 0; k < ids.length; k++) {
      if (tk !== warmTok) return;
      const t = byId(ids[k]);
      if (!t) continue;
      try {
        const cached = Store.isCached(t.id);
        const url = await Store.getAudioUrl(t, null, { silent: true, blob: true });
        if (tk !== warmTok) return;
        if (!cached) plog('завантажено наперед: ' + tname(t.id));
        // Якщо цей трек уже стоїть у запасному елементі як потік, підміняємо його на локальну копію.
        if (spareId === t.id && spare.getAttribute('src') !== url) {
          spare.src = url;
          spare.load();
        }
      } catch (e) { plog('завантаження наперед зупинилось: ' + String((e && e.message) || e)); return; }   // без токена чи мережі далі не йдемо
    }
  }

  // Починаємо, коли поточний трек уже майже весь у буфері (або награно 25 с), щоб не заважати йому.
  function maybeWarm(a) {
    if (warmFor === curId || !curId || a !== audio || loadedId !== curId) return;
    let buffered = false;
    try {
      const b = a.buffered;
      buffered = b.length > 0 && isFinite(a.duration) && a.duration > 0 && b.end(b.length - 1) >= a.duration - 1.5;
    } catch (e) { /* без буфера */ }
    if (buffered || a.currentTime > 25 || Store.isCached(curId)) warmAhead();
  }

  // Якщо стрімінг не спрацював, завантажуємо файл цілком і продовжуємо з того ж місця.
  async function fallbackToBlob() {
    const t = cur();
    if (!t) return;
    fallbackFor = t.id;
    const tok = ++loadTok;
    const resume = playing || curAuto;
    const at = audio.currentTime || 0;
    playing = false;
    setPlayState();
    setLoading(true);
    try {
      const url = await Store.getAudioUrl(t, (p) => {
        if (tok === loadTok) setStatus('Завантаження з Диска… ' + Math.round(p * 100) + '%');
      }, { blob: true });
      if (tok !== loadTok) return;
      audio.addEventListener('loadedmetadata', () => { if (at > 1) audio.currentTime = at; }, { once: true });
      audio.src = url;
      if (resume) startPlay();
    } catch (e) {
      if (tok !== loadTok) return;
      setLoading(false);
      toast(errText(e));
    }
  }

  function onAudioError(a) {
    if (a === spare) { clearSpare(); return; }
    if (a !== audio || !audio.getAttribute('src')) return;
    if (isStreamUrl(audio.src) && fallbackFor !== curId && Store.getAudioUrl) {
      fallbackToBlob();
      return;
    }
    playing = false;
    setLoading(false);
    setPlayState();
    toast('Не вдалося відтворити цей файл (формат не підтримується браузером?).');
  }

  function mkAudio() {
    const a = new Audio();
    a.preload = 'auto';
    a.volume = volume;
    a.addEventListener('play', () => { if (a === audio) { playing = true; setPlayState(); meta(); } });
    a.addEventListener('pause', () => { if (a === audio) { playing = false; setPlayState(); flushStats(false); } });
    a.addEventListener('timeupdate', () => {
      if (a === audio && loadedId === curId) { pos = a.currentTime; trTick(pos); tick(); maybeWarm(a); }
    });
    a.addEventListener('loadedmetadata', () => {
      if (a === audio && isFinite(a.duration) && a.duration > 0) { dur = a.duration; tick(); }
    });
    const ready = () => { if (a === audio && loadedId === curId && body.classList.contains('loading')) setLoading(false); };
    a.addEventListener('canplay', ready);
    a.addEventListener('playing', ready);
    a.addEventListener('ended', () => { if (a === audio) onEnded(); });
    a.addEventListener('error', () => { plog('помилка елемента ' + (a === audio ? 'грає' : 'запас') + ': код ' + (a.error && a.error.code) + ' ' + ((a.error && a.error.message) || '')); onAudioError(a); });
    a.addEventListener('stalled', () => { if (a === audio) plog('stalled'); });
    a.addEventListener('waiting', () => { if (a === audio) plog('waiting (буферизація)'); });
    a.addEventListener('playing', () => { if (a === audio) { advUntil = 0; plog('playing'); } });
    return a;
  }

  function next() {
    const id = Q.next(repeat, false);
    if (!id) return;
    saveQueue();
    load(id, true);
  }

  function prev() {
    if (!tracks.length) return;
    if (pos > 3 && loadedId === curId) { seekTo(0); return; }
    const id = Q.prev();
    if (!id) return;
    saveQueue();
    load(id, true);
  }

  function onEnded() {
    plog('кінець треку ' + tname(curId) + ' (' + Math.round(pos) + '/' + Math.round(dur) + ' с)');
    flushStats(false);
    advUntil = Date.now() + 6000;
    setTimeout(setPlayState, 6200);
    if (repeat === 'one') {
      trReset(curId);
      audio.currentTime = 0;
      startPlay();
      return;
    }
    const id = Q.next(repeat, true);
    if (id) {
      saveQueue();
      load(id, true);
      watchdog(id);
    } else {
      plog('черга закінчилась');
      pausePlay();
      pos = 0;
      audio.currentTime = 0;
      tick();
    }
  }

  // Якщо після автоперемикання трек так і не заграв (у фоні таке бувало), пробуємо ще раз іншим шляхом.
  function watchdog(id) {
    clearTimeout(wdTimer);
    wdTimer = setTimeout(() => {
      if (curId !== id || playing) return;
      plog('сторож: ' + tname(id) + ' не грає через 4 с (loadedId=' + (loadedId === id ? 'так' : 'ні') + ', paused=' + audio.paused + ', readyState=' + audio.readyState + ')');
      if (loadedId === id) {
        startPlay();
        wdTimer = setTimeout(() => {
          if (curId !== id || playing) return;
          plog('сторож: друга спроба, завантажуємо трек заново');
          spareId = null;
          load(id, true);
        }, 3000);
      } else {
        spareId = null;
        load(id, true);
      }
    }, 4000);
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
    Q.setShuffle(shuffle);
    saveQueue();
    syncModes();
    prefetchNext();
  }

  function cycleRepeat() {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    store('tembr.repeat', repeat);
    syncModes();
    prefetchNext();
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
    // Окремі дії, а не перемикач: інакше зайвий «play» від системи поставив би трек на паузу.
    set('play', () => {
      plog('медіасеанс: play');
      if (!curId) return;
      if (loadedId !== curId) { load(curId, true); return; }
      if (!playing) startPlay();
    });
    set('pause', () => { plog('медіасеанс: pause'); if (playing) pausePlay(); });
    set('previoustrack', () => { plog('медіасеанс: previous'); prev(); });
    set('nexttrack', () => { plog('медіасеанс: next'); next(); });
    set('seekto', (d) => { if (dur && d && d.seekTime != null) seekTo(d.seekTime / dur); });
  }

  // ---------- редагування треку ----------

  async function patchTrack(id, patch, okMsg) {
    try {
      await Store.updateTrack(id, patch);
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(errText(e));
    }
  }

  async function renameTrack(id) {
    const t = byId(id);
    if (!t) return;
    const v = await window.UI.prompt({ title: 'Змінити назву', label: 'Назва треку', value: t.title || '' });
    if (v && v !== t.title) patchTrack(id, { title: v }, 'Назву змінено');
  }

  function editArtists(id) {
    const t = byId(id);
    if (!t) return;
    const names = artistsOf(t);
    if (!names.length) names.push('');
    const m = window.UI.modal({
      title: 'Виконавці',
      body: '<div data-arts></div><button class="art-add" data-art-add type="button"><svg class="ic"><use href="#i-plus"/></svg>Додати ще виконавця</button>',
      actions: []
    });
    const host = $('[data-arts]', m.body);
    const addRow = (v) => {
      const row = document.createElement('div');
      row.className = 'art-row';
      row.innerHTML = '<input type="text" maxlength="100" placeholder="Ім’я виконавця" value="' + esc(v) + '">' +
        '<button class="ghost" type="button" data-art-del aria-label="Прибрати виконавця"><svg class="ic"><use href="#i-close"/></svg></button>';
      host.appendChild(row);
      return row;
    };
    names.forEach(addRow);
    m.body.addEventListener('click', (e) => {
      if (e.target.closest('[data-art-add]')) { addRow('').querySelector('input').focus(); return; }
      const d = e.target.closest('[data-art-del]');
      if (d) {
        if ($$('.art-row', host).length > 1) d.closest('.art-row').remove();
        else d.closest('.art-row').querySelector('input').value = '';
      }
    });
    const save = () => {
      const list = $$('.art-row input', host).map((i) => i.value.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')).filter(Boolean);
      const uniq = list.filter((n, i) => list.indexOf(n) === i);
      m.close();
      patchTrack(id, { artist: uniq.join(', '), artists: uniq }, 'Виконавців збережено');
    };
    m.setActions([
      { label: 'Скасувати', kind: 'ghost', onClick: (mm) => mm.close() },
      { label: 'Зберегти', kind: 'primary', onClick: save }
    ]);
    host.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }

  function pickCover(id) {
    const inp = $('#coverFile');
    inp.dataset.id = id;
    inp.click();
  }

  async function onCoverChosen(file, id) {
    if (!file || !byId(id)) return;
    try {
      const cover = await window.U.resizeImage(file, 256);
      await patchTrack(id, { cover }, 'Обкладинку змінено');
    } catch (e) {
      toast('Не вдалося прочитати зображення.');
    }
  }

  function editLyrics(id) {
    const t = byId(id);
    if (!t) return;
    const m = window.UI.modal({
      title: 'Текст пісні',
      wide: true,
      body: '<div class="lyr-tools"><button class="mdl-btn" type="button" data-lyr-find>Знайти в Інтернеті</button>' +
        '<span class="mdl-p" style="font-size:13px">або вставте свій. Для підсвітки слів потрібен формат із часом: [01:23.45] рядок</span></div>' +
        '<textarea data-lyr-text placeholder="Вставте текст пісні сюди" spellcheck="false"></textarea><div class="lyr-st" data-lyr-st aria-live="polite"></div>',
      actions: []
    });
    const ta = $('[data-lyr-text]', m.body);
    const st = $('[data-lyr-st]', m.body);
    ta.value = t.lyrics || '';
    const status = (txt, good) => { st.textContent = txt; st.classList.toggle('ok', !!good); };
    const hint = () => {
      const p = window.Lyrics.parse(ta.value);
      if (p.lines.length) status(p.synced ? 'Текст із часом: рядки підсвічуватимуться під час відтворення.' : 'Звичайний текст: без підсвітки рядків.', p.synced);
      else status('');
    };
    hint();
    ta.addEventListener('input', hint);
    $('[data-lyr-find]', m.body).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      status('Шукаю текст…');
      try {
        const r = await window.Lyrics.search(t);
        if (!r) status('Нічого не знайдено. Вставте текст вручну.');
        else {
          ta.value = r.text;
          status((r.synced ? 'Знайдено текст із часом: підсвічуватиметься під час відтворення. ' : 'Знайдено лише звичайний текст, без часу. ') +
            (r.approx ? 'Збіг приблизний, перевірте, що це та сама пісня.' : ''), r.synced && !r.approx);
        }
      } catch (err) {
        status('Не вдалося звернутися до сервісу текстів. Перевірте з’єднання або вставте текст вручну.');
      }
      btn.disabled = false;
    });
    m.setActions([
      { label: 'Видалити текст', kind: 'ghost', onClick: (mm) => { mm.close(); patchTrack(id, { lyrics: '' }, 'Текст видалено'); } },
      { label: 'Скасувати', kind: 'ghost', onClick: (mm) => mm.close() },
      { label: 'Зберегти', kind: 'primary', onClick: (mm) => { const v = ta.value.trim(); mm.close(); patchTrack(id, { lyrics: v }, v ? 'Текст збережено' : 'Текст видалено'); } }
    ]);
  }

  function pickPlaylist(id) {
    const t = byId(id);
    if (!t) return;
    const m = window.UI.modal({ title: 'Додати до плейлиста', body: '<ul class="pl-pick" data-pick></ul>', actions: [] });
    const host = $('[data-pick]', m.body);
    const draw = () => {
      host.innerHTML = plList().map((p) => {
        const has = (p.trackIds || []).indexOf(id) >= 0;
        return '<li><label><input type="checkbox" data-pl="' + esc(p.id) + '"' + (has ? ' checked' : '') + '><span>' + esc(p.name) + '</span><small>' + (p.trackIds || []).length + '</small></label></li>';
      }).join('');
    };
    draw();
    host.addEventListener('change', async (e) => {
      const p = plById(e.target.dataset.pl);
      if (!p) return;
      const ids = (p.trackIds || []).filter((x) => x !== id);
      if (e.target.checked) ids.push(id);
      try { await savePl(p, ids); } catch (err) { toast(errText(err)); e.target.checked = !e.target.checked; }
    });
    m.setActions([
      { label: 'Новий плейлист', kind: 'ghost', onClick: async (mm) => {
        const name = await window.UI.prompt({ title: 'Новий плейлист', label: 'Назва плейлиста', ok: 'Створити' });
        if (!name) return;
        try { await Store.savePlaylist({ name, trackIds: [id] }); mm.close(); toast('Плейлист «' + name + '» створено, трек додано'); } catch (err) { toast(errText(err)); }
      } },
      { label: 'Готово', kind: 'primary', onClick: (mm) => mm.close() }
    ]);
    // список оновлюється, коли приходять зміни з Firestore
    const prevHook = onPlaylistsHook;
    onPlaylistsHook = () => { if (document.body.contains(m.el)) draw(); else onPlaylistsHook = prevHook; };
  }

  let onPlaylistsHook = null;

  async function removeTrack(id) {
    const t = byId(id);
    if (!t) return;
    const ok = await window.UI.confirm({
      title: 'Видалити трек?',
      text: '«' + (t.title || 'Без назви') + '» буде видалено з бібліотеки й з Google Диска.',
      ok: 'Видалити',
      danger: true
    });
    if (!ok) return;
    try {
      await Store.removeTrack(t);
      const owners = plList().filter((p) => (p.trackIds || []).indexOf(id) >= 0 && playlists.some((x) => x.id === p.id));
      await Promise.all(owners.map((p) => savePl(p, p.trackIds.filter((x) => x !== id)).catch(() => {})));
      toast('Видалено');
    } catch (e) {
      toast(errText(e));
    }
  }

  async function openRowMenu(id, anchor) {
    const inPl = page === 'playlists' && plId;
    const items = [
      { label: 'Змінити назву', act: 'rename', icon: 'i-edit' },
      { label: 'Змінити виконавця', act: 'artists', icon: 'i-user' },
      { label: 'Додати до плейлиста', act: 'playlist', icon: 'i-pl-add' },
      { label: 'Змінити обкладинку', act: 'cover', icon: 'i-image' },
      { label: 'Текст пісні', act: 'lyrics', icon: 'i-lyrics' }
    ];
    if (inPl) items.push({ label: 'Прибрати з плейлиста', act: 'unpl', icon: 'i-pl-rm' });
    items.push({ sep: true }, { label: 'Видалити', act: 'delete', icon: 'i-trash', danger: true });
    const act = await window.UI.menu(anchor, items);
    if (act === 'rename') renameTrack(id);
    else if (act === 'artists') editArtists(id);
    else if (act === 'playlist') pickPlaylist(id);
    else if (act === 'cover') pickCover(id);
    else if (act === 'lyrics') editLyrics(id);
    else if (act === 'unpl') {
      const p = plById(plId);
      if (p) savePl(p, (p.trackIds || []).filter((x) => x !== id)).then(() => toast('Прибрано з плейлиста'), (e) => toast(errText(e)));
    } else if (act === 'delete') removeTrack(id);
  }

  // ---------- плейлисти ----------

  async function newPlaylist() {
    const name = await window.UI.prompt({ title: 'Новий плейлист', label: 'Назва плейлиста', ok: 'Створити' });
    if (!name) return;
    try {
      const id = await Store.savePlaylist({ name, trackIds: [] });
      toast('Плейлист «' + name + '» створено');
      if (id) setPage('playlists', id);
    } catch (e) {
      toast(errText(e));
    }
  }

  async function playlistMenu(anchor, pid) {
    const p = plById(pid || plId);
    if (!p) return;
    const own = p.id !== FAV;
    const overview = page === 'playlists' && !plId;
    const items = [{ label: 'Додати пісні', act: 'add', icon: 'i-pl-add' }];
    if (own) items.push({ label: 'Перейменувати', act: 'rename', icon: 'i-edit' });
    items.push({ label: isPinned(p) ? 'Відкріпити' : 'Закріпити зверху', act: 'pin', icon: 'i-pin' });
    if (overview) items.push({ label: 'Змінити порядок', act: 'reorder', icon: 'i-grip' });
    if (own) items.push({ sep: true }, { label: 'Видалити плейлист', act: 'delete', icon: 'i-trash', danger: true });
    const act = await window.UI.menu(anchor, items);
    if (act === 'add') addSongsToPlaylist(p.id);
    else if (act === 'pin') togglePin(p);
    else if (act === 'reorder') setReorder(true);
    else if (act === 'rename') {
      const v = await window.UI.prompt({ title: 'Перейменувати плейлист', label: 'Назва плейлиста', value: p.name });
      if (v && v !== p.name) Store.savePlaylist({ id: p.id, name: v, kind: p.kind, trackIds: p.trackIds || [] }).catch((e) => toast(errText(e)));
    } else if (act === 'delete') {
      const ok = await window.UI.confirm({ title: 'Видалити плейлист?', text: 'Плейлист «' + p.name + '» буде видалено. Самі треки залишаться в бібліотеці.', ok: 'Видалити', danger: true });
      if (ok) {
        try { await Store.deletePlaylist(p.id); if (plId === p.id) setPage('playlists'); toast('Плейлист видалено'); } catch (e) { toast(errText(e)); }
      }
    }
  }

  function togglePin(p) {
    const val = !isPinned(p);
    Store.savePlaylist({ id: p.id, name: p.name, kind: p.kind, trackIds: p.trackIds || [], pinned: val })
      .then(() => toast(val ? 'Закріплено зверху' : 'Відкріплено'), (e) => toast(errText(e)));
  }

  function setPlView(v) {
    plView = v;
    store('tembr.plview', v);
    if (page === 'playlists' && !plId) renderPlaylists();
  }

  function setReorder(on) {
    plReorder = !!on;
    if (page === 'playlists' && !plId) renderPlaylists();
  }

  // Вікно «Додати пісні»: список треків бібліотеки, яких ще немає в плейлисті, з прапорцями.
  function addSongsToPlaylist(pid) {
    const p0 = plById(pid);
    if (!p0) return;
    const have = new Set(p0.trackIds || []);
    const avail = sortedTracks().filter((t) => !have.has(t.id));
    if (!avail.length) { toast(tracks.length ? 'Усі треки вже є в цьому плейлисті' : 'У бібліотеці ще немає треків'); return; }
    const chosen = new Set();
    let q = '';
    const m = window.UI.modal({
      title: 'Додати пісні: ' + p0.name,
      wide: true,
      body: '<label class="search sm"><svg class="ic"><use href="#i-search"/></svg><input type="search" data-sp-q placeholder="Пошук" autocomplete="off"></label>' +
        '<label class="sp-all"><input type="checkbox" data-sp-all><span>Вибрати все</span><small data-sp-n></small></label>' +
        '<ul class="song-pick" data-sp></ul>',
      actions: []
    });
    const host = $('[data-sp]', m.body);
    const allBox = $('[data-sp-all]', m.body);
    const visible = () => {
      const k = q.trim().toLowerCase();
      return k ? avail.filter((t) => ((t.title || '') + ' ' + (t.artist || '')).toLowerCase().includes(k)) : avail;
    };
    const actions = () => {
      const n = chosen.size;
      m.setActions([
        { label: 'Скасувати', kind: 'ghost', onClick: (mm) => mm.close() },
        { label: n ? 'Додати ' + n : 'Додати', kind: 'primary', disabled: !n, onClick: async (mm) => {
          const cur0 = plById(pid);
          if (!cur0) { mm.close(); return; }
          const add = avail.filter((t) => chosen.has(t.id)).map((t) => t.id);
          try {
            await Store.savePlaylist({ id: cur0.id, name: cur0.name, kind: cur0.kind, trackIds: (cur0.trackIds || []).concat(add.filter((x) => (cur0.trackIds || []).indexOf(x) < 0)) });
            mm.close();
            toast('Додано ' + add.length + ' ' + pluralTr(add.length) + ' до «' + cur0.name + '»');
          } catch (e) { toast(errText(e)); }
        } }
      ]);
    };
    const draw = () => {
      const vis = visible();
      host.innerHTML = vis.length ? vis.map((t) =>
        '<li><label><input type="checkbox" data-t="' + esc(t.id) + '"' + (chosen.has(t.id) ? ' checked' : '') + '>' +
        '<span class="cv" style="background:' + coverCss(t) + '"></span>' +
        '<span class="x"><span class="t">' + esc(t.title || 'Без назви') + '</span><span class="a">' + esc(t.artist || 'Невідомий виконавець') + '</span></span></label></li>').join('')
        : '<li class="sp-empty">Нічого не знайдено</li>';
      allBox.checked = vis.length > 0 && vis.every((t) => chosen.has(t.id));
      allBox.disabled = !vis.length;
      $('[data-sp-n]', m.body).textContent = chosen.size ? 'вибрано ' + chosen.size : '';
      actions();
    };
    host.addEventListener('change', (e) => {
      const id = e.target.dataset.t;
      if (!id) return;
      if (e.target.checked) chosen.add(id); else chosen.delete(id);
      draw();
    });
    allBox.addEventListener('change', () => {
      visible().forEach((t) => { if (allBox.checked) chosen.add(t.id); else chosen.delete(t.id); });
      draw();
    });
    $('[data-sp-q]', m.body).addEventListener('input', (e) => { q = e.target.value; draw(); });
    draw();
  }

  function playPlaylist(doShuffle) {
    const p = plById(plId);
    if (!p) return;
    const ids = plTracks(p).map((t) => t.id);
    if (!ids.length) return;
    if (doShuffle && !shuffle) { shuffle = true; store('tembr.shuffle', '1'); syncModes(); }
    const start = doShuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
    startContext(start, 'pl:' + p.id, ids);
  }

  async function toggleFav(id) {
    if (!id || !byId(id)) return;
    const p = favorites();
    const ids = (p.trackIds || []).filter((x) => x !== id);
    const adding = ids.length === (p.trackIds || []).length;
    if (adding) ids.push(id);
    try {
      await savePl({ id: FAV, name: 'Улюблені', kind: 'favorites' }, ids);
      toast(adding ? 'Додано в «Улюблені»' : 'Прибрано з «Улюблених»');
    } catch (e) {
      toast(errText(e));
    }
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

  async function keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* не критично */ }
  }

  const isDuplicate = (f) => tracks.some((t) => t.fileName === f.name && +t.size === f.size);

  // Викликається з діалогу імпорту. Повертає false, якщо завантаження не почалось.
  async function runImport(files, onFileDone) {
    if (uploading) { toast('Зачекайте, поки завершиться поточне завантаження.'); return false; }
    // Це відбувається під час кліку «Додати», тому вікно доступу Google дозволено.
    if (!Store.hasToken()) {
      try {
        await Store.ensureToken();
      } catch (e) {
        toast(errText(e));
        return false;
      }
    }
    uploading = true;
    keepAwake(true);
    (async () => {
      try {
        const res = await Store.addFiles(files, showUpl, onFileDone);
        const left = window.Importer.pending();
        const tail = left ? ' Решта лишилась у списку імпорту («Завантажити»).' : '';
        if (res.added && !res.failed) toast('Додано треків: ' + res.added + '.' + tail);
        else if (res.added) toast('Додано: ' + res.added + ', не вдалося: ' + res.failed + '. ' + (res.errors[0] || '') + tail);
        else toast('Не вдалося додати файли. ' + (res.errors[0] || '') + tail);
      } catch (e) {
        toast(errText(e));
      }
      uploading = false;
      keepAwake(false);
      $('#upl').hidden = true;
    })();
    return true;
  }

  function checkShared() {
    if (sharedChecked) return;
    sharedChecked = true;
    if (/[?&]share=1/.test(location.search)) {
      try { window.history.replaceState(null, '', location.pathname); } catch (e) { /* не критично */ }
    }
    window.Importer.loadShared().then((n) => {
      if (n) {
        window.Importer.open();
        toast('Отримано файлів: ' + n + '. Перевірте список і натисніть «Додати».');
      }
    });
  }

  // ---------- акаунт і бічна панель ----------

  function openDrawer(on) {
    $('#drawer').hidden = !on;
    if (on) $('[data-open-stats]').focus();
  }

  async function openStats() {
    openDrawer(false);
    await Promise.race([flushStats(false), new Promise((r) => setTimeout(r, 1200))]);
    setPage('stats');
    statsCtl = window.Stats.open($('[data-stats]'), {
      tracks: () => tracks,
      getStats: (keys) => Store.getStats(keys),
      coverCss,
      play: (ids, id) => startContext(id, 'stats', ids)
    });
  }

  function setAvatar(u) {
    [['#avatarImg', '#avatarTxt'], ['#drImg', '#drTxt']].forEach((pair) => {
      const img = $(pair[0]);
      const txt = $(pair[1]);
      if (u.photo) { img.src = u.photo; img.hidden = false; txt.hidden = true; }
      else { img.hidden = true; txt.hidden = false; txt.textContent = (u.name || 'Т').trim().charAt(0).toUpperCase(); }
    });
  }

  function onAuth(u) {
    if (!u) {
      hardStop();
      flushStats(false);
      curId = null;
      me = null;
      sharedChecked = false;
      queueReady = false;
      playlists = [];
      settings = { order: [], plOrder: [] };
      lyrShown = null;
      openDrawer(false);
      setPage('library');
      body.dataset.auth = 'out';
      $('#authMsg').textContent = '';
      return;
    }
    me = u;
    body.dataset.auth = 'in';
    setAvatar(u);
    $('#muName').textContent = u.name || '';
    $('#muMail').textContent = u.email || '';
  }

  // Узгоджує чергу й поточний трек зі списком треків.
  function settleQueue() {
    const ids = tracks.map((t) => t.id);
    if (!queueReady) {
      queueReady = true;
      if (!loadQueue() || !Q.state.ids.length) Q.build(libraryIds(), null, shuffle, 'library');
      Q.setShuffle(shuffle);
    }
    Q.sync(ids);
    if (!Q.state.ids.length && ids.length) Q.build(libraryIds(), ids[0], shuffle, 'library');
    saveQueue();
  }

  function onTracks(list) {
    tracks = list;
    body.toggleAttribute('data-empty', !tracks.length);
    if (curId && !byId(curId)) { hardStop(); curId = null; }
    if (tracks.length && body.dataset.auth !== 'out') settleQueue();
    if (!curId && tracks.length) {
      const q = Q.cur();
      const last = store('tembr.last');
      const t = (q && byId(q)) || (last && byId(last)) || tracks[0];
      curId = t.id;
      if (Q.cur() !== curId) { Q.build(libraryIds(), curId, shuffle, 'library'); saveQueue(); }
      pos = 0;
      dur = t.duration || 0;
    }
    if (!tracks.length) { dur = 0; pos = 0; }
    render();
    meta();
    tick();
    if (body.dataset.auth === 'in') checkShared();
  }

  function onPlaylists(list) {
    playlists = list;
    if (page === 'playlists') render();
    updateFav();
    if (onPlaylistsHook) onPlaylistsHook();
  }

  function onSettings(s) {
    settings = { order: Array.isArray(s.order) ? s.order : [], plOrder: Array.isArray(s.plOrder) ? s.plOrder : [] };
    if (page === 'library' && sortMode === 'custom') render();
    else if (page === 'playlists' && !plId && !plDragging) render();
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

  // ---------- журнал відтворення: показати й скопіювати ----------

  function openLog() {
    openDrawer(false);
    const m = window.UI.modal({
      title: 'Журнал відтворення',
      wide: true,
      body: '<p class="mdl-p">Тут записано, що робив плеєр (особливо у фоні). Якщо музика зупиняється з вимкненим екраном, відтворіть це, потім відкрийте журнал, натисніть «Копіювати» й надішліть текст.</p><textarea readonly class="logbox" data-logbox></textarea>',
      actions: []
    });
    const box = $('[data-logbox]', m.body);
    box.value = logBuf.length ? logBuf.join('\n') : 'Журнал порожній.';
    box.scrollTop = box.scrollHeight;
    m.setActions([
      { label: 'Очистити', kind: 'ghost', onClick: () => { logBuf = []; try { localStorage.removeItem(LOGKEY); } catch (e) { /* не критично */ } box.value = 'Журнал порожній.'; } },
      { label: 'Копіювати', kind: 'primary', onClick: async () => {
        try { await navigator.clipboard.writeText(box.value); toast('Скопійовано'); } catch (e) {
          box.select();
          try { document.execCommand('copy'); toast('Скопійовано'); } catch (x) { toast('Виділіть текст і скопіюйте вручну'); }
        }
      } }
    ]);
  }

  // ---------- множинний вибір пісень ----------

  function listIds() { return $$('[data-list] .row').map((r) => r.dataset.id); }

  // Вибрані треки в порядку, у якому вони показані в списку.
  function selIds() {
    const shown = listIds().filter((id) => sel.has(id));
    const rest = Array.from(sel).filter((id) => shown.indexOf(id) < 0 && byId(id));
    return shown.concat(rest);
  }

  function updateSelUI() {
    Array.from(sel).forEach((id) => { if (!byId(id)) sel.delete(id); });
    const inList = page === 'library' || (page === 'playlists' && !!plId);
    const on = inList && sel.size > 0;
    if (!on && sel.size) sel.clear();
    const list = $('[data-list]');
    list.classList.toggle('selmode', on);
    $$('.row', list).forEach((r) => r.classList.toggle('sel', sel.has(r.dataset.id)));
    $('[data-selbar]').hidden = !on;
    $('[data-sel-count]').textContent = sel.size;
    $('[data-tools]').hidden = page !== 'library' || on;
    const ids = listIds();
    const allOn = ids.length && ids.every((id) => sel.has(id));
    $('[data-sel-all]').textContent = mq.matches ? (allOn ? 'Зняти' : 'Усі') : (allOn ? 'Зняти вибір' : 'Вибрати все');
  }

  function toggleSel(id) {
    if (!byId(id)) return;
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    updateSelUI();
  }

  function clearSel() {
    if (!sel.size) return;
    sel.clear();
    updateSelUI();
  }

  function selectAll() {
    const ids = listIds();
    if (ids.length && ids.every((id) => sel.has(id))) sel.clear();
    else ids.forEach((id) => sel.add(id));
    updateSelUI();
  }

  async function selMenu(anchor) {
    if (!sel.size) return;
    const inPl = page === 'playlists' && plId;
    const items = [{ label: 'Додати до плейлиста', act: 'pl', icon: 'i-pl-add' }];
    if (inPl) items.push({ label: 'Прибрати з плейлиста', act: 'unpl', icon: 'i-pl-rm' });
    items.push({ sep: true }, { label: 'Видалити з бібліотеки', act: 'del', icon: 'i-trash', danger: true });
    const act = await window.UI.menu(anchor, items);
    if (act === 'pl') pickPlaylistMulti(selIds());
    else if (act === 'unpl') {
      const p = plById(plId);
      if (!p) return;
      const drop = new Set(selIds());
      Store.savePlaylist({ id: p.id, name: p.name, kind: p.kind, trackIds: (p.trackIds || []).filter((x) => !drop.has(x)) })
        .then(() => { clearSel(); toast('Прибрано з плейлиста: ' + drop.size); }, (e) => toast(errText(e)));
    } else if (act === 'del') removeMany(selIds());
  }

  async function addManyTo(p, ids) {
    const have = new Set(p.trackIds || []);
    const add = ids.filter((x) => !have.has(x));
    if (add.length) {
      await Store.savePlaylist({ id: p.id, name: p.name, kind: p.kind, trackIds: (p.trackIds || []).concat(add) });
    }
    return add.length;
  }

  function pickPlaylistMulti(ids) {
    if (!ids.length) return;
    const m = window.UI.modal({
      title: 'Додати до плейлиста: ' + ids.length + ' ' + pluralTr(ids.length),
      body: '<ul class="pl-pick pick-btns" data-pick></ul>',
      actions: []
    });
    const host = $('[data-pick]', m.body);
    host.innerHTML = plList().map((p) =>
      '<li><button data-pl="' + esc(p.id) + '"><span>' + esc(p.name) + '</span><small>' + (p.trackIds || []).length + '</small></button></li>').join('');
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pl]');
      const p = b && plById(b.dataset.pl);
      if (!p) return;
      try {
        const n = await addManyTo(p, ids);
        m.close();
        clearSel();
        toast(n ? 'Додано ' + n + ' ' + pluralTr(n) + ' до «' + p.name + '»' : 'Ці треки вже є в плейлисті «' + p.name + '»');
      } catch (err) { toast(errText(err)); }
    });
    m.setActions([
      { label: 'Новий плейлист', kind: 'ghost', onClick: async (mm) => {
        const name = await window.UI.prompt({ title: 'Новий плейлист', label: 'Назва плейлиста', ok: 'Створити' });
        if (!name) return;
        try {
          await Store.savePlaylist({ name, trackIds: ids });
          mm.close();
          clearSel();
          toast('Плейлист «' + name + '» створено, додано ' + ids.length + ' ' + pluralTr(ids.length));
        } catch (err) { toast(errText(err)); }
      } },
      { label: 'Скасувати', kind: 'ghost', onClick: (mm) => mm.close() }
    ]);
  }

  async function removeMany(ids) {
    const list = ids.map(byId).filter(Boolean);
    if (!list.length) return;
    const ok = await window.UI.confirm({
      title: 'Видалити ' + list.length + ' ' + pluralTr(list.length) + '?',
      text: 'Вибрані треки буде видалено з бібліотеки й з Google Диска. Цю дію не можна скасувати.',
      ok: 'Видалити',
      danger: true
    });
    if (!ok) return;
    const gone = new Set();
    let failed = 0;
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      toast('Видалення ' + (i + 1) + ' з ' + list.length + '…');
      try { await Store.removeTrack(list[i]); gone.add(list[i].id); } catch (e) { failed++; lastErr = e; if (/popup|no_token|access_denied/i.test(String((e && e.message) || ''))) break; }
    }
    const owners = playlists.filter((p) => (p.trackIds || []).some((x) => gone.has(x)));
    await Promise.all(owners.map((p) => Store.savePlaylist({ id: p.id, name: p.name, kind: p.kind, trackIds: p.trackIds.filter((x) => !gone.has(x)) }).catch(() => {})));
    sel.clear();
    updateSelUI();
    toast(failed ? 'Видалено ' + gone.size + ', не вдалося: ' + (list.length - gone.size) + '. ' + errText(lastErr) : 'Видалено: ' + gone.size);
  }

  // Довге натискання: pointerdown на елементі `selector` (крім `ignore`) без руху понад 10 px.
  function longPress(host, selector, ignore, cb) {
    let tm = 0;
    let sx = 0;
    let sy = 0;
    const stop = () => { clearTimeout(tm); tm = 0; };
    host.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = e.target.closest(selector);
      if (!el || (ignore && e.target.closest(ignore))) return;
      stop();
      sx = e.clientX;
      sy = e.clientY;
      tm = setTimeout(() => {
        tm = 0;
        lpBlock = true;
        if (navigator.vibrate) { try { navigator.vibrate(18); } catch (x) { /* не критично */ } }
        cb(el);
      }, 480);
    });
    host.addEventListener('pointermove', (e) => {
      if (tm && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) stop();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => host.addEventListener(n, () => {
      stop();
      if (lpBlock) setTimeout(() => { lpBlock = false; }, 150);
    }));
    host.addEventListener('contextmenu', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
  }

  function bindSelection() {
    longPress($('[data-list]'), '.row .r-main', null, (el) => {
      if (page === 'library' || (page === 'playlists' && plId)) toggleSel(el.closest('.row').dataset.id);
    });
    longPress($('[data-pls]'), '.pl-card[data-pl-id]', '[data-pl-more],[data-pl-grip]', () => {
      if (!plReorder) setReorder(true);
    });
    $('[data-pls]').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('pl-card')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  // ---------- перетягування карток плейлистів ----------

  function bindPlDrag() {
    const host = $('[data-pls]');
    host.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-pl-grip]');
      if (!g || !plReorder) return;
      const card = g.closest('.pl-card');
      const grid = card.parentElement;
      e.preventDefault();
      plDragging = true;
      card.classList.add('dragging');
      const move = (ev) => {
        const r = host.getBoundingClientRect();
        if (ev.clientY < r.top + 40) host.scrollTop -= 14; else if (ev.clientY > r.bottom - 40) host.scrollTop += 14;
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over && over.closest('.pl-card[data-pl-id]');
        if (!target || target === card || target.dataset.pin !== card.dataset.pin || target.parentElement !== grid) return;
        const kids = Array.from(grid.children);
        if (kids.indexOf(card) < kids.indexOf(target)) target.after(card); else target.before(card);
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        card.classList.remove('dragging');
        const ids = $$('.pl-card[data-pl-id]', grid).map((c) => c.dataset.plId);
        settings.plOrder = ids;
        Store.savePlaylistOrder(ids).catch((err) => toast(errText(err))).finally(() => { plDragging = false; });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  // ---------- перетягування для власного порядку ----------

  function bindDrag() {
    const list = $('[data-list]');
    list.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-grip]');
      if (!g || !list.classList.contains('drag-on')) return;
      const row = g.closest('.row');
      e.preventDefault();
      row.classList.add('dragging');
      // Рухаємо сусідні рядки, а не сам рядок: тоді події вказівника не губляться.
      const move = (ev) => {
        const y = ev.clientY;
        const lr = list.getBoundingClientRect();
        if (y < lr.top + 36) list.scrollTop -= 14; else if (y > lr.bottom - 36) list.scrollTop += 14;
        let prevEl = row.previousElementSibling;
        while (prevEl) {
          const r = prevEl.getBoundingClientRect();
          if (y < r.top + r.height / 2) { row.after(prevEl); prevEl = row.previousElementSibling; } else break;
        }
        let nextEl = row.nextElementSibling;
        while (nextEl) {
          const r = nextEl.getBoundingClientRect();
          if (y > r.top + r.height / 2) { row.before(nextEl); nextEl = row.nextElementSibling; } else break;
        }
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        row.classList.remove('dragging');
        const ids = $$('.row', list).map((r) => r.dataset.id);
        settings = { order: ids };
        $$('.row .n b', list).forEach((b, i) => { b.textContent = i + 1; });
        Store.saveOrder(ids).catch((err) => toast(errText(err)));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  // ---------- свайп вниз згортає великий плеєр ----------

  function bindSwipe() {
    const np = $('.np');
    let sy = null;
    let st = 0;
    let dy = 0;
    let active = false;
    np.addEventListener('touchstart', (e) => {
      if (!mq.matches || body.dataset.view !== 'expanded' || e.touches.length !== 1) { sy = null; return; }
      if (e.target.closest('[data-seek],[data-vol],input,.lyr') || np.scrollTop > 0) { sy = null; return; }
      sy = e.touches[0].clientY;
      st = Date.now();
      dy = 0;
      active = false;
    }, { passive: true });
    np.addEventListener('touchmove', (e) => {
      if (sy == null) return;
      dy = e.touches[0].clientY - sy;
      if (dy > 8 || active) {
        active = true;
        np.classList.add('swiping');
        np.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
    const end = () => {
      if (sy == null) return;
      sy = null;
      np.classList.remove('swiping');
      const fast = dy / Math.max(1, Date.now() - st) > 0.6;
      if (active && (dy > 120 || (dy > 50 && fast))) {
        np.style.transform = 'translateY(100%)';
        setTimeout(() => { setView('compact'); np.style.transform = ''; }, 280);
      } else {
        np.style.transform = '';
      }
      active = false;
    };
    np.addEventListener('touchend', end);
    np.addEventListener('touchcancel', end);
  }

  // ---------- події ----------

  // Клік, який слідує за довгим натисканням, ігноруємо (інакше трек одразу заграв би).
  // Будь-яке нове натискання скидає цей захист.
  document.addEventListener('pointerdown', () => { lpBlock = false; }, true);
  document.addEventListener('click', (e) => {
    if (!lpBlock) return;
    lpBlock = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  document.addEventListener('click', (e) => {
    const t = e.target;
    let el = t.closest('[data-sel-clear]');
    if (el) { clearSel(); return; }
    if (t.closest('[data-sel-all]')) { selectAll(); return; }
    el = t.closest('[data-sel-menu]');
    if (el) { selMenu(el); return; }
    el = t.closest('[data-pl-more]');
    if (el) { playlistMenu(el, el.dataset.plMore); return; }
    el = t.closest('[data-pl-view]');
    if (el) { setPlView(el.dataset.plView); return; }
    if (t.closest('[data-pl-reorder-done]')) { setReorder(false); return; }
    if (t.closest('[data-pl-reorder]')) { setReorder(!plReorder); return; }
    if (t.closest('[data-pl-grip]')) return;
    el = t.closest('[data-more]');
    if (el) { openRowMenu(el.dataset.more, el); return; }
    el = t.closest('[data-play-id]');
    if (el) {
      const id = el.dataset.playId;
      if (sel.size || e.ctrlKey || e.metaKey) { toggleSel(id); return; }
      if (id === curId && loadedId === curId) { togglePlay(); return; }
      if (page === 'playlists' && plId) {
        const p = plById(plId);
        startContext(id, 'pl:' + plId, p ? plTracks(p).map((x) => x.id) : [id]);
      } else {
        startContext(id, 'library', libraryIds());
      }
      return;
    }
    el = t.closest('[data-nav]');
    if (el) { setPage(el.dataset.nav); return; }
    el = t.closest('[data-open-pl]');
    if (el) { if (!plReorder) setPage('playlists', el.dataset.openPl); return; }
    if (t.closest('[data-new-pl]')) { newPlaylist(); return; }
    if (t.closest('[data-pl-back]')) { setPage('playlists'); return; }
    if (t.closest('[data-pl-play]')) { playPlaylist(false); return; }
    if (t.closest('[data-pl-shuffle]')) { playPlaylist(true); return; }
    el = t.closest('[data-pl-menu]');
    if (el) { playlistMenu(el, plId); return; }
    if (t.closest('[data-upload]')) { window.Importer.open(); return; }
    if (t.closest('[data-reset-queue]')) { resetQueue(); return; }
    if (t.closest('[data-fav]')) { toggleFav(curId); return; }
    if (t.closest('[data-lyrics-toggle]')) { setLyrOn(!lyrOn); return; }
    if (t.closest('[data-play]')) { togglePlay(); return; }
    if (t.closest('[data-prev]')) { prev(); return; }
    if (t.closest('[data-next]')) { next(); return; }
    if (t.closest('[data-shuffle]')) { toggleShuffle(); return; }
    if (t.closest('[data-repeat]')) { cycleRepeat(); return; }
    if (t.closest('[data-expand]')) { setView('expanded'); return; }
    if (t.closest('[data-collapse]')) { setView('compact'); return; }
    if (t.closest('[data-signin]')) { signIn(); return; }
    if (t.closest('[data-signout]')) { openDrawer(false); Store.signOut(); return; }
    if (t.closest('[data-open-stats]')) { openStats(); return; }
    if (t.closest('[data-open-log]')) { openLog(); return; }
    if (t.closest('#userBtn')) { openDrawer(true); return; }
    if (t.closest('[data-drawer-close]') || t.id === 'drawer') { openDrawer(false); }
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
    if (e.key === 'Escape') {
      if (!$('#drawer').hidden) { openDrawer(false); return; }
      if (sel.size) { clearSel(); return; }
      if (plReorder) { setReorder(false); return; }
      if (mq.matches && body.dataset.view === 'expanded') setView('compact');
      return;
    }
    if (body.dataset.auth !== 'in') return;
    if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); }
    else if (e.shiftKey && e.key === 'ArrowRight') next();
    else if (e.shiftKey && e.key === 'ArrowLeft') prev();
  });

  $('#q').addEventListener('input', (e) => { query = e.target.value; render(); });

  $('#sort').addEventListener('change', (e) => {
    sortMode = e.target.value;
    store('tembr.sort', sortMode);
    render();
  });

  $('#coverFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    const id = e.target.dataset.id;
    e.target.value = '';
    onCoverChosen(f, id);
  });

  $$('[data-vol]').forEach((v) => {
    const saved = store('tembr.vol');
    if (saved != null && saved !== '') v.value = saved;
    volume = v.value / 100;
    v.addEventListener('input', () => {
      volume = v.value / 100;
      audio.volume = volume;
      spare.volume = volume;
      store('tembr.vol', v.value);
    });
  });

  $$('[data-seek]').forEach(bindSeek);

  // перетягування файлів і папок у вікно
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
    window.Importer.addDrop(e.dataTransfer);
  });
  window.addEventListener('beforeunload', (e) => {
    if (uploading) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('freeze', () => plog('сторінку заморожено браузером'));
  document.addEventListener('resume', () => plog('сторінку розморожено'));
  document.addEventListener('visibilitychange', () => {
    plog('видимість: ' + document.visibilityState + (playing ? ' (грає)' : ''));
    if (uploading && document.visibilityState === 'visible') keepAwake(true);
    if (document.visibilityState === 'hidden') flushStats(false);
    if (document.visibilityState === 'visible' && resumeHint && curId && loadedId !== curId) {
      resumeHint = false;
      toast('Наступний трек готовий. Натисніть ▶, щоб продовжити: потрібно відновити доступ до Диска.');
    }
    lyrLoopSync();
  });
  // Токен Google живе ~1 год. Якщо музика грає й токен скоро закінчиться, оновлюємо його при найближчому дотику
  // (вікно Google можна відкрити лише з жесту користувача).
  let tokBusy = false;
  document.addEventListener('click', () => {
    if (tokBusy || !me || !playing || !Store.tokenLeft) return;
    const left = Store.tokenLeft();
    if (left > 8 * 60 * 1000) return;
    tokBusy = true;
    Store.refreshToken().then(() => { warmFor = null; maybeWarm(audio); }).catch(() => {}).finally(() => { tokBusy = false; });
  }, true);
  window.addEventListener('pagehide', () => flushStats(false));

  mq.addEventListener('change', applyView);

  // ---------- старт ----------

  audio = mkAudio();
  spare = mkAudio();
  window.Importer.init({ onImport: runImport, isDuplicate });
  shuffle = store('tembr.shuffle') === '1';
  repeat = ['off', 'all', 'one'].indexOf(store('tembr.repeat')) >= 0 ? store('tembr.repeat') : 'off';
  const savedSort = store('tembr.sort');
  if (['new', 'old', 'az', 'za', 'custom'].indexOf(savedSort) >= 0) sortMode = savedSort;
  $('#sort').value = sortMode;
  body.setAttribute('data-empty', '');
  syncModes();
  applyView();
  bindSession();
  bindDrag();
  bindSelection();
  bindPlDrag();
  bindSwipe();
  setPage('library');
  if (store('tembr.lyr') === '1') setLyrOn(true);
  meta();
  tick();
  setPlayState();

  const problem = setupProblem();
  if (problem) {
    body.dataset.auth = 'out';
    $('[data-signin]').hidden = true;
    $('#authMsg').textContent = problem;
    return;
  }

  Store.init({ onAuth, onTracks, onPlaylists, onSettings, onError });

  setTimeout(() => {
    if (body.dataset.auth === 'loading') {
      onError('Не вдається підключитися до Firebase і Google. Перевірте з’єднання, вимкніть блокувальники реклами й оновіть сторінку.');
    }
  }, 15000);
})();
