const GENERIC_PLACEHOLDERS = new Set([
  'google drive',
  'google drive sync',
  'youtube music',
  'apple music top hits',
  'itunes global',
  'spotify album',
  'unknown album',
  'single',
  'ep',
]);

function isRealAlbumName(name, title) {
  if (!name) return false;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return false;
  if (GENERIC_PLACEHOLDERS.has(trimmed)) return false;
  if (title) {
    const trimmedTitle = title.trim().toLowerCase();
    if (trimmedTitle && trimmed === trimmedTitle) return false;
  }
  return true;
}

console.log('1. petal with title hate:', isRealAlbumName('petal', 'hate that i made you love me')); // true
console.log('2. hate with title hate:', isRealAlbumName('hate that i made you love me', 'hate that i made you love me')); // false
console.log('3. Midnights with title Anti-Hero:', isRealAlbumName('Midnights', 'Anti-Hero')); // true
console.log('4. single with title Anti-Hero:', isRealAlbumName('single', 'Anti-Hero')); // false
