import { NextResponse } from 'next/server'

/**
 * All logged-in users are approved. The allowedAccounts whitelist has been removed.
 * This endpoint now always returns approved: true so that any existing callers
 * continue to function without errors.
 */
export async function GET() {
  return NextResponse.json({ approved: true })
}

