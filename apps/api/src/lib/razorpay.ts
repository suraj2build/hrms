/**
 * Razorpay client + config helpers.
 *
 * Billing is OPTIONAL: when RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are absent the
 * app runs normally and the billing endpoints report `configured: false`.
 * Secrets live only on the backend; the frontend gets only the public key id.
 * See BILLING.md for setup.
 */
import Razorpay from 'razorpay'

const KEY_ID     = process.env.RAZORPAY_KEY_ID
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET

export const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET
/** Public key id is safe to expose to the browser checkout widget. */
export const PUBLIC_KEY_ID  = KEY_ID ?? null

/** Razorpay plan ids per subscription tier (created in the Razorpay dashboard). */
export const PLAN_IDS: Record<string, string | undefined> = {
  standard:   process.env.RAZORPAY_PLAN_STANDARD,
  enterprise: process.env.RAZORPAY_PLAN_ENTERPRISE,
}

export function isBillingConfigured(): boolean {
  return Boolean(KEY_ID && KEY_SECRET)
}

let client: Razorpay | null = null
export function getRazorpay(): Razorpay {
  if (!isBillingConfigured()) throw new Error('Razorpay is not configured')
  if (!client) client = new Razorpay({ key_id: KEY_ID!, key_secret: KEY_SECRET! })
  return client
}
