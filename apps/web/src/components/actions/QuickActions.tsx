import React, { useCallback, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  DollarSign,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuickAction {
  id: string;
  label: string;
  icon: React.ElementType;
  route: string;
  color: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'create-shift',
    label: 'Create Shift',
    icon: AlarmClock,
    route: '/admin/shift-master',
    color: 'text-info',
    description: 'Define a new work shift',
  },
  {
    id: 'assign-roster',
    label: 'Assign Roster',
    icon: CalendarClock,
    route: '/admin/roster',
    color: 'text-accent-violet',
    description: 'Assign employees to roster',
  },
  {
    id: 'approve-attendance',
    label: 'Approve Attendance',
    icon: CheckCircle2,
    route: '/admin/attendance/regularisation',
    color: 'text-success',
    description: 'Review pending corrections',
  },
  {
    id: 'run-payroll',
    label: 'Run Payroll',
    icon: DollarSign,
    route: '/admin/payroll',
    color: 'text-warning',
    description: 'Start a payroll run',
  },
  {
    id: 'add-holiday',
    label: 'Add Holiday',
    icon: CalendarPlus,
    route: '/admin/holidays',
    color: 'text-accent-coral',
    description: 'Add a public holiday',
  },
  {
    id: 'resolve-anomaly',
    label: 'Resolve Anomaly',
    icon: AlertTriangle,
    route: '/admin/attendance/anomalies',
    color: 'text-destructive',
    description: 'Clear attendance flags',
  },
];

// ---------------------------------------------------------------------------
// Shared action card grid
// ---------------------------------------------------------------------------

function ActionGrid({ onAction }: { onAction: (route: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="rounded-lg border border-border bg-card hover:bg-muted/30 cursor-pointer p-3 transition text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onAction(action.route)}
          >
            <Icon size={18} className={cn('mb-1.5 shrink-0', action.color)} />
            <p className="text-xs font-semibold leading-snug">{action.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
              {action.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuickActions — inline panel
// ---------------------------------------------------------------------------

export function QuickActions({ className }: { className?: string }) {
  const handleAction = useCallback((route: string) => {
    window.location.href = route;
  }, []);

  return (
    <div className={cn('w-full', className)}>
      <ActionGrid onAction={handleAction} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuickActionsButton — floating trigger
// ---------------------------------------------------------------------------

export function QuickActionsButton() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-primary text-primary-foreground rounded-full shadow-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setDrawerOpen((prev) => !prev)}
        aria-label="Quick Actions"
      >
        <Zap size={16} />
        <span className="hidden sm:inline">Quick Actions</span>
      </button>

      <QuickActionsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// QuickActionsDrawer — slide-in panel from right
// ---------------------------------------------------------------------------

export function QuickActionsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const handleAction = useCallback(
    (route: string) => {
      window.location.href = route;
      onClose();
    },
    [onClose],
  );

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-72 bg-background border-l border-border shadow-xl transition-transform duration-300 ease-in-out flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Quick Actions</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <ActionGrid onAction={handleAction} />
        </div>
      </div>
    </>
  );
}
