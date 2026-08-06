import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Zap, Play, Pause, ChevronRight, Loader2, Users,
  CheckCircle2, Clock, Search, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Sequence = {
  id: number;
  name: string;
  status: "active" | "paused" | "draft";
  totalSteps: number;
  enrollmentCount?: number;
  description?: string;
};

const STATUS_STYLES: Record<string, { badge: string; label: string }> = {
  active: { badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Active" },
  paused: { badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", label: "Paused" },
  draft:  { badge: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400", label: "Draft" },
};

export default function MobileSequences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "paused" | "draft">("all");
  const isAdmin = (user as any)?.role === "admin" || (user as any)?.role === "manager";

  const { data: sequences = [], isLoading } = useQuery<Sequence[]>({
    queryKey: ["/api/sequences"],
    staleTime: 1000 * 60 * 2,
  });

  const { data: coverage = [] } = useQuery<any[]>({
    queryKey: ["/api/sequences/vertical-coverage"],
    staleTime: 1000 * 60 * 5,
  });

  const coverageMap = Object.fromEntries(coverage.map((r: any) => [r.id, r]));

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/sequences/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences/vertical-coverage"] });
      toast({ title: "Sequence updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const filtered = sequences.filter((s) => {
    const matchesSearch = !search.trim() ||
      s.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === "all" || s.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const counts = {
    active: sequences.filter(s => s.status === "active").length,
    paused: sequences.filter(s => s.status === "paused").length,
    draft:  sequences.filter(s => s.status === "draft").length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="bg-white dark:bg-gray-900 px-4 pb-3 sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Sequences</h1>
          <div className="flex items-center gap-1.5">
            <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
              {counts.active} active
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sequences..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
          />
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(["all", "active", "paused", "draft"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filterStatus === f
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
              }`}
            >
              {f === "all" ? `All (${sequences.length})` : `${f[0].toUpperCase() + f.slice(1)} (${counts[f as keyof typeof counts]})`}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Zap className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {search ? "No sequences match your search" : "No sequences yet"}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {filtered.map((seq) => {
              const cov = coverageMap[seq.id];
              const enrolled = cov?.enrolled ?? seq.enrollmentCount ?? 0;
              const completed = cov?.completed ?? 0;
              const steps = seq.totalSteps || cov?.totalSteps || 0;
              const style = STATUS_STYLES[seq.status] || STATUS_STYLES.draft;
              const toggling = toggleMutation.isPending &&
                (toggleMutation.variables as any)?.id === seq.id;

              return (
                <div
                  key={seq.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-900 dark:text-white line-clamp-2 leading-snug">
                        {seq.name}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-3">
                    {steps > 0 && (
                      <span className="flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" />{steps} steps
                      </span>
                    )}
                    {enrolled > 0 && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />{enrolled} enrolled
                      </span>
                    )}
                    {completed > 0 && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />{completed} done
                      </span>
                    )}
                    {cov?.lastEnrolledAt && (
                      <span className="flex items-center gap-1 ml-auto">
                        <Clock className="w-3 h-3" />
                        {cov.daysSinceEnrollment != null
                          ? cov.daysSinceEnrollment === 0 ? "today" : `${cov.daysSinceEnrollment}d ago`
                          : "—"}
                      </span>
                    )}
                  </div>

                  {/* Toggle button (admin/manager only) */}
                  {isAdmin && seq.status !== "draft" && (
                    <button
                      disabled={toggling}
                      onClick={() =>
                        toggleMutation.mutate({
                          id: seq.id,
                          status: seq.status === "active" ? "paused" : "active",
                        })
                      }
                      className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                        seq.status === "active"
                          ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800"
                          : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800"
                      }`}
                    >
                      {toggling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : seq.status === "active" ? (
                        <><Pause className="w-4 h-4" /> Pause sequence</>
                      ) : (
                        <><Play className="w-4 h-4" /> Activate sequence</>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
