const https = require('https');

function fetch(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
  });
}

(async () => {
  const alb = await fetch('https://api.deezer.com/album/1040312642');
  console.log('Album 1040312642:', alb.title, alb.artist?.name, 'tracks:', alb.nb_tracks);
})();
