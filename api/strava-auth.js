const axios = require('axios');

const STRAVA_CLIENT_ID = '237128';
const STRAVA_CLIENT_SECRET = '9cf562eff1fadba8b7bdb49c6af0d905b361bdc8';

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    // Redireciona para autorização do Strava
    const redirectUri = `https://mind-tracker-strava.vercel.app/api/strava-auth`;
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=activity:read_all`;
    return res.redirect(url);
  }

  try {
    // Troca o code pelo token
    const tokenRes = await axios.post('https://www.strava.com/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, athlete } = tokenRes.data;

    // Mostra os tokens na tela para você copiar
    return res.send(`
      <html>
      <body style="font-family:monospace;padding:40px;background:#0d0d14;color:#f0f0f8">
        <h2 style="color:#00e676">✅ Strava autorizado com sucesso!</h2>
        <p>Copie os valores abaixo e guarde — você vai precisar deles na Vercel:</p>
        <br>
        <p><strong style="color:#4d8fff">Atleta:</strong> ${athlete.firstname} ${athlete.lastname}</p>
        <br>
        <p><strong style="color:#4d8fff">STRAVA_ACCESS_TOKEN:</strong><br>
        <span style="color:#00e676;word-break:break-all">${access_token}</span></p>
        <br>
        <p><strong style="color:#4d8fff">STRAVA_REFRESH_TOKEN:</strong><br>
        <span style="color:#ffd600;word-break:break-all">${refresh_token}</span></p>
        <br>
        <p style="color:#8888aa">Guarde esses valores e cole nas variáveis de ambiente da Vercel conforme as instruções.</p>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send(`Erro: ${err.message}`);
  }
}
