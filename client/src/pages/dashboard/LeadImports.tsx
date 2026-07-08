import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { DataState } from "@/components/ui/data-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2,
  TrendingUp, Users, Database, BarChart3, Flame, Thermometer, Snowflake,
  Calendar, ArrowRight, FileText, RefreshCw, ListChecks, OctagonAlert,
} from "lucide-react";
import type { CsvImport } from "@shared/schema";

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "--";
  return new Date(date).toLocaleString();
}

function getStatusBadge(status: string | null) {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-green-600" data-testid="badge-status-completed"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
    case "processing":
      return <Badge variant="default" className="bg-blue-600" data-testid="badge-status-processing"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing</Badge>;
    case "failed":
      return <Badge variant="destructive" data-testid="badge-status-failed"><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case "interrupted":
      return <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" data-testid="badge-status-interrupted"><OctagonAlert className="h-3 w-3 mr-1" />Interrupted</Badge>;
    case "legacy_interrupted":
      return <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" data-testid="badge-status-legacy-interrupted"><OctagonAlert className="h-3 w-3 mr-1" />Legacy (Partial)</Badge>;
    case "stale":
      return <Badge variant="outline" className="border-orange-500 text-orange-700 dark:text-orange-400" data-testid="badge-status-stale"><OctagonAlert className="h-3 w-3 mr-1" />Stale</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-status-unknown">{status || "unknown"}</Badge>;
  }
}

const INTERRUPTED_STATUSES = new Set(["interrupted", "legacy_interrupted", "stale"]);

/** Returns true when the duplicate/invalid/skipped/errors buckets cannot be
 *  trusted (they are null or the import is a legacy_interrupted record where
 *  they were never computed). Used to render "—" instead of 0. */
function hasUnknownBuckets(imp: CsvImport): boolean {
  if (imp.status === "legacy_interrupted") return true;
  if (INTERRUPTED_STATUSES.has(imp.status ?? "")) {
    return imp.duplicatesSkipped == null || imp.invalidRows == null;
  }
  return false;
}

function fmtOrUnknown(value: number | null | undefined, imp: CsvImport): string {
  if (hasUnknownBuckets(imp) && value == null) return "—";
  return (value ?? 0).toLocaleString();
}

function getOutcomeSummary(imp: CsvImport): { label: string; className: string } {
  if (imp.status === "failed") {
    return { label: "Import failed — server/API error", className: "text-red-600 dark:text-red-400" };
  }
  if (imp.status === "processing") {
    const processed = imp.processedRows ?? 0;
    if (processed > 0 && imp.lastProgressAt) {
      const ageSec = Math.round((Date.now() - new Date(imp.lastProgressAt).getTime()) / 1000);
      const ageText = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
      return { label: `In progress — ${processed.toLocaleString()} rows processed (last progress ${ageText})`, className: "text-blue-600 dark:text-blue-400" };
    }
    if (processed > 0) {
      return { label: `In progress — ${processed.toLocaleString()} rows processed so far`, className: "text-blue-600 dark:text-blue-400" };
    }
    return { label: "Processing...", className: "text-blue-600 dark:text-blue-400" };
  }
  if (INTERRUPTED_STATUSES.has(imp.status ?? "")) {
    const created = imp.newRecords ?? 0;
    const processed = imp.processedRows ?? created;
    const total = imp.totalRows ?? 0;
    const unprocessed = total > 0 ? Math.max(0, total - processed) : null;
    const isUnknownBuckets = imp.status === "legacy_interrupted" || (imp.duplicatesSkipped == null && imp.invalidRows == null);
    let label = `Created: ${created.toLocaleString()}`;
    if (unprocessed !== null && unprocessed > 0) {
      label += ` | Unprocessed (import interrupted): ${unprocessed.toLocaleString()}`;
    }
    if (isUnknownBuckets) {
      label += " | Already Exists: unavailable | Invalid: unavailable";
    }
    return { label, className: "text-amber-600 dark:text-amber-400" };
  }
  const total = imp.totalRows ?? 0;
  if (total === 0) return { label: "--", className: "text-muted-foreground" };

  const newRecords = imp.newRecords ?? 0;
  const alreadyExists = (imp.duplicatesSkipped ?? 0) + (imp.skippedRows ?? 0);
  const invalidOrErrored = (imp.invalidRows ?? 0) + (imp.errorsCount ?? 0);

  if (newRecords === 0 && alreadyExists > 0 && invalidOrErrored === 0) {
    return {
      label: `Processed successfully — no new contacts, ${alreadyExists.toLocaleString()} already exist`,
      className: "text-blue-600 dark:text-blue-400",
    };
  }
  if (newRecords === 0 && invalidOrErrored === total) {
    return { label: "Completed — all rows invalid", className: "text-amber-600 dark:text-amber-400" };
  }
  if (invalidOrErrored > 0) {
    return {
      label: `${newRecords.toLocaleString()} new, ${invalidOrErrored.toLocaleString()} invalid`,
      className: "text-amber-600 dark:text-amber-400",
    };
  }
  return { label: `${newRecords.toLocaleString()} new contacts added`, className: "text-green-600 dark:text-green-400" };
}

