import { Link } from "react-router-dom";

/**
 * CognixHR brand logo — renders the canonical brand artwork from
 * /public/brand (icon + wordmark) so it matches the official mark exactly.
 * Pass variant="dark" on dark surfaces to swap in the white wordmark.
 */
export function Logo({ variant = "light", showTag = true }: { variant?: "light" | "dark"; showTag?: boolean }) {
  const wordmark = variant === "dark" ? "/brand/cognixhr-wordmark-light.png" : "/brand/cognixhr-wordmark.png";
  const tag = variant === "dark" ? "text-white/60" : "text-muted-foreground";
  return (
    <Link to="/" className="group inline-flex items-center gap-2.5">
      <img
        src="/brand/cognixhr-icon.png"
        alt="CognixHR"
        width={36}
        height={36}
        className="h-9 w-9 shrink-0"
        draggable={false}
      />
      <span className="flex flex-col leading-none">
        <img
          src={wordmark}
          alt="CognixHR"
          className="h-[18px] w-auto"
          draggable={false}
        />
        {showTag && (
          <span className={`mt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] ${tag}`}>
            a Saar product
          </span>
        )}
      </span>
    </Link>
  );
}
