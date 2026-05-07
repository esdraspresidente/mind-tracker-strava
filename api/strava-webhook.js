const axios = require('axios');

const STRAVA_CLIENT_ID = '237128';
const STRAVA_CLIENT_SECRET = '9cf562eff1fadba8b7bdb49c6af0d905b361bdc8';
const WEBHOOK_VERIFY_TOKEN = 'mindtracker2026';

function mapAtividade(type) {
  const map = { 'Run': 'Corrida', 'Walk': 'Caminhada', 'Ride': 'Bike' };
  return map[type] || 'Corrida';
}

async function getValidToken() {
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN;
  const res = await axios.post('https://www.strava.com/oauth/token', {
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  return res.data.access_token;
}

export default async function handler(req, res) {

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      return res.json({ 'hub.challenge': challenge });
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method === 'POST') {
    const event = req.body;
    console.log('Evento recebido:', JSON.stringify(event));

    if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
      return res.status(200).json({ ok: true, msg: 'ignorado' });
    }

    try {
      // 1. Renova token do Strava
      const stravaToken = await getValidToken();
      console.log('Token Strava renovado com sucesso');

      // 2. Busca detalhes da atividade
      const actRes = await axios.get(
        `https://www.strava.com/api/v3/activities/${event.object_id}`,
        { headers: { Authorization: `Bearer ${stravaToken}` } }
      );
      const act = actRes.data;
      console.log('Atividade:', act.type, act.name, act.moving_time);

      // 3. Monta treino no formato Mind Tracker
      const dateStr = act.start_date_local.split('T')[0];
      const tempo = Math.round(act.moving_time / 60);
      const km = act.distance ? parseFloat((act.distance / 1000).toFixed(2)) : null;

      const novoTreino = {
        id: Date.now(),
        pessoa: 'esdras',
        data: dateStr,
        modalidade: 'cardio',
        tipo: mapAtividade(act.type),
        tempo,
        km,
        calorias: act.calories || Math.round(tempo * 8),
        stravaId: String(event.object_id),
        stravaImportado: true,
        createdAt: new Date().toISOString(),
      };
      console.log('Treino montado:', JSON.stringify(novoTreino));

      // 4. Lê dados do Google Drive com o token do ambiente
      const driveToken = process.env.GOOGLE_ACCESS_TOKEN;
      const fileId = process.env.GDRIVE_FILE_ID;

      const driveRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      );
      const db = driveRes.data;
      console.log('Drive lido, treinos existentes:', db.treinos?.length);

      // 5. Evita duplicata
      const jaExiste = (db.treinos || []).some(t => t.stravaId === String(event.object_id));
      if (jaExiste) {
        console.log('Duplicata ignorada');
        return res.status(200).json({ ok: true, msg: 'duplicata' });
      }

      // 6. Salva no Drive
      db.treinos = db.treinos || [];
      db.treinos.push(novoTreino);

      await axios.patch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        db,
        {
          headers: {
            Authorization: `Bearer ${driveToken}`,
            'Content-Type': 'application/json',
          }
        }
      );

      console.log('✅ Treino salvo no Drive!');
      return res.status(200).json({ ok: true, treino: novoTreino });

    } catch (err) {
      console.error('Erro webhook:', err.response?.data || err.message);
      return res.status(500).json({ error: err.response?.data || err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
