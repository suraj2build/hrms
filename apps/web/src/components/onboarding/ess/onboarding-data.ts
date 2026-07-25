/**
 * onboarding-data.ts — shared data layer for the employee onboarding workspace (O4).
 *
 * Single source of fetching + derivation for /ess/onboarding. Every hook here
 * reuses the SAME React Query keys as the rest of the app so the workspace never
 * double-fetches and stays consistent with the HR side and the notification bell:
 *
 *   - Readiness + Trust  → ['readiness', employeeId, 'employee']   (shared with ReadinessCard)
 *   - Checklist / Tasks  → ['ess-onboarding-checklist', employeeId]
 *   - Onboarding status  → ['ess-onboarding-status', employeeId]   (documents live here)
 *   - Notifications      → ['notifications']                       (shared with NotificationBell)
 *
 * NO new business logic, workflow engine, or onboarding status model — this is a
 * pure consumer of existing CognixHR services.
 */

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

// ── Types (mirror existing API shapes) ────────────────────────────────────────

export interface ChecklistTask {
  id:               string
  title:            string
  description:      string | null
  is_mandatory:     boolean
  sort_order:       number
  category:         string | null
  assigned_to_role: string | null
  status:           string
  notes:            string | null
  completed_at:     string | null
}

export interface Checklist {
  id:                        string
  employee_id:               string
  status:                    string
  start_date:                string | null
  target_completion_date:    string | null
  completed_at:              string | null
  employee_onboarding_tasks: ChecklistTask[]
}

export interface OnboardingStatusDoc {
  id:                string
  document_type:     string
  extraction_status: string
  uploaded_at:       string | null
}

export interface OnboardingStatus {
  session:   { id: string; status: string } | null
  draft:     { id: string; status: string } | null
  documents: { total: number; extracted: number; failed: number; items: OnboardingStatusDoc[] }
}

export type ReadinessStatus = 'ready' | 'at_risk' | 'blocked'

export interface ReadinessSummary {
  overall_score:  number
  status:         ReadinessStatus
  blocking_items: string[]
  last_updated:   string
}

/** Inbox item shape (from /notifications/inbox, entity_type='onboarding_*'). */
export interface OnboardingNotification {
  id:           string
  title:        string
  summary:      string
  item_type:    string
  severity:     string
  status:       string         // 'unread' | 'read' | 'actioned' | 'dismissed' | 'snoozed'
  entity_type:  string         // 'onboarding_session' | 'onboarding_document' | 'onboarding_checklist'
  entity_id:    string | null
  action_route: string | null
  action_label: string | null
  created_at:   string
  // item_type is a closed domain-category enum with no onboarding-specific
  // value — "needs the employee's action" is carried here instead.
  metadata?:    { action_required?: boolean; [key: string]: unknown }
}

export function isActionRequired(n: OnboardingNotification): boolean {
  return n.metadata?.action_required === true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOC_TYPE_LABEL: Record<string, string> = {
  cv: 'CV / Resume', resume: 'Resume',
  pan: 'PAN card', aadhaar: 'Aadhaar', passport: 'Passport',
  cheque: 'Cancelled cheque', bank_proof: 'Bank proof',
  photo: 'Passport photo', offer_letter: 'Offer letter',
  experience_letter: 'Experience letter', relieving_letter: 'Relieving letter',
  salary_slip: 'Salary slip', driving_license: 'Driving licence',
}

export function docLabel(t: string): string {
  return DOC_TYPE_LABEL[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Tasks the employee themselves can action vs. tasks owned by another team. */
export function isEmployeeActionable(role: string | null): boolean {
  if (!role) return true
  const r = role.toLowerCase()
  return r === 'employee' || r === 'self' || r === 'candidate' || r === 'new_hire'
}

export function isTaskDone(status: string): boolean {
  return status === 'completed' || status === 'skipped'
}

export function isDocVerified(status: string): boolean {
  return status === 'completed' || status === 'extracted'
}

/** Whole-day difference from today to an ISO date (null when undated). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(target); end.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

export function isUnread(n: OnboardingNotification): boolean {
  return n.status === 'unread'
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useOnboardingStatus(employeeId: string | null) {
  return useQuery({
    queryKey: ['ess-onboarding-status', employeeId],
    queryFn:  () => api.get<{ data: OnboardingStatus | null }>(`/employees/${employeeId}/onboarding-status`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })
}

export function useOnboardingChecklist(employeeId: string | null) {
  const query = useQuery({
    queryKey: ['ess-onboarding-checklist', employeeId],
    queryFn:  () => api.get<{ data: Checklist[] }>(`/onboarding/employees/${employeeId}/checklist`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  const checklist = (query.data ?? [])[0]
  const tasks = useMemo(
    () => (checklist?.employee_onboarding_tasks ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [checklist],
  )

  const stats = useMemo(() => {
    const mandatory     = tasks.filter(t => t.is_mandatory)
    const mandatoryDone = mandatory.filter(t => isTaskDone(t.status)).length
    const myOpen        = tasks.filter(t => isEmployeeActionable(t.assigned_to_role) && !isTaskDone(t.status))
    const pct = mandatory.length > 0 ? Math.round((mandatoryDone / mandatory.length) * 100) : (tasks.length > 0 ? 100 : 0)
    return { mandatory, mandatoryDone, myOpen, pct, total: tasks.length }
  }, [tasks])

  return { ...query, checklist, tasks, stats }
}

export function useReadinessSummary(employeeId: string | null) {
  return useQuery({
    // Same key shape ReadinessCard uses → shared cache, no double fetch.
    queryKey: ['readiness', employeeId, 'employee'],
    queryFn:  () => api.get<{ data: ReadinessSummary }>(`/employees/${employeeId}/readiness`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })
}

/** Fetches structured onboarding inbox items — no keyword matching, no URL parsing.
 *  Filtered server-side to entity_type='onboarding_*' via the inbox endpoint. */
export function useOnboardingNotifications() {
  return useQuery({
    queryKey: ['onboarding-inbox'],
    queryFn:  () =>
      // entity_type filter supported from O4.1: returns only structured onboarding items.
      api.get<{ data: OnboardingNotification[]; total: number }>(
        '/notifications/inbox?entity_type=onboarding_session&limit=50',
      ).then(async r => {
        // Also fetch document and checklist items and merge.
        const [docs, checklists] = await Promise.all([
          api.get<{ data: OnboardingNotification[] }>('/notifications/inbox?entity_type=onboarding_document&limit=50'),
          api.get<{ data: OnboardingNotification[] }>('/notifications/inbox?entity_type=onboarding_checklist&limit=50'),
        ])
        const all = [
          ...(r.data ?? []),
          ...(docs.data ?? []),
          ...(checklists.data ?? []),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        return { data: all, total: all.length }
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** Toggle a task the employee owns. Invalidates checklist + readiness + timeline
 *  so the hero ring, next steps, and journey all stay live after one action. */
export function useToggleTask(employeeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { taskId: string; next: 'completed' | 'pending' }) =>
      api.patch(`/onboarding/employees/${employeeId}/tasks/${vars.taskId}`, { status: vars.next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ess-onboarding-checklist', employeeId] })
      qc.invalidateQueries({ queryKey: ['readiness', employeeId, 'employee'] })
      qc.invalidateQueries({ queryKey: ['lifecycle-timeline', employeeId] })
    },
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/inbox/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-inbox'] }),
  })
}
