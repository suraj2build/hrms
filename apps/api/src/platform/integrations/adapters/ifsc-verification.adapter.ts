/**
 * IfscVerificationAdapter — calls Razorpay's free IFSC API.
 *
 * GET https://ifsc.razorpay.com/{IFSC}
 * No authentication required.
 * Returns: { BANK, BRANCH, ADDRESS, CITY, DISTRICT, STATE, CONTACT, UPI, RTGS, ... }
 *
 * Gracefully degrades if network fails.
 */

import type { IntegrationAdapterResult } from '../types/integration-types.js'
import { getIntegrationConfig } from '../config/integration-config.js'

export interface IfscDetails {
  bank:     string
  branch:   string
  city:     string
  district: string
  state:    string
  upi:      boolean
  rtgs:     boolean
  imps:     boolean
}

export class IfscVerificationAdapter {
  async lookup(ifsc: string): Promise<IntegrationAdapterResult<IfscDetails>> {
    const config = getIntegrationConfig('razorpay_ifsc')

    if (!config.enabled) {
      return {
        provider: 'razorpay_ifsc',
        status:   'not_configured',
        source:   'local',
        error:    'Razorpay IFSC lookup is disabled (RAZORPAY_IFSC_DISABLED=true)',
      }
    }

    const normalised = ifsc.toUpperCase().trim()
    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeout_ms)

    try {
      const response = await fetch(
        `${config.base_url}/${encodeURIComponent(normalised)}`,
        { signal: controller.signal },
      )

      clearTimeout(timer)
      const latency_ms = Date.now() - start

      if (response.status === 404) {
        return {
          provider:   'razorpay_ifsc',
          status:     'error',
          source:     'external',
          error:      `IFSC '${normalised}' not found`,
          latency_ms,
        }
      }

      if (!response.ok) {
        return {
          provider:   'razorpay_ifsc',
          status:     'error',
          source:     'external',
          error:      `Razorpay IFSC API returned HTTP ${response.status}`,
          latency_ms,
        }
      }

      const json = await response.json() as {
        BANK?:     string
        BRANCH?:   string
        CITY?:     string
        DISTRICT?: string
        STATE?:    string
        UPI?:      boolean
        RTGS?:     boolean
        IMPS?:     boolean
      }

      return {
        provider:   'razorpay_ifsc',
        status:     'active',
        source:     'external',
        latency_ms,
        data: {
          bank:     json.BANK     ?? '',
          branch:   json.BRANCH   ?? '',
          city:     json.CITY     ?? '',
          district: json.DISTRICT ?? '',
          state:    json.STATE    ?? '',
          upi:      json.UPI      ?? false,
          rtgs:     json.RTGS     ?? false,
          imps:     json.IMPS     ?? false,
        },
      }
    } catch (err: unknown) {
      clearTimeout(timer)
      const latency_ms = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      return {
        provider:   'razorpay_ifsc',
        status:     'error',
        source:     'external',
        error:      message,
        latency_ms,
      }
    }
  }
}

export const ifscVerificationAdapter = new IfscVerificationAdapter()
