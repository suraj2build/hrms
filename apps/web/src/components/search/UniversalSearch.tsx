import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarCheck,
  Clock,
  ClipboardEdit,
  DollarSign,
  Loader2,
  Navigation,
  Search,
  Upload,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ADMIN_NAV_ITEMS } from '@/config/navigation.config';
import { getSearchableNavItems } from '@/components/layout/v2/nav-config';
import { useAuthStore } from '@/stores/authStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResultGroup = 'navigation' | 'employees' | 'quick_actions' | 'recent' | 'payroll' | 'anomalies';

type ActiveTab = 'all' | 'navigate' | 'people' | 'actions' | 'recent';

interface SearchResult {
  id:          string;
  group:       ResultGroup;
  label:       string;
  sublabel?:   string;
  route?:      string;
  action?:     () => void;
  icon:        React.ReactNode;
  badge?:      string;
  badgeColor?: string;
  kbd?:        string;
}

interface RecentPage {
  route:     string;
  label:     string;
  timestamp: number;
}

// API response shapes
interface EmployeeSearchItem {
  id:              string;
  full_name?:      string;
  name?:           string;
  employee_code?:  string;
  department?:     string;
}

interface PayrollRunItem {
  id:        string;
  run_name?: string;
  name?:     string;
  period?:   string;
  status?:   string;
}

interface AnomalyItem {
  id:              string;
  employee_name?:  string;
  anomaly_type?:   string;
  date?:           string;
  severity?:       string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENT_PAGES_KEY = 'ux2_recent_pages';
const MAX_RECENT       = 5;

const QUICK_ACTIONS: SearchResult[] = [
  {
    id:       'qa-new-employee',
    group:    'quick_actions',
    label:    'Add Employee',
    sublabel: 'Create a new employee record',
    route:    '/admin/employees/new',
    icon:     <UserPlus className="h-4 w-4" />,
    kbd:      '⌘N',
  },
  {
    id:       'qa-payroll-run',
    group:    'quick_actions',
    label:    'Run Payroll',
    sublabel: 'Start a new payroll cycle',
    route:    '/admin/payroll',
    icon:     <DollarSign className="h-4 w-4" />,
  },
  {
    id:       'qa-upload',
    group:    'quick_actions',
    label:    'Upload Attendance',
    sublabel: 'Bulk upload attendance CSV',
    route:    '/admin/attendance/upload',
    icon:     <Upload className="h-4 w-4" />,
  },
  {
    id:       'qa-leave',
    group:    'quick_actions',
    label:    'Leave Approvals',
    sublabel: 'Pending leave requests',
    route:    '/admin/approvals/inbox',
    icon:     <CalendarCheck className="h-4 w-4" />,
  },
  {
    id:       'qa-corrections',
    group:    'quick_actions',
    label:    'Corrections',
    sublabel: 'Attendance corrections inbox',
    route:    '/admin/attendance/corrections',
    icon:     <ClipboardEdit className="h-4 w-4" />,
  },
];

const NAV_SHORTCUTS: SearchResult[] = ADMIN_NAV_ITEMS.slice(0, 3).map((item) => ({
  id:       `nav-shortcut-${item.id}`,
  group:    'navigation' as const,
  label:    item.label,
  sublabel: item.description,
  route:    item.route,
  icon:     <item.icon className="h-4 w-4" />,
}));

const GROUP_LABELS: Record<ResultGroup, string> = {
  navigation:    'Navigate',
  employees:     'People',
  quick_actions: 'Quick Actions',
  recent:        'Recent Pages',
  payroll:       'Payroll Runs',
  anomalies:     'Anomalies',
};

const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'all',     label: 'All' },
  { id: 'navigate', label: 'Navigate' },
  { id: 'people',  label: 'People' },
  { id: 'actions', label: 'Actions' },
  { id: 'recent',  label: 'Recent' },
];

const TAB_GROUPS: Record<ActiveTab, ResultGroup[] | null> = {
  all:      null,
  navigate: ['navigation'],
  people:   ['employees'],
  actions:  ['quick_actions'],
  recent:   ['recent'],
};

