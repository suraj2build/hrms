/**
 * EssCommunity — ESS 2.0 "Community" pillar surface.
 * A company feed: post updates, react, and comment. HR can post announcements
 * and pin. Backed by /community/* (migration 307).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Megaphone, Pin, PinOff, MessageCircle, Send, MoreHorizontal, Flag, EyeOff, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { invalidateCommunityFeeds } from '@/lib/community-feed-cache'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

// ── Types ─────────────────────────────────────────────────────────────────────
interface FeedPost {
  id: string; author_name: string | null; subject_name: string | null
  type: string; title: string | null
  body: string; pinned: boolean; created_at: string
  reaction_count: number; comment_count: number; my_reaction: string | null
}

// Celebration post types (birthday / work anniversary) render with festive chrome.
const CELEBRATION: Record<string, { emoji: string; label: string }> = {
  birthday:    { emoji: '🎂', label: 'Birthday' },
  anniversary: { emoji: '🎉', label: 'Work Anniversary' },
}
interface Comment { id: string; author_name: string | null; body: string; created_at: string }

const REACTIONS: { key: string; emoji: string; label: string }[] = [
  { key: 'like',       emoji: '👍', label: 'Like' },
  { key: 'celebrate',  emoji: '🎉', label: 'Celebrate' },
  { key: 'appreciate', emoji: '👏', label: 'Appreciate' },
  { key: 'support',    emoji: '💪', label: 'Support' },
]

function timeAgo(iso: string): string {
  try {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  } catch { return '' }
}
function initials(name: string | null): string {
  if (!name) return '·'
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

// ── Comment thread (lazy-loaded when expanded) ─────────────────────────────────
function CommentThread({ postId }: { postId: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const { data, isLoading } = useQuery<{ data: Comment[] }>({
    queryKey: ['community-comments', postId],
    queryFn:  () => api.get(`/community/posts/${postId}/comments`),
  })
  const add = useMutation({
    mutationFn: () => api.post(`/community/posts/${postId}/comments`, { body: text.trim() }),
    onSuccess: () => {
      invalidateCommunityFeeds(qc)
      setText('')
    },
    onError: (e: Error) => toast.error('Could not comment', { description: e.message }),
  })
  const comments = data?.data ?? []

  return (
    <div className="mt-3 border-t border-border pt-3">
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading comments…</p>
      ) : (
        <div className="space-y-2.5">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">{initials(c.author_name)}</span>
              <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-1.5">
                <span className="text-[11px] font-semibold text-foreground">{c.author_name ?? 'Someone'}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                <p className="text-xs text-foreground">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) add.mutate() }}
          placeholder="Write a comment…"
          maxLength={1000}
          className="flex-1 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs outline-none focus:border-primary"
        />
        <Button size="icon" variant="ghost" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ── Moderation / report menu ────────────────────────────────────────────────────
function ModerationMenu({ p }: { p: FeedPost }) {
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const isHr = profile?.role === 'hr_admin' || profile?.role === 'super_admin'

  const refetch = () => invalidateCommunityFeeds(qc)

  const report = useMutation({
    mutationFn: () => api.post(`/community/posts/${p.id}/report`, {}),
    onSuccess: () => toast.success('Reported', { description: 'Thanks — HR will review this post.' }),
    onError: (e: Error) => toast.error('Could not report', { description: e.message }),
  })
  const moderate = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/community/posts/${p.id}`, patch),
    onSuccess: () => refetch(),
    onError: (e: Error) => toast.error('Action failed', { description: e.message }),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => report.mutate()}>
          <Flag className="mr-2 h-3.5 w-3.5" />Report post
        </DropdownMenuItem>
        {isHr && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => moderate.mutate({ pinned: !p.pinned })}>
              {p.pinned ? <><PinOff className="mr-2 h-3.5 w-3.5" />Unpin</> : <><Pin className="mr-2 h-3.5 w-3.5" />Pin</>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => moderate.mutate({ status: 'hidden' })}>
              <EyeOff className="mr-2 h-3.5 w-3.5" />Hide
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => moderate.mutate({ status: 'removed' })} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Post card ──────────────────────────────────────────────────────────────────
function PostCard({ p }: { p: FeedPost }) {
  const qc = useQueryClient()
  const [showComments, setShowComments] = useState(false)
  const react = useMutation({
    mutationFn: (reaction: string) => api.post(`/community/posts/${p.id}/react`, { reaction }),
    onSuccess: () => invalidateCommunityFeeds(qc),
    onError: (e: Error) => toast.error('Could not react', { description: e.message }),
  })
  const isAnnouncement = p.type === 'announcement'
  const celebration    = CELEBRATION[p.type]

  return (
    <div className={`rounded-xl border bg-card p-4 ${p.pinned ? 'border-primary/40' : celebration ? 'border-[#15B8A6]/30' : 'border-border'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${celebration ? 'bg-[#15B8A6]/10 text-base' : 'bg-primary/10 text-primary'}`}>
          {celebration ? celebration.emoji : isAnnouncement ? <Megaphone className="h-4 w-4" /> : initials(p.author_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {celebration && p.subject_name
              ? (p.author_name
                  // Personal wish: "<author> wished <subject>"
                  ? <><span>{p.author_name}</span> <span className="font-normal text-muted-foreground">wished</span> <span>{p.subject_name}</span></>
                  // System celebration: subject is the headline
                  : <span>{p.subject_name}</span>)
              : (p.author_name ?? (isAnnouncement ? 'Announcement' : 'Someone'))}
          </p>
          <p className="text-[11px] text-muted-foreground">{timeAgo(p.created_at)}</p>
        </div>
        {p.pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
        {isAnnouncement && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Announcement</span>}
        {celebration && <span className="rounded-full bg-[#15B8A6]/10 px-2 py-0.5 text-[10px] font-semibold text-[#15B8A6]">{celebration.label}</span>}
        <ModerationMenu p={p} />
      </div>

      {p.title && <p className="mt-2.5 text-sm font-semibold text-foreground">{p.title}</p>}
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{p.body}</p>

      <div className="mt-3 flex items-center gap-1">
        {REACTIONS.map(r => {
          const active = p.my_reaction === r.key
          return (
            <button
              key={r.key}
              onClick={() => react.mutate(r.key)}
              title={r.label}
              className={`rounded-full px-2 py-1 text-sm transition-colors ${active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted'}`}
            >
              {r.emoji}
            </button>
          )
        })}
        {p.reaction_count > 0 && <span className="ml-1 text-xs text-muted-foreground">{p.reaction_count}</span>}
        <button
          onClick={() => setShowComments(s => !s)}
          className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {p.comment_count > 0 ? p.comment_count : 'Comment'}
        </button>
      </div>

      {showComments && <CommentThread postId={p.id} />}
    </div>
  )
}

// ── Composer ───────────────────────────────────────────────────────────────────
function Composer() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.profile?.role)
  const isHr = role === 'hr_admin' || role === 'super_admin'
  const [body, setBody] = useState('')
  const [announce, setAnnounce] = useState(false)

  const post = useMutation({
    mutationFn: () => api.post('/community/posts', {
      body: body.trim(),
      type: announce ? 'announcement' : 'update',
      pinned: announce,
    }),
    onSuccess: () => {
      invalidateCommunityFeeds(qc)
      toast.success('Posted')
      setBody(''); setAnnounce(false)
    },
    onError: (e: Error) => toast.error('Could not post', { description: e.message }),
  })

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Share something with your team…"
        className="w-full resize-none rounded-lg border border-border bg-background/40 p-2.5 text-sm outline-none focus:border-primary"
      />
      <div className="mt-2 flex items-center justify-between">
        {isHr ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="accent-primary" />
            Post as pinned announcement
          </label>
        ) : <span />}
        <Button size="sm" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>
          {post.isPending ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export function EssCommunity() {
  const { data, isLoading } = useQuery<{ data: FeedPost[] }>({
    queryKey: ['community-feed'],
    queryFn:  () => api.get('/community/feed?limit=30'),
    staleTime: 20_000,
  })
  const feed = data?.data ?? []

  return (
    <PageContainer>
      <PageHeader
        title="Community"
        subtitle="What's happening across the company"
        breadcrumb={[{ label: 'Community' }]}
      />

      <Composer />

      <SectionCard title="Feed">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : feed.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">Nothing here yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">Be the first to share an update with your team.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feed.map(p => <PostCard key={p.id} p={p} />)}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
