import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import type { Contact } from "@shared/schema";

interface Props {
  contact: Contact;
  ghlSyncStatus?: { isSynced?: boolean; isRecent?: boolean; ghlContactId?: string | null; lastSyncedAt?: string | null };
  resyncToGhlMutation: { mutate: () => void; isPending: boolean };
}

export function GhlSyncStatus({ contact, ghlSyncStatus, resyncToGhlMutation }: Props) {
  const isSynced = ghlSyncStatus?.isSynced && ghlSyncStatus?.isRecent;
  const ghlId = ghlSyncStatus?.ghlContactId || contact.ghlContactId;
  const lastSyncedAt = ghlSyncStatus?.lastSyncedAt;
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid="section-ghl-sync-status">
      {isSynced ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <Badge
          variant={isSynced ? "default" : "secondary"}
          className={isSynced ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"}
          data-testid="badge-ghl-sync-status"
        >
          {isSynced ? "GHL Synced" : "Sync Pending"}
        </Badge>
        {ghlId && (
          <span className="ml-2 text-xs text-muted-foreground font-mono" data-testid="text-ghl-contact-id">
            {ghlId}
          </span>
        )}
        {lastSyncedAt && (
          <span className="ml-2 text-xs text-muted-foreground" data-testid="text-ghl-last-synced">
            Last synced: {new Date(lastSyncedAt).toLocaleString()}
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => resyncToGhlMutation.mutate()}
        disabled={resyncToGhlMutation.isPending}
        className="shrink-0"
        data-testid="button-resync-ghl"
      >
        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resyncToGhlMutation.isPending ? "animate-spin" : ""}`} />
        Re-sync to GHL
      </Button>
    </div>
  );
}
