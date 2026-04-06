import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Search,
  Loader2,
  Brain,
  FileText,
  Route,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  ChevronDown,
  Target,
  Zap,
} from "lucide-react";
import type { Contact } from "@shared/schema";

interface LeadIntelligenceData {
  contact: {
    id: number;
    name: string;
    company: string;
    vertical: string;
    monthlyVolume: string;
    currentProvider: string;
    painPoints: string[];
    contractStatus: string;
    lookingReason: string;
    referralSource: string;
  };
  scoring: {
    leadScore: number;
    revPotentialScore: number;
    switchabilityScore: number;
    uwConfidenceScore: number;
    engagementScore: number;
    scoreBreakdown: string;
    lastScoredAt: string;
    tier: string;
  };
  blueprint: {
    dealId: number;
    recommendedProgram: string;
    hardwarePackage: string;
    estMonthlyRevenue: string;
    underwritingPath: string;
    competitivePositioning: string;
    repBriefing: string;
    repOpener: string;
    likelyObjections: Array<{ objection: string; counter: string }>;
    blueprintGeneratedAt: string;
  } | null;
  docReadiness: {
    statementReceived: boolean;
    voidedCheckReceived: boolean;
    idReceived: boolean;
    appCompleted: boolean;
    score: number;
    max: number;
    percent: number;
    missing: string[];
  } | null;
  routing: {
    recommendations: Array<{ sequenceName: string; reason: string }>;
    complianceStatus: {
      allowed: boolean;
      reason: string;
      channelsAllowed: string[];
    };
    currentEnrollments: Array<{ sequenceName: string; status: string }>;
  };
  compliance: {
    doNotContact: boolean;
    consentSms: boolean;
    consentEmail: boolean;
    smsOptInAt: string | null;
    coolingUntil: string | null;
    contactAttempts: number;
    dncReason: string | null;
  };
  deal: {
    id: number;
    stage: string;
    pipeline: string;
  } | null;
}

function getTierColor(tier: string) {
  switch (tier?.toLowerCase()) {
    case "hot":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "warm":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "cold":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{score}/{max}</span>
      </div>
      <Progress value={pct} className="h-2" data-testid={`progress-${label.toLowerCase().replace(/[\s/]+/g, "-")}`} />
    </div>
  );
}

