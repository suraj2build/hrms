/**
 * OfferLetterDialog — generates and prints a branded offer letter for a candidate.
 *
 * Usage:
 *   <OfferLetterDialog appId="..." open={open} onOpenChange={setOpen} />
 *
 * Print-to-PDF flow: builds a full HTML document in memory, opens it in a
 * new window, and calls window.print() — no server-side PDF library needed.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Printer, Send, Loader2, FileText } from 'lucide-react'
import { toast } from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface OfferData {
  id:              string
  status:          string
  candidate_name:  string
  first_name:      string
  candidate_email: string
  job_title:       string
  department:      string
  company_name:    string
  offer?: {
    status:         string
    offered_amount: number | null
    joining_date:   string | null
    valid_until:    string | null
    accepted_at:    string | null
    declined_at:    string | null
  } | null
}

// ── Offer letter HTML builder ──────────────────────────────────────────────────

function buildOfferHtml(opts: {
  companyName:  string
  candidateName: string
  firstName:    string
  jobTitle:     string
  department:   string
  startDate:    string
  compensation: string
  extraTerms:   string
  refNo:        string
  date:         string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Offer Letter — ${opts.candidateName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', serif;
    font-size: 12pt;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    padding: 0;
  }
  .page {
    max-width: 750px;
    margin: 0 auto;
    padding: 48px 56px;
    min-height: 100vh;
  }
  /* Letterhead */
  .letterhead {
    border-bottom: 2px solid #2E6FE6;
    padding-bottom: 16px;
    margin-bottom: 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .company-name {
    font-size: 20pt;
    font-weight: 700;
    color: #1e3a8a;
    letter-spacing: -0.5px;
  }
  .company-name span { color: #15B8A6; }
  .company-sub { font-size: 9pt; color: #64748b; margin-top: 2px; }
  .ref-date { text-align: right; font-size: 10pt; color: #475569; }

  /* Body */
  .recipient-block { margin-bottom: 20px; }
  .subject-line { font-weight: 700; text-decoration: underline; margin: 20px 0 16px; font-size: 12pt; }
  p { margin-bottom: 12px; text-align: justify; }

  /* Details table */
  .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  .details-table td { padding: 6px 10px; border: 1px solid #d1d5db; font-size: 11pt; }
  .details-table td:first-child { width: 40%; font-weight: 600; background: #f8fafc; }

  /* Compensation box */
  .comp-box {
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 14px 16px;
    margin: 16px 0;
    background: #f8fafc;
    white-space: pre-wrap;
    font-size: 11pt;
  }
  .comp-label { font-weight: 700; margin-bottom: 6px; }

  /* Signature */
  .signature-block { margin-top: 40px; }
  .sig-line { border-top: 1px solid #1a1a1a; width: 200px; margin-top: 40px; padding-top: 6px; font-size: 10pt; }
  .acceptance { margin-top: 48px; border-top: 1px dashed #94a3b8; padding-top: 20px; }

  @media print {
    body { padding: 0; }
    .page { padding: 24px 36px; }
    @page { margin: 10mm 15mm; size: A4; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Letterhead -->
  <div class="letterhead">
    <div>
      <div class="company-name">${opts.companyName}<span> ✦</span></div>
      <div class="company-sub">Human Resources Department</div>
    </div>
    <div class="ref-date">
      <div>Ref: ${opts.refNo}</div>
      <div>Date: ${opts.date}</div>
    </div>
  </div>

  <!-- Recipient -->
  <div class="recipient-block">
    <strong>${opts.candidateName}</strong><br/>
    [Candidate Address]<br/>
    [City, State]
  </div>

  <!-- Subject -->
  <div class="subject-line">
    Subject: Letter of Offer — ${opts.jobTitle}
  </div>

  <!-- Body -->
  <p>Dear ${opts.firstName},</p>

  <p>
    We are pleased to inform you that following your interaction with our recruitment team,
    we are delighted to extend this offer of employment for the position of
    <strong>${opts.jobTitle}</strong> at <strong>${opts.companyName}</strong>.
  </p>

  <!-- Details table -->
  <table class="details-table">
    <tr><td>Designation</td><td>${opts.jobTitle}</td></tr>
    <tr><td>Department</td><td>${opts.department || '—'}</td></tr>
    <tr><td>Employment Type</td><td>Full-Time, Permanent</td></tr>
    <tr><td>Date of Joining</td><td>${opts.startDate || '[To be confirmed]'}</td></tr>
    <tr><td>Reporting Location</td><td>[Office / Remote — to be confirmed]</td></tr>
  </table>

  <!-- Compensation -->
  ${opts.compensation ? `
  <p><strong>Compensation &amp; Benefits:</strong></p>
  <div class="comp-box">
    <div class="comp-label">CTC / Remuneration Details</div>
    ${opts.compensation.replace(/\n/g, '<br/>')}
  </div>` : `
  <p>
    The compensation structure, benefits, and other remuneration details will be
    communicated to you separately or form part of your appointment letter upon joining.
  </p>`}

  <!-- Standard terms -->
  <p>
    This offer is contingent upon successful completion of any background verification and
    reference checks as per company policy, and the submission of all required documents
    on or before your date of joining.
  </p>
  <p>
    A probation period of <strong>6 (six) months</strong> will apply from your date of joining,
    during which either party may terminate the employment with a notice period of
    <strong>7 (seven) calendar days</strong>. Post-confirmation, the notice period shall be
    as per the appointment letter.
  </p>
  <p>
    You will be required to maintain strict confidentiality regarding all information,
    processes, and data pertaining to ${opts.companyName} and its clients.
  </p>

  ${opts.extraTerms ? `<p>${opts.extraTerms.replace(/\n/g, '<br/>')}</p>` : ''}

  <p>
    Kindly sign and return a copy of this letter as your acceptance of this offer
    within <strong>5 (five) working days</strong> from the date of this letter.
  </p>
  <p>We look forward to welcoming you to the ${opts.companyName} family.</p>

  <!-- Signature -->
  <div class="signature-block">
    <p>Yours sincerely,</p>
    <div class="sig-line">
      Authorised Signatory<br/>
      Human Resources<br/>
      ${opts.companyName}
    </div>
  </div>

  <!-- Acceptance section -->
  <div class="acceptance">
    <p><strong>Acceptance of Offer</strong></p>
    <p>
      I, <strong>${opts.candidateName}</strong>, accept the offer of employment as
      <strong>${opts.jobTitle}</strong> at <strong>${opts.companyName}</strong> on the
      terms and conditions set out above.
    </p>
    <div style="display:flex;gap:80px;margin-top:36px;">
      <div class="sig-line">Candidate Signature</div>
      <div class="sig-line">Date</div>
    </div>
  </div>

</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OfferLetterDialog({
  appId,
  open,
  onOpenChange,
}: {
  appId:          string | null
  open:           boolean
  onOpenChange:   (v: boolean) => void
}) {
  const [startDate,    setStartDate]    = useState('')
  const [joiningDate,  setJoiningDate]  = useState('')   // YYYY-MM-DD — drives the persisted offer
  const [offeredAmount, setOfferedAmount] = useState('') // annual CTC (number)
  const [validUntil,   setValidUntil]   = useState('')
  const [compensation, setCompensation] = useState('')
  const [extraTerms,   setExtraTerms]   = useState('')
  const [sending,      setSending]      = useState(false)
  const qc = useQueryClient()

  const { data: res, isLoading } = useQuery<{ data: OfferData }>({
    queryKey: ['recruitment', 'offer', appId],
    queryFn:  () => api.get(`/recruitment/offers/${appId}`),
    enabled:  !!appId && open,
  })

  const offer = res?.data

  function handlePrint() {
    if (!offer) return
    const today = new Date().toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    const refNo = `OL/${new Date().getFullYear()}/${offer.id.slice(0, 8).toUpperCase()}`
    const html = buildOfferHtml({
      companyName:   offer.company_name,
      candidateName: offer.candidate_name,
      firstName:     offer.first_name,
      jobTitle:      offer.job_title,
      department:    offer.department,
      startDate,
      compensation,
      extraTerms,
      refNo,
      date: today,
    })
    const win = window.open('', '_blank', 'width=860,height=1000')
    if (!win) { toast.error('Pop-up blocked — please allow pop-ups for this site'); return }
    win.document.write(html)
    win.document.close()
  }

  async function handleSendEmail() {
    if (!offer?.candidate_email) { toast.error('No candidate email on file'); return }
    setSending(true)
    try {
      // Build the letter HTML for email
      const today = new Date().toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
      const refNo = `OL/${new Date().getFullYear()}/${offer.id.slice(0, 8).toUpperCase()}`
      const html = buildOfferHtml({
        companyName:   offer.company_name,
        candidateName: offer.candidate_name,
        firstName:     offer.first_name,
        jobTitle:      offer.job_title,
        department:    offer.department,
        startDate,
        compensation,
        extraTerms,
        refNo,
        date: today,
      })
      await api.post(`/recruitment/offers/${appId}/send`, {
        letter_html: html,
        recipient_email: offer.candidate_email,
        candidate_name:  offer.candidate_name,
        job_title:       offer.job_title,
        company_name:    offer.company_name,
        offered_amount:  offeredAmount ? Number(offeredAmount) : undefined,
        joining_date:    joiningDate || undefined,
        valid_until:     validUntil || undefined,
      })
      toast.success(
        joiningDate && offeredAmount
          ? `Offer sent to ${offer.candidate_email} — they can accept it from their candidate portal`
          : `Offer letter sent to ${offer.candidate_email}`,
      )
      qc.invalidateQueries({ queryKey: ['recruitment', 'offer', appId] })
      onOpenChange(false)
    } catch {
      toast.error('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Generate Offer Letter
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : offer ? (
          <div className="space-y-5 py-2">
            {/* Candidate summary */}
            <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-0.5">
              <p className="font-semibold text-base">{offer.candidate_name}</p>
              <p className="text-muted-foreground">{offer.job_title}{offer.department ? ` · ${offer.department}` : ''}</p>
              <p className="text-muted-foreground text-xs">{offer.company_name}</p>
            </div>

            {/* Offer status (once sent) */}
            {offer?.offer && (
              <div className={`rounded-md px-3 py-2 text-xs font-medium ${
                offer.offer.status === 'accepted' ? 'bg-success/10 text-success'
                : offer.offer.status === 'declined' ? 'bg-destructive/10 text-destructive'
                : 'bg-info/10 text-info'}`}>
                Offer {offer.offer.status}
                {offer.offer.status === 'accepted' && ' — onboarding has been triggered for this candidate.'}
              </div>
            )}

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Date of Joining <span className="text-muted-foreground font-normal">(shown in letter)</span></Label>
                <Input
                  placeholder="e.g. 1st July 2026"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Annual CTC (₹) <span className="text-muted-foreground font-normal">(for tracking)</span></Label>
                <Input
                  type="number"
                  placeholder="e.g. 1200000"
                  value={offeredAmount}
                  onChange={e => setOfferedAmount(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Joining date <span className="text-muted-foreground font-normal">(for tracking)</span></Label>
                <Input
                  type="date"
                  value={joiningDate}
                  onChange={e => setJoiningDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Offer valid until <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="date"
                  value={validUntil}
                  onChange={e => setValidUntil(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Compensation Details <span className="text-muted-foreground font-normal">(optional — appears in letter)</span></Label>
                <Textarea
                  placeholder={"e.g.\nAnnual CTC: ₹12,00,000\nBasic: ₹5,00,000 p.a.\nHRA: ₹2,00,000 p.a.\nOther allowances: ₹5,00,000 p.a."}
                  value={compensation}
                  onChange={e => setCompensation(e.target.value)}
                  rows={4}
                  className="text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Additional Terms <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  placeholder="Any additional clauses or conditions specific to this offer…"
                  value={extraTerms}
                  onChange={e => setExtraTerms(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>

            {/* Preview notice */}
            <p className="text-xs text-muted-foreground bg-info/10 text-info rounded-md px-3 py-2">
              Click <strong>Print / Save as PDF</strong> to open the letter in a new window — use your browser's "Save as PDF" option in the print dialog.
              <br />Items in [brackets] are placeholders to fill in before printing.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">Could not load offer data.</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {offer && (
            <>
              <Button
                variant="outline"
                onClick={handleSendEmail}
                disabled={sending || !offer.candidate_email}
                title={offer.candidate_email ? `Send to ${offer.candidate_email}` : 'No candidate email on file'}
              >
                {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send by Email
              </Button>
              <Button onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print / Save as PDF
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
