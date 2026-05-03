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
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  User, ClipboardList, FileText, Headphones,
  CheckCircle, Circle, Loader2, Plus, Upload,
  Calendar, Hash, CreditCard, Activity, ArrowRight,
  PlayCircle, BookOpen, ChevronDown, ChevronUp, Shield, Clock, Zap, Star,
  Phone, Mail, AlertCircle, FileCheck, CheckCircle2, Gift, Copy, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import type { MerchantProfile, OnboardingStep, Ticket, MerchantReferral } from "@shared/schema";
import type { Document as DocType } from "@shared/schema";
import { HelpCenter } from "@/components/HelpCenter";

type TabKey = "guide" | "account" | "onboarding" | "documents" | "support" | "referrals";

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "guide", label: "Getting Started", icon: BookOpen },
  { key: "account", label: "My Account", icon: User },
  { key: "onboarding", label: "Onboarding Progress", icon: ClipboardList },
  { key: "documents", label: "My Documents", icon: FileText },
  { key: "support", label: "Support", icon: Headphones },
  { key: "referrals", label: "Refer & Earn", icon: Gift },
];

function getStatusBadgeVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active": return "default";
    case "pending": return "secondary";
    case "under_review": return "outline";
    case "suspended": return "destructive";
    default: return "secondary";
  }
}

function getStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active": return "Active";
    case "pending": return "Pending Review";
    case "under_review": return "Under Review";
    case "suspended": return "Suspended";
    default: return "Pending";
  }
}

function getStatusColor(status: string | null | undefined): string {
  switch (status) {
    case "active": return "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800";
    case "under_review": return "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800";
    case "suspended": return "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800";
    default: return "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800";
  }
}

