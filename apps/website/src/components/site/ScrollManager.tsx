import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * On a route change, scroll to the top — unless the URL carries a hash, in
 * which case scroll the matching section into view (mirrors the in-page anchor
 * behaviour the TanStack build had via scrollRestoration).
 */
export function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, hash]);

  return null;
}
