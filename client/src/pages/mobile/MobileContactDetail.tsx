import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import { trackPhoneCallClick } from "@/lib/analytics";
import { VERTICALS } from "@shared/schema";
import {
  ChevronLeft, Phone, MessageSquare, Mail, Building, MapPin,
  Zap, Loader2, CheckCircle, Activity, Edit2, Save, X,
  DollarSign, User, Hash, Globe, ListOrdered,
} from "lucide-react";
import MobileQuickLog from "./MobileQuickLog";
import { useToast } from "@/hooks/use-toast";

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
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "?";
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
      <div className="text-sm text-gray-800 dark:text-gray-200 mt-0.5">{value}</div>
    </div>
  );
}

function EditField({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || label}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

// ─── Enroll Sequence Bottom Sheet ────────────────────────────────────────────

function EnrollSequenceSheet({
  open,
  onClose,
  contactId,
}: {
  open: boolean;
  onClose: () => void;
  contactId: number;
}) {
  const { toast } = useToast();
  const [enrollingId, setEnrollingId] = useState<number | null>(null);

  // All sequences
  const { data: allSequences, isLoading: loadingSeqs, isError: seqError, refetch: refetchSeqs } = useQuery<any[]>({
    queryKey: ["/api/sequences"],
    queryFn: async () => {
      const res = await fetch("/api/sequences", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sequences");
      return res.json();
    },
    enabled: open,
    staleTime: 60000,
  });

  // Contact's current enrollments
  const { data: enrollments, isLoading: loadingEnrollments } = useQuery<any[]>({
    queryKey: ["/api/contacts", contactId, "enrollments"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/enrollments`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!contactId,
    staleTime: 30000,
  });

  const enrollMutation = useMutation({
    mutationFn: async (sequenceId: number) => {
      setEnrollingId(sequenceId);
      const res = await apiRequest("POST", "/api/sequence-enrollments", {
        sequenceId,
        contactId,
        status: "active",
        nextActionAt: new Date().toISOString(),
        currentStep: 0,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Enrollment failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "enrollments"] });
      toast({ title: "Enrolled", description: "Contact added to sequence." });
      onClose();
    },
    onError: (err: Error) => {
      setEnrollingId(null);
      toast({ title: "Enrollment failed", description: err.message, variant: "destructive" });
    },
  });

  if (!open) return null;

  const loading = loadingSeqs || loadingEnrollments;

  // Active enrollments' sequence IDs (active or paused = already enrolled)
  const enrolledIds = new Set(
    (enrollments || [])
      .filter((e: any) => e.status === "active" || e.status === "paused")
      .map((e: any) => e.sequenceId)
  );

  // Only show active sequences not already enrolled
  const activeSequences = (allSequences || []).filter(
    (s: any) => s.status === "active" && !enrolledIds.has(s.id)
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 rounded-t-3xl border-b border-gray-100 dark:border-gray-800 px-6 pt-4 pb-3">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Enroll in Sequence</h2>
            <button onClick={onClose} className="text-gray-400 active:opacity-70">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Active sequences not yet applied to this contact</p>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : seqError ? (
            <div className="text-center py-10">
              <p className="text-sm text-red-500 mb-3">Failed to load sequences.</p>
              <button
                onClick={() => refetchSeqs()}
                className="text-sm text-blue-600 dark:text-blue-400 underline"
              >
                Retry
              </button>
            </div>
          ) : activeSequences.length === 0 ? (
            <div className="text-center py-10">
              <ListOrdered className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {(allSequences || []).filter((s: any) => s.status === "active").length === 0
                  ? "No active sequences available."
                  : "This contact is already enrolled in all active sequences."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSequences.map((seq: any) => (
                <div
                  key={seq.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-gray-900 dark:text-white line-clamp-2">
                      {seq.name}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {seq.totalSteps > 0 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {seq.totalSteps} step{seq.totalSteps !== 1 ? "s" : ""}
                        </span>
                      )}
                      {seq.triggerType && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                          {seq.triggerType.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    data-testid={`button-enroll-sequence-${seq.id}`}
                    disabled={enrollMutation.isPending && enrollingId === seq.id}
                    onClick={() => enrollMutation.mutate(seq.id)}
                    className="shrink-0 bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-xl active:scale-95 transition-transform flex items-center gap-1.5"
                  >
                    {enrollMutation.isPending && enrollingId === seq.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle className="w-3.5 h-3.5" />}
                    Enroll
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MobileContactDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

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

  const { data: deals } = useQuery<any[]>({
    queryKey: ["/api/contacts", contactId, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/deals`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const { data: enrollments } = useQuery<any[]>({
    queryKey: ["/api/contacts", contactId, "enrollments"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/enrollments`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await apiRequest("PUT", `/api/contacts/${contactId}`, data);
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      setEditing(false);
    },
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

  function startEdit() {
    setEditForm({
      firstName: contact?.firstName || "",
      lastName: contact?.lastName || "",
      email: contact?.email || "",
      phone: contact?.phone || "",
      companyName: contact?.companyName || "",
      vertical: contact?.vertical || "",
      city: contact?.city || "",
      state: contact?.state || "",
      monthlyVolume: contact?.monthlyVolume || "",
      website: contact?.website || "",
    });
    setEditing(true);
  }

  function field(key: string) {
    return editForm[key] ?? "";
  }

  function set(key: string) {
    return (v: string) => setEditForm((f) => ({ ...f, [key]: v }));
  }

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

  const name = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unknown";
  const initials = getInitials(contact.firstName || "", contact.lastName || "");

  // Count active sequence enrollments
  const activeEnrollmentCount = (enrollments || []).filter(
    (e: any) => e.status === "active" || e.status === "paused"
  ).length;

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="bg-blue-600 px-4 pb-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div className="flex items-center justify-between mb-4">
          <button
            data-testid="button-back"
            onClick={() => setLocation("/mobile/contacts")}
            className="flex items-center gap-1 text-blue-200 active:opacity-70"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm">Contacts</span>
          </button>
          {!editing ? (
            <button
              data-testid="button-edit-contact"
              onClick={startEdit}
              className="flex items-center gap-1.5 bg-white/20 text-white text-sm px-3 py-1.5 rounded-full active:bg-white/30"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                data-testid="button-cancel-edit"
                onClick={() => setEditing(false)}
                className="text-blue-200 text-sm px-3 py-1.5 active:opacity-70"
              >
                Cancel
              </button>
              <button
                data-testid="button-save-contact"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate(editForm)}
                className="flex items-center gap-1.5 bg-white text-blue-600 font-semibold text-sm px-3 py-1.5 rounded-full active:scale-95 transition-transform disabled:opacity-50"
              >
                {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
            <span className="text-white text-xl font-bold">{initials}</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-white text-xl font-bold truncate" data-testid="text-contact-name">{name}</h1>
            {contact.companyName && (
              <p className="text-blue-200 text-sm flex items-center gap-1">
                <Building className="w-3 h-3 shrink-0" />
                <span className="truncate">{contact.companyName}</span>
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {contact.status && (
                <span className="inline-block bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{contact.status}</span>
              )}
              {activeEnrollmentCount > 0 && (
                <span
                  data-testid="chip-active-sequences"
                  className="inline-flex items-center gap-1 bg-white/20 text-white text-xs px-2 py-0.5 rounded-full"
                >
                  <ListOrdered className="w-3 h-3" />
                  {activeEnrollmentCount} sequence{activeEnrollmentCount !== 1 ? "s" : ""} active
                </span>
              )}
            </div>
          </div>
        </div>

        {!editing && (
          <div className="flex gap-2 mt-4">
            {contact.phone && (
              <a data-testid="link-call-contact" href={`tel:${contact.phone}`}
                onClick={() => trackPhoneCallClick({ contactId: contact.id, sourcePage: "/mobile/contacts/" + contact.id })}
                className="flex-1 bg-white text-blue-600 rounded-xl py-2.5 flex items-center justify-center gap-2 font-semibold text-sm active:scale-95 transition-transform">
                <Phone className="w-4 h-4" />Call
              </a>
            )}
            {contact.phone && (
              <a data-testid="link-sms-contact" href={`sms:${contact.phone}`}
                className="flex-1 bg-blue-500/50 text-white rounded-xl py-2.5 flex items-center justify-center gap-2 font-semibold text-sm active:scale-95 transition-transform">
                <MessageSquare className="w-4 h-4" />Text
              </a>
            )}
            {contact.email && (
              <a data-testid="link-email-contact" href={`mailto:${contact.email}`}
                className="flex-1 bg-blue-500/50 text-white rounded-xl py-2.5 flex items-center justify-center gap-2 font-semibold text-sm active:scale-95 transition-transform">
                <Mail className="w-4 h-4" />Email
              </a>
            )}
          </div>
        )}
      </div>

      <div className="px-4 mt-4 space-y-3">
        {/* Edit form */}
        {editing ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Edit Contact</h3>
            <div className="grid grid-cols-2 gap-3">
              <EditField label="First Name" value={field("firstName")} onChange={set("firstName")} />
              <EditField label="Last Name" value={field("lastName")} onChange={set("lastName")} />
            </div>
            <EditField label="Company Name" value={field("companyName")} onChange={set("companyName")} />
            <EditField label="Email" value={field("email")} onChange={set("email")} type="email" />
            <EditField label="Phone" value={field("phone")} onChange={set("phone")} type="tel" />
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">Industry / Vertical</label>
              <select
                value={field("vertical")}
                onChange={(e) => set("vertical")(e.target.value)}
                data-testid="select-edit-vertical"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select vertical…</option>
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <EditField label="City" value={field("city")} onChange={set("city")} />
              <EditField label="State" value={field("state")} onChange={set("state")} />
            </div>
            <EditField label="Monthly Volume ($)" value={field("monthlyVolume")} onChange={set("monthlyVolume")} placeholder="e.g. 50000" />
            <EditField label="Website" value={field("website")} onChange={set("website")} type="url" />
            {updateMutation.isError && (
              <p className="text-xs text-red-500">Failed to save. Please try again.</p>
            )}
            <button
              data-testid="button-save-contact-bottom"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate(editForm)}
              className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 text-sm"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        ) : (
          <>
            {/* Contact Info */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Contact Info</h3>
              <div className="space-y-2">
                {contact.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                    <a href={`tel:${contact.phone}`} className="text-blue-600 dark:text-blue-400" data-testid="text-contact-phone"
                      onClick={() => trackPhoneCallClick({ contactId: contact.id, sourcePage: "/mobile/contacts/" + contact.id })}
                    >{contact.phone}</a>
                  </div>
                )}
                {contact.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                    <a href={`mailto:${contact.email}`} className="text-blue-600 dark:text-blue-400 truncate" data-testid="text-contact-email">{contact.email}</a>
                  </div>
                )}
                {contact.vertical && (
                  <div className="flex items-center gap-2 text-sm">
                    <Hash className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">{contact.vertical}</span>
                  </div>
                )}
                {(contact.city || contact.state) && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">{[contact.city, contact.state].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {contact.monthlyVolume && (
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">Monthly Volume: {contact.monthlyVolume}</span>
                  </div>
                )}
                {contact.website && (
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="w-4 h-4 text-gray-400 shrink-0" />
                    <a href={contact.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 truncate">{contact.website}</a>
                  </div>
                )}
              </div>
            </div>

            {/* Deals */}
            {deals && deals.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4" data-testid="card-deals">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Deals ({deals.length})</h3>
                <div className="space-y-2">
                  {deals.slice(0, 5).map((deal: any) => (
                    <div key={deal.id} className="flex items-center justify-between py-1">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {deal.companyName || name || `Deal #${deal.id}`}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{deal.stage}</div>
                      </div>
                      {deal.totalVolume && (
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 ml-2 shrink-0">${deal.totalVolume}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick actions */}
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
              <button
                data-testid="button-enroll-sequence"
                onClick={() => setEnrollOpen(true)}
                className="col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex items-center justify-center gap-3 active:scale-95 transition-transform"
              >
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center shrink-0">
                  <ListOrdered className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Enroll in Sequence</div>
                  {activeEnrollmentCount > 0 && (
                    <div className="text-xs text-purple-600 dark:text-purple-400">
                      {activeEnrollmentCount} active
                    </div>
                  )}
                </div>
              </button>
            </div>

            {/* Recent Activity */}
            {(activity || []).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4" data-testid="card-activity">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Recent Activity</h3>
                <div className="space-y-3">
                  {(activity || []).slice(0, 5).map((event: any) => (
                    <div key={event.id} className="flex items-start gap-2">
                      <div className="w-7 h-7 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center shrink-0 mt-0.5">
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
          </>
        )}
      </div>

      {/* Log Call sheet */}
      {logCallOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setLogCallOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl w-full p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-5" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Log Call Outcome</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">With {name}</p>
            <div className="space-y-2 mb-4">
              {OUTCOMES.map((outcome) => (
                <button key={outcome}
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
            <textarea data-testid="input-call-notes" value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="Call notes (optional)..." rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4" />
            <button data-testid="button-submit-call-log"
              disabled={!selectedOutcome || logCallMutation.isPending}
              onClick={() => logCallMutation.mutate({ outcome: selectedOutcome, notes: callNotes })}
              className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
              {logCallMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Save Call Log
            </button>
          </div>
        </div>
      )}

      <MobileQuickLog open={quickLogOpen} onClose={() => setQuickLogOpen(false)} preselectedContactId={contactId} />

      {/* Enroll Sequence Sheet */}
      <EnrollSequenceSheet
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        contactId={contactId}
      />
    </div>
  );
}
