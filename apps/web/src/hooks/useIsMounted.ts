/**
 * useIsMounted — safe unmount guard for async callbacks.
 *
 * Returns a ref whose `.current` is `true` while the component is mounted
 * and `false` after it unmounts. Use this to guard `setState` calls inside
 * Promise continuations or `setTimeout` callbacks that may outlive the component.
 *
 * Usage:
 *   const isMounted = useIsMounted()
 *   somePromise.then(data => {
 *     if (!isMounted.current) return   // component already unmounted
 *     setData(data)
 *   })
 *
 * NOTE: React Query mutations and queries do NOT need this guard — their
 * callbacks run inside the query client which is already lifecycle-safe.
 * Only apply this to raw Promise chains, setTimeout, or setInterval handlers
 * that call local `useState` setters directly.
 */
import { useRef, useEffect } from 'react'

export function useIsMounted(): React.RefObject<boolean> {
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  return isMounted
}
