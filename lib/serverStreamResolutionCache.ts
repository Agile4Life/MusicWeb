import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolutionCacheIdentity {
  titleKey: string
  artistKey: string
  durBucket: number
}

export interface SharedResolutionEntry {
  source: string | null
  resolvedId: string | null
  title?: string | null
  artist?: string | null
  duration?: number | null
  coverUrl?: string | null
  isMiss: boolean
  expiresAt: number
}

export interface SharedResolutionSnapshot {
  generation: string
  entry: SharedResolutionEntry | null
}

interface SharedResolutionPublication {
  accepted: boolean
  generation: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
}

function resolutionPayload(value: unknown): Omit<SharedResolutionEntry, 'expiresAt'> | null {
  if (!isRecord(value) || typeof value.isMiss !== 'boolean') return null
  if (value.isMiss) {
    if (value.source !== null || value.resolvedId !== null) return null
  } else if (
    typeof value.source !== 'string' || !['drive', 'nhaccuatui', 'soundcloud', 'youtube'].includes(value.source) ||
    typeof value.resolvedId !== 'string' || !value.resolvedId.trim()
  ) return null

  for (const key of ['title', 'artist', 'coverUrl'] as const) {
    if (value[key] != null && typeof value[key] !== 'string') return null
  }
  if (value.duration != null && (
    typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration < 0
  )) return null

  const payload: Omit<SharedResolutionEntry, 'expiresAt'> = {
    source: value.source as string | null,
    resolvedId: value.resolvedId as string | null,
    isMiss: value.isMiss,
  }
  for (const key of ['title', 'artist', 'coverUrl'] as const) {
    if (value[key] !== undefined) payload[key] = value[key] as string | null
  }
  if (value.duration !== undefined) payload.duration = value.duration as number | null
  return payload
}

function rpcIdentity(identity: ResolutionCacheIdentity) {
  return {
    p_title_key: identity.titleKey,
    p_artist_key: identity.artistKey,
    p_duration_bucket: identity.durBucket,
  }
}

const CACHE_RPC_TIMEOUT_MS = 1500

async function cacheRpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const builder = client.rpc(name, args)
    // Supabase supports abortSignal; PromiseLike test/transports may omit it.
    const request = typeof builder.abortSignal === 'function' ? builder.abortSignal(controller.signal) : builder
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Shared stream resolution cache RPC timed out'))
        }, CACHE_RPC_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function readSharedResolution(
  client: SupabaseClient,
  identity: ResolutionCacheIdentity,
  invalidate: boolean,
): Promise<SharedResolutionSnapshot | null> {
  try {
    // Supabase builders are PromiseLike; await also handles builders without
    // Promise.prototype.catch and catches transport rejections or sync errors.
    const { data, error } = await cacheRpc(client, 'read_stream_resolution_cache', {
      ...rpcIdentity(identity), p_invalidate: invalidate,
    })
    if (error) throw error
    if (!isRecord(data) || !isGeneration(data.generation)) throw new Error('Invalid shared cache snapshot')
    if (data.entry === null) return { generation: data.generation, entry: null }
    const payload = resolutionPayload(data.entry)
    if (!payload || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt) || data.expiresAt <= 0) {
      throw new Error('Invalid shared cache resolution')
    }
    return { generation: data.generation, entry: { ...payload, expiresAt: data.expiresAt } }
  } catch (error) {
    console.warn('Shared stream resolution cache read unavailable:', error)
    return null
  }
}

export async function writeSharedResolution(
  client: SupabaseClient,
  identity: ResolutionCacheIdentity,
  generation: string,
  entry: SharedResolutionEntry,
): Promise<SharedResolutionPublication | null> {
  try {
    const payload = resolutionPayload(entry)
    if (!isGeneration(generation) || !payload) throw new Error('Invalid shared cache publication')
    const { data, error } = await cacheRpc(client, 'write_stream_resolution_cache', {
      ...rpcIdentity(identity), p_generation: generation, p_entry: payload,
    })
    if (error) throw error
    if (!isRecord(data) || typeof data.accepted !== 'boolean' || !isGeneration(data.generation)) {
      throw new Error('Invalid shared cache publication result')
    }
    return { accepted: data.accepted, generation: data.generation }
  } catch (error) {
    console.warn('Shared stream resolution cache write unavailable:', error)
    return null
  }
}
