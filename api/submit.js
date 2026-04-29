// /api/submit.js — приём результата квиза и интеграция с SendPulse
//
// Что делает:
//  1. Валидирует Telegram initData (HMAC по секрету бота) — защита от подделок
//  2. Получает access_token SendPulse (по client_id/client_secret)
//  3. Находит контакт в SendPulse по telegram_chat_id
//  4. Записывает переменные результата в контакт
//  5. Запускает flow PASSED или FAILED в зависимости от результата

import crypto from 'node:crypto';

// ───── Telegram initData validation ─────
// Док: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Сортируем оставшиеся пары и собираем data_check_string
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // Проверяем свежесть (защита от replay): не старше 24 часов
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  // Парсим user
  try {
    const user = JSON.parse(params.get('user') || '{}');
    return user; // { id, first_name, username, ... }
  } catch {
    return null;
  }
}

// ───── SendPulse API helpers ─────
const SP_API = 'https://api.sendpulse.com';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpToken() {
  // Простой in-memory кэш на время жизни инстанса serverless-функции
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const res = await fetch(`${SP_API}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.SP_CLIENT_ID,
      client_secret: process.env.SP_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`SendPulse auth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  return cachedToken;
}

async function spRequest(path, { method = 'GET', body, token } = {}) {
  const t = token || (await getSpToken());
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SP_API}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`SP ${method} ${path} → ${res.status}: ${text}`);
  return json;
}

// Получаем contact_id по Telegram chat_id (он же user_id в WebApp)
async function findContactByTelegramId(telegramId, botId) {
  const data = await spRequest(
    `/telegram/contacts/getByTelegramChatId?telegram_chat_id=${telegramId}&bot_id=${botId}`
  );
  // SendPulse отдаёт либо { data: { id, ... } }, либо { data: [...] } — нормализуем
  const c = data?.data;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.id || null;
  return c.id || null;
}

async function setContactVariable(contactId, variableName, variableValue) {
  return spRequest('/telegram/contacts/setVariable', {
    method: 'POST',
    body: {
      contact_id: contactId,
      variable_name: variableName,
      variable_value: variableValue,
    },
  });
}

async function runFlow(contactId, flowId, externalTrackingData) {
  return spRequest('/telegram/flows/run', {
    method: 'POST',
    body: {
      contact_id: contactId,
      flow_id: flowId,
      ...(externalTrackingData ? { external_tracking_data: externalTrackingData } : {}),
    },
  });
}

// ───── Handler ─────
export default async function handler(req, res) {
  // CORS — на случай локальной разработки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { initData, score, total, passed, sections, time_spent } = req.body || {};

    // 1. Валидация Telegram initData
    const user = verifyTelegramInitData(initData, process.env.BOT_TOKEN);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid initData' });
    }

    // 2. Базовая валидация payload-а
    if (typeof score !== 'number' || typeof total !== 'number') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const telegramId = user.id;
    const botId = process.env.SP_BOT_ID; // bot_id в SendPulse (НЕ Telegram bot id)

    // 3. Находим контакт
    const contactId = await findContactByTelegramId(telegramId, botId);
    if (!contactId) {
      return res.status(404).json({
        error: 'Contact not found in SendPulse. Сначала пользователь должен запустить бота.',
      });
    }

    // 4. Пишем переменные результата
    const percent = Math.round((score / total) * 100);
    const resultLabel = passed ? 'passed' : 'failed';

    // Несколько переменных — пригодятся в цепочках для персонализации
    await Promise.all([
      setContactVariable(contactId, 'quiz_result', resultLabel),
      setContactVariable(contactId, 'quiz_score', String(score)),
      setContactVariable(contactId, 'quiz_total', String(total)),
      setContactVariable(contactId, 'quiz_percent', String(percent)),
      setContactVariable(contactId, 'quiz_time_sec', String(time_spent || 0)),
    ]);

    // 5. Запускаем нужный flow
    const flowId = passed ? process.env.SP_FLOW_PASSED_ID : process.env.SP_FLOW_FAILED_ID;
    await runFlow(contactId, flowId, `quiz_${resultLabel}_${percent}`);

    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      result: resultLabel,
      score,
      total,
      percent,
    });
  } catch (e) {
    console.error('submit error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
