import { useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { getSignedUrl } from '@/lib/supabase-storage'

interface SignedImageProps {
  /** Storage path in the private bucket (e.g. "<tenant>/<emp>/photos/123.jpg") or a full http(s) URL. */
  path?:      string | null
  alt?:       string
  className?: string
  style?:     CSSProperties
  /** Rendered while resolving, when there's no path, or if the URL fails. */
  fallback?:  ReactNode
}

/**
 * Renders an image stored in the private `employee-files` bucket. The DB stores
 * the storage PATH (not a URL); this resolves a short-lived signed URL so the
 * image actually displays. Falls back gracefully if the path is missing/expired.
 * If `path` is already a full URL, it's used directly.
 */
export function SignedImage({ path, alt, className, style, fallback = null }: SignedImageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let active = true
    setUrl(null)
    setErrored(false)
    if (!path) return
    if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
      setUrl(path)
      return
    }
    getSignedUrl(path)
      .then(u => { if (active) setUrl(u) })
      .catch(() => { if (active) setErrored(true) })
    return () => { active = false }
  }, [path])

  if (!path || errored || !url) return <>{fallback}</>
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={style}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
    />
  )
}

export default SignedImage
