/**
 * EventToast — subscribes to the notifications query and fires
 * sonner toasts for newly-arrived unread items.
 * Mount once inside the authenticated layout (AdminShell / EssShell).
 */
import { useEffect, useRef } from 'react'
import { useQueryClient }    from '@tanstack/react-query'
import { toast }             from 'sonner'
import type { NotificationData } from './NotificationItem'

export function EventToast() {
  const seenIds   = useRef<Set<string>>(new Set())
  const isBooted  = useRef(false)       // true after first data load
  const qc        = useQueryClient()

  useEffect(() => {
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (
        event.type !== 'updated' ||
        !Array.isArray(event.query.queryKey) ||
        event.query.queryKey[0] !== 'notifications'
      ) return

      const data = event.query.state.data as
        | { data: NotificationData[]; unread_count: number }
        | undefined

      const notifications = data?.data ?? []

      if (!isBooted.current) {
        // First load — seed seenIds silently, don't toast
        notifications.forEach(n => seenIds.current.add(n.id))
        isBooted.current = true
        return
      }

      // Subsequent updates — toast any new unread notifications
      notifications.forEach(n => {
        if (!seenIds.current.has(n.id)) {
          seenIds.current.add(n.id)
          if (!n.is_read) {
            toast(n.title, { description: n.body, duration: 5000 })
          }
        }
      })
    })

    return unsubscribe
  }, [qc])

  return null
}
