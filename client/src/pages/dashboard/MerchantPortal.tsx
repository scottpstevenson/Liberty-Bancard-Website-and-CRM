import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  User, ClipboardList, FileText, Headphones,
  CheckCircle, Circle, Loader2, Plus, Upload,
  Calendar, Hash, CreditCard, Activity, ArrowRight,
  PlayCircle, BookOpen, ChevronDown, ChevronUp, Shield, Clock, Zap, Star
} from "lucide-react";
import { Link } from "wouter";
import type { MerchantProfile, OnboardingStep, Ticket } from "@shared/schema";
import type { Document as DocType } from "@shared/schema";
import { HelpCenter } from "@/components/HelpCenter";
import merchantVideo from "@assets/videos/merchant-explainer.mp4";

type TabKey = "guide" | "account" | "onboarding" | "documents" | "support";

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "guide", label: "Getting Started", icon: BookOpen },
  { key: "account", label: "My Account", icon: User },
  { key: "onboarding", label: "Onboarding Progress", icon: ClipboardList },
  { key: "documents", label: "My Documents", icon: FileText },
  { key: "support", label: "Support", icon: Headphones },
];

function getStatusBadgeVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active": return "default";
    case "pending": return "secondary";
    case "under_review": return "outline";
    default: return "secondary";
  }
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function AccountTab({ profile, isLoading }: { profile: MerchantProfile | null | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="account-loading">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Card data-testid="card-no-profile">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <CreditCard className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold" data-testid="text-no-profile-title">Application in Progress</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Your merchant profile hasn't been set up yet. Complete your application to get started with payment processing.
            </p>
          </div>
          <Link href="/apply">
            <Button data-testid="button-start-application">
              <ArrowRight className="w-4 h-4 mr-2" />
              Complete Your Application
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card data-testid="card-account-status">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Account Status</CardTitle>
          <Badge variant={getStatusBadgeVariant(profile.accountStatus)} data-testid="badge-account-status">
            {profile.accountStatus || "Pending"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">MID Number</p>
              <p className="text-sm font-medium flex items-center gap-2" data-testid="text-mid-number">
                <Hash className="w-4 h-4 text-muted-foreground" />
                {profile.merchantMid || "Not assigned"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Program Type</p>
              <p className="text-sm font-medium flex items-center gap-2" data-testid="text-program-type">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
                {profile.programType || "Not set"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Go-Live Date</p>
              <p className="text-sm font-medium flex items-center gap-2" data-testid="text-go-live-date">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                {formatDate(profile.goLiveDate)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Current Monthly Volume</p>
              <p className="text-sm font-medium flex items-center gap-2" data-testid="text-monthly-volume">
                <Activity className="w-4 h-4 text-muted-foreground" />
                {profile.currentMonthlyVolume ? `$${Number(profile.currentMonthlyVolume).toLocaleString()}` : "N/A"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OnboardingTab({ dealId }: { dealId: number | null | undefined }) {
  const { data: steps, isLoading } = useQuery<OnboardingStep[]>({
    queryKey: ["/api/onboarding-steps/deal", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding-steps/deal/${dealId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!dealId,
  });

  if (!dealId) {
    return (
      <Card data-testid="card-no-onboarding">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <ClipboardList className="w-12 h-12 text-muted-foreground" />
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">No Onboarding Data</h3>
            <p className="text-sm text-muted-foreground">Onboarding steps will appear here once your application is processed.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="onboarding-loading">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3 items-center">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const sortedSteps = steps?.sort((a, b) => a.stepOrder - b.stepOrder) || [];
  const currentIndex = sortedSteps.findIndex((s) => s.status !== "completed");

  if (sortedSteps.length === 0) {
    return (
      <Card data-testid="card-no-steps">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <ClipboardList className="w-12 h-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No onboarding steps found for this deal.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-onboarding-steps">
      <CardHeader>
        <CardTitle className="text-base">Onboarding Steps</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {sortedSteps.map((step, index) => {
            const isCompleted = step.status === "completed";
            const isCurrent = index === currentIndex;
            const isLast = index === sortedSteps.length - 1;

            return (
              <div key={step.id} className="relative flex gap-3 pb-6" data-testid={`onboarding-step-${step.id}`}>
                <div className="flex flex-col items-center">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                    isCompleted
                      ? "bg-green-100 border-green-500 dark:bg-green-900 dark:border-green-400"
                      : isCurrent
                        ? "bg-blue-100 border-blue-500 dark:bg-blue-900 dark:border-blue-400"
                        : "bg-muted border-muted-foreground/30"
                  }`}>
                    {isCompleted ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/50" />
                    )}
                  </div>
                  {!isLast && (
                    <div className={`w-0.5 flex-1 mt-1 ${isCompleted ? "bg-green-500" : "bg-border"}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className={`text-sm font-medium ${isCompleted ? "text-foreground" : isCurrent ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} data-testid={`text-step-name-${step.id}`}>
                    {step.stepName}
                  </p>
                  {isCompleted && step.completedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-step-date-${step.id}`}>
                      Completed {formatDate(step.completedAt)}
                    </p>
                  )}
                  {isCurrent && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">In progress</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentsTab({ contactId }: { contactId: number | null | undefined }) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: allDocuments, isLoading } = useQuery<DocType[]>({
    queryKey: ["/api/documents"],
  });

  const documents = allDocuments?.filter(
    (d) => d.accessScope === "merchant" || d.type === "merchant_statement" || (contactId && d.contactId === contactId)
  ) || [];

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch("/api/merchant-portal/upload-statement", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      toast({ title: "Statement uploaded", description: `${selectedFile.name} has been uploaded successfully.` });
      setSelectedFile(null);
      const fileInput = document.querySelector('[data-testid="input-upload-file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="documents-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card data-testid="card-upload-section">
        <CardHeader>
          <CardTitle className="text-base">Upload Processing Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <Input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.csv"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              data-testid="input-upload-file"
            />
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              data-testid="button-upload-statement"
            >
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Uploading...</> : <><Upload className="w-4 h-4 mr-2" />Upload Statement</>}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card data-testid="card-documents-list">
        <CardHeader>
          <CardTitle className="text-base">Uploaded Documents</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[500px]">
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24 text-muted-foreground" data-testid="text-no-documents">
                    No documents uploaded yet
                  </TableCell>
                </TableRow>
              ) : (
                documents.map((doc) => (
                  <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                    <TableCell className="font-medium" data-testid={`text-doc-name-${doc.id}`}>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        {doc.fileName}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-doc-type-${doc.id}`}>
                      <Badge variant="secondary">{doc.type}</Badge>
                    </TableCell>
                    <TableCell data-testid={`text-doc-date-${doc.id}`}>{formatDate(doc.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`/api/documents/download/${doc.id}`, "_blank")}
                        data-testid={`button-download-doc-${doc.id}`}
                      >
                        <FileText className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function GettingStartedTab() {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  const sections = [
    {
      icon: PlayCircle,
      title: "Welcome to Liberty Bancard",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900",
      content: "Liberty Bancard is your payment processing partner. We specialize in finding real savings on your credit card processing costs through our proprietary statement review process. Unlike other processors, we don't just sell you a rate — we prove your real cost and fix it.\n\nThis portal is your home base to track your application, onboarding progress, uploaded documents, and get support whenever you need it.",
    },
    {
      icon: Clock,
      title: "What to Expect: Your Onboarding Timeline",
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-100 dark:bg-green-900",
      content: "Day 1–2: Application review and underwriting — we verify your business details and processing history.\n\nDay 3–5: Account approval and terminal/gateway setup — your MID (Merchant ID) is assigned.\n\nDay 5–7: Go-live — your new processing begins. You'll see your first batch settlement within 24–48 hours.\n\nDay 14: First check-in — we review your first two weeks of processing to ensure everything is running smoothly.\n\nDay 30: Full review — we compare your actual savings against your old statement to confirm results.",
    },
    {
      icon: FileText,
      title: "Documents You May Need",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-100 dark:bg-amber-900",
      content: "• Recent processing statement (last 3 months preferred)\n• Voided check or bank letter for deposit account\n• Government-issued ID for business owner(s)\n• Business license or articles of incorporation\n• Tax ID / EIN documentation\n\nYou can upload any of these in the 'My Documents' tab. Our team will let you know if anything else is needed.",
    },
    {
      icon: Shield,
      title: "Security & Compliance",
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-100 dark:bg-purple-900",
      content: "Your data is protected with bank-level encryption. We never store full card numbers or sensitive authentication data. Our platform is designed to support PCI DSS compliance, and we'll guide you through a simple self-assessment to make sure your business stays compliant.\n\nAll communications are logged for your protection, and you can request copies of any documents or data at any time.",
    },
    {
      icon: Zap,
      title: "Getting the Most from Your Account",
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-100 dark:bg-orange-900",
      content: "• Check your onboarding progress regularly — each step gets you closer to go-live.\n• Upload your processing statement early — it speeds up the savings analysis.\n• Use the Support tab to create tickets for any issues — our team responds within 4 business hours.\n• Ask about our Cash Discount and Surcharging programs — they can eliminate processing costs entirely for qualifying merchants.\n• Refer other business owners through our referral program and earn bonuses.",
    },
    {
      icon: Star,
      title: "Why Merchants Choose Liberty Bancard",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-100 dark:bg-emerald-900",
      content: "• Free statement review with transparent savings analysis — no obligation.\n• Multiple program options: Cash Discount, Interchange Plus, and Tiered Reduction.\n• Dedicated account manager for ongoing support.\n• Next-day funding available for qualifying merchants.\n• No long-term contracts or hidden fees — we earn your business every month.\n• 24/7 terminal support and rapid equipment replacement.",
    },
  ];

  return (
    <div className="space-y-4" data-testid="getting-started-tab">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Getting Started with Liberty Bancard
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Everything you need to know about your merchant account, onboarding process, and what to expect.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg overflow-hidden border bg-black" data-testid="merchant-video">
            <video
              src={merchantVideo}
              controls
              className="w-full aspect-video"
              poster=""
              preload="metadata"
              data-testid="video-merchant-explainer"
            >
              Your browser does not support video playback.
            </video>
            <div className="bg-muted/50 px-4 py-2">
              <p className="text-xs font-medium">Welcome to Liberty Bancard</p>
              <p className="text-[11px] text-muted-foreground">Watch this short video to learn what to expect as a new merchant and how to get the most from your account.</p>
            </div>
          </div>

          {sections.map((section, i) => {
            const Icon = section.icon;
            const isExpanded = expandedSection === i;
            return (
              <div key={i} className="border rounded-lg overflow-hidden" data-testid={`guide-section-${i}`}>
                <button
                  className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedSection(isExpanded ? null : i)}
                  data-testid={`guide-toggle-${i}`}
                >
                  <div className={`w-9 h-9 rounded-lg ${section.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4.5 h-4.5 ${section.color}`} />
                  </div>
                  <span className="text-sm font-semibold text-left flex-1">{section.title}</span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 pl-16">
                    <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{section.content}</p>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <HelpCenter context="merchant" />
    </div>
  );
}

function SupportTab({ contactId }: { contactId: number | null | undefined }) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({ subject: "", description: "", priority: "Normal" });

  const { data: ticketsRes, isLoading } = useQuery<{ data: Ticket[]; total: number }>({
    queryKey: ["/api/tickets"],
  });
  const allTickets = ticketsRes?.data;

  const tickets = contactId
    ? allTickets?.filter((t) => t.contactId === contactId)
    : [];

  const createMutation = useMutation({
    mutationFn: async (data: { subject: string; description: string; priority: string; contactId?: number }) => {
      const res = await apiRequest("POST", "/api/tickets", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setCreateOpen(false);
      setNewTicket({ subject: "", description: "", priority: "Normal" });
      toast({ title: "Ticket created", description: "Your support ticket has been submitted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create ticket.", variant: "destructive" });
    },
  });

  const handleCreateTicket = () => {
    if (!newTicket.subject || !newTicket.description) {
      toast({ title: "Missing fields", description: "Please fill in subject and description.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      subject: newTicket.subject,
      description: newTicket.description,
      priority: newTicket.priority,
      ...(contactId ? { contactId } : {}),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="support-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-ticket">
              <Plus className="w-4 h-4 mr-2" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Support Ticket</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                  placeholder="Brief description of your issue"
                  data-testid="input-ticket-subject"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={newTicket.description}
                  onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                  placeholder="Provide details about your issue"
                  data-testid="input-ticket-description"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={newTicket.priority} onValueChange={(v) => setNewTicket({ ...newTicket, priority: v })}>
                  <SelectTrigger data-testid="select-ticket-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleCreateTicket} disabled={createMutation.isPending} data-testid="button-submit-ticket">
                  {createMutation.isPending ? "Submitting..." : "Submit Ticket"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card data-testid="card-tickets-list">
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[500px]">
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!tickets || tickets.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24 text-muted-foreground" data-testid="text-no-tickets">
                    No support tickets
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((ticket) => (
                  <TableRow key={ticket.id} data-testid={`row-ticket-${ticket.id}`}>
                    <TableCell className="font-medium" data-testid={`text-ticket-subject-${ticket.id}`}>{ticket.subject}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" data-testid={`badge-ticket-status-${ticket.id}`}>
                        {ticket.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ticket.priority === "Urgent" ? "destructive" : "secondary"} data-testid={`badge-ticket-priority-${ticket.id}`}>
                        {ticket.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm" data-testid={`text-ticket-date-${ticket.id}`}>
                      {formatDate(ticket.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MerchantPortal() {
  const [activeTab, setActiveTab] = useState<TabKey>("guide");
  const { user } = useAuth();

  const { data: profile, isLoading: profileLoading } = useQuery<MerchantProfile | null>({
    queryKey: ["/api/merchant-profile"],
    queryFn: async () => {
      const res = await fetch("/api/merchant-profile", { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-portal-title">Merchant Portal</h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="text-portal-subtitle">
          {user?.email ? `Welcome, ${user.firstName || user.email}` : "Manage your merchant account"}
        </p>
      </div>

      <div className="flex gap-1 flex-wrap border-b pb-0" data-testid="tab-navigation">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <Button
              key={tab.key}
              variant="ghost"
              className={`rounded-b-none gap-2 ${isActive ? "border-b-2 border-primary" : ""}`}
              onClick={() => setActiveTab(tab.key)}
              data-testid={`tab-${tab.key}`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </Button>
          );
        })}
      </div>

      <div data-testid={`tab-content-${activeTab}`}>
        {activeTab === "guide" && (
          <GettingStartedTab />
        )}
        {activeTab === "account" && (
          <AccountTab profile={profile} isLoading={profileLoading} />
        )}
        {activeTab === "onboarding" && (
          <OnboardingTab dealId={profile?.dealId} />
        )}
        {activeTab === "documents" && (
          <DocumentsTab contactId={profile?.contactId} />
        )}
        {activeTab === "support" && (
          <SupportTab contactId={profile?.contactId} />
        )}
      </div>
    </div>
  );
}
