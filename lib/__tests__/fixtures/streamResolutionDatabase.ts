import { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const streamResolutionMigrationPath = path.join(
  process.cwd(), 'supabase/migrations/202610070001_stream_resolution_coordination.sql',
)

export function streamResolutionMigration(): string {
  return existsSync(streamResolutionMigrationPath) ? readFileSync(streamResolutionMigrationPath, 'utf8') : ''
}

// PGlite executes the production SQL. Only the PostgREST transport is replaced;
// its single connection cannot simulate contention between independent sessions.
export async function createStreamResolutionDatabase() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.stream_resolutions (legacy_marker text);
    INSERT INTO public.stream_resolutions VALUES ('preserve legacy cache');
  `)
  await db.exec(streamResolutionMigration())

  async function rpc(name: string, args: Record<string, unknown>) {
    const parameters = [args.p_title_key, args.p_artist_key, args.p_duration_bucket]
    const isRead = name === 'read_stream_resolution_cache'
    if (isRead) parameters.push(args.p_invalidate ?? false)
    else if (name === 'write_stream_resolution_cache') parameters.push(args.p_generation, JSON.stringify(args.p_entry))
    else throw new Error(`Unexpected stream resolution RPC: ${name}`)

    try {
      // Queue the entire role/query lifetime as one transaction. Concurrent
      // route requests must not interleave SET ROLE with another RPC's RESET.
      return await db.transaction(async transaction => {
        await transaction.exec('SET LOCAL ROLE service_role')
        const result = await transaction.query<{ result: unknown }>(
          isRead
            ? 'SELECT public.read_stream_resolution_cache($1::text, $2::text, $3::integer, $4::boolean) AS result'
            : 'SELECT public.write_stream_resolution_cache($1::text, $2::text, $3::integer, $4::text, $5::jsonb) AS result',
          parameters,
        )
        return { data: result.rows[0].result, error: null }
      })
    } catch (error) {
      return { data: null, error }
    }
  }

  return { db, rpc, client: { rpc } as unknown as SupabaseClient }
}
