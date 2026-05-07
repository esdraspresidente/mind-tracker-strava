const axios = require('axios');

const STRAVA_CLIENT_ID = '237128';
const STRAVA_CLIENT_SECRET = '9cf562eff1fadba8b7bdb49c6af0d905b361bdc8';
const WEBHOOK_VERIFY_TOKEN = 'mindtracker2026';

// Tipos de atividade Strava → modalidade Mind Tracker
function mapAtividade(type) {
  const map = {
    'Run': 'corrida',
    'Walk': 'caminhada',
    'Ride': 'bike',
    'Swim': 'natacao',
  };
  return map[type] || 'corrida';
}

export default async function handler(req, res) {

  // ── GET: verificação do webhook pelo Strava ──
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      return res.json({ 'hub.challenge': challenge });
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── POST: nova atividade do Strava ──
  if (req.method === 'POST') {
    const event = req.body;

    // Só processa criação de atividades
    if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
      return res.status(200).json({ ok: true });
    }

    try {
      // 1. Busca token de acesso salvo
      const accessToken = process.env.STRAVA_ACCESS_TOKEN;
      const refreshToken = process.env.STRAVA_REFRESH_TOKEN;

      // 2. Busca detalhes da atividade no Strava
      let token = accessToken;
      try {
        const refreshRes = await axios.post('https://www.strava.com/oauth/token', {
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        });
        token = refreshRes.data.access_token;
      } catch(e) {
        console.error('Erro refresh token:', e.message);
      }

      const actRes = await axios.get(
        `https://www.strava.com/api/v3/activities/${event.object_id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const act = actRes.data;

      // 3. Monta o treino no formato Mind Tracker
      const dateStr = act.start_date_local.split('T')[0];
      const tempo = Math.round(act.moving_time / 60);
      const km = act.distance ? parseFloat((act.distance / 1000).toFixed(2)) : null;
      const tipo = mapAtividade(act.type);

      const novoTreino = {
        id: Date.now(),
        pessoa: 'esdras',
        data: dateStr,
        modalidade: 'cardio',
        tipo: tipo === 'corrida' ? 'Corrida' : tipo === 'caminhada' ? 'Caminhada' : 'Bike',
        tempo,
        km,
        calorias: act.calories || Math.round(tempo * 8),
        stravaId: event.object_id,
        stravaImportado: true,
        createdAt: new Date().toISOString(),
      };

      // 4. Lê dados atuais do Google Drive
      const driveToken = process.env.GOOGLE_ACCESS_TOKEN;
      const fileId = process.env.GDRIVE_FILE_ID;

      const driveRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      );

      const db = driveRes.data;

      // Evita duplicata
      const jaExiste = (db.treinos || []).some(t => t.stravaId === event.object_id);
      if (jaExiste) return res.status(200).json({ ok: true, msg: 'duplicata ignorada' });

      // 5. Adiciona treino e salva de volta
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

      console.log(`✅ Treino importado: ${tipo} ${tempo}min ${km}km em ${dateStr}`);
      return res.status(200).json({ ok: true, treino: novoTreino });

    } catch (err) {
      console.error('Erro webhook:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