export default function LeadIntelligence() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { data: contactsRes, isLoading: contactsLoading } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
  });
  const contacts = contactsRes?.data;

  const { data: intel, isLoading: intelLoading } = useQuery<LeadIntelligenceData>({
    queryKey: ["/api/lead-intelligence/full", selectedContactId],
    enabled: !!selectedContactId,
  });

  const scoreMutation = useMutation({
    mutationFn: async (contactId: number) => {
      const res = await apiRequest("POST", `/api/lead-intelligence/score/${contactId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/full", selectedContactId] });
      toast({ title: "Lead re-scored successfully" });
    },
    onError: () => {
      toast({ title: "Failed to re-score lead", variant: "destructive" });
    },
  });

  const blueprintMutation = useMutation({
    mutationFn: async (dealId: number) => {
      const res = await apiRequest("POST", `/api/lead-intelligence/blueprint/${dealId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/full", selectedContactId] });
      toast({ title: "Blueprint generated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to generate blueprint", variant: "destructive" });
    },
  });

  const routeMutation = useMutation({
    mutationFn: async (contactId: number) => {
      const res = await apiRequest("POST", `/api/lead-intelligence/route/${contactId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-intelligence/full", selectedContactId] });
      toast({ title: "Smart routing applied successfully" });
    },
    onError: () => {
      toast({ title: "Failed to route lead", variant: "destructive" });
    },
  });

  const filteredContacts = contacts?.filter((c) =>
    `${c.firstName} ${c.lastName} ${c.companyName || ""}`.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const selectedContact = contacts?.find((c) => c.id === selectedContactId);

  return (
    <div className="space-y-6">
      <div className="relative" data-testid="contact-selector">
        <div
          className="flex items-center gap-2 border rounded-md p-2 cursor-pointer"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          data-testid="button-contact-selector"
        >
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          {selectedContact ? (
            <span className="text-sm flex-1">
              {selectedContact.firstName} {selectedContact.lastName}
              {selectedContact.companyName ? ` - ${selectedContact.companyName}` : ""}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground flex-1">Select a contact...</span>
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>

        {dropdownOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 border rounded-md bg-background shadow-lg z-30 max-h-64 flex flex-col">
            <div className="p-2 border-b">
              <Input
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                data-testid="input-search-contacts"
              />
            </div>
            <div className="overflow-auto flex-1">
              {contactsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-contacts">
                  No contacts found
                </div>
              ) : (
                filteredContacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover-elevate"
                    onClick={() => {
                      setSelectedContactId(c.id);
                      setDropdownOpen(false);
                      setSearchTerm("");
                    }}
                    data-testid={`option-contact-${c.id}`}
                  >
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                      {c.firstName[0]}{c.lastName[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{c.firstName} {c.lastName}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.companyName || c.email}</div>
                    </div>
                    {c.leadScore != null && (
                      <Badge variant="secondary" className="shrink-0">{c.leadScore}</Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {!selectedContactId && (
        <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="text-empty-state">
          <Brain className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Select a Contact</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Choose a contact from the selector above to view their full lead intelligence data including scoring, deal blueprint, document readiness, and smart routing.
          </p>
        </div>
      )}

      {selectedContactId && intelLoading && (
        <div className="flex items-center justify-center py-20" data-testid="loading-intelligence">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {selectedContactId && intel && !intelLoading && (
        <>
          <Card data-testid="card-score-overview">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Score Overview</CardTitle>
              </div>
              <Badge className={getTierColor(intel.scoring.tier)} data-testid="badge-tier">
                {intel.scoring.tier}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="text-5xl font-bold" data-testid="text-lead-score">
                  {intel.scoring.leadScore}
                </div>
                <span className="text-muted-foreground text-sm">/ 100</span>
              </div>

              <div className="space-y-3">
                <ScoreBar label="Revenue Potential" score={intel.scoring.revPotentialScore} max={30} />
                <ScoreBar label="Switchability" score={intel.scoring.switchabilityScore} max={25} />
                <ScoreBar label="Underwriting Confidence" score={intel.scoring.uwConfidenceScore} max={25} />
                <ScoreBar label="Engagement/Intent" score={intel.scoring.engagementScore} max={20} />
              </div>

              {intel.scoring.scoreBreakdown && (
                <p className="text-sm text-muted-foreground" data-testid="text-score-breakdown">
                  {intel.scoring.scoreBreakdown}
                </p>
              )}

              {intel.scoring.lastScoredAt && (
                <p className="text-xs text-muted-foreground" data-testid="text-last-scored">
                  Last scored: {new Date(intel.scoring.lastScoredAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-deal-blueprint">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Deal Blueprint</CardTitle>
              </div>
              {intel.deal && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => blueprintMutation.mutate(intel.deal!.id)}
                  disabled={blueprintMutation.isPending}
                  data-testid="button-generate-blueprint"
                >
                  {blueprintMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Generate Blueprint
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {intel.blueprint ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Recommended Program</p>
                      <p className="text-sm font-medium" data-testid="text-recommended-program">{intel.blueprint.recommendedProgram}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Hardware Package</p>
                      <p className="text-sm font-medium" data-testid="text-hardware-package">{intel.blueprint.hardwarePackage}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Est. Monthly Revenue</p>
                      <p className="text-sm font-medium" data-testid="text-est-revenue">{intel.blueprint.estMonthlyRevenue}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Underwriting Path</p>
                      <p className="text-sm font-medium" data-testid="text-uw-path">{intel.blueprint.underwritingPath}</p>
                    </div>
                  </div>

                  {intel.blueprint.competitivePositioning && (
                    <div className="rounded-md bg-primary/5 dark:bg-primary/10 p-3" data-testid="text-competitive-positioning">
                      <p className="text-xs text-muted-foreground mb-1">Competitive Positioning</p>
                      <p className="text-sm">{intel.blueprint.competitivePositioning}</p>
                    </div>
                  )}

                  {intel.blueprint.repBriefing && (
                    <div className="rounded-md bg-primary/5 dark:bg-primary/10 p-3" data-testid="text-rep-briefing">
                      <p className="text-xs text-muted-foreground mb-1">Rep Briefing</p>
                      <p className="text-sm">{intel.blueprint.repBriefing}</p>
                    </div>
                  )}

                  {intel.blueprint.repOpener && (
                    <p className="text-sm italic text-muted-foreground" data-testid="text-rep-opener">
                      {intel.blueprint.repOpener}
                    </p>
                  )}

                  {intel.blueprint.likelyObjections && intel.blueprint.likelyObjections.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Likely Objections</p>
                      <div className="space-y-2">
                        {intel.blueprint.likelyObjections.map((obj, i) => (
                          <div key={i} className="rounded-md border p-3" data-testid={`objection-${i}`}>
                            <p className="text-sm font-medium">{obj.objection}</p>
                            <p className="text-sm text-muted-foreground mt-1">{obj.counter}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {intel.blueprint.blueprintGeneratedAt && (
                    <p className="text-xs text-muted-foreground" data-testid="text-blueprint-generated">
                      Generated: {new Date(intel.blueprint.blueprintGeneratedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-blueprint">
                  {intel.deal
                    ? "No blueprint generated yet. Click \"Generate Blueprint\" to create one."
                    : "No active deal found for this contact."}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-doc-readiness">
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <CardTitle className="text-base">Document Readiness</CardTitle>
                </div>
                {intel.docReadiness && (
                  <Badge variant="secondary" data-testid="badge-doc-score">
                    {intel.docReadiness.score}/{intel.docReadiness.max}
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                {intel.docReadiness ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {[
                        { label: "Processing Statement", received: intel.docReadiness.statementReceived },
                        { label: "Merchant Application", received: intel.docReadiness.appCompleted },
                        { label: "Voided Check", received: intel.docReadiness.voidedCheckReceived },
                        { label: "Owner ID", received: intel.docReadiness.idReceived },
                      ].map((doc) => (
                        <div key={doc.label} className="flex items-center gap-2" data-testid={`doc-${doc.label.toLowerCase().replace(/\s+/g, "-")}`}>
                          {doc.received ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-destructive shrink-0" />
                          )}
                          <span className="text-sm">{doc.label}</span>
                        </div>
                      ))}
                    </div>

                    <Progress value={intel.docReadiness.percent} className="h-2" data-testid="progress-doc-readiness" />

                    {intel.docReadiness.missing.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Missing Documents</p>
                        <div className="flex flex-wrap gap-1">
                          {intel.docReadiness.missing.map((doc) => (
                            <Badge key={doc} variant="outline" className="text-xs" data-testid={`badge-missing-${doc.toLowerCase().replace(/\s+/g, "-")}`}>
                              {doc}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-doc-readiness">
                    No document readiness data available.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-smart-routing">
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Route className="w-5 h-5 text-primary" />
                  <CardTitle className="text-base">Smart Routing</CardTitle>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => routeMutation.mutate(selectedContactId!)}
                  disabled={routeMutation.isPending}
                  data-testid="button-route-sequence"
                >
                  {routeMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Route className="w-4 h-4 mr-2" />
                  )}
                  Route to Best Sequence
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {intel.routing.currentEnrollments.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Current Enrollments</p>
                    <div className="space-y-1">
                      {intel.routing.currentEnrollments.map((e, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 flex-wrap" data-testid={`enrollment-${i}`}>
                          <span className="text-sm">{e.sequenceName}</span>
                          <Badge variant="secondary" className="text-xs">{e.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {intel.routing.recommendations.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Recommended Sequences</p>
                    <div className="space-y-2">
                      {intel.routing.recommendations.map((r, i) => (
                        <div key={i} className="rounded-md border p-2" data-testid={`recommendation-${i}`}>
                          <p className="text-sm font-medium">{r.sequenceName}</p>
                          <p className="text-xs text-muted-foreground">{r.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Compliance Status</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2" data-testid="text-compliance-allowed">
                      {intel.routing.complianceStatus.allowed ? (
                        <Shield className="w-4 h-4 text-green-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                      )}
                      <span className="text-sm">
                        {intel.routing.complianceStatus.allowed ? "Contact allowed" : intel.routing.complianceStatus.reason}
                      </span>
                    </div>
                    {intel.routing.complianceStatus.channelsAllowed.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {intel.routing.complianceStatus.channelsAllowed.map((ch) => (
                          <Badge key={ch} variant="outline" className="text-xs" data-testid={`badge-channel-${ch}`}>
                            {ch}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {intel.compliance.doNotContact && (
                      <div className="flex items-center gap-2 text-destructive" data-testid="text-dnc">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span className="text-sm">DNC: {intel.compliance.dncReason || "Do Not Contact"}</span>
                      </div>
                    )}
                    {intel.compliance.coolingUntil && (
                      <p className="text-xs text-muted-foreground" data-testid="text-cooling">
                        Cooling period until: {new Date(intel.compliance.coolingUntil).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-actions">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Actions</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => scoreMutation.mutate(selectedContactId!)}
                  disabled={scoreMutation.isPending}
                  data-testid="button-rescore"
                >
                  {scoreMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Re-Score Lead
                </Button>

                {intel.deal && (
                  <Button
                    variant="outline"
                    onClick={() => blueprintMutation.mutate(intel.deal!.id)}
                    disabled={blueprintMutation.isPending}
                    data-testid="button-generate-blueprint-action"
                  >
                    {blueprintMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2" />
                    )}
                    Generate Blueprint
                  </Button>
                )}

                <Button
                  variant="outline"
                  onClick={() => routeMutation.mutate(selectedContactId!)}
                  disabled={routeMutation.isPending}
                  data-testid="button-smart-route-action"
                >
                  {routeMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Route className="w-4 h-4 mr-2" />
                  )}
                  Smart Route
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