function getStatusTextColor(status: string | null | undefined): string {
  switch (status) {
    case "active": return "text-emerald-700 dark:text-emerald-300";
    case "under_review": return "text-blue-700 dark:text-blue-300";
    case "suspended": return "text-red-700 dark:text-red-300";
    default: return "text-amber-700 dark:text-amber-300";
  }
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function AccountStatusBanner({ profile, isLoading }: { profile: MerchantProfile | null | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="sticky top-14 z-20 rounded-lg border p-3 mb-2">
        <Skeleton className="h-5 w-48" />
      </div>
    );
  }

  const status = profile?.accountStatus || "pending";
  const colorClass = getStatusColor(status);
  const textColorClass = getStatusTextColor(status);

  return (
    <div
      className={`sticky top-14 z-20 rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3 ${colorClass}`}
      data-testid="account-status-banner"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge variant={getStatusBadgeVariant(status)} className="shrink-0" data-testid="banner-status-badge">
          {getStatusLabel(status)}
        </Badge>
        {profile?.merchantMid && (
          <span className="text-sm font-mono text-muted-foreground flex items-center gap-1 shrink-0" data-testid="banner-mid">
            <Hash className="w-3 h-3" />
            MID: {profile.merchantMid}
          </span>
        )}
        {!profile?.merchantMid && (
          <span className={`text-xs ${textColorClass}`} data-testid="banner-mid-pending">
            {status === "pending" ? "MID will be assigned after approval" : status === "under_review" ? "Application under review" : ""}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
        <a href="tel:9542668214" className="flex items-center gap-1 hover:text-foreground transition-colors" data-testid="banner-rep-phone">
          <Phone className="w-3 h-3" />
          954-266-8214
        </a>
        <a href="mailto:support@libertybancard.com" className="flex items-center gap-1 hover:text-foreground transition-colors hidden sm:flex" data-testid="banner-rep-email">
          <Mail className="w-3 h-3" />
          support@libertybancard.com
        </a>
      </div>
    </div>
  );
}

function AdminMidEditor({ profile }: { profile: MerchantProfile }) {
  const { toast } = useToast();
  const [value, setValue] = useState(profile.merchantMid || "");
  const [editing, setEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: async (mid: string) => {
      const res = await apiRequest("PATCH", `/api/merchant-profiles/${profile.id}`, { merchantMid: mid });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-profile"] });
      toast({ title: "MID updated", description: "Merchant MID saved." });
      setEditing(false);
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  if (!editing) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setValue(profile.merchantMid || ""); setEditing(true); }}
        data-testid="button-admin-edit-mid"
      >
        Edit MID
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter MID"
        className="font-mono h-8 text-sm w-48"
        data-testid="input-admin-mid"
      />
      <Button
        size="sm"
        onClick={() => mutation.mutate(value.trim())}
        disabled={mutation.isPending}
        data-testid="button-save-admin-mid"
      >
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid="button-cancel-admin-mid">
        Cancel
      </Button>
    </div>
  );
}

function AccountTab({ profile, isLoading, isAdmin }: { profile: MerchantProfile | null | undefined; isLoading: boolean; isAdmin: boolean }) {
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
          <CardTitle className="text-base">Account Overview</CardTitle>
          <Badge variant={getStatusBadgeVariant(profile.accountStatus)} data-testid="badge-account-status">
            {getStatusLabel(profile.accountStatus)}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">MID Number</p>
              <p className="text-sm font-medium flex items-center gap-2" data-testid="text-mid-number">
                <Hash className="w-4 h-4 text-muted-foreground" />
                {profile.merchantMid || "Not assigned yet"}
              </p>
              {isAdmin && <AdminMidEditor profile={profile} />}
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

      <Card data-testid="card-account-rep">
        <CardHeader>
          <CardTitle className="text-base">Your Account Representative</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="font-semibold text-foreground" data-testid="text-rep-name">Liberty Bancard Support Team</p>
                <p className="text-sm text-muted-foreground">Dedicated merchant success team</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a href="tel:9542668214" className="flex items-center gap-2 text-sm hover:text-primary transition-colors" data-testid="link-rep-phone">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  954-266-8214
                </a>
                <a href="mailto:support@libertybancard.com" className="flex items-center gap-2 text-sm hover:text-primary transition-colors" data-testid="link-rep-email">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  support@libertybancard.com
                </a>
              </div>
              <p className="text-xs text-muted-foreground">Response within 4 business hours · Available Mon–Fri 9am–6pm ET</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {profile.accountStatus === "active" && (
        <Card data-testid="card-processing-history">
          <CardHeader>
            <CardTitle className="text-base">Processing Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Monthly Volume</p>
                <p className="text-lg font-bold text-foreground" data-testid="text-summary-volume">
                  {profile.currentMonthlyVolume ? `$${Number(profile.currentMonthlyVolume).toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Last Statement</p>
                <p className="text-sm font-medium text-foreground" data-testid="text-last-statement">
                  {formatDate(profile.lastStatementDate)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Next Statement</p>
                <p className="text-sm font-medium text-foreground" data-testid="text-next-statement">
                  {formatDate(profile.nextStatementDate)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OnboardingTab({ dealId, profile }: { dealId: number | null | undefined; profile: MerchantProfile | null | undefined }) {
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
  const completedCount = sortedSteps.filter(s => s.status === "completed").length;
  const currentIndex = sortedSteps.findIndex((s) => s.status !== "completed");
  const progressPct = sortedSteps.length > 0 ? Math.round((completedCount / sortedSteps.length) * 100) : 0;

  const getActionForStep = (step: OnboardingStep): string | null => {
    const name = step.stepName?.toLowerCase() || "";
    if (name.includes("voided check") || name.includes("bank")) return "Upload to Documents tab";
    if (name.includes("statement")) return "Upload to Documents tab";
    if (name.includes("id") || name.includes("identification")) return "Upload to Documents tab";
    if (name.includes("sign") || name.includes("agreement")) return "Check your email";
    if (name.includes("terminal") || name.includes("equipment")) return "Our team will contact you";
    return null;
  };

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
    <div className="space-y-4">
      <Card data-testid="card-onboarding-progress-summary">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-foreground">{completedCount} of {sortedSteps.length} steps complete</p>
              <p className="text-xs text-muted-foreground">Account status: {getStatusLabel(profile?.accountStatus)}</p>
            </div>
            <span className="text-lg font-bold text-primary">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-2.5" data-testid="onboarding-progress-bar" />
        </CardContent>
      </Card>

      <Card data-testid="card-onboarding-steps">
        <CardHeader>
          <CardTitle className="text-base">Your Onboarding Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {sortedSteps.map((step, index) => {
              const isCompleted = step.status === "completed";
              const isCurrent = index === currentIndex;
              const isLast = index === sortedSteps.length - 1;
              const actionText = getActionForStep(step);

              return (
                <div key={step.id} className="relative flex gap-3 pb-5" data-testid={`onboarding-step-${step.id}`}>
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
                      <div className={`w-0.5 flex-1 mt-1 ${isCompleted ? "bg-green-400" : "bg-border"}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5 pb-1">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${isCompleted ? "text-muted-foreground line-through" : isCurrent ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`} data-testid={`text-step-name-${step.id}`}>
                        {step.stepName}
                      </p>
                      <Badge
                        variant={isCompleted ? "secondary" : isCurrent ? "default" : "outline"}
                        className="text-xs shrink-0"
                        data-testid={`badge-step-status-${step.id}`}
                      >
                        {isCompleted ? "Complete" : isCurrent ? "In Progress" : "Pending"}
                      </Badge>
                    </div>
                    {isCompleted && step.completedAt && (
                      <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-step-date-${step.id}`}>
                        Completed {formatDate(step.completedAt)}
                      </p>
                    )}
                    {isCurrent && actionText && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1" data-testid={`text-step-action-${step.id}`}>
                        <ArrowRight className="w-3 h-3 shrink-0" />
                        {actionText}
                      </p>
                    )}
                    {!isCompleted && !isCurrent && (
                      <p className="text-xs text-muted-foreground mt-0.5">Waiting for previous steps</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const MAX_FILE_SIZE_MB = 20;
const ACCEPTED_TYPES = ".pdf, .png, .jpg, .jpeg, .csv";

function DocumentsTab({ contactId }: { contactId: number | null | undefined }) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);

  const { data: allDocuments, isLoading } = useQuery<DocType[]>({
    queryKey: ["/api/documents"],
  });

  const documents = allDocuments?.filter(
    (d) => d.accessScope === "merchant" || d.type === "merchant_statement" || (contactId && d.contactId === contactId)
  ) || [];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFileError(null);
    if (file) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setFileError(`File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
        setSelectedFile(null);
        e.target.value = "";
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["pdf", "png", "jpg", "jpeg", "csv"].includes(ext || "")) {
        setFileError("Invalid file type. Please upload a PDF, PNG, JPG, JPEG, or CSV.");
        setSelectedFile(null);
        e.target.value = "";
        return;
      }
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadProgress(10);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      setUploadProgress(30);
      const res = await fetch("/api/merchant-portal/upload-statement", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      setUploadProgress(80);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      setUploadProgress(100);
      const newDoc = await res.json().catch(() => null);
      toast({ title: "Statement uploaded", description: `${selectedFile.name} has been uploaded successfully.` });
      setSelectedFile(null);
      setUploadProgress(0);
      const fileInput = document.querySelector('[data-testid="input-upload-file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    } catch (err: any) {
      setUploadProgress(0);
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
          <CardTitle className="text-base">Upload Document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.csv"
                onChange={handleFileChange}
                disabled={uploading}
                data-testid="input-upload-file"
                className="cursor-pointer"
              />
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span data-testid="text-accepted-types">
                  Accepted: PDF, PNG, JPG, JPEG, CSV
                </span>
                <span data-testid="text-max-size">
                  Max size: {MAX_FILE_SIZE_MB} MB
                </span>
              </div>
              {fileError && (
                <p className="text-xs text-destructive flex items-center gap-1" data-testid="text-file-error">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {fileError}
                </p>
              )}
            </div>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || uploading || !!fileError}
              data-testid="button-upload-statement"
              className="shrink-0"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Uploading...</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" />Upload</>
              )}
            </Button>
          </div>
          {uploading && (
            <div className="space-y-1" data-testid="upload-progress-container">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Uploading {selectedFile?.name}...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1.5" data-testid="upload-progress-bar" />
            </div>
          )}
        </CardContent>
      </Card>
      <Card data-testid="card-documents-list">
        <CardHeader>
          <CardTitle className="text-base">Uploaded Documents</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="sm:min-w-[480px]">
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
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
                      <div className="flex items-center gap-2 max-w-[200px]">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{doc.fileName}</span>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-doc-type-${doc.id}`}>
                      <Badge variant="secondary" className="text-xs">{doc.type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-doc-date-${doc.id}`}>{formatDate(doc.createdAt)}</TableCell>
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

type StepMeta = { action: string; href?: string; hrefLabel?: string; eta: string; tabTarget?: string };

function getStepMeta(step: OnboardingStep): StepMeta {
  const name = step.stepName?.toLowerCase() || "";
  if (name.includes("voided check") || name.includes("bank")) {
    return { action: "Upload a voided check or bank letter to verify your deposit account.", hrefLabel: "Go to Documents", href: "#documents", eta: "Today", tabTarget: "documents" };
  }
  if (name.includes("statement")) {
    return { action: "Upload your most recent processing statement so we can complete your analysis.", hrefLabel: "Go to Documents", href: "#documents", eta: "Today", tabTarget: "documents" };
  }
  if (name.includes("id") || name.includes("identification")) {
    return { action: "Upload a government-issued photo ID for the primary business owner.", hrefLabel: "Go to Documents", href: "#documents", eta: "Today", tabTarget: "documents" };
  }
  if (name.includes("sign") || name.includes("agreement") || name.includes("mpa")) {
    return { action: "Check your email for the Merchant Processing Agreement and complete the e-signature.", eta: "Today — check your inbox" };
  }
  if (name.includes("terminal") || name.includes("equipment")) {
    return { action: "Our team will contact you to confirm your terminal or gateway setup.", eta: "3–5 business days" };
  }
  if (name.includes("review") || name.includes("underwriting") || name.includes("approval")) {
    return { action: "Our underwriting team will review your application. No action needed from you.", eta: "1–2 business days" };
  }
  if (name.includes("go-live") || name.includes("go live") || name.includes("activate")) {
    return { action: "You're almost live! Our team will confirm your go-live date.", eta: "5–7 business days" };
  }
  return { action: "Our team is working on this step and will update you shortly.", eta: "1–3 business days" };
}

function GettingStartedTab({ dealId, profile, onTabChange }: { dealId: number | null | undefined; profile: MerchantProfile | null | undefined; onTabChange?: (tab: string) => void }) {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  const { data: steps, isLoading: stepsLoading } = useQuery<OnboardingStep[]>({
    queryKey: ["/api/onboarding-steps/deal", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding-steps/deal/${dealId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!dealId,
  });

  const sortedSteps = steps?.sort((a, b) => a.stepOrder - b.stepOrder) || [];
  const completedCount = sortedSteps.filter(s => s.status === "completed").length;
  const currentStep = sortedSteps.find(s => s.status !== "completed");

  const staticSections = [
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
      {stepsLoading && dealId && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {sortedSteps.length > 0 && (
        <Card data-testid="card-dynamic-checklist">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              Your Getting Started Checklist
              <Badge variant="secondary" className="ml-auto" data-testid="checklist-progress-badge">
                {completedCount}/{sortedSteps.length} done
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {currentStep && (
              <div className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 mb-3" data-testid="current-step-action">
                <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Action needed: {currentStep.stepName}</p>
                  <p className="text-xs text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                    Complete this step to keep your onboarding on track.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {sortedSteps.map((step, i) => {
                const isComplete = step.status === "completed";
                const isCurrent = step.id === currentStep?.id;
                const meta = getStepMeta(step);
                return (
                  <div
                    key={step.id}
                    className={`rounded-md border p-3 ${
                      isComplete
                        ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                        : isCurrent
                        ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                        : "bg-muted/30 border-muted"
                    }`}
                    data-testid={`checklist-step-${step.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        isComplete ? "bg-green-500" : isCurrent ? "bg-blue-500" : "bg-muted-foreground/20"
                      }`}>
                        {isComplete ? (
                          <CheckCircle className="w-3 h-3 text-white" />
                        ) : isCurrent ? (
                          <Loader2 className="w-3 h-3 text-white animate-spin" />
                        ) : (
                          <Circle className="w-3 h-3 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className={`text-sm font-medium ${isComplete ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {step.stepName}
                          </p>
                          <Badge
                            variant={isComplete ? "secondary" : isCurrent ? "default" : "outline"}
                            className="text-xs shrink-0"
                            data-testid={`checklist-badge-${step.id}`}
                          >
                            {isComplete ? "Done" : isCurrent ? "Now" : "Pending"}
                          </Badge>
                        </div>
                        {isComplete && step.completedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">Completed {formatDate(step.completedAt)}</p>
                        )}
                        {!isComplete && (
                          <div className="mt-1.5 space-y-1.5">
                            <p className="text-xs text-muted-foreground leading-snug" data-testid={`checklist-action-${step.id}`}>
                              {meta.action}
                            </p>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-[11px] text-muted-foreground flex items-center gap-1" data-testid={`checklist-eta-${step.id}`}>
                                <Clock className="w-3 h-3 shrink-0" />
                                ETA: {meta.eta}
                              </span>
                              {isCurrent && meta.tabTarget && onTabChange && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2 py-0"
                                  onClick={() => onTabChange(meta.tabTarget!)}
                                  data-testid={`checklist-action-btn-${step.id}`}
                                >
                                  <ArrowRight className="w-3 h-3 mr-1" />
                                  {meta.hrefLabel || "Take action"}
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
          {staticSections.map((section, i) => {
            const Icon = section.icon;
            const isExpanded = expandedSection === i;
            return (
              <div key={i} className="border rounded-lg overflow-hidden" data-testid={`guide-section-${i}`}>
                <button
                  className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedSection(isExpanded ? null : i)}
                  data-testid={`guide-toggle-${i}`}
                >
                  <div className={`w-9 h-9 rounded-lg ${section.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4.5 h-4.5 ${section.color}`} />
                  </div>
                  <span className="text-sm font-semibold flex-1">{section.title}</span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
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

function ReferralTab({ profile }: { profile: MerchantProfile | null | undefined }) {
  const { toast } = useToast();
  const [referredEmail, setReferredEmail] = useState("");
  const [referredName, setReferredName] = useState("");
  const [referredCompany, setReferredCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { data: referralData, isLoading, refetch } = useQuery<{
    profile: { referralCode: string | null; referralCredits: string | null; referralCount: number | null };
    referrals: MerchantReferral[];
  }>({
    queryKey: ["/api/merchant-portal/referrals"],
  });

  const generateCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/merchant-portal/referral-code", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-portal/referrals"] });
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const referralCode = referralData?.profile?.referralCode || null;
  const credits = parseFloat(referralData?.profile?.referralCredits || "0");
  const referralCount = referralData?.profile?.referralCount || 0;
  const referrals = referralData?.referrals || [];

  const referralLink = referralCode ? `${window.location.origin}/refer/${referralCode}` : null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied!", description: "Referral link copied to clipboard." });
    });
  };

  const handleSubmitReferral = async () => {
    if (!referralCode || !referredEmail) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/merchant-referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralCode, referredEmail, referredName, referredCompany }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } else {
        setSubmitted(true);
        setReferredEmail("");
        setReferredName("");
        setReferredCompany("");
        queryClient.invalidateQueries({ queryKey: ["/api/merchant-portal/referrals"] });
        toast({ title: "Referral sent!", description: "We'll notify you when they sign up." });
      }
    } catch {
      toast({ title: "Error", description: "Failed to submit referral.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    if (s === "activated" || s === "credited") return "default";
    if (s === "pending") return "secondary";
    return "outline";
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="referral-tab">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card data-testid="card-referral-credits">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Credits Earned</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-credits-amount">
              ${credits.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-total-referrals">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Referrals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold" data-testid="text-referral-count">{referralCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-reward-per-referral">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Reward Per Referral</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">$50</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-your-code">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary" />
            Your Referral Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {referralCode ? (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <code className="block text-2xl font-mono font-bold tracking-widest text-primary" data-testid="text-referral-code">
                    {referralCode}
                  </code>
                </div>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(referralCode)} data-testid="button-copy-code">
                  <Copy className="w-4 h-4 mr-1" /> Copy Code
                </Button>
              </div>
              {referralLink && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">{referralLink}</p>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(referralLink)} data-testid="button-copy-link">
                    <ExternalLink className="w-4 h-4 mr-1" /> Copy Link
                  </Button>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Share this code with other business owners. You earn <strong>$50 in credits</strong> for every merchant who activates their account using your code.
              </p>
            </>
          ) : (
            <div className="text-center space-y-3 py-4">
              <p className="text-sm text-muted-foreground">Generate your unique referral code to start earning.</p>
              <Button onClick={() => generateCodeMutation.mutate()} disabled={generateCodeMutation.isPending} data-testid="button-generate-code">
                {generateCodeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generate My Referral Code
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {referralCode && (
        <Card data-testid="card-send-referral">
          <CardHeader>
            <CardTitle className="text-base">Invite a Business Owner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitted ? (
              <div className="text-center py-4 space-y-2">
                <CheckCircle className="w-8 h-8 text-green-500 mx-auto" />
                <p className="text-sm font-medium">Referral submitted!</p>
                <Button variant="outline" size="sm" onClick={() => setSubmitted(false)}>Send Another</Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Their Email *</Label>
                    <Input value={referredEmail} onChange={(e) => setReferredEmail(e.target.value)} placeholder="friend@business.com" data-testid="input-referred-email" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Their Name (optional)</Label>
                    <Input value={referredName} onChange={(e) => setReferredName(e.target.value)} placeholder="Jane Smith" data-testid="input-referred-name" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Business Name (optional)</Label>
                    <Input value={referredCompany} onChange={(e) => setReferredCompany(e.target.value)} placeholder="Smith's Bakery" data-testid="input-referred-company" />
                  </div>
                </div>
                <Button onClick={handleSubmitReferral} disabled={!referredEmail || submitting} className="w-full" data-testid="button-submit-referral">
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Send Referral
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {referrals.length > 0 && (
        <Card data-testid="card-referral-history">
          <CardHeader>
            <CardTitle className="text-base">Referral History</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[400px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reward</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.map((r) => (
                  <TableRow key={r.id} data-testid={`row-referral-${r.id}`}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{r.referredName || "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.referredEmail}</p>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(r.status || "pending")} className="capitalize">{r.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(r.createdAt!).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm">
                      {r.status === "credited" ? (
                        <span className="text-green-600 font-medium">+${r.creditAmount}</span>
                      ) : "Pending"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
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
          <Table className="sm:min-w-[480px]">
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-portal-title">Merchant Portal</h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="text-portal-subtitle">
          {user ? `Welcome, ${user.firstName || user.email}` : "Manage your merchant account"}
        </p>
      </div>

      <AccountStatusBanner profile={profile} isLoading={profileLoading} />

      <div className="flex gap-0.5 flex-wrap border-b pb-0 overflow-x-auto" data-testid="tab-navigation">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <Button
              key={tab.key}
              variant="ghost"
              size="sm"
              className={`rounded-b-none gap-1.5 shrink-0 ${isActive ? "border-b-2 border-primary font-semibold" : ""}`}
              onClick={() => setActiveTab(tab.key)}
              data-testid={`tab-${tab.key}`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{tab.label}</span>
            </Button>
          );
        })}
      </div>

      <div data-testid={`tab-content-${activeTab}`}>
        {activeTab === "guide" && (
          <GettingStartedTab dealId={profile?.dealId} profile={profile} onTabChange={(tab) => setActiveTab(tab as TabKey)} />
        )}
        {activeTab === "account" && (
          <AccountTab profile={profile} isLoading={profileLoading} isAdmin={user?.role === "admin" || user?.role === "manager"} />
        )}
        {activeTab === "onboarding" && (
          <OnboardingTab dealId={profile?.dealId} profile={profile} />
        )}
        {activeTab === "documents" && (
          <DocumentsTab contactId={profile?.contactId} />
        )}
        {activeTab === "support" && (
          <SupportTab contactId={profile?.contactId} />
        )}
        {activeTab === "referrals" && (
          <ReferralTab profile={profile} />
        )}
      </div>
    </div>
  );
}
