/**
 * EssOnboarding — /ess/onboarding
 *
 * O4: Employee-first, mobile-first onboarding workspace.
 *
 * A pure experience layer that composes existing CognixHR services — it adds NO
 * new business logic, workflow engine, or onboarding status model:
 *
 *   - Readiness + Trust  → ReadinessCard / useReadinessSummary  (GET /employees/:id/readiness)
 *   - Tasks / Checklist  → TasksPanel + useToggleTask           (GET/PATCH /onboarding/employees/:id/...)
 *   - Documents          → DocumentsPanel                       (GET /employees/:id/onboarding-status)
 *   - Notifications      → Updates                              (GET /notifications, shared with the bell)
 *   - Timeline           → LifecycleTimeline                    (GET /employees/:id/onboarding-timeline)
 *
 * Layout mirrors best-in-class onboarding journeys (Darwinbox / Deel / Rippling /
 * HiBob): a progress hero, a prioritised "Next steps" queue, and mobile-first
 * tabbed sections — each badged with its live count.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, ListChecks, FileText, Bell, Milestone, Sparkles,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn }            from '@/lib/utils'
import { useAuthStore }  from '@/stores/authStore'

import { ReadinessCard }     from '@/components/onboarding/ReadinessCard'
import { LifecycleTimeline } from '@/components/onboarding/LifecycleTimeline'
import { OnboardingHero }    from '@/components/onboarding/ess/OnboardingHero'
import { NextSteps }         from '@/components/onboarding/ess/NextSteps'
import { Updates }           from '@/components/onboarding/ess/Updates'
import { TasksPanel }        from '@/components/onboarding/ess/TasksPanel'
import { DocumentsPanel }    from '@/components/onboarding/ess/DocumentsPanel'
import {
  useOnboardingStatus, useOnboardingChecklist, useReadinessSummary,
  useOnboardingNotifications, isDocVerified, isUnread, daysUntil,
} from '@/components/onboarding/ess/onboarding-data'

// ── Section heading inside a tab ──────────────────────────────────────────────

function SectionTitle({
  icon: Icon, title, hint,
}: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-[#2E6FE6]" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
    </div>
  )
}

function TabCount({ n, active }: { n: number; active?: boolean }) {
  if (!n) return null
  return (
    <span className={cn(
      'ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
      active ? 'bg-[#2E6FE6] text-white' : 'bg-muted-foreground/15 text-muted-foreground',
    )}>
      {n}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EssOnboarding() {
  const { profile } = useAuthStore()
  const navigate    = useNavigate()
  const employeeId  = profile?.employee_id ?? null
  const firstName   = profile?.full_name?.split(' ')[0] ?? null

  const [tab, setTab] = useState('overview')

  const statusQ    = useOnboardingStatus(employeeId)
  const checklistQ = useOnboardingChecklist(employeeId)
  const readinessQ = useReadinessSummary(employeeId)
  const notifQ     = useOnboardingNotifications()

  // ── Not linked to an employee record yet ──
  if (!employeeId) {
    return (
      <PageContainer size="medium">
        <PageHeader title="My Onboarding" subtitle="Your onboarding journey" />
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Your account isn’t linked to an employee record yet. Please contact HR.
        </div>
      </PageContainer>
    )
  }

  // ── First load ──
  if (statusQ.isLoading && checklistQ.isLoading) {
    return (
      <PageContainer size="medium">
        <PageHeader title="My Onboarding" subtitle="Your onboarding journey" />
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your onboarding workspace…
        </div>
      </PageContainer>
    )
  }

  // ── Derived values for the hero + tab counts ──
  const status         = statusQ.data
  const docs           = status?.documents?.items ?? []
  const docsVerified   = docs.filter(d => isDocVerified(d.extraction_status)).length
  const sessionComplete =
    status?.session?.status === 'employee_created' || status?.draft?.status === 'completed'

  const { tasks, stats } = checklistQ
  const readiness   = readinessQ.data ?? null
  const unread      = (notifQ.data?.data ?? []).filter(isUnread).length
  const joiningDays = daysUntil(checklistQ.checklist?.start_date ?? checklistQ.checklist?.target_completion_date)

  return (
    <PageContainer size="medium" spacing="normal">
      <PageHeader
        breadcrumb={[{ label: 'Employee Portal' }, { label: 'Onboarding' }]}
        title={firstName ? `Welcome aboard, ${firstName}` : 'My Onboarding'}
        subtitle="Everything you need to get set up for your first days — in one place."
      />

      <OnboardingHero
        firstName={firstName}
        readinessScore={readiness?.overall_score ?? null}
        readinessLabel={readiness?.status ?? null}
        tasksPct={stats.pct}
        tasksDone={stats.mandatoryDone}
        tasksTotal={stats.mandatory.length}
        docsVerified={docsVerified}
        docsTotal={docs.length}
        joiningInDays={joiningDays}
        complete={sessionComplete}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl p-1">
          <TabsTrigger value="overview" className="shrink-0">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="tasks" className="shrink-0">
            <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Tasks
            <TabCount n={stats.myOpen.length} active={tab === 'tasks'} />
          </TabsTrigger>
          <TabsTrigger value="documents" className="shrink-0">
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Documents
            <TabCount n={docs.length} active={tab === 'documents'} />
          </TabsTrigger>
          <TabsTrigger value="updates" className="shrink-0">
            <Bell className="mr-1.5 h-3.5 w-3.5" /> Updates
            <TabCount n={unread} active={tab === 'updates'} />
          </TabsTrigger>
          <TabsTrigger value="journey" className="shrink-0">
            <Milestone className="mr-1.5 h-3.5 w-3.5" /> Journey
          </TabsTrigger>
        </TabsList>

        {/* Overview — next steps + readiness detail */}
        <TabsContent value="overview" className="space-y-5">
          <section>
            <SectionTitle icon={Sparkles} title="Next steps" hint="What needs you right now" />
            <NextSteps
              employeeId={employeeId}
              tasks={tasks}
              docs={docs}
              blockingItems={readiness?.blocking_items ?? []}
              notifications={notifQ.data?.data ?? []}
              onOpenTab={setTab}
              onNavigate={navigate}
            />
          </section>
          <section>
            <SectionTitle icon={Sparkles} title="Your readiness" hint="How ready you are to start" />
            <ReadinessCard employeeId={employeeId} />
          </section>
        </TabsContent>

        {/* Tasks */}
        <TabsContent value="tasks">
          <SectionTitle icon={ListChecks} title="Your onboarding checklist" />
          <TasksPanel
            employeeId={employeeId}
            tasks={tasks}
            isLoading={checklistQ.isLoading}
            isError={checklistQ.isError}
            stats={stats}
          />
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <SectionTitle icon={FileText} title="Your documents" hint={`${docsVerified}/${docs.length} verified`} />
          <DocumentsPanel docs={docs} />
        </TabsContent>

        {/* Updates / notifications */}
        <TabsContent value="updates">
          <SectionTitle icon={Bell} title="Updates" hint="News and reminders for you" />
          <Updates />
        </TabsContent>

        {/* Journey timeline */}
        <TabsContent value="journey">
          <SectionTitle icon={Milestone} title="Your journey" hint="Every milestone so far" />
          <LifecycleTimeline employeeId={employeeId} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

export default EssOnboarding
