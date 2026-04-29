// /api/track.js — трекинг событий воронки (opened / started / completed)
// Пишет напрямую в Google Sheets через SHEETS_WEBHOOK.
// Telegram initData валидируется, чтобы события нельзя было слать снаружи.

import crypto from 'node:crypto';

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get('user') || '{}');
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { initData, event } = req.body || {};

    const user = verifyTelegramInitData(initData, process.env.BOT_TOKEN);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid initData' });
    }

    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'event required' });
    }

    if (!process.env.SHEETS_WEBHOOK) {
      // Sheets не настроен — просто отвечаем ok, не падаем
      return res.status(200).json({ ok: true, skipped: 'sheets not configured' });
    }

    await fetch(process.env.SHEETS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        event,
        user_id: user.id,
        username: user.username || '',
        first_name: user.first_name || '',
      }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('track error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
