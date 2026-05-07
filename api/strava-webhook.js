const axios = require('axios');

const STRAVA_CLIENT_ID = '237128';
const STRAVA_CLIENT_SECRET = '9cf562eff1fadba8b7bdb49c6af0d905b361bdc8';
const WEBHOOK_VERIFY_TOKEN = 'mindtracker2026';
const SUPABASE_URL = 'https://djqrkcnjnvimzsrsyrjv.supabase.co';

function mapAtividade(type) {
  const map = { 'Run': 'Corrida', 'Walk': 'Caminhada', 'Ride': 'Bike', 'Swim': 'Natação' };
  return map[type] || 'Corrida';
}

async function getStravaToken() {
  const res = await axios.post('https://www.strava.com/oauth/token', {
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
  });
  return res.data.access_token;
}

export default async function handler(req, res) {

  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      return res.json({ 'hub.challenge': challenge });
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method === 'POST') {
    const event = req.body;
    console.log('Evento:', JSON.stringify(event));

    if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
      return res.status(200).json({ ok: true, msg: 'ignorado' });
    }

    try {
      const supabaseKey = process.env.SUPABASE_KEY;

      // 1. Verifica duplicata no Supabase
      const checkRes = await axios.get(
        `${SUPABASE_URL}/rest/v1/strava_atividades?strava_id=eq.${event.object_id}&select=id`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (checkRes.data.length > 0) {
        console.log('Duplicata ignorada');
        return res.status(200).json({ ok: true, msg: 'duplicata' });
      }

      // 2. Renova token Strava e busca atividade
      const stravaToken = await getStravaToken();
      const actRes = await axios.get(
        `https://www.strava.com/api/v3/activities/${event.object_id}`,
        { headers: { Authorization: `Bearer ${stravaToken}` } }
      );
      const act = actRes.data;
      console.log('Atividade:', act.type, act.name);

      // 3. Monta registro
      const registro = {
        strava_id: String(event.object_id),
        pessoa: 'esdras',
        data: act.start_date_local.split('T')[0],
        tipo: mapAtividade(act.type),
        tempo_min: Math.round(act.moving_time / 60),
        km: act.distance ? parseFloat((act.distance / 1000).toFixed(2)) : null,
        calorias: act.calories || Math.round((act.moving_time / 60) * 8),
        nome_strava: act.name,
      };

      // 4. Salva no Supabase
      await axios.post(
        `${SUPABASE_URL}/rest/v1/strava_atividades`,
        registro,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          }
        }
      );

      console.log('✅ Salvo no Supabase!', JSON.stringify(registro));
      return res.status(200).json({ ok: true, registro });

    } catch (err) {
      console.error('Erro:', err.response?.data || err.message);
      return res.status(500).json({ error: err.response?.data || err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
