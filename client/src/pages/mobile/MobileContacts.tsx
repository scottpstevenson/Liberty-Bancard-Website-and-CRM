import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Phone, MessageSquare, ChevronRight, Plus, Loader2, User } from "lucide-react";

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

export default function MobileContacts() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const cached = getCached();
  const { data, isLoading, isError } = useQuery<{ data: any[]; total: number }>({
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
          <span className="text-xs text-gray-400">{data?.total || contacts.length} total</span>
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
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {search ? "No contacts found" : "No contacts yet"}
            </p>
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
                        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
