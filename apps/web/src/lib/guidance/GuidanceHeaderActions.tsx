/**
 * GuidanceHeaderActions — the [Help] [Process] [Why] button cluster for page headers.
 * Drop into <PageHeader actions={...}/>. Each button shows only if enabled for the
 * tenant + role + module. Whole cluster hidden if none enabled. Non-blocking.
 */
import { useState } from 'react'
import { HelpCircle, Workflow, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGuidance } from './useGuidance'
import { useGuidanceContent } from './useGuidanceContent'
import { resolveGuidance } from './guidance-content'
import { HelpDrawer, ProcessGuideDrawer, WhyExplanationDrawer } from './drawers'
import type { GuidanceModule, GuidanceType } from './guidance-config'

interface Props {
  module:  GuidanceModule
  pageKey: string
}

export function GuidanceHeaderActions({ module, pageKey }: Props) {
  const { role, isEnabled } = useGuidance(module)
  const show = { help: isEnabled('help'), process: isEnabled('process'), why: isEnabled('why') }
  const anyShown = show.help || show.process || show.why

  const rows = useGuidanceContent(module, pageKey, anyShown)
  const [openType, setOpenType] = useState<GuidanceType | null>(null)

  if (!anyShown) return null

  const entry = openType ? resolveGuidance(rows, module, pageKey, openType, role) : null

  return (
    <>
      {show.help && (
        <Button variant="ghost" size="sm" onClick={() => setOpenType('help')}>
          <HelpCircle className="h-4 w-4 mr-1.5" /> Help
        </Button>
      )}
      {show.process && (
        <Button variant="ghost" size="sm" onClick={() => setOpenType('process')}>
          <Workflow className="h-4 w-4 mr-1.5" /> Process
        </Button>
      )}
      {show.why && (
        <Button variant="ghost" size="sm" onClick={() => setOpenType('why')}>
          <Info className="h-4 w-4 mr-1.5" /> Why
        </Button>
      )}

      <HelpDrawer           open={openType === 'help'}    onClose={() => setOpenType(null)} entry={entry} />
      <ProcessGuideDrawer   open={openType === 'process'} onClose={() => setOpenType(null)} entry={entry} />
      <WhyExplanationDrawer open={openType === 'why'}     onClose={() => setOpenType(null)} entry={entry} />
    </>
  )
}
