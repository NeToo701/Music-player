// Увага: ці ключі не секретні (вони й так потрапляють у браузер).
// Дані захищає правило Firestore з README.md, а не приховування ключів.

window.TEMBR_CONFIG = {
  // Firebase → Project settings → General → Your apps → Web app → firebaseConfig
  firebase: {
    apiKey: "AIzaSyDAXeAx0efTsNgWfZuavDcq4-0c6etNGRY",
    authDomain: "music-player-a5e03.firebaseapp.com",
    projectId: "music-player-a5e03",
    appId: "1:1023064214229:web:706b4a106972e2757c705c"
  },

  // Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
  // Радимо "Web client (auto created by Google Service)"
  googleClientId: "1023064214229-mnp5lvf9dvs7fvatg5ljkbti5td1s60k.apps.googleusercontent.com",

  // Назва папки на Google Диску, куди складатимуться файли
  driveFolderName: "Тембр"
};
