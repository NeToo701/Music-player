// Текст пісні: розбір LRC, пошук в Інтернеті (LRCLIB), показ із підсвіткою рядка й слів.
window.Lyrics = (function () {
  'use strict';

  const esc = window.U.esc;
  const TS = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  // Повертає { synced, lines: [{t, text}] }. Якщо в тексті є мітки часу [мм:сс.хх], текст синхронний.
  function parse(text) {
    const rows = String(text || '').replace(/\r/g, '').split('\n');
    const lines = [];
    let synced = false;
    rows.forEach((raw) => {
      const ln = raw.trim();
      const times = [];
      let m;
      let end = 0;
      TS.lastIndex = 0;
      while ((m = TS.exec(ln)) && m.index === end) {
        times.push(+m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3]) : 0));
        end = TS.lastIndex;
      }
      if (times.length) {
        synced = true;
        const txt = ln.slice(end).replace(/<[^>]*>/g, '').trim();
        times.forEach((t) => lines.push({ t, text: txt }));
      } else if (/^\[(ar|ti|al|au|by|offset|length|re|ve|tool|#):/i.test(ln)) {
        // службові теги LRC
      } else {
        lines.push({ t: null, text: ln });
      }
    });
    if (synced) {
      const kept = lines.filter((l) => l.t != null).sort((a, b) => a.t - b.t);
      return { synced: true, lines: kept };
    }
    while (lines.length && !lines[0].text) lines.shift();
    while (lines.length && !lines[lines.length - 1].text) lines.pop();
    return { synced: false, lines };
  }

  // ---------- пошук у LRCLIB ----------

  const BASE = 'https://lrclib.net/api/';

  const clean = (s) => String(s || '')
    .replace(/\s*[(\[][^)\]]*(feat|ft\.|official|video|audio|lyric|remaster|live|clip)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  async function getJson(url) {
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('lrclib ' + r.status);
    return r.json();
  }

  // Шукає текст для треку. Повертає { text, synced, approx } або null, якщо нічого не знайдено.
  async function search(t) {
    const title = clean(t.title);
    const artist = String((t.artists && t.artists[0]) || t.artist || '').split(',')[0].trim();
    const dur = Math.round(t.duration || 0);
    const pack = (j, approx) => {
      const text = j.syncedLyrics || j.plainLyrics;
      return text ? { text, synced: !!j.syncedLyrics, approx: !!approx } : null;
    };

    if (title && artist) {
      const q = new URLSearchParams({ track_name: title, artist_name: artist });
      if (t.album) q.set('album_name', t.album);
      if (dur) q.set('duration', String(dur));
      let j = null;
      try { j = await getJson(BASE + 'get?' + q); } catch (e) { if (!/lrclib/.test(e.message)) throw e; }
      const p = j && pack(j, false);
      if (p) return p;
    }

    const tries = [];
    if (artist) tries.push(new URLSearchParams({ track_name: title, artist_name: artist }));
    tries.push(new URLSearchParams({ q: (artist ? artist + ' ' : '') + title }));
    tries.push(new URLSearchParams({ q: title }));
    for (const q of tries) {
      const list = await getJson(BASE + 'search?' + q);
      if (!Array.isArray(list) || !list.length) continue;
      const scored = list
        .filter((j) => j.syncedLyrics || j.plainLyrics)
        .map((j) => ({ j, d: dur && j.duration ? Math.abs(j.duration - dur) : 5 }))
        .sort((a, b) => ((a.j.syncedLyrics ? 0 : 20) + a.d) - ((b.j.syncedLyrics ? 0 : 20) + b.d));
      if (scored.length) {
        const best = scored[0];
        return pack(best.j, dur ? best.d > 12 : true);
      }
    }
    return null;
  }

  // ---------- показ ----------

  // host: контейнер із прокруткою. getTime(): поточний час відтворення в секундах.
  function View(host, opts) {
    let data = { synced: false, lines: [] };
    let els = [];
    let active = -1;
    let words = null;         // слова активного рядка: [{el, from}]
    let lastWordCount = -1;
    let userScrollUntil = 0;

    host.addEventListener('wheel', () => { userScrollUntil = Date.now() + 3500; }, { passive: true });
    host.addEventListener('touchmove', () => { userScrollUntil = Date.now() + 3500; }, { passive: true });
    host.addEventListener('click', (e) => {
      const p = e.target.closest('[data-t]');
      if (p && opts && opts.onSeek) opts.onSeek(+p.dataset.t);
      if (e.target.closest('[data-add-lyrics]') && opts && opts.onAdd) opts.onAdd();
    });

    function set(text) {
      data = parse(text);
      active = -1;
      words = null;
      lastWordCount = -1;
      if (!data.lines.length) {
        host.innerHTML = '<div class="lyr-empty"><p>Тексту ще немає.</p><button class="mdl-btn primary" data-add-lyrics>Додати текст</button></div>';
        host.classList.remove('synced');
        els = [];
        return;
      }
      host.classList.toggle('synced', data.synced);
      host.innerHTML = '<div class="lyr-pad"></div>' + data.lines.map((l, i) =>
        '<p class="ly" data-i="' + i + '"' + (l.t != null ? ' data-t="' + l.t + '"' : '') + '>' +
        (l.text ? esc(l.text) : '<span class="note">♪</span>') + '</p>').join('') + '<div class="lyr-pad"></div>';
      els = Array.from(host.querySelectorAll('.ly'));
      host.scrollTop = 0;
    }

    function indexAt(time) {
      const L = data.lines;
      let lo = 0;
      let hi = L.length - 1;
      let r = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (L[mid].t <= time + 0.15) { r = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return r;
    }

    function setActive(i) {
      if (words) { words = null; const prev = els[active]; if (prev) prev.textContent = data.lines[active].text || '♪'; }
      els.forEach((e, k) => {
        e.classList.toggle('on', k === i);
        e.classList.toggle('past', k < i);
      });
      active = i;
      lastWordCount = -1;
      const line = els[i];
      if (line && data.lines[i].text) {
        const parts = data.lines[i].text.split(/(\s+)/);
        let total = 0;
        parts.forEach((p) => { if (!/^\s+$/.test(p)) total += p.length; });
        let acc = 0;
        line.innerHTML = '';
        words = [];
        parts.forEach((p) => {
          if (/^\s+$/.test(p) || !p) { line.appendChild(document.createTextNode(p)); return; }
          const s = document.createElement('span');
          s.className = 'w';
          s.textContent = p;
          line.appendChild(s);
          words.push({ el: s, from: acc / total });
          acc += p.length;
        });
      }
      if (line && Date.now() > userScrollUntil) {
        const top = line.offsetTop - host.clientHeight / 2 + line.offsetHeight / 2;
        try { host.scrollTo({ top, behavior: 'smooth' }); } catch (e) { host.scrollTop = top; }
      }
    }

    // Рядок і слова підсвічуються за часом. Слова заповнюються пропорційно довжині:
    // у LRC є лише час початку рядка, тож це наближення, а не точна розмітка слів.
    function update(time) {
      if (!data.synced || !els.length) return;
      const i = indexAt(time);
      if (i !== active) setActive(i);
      if (i >= 0 && words) {
        const L = data.lines;
        const start = L[i].t;
        const nextT = i + 1 < L.length ? L[i + 1].t : start + 6;
        const chars = (L[i].text || '').replace(/\s/g, '').length;
        const span = Math.max(0.8, Math.min(nextT - start - 0.1, chars * 0.085));
        const p = Math.min(1, Math.max(0, (time - start) / span));
        let n = 0;
        for (let k = 0; k < words.length; k++) if (words[k].from <= p + 0.001) n = k + 1;
        if (n !== lastWordCount) {
          lastWordCount = n;
          words.forEach((w, k) => w.el.classList.toggle('sung', k < n));
        }
      }
    }

    function recenter() {
      userScrollUntil = 0;
      const line = els[active];
      if (line) host.scrollTop = line.offsetTop - host.clientHeight / 2 + line.offsetHeight / 2;
    }

    return { set, update, recenter, hasText: () => data.lines.length > 0, isSynced: () => data.synced };
  }

  return { parse, search, View };
})();
