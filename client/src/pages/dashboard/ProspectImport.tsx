import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getCsrfToken } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, FileSpreadsheet, Sparkles, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ProspectList, EnrichmentJob } from "@shared/schema";

function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "ready":
    case "completed":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "processing":
    case "running":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "pending":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "failed":
    case "error":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "--";
  return new Date(date).toLocaleDateString();
}

function EnrichmentJobStatus({ listId }: { listId: number }) {
  const { data: jobs, isLoading } = useQuery<EnrichmentJob[]>({
    queryKey: ["/api/enrichment-jobs", `listId=${listId}`],
    queryFn: async () => {
      const res = await fetch(`/api/enrichment-jobs?listId=${listId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  if (isLoading) return <Skeleton className="h-4 w-20" />;

  const latestJob = jobs?.[0];
  if (!latestJob) return <span className="text-sm text-muted-foreground" data-testid={`text-no-jobs-${listId}`}>No jobs</span>;

  return (
    <div className="flex items-center gap-2" data-testid={`status-enrichment-job-${listId}`}>
      {latestJob.status === "running" || latestJob.status === "pending" ? (
        <Loader2 className="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400" />
      ) : latestJob.status === "completed" ? (
        <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
      ) : latestJob.status === "failed" ? (
        <AlertCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
      ) : null}
      <Badge
        variant="outline"
        className={`no-default-hover-elevate no-default-active-elevate ${getStatusBadgeClass(latestJob.status)}`}
        data-testid={`badge-job-status-${listId}`}
      >
        {latestJob.status}
      </Badge>
      {(latestJob.totalCount ?? 0) > 0 && (
        <span className="text-xs text-muted-foreground" data-testid={`text-job-progress-${listId}`}>
          {latestJob.processedCount}/{latestJob.totalCount}
        </span>
      )}
    </div>
  );
}

export default function ProspectImport() {
  const [listName, setListName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [showArchived, setShowArchived] = useState(false);

  const { data: prospectLists, isLoading: listsLoading } = useQuery<ProspectList[]>({
    queryKey: ["/api/prospect-lists", showArchived ? "archived" : "active"],
    queryFn: async () => {
      const url = showArchived ? "/api/prospect-lists?includeArchived=true" : "/api/prospect-lists";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const response = await fetch("/api/prospects/import", {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospect-lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prospects"] });
      setUploadResult({ imported: data.imported ?? 0, skipped: data.skipped ?? 0 });
      setSelectedFile(null);
      setListName("");
      toast({ title: "Import complete", description: `${data.imported ?? 0} prospects imported.` });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const enrichAllMutation = useMutation({
    mutationFn: async (listId: number) => {
      await apiRequest("POST", "/api/enrichment-jobs", {
        jobType: "full_enrich",
        listId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrichment-jobs"] });
      toast({ title: "Enrichment started", description: "All prospects in this list are being enriched." });
    },
    onError: (error: Error) => {
      toast({ title: "Enrichment failed", description: error.message, variant: "destructive" });
    },
  });

  const handleUpload = () => {
    if (!selectedFile || !listName.trim()) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("listName", listName.trim());
    setUploadResult(null);
    uploadMutation.mutate(formData);
  };

  const handleFileSelect = (file: File | null) => {
    if (file && file.type === "text/csv" || file?.name.endsWith(".csv")) {
      setSelectedFile(file);
      setUploadResult(null);
    } else if (file) {
      toast({ title: "Invalid file type", description: "Please upload a CSV file.", variant: "destructive" });
    }
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <Upload className="h-5 w-5" />
            Import Prospects from CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block" htmlFor="list-name-input">
              List Name
            </label>
            <Input
              id="list-name-input"
              placeholder="e.g. Q1 Restaurant Leads"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              data-testid="input-list-name"
            />
          </div>

          <div
            className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                : "border-border hover:border-muted-foreground/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-file-upload"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              data-testid="input-file-upload"
            />
            <div className="flex flex-col items-center gap-2">
              {selectedFile ? (
                <>
                  <FileSpreadsheet className="h-10 w-10 text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium" data-testid="text-selected-file">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Drag and drop a CSV file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground">Supports .csv files</p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || !listName.trim() || uploadMutation.isPending}
              data-testid="button-upload"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload CSV
                </>
              )}
            </Button>
            {selectedFile && (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedFile(null);
                  setUploadResult(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                data-testid="button-clear-file"
              >
                Clear
              </Button>
            )}
          </div>

          {uploadResult && (
            <div className="rounded-md border p-4 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" data-testid="status-upload-result">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="font-medium text-green-800 dark:text-green-300">Import Complete</span>
              </div>
              <div className="text-sm text-green-700 dark:text-green-400 space-y-1">
                <p data-testid="text-imported-count">{uploadResult.imported} prospects imported</p>
                <p data-testid="text-skipped-count">{uploadResult.skipped} prospects skipped</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <FileSpreadsheet className="h-5 w-5" />
              Prospect Lists
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchived(!showArchived)}
              data-testid="button-toggle-archived"
            >
              {showArchived ? "Hide Archived" : "Show Archived"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Total Records</TableHead>
                <TableHead>Enriched</TableHead>
                <TableHead>Qualified</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enrichment Jobs</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} data-testid={`skeleton-list-row-${i}`}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : !prospectLists?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24 text-muted-foreground" data-testid="text-no-lists">
                    No prospect lists yet. Upload a CSV to get started.
                  </TableCell>
                </TableRow>
              ) : (
                prospectLists.map((list) => (
                  <TableRow key={list.id} data-testid={`row-list-${list.id}`}>
                    <TableCell className="font-medium" data-testid={`text-list-name-${list.id}`}>
                      {list.name}
                    </TableCell>
                    <TableCell data-testid={`text-total-records-${list.id}`}>
                      {list.totalRecords ?? 0}
                    </TableCell>
                    <TableCell data-testid={`text-enriched-records-${list.id}`}>
                      {list.enrichedRecords ?? 0}
                    </TableCell>
                    <TableCell data-testid={`text-qualified-records-${list.id}`}>
                      {list.qualifiedRecords ?? 0}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`no-default-hover-elevate no-default-active-elevate ${getStatusBadgeClass(list.status)}`}
                        data-testid={`badge-list-status-${list.id}`}
                      >
                        {list.status || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <EnrichmentJobStatus listId={list.id} />
                    </TableCell>
                    <TableCell data-testid={`text-list-created-${list.id}`}>
                      {formatDate(list.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => enrichAllMutation.mutate(list.id)}
                        disabled={enrichAllMutation.isPending}
                        data-testid={`button-enrich-all-${list.id}`}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        Enrich All
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
