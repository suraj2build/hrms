/**
 * useNavGroupCollapse — accordion state for sidebar nav groups.
 *
 * Groups are COLLAPSED by default (compact nav, better visibility). The caller
 * force-opens the group that contains the active route, and the user's manual
 * expand/collapse choices are remembered per browser session.
 *
 *   const { expanded, toggle } = useNavGroupCollapse('ess')
 *   const isOpen = (label: string) => expanded.has(label) || label === activeGroup
 */
import { useCallback, useState } from 'react'

export function useNavGroupCollapse(scope: string) {
  const storageKey = `nav-collapse-${scope}`

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch { /* ignore */ }
    return new Set()   // default: every group collapsed
  })

  const toggle = useCallback((label: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      try { sessionStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [storageKey])

  return { expanded, toggle }
}
