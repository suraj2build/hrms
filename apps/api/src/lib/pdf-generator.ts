/**
 * PDF Generator — renders absconding letters and payslips using PDFKit.
 * Uploads the result to Supabase Storage bucket 'generated-documents'.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// PDFKit is a CommonJS module; import dynamically to avoid ESM interop issues
async function getPDFKit() {
  const { default: PDFDocument } = await import('pdfkit')
  return PDFDocument
}

export interface LetterOptions {
  type:      'wl1' | 'wl2' | 'termination' | 'payslip'
  variables: Record<string, string | number>
  tenantId:  string
  refNumber: string
}

const LETTER_TITLES: Record<string, string> = {
  wl1:               'Warning Letter — First Notice',
  wl2:               'Warning Letter — Final Notice',
  termination:       'Notice of Employment Termination',
  payslip:           'Pay Slip',
}

const LETTER_BODIES: Record<string, (v: Record<string, string | number>) => string> = {
  wl1: (v) => `
Dear ${v.employee_name ?? 'Employee'},

This letter serves as a formal first warning regarding your unauthorised absence from work.

Our records indicate that you have been absent without prior approval or notification since ${v.absent_from_date ?? 'the date mentioned below'} — a total of ${v.absent_days ?? ''} consecutive working day(s).

This constitutes a serious breach of your employment contract and our attendance policy. You are requested to report to your designated workplace (${v.store_name ?? ''}) immediately or provide a satisfactory explanation within ${v.response_deadline ?? '48 hours'} of receiving this letter.

Failure to comply may result in further disciplinary action, up to and including termination of employment.

Reference Number: ${v.ref_number ?? ''}
Employee Code:   ${v.employee_code ?? ''}
Designation:     ${v.designation ?? ''}
Reporting Manager: ${v.manager_name ?? ''}

Please treat this matter with the utmost urgency.

Sincerely,
Human Resources Department
`,

  wl2: (v) => `
Dear ${v.employee_name ?? 'Employee'},

This letter constitutes your FINAL WARNING regarding continued unauthorised absence from work.

Despite our previous written notice (Reference: ${v.ref_number ?? ''}), you have remained absent for ${v.absent_days ?? ''} working day(s) since ${v.absent_from_date ?? ''} without providing any satisfactory explanation or reporting to duty.

You are hereby directed to report to ${v.store_name ?? 'your workplace'} or contact HR in writing within ${v.response_deadline ?? '24 hours'}. Non-compliance will result in immediate termination of your employment and initiation of recovery proceedings for any company assets.

Employee Code: ${v.employee_code ?? ''}
Designation:   ${v.designation ?? ''}

Regards,
Human Resources Department
`,

  termination: (v) => `
Dear ${v.employee_name ?? 'Employee'},

Following our previous notices dated ${v.absent_from_date ?? ''} regarding your unauthorised absence from work, and your failure to report to duty or provide any explanation, we regret to inform you that your employment with us is hereby terminated with immediate effect.

The effective date of termination is today. Your Full & Final Settlement will be processed in accordance with company policy and applicable labour laws. Any outstanding company assets must be returned within 7 days.

Employee Code: ${v.employee_code ?? ''}
Reference:     ${v.ref_number ?? ''}

Human Resources Department
`,

  payslip: (v) => `
Pay Slip — ${v.month ?? ''}

Employee:  ${v.employee_name ?? ''}
Code:      ${v.employee_code ?? ''}
Designation: ${v.designation ?? ''}

Earnings:
  Basic Salary:       ${v.basic ?? 0}
  House Rent Allow.:  ${v.hra ?? 0}
  Special Allowance:  ${v.special_allowance ?? 0}
  Gross Earnings:     ${v.gross_earnings ?? 0}

Deductions:
  PF (Employee):      ${v.pf_employee ?? 0}
  ESI:                ${v.esi ?? 0}
  TDS:                ${v.tds ?? 0}
  Total Deductions:   ${v.total_deductions ?? 0}

NET PAY:             ${v.net_pay ?? 0}
`,
}

/** Generate a PDF buffer for an absconding letter or payslip. */
export async function generateLetterPDF(opts: LetterOptions): Promise<Buffer> {
  const PDFDocument = await getPDFKit()
  const title = LETTER_TITLES[opts.type] ?? 'CognixHR Document'
  const body  = (LETTER_BODIES[opts.type] ?? (() => ''))(opts.variables)

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 60 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end',  () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Header
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('CognixHR', { align: 'center' })
      .fontSize(10)
      .font('Helvetica')
      .text('Smarter Workforce. Stronger Future.', { align: 'center' })
      .moveDown(0.5)
      .moveTo(60, doc.y).lineTo(550, doc.y).stroke()
      .moveDown(0.5)

    // Date
    doc
      .fontSize(10)
      .text(`Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'right' })
      .moveDown(0.5)

    // Title
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(title, { align: 'center' })
      .moveDown(0.5)

    // Body
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(body.trim(), { lineGap: 4 })

    // Footer
    doc
      .moveDown(2)
      .moveTo(60, doc.y).lineTo(550, doc.y).stroke()
      .moveDown(0.3)
      .fontSize(8)
      .fillColor('grey')
      .text(
        `Generated by CognixHR — Ref: ${opts.refNumber}`,
        { align: 'center' },
      )

    doc.end()
  })
}

/** Upload PDF buffer to Supabase Storage; returns the signed URL. */
export async function uploadPDF(
  buffer: Buffer,
  storagePath: string,
  supabase: SupabaseClient,
): Promise<string> {
  const { error: upErr } = await supabase.storage
    .from('generated-documents')
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert:      true,
    })

  if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`)

  const { data } = await supabase.storage
    .from('generated-documents')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365) // 1 year

  if (!data?.signedUrl) throw new Error('Failed to create signed URL')
  return data.signedUrl
}
