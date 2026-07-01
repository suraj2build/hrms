/**
 * sanitizeHtml — minimal, dependency-free HTML sanitizer for rendering
 * server-generated letter HTML via dangerouslySetInnerHTML.
 *
 * Letters are authored by HR admins (trusted) and interpolated via Handlebars,
 * which already HTML-escapes employee data. This is defense-in-depth: it parses
 * the HTML with the browser's own parser (no regex) and strips anything that can
 * execute script — <script>/<style>/<iframe>/<object>/<embed>/<link>/<meta>,
 * on* event-handler attributes, and javascript:/data: URLs — while leaving
 * normal formatting/markup intact.
 *
 * For richer needs, swap this for DOMPurify; the call sites won't change.
 */

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const FORBIDDEN_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM',
])

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

function isUnsafeUrl(value: string): boolean {
  // Strip C0 control chars (\x00-\x1f) before the scheme check so obfuscated
  // payloads (e.g. "java\tscript:") cannot evade the URL filter — intentional.
  // eslint-disable-next-line no-control-regex
  const v = value.trim().toLowerCase().replace(/[\x00-\x1f]/g, '')
  return v.startsWith('javascript:') || v.startsWith('vbscript:') ||
    (v.startsWith('data:') && !v.startsWith('data:image/'))
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return ''
  // SSR / non-DOM guard — return empty rather than inject unsanitized markup.
  if (typeof document === 'undefined') return ''

  const doc = new DOMParser().parseFromString(dirty, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  const toRemove: Element[] = []

  let node = walker.nextNode() as Element | null
  while (node) {
    if (FORBIDDEN_TAGS.has(node.tagName)) {
      toRemove.push(node)
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name)
        } else if (URL_ATTRS.has(name) && isUnsafeUrl(attr.value)) {
          node.removeAttribute(attr.name)
        }
      }
    }
    node = walker.nextNode() as Element | null
  }

  toRemove.forEach(el => el.remove())
  return doc.body.innerHTML
}
