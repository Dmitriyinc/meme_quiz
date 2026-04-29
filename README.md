# Incrypted Quiz — Telegram WebApp + SendPulse + Google Sheets

Квиз на Telegram WebApp с автоматической интеграцией:
- результат пишется в карточку контакта SendPulse
- автоматически запускается цепочка PASSED или FAILED
- все события (открыл / начал / завершил) логируются в Google Sheets для аналитики

## Архитектура

```
┌──────────────┐  1. Кнопка WebApp в боте SendPulse
│  SendPulse   │ ─────────────────────────────────────┐
│  Telegram    │     URL: ...vercel.app?cid={{contact_id}}
│     Bot      │                                       ▼
└──────┬───────┘                              ┌─────────────────┐
       ▲                                      │  Vercel: HTML   │
       │ 4. setVariable + run flow            │  квиз (React)   │
       │                                      └────────┬────────┘
       │                                               │ 2. POST /api/submit
       │                                               │    + initData + cid
┌──────┴───────┐    3. Валидация и обработка  ┌────────▼────────┐
│  SendPulse   │ ◄──────────────────────────── │ Vercel: API     │
│     API      │                               │  /api/submit.js │
└──────────────┘                               └────────┬────────┘
                                                        │ 5. Логирование
                                                        ▼
                                               ┌─────────────────┐
                                               │ Google Sheets   │
                                               │  (опционально)  │
                                               └─────────────────┘
```

## Что нужно для запуска

1. Аккаунт **GitHub** (для репозитория)
2. Аккаунт **Vercel** (для хостинга)
3. **Telegram-бот** (через @BotFather) → получить `BOT_TOKEN`
4. Аккаунт **SendPulse**, бот подключён → получить `client_id`, `client_secret`, `bot_id`
5. Две цепочки в SendPulse (PASSED и FAILED) → их `flow_id`
6. (Опционально) **Google Spreadsheet** + Apps Script для аналитики

## Деплой

### 1. Залить на GitHub

```bash
cd quiz-app
git init
git add .
git commit -m "init"
git remote add origin git@github.com:USER/REPO.git
git push -u origin main
```

**Делай репозиторий приватным** — даже с плейсхолдерами в `.env.example` лучше не светить структуру.

### 2. Подключить к Vercel

1. vercel.com → **New Project** → импорт репозитория
2. Framework Preset: **Other**
3. Build / Output settings оставить пустыми
4. **Environment Variables** — заполнить из `.env.example` реальными значениями
5. **Deploy**

### 3. Узнать SP_BOT_ID

После первого деплоя выполни одноразово в терминале (или curl, или Postman):

```bash
# Получить токен
curl -X POST https://api.sendpulse.com/oauth/access_token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"YOUR_ID","client_secret":"YOUR_SECRET"}'

# Получить список ботов (TOKEN из ответа выше)
curl https://api.sendpulse.com/telegram/bots \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Найти своего бота в ответе → скопировать `id` → положить в Vercel env как `SP_BOT_ID` → **Redeploy**.

### 4. Создать поля контактов в SendPulse

В SendPulse → твой бот → **Аудитория** → управление полями. Создать:

| Имя | Тип |
|---|---|
| `score` | Число |
| `total` | Число |
| `passed_quiz` | Строка (значения `yes` / `no`) |
| `quiz_percent` | Число |
| `quiz_time_sec` | Число |

Имена должны быть точно такими (нижний регистр, подчёркивания).

### 5. Настроить кнопку в SendPulse

В стартовой цепочке бота добавить кнопку:
- **Тип:** URL (Web App)
- **URL:** `https://YOUR-DOMAIN.vercel.app?cid={{contact_id}}`
- **Текст:** "Пройти тест"

### 6. (Опционально) Google Sheets аналитика

1. Создать пустую Google Spreadsheet
2. **Расширения** → **Apps Script** → вставить содержимое `apps_script.gs` (если используешь — он не лежит в репо, добавь сам)
3. **Deploy** → **New deployment** → **Web app**:
   - Execute as: Me
   - Who has access: **Anyone**
4. Скопировать Web App URL → положить в Vercel env как `SHEETS_WEBHOOK`
5. Redeploy

Если `SHEETS_WEBHOOK` не задан — логирование в таблицу пропускается, основной flow работает без проблем.

## Структура

```
quiz-app/
├── api/
│   ├── submit.js       ← результат квиза → SendPulse + Sheets
│   └── track.js        ← события воронки (opened/started/completed) → Sheets
├── public/
│   └── index.html      ← React-квиз (single-file, без сборки)
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

## Переменные в цепочках SendPulse

В сообщениях PASSED/FAILED можно использовать:
- `{{score}}` — сколько правильных ответов
- `{{total}}` — всего вопросов
- `{{quiz_percent}}` — процент
- `{{quiz_time_sec}}` — секунды на прохождение
- `{{passed_quiz}}` — `yes` / `no`

Например:
> Топ! Ты ответил на **{{score}} из {{total}}** ({{quiz_percent}}%). Лови материалы 👇

## Безопасность

- `BOT_TOKEN`, `SP_CLIENT_SECRET`, `SHEETS_WEBHOOK` лежат **только** в Vercel Env Vars, на фронт не попадают
- `initData` от Telegram валидируется HMAC-подписью по `BOT_TOKEN` — подделать запрос нельзя
- Свежесть `initData` проверяется (≤24ч) — защита от replay
- `cid` из URL валидируется регуляркой (24 hex-символа MongoDB ObjectId формата)

## Возможные проблемы

**"Invalid initData"** (401) — либо неверный `BOT_TOKEN` в Vercel env, либо квиз открыт не из Telegram.

**"Не удалось записать переменные"** (500) — соответствующее поле контакта не создано в SendPulse. Проверь п.4.

**"Сначала запусти бота"** (404) — у юзера ещё нет контакта в SendPulse. Решается тем, что кнопка квиза находится внутри уже работающей цепочки (юзер автоматически становится контактом при первом взаимодействии).

**Flow не запускается** — проверь что `SP_FLOW_PASSED_ID` / `SP_FLOW_FAILED_ID` совпадают с реальными ID и что цепочки опубликованы.

**Sheets не пишутся** — проверь что Apps Script задеплоен с access "Anyone" и что URL в `SHEETS_WEBHOOK` актуальный (после правок Apps Script `Deploy → Manage deployments → New version` оставляет URL прежним, но после первого Deploy URL может смениться).

## Локальная разработка

```bash
npm i -g vercel
vercel dev
```

Внутри Telegram-кнопки локально работать не будет (`initData` пустой). Для локальных тестов можно временно отключить валидацию в `submit.js` и `track.js`.
