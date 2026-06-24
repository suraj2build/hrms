import { useDemoModal } from "./DemoModal";
import { Button } from "@/components/ui/button";
import { ArrowRight, ExternalLink } from "lucide-react";

export function DemoButtons({
  source,
  align = "start",
  inverse = false,
}: {
  source: string;
  align?: "start" | "center";
  inverse?: boolean;
}) {
  const { open } = useDemoModal();
  return (
    <div className={`flex flex-wrap items-center gap-3 ${align === "center" ? "justify-center" : ""}`}>
      <Button
        size="lg"
        onClick={() => open(source)}
        className="btn-brand h-12 rounded-full px-6 text-base font-semibold"
      >
        Book a Demo
        <ArrowRight className="ml-1 h-4 w-4" />
      </Button>

      <a
        href="https://hrms-web-alpha.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex h-12 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors ${
          inverse
            ? "border-white/30 bg-white/10 text-white hover:bg-white/20"
            : "border-border bg-card text-foreground hover:bg-muted"
        }`}
      >
        Try the Live Demo <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}
