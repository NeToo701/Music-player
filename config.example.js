// Шаблон налаштувань Тембра. Скопіюйте цей файл як config.js і заповніть значення за інструкцією з README.md.
//
// Увага: ці ключі не секретні (вони й так потрапляють у браузер).
// Дані захищає правило Firestore з README.md, а не приховування ключів.

window.TEMBR_CONFIG = {
  // Firebase → Project settings → General → Your apps → Web app → firebaseConfig
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
  },

  // Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
  // Радимо "Web client (auto created by Google Service)"
  googleClientId: "",

  // Назва папки на Google Диску, куди складатимуться файли
  driveFolderName: "Тембр"
};
