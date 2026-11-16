#!/bin/sh
# Vercel caps vercel.json buildCommand at 256 chars, so the build steps live here.
mkdir -p bin
V=${YTDLP_VERSION:-latest}
if [ "$V" = latest ]; then
  U=https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
else
  U=https://github.com/yt-dlp/yt-dlp/releases/download/$V/yt-dlp
fi
(curl -fsSL "$U" -o bin/yt-dlp && chmod +x bin/yt-dlp && echo 'yt-dlp downloaded') \
  || echo 'yt-dlp download skipped, using InnerTube+Piped fallback'
exec npm run build
