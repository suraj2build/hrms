import { LogOut, ChevronDown } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { useBasePath } from '@/lib/routing'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils'
import { CommandPaletteTrigger } from '@/components/operational/CommandPalette'
import { ThemeToggle } from '@/components/theme-toggle'
import { RoleSwitcher } from './RoleSwitcher'
import { NotificationBell } from '@/components/notifications'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function Topbar() {
  const { profile, tenant, clear } = useAuthStore()
  const navigate = useNavigate()
  const basePath = useBasePath()

  async function handleSignOut() {
    await supabase.auth.signOut()
    clear()
    navigate('/login')
    toast.success('Signed out successfully')
  }

  return (
    <header className="h-14 border-b border-border bg-background flex items-center px-4 gap-4 flex-shrink-0">
      {/* Command palette trigger */}
      <CommandPaletteTrigger className="flex-shrink-0" />

      <div className="flex items-center gap-2 ml-auto">
        {/* Company name */}
        {tenant && (
          <span className="text-xs text-muted-foreground hidden md:block">
            {tenant.name}
          </span>
        )}

        {/* Role / portal switcher */}
        <RoleSwitcher />

        {/* Notifications */}
        <NotificationBell />

        {/* Theme toggle */}
        <ThemeToggle />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
              <Avatar className="h-7 w-7">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="text-xs bg-primary/20 text-primary">
                  {getInitials(profile?.full_name ?? 'U')}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm hidden md:block">{profile?.full_name ?? 'User'}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{profile?.full_name}</p>
              <p className="text-xs text-muted-foreground capitalize">{profile?.role?.replace('_', ' ')}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/ess/profile')}>
              My Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`${basePath}/settings`)}>
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
