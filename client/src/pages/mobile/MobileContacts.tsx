import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Phone, MessageSquare, ChevronRight, Plus, Loader2, User, X } from "lucide-react";
import { trackPhoneCallClick } from "@/lib/analytics";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatRelativeTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 5) return `${diffWeek}w ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const CACHE_KEY = "mobile_contacts_cache";

function getCached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCached(data: any) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

function getInitials(first: string, last: string): string {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash)];
}

function CreateContactSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!firstName.trim()) throw new Error("First name is required");
      const res = await apiRequest("POST", "/api/contacts", {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        companyName: companyName.trim() || null,
        status: "prospect",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to create contact");
      }
      return res.json();
    },
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact created", description: `${firstName} ${lastName}`.trim() });
      setFirstName(""); setLastName(""); setPhone(""); setEmail(""); setCompanyName("");
      onCreated(contact.id);
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-900 rounded-t-3xl border-b border-gray-100 dark:border-gray-800 px-6 pt-4 pb-3">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Contact</h2>
            <button onClick={onClose} className="text-gray-400 active:opacity-70">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">First Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className="w-full px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                className="w-full px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Business Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Bakery LLC"
              className="w-full px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(305) 555-0100"
              className="w-full px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acmebakery.com"
              className="w-full px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
            />
          </div>

          <button
            onClick={() => createMutation.mutate()}
            disabled={!firstName.trim() || createMutation.isPending}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {createMutation.isPending ? "Creating…" : "Create Contact"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MobileContacts() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const cached = getCached();
  const { data, isLoading } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/contacts"],
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (data) setCached(data);
  }, [data]);

  const contacts = (data?.data || cached?.data || []);

  const filtered = contacts.filter((c: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.firstName?.toLowerCase().includes(q) ||
      c.lastName?.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white dark:bg-gray-900 px-4 pb-3 sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Contacts</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{data?.total || contacts.length} total</span>
            <button
              data-testid="button-create-contact"
              onClick={() => setShowCreate(true)}
              className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            >
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            data-testid="input-search-contacts"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && !cached ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 px-4">
            <User className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
              {search ? "No contacts found" : "No contacts yet"}
            </p>
            {!search && (
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl"
              >
                Add First Contact
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((contact: any) => {
              const initials = getInitials(contact.firstName, contact.lastName);
              const color = avatarColor(`${contact.firstName}${contact.lastName}`);
              const name = `${contact.firstName} ${contact.lastName}`.trim();

              return (
                <div
                  key={contact.id}
                  data-testid={`card-contact-${contact.id}`}
                  className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700 cursor-pointer"
                  onClick={() => setLocation(`/mobile/contacts/${contact.id}`)}
                >
                  <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
                    <span className="text-white text-sm font-semibold">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 dark:text-white line-clamp-1">{name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                      {contact.companyName || contact.email || contact.phone}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {contact.status && (
                        <span className="inline-block text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                          {contact.status}
                        </span>
                      )}
                      {(contact.updatedAt || contact.lastContactedAt) && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {formatRelativeTime(contact.lastContactedAt || contact.updatedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {contact.phone && (
                      <a
                        data-testid={`link-call-${contact.id}`}
                        href={`tel:${contact.phone}`}
                        onClick={(e) => { e.stopPropagation(); trackPhoneCallClick({ contactId: contact.id, sourcePage: "/mobile/contacts" }); }}
                        className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <Phone className="w-4 h-4 text-green-600 dark:text-green-400" />
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        data-testid={`link-sms-${contact.id}`}
                        href={`sms:${contact.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </a>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 ml-1" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CreateContactSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); setLocation(`/mobile/contacts/${id}`); }}
      />
    </div>
  );
}
