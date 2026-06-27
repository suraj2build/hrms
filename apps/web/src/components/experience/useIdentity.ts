/**
 * useIdentity — the shared data hook behind My Growth (desktop + mobile), so both
 * tell the same story of self. Fetches /ess/identity (the Growth lens). Pure shaping;
 * no business logic.
 */

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { JourneyStep } from './JourneyRail'

export interface Party { id: string; name: string; subtitle?: string }
export interface Strength { badge: string; label: string; count: number; faces: string[] }

export interface IdentityPayload {
  person: {
    name: string | null; designation: string | null; department: string | null
    joining_date: string | null; tenure_months: number; tenure_label: string | null
  } | null
  reporting:   { manager: Party | null; peers: Party[]; reports: Party[] }
  journey:     JourneyStep[]
  strengths:   Strength[]
  reflection:  { insight: string | null }
  lookingAhead: { label: string; detail?: string }[]
}

export function useIdentity() {
  return useQuery<IdentityPayload>({
    queryKey: ['ess-identity'],
    queryFn: () => api.get('/ess/identity'),
    staleTime: 5 * 60_000,
  })
}
