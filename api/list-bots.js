// /api/list-bots.js — вспомогательный endpoint
// Дёрни один раз GET https://your-app.vercel.app/api/list-bots
// чтобы увидеть свой bot_id в SendPulse и положить его в SP_BOT_ID env-var.
//
// После настройки этот файл можно удалить.

const SP_API = 'https://api.sendpulse.com';

async function getToken() {
  const res = await fetch(`${SP_API}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.SP_CLIENT_ID,
      client_secret: process.env.SP_CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  return j.access_token;
}

export default async function handler(req, res) {
  try {
    const token = await getToken();
    const r = await fetch(`${SP_API}/telegram/bots`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
