// Статистика прослуховувань: ключі періодів і сторінка «як у Spotify».
// Лічильники ведуться по календарних періодах (тиждень пн–нд, місяць, рік), тому
// за жовтень показується весь жовтень, навіть якщо слухати почали в середині місяця.
window.Stats = (function () {
  'use strict';

  const esc = window.U.esc;
  const MON = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const MON_G = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const MON_S = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const WEEKS = 5;
  const MONTHS = 12;
  const YEARS = 5;

  const pad = (n) => String(n).padStart(2, '0');

  function monday(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  // Номер ISO-тижня (рік тижня може відрізнятися від календарного).
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return { y, w };
  }

  function weekKey(d) {
    const x = isoWeek(d);
    return 'w-' + x.y + '-W' + pad(x.w);
  }

  const monthKey = (d) => 'm-' + d.getFullYear() + '-' + pad(d.getMonth() + 1);
  const yearKey = (d) => 'y-' + d.getFullYear();

  function keys(d) {
    return [weekKey(d), monthKey(d), yearKey(d)];
  }

  function weekLabel(start) {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    if (start.getMonth() === end.getMonth()) {
      return start.getDate() + '–' + end.getDate() + ' ' + MON_G[end.getMonth()];
    }
    return start.getDate() + ' ' + MON_S[start.getMonth()] + ' – ' + end.getDate() + ' ' + MON_S[end.getMonth()];
  }

  // Періоди для вибору: останні 5 тижнів, 12 місяців, 5 років (найновіші першими).
  function periods(tab, now) {
    const out = [];
    if (tab === 'week') {
      const m0 = monday(now);
      for (let i = 0; i < WEEKS; i++) {
        const s = new Date(m0.getFullYear(), m0.getMonth(), m0.getDate() - 7 * i);
        out.push({ key: weekKey(s), label: weekLabel(s), title: weekLabel(s) });
      }
    } else if (tab === 'month') {
      for (let i = 0; i < MONTHS; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push({ key: monthKey(d), label: MON_S[d.getMonth()] + ' ' + d.getFullYear(), title: MON[d.getMonth()] + ' ' + d.getFullYear() });
      }
    } else {
      for (let i = 0; i < YEARS; i++) {
        const y = now.getFullYear() - i;
        out.push({ key: 'y-' + y, label: String(y), title: String(y) });
      }
    }
    return out;
  }

  function minutesText(sec) {
    const m = Math.round(sec / 60);
    if (m >= 60) return { big: Math.floor(m / 60), unit: 'год', rest: (m % 60) + ' хв' };
    return { big: m, unit: 'хв', rest: '' };
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  // Рахує рейтинги з документа періоду. byId: id треку → трек.
  function summarize(doc, byId) {
    const tr = (doc && doc.tracks) || {};
    const list = Object.keys(tr)
      .filter((id) => byId(id))
      .map((id) => ({ t: byId(id), n: tr[id].n || 0, s: tr[id].s || 0 }))
      .filter((x) => x.n > 0 || x.s > 0)
      .sort((a, b) => b.n - a.n || b.s - a.s);
    const art = new Map();
    list.forEach((x) => {
      const names = (x.t.artists && x.t.artists.length ? x.t.artists : String(x.t.artist || '').split(',')).map((s) => s.trim()).filter(Boolean);
      names.forEach((nm) => {
        const a = art.get(nm) || { name: nm, n: 0, top: x.t };
        a.n += x.n;
        art.set(nm, a);
      });
    });
    const artists = Array.from(art.values()).sort((a, b) => b.n - a.n);
    return { plays: (doc && doc.plays) || 0, sec: (doc && doc.sec) || 0, list, artists };
  }

  // host: контейнер сторінки. api: { tracks(), getStats(keys), coverCss(t), play(ids, id) }
  function open(host, api) {
    let tab = 'month';
    const sel = { week: null, month: null, year: null };
    const cache = {};
    let token = 0;

    host.innerHTML = '<div class="st">' +
      '<div class="st-tabs" role="tablist">' +
      '<button data-st="week" role="tab">Тиждень</button><button data-st="month" role="tab">Місяць</button><button data-st="year" role="tab">Рік</button></div>' +
      '<div class="st-pills" data-pills></div><div class="st-body" data-body></div></div>';
    const pillsEl = host.querySelector('[data-pills]');
    const bodyEl = host.querySelector('[data-body]');

    function tracksById() {
      const m = new Map(api.tracks().map((t) => [t.id, t]));
      return (id) => m.get(id);
    }

    function renderBody(p, doc) {
      const S = summarize(doc, tracksById());
      if (!S.plays && !S.sec) {
        bodyEl.innerHTML = '<div class="st-empty"><svg class="ic"><use href="#i-chart"/></svg><h3>Поки що порожньо</h3><p>За цей період немає прослуховувань. Слухайте музику, і тут з’явиться статистика.</p></div>';
        return;
      }
      const mt = minutesText(S.sec);
      const top = S.list[0];
      const max = S.list.length ? S.list[0].n || 1 : 1;
      const rows = S.list.slice(0, 20).map((x, i) =>
        '<li class="st-row" data-id="' + esc(x.t.id) + '"><button class="st-rb">' +
        '<span class="st-rk">' + (i + 1) + '</span>' +
        '<span class="cv" style="background:' + api.coverCss(x.t) + '"></span>' +
        '<span class="x"><span class="t">' + esc(x.t.title || 'Без назви') + '</span><span class="a">' + esc(x.t.artist || 'Невідомий виконавець') + '</span>' +
        '<span class="st-bar"><i style="width:' + Math.max(4, Math.round((x.n / max) * 100)) + '%"></i></span></span>' +
        '<span class="st-n">' + x.n + '<small>' + plural(x.n, 'раз', 'рази', 'разів') + '</small></span></button></li>').join('');
      const arts = S.artists.slice(0, 8).map((a) =>
        '<div class="st-art"><span class="st-ac" style="background:' + api.coverCss(a.top) + '"></span>' +
        '<b>' + esc(a.name) + '</b><small>' + a.n + ' ' + plural(a.n, 'прослуховування', 'прослуховування', 'прослуховувань') + '</small></div>').join('');
      bodyEl.innerHTML =
        '<div class="st-hero"><div class="st-hx"><div class="st-hl">' + esc(p.title) + '</div>' +
        '<div class="st-big">' + mt.big + '<small> ' + mt.unit + '</small>' + (mt.rest ? '<small> ' + mt.rest + '</small>' : '') + '</div>' +
        '<div class="st-sub">' + S.plays + ' ' + plural(S.plays, 'прослуховування', 'прослуховування', 'прослуховувань') + ' · ' + S.list.length + ' ' + plural(S.list.length, 'трек', 'треки', 'треків') + '</div></div>' +
        (top ? '<div class="st-top"><span class="cv" style="background:' + api.coverCss(top.t) + '"></span><small>Трек періоду</small><b>' + esc(top.t.title || 'Без назви') + '</b></div>' : '') + '</div>' +
        '<h4>Найпрослуховуваніші треки</h4><ol class="st-list">' + rows + '</ol>' +
        (arts ? '<h4>Найпрослуховуваніші виконавці</h4><div class="st-arts">' + arts + '</div>' : '');
      bodyEl.querySelectorAll('.st-row').forEach((li) => {
        li.addEventListener('click', () => api.play(S.list.map((x) => x.t.id), li.dataset.id));
      });
    }

    async function show() {
      host.querySelectorAll('[data-st]').forEach((b) => {
        const on = b.dataset.st === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      const list = periods(tab, new Date());
      if (!sel[tab] || !list.some((p) => p.key === sel[tab])) sel[tab] = list[0].key;
      pillsEl.innerHTML = list.map((p) =>
        '<button class="st-pill' + (p.key === sel[tab] ? ' on' : '') + '" data-key="' + p.key + '">' + esc(p.label) + '</button>').join('');
      const p = list.find((x) => x.key === sel[tab]);
      const my = ++token;
      if (cache[p.key] === undefined) {
        bodyEl.innerHTML = '<div class="st-empty"><p>Завантаження…</p></div>';
        try {
          const r = await api.getStats([p.key]);
          cache[p.key] = r[p.key] || null;
        } catch (e) {
          if (my !== token) return;
          const denied = e && e.code === 'permission-denied';
          bodyEl.innerHTML = '<div class="st-empty"><h3>Не вдалося завантажити</h3><p>' +
            (denied ? 'Firestore не дозволяє читати статистику: оновіть правила бази (README, крок 1.4).' : 'Перевірте з’єднання й спробуйте ще раз.') + '</p></div>';
          return;
        }
      }
      if (my !== token) return;
      renderBody(p, cache[p.key]);
    }

    host.addEventListener('click', (e) => {
      const t = e.target.closest('[data-st]');
      if (t) { tab = t.dataset.st; show(); return; }
      const k = e.target.closest('[data-key]');
      if (k) { sel[tab] = k.dataset.key; show(); }
    });

    show();
    return { refresh() { Object.keys(cache).forEach((k) => delete cache[k]); show(); } };
  }

  return { keys, periods, summarize, isoWeek, weekKey, monthKey, yearKey, open };
})();
