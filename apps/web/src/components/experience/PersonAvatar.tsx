/**
 * PersonAvatar — a person's face on an Experience Cloud surface.
 *
 * People before processes (Manifesto §III / UX Blueprint §6–7). Wherever Home
 * once showed a generic icon for a human (recognition, celebrations, birthdays,
 * community), it now shows a person — initials in a deterministic, calm tint.
 * Photo-backed avatars can drop in later behind the same component.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

// Calm, on-brand tints — deterministic per name so a person keeps one colour.
const TINTS = [
  'bg-primary/15 text-primary',
  'bg-brand-teal/15 text-brand-teal-ink',
  'bg-info/15 text-info',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-accent text-accent-foreground',
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

function tintFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]!
}

const SIZES = { sm: 'h-8 w-8 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-11 w-11 text-sm' }

export interface PersonAvatarProps {
  name: string
  size?: keyof typeof SIZES
  className?: string
  /** Set when an adjacent visible label already announces the name (avoids double
   *  announcement). Default false → the avatar announces the person's name itself,
   *  so a face is never a silent, identity-less element for screen readers (C4). */
  decorative?: boolean
}

export function PersonAvatar({ name, size = 'md', className, decorative = false }: PersonAvatarProps) {
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      title={name}
      className={cn('grid shrink-0 place-items-center rounded-full font-bold', SIZES[size], tintFor(name), className)}
    >
      {initials(name)}
    </span>
  )
}
