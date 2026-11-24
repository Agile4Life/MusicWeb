'use client'

export function TrackRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-3 md:px-4 py-2.5 rounded-xl border border-white/5 bg-[var(--bg-surface-1)] select-none">
      <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 pr-2">
        <div className="w-7 sm:w-8 flex justify-center shrink-0">
          <div className="w-4 h-3.5 bg-[var(--bg-surface-2)] rounded skeleton-shimmer" />
        </div>
        <div className="w-9 h-9 bg-[var(--bg-surface-2)] rounded-lg shrink-0 border border-white/5 skeleton-shimmer" />
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="w-3/5 h-3.5 bg-[var(--bg-surface-2)] rounded-md skeleton-shimmer" />
          <div className="w-2/5 h-2.5 bg-[var(--bg-surface-2)]/60 rounded-md skeleton-shimmer" />
        </div>
      </div>
      <div className="hidden @[560px]:block w-40 lg:w-48 xl:w-60 shrink-0 px-2">
        <div className="w-3/4 h-3 bg-[var(--bg-surface-2)]/60 rounded-md skeleton-shimmer" />
      </div>
      <div className="hidden @[680px]:flex items-center justify-end w-24 shrink-0 px-2">
        <div className="w-12 h-3 bg-[var(--bg-surface-2)]/60 rounded-md skeleton-shimmer" />
      </div>
      <div className="w-14 sm:w-16 flex items-center justify-end shrink-0 pr-1">
        <div className="w-9 h-3 bg-[var(--bg-surface-2)]/60 rounded-md font-mono skeleton-shimmer" />
      </div>
      <div className="w-9 sm:w-16 flex items-center justify-end shrink-0">
        <div className="w-5 h-5 bg-[var(--bg-surface-2)] rounded-md skeleton-shimmer" />
      </div>
    </div>
  )
}

export function TrackListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2 w-full @container">
      {Array.from({ length: count }).map((_, i) => (
        <TrackRowSkeleton key={i} />
      ))}
    </div>
  )
}

export function MediaCardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 sm:gap-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl bg-[var(--bg-surface-1)] border border-white/5 p-3 flex flex-col gap-3 select-none"
        >
          <div className="aspect-square w-full bg-[var(--bg-surface-2)] rounded-xl skeleton-shimmer" />
          <div className="flex flex-col gap-1.5">
            <div className="w-3/4 h-3.5 bg-[var(--bg-surface-2)] rounded skeleton-shimmer" />
            <div className="w-1/2 h-2.5 bg-[var(--bg-surface-2)]/60 rounded skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MediaCardRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-2.5 px-2.5 select-none"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="flex-shrink-0 w-[140px] rounded-2xl bg-[var(--bg-surface-1)] border border-white/5 p-3 flex flex-col gap-2.5"
        >
          <div className="aspect-square w-full bg-[var(--bg-surface-2)] rounded-xl skeleton-shimmer" />
          <div className="flex flex-col gap-1.5">
            <div className="w-3/4 h-3 bg-[var(--bg-surface-2)] rounded skeleton-shimmer" />
            <div className="w-1/2 h-2 bg-[var(--bg-surface-2)]/60 rounded skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HeroCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 md:p-10 bg-[var(--bg-surface-1)] select-none">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="flex flex-col gap-3 w-full max-w-xl">
          <div className="w-40 h-5 bg-[var(--bg-surface-2)] rounded-full skeleton-shimmer" />
          <div className="w-3/4 h-10 bg-[var(--bg-surface-2)] rounded-2xl skeleton-shimmer" />
          <div className="w-full h-4 bg-[var(--bg-surface-2)]/60 rounded-md skeleton-shimmer" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-32 h-12 bg-[var(--bg-surface-2)] rounded-full skeleton-shimmer" />
          <div className="w-32 h-12 bg-[var(--bg-surface-2)]/60 rounded-full skeleton-shimmer" />
        </div>
      </div>
    </div>
  )
}

