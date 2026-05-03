import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users, AlertTriangle, Mail, Phone, Clock, UserCheck, RefreshCw, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";

interface StuckLeadData {
  type: "overdue" | "compliance_blocked" | "waiting_statement" | "stage_age";
  leadId: number | null;
  merchantId: number;
  businessName: string;
  currentStage: string | null;
  nextActionAt: string | null;
  reason: string;
  stageAgeDays?: number;
  assignedOwnerType?: string;
}

interface SdrContact {
  id: number;
  merchantId: number | null;
  merchantSource: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  mobile: string | null;
  directPhone: string | null;
  primaryContactFlag: boolean | null;
  roleGuess: string | null;
  bestContactChannel: string | null;
}

function MerchantContactsSection({ merchantId }: { merchantId: number }) {
  const { data, isLoading } = useQuery<SdrContact[]>({
    queryKey: ["/api/sdr/merchants", merchantId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/sdr/merchants/${merchantId}/contacts`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground" data-testid={`contacts-loading-${merchantId}`}>
        <Loader2 className="w-3 h-3 animate-spin" /> Loading contacts...
      </div>
    );
  }

  const contacts = data || [];

  if (contacts.length === 0) {
    return (
      <div className="py-2 text-xs text-muted-foreground italic" data-testid={`contacts-empty-${merchantId}`}>
        No contacts on file for this lead.
      </div>
    );
  }

  const isApolloSource = contacts.some((c) => c.merchantSource?.toLowerCase().includes("apollo"));

  return (
    <div className="mt-3 space-y-2" data-testid={`contacts-section-${merchantId}`}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <Users className="w-3 h-3" /> Decision Maker Contacts
        {isApolloSource && (
          <Badge className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 ml-1" data-testid={`badge-apollo-source-${merchantId}`}>
            Apollo
          </Badge>
        )}
      </div>
      {contacts.map((contact) => {
        const contactIsApollo = contact.merchantSource?.toLowerCase().includes("apollo");
        return (
          <div
            key={contact.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-2 border-l-2 border-orange-300 dark:border-orange-700 text-xs"
            data-testid={`contact-detail-${contact.id}`}
          >
            <span className="font-medium text-foreground" data-testid={`contact-name-${contact.id}`}>
              {contact.contactName || "Unknown"}
            </span>
            {contact.title && (
              <span className="text-muted-foreground" data-testid={`contact-title-${contact.id}`}>{contact.title}</span>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                data-testid={`contact-email-${contact.id}`}
              >
                <Mail className="w-3 h-3" />{contact.email}
              </a>
            )}
            {(contact.directPhone || contact.mobile) && (
              <span className="flex items-center gap-1 text-muted-foreground" data-testid={`contact-phone-${contact.id}`}>
                <Phone className="w-3 h-3" />{contact.directPhone || contact.mobile}
              </span>
            )}
            <div className="flex items-center gap-1 ml-auto">
              {contact.primaryContactFlag && (
                <Badge className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-primary-contact-${contact.id}`}>
                  Primary
                </Badge>
              )}
              {contactIsApollo && (
                <Badge className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`badge-apollo-contact-${contact.id}`}>
                  Apollo
                </Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StuckLeads() {
  const { toast } = useToast();
  const [expandedMerchant, setExpandedMerchant] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<StuckLeadData[]>({
    queryKey: ["/api/sdr/dashboard/stuck-leads"],
  });

  const handoffMutation = useMutation({
    mutationFn: async (leadId: number) => {
      return apiRequest("POST", `/api/sdr/leads/${leadId}/handoff`, { assignedUserId: "manual_review", note: "Escalated from stuck leads view" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/dashboard/stuck-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/dashboard/summary"] });
    },
    onError: (err: any) => {
      toast({ title: "Handoff failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-sdr-stuck-leads-error">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">Failed to load stuck leads</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-retry-stuck-leads">
            <RefreshCw className="w-4 h-4 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const leads = data || [];

  const typeLabels: Record<string, string> = {
    overdue: "Overdue",
    compliance_blocked: "Blocked",
    waiting_statement: "Waiting Statement",
    stage_age: "Stale",
  };

  const typeVariants: Record<string, "destructive" | "secondary" | "outline"> = {
    compliance_blocked: "destructive",
    overdue: "secondary",
    waiting_statement: "outline",
    stage_age: "secondary",
  };

  return (
    <Card data-testid="card-sdr-stuck-leads">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600" />
          Stuck Leads ({leads.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No stuck leads. All leads are progressing normally.
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((lead, idx) => {
              const isExpanded = expandedMerchant === lead.merchantId;
              return (
                <div key={`${lead.merchantId}-${idx}`} className="rounded-lg bg-muted/50 overflow-hidden" data-testid={`stuck-lead-${lead.merchantId}`}>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex-1 min-w-0">
                      <button
                        className="text-left w-full group"
                        onClick={() => setExpandedMerchant(isExpanded ? null : lead.merchantId)}
                        data-testid={`btn-expand-lead-${lead.merchantId}`}
                      >
                        <div className="font-medium text-sm truncate group-hover:text-primary transition-colors flex items-center gap-1">
                          {lead.businessName}
                          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </div>
                      </button>
                      <div className="text-xs text-muted-foreground">{lead.reason}</div>
                      {lead.stageAgeDays !== undefined && lead.stageAgeDays > 0 && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {lead.stageAgeDays}d in stage
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      {lead.currentStage && (
                        <Badge variant="outline" className="text-xs">{lead.currentStage}</Badge>
                      )}
                      <Badge variant={typeVariants[lead.type] || "secondary"} className="text-xs">
                        {typeLabels[lead.type] || lead.type}
                      </Badge>
                      {lead.assignedOwnerType !== "human" && lead.type !== "compliance_blocked" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => lead.leadId && handoffMutation.mutate(lead.leadId)}
                          disabled={handoffMutation.isPending}
                          data-testid={`btn-handoff-${lead.merchantId}`}
                        >
                          <UserCheck className="w-3 h-3 mr-1" />
                          Claim
                        </Button>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-border/50">
                      <MerchantContactsSection merchantId={lead.merchantId} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
