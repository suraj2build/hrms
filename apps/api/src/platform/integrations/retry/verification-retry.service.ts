type VerificationType = 'pan' | 'bank_account' | 'aadhaar'

interface RetryEntry {
  employee_id:       string
  verification_type: VerificationType
  attempts:          number
  last_attempt_ms:   number
  next_retry_ms:     number
  last_error?:       string
  exhausted:         boolean
}

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 30_000   // 30s
const MAX_DELAY_MS  = 300_000  // 5min

export class VerificationRetryService {
  private readonly queue = new Map<string, RetryEntry>()

  private key(employeeId: string, type: VerificationType): string {
    return `${employeeId}:${type}`
  }

  private backoff(attempts: number): number {
    return Math.min(BASE_DELAY_MS * Math.pow(2, attempts - 1), MAX_DELAY_MS)
  }

  enqueue(employeeId: string, type: VerificationType, error: string): void {
    const k = this.key(employeeId, type)
    const existing = this.queue.get(k)
    if (existing?.exhausted) return  // do not re-enqueue exhausted entries

    const attempts = (existing?.attempts ?? 0) + 1
    const exhausted = attempts >= MAX_ATTEMPTS
    this.queue.set(k, {
      employee_id: employeeId, verification_type: type,
      attempts, last_attempt_ms: Date.now(),
      next_retry_ms: Date.now() + this.backoff(attempts),
      last_error: error, exhausted,
    })
  }

  dequeue(employeeId: string, type: VerificationType): void {
    this.queue.delete(this.key(employeeId, type))
  }

  getDueRetries(): RetryEntry[] {
    const now = Date.now()
    return [...this.queue.values()].filter(e => !e.exhausted && e.next_retry_ms <= now)
  }

  stats(): { total: number; pending: number; exhausted: number } {
    const all = [...this.queue.values()]
    return {
      total:     all.length,
      pending:   all.filter(e => !e.exhausted).length,
      exhausted: all.filter(e => e.exhausted).length,
    }
  }
}

export const verificationRetryService = new VerificationRetryService()
