import React from 'react'
import { TrackListSkeleton, HeroCardSkeleton } from '@/components/common/SkeletonLoader'

export default function Loading() {
  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full animate-fade-in">
      <HeroCardSkeleton />
      <div className="flex flex-col gap-4 mt-4">
        <div className="w-48 h-6 bg-slate-800 rounded-lg animate-pulse" />
        <TrackListSkeleton count={8} />
      </div>
    </div>
  )
}
