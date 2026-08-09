const { createClient } = require('@supabase/supabase-js');

const url = 'https://mjpibwmproussfevtqbp.supabase.co';
const key = 'sb_publishable_mT97L0yZZOXReH-6ToCWGg_cpryfNgs';
const supabase = createClient(url, key);

(async () => {
  console.log('=== Checking spotify_albums ===');
  const { data: albums, error: albErr } = await supabase
    .from('spotify_albums')
    .select('*')
    .or('name.ilike.%hate%,name.ilike.%petal%');
  console.log('spotify_albums:', albums, albErr);

  console.log('\n=== Checking tracks for "hate that i made you love me" ===');
  const { data: tracks, error: trkErr } = await supabase
    .from('tracks')
    .select('id, title, artist, album, spotify_album_id')
    .ilike('title', '%hate that i made you love me%');
  console.log('tracks:', tracks, trkErr);
})();
