/**
 * MobileWish — shared "Wish" affordance for the phone Community/Home feeds.
 *
 * Tapping opens a bottom-anchored composer pre-filled with an editable message;
 * posting creates a typed celebration post via POST /community/wish. Mirrors the
 * desktop context-panel Wish flow so phone + desktop behave identically.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PartyPopper, Send, Check, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { glossy } from '../glossy'

export type WishKind = 'birthday' | 'anniversary'

const firstNameOf = (full: string) => full.trim().split(/\s+/)[0] || full

function defaultWish(name: string, kind: WishKind, years?: number) {
  const who = firstNameOf(name)
  return kind === 'birthday'
    ? `🎂 Happy birthday, ${who}! Wishing you a fantastic year ahead. 🎉`
    : `🎉 Congratulations ${who} on ${years} year${years === 1 ? '' : 's'} with the team! Thank you for everything you do. 🙌`
}

/** Invalidate every feed surface (home + community, mobile + desktop). */
function invalidateFeeds(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0]
      return typeof k === 'string' && (k.includes('community') || k.includes('feed') || k.includes('home'))
    },
  })
}

export function MobileWishButton({ subjectEmployeeId, name, kind, years }: {
  subjectEmployeeId: string; name: string; kind: WishKind; years?: number
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post('/community/wish', { subject_employee_id: subjectEmployeeId, kind, message: message.trim() }),
    onSuccess: () => {
      setDone(true); setOpen(false)
      toast.success('Wish posted', { description: `${firstNameOf(name)} will see it in the feed.` })
      invalidateFeeds(qc)
    },
    onError: (e: Error) => toast.error('Could not post your wish', { description: e.message }),
  })

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#15B8A6]/12 px-2.5 py-1 text-[11px] font-bold text-[#15B8A6]">
        <Check className="h-3.5 w-3.5" />Wished
      </span>
    )
  }

  return (
    <>
      <button
        onClick={() => { setMessage(defaultWish(name, kind, years)); setOpen(true) }}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-white active:scale-95 transition-transform"
        style={glossy('#15B8A6', '#2DD4BF')}
      >
        <PartyPopper className="h-3.5 w-3.5" />Wish
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-8 shadow-2xl" onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-extrabold text-[#0F172A]">
                <span className="text-lg">{kind === 'birthday' ? '🎂' : '🎉'}</span>
                Wish {firstNameOf(name)}
              </p>
              <button onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Write a warm message…"
              className="w-full resize-none rounded-xl border border-border bg-[#EEF3FF]/40 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#15B8A6] focus:outline-none"
            />
            <button
              disabled={mutation.isPending || message.trim().length === 0}
              onClick={() => mutation.mutate()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
              style={glossy('#1A4D8F', '#15B8A6')}
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post wish to Community
            </button>
          </div>
        </div>
      )}
    </>
  )
}
