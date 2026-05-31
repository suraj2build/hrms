import { type ReactNode } from 'react'
import { ArrowRight }    from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge }         from '@/components/ui/badge'

interface Explainability {
  summary?:              string
  confidence_score?:     number
  contributing_factors?: string[]
  recommended_actions?:  string[]
}

interface ExplainabilityDrawerProps {
  open:           boolean
  onClose:        () => void
  title?:         string
  explainability?: Explainability
  children?:      ReactNode
}

export function ExplainabilityDrawer({
  open,
  onClose,
  title = 'Intelligence Details',
  explainability,
  children,
}: ExplainabilityDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 text-sm">
          {explainability?.summary && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {explainability.summary}
            </p>
          )}

          {explainability?.confidence_score !== undefined && (
            <Badge variant="outline" className="text-xs">
              Confidence: {Math.round(explainability.confidence_score * 100)}%
            </Badge>
          )}

          {explainability?.contributing_factors && explainability.contributing_factors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Contributing Factors
              </p>
              <ul className="space-y-1">
                {explainability.contributing_factors.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                    <span className="mt-0.5 text-muted-foreground">•</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {explainability?.recommended_actions && explainability.recommended_actions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recommended Actions
              </p>
              <ol className="space-y-1">
                {explainability.recommended_actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                    <ArrowRight className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                    {a}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!explainability && (
            <p className="text-sm text-muted-foreground italic">No explainability data available.</p>
          )}

          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
