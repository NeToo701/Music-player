// Дрібні елементи інтерфейсу: модальні вікна, спливне меню, запит тексту, підтвердження.
window.UI = (function () {
  'use strict';

  const esc = window.U.esc;
  const mqMobile = window.matchMedia('(max-width:860px)');
  const stack = [];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------- модальне вікно ----------

  // opts: { title, body (рядок HTML або елемент), actions: [{label, kind, onClick(close)}], wide }
  function modal(opts) {
    const wrap = el('div', 'mdl');
    const card = el('div', 'mdl-card' + (opts.wide ? ' wide' : ''));
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const head = el('div', 'mdl-h', '<h3>' + esc(opts.title || '') + '</h3>');
    const x = el('button', 'ghost', '<svg class="ic"><use href="#i-close"/></svg>');
    x.setAttribute('aria-label', 'Закрити');
    head.appendChild(x);
    const bodyEl = el('div', 'mdl-b');
    if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body; else if (opts.body) bodyEl.appendChild(opts.body);
    const foot = el('div', 'mdl-f');
    card.append(head, bodyEl, foot);
    wrap.appendChild(card);

    let closed = false;
    const api = {
      el: wrap,
      body: bodyEl,
      close() {
        if (closed) return;
        closed = true;
        const k = stack.indexOf(api);
        if (k >= 0) stack.splice(k, 1);
        wrap.remove();
        if (opts.onClose) opts.onClose();
      },
      setActions(list) {
        foot.innerHTML = '';
        foot.hidden = !list.length;
        list.forEach((a) => {
          const b = el('button', 'mdl-btn ' + (a.kind || ''), esc(a.label));
          b.type = 'button';
          if (a.disabled) b.disabled = true;
          b.addEventListener('click', () => a.onClick && a.onClick(api, b));
          foot.appendChild(b);
        });
      }
    };
    api.setActions(opts.actions || []);
    x.addEventListener('click', api.close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) api.close(); });
    document.body.appendChild(wrap);
    stack.push(api);
    const first = bodyEl.querySelector('input,textarea');
    if (first) setTimeout(() => { first.focus(); if (first.select && first.tagName === 'INPUT') first.select(); }, 30);
    return api;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.stopPropagation(); stack[stack.length - 1].close(); }
  }, true);

  function prompt(opts) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v, m) => { if (done) return; done = true; resolve(v); m.close(); };
      const m = modal({
        title: opts.title,
        body: '<label class="fld"><span>' + esc(opts.label || '') + '</span><input type="text" maxlength="' + (opts.max || 120) + '" value="' + esc(opts.value || '') + '"></label>',
        actions: [
          { label: 'Скасувати', kind: 'ghost', onClick: (mm) => finish(null, mm) },
          { label: opts.ok || 'Зберегти', kind: 'primary', onClick: (mm) => { const v = mm.body.querySelector('input').value.trim(); if (v) finish(v, mm); } }
        ],
        onClose: () => { if (!done) { done = true; resolve(null); } }
      });
      const inp = m.body.querySelector('input');
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(); if (v) finish(v, m); }
      });
    });
  }

  function confirm(opts) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v, m) => { if (done) return; done = true; resolve(v); m.close(); };
      modal({
        title: opts.title,
        body: '<p class="mdl-p">' + esc(opts.text || '') + '</p>',
        actions: [
          { label: 'Скасувати', kind: 'ghost', onClick: (m) => finish(false, m) },
          { label: opts.ok || 'Гаразд', kind: opts.danger ? 'danger' : 'primary', onClick: (m) => finish(true, m) }
        ],
        onClose: () => { if (!done) { done = true; resolve(false); } }
      });
    });
  }

  // ---------- спливне меню ----------

  let openMenu = null;

  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }

  // items: [{ label, act, icon, danger }]; повертає Promise з act вибраного пункту (або null).
  function menu(anchor, items) {
    closeMenu();
    return new Promise((resolve) => {
      const wrap = el('div', 'pop-wrap');
      const pop = el('div', 'pop');
      pop.setAttribute('role', 'menu');
      items.forEach((it) => {
        if (it.sep) { pop.appendChild(el('div', 'pop-sep')); return; }
        const b = el('button', 'pop-i' + (it.danger ? ' danger' : ''),
          (it.icon ? '<svg class="ic"><use href="#' + it.icon + '"/></svg>' : '') + '<span>' + esc(it.label) + '</span>');
        b.setAttribute('role', 'menuitem');
        b.addEventListener('click', () => { closeMenu(); resolve(it.act); });
        pop.appendChild(b);
      });
      wrap.appendChild(pop);
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) { closeMenu(); resolve(null); } });
      wrap.addEventListener('touchstart', (e) => { if (e.target === wrap) { closeMenu(); resolve(null); } }, { passive: true });
      document.body.appendChild(wrap);
      openMenu = wrap;

      if (mqMobile.matches) {
        wrap.classList.add('sheet');
      } else {
        const r = anchor.getBoundingClientRect();
        pop.style.visibility = 'hidden';
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        let left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
        let top = r.bottom + 6;
        if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
        pop.style.visibility = '';
      }
      const f = pop.querySelector('button');
      if (f) f.focus();
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey, true); if (openMenu === wrap) { closeMenu(); resolve(null); } }
      };
      document.addEventListener('keydown', onKey, true);
    });
  }

  return { modal, prompt, confirm, menu, closeMenu };
})();
