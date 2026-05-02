import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { Phone, MessageSquare, CheckSquare, Camera, X, ChevronDown, Loader2, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CALL_OUTCOMES = [
  "Connected - Interested",
  "Connected - Send Review Summary",
  "Connected - Needs Proposal",
  "Connected - Not a Fit",
  "No Answer",
  "Left Voicemail",
  "No Show",
  "Not Now (Nurture)",
];

const SMS_TEMPLATES = [
  {
    label: "Quick Check-In",
    body: "Hey {name}, just wanted to follow up on our conversation. Would love to connect when you have 10 minutes. — Liberty Bancard",
  },
  {
    label: "Statement Request",
    body: "Hi {name}, if you send over your last 3 months of processing statements, I can put together a free savings analysis for you. No obligation. — Liberty Bancard",
  },
  {
    label: "Proposal Follow-Up",
    body: "Hi {name}, just checking in on the proposal I sent over. Any questions I can answer? Happy to jump on a quick call. — Liberty Bancard",
  },
  {
    label: "Schedule a Call",
    body: "Hi {name}, do you have 10 minutes this week for a quick call? I have some ideas that could help lower your processing costs. — Liberty Bancard",
  },
  {
    label: "After Meeting",
    body: "Great connecting with you today, {name}! I'll follow up with the details we discussed. Feel free to reach me anytime at 954-266-8214. — Liberty Bancard",
  },
];

type Tab = "call" | "sms" | "task" | "photo";

export default function MobileQuickLog({
  open,
  onClose,
  preselectedContactId,
}: {
  open: boolean;
  onClose: () => void;
  preselectedContactId?: number;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("call");
  const [contactId, setContactId] = useState<string>(preselectedContactId ? String(preselectedContactId) : "");
  const [outcome, setOutcome] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskDue, setTaskDue] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");

  const { data: contactsData } = useQuery<{ data: any[] }>({
    queryKey: ["/api/contacts"],
    staleTime: 1000 * 60 * 5,
    enabled: open,
  });

  const contacts = contactsData?.data || [];

  const { executeOrQueue } = useOfflineQueue();
  const [loggingCall, setLoggingCall] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  async function logCall() {
    setLoggingCall(true);
    const { ok, queued } = await executeOrQueue("POST", "/api/call-logs", {
      contactId: contactId ? Number(contactId) : undefined,
      direction: "outbound",
      outcome,
      summary: callNotes || undefined,
    });
    if (ok || queued) {
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      toast({ title: queued ? "Call queued (offline)" : "Call logged", description: `Outcome: ${outcome}` });
      setOutcome("");
      setCallNotes("");
      onClose();
    }
    setLoggingCall(false);
  }

  async function logSms() {
    setSendingSms(true);
    const contact = contacts.find((c: any) => String(c.id) === contactId);
    const body = smsBody.replace("{name}", contact?.firstName || "there");
    const { ok, queued } = await executeOrQueue("POST", "/api/call-logs", {
      contactId: contactId ? Number(contactId) : undefined,
      direction: "outbound",
      outcome: "SMS Sent",
      summary: `SMS sent: ${body.slice(0, 100)}`,
    });
    if (ok || queued) {
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      if (contact?.phone) {
        window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(body)}`;
      }
      toast({ title: queued ? "SMS queued (offline)" : "SMS logged", description: "Opening messaging app..." });
      onClose();
    }
    setSendingSms(false);
  }

  async function createTask() {
    setCreatingTask(true);
    const { ok, queued } = await executeOrQueue("POST", "/api/tasks", {
      title: taskTitle,
      priority: taskPriority,
      dueDate: taskDue ? new Date(taskDue).toISOString() : undefined,
      contactId: contactId ? Number(contactId) : undefined,
      status: "pending",
    });
    if (ok || queued) {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: queued ? "Task queued (offline)" : "Task created" });
      setTaskTitle("");
      setTaskPriority("normal");
      setTaskDue("");
      onClose();
    }
    setCreatingTask(false);
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", "Photo");
    formData.append("category", "Other");
    formData.append("fileName", file.name);
    if (contactId) formData.append("contactId", contactId);
    if (photoCaption) formData.append("notes", photoCaption);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Photo uploaded", description: "Document saved to vault" });
        setPhotoCaption("");
        onClose();
      } else {
        toast({ title: "Upload failed", description: "Could not save photo", variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  if (!open) return null;

  const TABS: { id: Tab; label: string; icon: typeof Phone }[] = [
    { id: "call", label: "Call", icon: Phone },
    { id: "sms", label: "SMS", icon: MessageSquare },
    { id: "task", label: "Task", icon: CheckSquare },
    { id: "photo", label: "Photo", icon: Camera },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-900 rounded-t-3xl border-b border-gray-100 dark:border-gray-800 px-6 pt-4 pb-3">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Quick Log</h2>
            <button data-testid="button-close-quick-log" onClick={onClose} className="text-gray-400 active:opacity-70">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                data-testid={`tab-${id}`}
                onClick={() => setTab(id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  tab === id
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-4">
          {(tab === "call" || tab === "sms") && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Contact</label>
              <select
                data-testid="select-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select contact...</option>
                {contacts.map((c: any) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.firstName} {c.lastName} {c.companyName ? `— ${c.companyName}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tab === "call" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Outcome *</label>
                <div className="space-y-2">
                  {CALL_OUTCOMES.map((o) => (
                    <button
                      key={o}
                      data-testid={`button-outcome-${o.replace(/\s+/g, "-").toLowerCase()}`}
                      onClick={() => setOutcome(o)}
                      className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        outcome === o
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800"
                      }`}
                    >
                      {outcome === o && <CheckCircle className="inline w-4 h-4 mr-2 text-blue-500" />}
                      {o}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Notes</label>
                <textarea
                  data-testid="input-call-notes"
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  placeholder="Call notes..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                data-testid="button-log-call-submit"
                disabled={!outcome || loggingCall}
                onClick={() => logCall()}
                className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
              >
                {loggingCall ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                Log Call
              </button>
            </>
          )}

          {tab === "sms" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Template</label>
                <div className="space-y-2">
                  {SMS_TEMPLATES.map((t, i) => (
                    <button
                      key={i}
                      data-testid={`button-template-${i}`}
                      onClick={() => { setSelectedTemplate(i); setSmsBody(t.body); }}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                        selectedTemplate === i
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">{t.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{t.body}</div>
                    </button>
                  ))}
                </div>
              </div>
              {selectedTemplate !== null && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Message</label>
                  <textarea
                    data-testid="input-sms-body"
                    value={smsBody}
                    onChange={(e) => setSmsBody(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              <button
                data-testid="button-send-sms"
                disabled={!smsBody || sendingSms}
                onClick={() => logSms()}
                className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
              >
                {sendingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Open SMS App
              </button>
            </>
          )}

          {tab === "task" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Contact (optional)</label>
                <select
                  data-testid="select-task-contact"
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No contact</option>
                  {contacts.map((c: any) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.firstName} {c.lastName} {c.companyName ? `— ${c.companyName}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Task Title *</label>
                <input
                  data-testid="input-quick-task-title"
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Priority</label>
                  <select
                    data-testid="select-task-priority"
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Due Date</label>
                  <input
                    data-testid="input-quick-task-due"
                    type="date"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <button
                data-testid="button-create-quick-task"
                disabled={!taskTitle.trim() || creatingTask}
                onClick={() => createTask()}
                className="w-full bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
              >
                {creatingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                Create Task
              </button>
            </>
          )}

          {tab === "photo" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Contact (optional)</label>
                <select
                  data-testid="select-photo-contact"
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No contact</option>
                  {contacts.map((c: any) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.firstName} {c.lastName} {c.companyName ? `— ${c.companyName}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Caption (optional)</label>
                <input
                  data-testid="input-photo-caption"
                  type="text"
                  value={photoCaption}
                  onChange={(e) => setPhotoCaption(e.target.value)}
                  placeholder="e.g. Business card, terminal photo..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <label
                data-testid="button-upload-photo"
                className="block w-full bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-8 text-center cursor-pointer active:scale-95 transition-transform"
              >
                <Camera className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <div className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Take Photo or Choose from Library</div>
                <div className="text-xs text-gray-400 mt-1">Photo will be saved to Document Vault</div>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
