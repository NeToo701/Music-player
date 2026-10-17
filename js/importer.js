// Імпорт музики: вибір файлів і цілих папок, перегляд списку з «Вибрати все»,
// пропуск не-музики й дублікатів, прийом файлів із меню «Поділитися».
(function () {
  'use strict';

  const AUDIO_RE = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav)$/i;
  const SHARE_CACHE = 'tembr-share';
  const esc = window.U.esc;

  const $ = (s, r) => (r || document).querySelector(s);
  const dlg = $('#imp');
  const listEl = $('#impList');
  const goBtn = $('#impGo');
  const allBox = $('#impAll');
  const filterEl = $('#impFilter');
  const infoEl = $('#impInfo');
  const hintEl = $('#impHint');
  const inputs = { files: $('#file'), any: $('#fileAny'), folder: $('#dir') };

  let H = { onImport: null, isDuplicate: null };
  let items = [];        // { id, file, path, key, checked, dup, shareKey }
  let seq = 0;
  let skipped = 0;
  let filter = '';

  const isAudio = (f) => /^audio\//.test(f.type) || AUDIO_RE.test(f.name);
  const keyOf = (f) => f.name.toLowerCase() + '|' + f.size;

  function fmtSize(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' ГБ';
    return Math.max(1, Math.round(n / 1048576)) + ' МБ';
  }

  function visible() {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((it) => it.path.toLowerCase().includes(q)) : items;
  }

  function render() {
    const vis = visible();
    listEl.innerHTML = vis.map((it) =>
      '<li><label class="imp-row' + (it.dup ? ' dup' : '') + '">' +
      '<input type="checkbox" data-id="' + it.id + '"' + (it.checked ? ' checked' : '') + '>' +
      '<span class="imp-n"><b>' + esc(it.file.name) + '</b>' +
      (it.path !== it.file.name ? '<small>' + esc(it.path) + '</small>' : '') + '</span>' +
      (it.dup ? '<em>вже є</em>' : '') +
      '<span class="imp-s">' + fmtSize(it.file.size) + '</span></label></li>').join('');

    const chosen = items.filter((it) => it.checked);
    const total = chosen.reduce((a, it) => a + it.file.size, 0);
    const dups = items.filter((it) => it.dup).length;
    goBtn.textContent = chosen.length ? 'Додати ' + chosen.length + ' · ' + fmtSize(total) : 'Додати';
    goBtn.disabled = !chosen.length;
    const visChecked = vis.length && vis.every((it) => it.checked);
    allBox.checked = !!visChecked;
    allBox.disabled = !vis.length;
    $('#impClear').hidden = !items.length;
    $('.imp-bar', dlg).hidden = !items.length;

    const bits = [];
    if (items.length) bits.push('У списку: ' + items.length);
    if (dups) bits.push('вже в бібліотеці: ' + dups + ' (не позначено)');
    if (skipped) bits.push('пропущено не музичних файлів: ' + skipped);
    infoEl.textContent = bits.join(' · ');
    hintEl.hidden = items.length > 0;
  }

  function open() {
    dlg.hidden = false;
    document.body.classList.add('imp-open');
    render();
  }

  function close() {
    dlg.hidden = true;
    document.body.classList.remove('imp-open');
  }

  // Додає файли в список. Не-аудіо відкидаються, повтори (ім'я + розмір) — теж.
  function add(list, extra) {
    const known = new Set(items.map((it) => it.key));
    let added = 0;
    Array.from(list || []).forEach((f, i) => {
      if (!f || !f.name) return;
      if (!isAudio(f)) { skipped++; return; }
      const key = keyOf(f);
      if (known.has(key)) return;
      known.add(key);
      const x = (extra && extra[i]) || {};
      const dup = !!(H.isDuplicate && H.isDuplicate(f));
      items.push({
        id: ++seq,
        file: f,
        path: x.path || f.webkitRelativePath || f.name,
        key,
        checked: !dup,
        dup,
        shareKey: x.shareKey || null
      });
      added++;
    });
    items.sort((a, b) => a.path.localeCompare(b.path, 'uk', { numeric: true, sensitivity: 'base' }));
    render();
    return added;
  }

  // ---------- перетягування папок ----------

  function readAll(reader) {
    return new Promise((resolve) => {
      const out = [];
      const step = () => reader.readEntries((batch) => {
        if (!batch.length) resolve(out);
        else { out.push.apply(out, batch); step(); }
      }, () => resolve(out));
      step();
    });
  }

  async function walk(entry, out) {
    if (entry.isFile) {
      await new Promise((resolve) => entry.file((f) => {
        out.push({ f, path: (entry.fullPath || f.name).replace(/^\//, '') });
        resolve();
      }, resolve));
    } else if (entry.isDirectory) {
      const kids = await readAll(entry.createReader());
      for (const k of kids) await walk(k, out);
    }
  }

  // Викликати синхронно з обробника drop: entries доступні лише там.
  async function addDrop(dt) {
    const entries = [];
    const its = dt.items ? Array.from(dt.items) : [];
    its.forEach((it) => {
      if (it.kind === 'file' && it.webkitGetAsEntry) {
        const e = it.webkitGetAsEntry();
        if (e) entries.push(e);
      }
    });
    open();
    if (!entries.length) { add(dt.files); return; }
    const found = [];
    for (const e of entries) await walk(e, found);
    add(found.map((x) => x.f), found.map((x) => ({ path: x.path })));
  }

  // ---------- файли з меню «Поділитися» ----------

  async function loadShared() {
    if (!window.caches) return 0;
    try {
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      const have = new Set(items.map((it) => it.shareKey).filter(Boolean));
      const files = [];
      const extra = [];
      for (const k of keys) {
        if (have.has(k.url)) continue;
        const r = await cache.match(k);
        if (!r) continue;
        const name = decodeURIComponent(r.headers.get('X-Name') || 'track');
        const blob = await r.blob();
        files.push(new File([blob], name, { type: r.headers.get('Content-Type') || '' }));
        extra.push({ shareKey: k.url });
      }
      return add(files, extra);
    } catch (e) {
      return 0;
    }
  }

  async function dropShared(keys) {
    if (!window.caches || !keys.length) return;
    try {
      const cache = await caches.open(SHARE_CACHE);
      for (const k of keys) await cache.delete(k);
    } catch (e) { /* не критично */ }
  }

  // ---------- керування ----------

  function clearAll() {
    const keys = items.map((it) => it.shareKey).filter(Boolean);
    items = [];
    skipped = 0;
    filter = '';
    filterEl.value = '';
    dropShared(keys);
    render();
  }

  async function run() {
    const chosen = items.filter((it) => it.checked);
    if (!chosen.length || !H.onImport) return;
    const byFile = new Map(chosen.map((it) => [it.file, it]));
    const started = await H.onImport(chosen.map((it) => it.file), (f) => {
      const it = byFile.get(f);
      if (!it) return;
      items = items.filter((x) => x !== it);
      if (it.shareKey) dropShared([it.shareKey]);
      render();
    });
    if (started === false) return;
    skipped = 0;
    close();
    render();
  }

  function init(h) {
    H = h;

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-imp-close]')) close();
      const pick = e.target.closest('[data-pick]');
      if (pick) inputs[pick.dataset.pick].click();
    });
    $('#impClear').addEventListener('click', clearAll);
    goBtn.addEventListener('click', run);

    listEl.addEventListener('change', (e) => {
      const id = +e.target.dataset.id;
      const it = items.find((x) => x.id === id);
      if (it) it.checked = e.target.checked;
      render();
    });
    allBox.addEventListener('change', () => {
      visible().forEach((it) => { it.checked = allBox.checked; });
      render();
    });
    filterEl.addEventListener('input', () => { filter = filterEl.value; render(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.hidden) close(); });

    Object.keys(inputs).forEach((k) => {
      inputs[k].addEventListener('change', (e) => {
        add(e.target.files);
        e.target.value = '';
        open();
      });
    });
  }

  window.Importer = {
    init,
    open,
    close,
    add,
    addDrop,
    loadShared,
    isOpen: () => !dlg.hidden,
    count: () => items.length,
    pending: () => items.filter((it) => it.checked).length
  };
})();
