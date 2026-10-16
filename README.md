# Тембр — музичний плеєр (Google Диск + Firebase)

Статичний веб-застосунок без власного сервера. Працює на GitHub Pages, у браузері на Windows і на смартфоні.

- **Файли музики** зберігаються на вашому Google Диску, у папці «Тембр».
- **Метадані** (назва, виконавець, альбом, обкладинка, тривалість) зберігаються у Firebase Firestore.
- **Вхід** через акаунт Google. Кожен користувач бачить лише свою бібліотеку.
- **Плеєр** розгортається на велике вікно і згортається до компактної панелі знизу.

## Швидкий тест (без налаштувань)

Відкрийте `index.html` подвійним кліком. Поки `config.js` порожній, застосунок працює в **демо-режимі**:
шість умовних треків без звуку і можливість додати власні файли (вони грають до оновлення сторінки).
Це зручно, щоб оцінити інтерфейс. Google Диск і Firebase у цьому режимі не використовуються.

## Налаштування хмари (~15 хвилин)

Назви пунктів у консолях Google іноді змінюються, шукайте за змістом.

### 1. Firebase

1. <https://console.firebase.google.com> → **Add project** (Google Analytics можна не вмикати).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save**.
3. **Build → Firestore Database → Create database** (production mode, регіон найближчий до вас).
4. **Firestore → Rules** → вставте правила й натисніть **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. **Project settings (⚙) → General → Your apps → Web (</>)** → зареєструйте застосунок →
   скопіюйте `apiKey`, `authDomain`, `projectId`, `appId` у `config.js`.
6. **Authentication → Settings → Authorized domains → Add domain**: `ВАШ-ЛОГІН.github.io`
   (для локальної перевірки `localhost` там уже є).

### 2. Google Cloud (той самий проєкт)

1. <https://console.cloud.google.com>, оберіть проєкт Firebase.
2. **APIs & Services → Library → Google Drive API → Enable**.
3. **OAuth consent screen** (або «Google Auth platform»): тип **External**, назва «Тембр», ваш email.
   - **Scopes**: додайте `.../auth/drive.file`. Це доступ лише до файлів, створених цим застосунком,
     а не до всього вашого Диска.
   - **Test users**: додайте свою пошту (поки застосунок у режимі Testing).
4. **Credentials → OAuth 2.0 Client IDs → «Web client (auto created by Google Service)»** → відкрийте →
   **Authorized JavaScript origins** → додайте:
   - `https://ВАШ-ЛОГІН.github.io` (без `/назва-репозиторію` і без слеша в кінці)
   - `http://localhost:8080` (для перевірки на своєму комп'ютері)

   Збережіть. Скопіюйте **Client ID** у `googleClientId` у `config.js`.

### 3. GitHub Pages

1. Створіть репозиторій на GitHub і завантажте в нього **весь вміст папки проєкту** (з папками `css` і `js`).
2. **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save**.
3. Через хвилину сайт відкриється за адресою `https://ВАШ-ЛОГІН.github.io/НАЗВА-РЕПОЗИТОРІЮ/`.

### Перевірка на своєму комп'ютері

У папці проєкту: `python -m http.server 8080`, потім <http://localhost:8080>.
Вхід через Google працює лише з адрес, доданих в Authorized JavaScript origins (не з `file://`).

## Як це працює всередині

- Вхід: Google Identity Services видає токен із правом `drive.file`; цим токеном виконується вхід у Firebase Auth.
  Токен дійсний близько години. Після оновлення сторінки його треба відновити: застосунок зробить це на
  першому натисканні ▶ або «Завантажити».
- Завантаження: файл вантажиться на Диск (resumable upload з індикатором прогресу), теги й обкладинка читаються
  з файлу (ID3), метадані пишуться у `users/{uid}/tracks`.
- Відтворення: файл спершу повністю завантажується з Диска в пам'ять, потім грає. Наступний трек підвантажується наперед.
- Файли в папці «Тембр» не перейменовуйте й не видаляйте вручну: список треків живе у Firebase і посилається на них.

## Структура

```
index.html          сторінка
config.js           ваші ключі (Firebase, Google Client ID)
css/style.css       стилі (ПК і смартфон)
js/app.js           інтерфейс і програвач
js/store-cloud.js   Google Диск + Firebase
js/store-demo.js    демо-режим
js/meta.js          читання тегів і обкладинки
js/utils.js         дрібні функції
manifest.webmanifest, icon.svg   встановлення на головний екран телефона
```

## Відомі обмеження першої версії

- Трек починає грати лише після повного завантаження з Диска (для великих файлів і повільного інтернету це помітно).
- Немає плейлистів і «Улюбленого», редагування тегів, роботи офлайн.
- Токен Google живе близько години: після цього потрібен один клік для відновлення доступу.
