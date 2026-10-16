// Читання метаданих аудіофайлу: назва, виконавець, альбом, обкладинка (ID3) і тривалість.
// Обкладинка стискається до 256×256 і зберігається у Firebase разом із рештою метаданих.
window.readMeta = function readMeta(file) {
  'use strict';
  return new Promise((resolve) => {
    const base = file.name.replace(/\.[^.]+$/, '');
    const parts = base.split(/\s+[-–]\s+/);
    const out = {
      title: parts.length > 1 ? parts.slice(1).join(' - ') : base,
      artist: parts.length > 1 ? parts[0] : '',
      album: '',
      cover: null,
      duration: 0
    };

    const finish = () => {
      const a = new Audio();
      const url = URL.createObjectURL(file);
      let settled = false;
      const end = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(out);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        out.duration = isFinite(a.duration) ? a.duration : 0;
        end();
      };
      a.onerror = end;
      setTimeout(end, 8000);
      a.src = url;
    };

    if (!window.jsmediatags) { finish(); return; }

    try {
      window.jsmediatags.read(file, {
        onSuccess(tag) {
          const t = (tag && tag.tags) || {};
          if (t.title) out.title = String(t.title);
          if (t.artist) out.artist = String(t.artist);
          if (t.album) out.album = String(t.album);
          if (t.picture && t.picture.data) {
            try {
              const blob = new Blob([new Uint8Array(t.picture.data)], { type: t.picture.format || 'image/jpeg' });
              window.U.resizeImage(blob, 256)
                .then((c) => { out.cover = c; finish(); })
                .catch(finish);
              return;
            } catch (e) { /* без обкладинки */ }
          }
          finish();
        },
        onError: finish
      });
    } catch (e) {
      finish();
    }
  });
};
