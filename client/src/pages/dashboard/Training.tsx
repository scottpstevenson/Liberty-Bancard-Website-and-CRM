import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Target,
  FileText,
  Users,
  TrendingUp,
  CheckCircle,
  Rocket,
  Lock,
} from "lucide-react";

interface TrainingFolder {
  id: string;
  name: string;
  docId: string;
  docTitle: string;
  docUrl: string;
}

interface TrainingHubStatus {
  exists: boolean;
  folderId?: string;
  folders?: TrainingFolder[];
}

const CATEGORY_META: Record<string, { icon: any; description: string; color: string }> = {
  Prospecting: {
    icon: Target,
    description: "Find and qualify merchants by vertical, lead sources, cold call openers, LinkedIn, and door-to-door tactics.",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  "How to Sell": {
    icon: TrendingUp,
    description: "Value proposition scripts, objection handling, pain point identification, dual pricing pitch, and high-risk pitch.",
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  "Statement Review": {
    icon: FileText,
    description: "Step-by-step guide to reading a merchant processing statement, identifying effective rate, and finding savings.",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  Closing: {
    icon: CheckCircle,
    description: "Closing scripts, urgency triggers, trial closes, what to do when they stall, and follow-up cadence after demo.",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  "Onboarding & Compliance": {
    icon: Users,
    description: "What happens after signing, merchant expectations, PCI basics, and chargeback prevention.",
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  "Agent Quick-Start Guide": {
    icon: Rocket,
    description: "Day-one orientation for new reps: systems access, first calls, compensation structure, and how residuals work.",
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
};

export default function Training() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isSettingUp, setIsSettingUp] = useState(false);

  const role = (user?.role as string) || "merchant";
  const isInternalUser = role === "admin" || role === "manager" || role === "agent";
  const canManageHub = role === "admin" || role === "manager";

  // Redirect merchant accounts — this is internal sales training only
  useEffect(() => {
    if (user && !isInternalUser) {
      setLocation("/dashboard");
    }
  }, [user, isInternalUser, setLocation]);

  const { data: status, isLoading } = useQuery<TrainingHubStatus>({
    queryKey: ["/api/training/status"],
    enabled: isInternalUser,
  });

  const setupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/training/setup"),
    onMutate: () => setIsSettingUp(true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/training/status"] });
      toast({
        title: "Training Hub Created",
        description: "All 6 training documents have been created in Google Drive.",
      });
      setIsSettingUp(false);
    },
    onError: (error: any) => {
      toast({
        title: "Setup Failed",
        description: error.message || "Failed to create training hub. Please try again.",
        variant: "destructive",
      });
      setIsSettingUp(false);
    },
  });

  const handleSetup = () => {
    setupMutation.mutate();
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/training/status"] });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-training-title">
            <BookOpen className="w-7 h-7 text-primary" />
            Sales Training Hub
          </h1>
          <p className="text-muted-foreground mt-1">
            Structured training documents covering every stage of the merchant sales process — powered by Google Drive.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            data-testid="button-refresh-training"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {status?.exists && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://drive.google.com/drive/folders/${status.folderId}`, "_blank")}
              data-testid="button-open-drive-folder"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Open in Drive
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !status?.exists ? (
        <Card className="border-dashed" data-testid="card-training-setup">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              {canManageHub ? (
                <BookOpen className="w-8 h-8 text-primary" />
              ) : (
                <Lock className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <h2 className="text-xl font-semibold mb-2">Training Hub Not Set Up</h2>
            {canManageHub ? (
              <>
                <p className="text-muted-foreground max-w-md mb-6">
                  Click the button below to automatically create the "Sales Training Hub" folder structure in Google Drive,
                  with all 6 training documents pre-populated with content.
                </p>
                <div className="flex flex-col items-center gap-3">
                  <Button
                    size="lg"
                    onClick={handleSetup}
                    disabled={isSettingUp || setupMutation.isPending}
                    data-testid="button-setup-training-hub"
                  >
                    {(isSettingUp || setupMutation.isPending) ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <Plus className="w-5 h-5 mr-2" />
                    )}
                    {(isSettingUp || setupMutation.isPending) ? "Creating Training Hub..." : "Create Training Hub"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    This will create folders and documents in your connected Google Drive account.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground max-w-md">
                The training hub hasn't been set up yet. Please contact your manager or admin to initialize it.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="secondary" className="bg-green-500/10 text-green-700 dark:text-green-400" data-testid="badge-hub-status">
              <CheckCircle className="w-3.5 h-3.5 mr-1" />
              Training Hub Active
            </Badge>
            <span className="text-sm text-muted-foreground">
              {status.folders?.length || 0} training modules available
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {status.folders?.map((folder) => {
              const meta = CATEGORY_META[folder.name] || {
                icon: BookOpen,
                description: "Training content for this category.",
                color: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
              };
              const Icon = meta.icon;

              return (
                <Card
                  key={folder.id}
                  className="hover:shadow-md transition-shadow"
                  data-testid={`card-training-${folder.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${meta.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base leading-snug" data-testid={`text-training-category-${folder.name}`}>
                          {folder.name}
                        </CardTitle>
                      </div>
                    </div>
                    <CardDescription className="text-sm mt-2 leading-relaxed">
                      {meta.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {folder.docUrl ? (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => window.open(folder.docUrl, "_blank")}
                        data-testid={`button-open-doc-${folder.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open Training Doc
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" disabled>
                        <FileText className="w-4 h-4 mr-2" />
                        No document found
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {canManageHub && (
            <Card className="mt-6 border-dashed" data-testid="card-rebuild-hub">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium text-sm">Rebuild Training Hub</p>
                  <p className="text-xs text-muted-foreground">
                    Re-run setup to add any missing folders or documents. Existing content will not be overwritten.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSetup}
                  disabled={isSettingUp || setupMutation.isPending}
                  data-testid="button-rebuild-training-hub"
                >
                  {(isSettingUp || setupMutation.isPending) ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {(isSettingUp || setupMutation.isPending) ? "Rebuilding..." : "Rebuild"}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
