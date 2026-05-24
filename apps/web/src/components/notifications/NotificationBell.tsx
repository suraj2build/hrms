import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UnreadBadge } from './UnreadBadge'
import { NotificationCenter } from './NotificationCenter'
import type { NotificationData } from './NotificationItem'

interface NotificationsResponse {
  data: NotificationData[]
  unread_count: number
}

export function NotificationBell() {
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn:  () => api.get<NotificationsResponse>('/notifications'),
    enabled:  !!profile,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const notifications = data?.data ?? []
  const unreadCount   = data?.unread_count ?? 0

  const markOneMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('Notification marked as read')
    },
    onError: (e: Error) => toast.error('Failed to mark notification as read', { description: e.message }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => api.post('/notifications/read-all', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('All notifications marked as read')
    },
    onError: (e: Error) => toast.error('Failed to mark all as read', { description: e.message }),
  })

  function handleNavigate(link: string) {
    navigate(link)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          <UnreadBadge count={unreadCount} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0" forceMount>
        <NotificationCenter
          notifications={notifications}
          unreadCount={unreadCount}
          loading={isLoading}
          onReadOne={(id) => markOneMutation.mutate(id)}
          onReadAll={() => markAllMutation.mutate()}
          onNavigate={handleNavigate}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
