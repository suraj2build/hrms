import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LeaveBalance {
  leave_type: string;
  balance: number;
  used: number;
  total: number;
}

interface Employee360Data {
  employee_id: string;
  joining_date?: string | null;
  compliance?: {
    status?: string | null;
    probation_due?: boolean | null;
    separation_stage?: string | null;
    assets_assigned?: number | null;
  } | null;
  onboarding?: {
    status?: string | null;
    completion_percentage?: number | null;
  } | null;
  leave_balances?: LeaveBalance[] | null;
  ai_summary?: string | null;
  sources?: string[] | null;
}

function calcTenure(joiningDate: string): { days: number; months: number } {
  const joined = new Date(joiningDate);
  const now = new Date();
  const diffMs = now.getTime() - joined.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  return { days, months };
}

function complianceVariant(
  status?: string | null
): "default" | "secondary" | "destructive" | "outline" {
  if (!status) return "outline";
  const s = status.toLowerCase();
  if (s === "compliant" || s === "ok" || s === "good") return "default";
  if (s === "warning" || s === "pending") return "secondary";
  if (s === "non-compliant" || s === "critical") return "destructive";
  return "outline";
}

export function Employee360Tab({ employeeId }: { employeeId: string }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery<Employee360Data>({
    queryKey: ["employee-360", employeeId],
    queryFn: async () => {
      const response = await api.get<{ data: Employee360Data }>(
        `/intelligence/employee/${employeeId}/360`
      );
      return response.data;
    },
    enabled: !!employeeId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading intelligence data...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-12 text-destructive text-sm">
        Failed to load 360 data:{" "}
        {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        No intelligence data available.
      </div>
    );
  }

  const tenure =
    data.joining_date ? calcTenure(data.joining_date) : null;

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="rounded-lg bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 px-5 py-3">
        <h2 className="text-base font-semibold text-white tracking-wide">
          Profile Intelligence
        </h2>
        <p className="text-xs text-white/70 mt-0.5">
          AI-powered 360 view for this employee
        </p>
      </div>

      {/* Compliance section */}
      {data.compliance && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Compliance</h3>
          <div className="flex flex-wrap gap-3 items-center">
            {data.compliance.status != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Status:</span>
                <Badge variant={complianceVariant(data.compliance.status)}>
                  {data.compliance.status}
                </Badge>
              </div>
            )}
            {data.compliance.probation_due != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Probation Due:
                </span>
                <Badge
                  variant={
                    data.compliance.probation_due ? "destructive" : "default"
                  }
                >
                  {data.compliance.probation_due ? "Yes" : "No"}
                </Badge>
              </div>
            )}
            {data.compliance.separation_stage != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Separation Stage:
                </span>
                <Badge variant="secondary">
                  {data.compliance.separation_stage}
                </Badge>
              </div>
            )}
            {data.compliance.assets_assigned != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Assets Assigned:
                </span>
                <Badge variant="outline">
                  {data.compliance.assets_assigned}
                </Badge>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tenure badge */}
      {tenure && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Tenure
          </h3>
          <Badge variant="outline" className="text-sm px-3 py-1">
            {tenure.days} days &nbsp;/&nbsp; {tenure.months} months with
            company
          </Badge>
        </div>
      )}

      {/* Onboarding status */}
      {data.onboarding && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Onboarding</h3>
          <div className="flex flex-wrap gap-3 items-center">
            {data.onboarding.status != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Status:</span>
                <Badge variant="secondary">{data.onboarding.status}</Badge>
              </div>
            )}
            {data.onboarding.completion_percentage != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Completion:
                </span>
                <Badge variant="outline">
                  {data.onboarding.completion_percentage}%
                </Badge>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Leave balances */}
      {data.leave_balances && data.leave_balances.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Leave Balances
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-1.5 pr-4 font-medium">
                    Leave Type
                  </th>
                  <th className="text-right py-1.5 px-3 font-medium">Total</th>
                  <th className="text-right py-1.5 px-3 font-medium">Used</th>
                  <th className="text-right py-1.5 pl-3 font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.leave_balances.map((lb, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-foreground">
                      {lb.leave_type}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {lb.total}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {lb.used}
                    </td>
                    <td className="py-2 pl-3 text-right font-medium text-foreground">
                      {lb.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Summary */}
      {data.ai_summary && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">AI Summary</h3>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {data.ai_summary}
          </p>

          {/* Why this summary expandable */}
          {data.sources && data.sources.length > 0 && (
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setSourcesOpen((prev) => !prev)}
              >
                {sourcesOpen ? "Hide" : "Why this summary?"}
                <span className="ml-1">{sourcesOpen ? "▲" : "▼"}</span>
              </Button>
              {sourcesOpen && (
                <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Sources used to generate this summary:
                  </p>
                  <ul className="space-y-1">
                    {data.sources.map((src, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-foreground flex items-start gap-1.5"
                      >
                        <span className="text-muted-foreground mt-0.5">
                          {idx + 1}.
                        </span>
                        <span>{src}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
