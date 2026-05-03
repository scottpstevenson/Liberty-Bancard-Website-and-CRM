import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Users, Mail, Phone, Search, Building2, Contact } from "lucide-react";
import { useState } from "react";

interface MerchantContactRow {
  contactId: number;
  merchantId: number | null;
  businessName: string;
  source: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  mobile: string | null;
  directPhone: string | null;
  primaryContactFlag: boolean | null;
  roleGuess: string | null;
  bestContactChannel: string | null;
  createdAt: string | null;
}

export function LeadContactsPanel() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<MerchantContactRow[]>({
    queryKey: ["/api/sdr/merchant-contacts"],
  });

  const contacts = data || [];

  const filtered = contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.businessName?.toLowerCase().includes(q) ||
      c.contactName?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.title?.toLowerCase().includes(q)
    );
  });

  const grouped: Record<string, MerchantContactRow[]> = {};
  for (const c of filtered) {
    const key = `${c.merchantId}-${c.businessName}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="panel-lead-contacts">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by business, contact, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-contacts-search"
          />
        </div>
        <span className="text-sm text-muted-foreground" data-testid="text-contacts-count">
          {contacts.length} contact{contacts.length !== 1 ? "s" : ""} across {Object.keys(grouped).length} lead{Object.keys(grouped).length !== 1 ? "s" : ""}
        </span>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-contacts">
            <Contact className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="font-medium">No contacts found</div>
            <div className="text-xs mt-1">Apollo contacts will appear here once leads are enriched</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([key, rows]) => {
            const first = rows[0];
            const isApollo = first.source?.toLowerCase().includes("apollo");
            return (
              <Card key={key} data-testid={`card-merchant-contacts-${first.merchantId}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      <span data-testid={`text-business-name-${first.merchantId}`}>{first.businessName}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {isApollo && (
                        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs font-medium" data-testid={`badge-apollo-${first.merchantId}`}>
                          Apollo
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {rows.length} contact{rows.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {rows.map((contact) => (
                      <div
                        key={contact.contactId}
                        className="flex flex-wrap items-start gap-x-6 gap-y-2 p-3 rounded-lg bg-muted/40 border border-border/50"
                        data-testid={`contact-row-${contact.contactId}`}
                      >
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <div>
                            <div className="text-sm font-medium leading-tight" data-testid={`text-contact-name-${contact.contactId}`}>
                              {contact.contactName || "—"}
                            </div>
                            {contact.title && (
                              <div className="text-xs text-muted-foreground" data-testid={`text-contact-title-${contact.contactId}`}>
                                {contact.title}
                              </div>
                            )}
                          </div>
                        </div>

                        {contact.email && (
                          <div className="flex items-center gap-1.5 text-sm min-w-[180px]">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                              data-testid={`link-contact-email-${contact.contactId}`}
                            >
                              {contact.email}
                            </a>
                          </div>
                        )}

                        {(contact.directPhone || contact.mobile) && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span data-testid={`text-contact-phone-${contact.contactId}`}>
                              {contact.directPhone || contact.mobile}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 ml-auto">
                          {contact.primaryContactFlag && (
                            <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-primary-${contact.contactId}`}>
                              Primary
                            </Badge>
                          )}
                          {isApollo && (
                            <Badge className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`badge-contact-apollo-${contact.contactId}`}>
                              Apollo
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
