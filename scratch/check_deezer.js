const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function normalizeText(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[&(),.\\-_]/g, ' ').replace(/\b(single|ep|album|remix|official|audio|video|mv)\b/gi, ' ')
    .trim().replace(/\s+/g, ' ');
}

(async () => {
  // Step 1: Deezer track search for "ariana grande hate that i made you love me"
  console.log('=== Step 1: Track search ===');
  const trackSearch = await fetch('https://api.deezer.com/search?q=ariana%20grande%20hate%20that%20i%20made%20you%20love%20me&limit=5');
  const bestTrack = trackSearch.data[0];
  console.log(`Best track: "${bestTrack.title}" → album: "${bestTrack.album.title}" (id=${bestTrack.album.id})`);
  
  // Step 2: Detect single
  const isSingle = normalizeText(bestTrack.album.title) === normalizeText(bestTrack.title);
  console.log(`\nIs likely single? ${isSingle} (album name === track title)`);
  
  if (isSingle) {
    // Step 3: Search for real album by artist
    console.log('\n=== Step 3: Album search for real parent album ===');
    const albumSearch = await fetch('https://api.deezer.com/search/album?q=Ariana%20Grande&limit=10');
    
    const realAlbum = albumSearch.data.find(a => {
      const albName = normalizeText(a.title);
      const isNotSingle = albName !== normalizeText(bestTrack.title);
      const hasMultipleTracks = a.nb_tracks > 1;
      return isNotSingle && hasMultipleTracks;
    });
    
    if (realAlbum) {
      console.log(`Found candidate: "${realAlbum.title}" (id=${realAlbum.id}, tracks=${realAlbum.nb_tracks})`);
      
      // Step 4: Verify track is in this album
      const albumTracks = await fetch(`https://api.deezer.com/album/${realAlbum.id}/tracks?limit=50`);
      const found = albumTracks.data.find(t => 
        normalizeText(t.title).includes(normalizeText(bestTrack.title)) ||
        normalizeText(bestTrack.title).includes(normalizeText(t.title))
      );
      
      if (found) {
        console.log(`✅ Track "${found.title}" FOUND in album "${realAlbum.title}"!`);
        console.log(`\n🎯 RESULT: albumId=${realAlbum.id}, albumName="${realAlbum.title}"`);
      } else {
        console.log(`❌ Track NOT found in album "${realAlbum.title}"`);
      }
    }
  }
})();
