import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import {
  ChevronLeft, Phone, MessageSquare, Mail, Building, MapPin,
  Zap, Loader2, CheckCircle, Clock, Activity, ChevronRight,
} from "lucide-react";
import MobileQuickLog from "./MobileQuickLog";

const OUTCOMES = [
  "Connected - Interested",
  "Connected - Send Review Summary",
  "Connected - Needs Proposal",
  "Connected - Not a Fit",
  "No Answer",
  "Left Voicemail",
  "No Show",
  "Not Now (Nurture)",
];

function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getInitials(first: string, last: string): string {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase();
}

export default function MobileContactDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState("");
  const [callNotes, setCallNotes] = useState("");

  const contactId = Number(params.id);

  const { data: contact, isLoading } = useQuery<any>({
    queryKey: ["/api/contacts", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!contactId,
  });

  const { data: activity } = useQuery<any[]>({
    queryKey: ["/api/contacts", contactId, "activity"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/activity`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const logCallMutation = useMutation({
    mutationFn: async (data: { outcome: string; notes: string }) => {
      const res = await apiRequest("POST", "/api/call-logs", {
        contactId,
        direction: "outbound",
        outcome: data.outcome,
        summary: data.notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "activity"] });
      setLogCallOpen(false);
      setSelectedOutcome("");
      setCallNotes("");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>Contact not found</p>
        <button onClick={() => setLocation("/mobile/contacts")} className="text-blue-600 mt-2">Back</button>
      </div>
    );
  }

  const name = `${contact.firstName} ${contact.lastName}`.trim();
  const initials = getInitials(contact.firstName, contact.lastName);

  return (
    <div className="pb-4">
      <div className="bg-blue-600 px-4 pb-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <button
          data-testid="button-back"
          onClick={() => setLocation("/mobile/contacts")}
          className="flex items-center gap-1 text-blue-200 mb-4 active:opacity-70"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm">Contacts</span>
        </button>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
            <span className="text-white text-xl font-bold">{initials}</span>
          </div>
          <div>
            <h1 className="text-white text-xl font-bold" data-testid="text-contact-name">{name}</h1>
            {contact.companyName && (
              <p className="text-blue-200 text-sm flex items-center gap-1">
                <Building className="w-3 h-3" />
                {contact.companyName}
              </p>
            )}
            {contact.status && (
              <span className="inline-block bg-white/20 text-white text-xs px-2 py-0.5 rounded-full mt-1">{contact.status}</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          {contact.phone && (
            <a
              data-testid="link-call-contact"
              href={`tel:${contact.phone}`}
              className="flex-1 bg-white text-blue-600 rounded-xl py-2.5 flex items-center justify-center gap-2 font-semibold text-sm active:scale-95 transition-transform"
            >
              <Phone className="w-4 h-4" />
              Call
            </a>
          )}
          {contact.phone && (
            <a
              data-testid="link-sms-contact"
              href={`sms:${contact.phone}`}
              className="flex-1 bg-blue-500/50 text-white rounded-xl py-2.5 flex items-center justify-center gap-2 font-semibold text-sm active:scale-95 transition-transform"
            >
              <MessageSquare className="w-4 h-4" />
              Text
            </a>
          )}
          {contact.email && (
            <a
              data-testid="link-email-contact"
              href={`mailto:${contact.email}`}
              className="flex-1 bg-blue-500/50 text-white rounded-xl py-2.5 flex items-center justify-center gap-2 font-semibold text-sm active:scale-95 transition-transform"
            >
              <Mail className="w-4 h-4" />
              Email
            </a>
          )}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Contact Info</h3>
          <div className="space-y-2">
            {contact.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a href={`tel:${contact.phone}`} className="text-blue-600 dark:text-blue-400" data-testid="text-contact-phone">{contact.phone}</a>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a href={`mailto:${contact.email}`} className="text-blue-600 dark:text-blue-400 truncate" data-testid="text-contact-email">{contact.email}</a>
              </div>
            )}
            {contact.vertical && (
              <div className="flex items-center gap-2 text-sm">
                <Building className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">{contact.vertical}</span>
              </div>
            )}
            {(contact.city || contact.state) && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">{[contact.city, contact.state].filter(Boolean).join(", ")}</span>
              </div>
            )}
            {contact.monthlyVolume && (
              <div className="flex items-center gap-2 text-sm">
                <Activity className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">Monthly Volume: {contact.monthlyVolume}</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            data-testid="button-log-call"
            onClick={() => setLogCallOpen(true)}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
          >
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
              <Phone className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Log Call</span>
          </button>
          <button
            data-testid="button-quick-log-contact"
            onClick={() => setQuickLogOpen(true)}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
          >
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Quick Log</span>
          </button>
        </div>

        {(activity || []).length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4" data-testid="card-activity">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Recent Activity</h3>
            <div className="space-y-3">
              {(activity || []).slice(0, 5).map((event: any) => (
                <div key={event.id} className="flex items-start gap-2">
                  <div className="w-7 h-7 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    {event.type === "call" ? <Phone className="w-3 h-3 text-gray-500" /> : <Activity className="w-3 h-3 text-gray-500" />}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {event.type === "call" ? `Call: ${event.details?.outcome || "Logged"}` :
                       event.type === "note" ? "Note added" :
                       event.action?.replace(/_/g, " ") || "Activity"}
                    </div>
                    <div className="text-xs text-gray-400">{formatTime(event.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {logCallOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setLogCallOpen(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-t-3xl w-full p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-5" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Log Call Outcome</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              With {name}
            </p>

            <div className="space-y-2 mb-4">
              {OUTCOMES.map((outcome) => (
                <button
                  key={outcome}
                  data-testid={`button-outcome-${outcome.replace(/\s+/g, "-").toLowerCase()}`}
                  onClick={() => setSelectedOutcome(outcome)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                    selectedOutcome === outcome
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                      : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800"
                  }`}
                >
                  {selectedOutcome === outcome && <CheckCircle className="inline w-4 h-4 mr-2 text-blue-500" />}
                  {outcome}
                </button>
              ))}
            </div>

            <textarea
              data-testid="input-call-notes"
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="Call notes (optional)..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />

            <button
              data-testid="button-submit-call-log"
              disabled={!selectedOutcome || logCallMutation.isPending}
              onClick={() => logCallMutation.mutate({ outcome: selectedOutcome, notes: callNotes })}
              className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
            >
              {logCallMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Save Call Log
            </button>
          </div>
        </div>
      )}

      <MobileQuickLog open={quickLogOpen} onClose={() => setQuickLogOpen(false)} preselectedContactId={contactId} />
    </div>
  );
}
