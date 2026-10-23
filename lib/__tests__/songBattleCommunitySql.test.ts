import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const sql = readFileSync('docs/SONG_BATTLE_COMMUNITY.sql', 'utf8')
let db: PGlite
const owner = '123e4567-e89b-42d3-a456-426614174000'
const tracks = JSON.stringify([{ id: 'spotify-a' }, { id: 'spotify-b' }])
beforeAll(async () => {
  db = new PGlite()
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;')
  await db.exec(sql)
}, 30000)
afterAll(async () => { await db?.close() })
describe('community SQL', () => {
  it('can be rerun safely and has RLS enabled', async () => {
    await db.exec(sql)
    const result = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='public.song_battle_decks'::regclass")
    expect(result.rows[0].relrowsecurity).toBe(true)
  })
  it('permits service access, computes track count and advances timestamps', async () => {
    await db.exec('SET ROLE service_role')
    try {
      const { rows } = await db.query<{ id: string; track_count: number; updated_at: Date }>('INSERT INTO public.song_battle_decks(user_id,name,creator_name,tracks) VALUES ($1,$2,$3,$4::jsonb) RETURNING *', [owner, 'Deck', 'Alias', tracks])
      expect(rows[0].track_count).toBe(2)
      const updated = await db.query<{ updated_at: Date }>('UPDATE public.song_battle_decks SET name=$1 WHERE id=$2 RETURNING updated_at', ['Changed', rows[0].id])
      expect(new Date(updated.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(rows[0].updated_at).getTime())
    } finally { await db.exec('RESET ROLE') }
  })
  it.each(['anon', 'authenticated'])('denies direct %s reads and writes', async role => {
    await db.exec(`SET ROLE ${role}`)
    try {
      await expect(db.query('SELECT * FROM public.song_battle_decks')).rejects.toThrow(/permission denied/)
      await expect(db.query('INSERT INTO public.song_battle_decks(user_id,name,creator_name,tracks) VALUES ($1,$2,$3,$4::jsonb)', [owner, 'Deck', 'Alias', tracks])).rejects.toThrow(/permission denied/)
    } finally { await db.exec('RESET ROLE') }
  })
  it.each([
    ['', tracks], ['x'.repeat(121), tracks], ['Deck', '{}'], ['Deck', '[]'], ['Deck', '[{}]'], ['Deck', JSON.stringify(Array.from({ length: 513 }, () => ({})))],
  ])('rejects invalid name/count/type %#', async (name, json) => {
    await expect(db.query('INSERT INTO public.song_battle_decks(user_id,name,creator_name,tracks) VALUES ($1,$2,$3,$4::jsonb)', [owner, name, 'Alias', json])).rejects.toThrow()
  })
})
