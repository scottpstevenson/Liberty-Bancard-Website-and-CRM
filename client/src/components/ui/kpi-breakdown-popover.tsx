import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtN } from "@/lib/format";

export interface KpiRow {
  label: string;
  value: number;
}

export interface KpiBreakdownPopoverProps {
  label: string;
  total: number;
  rows: KpiRow[];
  explanation?: string;
  overlapWarning?: string;
  loading?: boolean;
  triggerTestId?: string;
}

export function KpiBreakdownPopover({
  label,
  total: _total,
  rows,
  explanation,
  overlapWarning,
  loading,
  triggerTestId,
}: KpiBreakdownPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground cursor-help underline decoration-dotted bg-transparent border-0 p-0 font-normal"
          data-testid={triggerTestId}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="center">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-1 text-xs">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <span>{row.label}</span>
                <span className="font-medium">{fmtN(row.value)}</span>
              </div>
            ))}
            {(explanation || overlapWarning) && (
              <div className="border-t pt-1 mt-1 text-muted-foreground leading-tight space-y-1">
                {explanation && <p>{explanation}</p>}
                {overlapWarning && <p>{overlapWarning}</p>}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
