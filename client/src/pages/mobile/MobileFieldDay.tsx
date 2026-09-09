import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  Loader2,
  Navigation,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

const OUTCOME_CODES = [
  { value: "visited_owner_spoke", label: "Spoke with Owner" },
  { value: "visited_owner_absent", label: "Owner Absent" },
  { value: "left_materials", label: "Left Materials" },
  { value: "follow_up_requested", label: "Follow-Up Requested" },
  { value: "statement_requested", label: "Statement Requested" },
  { value: "do_not_visit", label: "Do Not Visit" },
  { value: "no_answer", label: "No Answer" },
] as const;

type OutcomeCode = (typeof OUTCOME_CODES)[number]["value"];

function generateUUIDv4(): string {
  return crypto.randomUUID();
}

function buildMapsUrl(lat?: number | null, lng?: number | null, address?: string): string | null {
  if (lat != null && lng != null) {
    const url = `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
    if (!url.startsWith("https://maps.google.com/")) return null;
    return url;
  }
  if (address) {
    const url = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
    if (!url.startsWith("https://maps.google.com/")) return null;
    return url;
  }
  return null;
}

interface Stop {
  id: string;
  businessId: number;
  businessName: string;
  address: string;
  mapsUrl: string | null;
  status: "available" | "claimed" | "completed" | "released";
  plannedOrder: number;
  lastVisit: { visitedAt: string; outcomeCode: string } | null;
}

interface DispositionSheetProps {
  stop: Stop;
  routeId: string;
  onClose: () => void;
  onComplete: () => void;
}

function DispositionSheet({ stop, routeId, onClose, onComplete }: DispositionSheetProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeCode | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState<{
    type: "follow_up" | "statement";
    taskId?: string;
  } | null>(null);
  const { toast } = useToast();

  async function handleSubmit() {
    if (!selectedOutcome) return;
    setSubmitting(true);
    try {
      const idempotencyKey = generateUUIDv4();
      const res = await apiRequest("POST", "/api/field-visits", {
        stopId: stop.id,
        idempotencyKey,
        outcomeCode: selectedOutcome,
        note: note.trim() || undefined,
      });
      const data = await res.json();

      if (selectedOutcome === "follow_up_requested" && data.task_id) {
        setConfirmationModal({ type: "follow_up", taskId: data.task_id });
      } else if (selectedOutcome === "statement_requested" && data.statement_acquisition_started) {
        setConfirmationModal({ type: "statement" });
      } else {
        toast({ title: "Visit recorded", description: `Outcome: ${selectedOutcome}` });
        onComplete();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message ?? "Failed to record visit", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmationModal) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-lg">
              {confirmationModal.type === "follow_up" ? "Follow-Up Created" : "Statement Requested"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {confirmationModal.type === "follow_up" ? (
              <p className="text-sm text-gray-600">
                A follow-up task has been created (ID: {confirmationModal.taskId?.slice(0, 8)}…).
              </p>
            ) : (
              <p className="text-sm text-gray-600">Statement acquisition has been started for this contact.</p>
            )}
            <Button
              className="w-full"
              onClick={() => {
                setConfirmationModal(null);
                onComplete();
              }}
            >
              Done
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-2xl max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{stop.businessName}</h3>
            <p className="text-xs text-gray-500">{stop.address}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Outcome</p>
          {OUTCOME_CODES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setSelectedOutcome(value)}
              className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                selectedOutcome === value
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {label}
              {value === "do_not_visit" && (
                <span className="ml-2 text-xs text-red-500">(blocks future visits)</span>
              )}
            </button>
          ))}

          <Textarea
            placeholder="Note (max 280 chars)"
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="text-sm"
            rows={3}
          />
          <p className="text-right text-xs text-gray-400">{note.length}/280</p>

          <Button
            className="w-full"
            disabled={!selectedOutcome || submitting}
            onClick={handleSubmit}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Record Visit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StopCard({
  stop,
  routeId,
  onRefresh,
}: {
  stop: Stop;
  routeId: string;
  onRefresh: () => void;
}) {
  const [showDisposition, setShowDisposition] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const { toast } = useToast();

  const mapsUrl = stop.mapsUrl ?? buildMapsUrl(null, null, stop.address);

  async function handleClaim() {
    setClaiming(true);
    try {
      await apiRequest("POST", `/api/field-routes/${routeId}/stops/${stop.id}/claim`, {});
      onRefresh();
    } catch (err: any) {
      const msg = err.status === 409 ? "Stop already claimed by another rep" : (err.message ?? "Failed to claim stop");
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <>
      <Card className="mb-3">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-mono">#{stop.plannedOrder}</span>
                <h4 className="font-medium text-gray-900 text-sm truncate">{stop.businessName}</h4>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{stop.address}</p>
              {stop.lastVisit && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Last visit: {new Date(stop.lastVisit.visitedAt).toLocaleDateString()} —{" "}
                  {stop.lastVisit.outcomeCode.replace(/_/g, " ")}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 ml-2">
              <Badge
                variant={
                  stop.status === "completed"
                    ? "default"
                    : stop.status === "claimed"
                    ? "outline"
                    : "secondary"
                }
                className="text-xs"
              >
                {stop.status}
              </Badge>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700"
                  aria-label="Open in Maps"
                >
                  <Navigation className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          {stop.status === "available" && (
            <Button
              size="sm"
              className="w-full mt-3"
              onClick={handleClaim}
              disabled={claiming}
            >
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim & Visit"}
            </Button>
          )}

          {stop.status === "claimed" && (
            <Button
              size="sm"
              className="w-full mt-3"
              onClick={() => setShowDisposition(true)}
            >
              Record Visit
            </Button>
          )}

          {stop.status === "completed" && (
            <div className="flex items-center gap-1 mt-2 text-xs text-green-600">
              <CheckCircle className="w-3 h-3" />
              <span>Completed</span>
            </div>
          )}
        </CardContent>
      </Card>

      {showDisposition && (
        <DispositionSheet
          stop={stop}
          routeId={routeId}
          onClose={() => setShowDisposition(false)}
          onComplete={() => {
            setShowDisposition(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

export default function MobileFieldDay() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Check field sales status first
  const { data: statusData, isLoading: statusLoading, isError: statusError } = useQuery({
    queryKey: ["/api/field-sales/status"],
    queryFn: async () => {
      const res = await fetch("/api/field-sales/status", { credentials: "include" });
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      return res.json() as Promise<{ enabled: boolean; eligible: boolean }>;
    },
  });

  const { data: routeData, isLoading: routeLoading, refetch: refetchRoute } = useQuery({
    queryKey: ["/api/field-routes/my-today"],
    queryFn: async () => {
      const res = await fetch("/api/field-routes/my-today", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load today's route");
      return res.json() as Promise<{ route: any; stops: Stop[] }>;
    },
    enabled: !!statusData?.eligible,
  });

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="p-4 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-sm text-gray-600">Unable to load Field Day. Please try again.</p>
      </div>
    );
  }

  if (!statusData?.enabled || !statusData?.eligible) {
    return (
      <div className="p-4 text-center text-gray-500">
        <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">Field Day is not available for your account.</p>
      </div>
    );
  }

  if (routeLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const { route, stops = [] } = routeData ?? { route: null, stops: [] };

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Field Day</h2>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <User className="w-3 h-3" />
          <span>{(user as any)?.firstName || (user as any)?.email}</span>
        </div>
      </div>

      {!route ? (
        <div className="text-center py-12 text-gray-400">
          <MapPin className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm">No route assigned for today.</p>
          <p className="text-xs mt-1">Contact your manager to freeze today's route.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-blue-900">Today's Route</p>
              <p className="text-xs text-blue-600">
                {stops.filter((s) => s.status === "completed").length} / {stops.length} stops completed
              </p>
            </div>
          </div>

          <div>
            {stops.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No stops on this route.</p>
            ) : (
              stops.map((stop) => (
                <StopCard
                  key={stop.id}
                  stop={stop}
                  routeId={route.id}
                  onRefresh={() => refetchRoute()}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
