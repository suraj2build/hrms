/**
 * FieldGuidance — inline form-field hint. Renders a small HelpCircle next to a
 * label; clicking reveals a lightweight popover with the field's guidance.
 * Self-contained (no Tooltip primitive in the design system). Non-blocking;
 * hidden entirely if field guidance is disabled for the tenant/role/module.
 */
import { useState } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { useGuidance } from './useGuidance'
import { useGuidanceContent } from './useGuidanceContent'
import { resolveField } from './guidance-content'
import type { GuidanceModule } from './guidance-config'

interface Props {
  module:   GuidanceModule
  pageKey:  string
  fieldKey: string
}

export function FieldGuidance({ module, pageKey, fieldKey }: Props) {
  const { role, isEnabled } = useGuidance(module)
  const enabled = isEnabled('field')
  const rows = useGuidanceContent(module, pageKey, enabled)
  const [open, setOpen] = useState(false)

  if (!enabled) return null
  const entry = resolveField(rows, module, pageKey, fieldKey, role)
  if (!entry) return null

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Field help"
        onClick={() => setOpen(v => !v)}
        className="text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span className="absolute left-5 top-0 z-50 w-64 rounded-md border border-border bg-popover p-3 shadow-md text-xs">
          <span className="flex items-start justify-between gap-2">
            <span className="font-medium text-foreground">{entry.title}</span>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
          <span className="block mt-1 text-muted-foreground leading-relaxed">{entry.body.summary}</span>
        </span>
      )}
    </span>
  )
}
