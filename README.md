# Incrypted Quiz — Telegram WebApp + SendPulse

Квиз на Telegram WebApp. По окончании результат отправляется на собственный бэкенд (Vercel Serverless), который пишет переменные в SendPulse и запускает нужную цепочку (PASSED / FAILED).

## Архитектура

```
┌──────────────┐   1. Кнопка WebApp в боте SendPulse
│  SendPulse   │ ─────────────────────────────────────┐
│  Telegram    │                                       ▼
│     Bot      │                              ┌─────────────────┐
└──────────────┘                              │  Vercel: HTML   │
       ▲                                      │  квиз (React)   │
       │ 4. setVariable + run flow            └────────┬────────┘
       │    (через SendPulse API)                      │ 2. POST /api/submit
       │                                               │    + initData
┌──────┴───────┐    3. Валидация и обработка  ┌────────▼────────┐
│  SendPulse   │ ◄──────────────────────────── │ Vercel: API     │
│     API      │                               │  /api/submit.js │
└──────────────┘                               └─────────────────┘
```

## Деплой за 5 минут

### 1. Залить на GitHub

```bash
cd quiz-app
git init
git add .
git commit -m "init"
git remote add origin git@github.com:yourname/quiz-app.git
git push -u origin main
```

### 2. Подключить к Vercel

1. Зайти на vercel.com → New Project → импортировать репозиторий.
2. Framework Preset: **Other**. Build/Output settings оставить пустыми.
3. **Environment Variables** — добавить из `.env.example`:
   - `BOT_TOKEN`
   - `SP_CLIENT_ID`
   - `SP_CLIENT_SECRET`
   - `SP_FLOW_PASSED_ID`
   - `SP_FLOW_FAILED_ID`
   - `SP_BOT_ID` — пока пусто, узнаем на шаге 3
4. Deploy.

### 3. Узнать SP_BOT_ID

После первого деплоя открой в браузере:
```
https://your-app.vercel.app/api/list-bots
```

Получишь JSON со списком ботов в твоём аккаунте SendPulse. Найди нужного бота (`academys_test_bot`), скопируй его поле `id`. Это и есть `SP_BOT_ID` — внутренний ID в SendPulse, не имеет отношения к Telegram bot ID.

Добавь `SP_BOT_ID` в Environment Variables на Vercel и **сделай Redeploy** (Settings → Deployments → ⋯ → Redeploy).

### 4. Настроить бота в SendPulse

В цепочке-стартере добавь блок «Сообщение» с кнопкой:

- **Тип кнопки:** URL (Web App)
- **URL:** `https://your-app.vercel.app`
- **Текст:** "Пройти тест" или что угодно

Готово. Когда юзер нажмёт кнопку → откроется квиз → пройдёт его → бэкенд запишет результат в SendPulse → автоматически стартанёт нужный flow.

### 5. Цепочки PASSED и FAILED

В SendPulse создаёшь два потока:
- **PASSED** (`SP_FLOW_PASSED_ID = 69f0a8673bc1594a32012b5f`) — что отправлять тем, кто прошёл
- **FAILED** (`SP_FLOW_FAILED_ID = 69f1ba6517cddfbd590e3b29`) — что отправлять тем, кто не прошёл

В этих потоках можно использовать переменные, которые мы записываем:
- `{{quiz_result}}` — `passed` или `failed`
- `{{quiz_score}}` — например `19`
- `{{quiz_total}}` — `25`
- `{{quiz_percent}}` — `76`
- `{{quiz_time_sec}}` — секунды на прохождение

Например, в первое сообщение PASSED-цепочки можно вставить:
> Топ! Ты ответил правильно на {{quiz_score}} из {{quiz_total}} вопросов ({{quiz_percent}}%). Лови материалы 👇

## Локальная разработка

```bash
npm i -g vercel
vercel dev
```
Откроется на http://localhost:3000. Внутри Telegram-кнопки локально, разумеется, работать не будет — `initData` будет пустой, валидация провалится. Для теста можно временно закомментить проверку в `api/submit.js`.

## Безопасность

- `BOT_TOKEN`, `SP_CLIENT_SECRET` — лежат **только** в Vercel Env Vars, на фронт не попадают.
- `initData` от Telegram валидируется HMAC-подписью по `BOT_TOKEN` — подделать нельзя.
- Проверяется свежесть `initData` (≤ 24ч) — защита от replay.
- Если контакт не найден в SendPulse, ответ 404 — значит юзер не запускал бота.

## Структура

```
quiz-app/
├── api/
│   ├── submit.js       ← главный эндпоинт: приём результата, запись в SendPulse, запуск flow
│   └── list-bots.js    ← вспомогательный, чтобы узнать SP_BOT_ID
├── public/
│   └── index.html      ← React-квиз (single-file, без сборки)
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

## Возможные проблемы

**"Contact not found in SendPulse"** — юзер открыл квиз минуя бота. Кнопка WebApp в SendPulse-цепочке гарантирует, что контакт уже создан. Если открывать ссылку напрямую — упадёт.

**"Invalid initData"** — либо неверный `BOT_TOKEN` в env, либо квиз открыт не из Telegram, либо initData старше 24ч.

**Flow не запускается** — проверь что `SP_FLOW_PASSED_ID` / `SP_FLOW_FAILED_ID` в env совпадают с реальными ID потоков в SendPulse. И что в SendPulse эти потоки активны (Опубликованы).

**Токен SendPulse expires** — обновляется автоматически в каждом холодном старте функции, есть in-memory кэш.
