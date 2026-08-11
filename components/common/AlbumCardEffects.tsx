'use client'

import { useEffect } from 'react'

export function AlbumCardEffects() {
  useEffect(() => {
    // 1. Scroll-reveal using IntersectionObserver for .album-card
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 }
    )

    const cards = document.querySelectorAll('.album-card')
    cards.forEach((card) => observer.observe(card))

    // 2. 3D Tilt Effect on hover (Desktop only: hover capability check)
    const isHoverCapable = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
    if (!isHoverCapable) return () => observer.disconnect()

    const MAX_TILT = 6 // degree limit

    const handleMouseMove = (e: MouseEvent) => {
      const card = e.currentTarget as HTMLElement
      if (!card) return
      const rect = card.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      card.style.transform = `perspective(600px) rotateY(${x * MAX_TILT}deg) rotateX(${-y * MAX_TILT}deg) scale(1.02)`
    }

    const handleMouseLeave = (e: MouseEvent) => {
      const card = e.currentTarget as HTMLElement
      if (!card) return
      card.style.transform = 'perspective(600px) rotateY(0deg) rotateX(0deg) scale(1)'
    }

    cards.forEach((card) => {
      card.addEventListener('mousemove', handleMouseMove as EventListener)
      card.addEventListener('mouseleave', handleMouseLeave as EventListener)
    })

    return () => {
      observer.disconnect()
      cards.forEach((card) => {
        card.removeEventListener('mousemove', handleMouseMove as EventListener)
        card.removeEventListener('mouseleave', handleMouseLeave as EventListener)
      })
    }
  }, [])

  return null
}
