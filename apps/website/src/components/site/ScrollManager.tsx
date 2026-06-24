import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Height of the fixed top nav (h-16 = 64px) plus a little breathing room, so a
// section scrolled to via #hash doesn't hide behind the nav bar.
const NAV_OFFSET = 80;

/**
 * On a route change, scroll to the top — unless the URL carries a hash, in
 * which case scroll the matching section into view. This is what lets the
 * "Modules / Analytics / AI" links work from the /pricing page: clicking them
 * routes to "/#section", and this manager scrolls to that section once home
 * has mounted. Mirrors the scrollRestoration the original TanStack build had.
 */
export function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));

      // The target section may mount a frame after the route swaps, so retry a
      // few animation frames before giving up.
      let tries = 0;
      let raf = 0;
      const tryScroll = () => {
        const el = document.getElementById(id);
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
          window.scrollTo({ top, behavior: "smooth" });
          return;
        }
        if (tries++ < 10) raf = requestAnimationFrame(tryScroll);
      };
      raf = requestAnimationFrame(tryScroll);
      return () => cancelAnimationFrame(raf);
    }

    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, hash]);

  return null;
}
