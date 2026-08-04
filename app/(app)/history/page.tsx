'use client'

import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { TrackList } from '@/components/track/TrackList'

export default function HistoryPage() {
  const supabase = createClient()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(async (result: { data: { user: { id: string } | null } }) => {
      const user = result.data.user
      if (!user) return
      const { data } = await supabase
        .from('listening_history')
        .select('played_at, tracks:track_id(*)')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(100)
      const seen = new Set<string>()
      const historyTracks = (data || []).flatMap((entry: { tracks: Track | null }) => {
        const track = entry.tracks
        if (!track || seen.has(track.id)) return []
        seen.add(track.id)
        return [track]
      })
      if (active) {
        setTracks(historyTracks)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [supabase])

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <History className="w-6 h-6 text-cyan-400" />
        <h1 className="text-2xl font-extrabold text-white">Lịch sử nghe</h1>
      </div>
      {loading ? <p className="text-slate-400">Đang tải...</p> : <TrackList tracks={tracks} />}
    </div>
  )
}
