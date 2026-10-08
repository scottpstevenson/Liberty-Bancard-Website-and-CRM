import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCrmQuery as useQuery } from "@/hooks/use-crm-query";
import { useContacts } from "@/hooks/use-contacts";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin, Plus, Unlink, ExternalLink, TrendingUp, Building2, Activity,
  DollarSign, CheckCircle2, Store,
} from "lucide-react";

interface GroupKpis {
  locationCount: number;
  totalDeals: number;
  closedWonCount: number;
  totalVolume: number;
  activeMids: number;
  locationIds: number[];
}

function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface LocationsTabProps {
  contact: Contact;
}

export function LocationsTab({ contact }: LocationsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkContactId, setLinkContactId] = useState("");
  const [linkLocationName, setLinkLocationName] = useState("");
  const [locationSearch, setLocationSearch] = useState("");

  const { data: locations = [], isLoading: locationsLoading, isError: locationsError, refetch: retryLocations } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", contact.id, "locations"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/contacts/${contact.id}/locations`, { credentials: "include", signal });
      if (!res.ok) throw new Error("Linked locations could not be loaded.");
      return res.json();
    },
    enabled: !!contact.id,
  });

  const { data: kpis, isLoading: kpisLoading, isError: kpisError, refetch: retryKpis } = useQuery<GroupKpis>({
    queryKey: ["/api/contacts", contact.id, "group-kpis"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/contacts/${contact.id}/group-kpis`, { credentials: "include", signal });
      if (!res.ok) throw new Error("Group metrics could not be loaded.");
      return res.json();
    },
    enabled: !!contact.id,
  });

  // Search is an authorized, actor-scoped paged Records read. Do not model the
  // first 500 contacts as the complete population available to link.
  const contactSearch = useContacts({ limit: 50, offset: 0, search: locationSearch.trim() || undefined });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const id = parseInt(linkContactId, 10);
      if (!id || isNaN(id)) throw new Error("Select a contact");
      const res = await apiRequest("POST", `/api/contacts/${contact.id}/locations`, {
        contactId: id,
        locationName: linkLocationName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "group-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "detail"] });
      setShowLinkDialog(false);
      setLinkContactId("");
      setLinkLocationName("");
      toast({ title: "Location linked" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (locationId: number) => {
      await apiRequest("DELETE", `/api/contacts/${contact.id}/locations/${locationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "group-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "detail"] });
      toast({ title: "Location unlinked" });
    },
    onError: () => toast({ title: "Failed to unlink location", variant: "destructive" }),
  });

  const markParentMutation = useMutation({
    mutationFn: async (isParent: boolean) => {
      const res = await apiRequest("PUT", `/api/contacts/${contact.id}`, {
        isParentAccount: isParent,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id, "detail"] });
      toast({ title: contact.isParentAccount ? "Parent account status removed" : "Marked as parent account" });
    },
    onError: () => toast({ title: "Failed to update account type", variant: "destructive" }),
  });

  const locationIdSet = new Set(locations.map(l => l.id));
  const availableContacts = (contactSearch.data?.data ?? []).filter(c =>
    c.id !== contact.id &&
    !locationIdSet.has(c.id) &&
    !c.parentContactId &&
    !c.archivedAt
  );

  return (
    <div className="space-y-4" data-testid="locations-tab">
      {/* Parent Account Toggle */}
      {!contact.parentContactId && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">Parent Account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {contact.isParentAccount
                  ? "This contact manages multiple locations."
                  : "Enable to track linked child locations under this account."}
              </p>
            </div>
            <Switch
              checked={!!contact.isParentAccount}
              onCheckedChange={(v) => markParentMutation.mutate(v)}
              disabled={markParentMutation.isPending}
              data-testid="switch-parent-account"
              aria-label="Mark as parent account"
            />
          </CardContent>
        </Card>
      )}

      {/* Group KPI Summary */}
      {(kpisLoading || (kpis && (kpis.locationCount > 0 || kpis.totalDeals > 0))) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="group-kpi-summary">
          {kpisLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : kpis ? (
            <>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <Store className="h-5 w-5 mx-auto text-primary mb-1" />
                  <div className="text-2xl font-bold" data-testid="kpi-locations">{kpis.locationCount}</div>
                  <div className="text-xs text-muted-foreground">Locations</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <TrendingUp className="h-5 w-5 mx-auto text-blue-500 mb-1" />
                  <div className="text-2xl font-bold" data-testid="kpi-deals">{kpis.totalDeals}</div>
                  <div className="text-xs text-muted-foreground">Group Deals</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <CheckCircle2 className="h-5 w-5 mx-auto text-green-500 mb-1" />
                  <div className="text-2xl font-bold" data-testid="kpi-closed-won">{kpis.closedWonCount}</div>
                  <div className="text-xs text-muted-foreground">Closed Won</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <DollarSign className="h-5 w-5 mx-auto text-emerald-500 mb-1" />
                  <div className="text-2xl font-bold" data-testid="kpi-volume">{fmtCurrency(kpis.totalVolume)}</div>
                  <div className="text-xs text-muted-foreground">Total Volume</div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      )}
      {kpisError && <CrmDataState state="unavailable" message="Group metrics are unavailable; linked locations remain available." onRetry={() => void retryKpis()} />}

      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Linked Locations
            {locations.length > 0 && (
              <Badge variant="secondary" className="ml-1" data-testid="badge-location-count">{locations.length}</Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowLinkDialog(true)}
            data-testid="button-link-location"
          >
            <Plus className="h-4 w-4 mr-1" /> Link Location
          </Button>
        </CardHeader>
        <CardContent>
          {locationsError ? (
            <div className="crm-state-panel" role="alert" data-testid="locations-error">
              <span className="crm-state-kicker">Locations unavailable</span><p>Authorized linked-location details could not be loaded.</p>
              <button type="button" className="crm-inline-retry" onClick={() => void retryLocations()}>Try again</button>
            </div>
          ) : locationsLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : locations.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground" data-testid="empty-locations">
              <Store className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No locations linked yet.</p>
              <p className="text-xs mt-1">Link individual location contacts to this parent account to track group performance.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {locations.map(loc => (
                  <div
                    key={loc.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
                    data-testid={`location-row-${loc.id}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <button
                          className="font-medium text-sm hover:underline text-primary"
                          onClick={() => navigate(`/dashboard/contacts/${loc.id}`)}
                          data-testid={`link-location-name-${loc.id}`}
                        >
                          {loc.companyName || `${loc.firstName} ${loc.lastName}`}
                        </button>
                        {loc.locationName && (
                          <Badge variant="outline" className="text-xs" data-testid={`badge-location-label-${loc.id}`}>
                            <MapPin className="h-2.5 w-2.5 mr-1" />
                            {loc.locationName}
                          </Badge>
                        )}
                        {loc.vertical && (
                          <span className="text-xs text-muted-foreground">{loc.vertical}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {loc.city && loc.state && (
                          <span>{loc.city}, {loc.state}</span>
                        )}
                        <span className="crm-record-id">Contact #{loc.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Open location contact"
                        onClick={() => navigate(`/dashboard/contacts/${loc.id}`)}
                        data-testid={`button-open-location-${loc.id}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Unlink location"
                        onClick={() => unlinkMutation.mutate(loc.id)}
                        disabled={unlinkMutation.isPending}
                        data-testid={`button-unlink-location-${loc.id}`}
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Link Dialog */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent data-testid="dialog-link-location">
          <DialogHeader>
            <DialogTitle>Link a Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Contact to link as a location</Label>
              <Input className="mt-1" value={locationSearch} onChange={event => setLocationSearch(event.currentTarget.value)}
                placeholder="Search authorized contacts" aria-label="Search contacts for a location" data-testid="input-link-contact-search" />
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
                {contactSearch.isError ? <div className="p-3 text-sm text-destructive" role="alert">
                  Contact search unavailable. <button type="button" className="underline" onClick={() => void contactSearch.refetch()}>Retry</button>
                </div> : contactSearch.isLoading ? <p className="p-3 text-sm text-muted-foreground" role="status">Searching authorized records…</p> :
                  availableContacts.length === 0 ? <p className="p-3 text-sm text-muted-foreground" role="status">{locationSearch.trim() ? "No matching available contacts." : "Search by name or company to find a contact."}</p> :
                  availableContacts.map(c => <button key={c.id} type="button" onClick={() => setLinkContactId(String(c.id))}
                    aria-pressed={linkContactId === String(c.id)} data-testid={`option-contact-${c.id}`}
                    className={`flex min-h-11 w-full items-center justify-between rounded px-3 text-left text-sm ${linkContactId === String(c.id) ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                    <span>{c.companyName || `${c.firstName} ${c.lastName}`}{c.city ? ` — ${c.city}` : ""}</span>
                    <span className="crm-record-id">#{c.id}</span>
                  </button>)}
              </div>
              {linkContactId && <p className="text-xs text-muted-foreground">Selected record #{linkContactId}</p>}
            </div>
            <div>
              <Label>Location label (optional)</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Downtown, Airport, North Miami"
                value={linkLocationName}
                onChange={e => setLinkLocationName(e.target.value)}
                data-testid="input-location-name"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowLinkDialog(false)} data-testid="button-cancel-link">Cancel</Button>
              <Button
                onClick={() => linkMutation.mutate()}
                disabled={linkMutation.isPending || !linkContactId}
                data-testid="button-confirm-link"
              >
                {linkMutation.isPending ? "Linking…" : "Link Location"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
