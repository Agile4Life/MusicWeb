import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function getSafeRedirectPath(rawNext: string | null): string {
  if (!rawNext) return '/'
  const trimmed = rawNext.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/'
  }
  return trimmed
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = getSafeRedirectPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  // Return user to login page with error flag if code exchange failed
  return NextResponse.redirect(new URL('/login?error=oauth_failed', origin))
}
