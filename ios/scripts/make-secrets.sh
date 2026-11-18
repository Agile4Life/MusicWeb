#!/bin/bash
# Writes ios/Config/Secrets.xcconfig from the repo's .env.local (or .env).
# Never prints the values. Env vars already set in the shell win over the file.
set -euo pipefail
ios_dir="$(cd "$(dirname "$0")/.." && pwd)"
root="$(dirname "$ios_dir")"

env_file=""
for f in "$root/.env.local" "$root/.env"; do [ -f "$f" ] && { env_file="$f"; break; }; done

read_var() { # read_var NAME -> value from the env file, without quotes
  [ -n "$env_file" ] || return 0
  { grep -E "^$1=" "$env_file" || true; } | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

url="${NEXT_PUBLIC_SUPABASE_URL:-$(read_var NEXT_PUBLIC_SUPABASE_URL)}"
key="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$(read_var NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
[ -n "$key" ] || key="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-$(read_var NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)}"

if [ -z "$url" ] || [ -z "$key" ]; then
  echo "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not found in .env.local, .env or the environment." >&2
  exit 1
fi

slashes='//'; safe='/$()/' # keep "//" from starting an xcconfig comment
url="${url/"$slashes"/$safe}"
umask 077
printf 'SUPABASE_URL = %s\nSUPABASE_ANON_KEY = %s\n' "$url" "$key" > "$ios_dir/Config/Secrets.xcconfig"
echo "Wrote ios/Config/Secrets.xcconfig"
