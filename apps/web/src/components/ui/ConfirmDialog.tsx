import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog'
import { Button } from './button'

interface ConfirmDialogProps {
  open: boolean
  message: string
  title?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, message, title = 'Confirm', confirmLabel = 'Confirm', destructive, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground whitespace-pre-line">{message}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PromptDialogProps {
  open: boolean
  title: string
  placeholder?: string
  required?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({ open, title, placeholder, required, onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState('')

  const submit = () => {
    if (required && !value.trim()) return
    const v = value
    setValue('')
    onConfirm(v)
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { setValue(''); onCancel() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => e.key === 'Enter' && submit()}
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => { setValue(''); onCancel() }}>Cancel</Button>
          <Button onClick={submit} disabled={required ? !value.trim() : false}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
