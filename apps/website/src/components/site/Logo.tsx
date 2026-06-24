import { Link } from "react-router-dom";

export function Logo({ variant = "light", showTag = true }: { variant?: "light" | "dark"; showTag?: boolean }) {
  const cognix = variant === "dark" ? "text-white" : "text-foreground";
  const hr = variant === "dark" ? "text-[#2DD4BF]" : "text-[#15B8A6]";
  const tag = variant === "dark" ? "text-white/60" : "text-muted-foreground";
  return (
    <Link to="/" className="group inline-flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2E6FE6] to-[#15B8A6] text-white font-bold shadow-soft">
        C
      </span>
      <span className="flex flex-col leading-none">
        <span className={`text-xl font-bold tracking-tight ${cognix}`}>
          Cognix<span className={hr}>HR</span>
        </span>
        {showTag && (
          <span className={`mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${tag}`}>
            a Saar product
          </span>
        )}
      </span>
    </Link>
  );
}
