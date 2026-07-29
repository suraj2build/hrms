/**
 * ssrf-guard — block server-side requests to private / internal / loopback
 * hosts before issuing an outbound fetch to a user-supplied URL.
 *
 * Used by the integration health-check, which probes an admin-registered
 * endpoint_url. Without this, an admin could point it at cloud metadata
 * (169.254.169.254), localhost, or internal-only services (SSRF).
 *
 * Note: this is a best-effort hostname/literal-IP check. It does NOT fully
 * defeat DNS-rebinding (a hostname that resolves to a public IP at check time
 * and a private IP at fetch time). For that, resolve+pin the IP and fetch by
 * IP, or run egress through a vetted proxy. This covers the common cases:
 * literal private IPs, loopback, link-local, and obvious internal names.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  'metadata.google.internal',
])

function ipToLong(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const o = Number(p)
    if (!Number.isInteger(o) || o < 0 || o > 255) return null
    n = n * 256 + o
  }
  return n >>> 0
}

function isPrivateIPv4(ip: string): boolean {
  const long = ipToLong(ip)
  if (long === null) return false
  const inRange = (a: string, b: string) => long >= ipToLong(a)! && long <= ipToLong(b)!
  return (
    inRange('10.0.0.0', '10.255.255.255') ||       // private
    inRange('172.16.0.0', '172.31.255.255') ||     // private
    inRange('192.168.0.0', '192.168.255.255') ||   // private
    inRange('127.0.0.0', '127.255.255.255') ||     // loopback
    inRange('169.254.0.0', '169.254.255.255') ||   // link-local (incl. cloud metadata)
    inRange('100.64.0.0', '100.127.255.255') ||    // CGNAT
    inRange('0.0.0.0', '0.255.255.255')            // "this" network
  )
}

/**
 * Returns null if the URL is safe to fetch, or a string reason if it should be
 * blocked. Only http/https to public hosts are permitted.
 */
export function ssrfCheck(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'Invalid URL'
  }
  if (!['http:', 'https:'].includes(url.protocol)) return 'Only http/https is allowed'

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    return 'Host is not allowed'
  }
  // Literal IPv4 → range-check
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) return 'Private/internal IP is not allowed'
  }
  // IPv6 loopback / link-local / unique-local
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      return 'Private/internal IPv6 is not allowed'
    }
    // IPv4-mapped IPv6 (::ffff:a.b.c.d, or fully-expanded 0:0:0:0:0:ffff:a.b.c.d)
    // contains a colon, so it would otherwise skip the dotted-quad range check
    // above entirely and pass through as "safe" — e.g. ::ffff:169.254.169.254
    // reaching cloud metadata. Extract the embedded IPv4 and range-check it too.
    const v4Mapped = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i)
    if (v4Mapped && isPrivateIPv4(v4Mapped[1])) {
      return 'Private/internal IP is not allowed'
    }
  }
  // Internal-only TLDs / single-label hostnames
  if (!host.includes('.') || host.endsWith('.internal') || host.endsWith('.local')) {
    return 'Internal hostname is not allowed'
  }
  return null
}
