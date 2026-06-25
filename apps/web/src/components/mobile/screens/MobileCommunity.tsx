import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Send, MessageCircle, Pin, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'

type Reaction = 'like' | 'celebrate' | 'appreciate' | 'support'
interface Post {
  id: string; author_name?: string | null; type: 'update' | 'announcement' | 'recognition'
  title?: string | null; body: string; pinned?: boolean; created_at: string
  reaction_count: number; comment_count: number; my_reaction?: Reaction | null
}
interface Comment { id: string; author_name?: string | null; body: string; created_at: string }

const REACTIONS: { key: Reaction; emoji: string; label: string }[] = [
  { key: 'like', emoji: '👍', label: 'Like' },
  { key: 'celebrate', emoji: '🎉', label: 'Celebrate' },
  { key: 'appreciate', emoji: '👏', label: 'Appreciate' },
  { key: 'support', emoji: '💪', label: 'Support' },
]

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const s = Math.floor((Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function MobileCommunity({ base: _base }: { base: string }) {
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const isHr = profile?.role === 'hr_admin' || profile?.role === 'super_admin'

  const [body, setBody] = useState('')
  const [announce, setAnnounce] = useState(false)

  const { data, isLoading } = useQuery<{ data: Post[] }>({
    queryKey: ['mobile-community-feed'], queryFn: () => api.get('/community/feed?limit=30'),
  })
  const posts = data?.data ?? []

  const post = useMutation({
    mutationFn: () => api.post('/community/posts', {
      body: body.trim(),
      type: isHr && announce ? 'announcement' : 'update',
      pinned: isHr && announce ? true : undefined,
    }),
    onSuccess: () => { setBody(''); setAnnounce(false); toast.success('Posted'); qc.invalidateQueries({ queryKey: ['mobile-community-feed'] }) },
    onError: (e: Error) => toast.error('Could not post', { description: e.message }),
  })

  const react = useMutation({
    mutationFn: ({ id, reaction }: { id: string; reaction: Reaction }) => api.post(`/community/posts/${id}/react`, { reaction }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobile-community-feed'] }),
    onError: (e: Error) => toast.error('Could not react', { description: e.message }),
  })

  return (
    <div className="space-y-4">
      <p className="px-1 text-lg font-extrabold tracking-tight text-[#0F172A]">Community</p>

      {/* Composer */}
      <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000}
          placeholder="Share something with your team…"
          className="w-full resize-none rounded-xl border border-border bg-[#EEF3FF]/40 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2E6FE6] focus:outline-none" />
        <div className="mt-2.5 flex items-center justify-between">
          {isHr ? (
            <button onClick={() => setAnnounce((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${announce ? 'bg-[#7C3AED]/10 text-[#7C3AED]' : 'bg-muted text-muted-foreground'}`}>
              <Megaphone className="h-3.5 w-3.5" /> Announcement
            </button>
          ) : <span />}
          <button disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            style={glossy('#2E6FE6', '#15B8A6')}>
            <Send className="h-3.5 w-3.5" /> {post.isPending ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>

      {/* Feed */}
      {isLoading && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">Loading…</p>}
      {!isLoading && posts.length === 0 && (
        <div className="rounded-2xl bg-white px-4 py-6 text-center shadow-sm">
          <span className="grid h-12 w-12 mx-auto place-items-center rounded-2xl text-white" style={glossy('#2E6FE6', '#15B8A6')}><MessageCircle className="h-5 w-5" /></span>
          <p className="mt-2 text-sm font-semibold text-foreground">No posts yet</p>
          <p className="text-[11px] text-muted-foreground">Start the conversation — share an update above.</p>
        </div>
      )}
      <div className="space-y-3">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} onReact={(reaction) => react.mutate({ id: p.id, reaction })} />
        ))}
      </div>
    </div>
  )
}

function PostCard({ post, onReact }: { post: Post; onReact: (r: Reaction) => void }) {
  const [showComments, setShowComments] = useState(false)
  const isAnnouncement = post.type === 'announcement' || post.pinned
  const initials = (post.author_name ?? '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className={`rounded-2xl bg-white p-4 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)] ${isAnnouncement ? 'ring-1 ring-[#7C3AED]/30' : ''}`}>
      <div className="flex items-center gap-2.5">
        {isAnnouncement ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={glossy('#7C3AED', '#A78BFA')}><Megaphone className="h-4 w-4" /></span>
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={glossy('#1A4D8F', '#2E6FE6')}>{initials}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-foreground">{post.author_name ?? 'Someone'}</p>
          <p className="text-[10px] text-muted-foreground">{timeAgo(post.created_at)}</p>
        </div>
        {post.pinned && <Pin className="h-3.5 w-3.5 text-[#7C3AED]" />}
      </div>

      {post.title && <p className="mt-2.5 text-sm font-bold text-[#0F172A]">{post.title}</p>}
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-foreground/85">{post.body}</p>

      {/* Reactions */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
        {REACTIONS.map((r) => {
          const active = post.my_reaction === r.key
          return (
            <button key={r.key} onClick={() => onReact(r.key)} aria-label={r.label}
              className={`rounded-full px-2 py-1 text-sm transition-colors ${active ? 'bg-[#2E6FE6]/10 ring-1 ring-[#2E6FE6]/40' : 'hover:bg-muted'}`}>
              {r.emoji}
            </button>
          )
        })}
        {post.reaction_count > 0 && <span className="ml-1 text-[11px] font-semibold text-muted-foreground">{post.reaction_count}</span>}
        <button onClick={() => setShowComments((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted">
          <MessageCircle className="h-3.5 w-3.5" /> {post.comment_count}
        </button>
      </div>

      {showComments && <Comments postId={post.id} />}
    </div>
  )
}

function Comments({ postId }: { postId: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')

  const { data, isLoading } = useQuery<{ data: Comment[] }>({
    queryKey: ['mobile-community-comments', postId],
    queryFn: () => api.get(`/community/posts/${postId}/comments`),
  })
  const comments = data?.data ?? []

  const add = useMutation({
    mutationFn: () => api.post(`/community/posts/${postId}/comments`, { body: text.trim() }),
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: ['mobile-community-comments', postId] })
      qc.invalidateQueries({ queryKey: ['mobile-community-feed'] })
    },
    onError: (e: Error) => toast.error('Could not comment', { description: e.message }),
  })

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {isLoading && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</p>}
      {!isLoading && comments.length === 0 && <p className="text-[11px] text-muted-foreground">No comments yet — be the first.</p>}
      {comments.map((c) => (
        <div key={c.id} className="rounded-xl bg-[#EEF3FF]/60 px-3 py-2">
          <p className="text-[11px] font-bold text-foreground">{c.author_name ?? 'Someone'} <span className="ml-1 font-normal text-muted-foreground">{timeAgo(c.created_at)}</span></p>
          <p className="text-[12px] text-foreground/85">{c.body}</p>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
          placeholder="Add a comment…"
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) add.mutate() }}
          className="flex-1 rounded-full border border-border bg-white px-3.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-[#2E6FE6] focus:outline-none" />
        <button disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white disabled:opacity-50" style={glossy('#2E6FE6', '#15B8A6')}>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
