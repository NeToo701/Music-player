// Демо-сховище: працює без Firebase і Google Диска.
// Треки живуть лише в пам'яті сторінки; доданий файл грає, поки сторінку не оновлено.
(function () {
  'use strict';

  let H = null;
  let seq = 0;
  let tracks = [
    { id: 'd1', title: 'Нічне місто', artist: 'Орбіта', duration: 222, ci: 0 },
    { id: 'd2', title: 'Хвилі', artist: 'Сірий Тон', duration: 245, ci: 1 },
    { id: 'd3', title: 'Крізь туман', artist: 'Лампа', duration: 178, ci: 2 },
    { id: 'd4', title: 'Світанок', artist: 'Аркадія', duration: 211, ci: 3 },
    { id: 'd5', title: 'Дощ над Дніпром', artist: 'Тихі Води', duration: 312, ci: 4 },
    { id: 'd6', title: 'Нова хвиля', artist: 'Північ', duration: 260, ci: 5 }
  ];

  window.DemoStore = {
    mode: 'demo',

    init(handlers) {
      H = handlers;
      H.onAuth({ name: 'Демо-режим', email: '', photo: null, demo: true });
      H.onTracks(tracks.slice());
    },

    async signIn() {},
    async signOut() {},

    async addFiles(files, onStatus) {
      let added = 0;
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const base = { i, n: files.length, name: f.name };
        try {
          onStatus({ ...base, stage: 'meta', progress: 0 });
          const m = await window.readMeta(f);
          tracks.unshift({
            id: 'l' + (++seq) + '_' + Date.now(),
            title: m.title,
            artist: m.artist || '',
            album: m.album,
            duration: m.duration,
            cover: m.cover,
            src: URL.createObjectURL(f),
            ci: Math.floor(Math.random() * 8)
          });
          onStatus({ ...base, stage: 'done', progress: 1 });
          added++;
        } catch (e) {
          failed++;
        }
      }
      H.onTracks(tracks.slice());
      return { added, failed, errors: [] };
    },

    async getAudioUrl(t) {
      return t.src || null;
    },

    async removeTrack(t) {
      tracks = tracks.filter((x) => x.id !== t.id);
      if (t.src) URL.revokeObjectURL(t.src);
      H.onTracks(tracks.slice());
    }
  };
})();
