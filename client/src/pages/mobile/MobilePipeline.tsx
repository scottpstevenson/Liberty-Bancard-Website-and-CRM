import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { trackPhoneCallClick } from "@/lib/analytics";
import {
  ChevronDown, ChevronRight, Loader2, FileText, User,
  DollarSign, Search, X, Phone, Mail, ExternalLink, Save,
} from "lucide-react";
import { SALES_STAGES } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

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
  "Verbal Commit": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "Nurture / Not Now": "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  "Closed Won": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "Closed Lost": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function bestLabel(deal: any): string {
  return deal.companyName || deal.contactName || `Deal #${deal.id}`;
}

function DealCard({ deal, onTap }: { deal: any; onTap: () => void }) {
  const label = bestLabel(deal);
  const sub = deal.companyName && deal.contactName ? deal.contactName : null;
  return (
    <div
      data-testid={`card-deal-${deal.id}`}
      onClick={onTap}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 active:scale-[0.98] transition-transform cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 dark:text-white line-clamp-1">{label}</div>
          {sub && (
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
              <User className="w-3 h-3" />{sub}
            </div>
          )}
          {deal.owner && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{deal.owner}</div>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
      </div>
      {deal.totalVolume && (
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          <DollarSign className="w-3 h-3" />{deal.totalVolume}
        </div>
      )}
    </div>
  );
}

function StageSection({ stage, deals, onDealTap }: {
  stage: string; deals: any[]; onDealTap: (deal: any) => void;
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
          ) : deals.map(deal => (
            <DealCard key={deal.id} deal={deal} onTap={() => onDealTap(deal)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MobilePipeline() {
  const cached = getCached();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [noteText, setNoteText] = useState("");
  const [editOwner, setEditOwner] = useState("");
  const [editVolume, setEditVolume] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [myDealsOnly, setMyDealsOnly] = useState(false);

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

  const myOwnerNames = useMemo(() => {
    const names: string[] = [];
    if (user) {
      const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
      if (fullName) names.push(fullName.toLowerCase());
      if (user.email) names.push(user.email.toLowerCase());
      if (user.firstName) names.push(user.firstName.toLowerCase());
    }
    return names;
  }, [user]);

  const filteredDeals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return salesDeals.filter((d: any) => {
      if (myDealsOnly) {
        const owner = (d.owner || "").toLowerCase();
        if (!owner || !myOwnerNames.some((n) => owner.includes(n) || n.includes(owner))) return false;
      }
      if (q) {
        const haystack = [d.companyName, d.contactName, d.owner, d.contactEmail].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [salesDeals, searchQuery, myDealsOnly, myOwnerNames]);

  const dealsByStage: Record<string, any[]> = {};
  for (const stage of SALES_STAGES) {
    dealsByStage[stage] = filteredDeals.filter((d: any) => d.stage === stage);
  }

  const updateStageMutation = useMutation({
    mutationFn: async ({ dealId, stage }: { dealId: number; stage: string }) => {
      const res = await apiRequest("PUT", `/api/deals/${dealId}`, { stage });
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedDeal((prev: any) => prev ? { ...prev, ...updated } : prev);
    },
  });

  const updateDealMutation = useMutation({
    mutationFn: async ({ dealId, data }: { dealId: number; data: Record<string, any> }) => {
      const res = await apiRequest("PUT", `/api/deals/${dealId}`, data);
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedDeal((prev: any) => prev ? { ...prev, ...updated } : prev);
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ dealId, content }: { dealId: number; content: string }) => {
      const res = await apiRequest("POST", "/api/notes", { entityType: "deal", entityId: dealId, content });
      return res.json();
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    },
  });

  function openDeal(deal: any) {
    setSelectedDeal(deal);
    setEditOwner(deal.owner || "");
    setEditVolume(deal.totalVolume || "");
    setEditNotes(deal.notes || "");
  }

  function saveDealEdits() {
    if (!selectedDeal) return;
    const updates: Record<string, any> = {};
    if (editOwner !== (selectedDeal.owner || "")) updates.owner = editOwner;
    if (editVolume !== (selectedDeal.totalVolume || "")) updates.totalVolume = editVolume;
    if (editNotes !== (selectedDeal.notes || "")) updates.notes = editNotes;
    if (Object.keys(updates).length > 0) {
      updateDealMutation.mutate({ dealId: selectedDeal.id, data: updates });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 px-4 pb-3 border-b border-gray-100 dark:border-gray-800"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Pipeline</h1>
          <span className="text-sm text-gray-500" data-testid="text-deal-count">
            {filteredDeals.length}{filteredDeals.length !== salesDeals.length && <span className="text-gray-400"> / {salesDeals.length}</span>} deals
          </span>
        </div>
        <div className="mt-3 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input data-testid="input-search-deals" type="text" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by company, contact, or owner"
            className="w-full pl-9 pr-9 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {searchQuery && (
            <button data-testid="button-clear-search" onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button data-testid="button-toggle-my-deals" onClick={() => setMyDealsOnly((v) => !v)} disabled={!user}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              myDealsOnly ? "border-blue-500 bg-blue-500 text-white" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800"
            } ${!user ? "opacity-50" : ""}`}>
            My Deals
          </button>
        </div>
      </div>

      {/* List */}
      <div className="py-4">
        {isLoading && !cached ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          SALES_STAGES.map((stage) => (
            <StageSection key={stage} stage={stage} deals={dealsByStage[stage] || []} onDealTap={openDeal} />
          ))
        )}
      </div>

      {/* Deal Detail Sheet */}
      {selectedDeal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setSelectedDeal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl w-full max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-6 pb-4">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-5" />

              {/* Deal header */}
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate" data-testid="text-deal-name">
                    {bestLabel(selectedDeal)}
                  </h2>
                  {selectedDeal.contactName && selectedDeal.companyName && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                      <User className="w-3.5 h-3.5" />{selectedDeal.contactName}
                    </p>
                  )}
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${STAGE_COLORS[selectedDeal.stage] || "bg-gray-100 text-gray-600"}`}>
                  {selectedDeal.stage}
                </span>
              </div>

              {/* Quick contact actions */}
              {(selectedDeal.contactPhone || selectedDeal.contactEmail || selectedDeal.contactId) && (
                <div className="flex gap-2 mb-4">
                  {selectedDeal.contactPhone && (
                    <a href={`tel:${selectedDeal.contactPhone}`}
                      onClick={() => trackPhoneCallClick({ contactId: selectedDeal.contactId ?? undefined, dealId: selectedDeal.id, sourcePage: "/mobile/pipeline" })}
                      className="flex-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl py-2 flex items-center justify-center gap-1.5 text-xs font-semibold active:scale-95 transition-transform">
                      <Phone className="w-3.5 h-3.5" />Call
                    </a>
                  )}
                  {selectedDeal.contactEmail && (
                    <a href={`mailto:${selectedDeal.contactEmail}`}
                      className="flex-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-xl py-2 flex items-center justify-center gap-1.5 text-xs font-semibold active:scale-95 transition-transform">
                      <Mail className="w-3.5 h-3.5" />Email
                    </a>
                  )}
                  {selectedDeal.contactId && (
                    <button
                      data-testid="button-open-contact"
                      onClick={() => { setSelectedDeal(null); setLocation(`/mobile/contacts/${selectedDeal.contactId}`); }}
                      className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl py-2 flex items-center justify-center gap-1.5 text-xs font-semibold active:scale-95 transition-transform">
                      <ExternalLink className="w-3.5 h-3.5" />Profile
                    </button>
                  )}
                </div>
              )}

              {/* Editable fields */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">Owner / Rep</label>
                  <input
                    data-testid="input-deal-owner"
                    value={editOwner}
                    onChange={(e) => setEditOwner(e.target.value)}
                    placeholder="Assign a rep..."
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">Monthly Volume ($)</label>
                  <input
                    data-testid="input-deal-volume"
                    value={editVolume}
                    onChange={(e) => setEditVolume(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">Deal Notes</label>
                  <textarea
                    data-testid="input-deal-notes"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Deal notes..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  data-testid="button-save-deal-edits"
                  disabled={updateDealMutation.isPending}
                  onClick={saveDealEdits}
                  className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm"
                >
                  {updateDealMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </button>
              </div>

              {/* Move to Stage */}
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Move to Stage</h3>
                <div className="flex flex-wrap gap-2">
                  {SALES_STAGES.map((stage) => (
                    <button key={stage}
                      data-testid={`button-move-stage-${stage.replace(/\s+/g, "-").toLowerCase()}`}
                      disabled={stage === selectedDeal.stage || updateStageMutation.isPending}
                      onClick={() => updateStageMutation.mutate({ dealId: selectedDeal.id, stage })}
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

              {/* Quick Note */}
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Add Note</h3>
                <textarea data-testid="input-deal-note" value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note to this deal..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button data-testid="button-save-note"
                  disabled={!noteText.trim() || addNoteMutation.isPending}
                  onClick={() => addNoteMutation.mutate({ dealId: selectedDeal.id, content: noteText })}
                  className="mt-2 w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 disabled:opacity-50 font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm">
                  {addNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Save Note
                </button>
              </div>

              <button onClick={() => setSelectedDeal(null)}
                className="w-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold py-2.5 rounded-xl text-sm mb-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
