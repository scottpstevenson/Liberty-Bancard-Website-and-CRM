/**
 * MI-08: Budget Preview Modal
 * Non-dismissible confirmation modal that appears before any paid enrichment
 * action (Apollo Reveal, bulk paid enrichment, billable ZeroBounce trigger).
 *
 * - Shows provider plan from selectCro03Route() routing-preview endpoint.
 * - Shows settled amounts from CRO-03C price schedules where available.
 * - Displays "unknown" when authoritative pricing or remaining budget is
 *   unavailable — never fabricates dollar estimates.
 * - Is a confirmation step ONLY — the paid action still passes all existing
 *   command/eligibility/approval/budget gates after confirmation.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, DollarSign, Zap } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutePlan {
  policyVersion: number;
  providers: string[];
  stopReasons: string[];
  recipes: Array<{ provider: string; operation: string; requiresPaidEligibility: boolean }>;
}

interface RoutingPreviewResponse {
  businessId: number;
  businessName: string;
  routingInput: {
    hasWebsite: boolean; hasPhone: boolean; hasEmail: boolean;
    needsBusinessDiscovery: boolean; needsContactEnrichment: boolean; needsEmailValidation: boolean;
  };
  routePlan: RoutePlan;
}

interface BudgetPreviewResponse {
  available: boolean;
  prices?: Array<{
    provider: string;
    version: number;
    unitType: string | null;
    currency: string | null;
    amountMicros: number | null;
    billingSemantics: string | null;
  }>;
}

export type PaidActionType = "apollo_reveal" | "bulk_paid_enrichment" | "zerobounce_validation";

interface BudgetPreviewModalProps {
  open: boolean;
  businessId: number;
  businessName?: string;
  actionType: PaidActionType;
  /** Called when the operator confirms the paid action. */
  onConfirm: () => void;
  /** Called when the operator cancels. */
  onCancel: () => void;
}

const ACTION_LABELS: Record<PaidActionType, string> = {
  apollo_reveal:        "Apollo Reveal",
  bulk_paid_enrichment: "Bulk Paid Enrichment",
  zerobounce_validation:"ZeroBounce Validation",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function BudgetPreviewModal({
  open, businessId, businessName, actionType, onConfirm, onCancel,
}: BudgetPreviewModalProps) {
  const routingQuery = useQuery<RoutingPreviewResponse>({
    queryKey: [`/api/lead-ops/businesses/${businessId}/routing-preview`],
    queryFn: async () => {
      const r = await fetch(`/api/lead-ops/businesses/${businessId}/routing-preview`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open && !!businessId,
    staleTime: 0,  // always fresh before spend approval
  });

  const plan = routingQuery.data?.routePlan;
  const budgetQuery = useQuery<BudgetPreviewResponse>({
    queryKey: ["/api/lead-ops/budget-preview"],
    queryFn: async () => {
      const r = await fetch("/api/lead-ops/budget-preview", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open,
    staleTime: 0,
  });
  // Map actionType to the canonical provider name in the price schedule.
  // We must show pricing for the SPECIFIC action being confirmed, not the
  // routing plan's next provider (which may differ — e.g. routing selects
  // Apollo when main_email is absent, but the action being confirmed is ZeroBounce).
  const ACTION_TO_PROVIDER: Record<string, string> = {
    zerobounce_validation: "zerobounce",
    apollo_reveal: "apollo",
    bulk_paid_enrichment: "apollo",
  };
  const targetProvider = ACTION_TO_PROVIDER[actionType] ?? null;
  const actionPrice = targetProvider
    ? budgetQuery.data?.prices?.find((p) => p.provider === targetProvider) ?? null
    : null;
  const hasEstimate = budgetQuery.data?.available === true && actionPrice !== null && (actionPrice.amountMicros ?? 0) > 0;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-amber-500" />
            Confirm Paid Action — {ACTION_LABELS[actionType]}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left">
              {businessName && (
                <p className="text-sm text-muted-foreground">
                  Business: <span className="font-medium text-foreground">{businessName}</span>
                </p>
              )}

              {/* Routing plan */}
              <div className="rounded-md border bg-muted/10 p-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Provider Plan
                </div>
                {routingQuery.isLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : routingQuery.isError ? (
                  <p className="text-xs text-red-500">Could not load routing plan</p>
                ) : plan ? (
                  <div className="space-y-1.5">
                    {plan.recipes.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Zap className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        <span className="font-medium capitalize">{r.provider}</span>
                        <span className="text-muted-foreground">— {r.operation.replace(/_/g, " ")}</span>
                        {r.requiresPaidEligibility && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-amber-600 border-amber-300" aria-label="Requires paid eligibility">
                            paid
                          </Badge>
                        )}
                      </div>
                    ))}
                    {plan.providers.length === 0 && (
                      <p className="text-xs text-muted-foreground">No providers required — existing evidence is sufficient.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No plan available</p>
                )}
              </div>

              {/* Cost estimate — priced for the SPECIFIC action being confirmed,
                  not the routing-plan providers (which may differ). */}
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-3 space-y-1">
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                  Estimated Cost — {ACTION_LABELS[actionType]}
                </div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300" aria-label={hasEstimate ? `Estimated cost for ${actionType} from CRO-03C price schedules` : `Cost unknown — ${targetProvider ?? actionType} not found in approved pricing policy`}>
                  {hasEstimate
                    ? `${((actionPrice!.amountMicros ?? 0) / 1_000_000).toFixed(4)} ${actionPrice!.currency ?? "USD"} / ${actionPrice!.unitType ?? "unit"}`
                    : "unknown"}
                </p>
                {budgetQuery.data?.available === false && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    No approved CRO-03C activation policy (policy_key=cro03c_live_activation) found. Cost cannot be verified.
                  </p>
                )}
                {budgetQuery.data?.available === true && !actionPrice && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    Provider <code className="font-mono">{targetProvider}</code> not in the active price schedule. Cost unknown.
                  </p>
                )}
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  The action passes all existing budget gates server-side after confirmation.
                </p>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This confirmation is a UX checkpoint only. All existing command, eligibility, 
                  approval, and budget gates are enforced server-side regardless of this modal.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={routingQuery.isLoading}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            Confirm {ACTION_LABELS[actionType]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Hook for managing budget modal state ─────────────────────────────────────

export function useBudgetPreview() {
  const [state, setState] = useState<{
    open: boolean;
    businessId: number;
    businessName?: string;
    actionType: PaidActionType;
    pendingAction: (() => void) | null;
  }>({
    open: false,
    businessId: 0,
    actionType: "apollo_reveal",
    pendingAction: null,
  });

  /**
   * Show the budget preview modal before executing a paid action.
   * If the operator cancels, `onCancel` is called (optional).
   */
  function requireBudgetConfirmation(params: {
    businessId: number;
    businessName?: string;
    actionType: PaidActionType;
    action: () => void;
    onCancel?: () => void;
  }) {
    setState({
      open: true,
      businessId: params.businessId,
      businessName: params.businessName,
      actionType: params.actionType,
      pendingAction: params.action,
    });
  }

  function handleConfirm() {
    const fn = state.pendingAction;
    setState(s => ({ ...s, open: false, pendingAction: null }));
    fn?.();
  }

  function handleCancel() {
    setState(s => ({ ...s, open: false, pendingAction: null }));
  }

  return { state, requireBudgetConfirmation, handleConfirm, handleCancel };
}
