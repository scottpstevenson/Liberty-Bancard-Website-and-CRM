import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  ChevronDown, ChevronRight, Loader2, FileText, ChevronLeft,
  TrendingUp, User, DollarSign, Clock,
} from "lucide-react";
import { SALES_STAGES } from "@shared/schema";

const CACHE_KEY = "mobile_deals_cache";
function getCached() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}
function setCached(data: any) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

const STAGE_COLORS: Record<string, string> = {
  "New Lead": "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  "Statement Received": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Review In Progress": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  "Call Booked": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "Proposal Sent": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Negotiation / Follow-Up": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "Nurture / Not Now": "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  "Closed Won": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "Closed Lost": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function DealCard({ deal, onTap }: { deal: any; onTap: () => void }) {
  const contactName = deal.contactName || (deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : null);
  return (
    <div
      data-testid={`card-deal-${deal.id}`}
      onClick={onTap}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 active:scale-95 transition-transform cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 dark:text-white line-clamp-1">
            {deal.companyName || contactName || `Deal #${deal.id}`}
          </div>
          {contactName && deal.companyName && (
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
              <User className="w-3 h-3" />
              {contactName}
            </div>
          )}
          {deal.owner && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{deal.owner}</div>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
      </div>
      {(deal.totalVolume || deal.estimatedGrossProfitMonthly) && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          {deal.totalVolume && (
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <DollarSign className="w-3 h-3" />
              {deal.totalVolume}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageSection({ stage, deals, onDealTap, onMoveDeal }: {
  stage: string;
  deals: any[];
  onDealTap: (deal: any) => void;
  onMoveDeal: (dealId: number, newStage: string) => void;
}) {
  const [expanded, setExpanded] = useState(deals.length > 0);
  const colorClass = STAGE_COLORS[stage] || "bg-gray-100 text-gray-600";

  return (
    <div className="mb-3 px-4">
      <button
        data-testid={`button-stage-${stage.replace(/\s+/g, "-").toLowerCase()}`}
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 mb-2"
      >
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colorClass}`}>{stage}</span>
        <span className="text-xs text-gray-400 font-medium">{deals.length}</span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2">
          {deals.length === 0 ? (
            <div className="text-center py-4 text-gray-400 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
              No deals in this stage
            </div>
          ) : (
            deals.map(deal => (
              <DealCard key={deal.id} deal={deal} onTap={() => onDealTap(deal)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function MobilePipeline() {
  const cached = getCached();
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [noteText, setNoteText] = useState("");
  const [movingToStage, setMovingToStage] = useState("");

  const { data, isLoading } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/deals"],
    staleTime: 1000 * 60 * 3,
    retry: false,
  });

  useEffect(() => {
    if (data) setCached(data);
  }, [data]);

  const deals = data?.data || cached?.data || [];
  const salesDeals = deals.filter((d: any) => d.pipeline === "sales" || !d.pipeline);

  const dealsByStage: Record<string, any[]> = {};
  for (const stage of SALES_STAGES) {
    dealsByStage[stage] = salesDeals.filter((d: any) => d.stage === stage);
  }

  const updateStageMutation = useMutation({
    mutationFn: async ({ dealId, stage }: { dealId: number; stage: string }) => {
      const res = await apiRequest("PUT", `/api/deals/${dealId}`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedDeal((prev: any) => prev ? { ...prev, stage: movingToStage } : prev);
      setMovingToStage("");
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ dealId, content }: { dealId: number; content: string }) => {
      const res = await apiRequest("POST", "/api/notes", {
        entityType: "deal",
        entityId: dealId,
        content,
      });
      return res.json();
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    },
  });

  return (
    <div>
      <div className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Pipeline</h1>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            <span className="text-sm text-gray-500">{salesDeals.length} deals</span>
          </div>
        </div>
      </div>

      <div className="py-4">
        {isLoading && !cached ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          SALES_STAGES.map((stage) => (
            <StageSection
              key={stage}
              stage={stage}
              deals={dealsByStage[stage] || []}
              onDealTap={(deal) => { setSelectedDeal(deal); setMovingToStage(deal.stage); }}
              onMoveDeal={(dealId, newStage) => updateStageMutation.mutate({ dealId, stage: newStage })}
            />
          ))
        )}
      </div>

      {selectedDeal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setSelectedDeal(null)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-t-3xl w-full p-6 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-5" />

            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white" data-testid="text-deal-name">
                  {selectedDeal.companyName || `Deal #${selectedDeal.id}`}
                </h2>
                {selectedDeal.owner && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedDeal.owner}</p>
                )}
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STAGE_COLORS[selectedDeal.stage] || "bg-gray-100 text-gray-600"}`}>
                {selectedDeal.stage}
              </span>
            </div>

            <div className="mb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Move to Stage</h3>
              <div className="flex flex-wrap gap-2">
                {SALES_STAGES.map((stage) => (
                  <button
                    key={stage}
                    data-testid={`button-move-stage-${stage.replace(/\s+/g, "-").toLowerCase()}`}
                    disabled={stage === selectedDeal.stage || updateStageMutation.isPending}
                    onClick={() => {
                      setMovingToStage(stage);
                      updateStageMutation.mutate({ dealId: selectedDeal.id, stage });
                    }}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      stage === selectedDeal.stage
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 active:bg-gray-50"
                    }`}
                  >
                    {stage}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Add Note</h3>
              <textarea
                data-testid="input-deal-note"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note to this deal..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                data-testid="button-save-note"
                disabled={!noteText.trim() || addNoteMutation.isPending}
                onClick={() => addNoteMutation.mutate({ dealId: selectedDeal.id, content: noteText })}
                className="mt-2 w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 disabled:opacity-50 font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm"
              >
                {addNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Save Note
              </button>
            </div>

            <button
              onClick={() => setSelectedDeal(null)}
              className="w-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold py-2.5 rounded-xl text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
