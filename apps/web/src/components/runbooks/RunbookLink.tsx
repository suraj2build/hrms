/**
 * RunbookLink — a "take me there" deep-link button used inside runbooks.
 *
 * Navigates to the target route and, when an action is set, appends a query
 * param (e.g. ?new=1) that the destination page reads via useOpenOnParam to
 * auto-open the relevant dialog.
 */
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function RunbookLink({
  to,
  action,
  label,
  variant = 'outline',
  size = 'sm',
}: {
  to:       string
  action?:  'new'
  label:    string
  variant?: 'default' | 'outline' | 'ghost'
  size?:    'sm' | 'default'
}) {
  const navigate = useNavigate()
  const go = () => navigate(action ? `${to}?${action}=1` : to)

  return (
    <Button variant={variant} size={size} onClick={go} className="gap-1.5">
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Button>
  )
}
