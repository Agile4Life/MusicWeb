'use client'

import React from 'react'

export function TrackRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-slate-900/40 animate-pulse select-none">
      <div className="flex items-center gap-4 w-1/2">
        <div className="w-6 h-4 bg-slate-800 rounded shrink-0" />
        <div className="w-10 h-10 bg-slate-800 rounded-lg shrink-0 border border-white/5" />
        <div className="flex flex-col gap-1.5 flex-1 min-w-0 pr-4">
          <div className="w-3/4 h-3.5 bg-slate-800 rounded-md" />
          <div className="w-1/2 h-2.5 bg-slate-800/60 rounded-md" />
        </div>
      </div>
      <div className="hidden md:block w-1/4">
        <div className="w-1/2 h-3 bg-slate-800/60 rounded-md" />
      </div>
      <div className="flex items-center justify-end gap-3 w-1/4">
        <div className="w-10 h-3 bg-slate-800/60 rounded-md font-mono" />
        <div className="w-4 h-4 bg-slate-800 rounded-full" />
      </div>
    </div>
  )
}

export function TrackListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2.5 w-full">
      {Array.from({ length: count }).map((_, i) => (
        <TrackRowSkeleton key={i} />
      ))}
    </div>
  )
}

export function HeroCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 md:p-10 bg-slate-900/60 animate-pulse">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex flex-col gap-3 w-full max-w-xl">
          <div className="w-40 h-5 bg-slate-800 rounded-full" />
          <div className="w-3/4 h-10 bg-slate-800 rounded-2xl" />
          <div className="w-full h-4 bg-slate-800/60 rounded-md" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-32 h-12 bg-slate-800 rounded-full" />
          <div className="w-32 h-12 bg-slate-800/60 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function PlaylistGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 animate-pulse flex flex-col gap-3">
          <div className="w-full aspect-square bg-slate-800 rounded-xl" />
          <div className="w-3/4 h-4 bg-slate-800 rounded" />
          <div className="w-1/2 h-3 bg-slate-800/60 rounded" />
        </div>
      ))}
    </div>
  )
}
