'use client'

import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { TrackList } from '@/components/track/TrackList'

export default function FavoritesPage() {
  const supabase = createClient()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(async (result: { data: { user: { id: string } | null } }) => {
      const user = result.data.user
      if (!user) return
      const { data } = await supabase
        .from('tracks')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_favorite', true)
        .order('created_at', { ascending: false })
      if (active) {
        setTracks((data || []) as Track[])
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [supabase])

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <Heart className="w-6 h-6 text-rose-400 fill-rose-400" />
        <h1 className="text-2xl font-extrabold text-white">Bài hát yêu thích</h1>
      </div>
      {loading ? <p className="text-slate-400">Đang tải...</p> : <TrackList tracks={tracks} onTrackUpdated={(id, updates) => setTracks((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t))} />}
    </div>
  )
}
