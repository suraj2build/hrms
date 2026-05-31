/**
 * SidebarAdvancedSection — Collapsible "Advanced Tools" section for the
 * admin sidebar. Renders items where `advanced: true` grouped by their
 * NavGroup sub-section behind a single chevron toggle.
 *
 * Sub-group structure (driven by ADMIN_GROUPS with advanced: true):
 *   · Risk & Governance
 *   · Simulation & Optimization
 *   · Advanced Intelligence
 *   · Platform Orchestration
 *
 * Design rules: design-system tokens only — no raw hex / bg-gray-* classes.
 */

import { useState }       from 'react';
import { NavLink }        from 'react-router-dom';
import { ChevronDown, Settings2 } from 'lucide-react';
import { cn }             from '@/lib/utils';
import {
  type NavItem,
  type NavGroup,
  ADMIN_GROUPS,
} from '@/config/navigation.config';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SidebarAdvancedSectionProps {
  items:        NavItem[];
  isCollapsed?: boolean;
}

// ---------------------------------------------------------------------------
// NavLinkItem — renders a single sidebar nav link with active state
// ---------------------------------------------------------------------------

function NavLinkItem({
  item,
  isCollapsed,
}: {
  item:        NavItem;
  isCollapsed: boolean;
}) {
  return (
    <NavLink
      to={item.route}
      end={item.exact}
      title={isCollapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md text-sm transition-colors',
          isCollapsed
            ? 'justify-center px-2 py-2'
            : 'px-3 py-[7px]',
          isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            className={cn(
              'h-[15px] w-[15px] flex-shrink-0 transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground/60',
            )}
          />
          {!isCollapsed && (
            <span className="flex-1 text-[13px] leading-none truncate">
              {item.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// ---------------------------------------------------------------------------
// SubGroupSection — a labeled cluster of advanced items
// ---------------------------------------------------------------------------

function SubGroupSection({
  group,
  items,
  isCollapsed,
}: {
  group:       NavGroup;
  items:       NavItem[];
  isCollapsed: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="pt-1">
      {!isCollapsed && (
        <div className="flex items-center gap-1.5 px-3 pb-0.5">
          <group.icon className="h-[10px] w-[10px] text-muted-foreground/40 flex-shrink-0" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/45 leading-none">
            {group.label}
          </span>
        </div>
      )}
      <div className="space-y-0.5">
        {items.map(item => (
          <NavLinkItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarAdvancedSection
// ---------------------------------------------------------------------------

export function SidebarAdvancedSection({
  items,
  isCollapsed = false,
}: SidebarAdvancedSectionProps) {
  const [open, setOpen] = useState(false);

  // Nothing to render if there are no advanced items
  if (items.length === 0) return null;

  // Get advanced sub-groups in declaration order from ADMIN_GROUPS
  const advancedGroups: NavGroup[] = ADMIN_GROUPS.filter(g => g.advanced === true);

  // Group items by their groupId (preserving ADMIN_GROUPS order)
  const groupedItems = advancedGroups.map(group => ({
    group,
    items: items.filter(item => item.groupId === group.id),
  })).filter(({ items: gi }) => gi.length > 0);

  // Flat list for collapsed icon-rail (no sub-group labels needed)
  const allItems = groupedItems.flatMap(({ items: gi }) => gi);

  return (
    <div>
      {/* Divider */}
      <div className="mx-3 my-2 border-t border-border/50" />

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-label="Toggle advanced tools"
        title={isCollapsed ? 'Advanced Tools' : undefined}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors',
          isCollapsed && 'justify-center',
        )}
      >
        <Settings2 className="h-3 w-3 flex-shrink-0" />
        {!isCollapsed && (
          <>
            <span className="flex-1 text-left font-medium tracking-wide">
              Advanced Tools
            </span>
            <ChevronDown
              className={cn(
                'h-3 w-3 ml-auto transition-transform duration-200',
                open && 'rotate-180',
              )}
            />
          </>
        )}
      </button>

      {/* Collapsible items */}
      {open && (
        <div className="pb-1">
          {isCollapsed
            ? /* Collapsed: flat list of icons, no sub-group headers */
              <div className="py-1 space-y-0.5">
                {allItems.map(item => (
                  <NavLinkItem key={item.id} item={item} isCollapsed={true} />
                ))}
              </div>
            : /* Expanded: grouped by sub-section */
              <div className="px-1 space-y-0.5">
                {groupedItems.map(({ group, items: gi }) => (
                  <SubGroupSection
                    key={group.id}
                    group={group}
                    items={gi}
                    isCollapsed={false}
                  />
                ))}
              </div>
          }
        </div>
      )}
    </div>
  );
}
