/**
 * PilotFeedbackDialog — the pilot's "report an issue" entry point.
 *
 * Opened from PilotEnvironmentBanner. Posts to the existing
 * /support/error-reports pipe (severity: 'feedback') with an optional
 * screenshot upload — the same pipe crash reports already use, just with a
 * visible, user-initiated entry point instead of only firing on a crash.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/authStore'
import { uploadFeedbackScreenshot } from '@/lib/supabase-storage'
import { reportError } from '@/lib/observability/report'

export function PilotFeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { tenant } = useAuthStore()
  const [note, setNote] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!note.trim()) {
      toast.error('Please describe what happened before sending.')
      return
    }
    if (!tenant) return
    setSubmitting(true)
    try {
      let screenshotPath: string | undefined
      if (screenshot) {
        screenshotPath = await uploadFeedbackScreenshot(tenant.id, screenshot)
      }
      const ok = await reportError({
        message: `Pilot feedback: ${note.slice(0, 80)}`,
        userNote: note,
        severity: 'feedback',
        screenshotPath,
      })
      if (!ok) throw new Error('report failed')
      toast.success('Thanks — your report was sent.')
      setNote('')
      setScreenshot(null)
      onOpenChange(false)
    } catch {
      toast.error('Could not send your report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            This is a pilot environment — tell us what went wrong or looked off.
            Your report goes straight to the team building CognixHR.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened? What did you expect instead?"
            rows={5}
            autoFocus
          />
          <div>
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
              <Paperclip className="h-4 w-4" />
              {screenshot ? screenshot.name : 'Attach a screenshot (optional)'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
              />
            </label>
            {screenshot && (
              <button
                type="button"
                onClick={() => setScreenshot(null)}
                className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Remove attachment
              </button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
