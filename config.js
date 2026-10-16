// Налаштування Тембру. Заповніть значення за інструкцією з README.md.
// Поки поля порожні, застосунок працює в ДЕМО-режимі (без Google Диска та Firebase).
//
// Увага: ці ключі не секретні (вони й так потрапляють у браузер).
// Дані захищає правило Firestore з README.md, а не приховування ключів.

window.TEMBR_CONFIG = {
  // Firebase → Project settings → General → Your apps → Web app → firebaseConfig
  firebase: {
    apiKey: "AIzaSyDAXeAx0efTsNgWfZuavDcq4-0c6etNGRY",
    authDomain: ""music-player-a5e03.firebaseapp.com",
    projectId: "music-player-a5e03",
    appId: "1:1023064214229:web:706b4a106972e2757c705c"
  },

  // Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
  // Радимо "Web client (auto created by Google Service)"
  googleClientId: "698626936745-f8d1fe3jl9dqlkp2ghs0mkkndj0t30u0.apps.googleusercontent.com",

  // Назва папки на Google Диску, куди складатимуться файли
  driveFolderName: "Тембр"
};