// ---------------------------------------------------------------------------
// Recent pages helpers
// ---------------------------------------------------------------------------

function loadRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY);
    return raw ? (JSON.parse(raw) as RecentPage[]) : [];
  } catch {
    return [];
  }
}

function saveRecentPage(page: Omit<RecentPage, 'timestamp'>): void {
  try {
    const existing = loadRecentPages().filter((p) => p.route !== page.route);
    const updated: RecentPage[] = [
      { ...page, timestamp: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(updated));
  } catch {
    // silently ignore storage errors
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UniversalSearch({
  open,
  onClose,
}: {
  open:    boolean;
  onClose: () => void;
}) {
  const navigate   = useNavigate();
  const inputRef   = useRef<HTMLInputElement>(null);
  const listRef    = useRef<HTMLDivElement>(null);
  const role       = useAuthStore(s => s.profile?.role);

  // Live nav index — sourced from the real sidebar (DOMAINS), so search always
  // matches what's actually navigable. Keyword map (from ADMIN_NAV_ITEMS) adds
  // fuzzy synonyms (e.g. "payslip" → Pay Slips) where routes overlap.
  const navIndex = useMemo(() => getSearchableNavItems(role), [role]);
  const kwByRoute = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of ADMIN_NAV_ITEMS) {
      const kw = [...(it.keywords ?? []), it.description ?? ''].join(' ').toLowerCase();
      if (kw.trim()) m.set(it.route, kw);
    }
    return m;
  }, []);

  const [query,       setQuery]       = useState('');
  const [activeTab,   setActiveTab]   = useState<ActiveTab>('all');
  const [loading,     setLoading]     = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // API result buckets
  const [empResults,  setEmpResults]  = useState<SearchResult[]>([]);
  const [payResults,  setPayResults]  = useState<SearchResult[]>([]);
  const [anomResults, setAnoResults]  = useState<SearchResult[]>([]);
  const [navResults,  setNavResults]  = useState<SearchResult[]>([]);

  // Recent pages (read once on open)
  const [recentPages, setRecentPages] = useState<RecentPage[]>([]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveTab('all');
      setActiveIndex(0);
      setEmpResults([]);
      setPayResults([]);
      setAnoResults([]);
      setNavResults([]);
      setLoading(false);
      setRecentPages(loadRecentPages());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Navigation search (instant, synchronous) — tokenised + scored against the
  // live nav index so all tokens must match, with sensible ranking.
  const searchNav = useCallback((q: string): SearchResult[] => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const phrase = tokens.join(' ');

    const scored = navIndex.map((item) => {
      const label = item.label.toLowerCase();
      const kw    = kwByRoute.get(item.route) ?? '';
      const hay   = `${label} ${item.group.toLowerCase()} ${item.domain.toLowerCase()} ${kw}`;
      // every token must appear somewhere
      if (!tokens.every((t) => hay.includes(t))) return { item, score: 0 };
      let score = 1;
      if (label === phrase)            score += 100;
      else if (label.startsWith(phrase)) score += 50;
      else if (label.includes(phrase)) score += 25;
      for (const t of tokens) if (label.startsWith(t)) score += 6;
      // prefer label/group hits over keyword-only hits
      if (tokens.every((t) => label.includes(t))) score += 12;
      return { item, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ item }) => {
        const Icon = item.icon;
        return {
          id:       `nav-${item.id}`,
          group:    'navigation' as const,
          label:    item.label,
          sublabel: `${item.domain} › ${item.group}`,
          route:    item.route,
          icon:     <Icon className="h-4 w-4" />,
        };
      });
  }, [navIndex, kwByRoute]);

  // Debounced API search
  useEffect(() => {
    if (!query.trim()) {
      setEmpResults([]);
      setPayResults([]);
      setAnoResults([]);
      setNavResults([]);
      setLoading(false);
      return;
    }

    const q = query.trim();

    // Navigation results are instant
    setNavResults(searchNav(q));

    setLoading(true);

    const timer = setTimeout(async () => {
      const empPromise = api
        .get<{ data: EmployeeSearchItem[] }>(
          `/employees/search?q=${encodeURIComponent(q)}&limit=5`,
        )
        .then((r) =>
          (r.data ?? []).map(
            (e): SearchResult => ({
              id:       `emp-${e.id}`,
              group:    'employees',
              label:    e.full_name ?? e.name ?? e.id,
              sublabel: [e.department, e.employee_code].filter(Boolean).join(' · '),
              route:    `/admin/employees/${e.id}`,
              icon:     <Users className="h-4 w-4" />,
            }),
          ),
        )
        .catch((): SearchResult[] => []);

      const payPromise = api
        .get<{ data: PayrollRunItem[] }>(
          `/payroll/runs?q=${encodeURIComponent(q)}&limit=3`,
        )
        .then((r) =>
          (r.data ?? []).map(
            (p): SearchResult => ({
              id:         `pay-${p.id}`,
              group:      'payroll',
              label:      p.run_name ?? p.name ?? p.id,
              sublabel:   p.period,
              route:      `/admin/payroll/${p.id}`,
              icon:       <DollarSign className="h-4 w-4" />,
              badge:      p.status,
              badgeColor:
                p.status === 'completed'
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-muted text-muted-foreground border-border',
            }),
          ),
        )
        .catch((): SearchResult[] => []);

      const anomPromise =
        q.length >= 3
          ? api
              .get<{ data: AnomalyItem[] }>(
                `/work-session-anomalies?q=${encodeURIComponent(q)}&limit=5`,
              )
              .then((r) =>
                (r.data ?? []).map(
                  (a): SearchResult => ({
                    id:         `anom-${a.id}`,
                    group:      'anomalies',
                    label:      a.employee_name ?? a.id,
                    sublabel:   [a.anomaly_type, a.date].filter(Boolean).join(' · '),
                    route:      `/admin/attendance/anomalies?id=${a.id}`,
                    icon:       <AlertTriangle className="h-4 w-4" />,
                    badge:      a.severity,
                    badgeColor:
                      a.severity === 'high'
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-muted text-muted-foreground border-border',
                  }),
                ),
              )
              .catch((): SearchResult[] => [])
          : Promise.resolve([] as SearchResult[]);

      const [empSettled, paySettled, anomSettled] = await Promise.allSettled([
        empPromise,
        payPromise,
        anomPromise,
      ]);

      setEmpResults(empSettled.status === 'fulfilled'  ? empSettled.value  : []);
      setPayResults(paySettled.status === 'fulfilled'  ? paySettled.value  : []);
      setAnoResults(anomSettled.status === 'fulfilled' ? anomSettled.value : []);
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, searchNav]);

  // Build recent results from state
  const recentResults = useMemo<SearchResult[]>(
    () =>
      recentPages.map((p) => ({
        id:    `recent-${p.route}`,
        group: 'recent' as const,
        label: p.label,
        sublabel: p.route,
        route: p.route,
        icon:  <Clock className="h-4 w-4" />,
      })),
    [recentPages],
  );

  // Aggregate all visible results based on query + tab
  const allResults = useMemo<SearchResult[]>(() => {
    const hasQuery = query.trim().length > 0;

    if (hasQuery) {
      return [...navResults, ...empResults, ...payResults, ...anomResults];
    }

    // Empty query: recent + quick actions + nav shortcuts
    return [...recentResults, ...QUICK_ACTIONS, ...NAV_SHORTCUTS];
  }, [query, navResults, empResults, payResults, anomResults, recentResults]);

  // Filter by active tab
  const visibleResults = useMemo<SearchResult[]>(() => {
    const allowed = TAB_GROUPS[activeTab];
    if (allowed === null) return allResults;
    return allResults.filter((r) => allowed.includes(r.group));
  }, [allResults, activeTab]);

  // Reset focused index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [visibleResults.length]);

  // Scroll focused item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // handleSelect
  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.route) {
        saveRecentPage({ route: result.route, label: result.label });
      }
      if (result.action) {
        result.action();
      } else if (result.route) {
        navigate(result.route);
      }
      onClose();
    },
    [navigate, onClose],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, visibleResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const item = visibleResults[activeIndex];
        if (item) handleSelect(item);
      }
    },
    [visibleResults, activeIndex, handleSelect, onClose],
  );

  // Group visible results for rendering
  const grouped = useMemo(() => {
    const map = new Map<ResultGroup, SearchResult[]>();
    for (const r of visibleResults) {
      const bucket = map.get(r.group);
      if (bucket) {
        bucket.push(r);
      } else {
        map.set(r.group, [r]);
      }
    }
    return map;
  }, [visibleResults]);

  // Build flat list with stable indices for keyboard nav
  const flatWithGroups = useMemo(() => {
    type Entry =
      | { kind: 'header'; label: string }
      | { kind: 'item'; result: SearchResult; index: number };

    const entries: Entry[] = [];
    let idx = 0;

    for (const [group, items] of grouped.entries()) {
      entries.push({ kind: 'header', label: GROUP_LABELS[group] });
      for (const item of items) {
        entries.push({ kind: 'item', result: item, index: idx++ });
      }
    }
    return entries;
  }, [grouped]);

  const hasQuery   = query.trim().length > 0;
  const noResults  = !loading && visibleResults.length === 0 && hasQuery;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Universal search"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full mx-auto mt-[15vh] bg-popover rounded-xl border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 border-b border-border h-14">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search people, payroll, anomalies, pages…"
            className="h-full border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-base bg-transparent pl-0 flex-1"
            aria-autocomplete="list"
            aria-controls="universal-search-results"
            aria-activedescendant={
              visibleResults[activeIndex]
                ? `result-${visibleResults[activeIndex].id}`
                : undefined
            }
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
          ) : query ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-3 py-2 border-b border-border bg-muted/20">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setActiveIndex(0); }}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div
          id="universal-search-results"
          role="listbox"
          ref={listRef}
          className="max-h-[440px] overflow-y-auto"
        >
          {/* Skeleton while loading */}
          {loading && (
            <div className="space-y-1 p-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-10 rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {noResults && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Search className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">No results for &ldquo;{query}&rdquo;</p>
              <p className="text-xs opacity-70">Try a different keyword or browse the tabs above</p>
            </div>
          )}

          {/* Empty query + no recents */}
          {!hasQuery && visibleResults.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Zap className="h-8 w-8 opacity-30" />
              <p className="text-sm">Start typing to search…</p>
            </div>
          )}

          {/* Result groups */}
          {!loading &&
            flatWithGroups.map((entry, i) => {
              if (entry.kind === 'header') {
                return (
                  <div
                    key={`header-${i}`}
                    className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30 border-b border-border"
                  >
                    {entry.label}
                  </div>
                );
              }

              const { result, index } = entry;
              const isActive = index === activeIndex;

              return (
                <button
                  key={result.id}
                  id={`result-${result.id}`}
                  role="option"
                  aria-selected={isActive}
                  data-result-index={index}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors text-left',
                    isActive && 'bg-muted/60',
                  )}
                >
                  <span className="flex-shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                    {result.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground block truncate">
                      {result.label}
                    </span>
                    {result.sublabel && (
                      <span className="text-xs text-muted-foreground truncate block">
                        {result.sublabel}
                      </span>
                    )}
                  </span>
                  {result.badge && (
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded-full border',
                        result.badgeColor ?? 'bg-muted text-muted-foreground border-border',
                      )}
                    >
                      {result.badge}
                    </span>
                  )}
                  {result.kbd && (
                    <kbd className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5 border border-border">
                      {result.kbd}
                    </kbd>
                  )}
                </button>
              );
            })}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-muted/10">
          {!hasQuery && recentPages.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Navigation className="h-3 w-3" />
              {recentPages.length} recent page{recentPages.length !== 1 ? 's' : ''}
            </span>
          )}
          {hasQuery && !loading && (
            <span className="text-xs text-muted-foreground">
              {visibleResults.length} result{visibleResults.length !== 1 ? 's' : ''}
            </span>
          )}
          {!hasQuery && recentPages.length === 0 && <span />}
          <p className="text-xs text-muted-foreground select-none ml-auto">
            ↑↓ navigate &nbsp; ↵ select &nbsp; Esc close &nbsp; ⌘K toggle
          </p>
        </div>
      </div>
    </div>
  );
}