function VerticalBreakdownChart({ breakdown }: { breakdown: Record<string, number> | null }) {
  if (!breakdown || Object.keys(breakdown).length === 0) return null;

  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);

  const verticalColors: Record<string, string> = {
    "Restaurant": "bg-orange-500",
    "Auto": "bg-blue-500",
    "Healthcare": "bg-green-500",
    "Salon/Spa": "bg-pink-500",
    "Construction": "bg-yellow-600",
    "Retail": "bg-purple-500",
    "Legal": "bg-slate-600",
    "Technology": "bg-cyan-500",
    "Real Estate": "bg-emerald-500",
    "Fitness/Recreation": "bg-red-500",
    "Food/Beverage": "bg-amber-500",
    "Professional Services": "bg-indigo-500",
    "Other": "bg-gray-400",
  };

  return (
    <div className="space-y-2" data-testid="vertical-breakdown">
      {sorted.slice(0, 10).map(([vertical, count]) => {
        const pct = Math.round((count / total) * 100);
        const color = verticalColors[vertical] || "bg-gray-400";
        return (
          <div key={vertical} className="space-y-1" data-testid={`vertical-item-${vertical.toLowerCase().replace(/[/ ]/g, "-")}`}>
            <div className="flex justify-between text-xs">
              <span className="font-medium">{vertical}</span>
              <span className="text-muted-foreground">{count.toLocaleString()} ({pct}%)</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {sorted.length > 10 && (
        <p className="text-xs text-muted-foreground">+{sorted.length - 10} more verticals</p>
      )}
    </div>
  );
}

export default function LeadImports() {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [expandedImport, setExpandedImport] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: importsRaw,
    isLoading: importsLoading,
    isError: importsError,
    error: importsErrorObj,
    refetch: refetchImports,
  } = useQuery<CsvImport[]>({
    queryKey: ["/api/csv-imports"],
  });
  const imports = Array.isArray(importsRaw) ? importsRaw : [];

  const { data: importStats } = useQuery<{
    totalImports: number;
    totalRowsProcessed: number;
    totalRecordsImported: number;
    totalDuplicatesSkipped: number;
    totalSkippedRows: number;
    totalAlreadyExists: number;
    totalInvalidRows: number;
    totalErrors: number;
    totalDealsCreated: number;
    totalHot: number;
    totalWarm: number;
    verticalBreakdown: Record<string, number>;
  }>({
    queryKey: ["/api/csv-imports/stats"],
  });

  const markInterruptedMutation = useMutation({
    mutationFn: async (importId: number) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch(`/api/csv-imports/${importId}/mark-interrupted`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/csv-imports"] });
      toast({ title: "Import marked as interrupted", description: "The stuck import has been marked interrupted." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch("/api/leads/import-csv", {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(error.message);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/csv-imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/csv-imports/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      const inserted = data.inserted || 0;
      const alreadyExists = (data.duplicatesSkipped || 0) + (data.skippedRows || 0);
      const invalidOrErrored = (data.invalidRows || 0) + (data.errors || 0);

      let title = "Import Complete";
      let description = `${inserted.toLocaleString()} new contact(s) imported. ${data.dealsCreated || 0} deal(s) created. Format: ${data.sourceFormat?.replace(/_/g, " ")}`;

      if (inserted === 0 && alreadyExists > 0) {
        title = "Import Processed — No New Contacts";
        description = `All ${alreadyExists.toLocaleString()} row(s) already exist in your CRM — no new contacts were added.`;
        if (invalidOrErrored > 0) {
          description += ` ${invalidOrErrored.toLocaleString()} row(s) were invalid or skipped.`;
        }
      } else if (invalidOrErrored > 0) {
        description += ` ${invalidOrErrored.toLocaleString()} row(s) were invalid or skipped.`;
      }

      toast({ title, description });
    },
    onError: (err: Error) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    const isValid =
      /\.(csv|xlsx|xls)$/i.test(file.name) ||
      file.type === "text/csv" ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";
    if (!isValid) {
      toast({ title: "Invalid file type", description: "Please upload a CSV or Excel (.xlsx) file.", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    uploadMutation.mutate(formData);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file || null);
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Lead Imports</h1>
        <p className="text-muted-foreground mt-1" data-testid="text-page-description">
          Import leads from Outscraper, Apollo, or any CSV/Excel file. Auto-detects format, deduplicates, classifies verticals, scores leads, and creates deals for hot prospects.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card data-testid="card-stat-total-imports">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Imports</p>
                <p className="text-2xl font-bold" data-testid="text-total-imports">{importStats?.totalImports ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-rows-processed">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 dark:bg-slate-900/30 rounded-lg">
                <ListChecks className="h-5 w-5 text-slate-600 dark:text-slate-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Rows Processed</p>
                <p className="text-2xl font-bold" data-testid="text-total-rows-processed">{(importStats?.totalRowsProcessed ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-records-imported">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">New Contacts Added</p>
                <p className="text-2xl font-bold" data-testid="text-total-records">{(importStats?.totalRecordsImported ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-already-exists">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Already Exists</p>
                <p className="text-2xl font-bold" data-testid="text-total-already-exists">{(importStats?.totalAlreadyExists ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Duplicates + DB matches — not new, not a failure</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-invalid">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Invalid / Error Rows</p>
                <p className="text-2xl font-bold" data-testid="text-total-invalid">{((importStats?.totalInvalidRows ?? 0) + (importStats?.totalErrors ?? 0)).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-deals-created">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <TrendingUp className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Deals Created</p>
                <p className="text-2xl font-bold" data-testid="text-total-deals">{(importStats?.totalDealsCreated ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="text-stats-reconciliation">
        Total Rows Processed ({(importStats?.totalRowsProcessed ?? 0).toLocaleString()}) = New Contacts Added ({(importStats?.totalRecordsImported ?? 0).toLocaleString()}) + Already Exists ({(importStats?.totalAlreadyExists ?? 0).toLocaleString()}) + Invalid / Error Rows ({((importStats?.totalInvalidRows ?? 0) + (importStats?.totalErrors ?? 0)).toLocaleString()})
      </p>

      <Card data-testid="card-upload-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import CSV / Excel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                : "border-border hover:border-muted-foreground/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-csv-upload"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              data-testid="input-csv-file"
            />
            <div className="flex flex-col items-center gap-3">
              {selectedFile ? (
                <>
                  <FileSpreadsheet className="h-12 w-12 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-medium" data-testid="text-selected-filename">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-12 w-12 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Drag and drop a CSV or Excel file here, or click to browse</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Supports Outscraper (Google Maps), Apollo, and custom CSV/XLSX formats up to 300MB
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
              data-testid="button-import-csv"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Import File
                </>
              )}
            </Button>
            {selectedFile && (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                data-testid="button-clear-file"
              >
                Clear
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground space-y-1 border-t pt-3 mt-3">
            <p className="font-medium">Supported CSV/Excel Formats (auto-detected):</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
              <div className="flex items-start gap-2">
                <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-blue-500" />
                <span><strong>Outscraper / Google Maps:</strong> Name, Telephone, Category, Rating, Reviews, Address</span>
              </div>
              <div className="flex items-start gap-2">
                <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-green-500" />
                <span><strong>Apollo / Lead List:</strong> First Name, Last Name, Company, Email, Phone, Industry</span>
              </div>
              <div className="flex items-start gap-2">
                <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                <span><strong>Custom:</strong> Any CSV or Excel file with company, email, or phone columns</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {importStats?.verticalBreakdown && Object.keys(importStats.verticalBreakdown).length > 0 && (
        <Card data-testid="card-overall-vertical-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Overall Vertical Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VerticalBreakdownChart breakdown={importStats.verticalBreakdown} />
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-import-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Total Rows</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Duplicates</TableHead>
                <TableHead>Already Exists</TableHead>
                <TableHead>Invalid</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Deals</TableHead>
                <TableHead>Lead Breakdown</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : importsError ? (
                <TableRow>
                  <TableCell colSpan={13} className="p-0">
                    <DataState
                      query={{ isLoading: false, isError: true, error: importsErrorObj, refetch: refetchImports }}
                      errorTitle="Failed to load import history"
                      testId="lead-imports"
                    >
                      <></>
                    </DataState>
                  </TableCell>
                </TableRow>
              ) : imports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center h-24 text-muted-foreground" data-testid="text-no-imports">
                    No imports yet. Upload a CSV or Excel file above to get started.
                  </TableCell>
                </TableRow>
              ) : (
                imports.map((imp) => (
                  <TableRow
                    key={imp.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedImport(expandedImport === imp.id ? null : imp.id)}
                    data-testid={`row-import-${imp.id}`}
                  >
                    <TableCell className="font-medium max-w-[200px] truncate" data-testid={`text-filename-${imp.id}`}>
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {imp.fileName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-format-${imp.id}`}>
                        {(imp.sourceFormat || "custom").replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-total-rows-${imp.id}`}>
                      {(imp.totalRows ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell data-testid={`text-new-records-${imp.id}`}>
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {(imp.newRecords ?? 0).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-skipped-${imp.id}`}>
                      <span className="text-muted-foreground">
                        {fmtOrUnknown(imp.duplicatesSkipped, imp)}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-already-exists-${imp.id}`}>
                      <span className="text-blue-600 dark:text-blue-400">
                        {fmtOrUnknown(imp.skippedRows, imp)}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-invalid-${imp.id}`}>
                      <span className={(imp.invalidRows ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                        {fmtOrUnknown(imp.invalidRows, imp)}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-errors-${imp.id}`}>
                      <span className={(imp.errorsCount ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                        {fmtOrUnknown(imp.errorsCount, imp)}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-deals-${imp.id}`}>
                      {(imp.dealsCreated ?? 0) > 0 ? (
                        <span className="text-orange-600 dark:text-orange-400 font-medium">
                          {imp.dealsCreated}
                        </span>
                      ) : "--"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {(imp.hotLeads ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5 text-xs" data-testid={`text-hot-${imp.id}`}>
                            <Flame className="h-3 w-3 text-red-500" />{imp.hotLeads}
                          </span>
                        )}
                        {(imp.warmLeads ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5 text-xs" data-testid={`text-warm-${imp.id}`}>
                            <Thermometer className="h-3 w-3 text-amber-500" />{imp.warmLeads}
                          </span>
                        )}
                        {(imp.coldLeads ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5 text-xs" data-testid={`text-cold-${imp.id}`}>
                            <Snowflake className="h-3 w-3 text-blue-400" />{imp.coldLeads}
                          </span>
                        )}
                        {(imp.hotLeads ?? 0) === 0 && (imp.warmLeads ?? 0) === 0 && (imp.coldLeads ?? 0) === 0 && "--"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {getStatusBadge(imp.status)}
                        {imp.status === "processing" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-xs text-amber-600 hover:text-amber-700"
                            data-testid={`btn-mark-interrupted-${imp.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              markInterruptedMutation.mutate(imp.id);
                            }}
                            disabled={markInterruptedMutation.isPending}
                            title="Mark this stuck import as interrupted"
                          >
                            Mark Interrupted
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px]" data-testid={`text-result-${imp.id}`}>
                      {(() => {
                        const outcome = getOutcomeSummary(imp);
                        return <span className={`text-xs font-medium ${outcome.className}`}>{outcome.label}</span>;
                      })()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-date-${imp.id}`}>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(imp.createdAt)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {expandedImport && (() => {
        const imp = imports.find(i => i.id === expandedImport);
        if (!imp) return null;
        const breakdown = imp.verticalBreakdown as Record<string, number> | null;
        return (
          <Card data-testid={`card-import-detail-${imp.id}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSpreadsheet className="h-5 w-5" />
                Import Details: {imp.fileName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Source Format</p>
                  <p className="font-medium">{(imp.sourceFormat || "custom").replace(/_/g, " ")}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total Rows</p>
                  <p className="font-medium">{(imp.totalRows ?? 0).toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">New Records</p>
                  <p className="font-medium text-green-600 dark:text-green-400">{(imp.newRecords ?? 0).toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Duplicates Skipped</p>
                  <p className="font-medium">{fmtOrUnknown(imp.duplicatesSkipped, imp)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Invalid Rows</p>
                  <p className="font-medium text-amber-600 dark:text-amber-400" data-testid={`text-detail-invalid-${imp.id}`}>{fmtOrUnknown(imp.invalidRows, imp)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Already Exists (DB Match)</p>
                  <p className="font-medium text-blue-600 dark:text-blue-400" data-testid={`text-detail-skipped-${imp.id}`}>{fmtOrUnknown(imp.skippedRows, imp)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Errors</p>
                  <p className="font-medium text-red-600 dark:text-red-400" data-testid={`text-detail-errors-${imp.id}`}>{fmtOrUnknown(imp.errorsCount, imp)}</p>
                </div>
                {hasUnknownBuckets(imp) && (
                  <div className="col-span-2 md:col-span-4">
                    <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`text-unknown-buckets-${imp.id}`}>
                      Import was interrupted before all row categories could be computed. Duplicate, invalid, and already-exists counts show "—" where unavailable.
                    </p>
                  </div>
                )}
              </div>

              {(imp.totalRows ?? 0) > 0 && (() => {
                const reconciled = (imp.newRecords ?? 0) + (imp.duplicatesSkipped ?? 0) + (imp.invalidRows ?? 0) + (imp.skippedRows ?? 0) + (imp.errorsCount ?? 0);
                const mismatch = reconciled !== (imp.totalRows ?? 0);
                return mismatch ? (
                  <p className="text-xs text-destructive" data-testid={`text-reconciliation-mismatch-${imp.id}`}>
                    Warning: accounted rows ({reconciled}) do not match total rows ({imp.totalRows}).
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground" data-testid={`text-reconciliation-ok-${imp.id}`}>
                    All {(imp.totalRows ?? 0).toLocaleString()} rows accounted for: {(imp.newRecords ?? 0).toLocaleString()} new + {(imp.duplicatesSkipped ?? 0).toLocaleString()} duplicates + {(imp.skippedRows ?? 0).toLocaleString()} already exist + {(imp.invalidRows ?? 0).toLocaleString()} invalid + {(imp.errorsCount ?? 0).toLocaleString()} errors.
                  </p>
                );
              })()}

              {(imp.totalRows ?? 0) > 0 && (() => {
                const outcome = getOutcomeSummary(imp);
                return (
                  <p className={`text-sm font-medium ${outcome.className}`} data-testid={`text-detail-outcome-${imp.id}`}>
                    {outcome.label}
                  </p>
                );
              })()}

              {(imp.totalRows ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>New Contact Rate (of total rows)</span>
                    <span>{Math.round(((imp.newRecords ?? 0) / (imp.totalRows ?? 1)) * 100)}%</span>
                  </div>
                  <Progress value={((imp.newRecords ?? 0) / (imp.totalRows ?? 1)) * 100} />
                </div>
              )}

              {breakdown && Object.keys(breakdown).length > 0 && (
                <div>
                  <h4 className="font-medium mb-3">Vertical Breakdown</h4>
                  <VerticalBreakdownChart breakdown={breakdown} />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <Card data-testid="card-outscraper-reference">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Outscraper Search Reference (FL Hot Verticals)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { vertical: "Auto Repair", searches: ["auto repair in Miami, FL", "auto body shop in Orlando, FL", "mechanic in Tampa, FL", "tire shop in Jacksonville, FL", "oil change in Fort Lauderdale, FL"] },
              { vertical: "Med Spa / Aesthetics", searches: ["med spa in Miami, FL", "medical spa in Boca Raton, FL", "aesthetics clinic in Tampa, FL", "botox in Fort Lauderdale, FL", "laser hair removal in Orlando, FL"] },
              { vertical: "Dentist", searches: ["dentist in Miami, FL", "dental office in Orlando, FL", "cosmetic dentist in Tampa, FL", "orthodontist in Jacksonville, FL", "family dentist in Fort Lauderdale, FL"] },
              { vertical: "Restaurant", searches: ["restaurant in Miami, FL", "restaurant in Orlando, FL", "restaurant in Tampa, FL", "restaurant in Jacksonville, FL", "restaurant in Fort Lauderdale, FL"] },
              { vertical: "Salon / Spa", searches: ["hair salon in Miami, FL", "nail salon in Orlando, FL", "beauty salon in Tampa, FL", "barber shop in Jacksonville, FL", "day spa in Boca Raton, FL"] },
              { vertical: "Fitness", searches: ["gym in Miami, FL", "fitness center in Orlando, FL", "yoga studio in Tampa, FL", "crossfit in Fort Lauderdale, FL", "personal trainer in Jacksonville, FL"] },
            ].map((item) => (
              <div key={item.vertical} className="border rounded-lg p-4 space-y-2" data-testid={`card-vertical-ref-${item.vertical.toLowerCase().replace(/[/ ]/g, "-")}`}>
                <h4 className="font-medium text-sm">{item.vertical}</h4>
                <ul className="space-y-1">
                  {item.searches.map((s) => (
                    <li key={s} className="text-xs text-muted-foreground flex items-start gap-1">
                      <ArrowRight className="h-3 w-3 mt-0.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
