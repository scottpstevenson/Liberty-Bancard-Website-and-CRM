import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Settings, CheckCircle2, XCircle, Key, MapPin, Calendar, Activity, Mail, Clock } from "lucide-react";
import type { GhlActivityLog, MessageTemplate, SlaConfig } from "@shared/schema";

interface GhlStatus {
  configured: boolean;
  hasApiKey: boolean;
  hasLocationId: boolean;
  hasCalendarId: boolean;
}

export default function GhlSettings() {
  const { data: status, isLoading: statusLoading } = useQuery<GhlStatus>({
    queryKey: ["/api/ghl/status"],
  });

  const { data: activity, isLoading: activityLoading } = useQuery<GhlActivityLog[]>({
    queryKey: ["/api/ghl/activity"],
  });

  const { data: templates, isLoading: templatesLoading } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/message-templates"],
  });

  const { data: slaConfigs, isLoading: slaLoading } = useQuery<SlaConfig[]>({
    queryKey: ["/api/sla-configs"],
  });

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="ghlsettings-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const StatusIndicator = ({ configured }: { configured: boolean }) =>
    configured ? (
      <CheckCircle2 className="w-5 h-5 text-green-500" />
    ) : (
      <XCircle className="w-5 h-5 text-red-500" />
    );

  return (
    <div className="space-y-6" data-testid="ghlsettings-page">
      <div>
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold" data-testid="text-ghlsettings-title">GHL Integration Settings</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Manage your GoHighLevel integration and communication settings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-ghl-connection">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Connection Status</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.configured ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-connection-status">
                {status?.configured ? "Connected" : "Not Configured"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ghl-apikey">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API Key</CardTitle>
            <Key className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.hasApiKey ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-apikey-status">
                {status?.hasApiKey ? "Configured" : "Not Set"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ghl-locationid">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Location ID</CardTitle>
            <MapPin className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.hasLocationId ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-locationid-status">
                {status?.hasLocationId ? "Configured" : "Not Set"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ghl-calendarid">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Calendar ID</CardTitle>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIndicator configured={status?.hasCalendarId ?? false} />
              <span className="text-lg font-semibold" data-testid="text-ghl-calendarid-status">
                {status?.hasCalendarId ? "Configured" : "Not Set"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-ghl-instructions">
        <CardHeader>
          <CardTitle className="text-base">Configuration Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-ghl-instructions">
            To enable the GoHighLevel integration, set the following environment secrets in your Replit project:
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Key className="w-4 h-4 text-muted-foreground" />
              <code className="bg-muted px-2 py-0.5 rounded text-xs">GHL_API_KEY</code>
              <span className="text-muted-foreground">- Your GoHighLevel API key</span>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <code className="bg-muted px-2 py-0.5 rounded text-xs">GHL_LOCATION_ID</code>
              <span className="text-muted-foreground">- Your GHL location identifier</span>
            </li>
            <li className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <code className="bg-muted px-2 py-0.5 rounded text-xs">GHL_CALENDAR_ID</code>
              <span className="text-muted-foreground">- Your GHL calendar identifier</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="card-ghl-activity">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Recent GHL Activity</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !activity || activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-ghl-activity-empty">
              No recent GHL activity
            </p>
          ) : (
            <Table data-testid="table-ghl-activity">
              <TableHeader>
                <TableRow>
                  <TableHead>Direction</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-ghl-activity-${entry.id}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {entry.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{entry.channel}</TableCell>
                    <TableCell className="text-sm">{entry.subject || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={entry.status === "sent" ? "default" : "secondary"} className="text-xs">
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-message-templates">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Message Templates</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {templatesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-templates-empty">
              No message templates configured
            </p>
          ) : (
            <Table data-testid="table-message-templates">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id} data-testid={`row-template-${t.id}`}>
                    <TableCell className="text-sm font-medium">{t.name}</TableCell>
                    <TableCell className="text-sm">{t.category}</TableCell>
                    <TableCell className="text-sm">{t.channel}</TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? "default" : "secondary"} className="text-xs">
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-sla-configs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">SLA Configurations</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {slaLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !slaConfigs || slaConfigs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-sla-empty">
              No SLA configurations defined
            </p>
          ) : (
            <Table data-testid="table-sla-configs">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Max Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slaConfigs.map((sla) => (
                  <TableRow key={sla.id} data-testid={`row-sla-${sla.id}`}>
                    <TableCell className="text-sm font-medium">{sla.name}</TableCell>
                    <TableCell className="text-sm">{sla.entityType}</TableCell>
                    <TableCell className="text-sm">{sla.stage || "-"}</TableCell>
                    <TableCell className="text-sm">
                      {sla.maxDurationMinutes >= 60
                        ? `${Math.floor(sla.maxDurationMinutes / 60)}h ${sla.maxDurationMinutes % 60}m`
                        : `${sla.maxDurationMinutes}m`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sla.isActive ? "default" : "secondary"} className="text-xs">
                        {sla.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
