/**
 * useOpenOnParam — opens a dialog when a runbook deep-link lands on the page.
 *
 * Runbook "Take me there" links navigate to e.g. /admin/masters/states?new=1.
 * A page calls useOpenOnParam('new', openCreate) so arriving via that link
 * auto-opens its create dialog. The param is cleared afterwards so a refresh or
 * back-navigation does not re-open it.
 */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useOpenOnParam(param: string, open: () => void): void {
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    if (params.get(param) == null) return
    open()
    const next = new URLSearchParams(params)
    next.delete(param)
    setParams(next, { replace: true })
    // Run once on mount for the incoming deep-link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
