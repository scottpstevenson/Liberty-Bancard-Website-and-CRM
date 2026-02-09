import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Package, Workflow, ChevronDown, ChevronRight, Mail, MessageSquare, Clock, ListChecks, Bell, FileText, Tag, Shield, ArrowRight, ExternalLink } from "lucide-react";
import type { CollateralPacket, Workflow as WorkflowType, MessageTemplate } from "@shared/schema";

const ACTION_LABELS: Record<string, { label: string; icon: typeof Mail }> = {
  send_ghl_email: { label: "Send Email", icon: Mail },
  send_ghl_sms: { label: "Send SMS", icon: MessageSquare },
  send_packet: { label: "Send Packet", icon: Package },
  create_task: { label: "Create Task", icon: ListChecks },
  send_notification: { label: "Internal Notification", icon: Bell },
  update_deal: { label: "Update Deal", icon: FileText },
  update_contact_tags: { label: "Update Tags", icon: Tag },
  generate_proposal: { label: "Generate Proposal", icon: FileText },
  request_review: { label: "Request Review", icon: Shield },
  create_audit_log: { label: "Audit Log", icon: Shield },
  wait: { label: "Wait / Delay", icon: Clock },
};

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function ActionDetail({ action, index }: { action: any; index: number }) {
  const config = ACTION_LABELS[action.type] || { label: action.type, icon: ArrowRight };
  const Icon = config.icon;

  return (
    <div className="flex gap-3 py-3" data-testid={`action-detail-${index}`}>
      <div className="flex flex-col items-center shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{config.label}</span>
          <Badge variant="outline" className="text-xs">{`Step ${index + 1}`}</Badge>
        </div>

        {action.type === "wait" && (
          <p className="text-sm text-muted-foreground mt-1">
            Wait {formatHours(action.hours)} before next step
          </p>
        )}

        {action.type === "send_ghl_email" && (
          <div className="mt-2 space-y-1">
            {action.subject && (
              <p className="text-sm"><span className="text-muted-foreground">Subject:</span> {action.subject}</p>
            )}
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 mt-1 whitespace-pre-wrap" data-testid={`action-email-body-${index}`}>
              {stripHtml(action.body || "")}
            </div>
          </div>
        )}

        {action.type === "send_ghl_sms" && (
          <div className="mt-2">
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 whitespace-pre-wrap" data-testid={`action-sms-body-${index}`}>
              {action.body || ""}
            </div>
          </div>
        )}

        {action.type === "create_task" && (
          <div className="mt-1 space-y-1">
            <p className="text-sm">{action.title}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {action.dueHours != null && <Badge variant="secondary" className="text-xs">Due: {formatHours(action.dueHours)}</Badge>}
              {action.priority && <Badge variant="secondary" className="text-xs">Priority: {action.priority}</Badge>}
              {action.assignedTo && <Badge variant="secondary" className="text-xs">Assigned: {action.assignedTo}</Badge>}
            </div>
          </div>
        )}

        {action.type === "send_notification" && (
          <div className="mt-1 space-y-1">
            <p className="text-sm">{action.title}</p>
            <p className="text-sm text-muted-foreground">{action.message}</p>
            {action.channel && <Badge variant="secondary" className="text-xs">Channel: {action.channel}</Badge>}
          </div>
        )}

        {action.type === "update_deal" && (
          <div className="mt-1 space-y-1">
            {action.stage && <p className="text-sm"><span className="text-muted-foreground">Move to stage:</span> {action.stage}</p>}
            {action.notes && <p className="text-sm text-muted-foreground">{action.notes}</p>}
          </div>
        )}

        {action.type === "update_contact_tags" && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {action.addTags?.map((tag: string) => (
              <Badge key={tag} variant="secondary" className="text-xs">+{tag}</Badge>
            ))}
            {action.removeTags?.map((tag: string) => (
              <Badge key={tag} variant="destructive" className="text-xs">-{tag}</Badge>
            ))}
          </div>
        )}

        {action.type === "request_review" && (
          <p className="text-sm text-muted-foreground mt-1">Request a Google review from the merchant</p>
        )}

        {action.type === "create_audit_log" && (
          <p className="text-sm text-muted-foreground mt-1">Log: {action.logAction}</p>
        )}

        {action.type === "send_packet" && (
          <p className="text-sm text-muted-foreground mt-1">Auto-select and send matching collateral packet based on deal offer path/vertical</p>
        )}

        {action.type === "generate_proposal" && (
          <p className="text-sm text-muted-foreground mt-1">Generate a statement analysis proposal for the merchant</p>
        )}
      </div>
    </div>
  );
}

function WorkflowCard({ workflow }: { workflow: WorkflowType }) {
  const [expanded, setExpanded] = useState(false);
  const actions = Array.isArray(workflow.actions) ? workflow.actions : [];
  const actionTypeCounts: Record<string, number> = {};
  actions.forEach((a: any) => {
    const label = ACTION_LABELS[a.type]?.label || a.type;
    actionTypeCounts[label] = (actionTypeCounts[label] || 0) + 1;
  });

  const triggerLabels: Record<string, string> = {
    contact_created: "When a new contact is created",
    deal_stage_changed: "When a deal changes stage",
    ticket_created: "When a ticket is created",
    form_submitted: "When a form is submitted",
    deal_sla_breach: "When a deal SLA is breached",
    ticket_sla_breach: "When a ticket SLA is breached",
    go_live_milestone: "When a merchant goes live",
  };

  const triggerDetail = triggerLabels[workflow.triggerType] || workflow.triggerType;
  const triggerConfig = workflow.triggerConfig as Record<string, any> | null;

  return (
    <Card className="overflow-visible" data-testid={`card-workflow-${workflow.id}`}>
      <div
        className="flex items-center justify-between gap-3 p-4 cursor-pointer hover-elevate rounded-md"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-workflow-${workflow.id}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Workflow className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{workflow.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{triggerDetail}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">{actions.length} step{actions.length !== 1 ? "s" : ""}</Badge>
          <Badge variant={workflow.enabled ? "default" : "secondary"} className="text-xs">
            {workflow.enabled ? "Active" : "Disabled"}
          </Badge>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="pt-0 border-t">
          <div className="pt-4">
            <div className="mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Trigger</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{workflow.triggerType}</Badge>
                {triggerConfig?.toStage && <Badge variant="secondary" className="text-xs">To: {triggerConfig.toStage}</Badge>}
                {triggerConfig?.formType && <Badge variant="secondary" className="text-xs">Form: {triggerConfig.formType}</Badge>}
                {triggerConfig?.stage && <Badge variant="secondary" className="text-xs">Stage: {triggerConfig.stage}</Badge>}
                {triggerConfig?.maxMinutes && <Badge variant="secondary" className="text-xs">SLA: {formatHours(triggerConfig.maxMinutes / 60)}</Badge>}
              </div>
            </div>

            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Action Sequence</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {Object.entries(actionTypeCounts).map(([label, count]) => (
                <Badge key={label} variant="secondary" className="text-xs">{label}{count > 1 ? ` x${count}` : ""}</Badge>
              ))}
            </div>

            <div className="pl-1">
              {actions.map((action: any, i: number) => (
                <ActionDetail key={i} action={action} index={i} />
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function PacketCard({ packet }: { packet: CollateralPacket }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-visible" data-testid={`card-packet-${packet.id}`}>
      <div
        className="flex items-center justify-between gap-3 p-4 cursor-pointer hover-elevate rounded-md"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-packet-${packet.id}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Package className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{packet.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {packet.offerPath ? `Offer: ${packet.offerPath}` : packet.vertical ? `Vertical: ${packet.vertical}` : "General"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={packet.isActive ? "default" : "secondary"} className="text-xs">
            {packet.isActive ? "Active" : "Inactive"}
          </Badge>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="pt-0 border-t">
          <div className="pt-4 space-y-3">
            {packet.description && (
              <p className="text-sm text-muted-foreground">{packet.description}</p>
            )}

            {packet.offerPath && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Offer Path</p>
                <Badge variant="outline" className="text-xs">{packet.offerPath}</Badge>
              </div>
            )}

            {packet.vertical && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Vertical</p>
                <Badge variant="outline" className="text-xs">{packet.vertical}</Badge>
              </div>
            )}

            {packet.tags && packet.tags.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {packet.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            {packet.pages && packet.pages.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Included Pages</p>
                <div className="space-y-1">
                  {packet.pages.map((page) => (
                    <Link key={page} href={page} data-testid={`link-packet-page-${page}`}>
                      <div className="flex items-center gap-2 text-sm text-primary hover-elevate rounded-md p-2 cursor-pointer">
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span>{page.split("/").pop()?.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function TemplateCard({ template }: { template: MessageTemplate }) {
  const [expanded, setExpanded] = useState(false);
  const isEmail = template.channel === "email";

  return (
    <Card className="overflow-visible" data-testid={`card-template-${template.id}`}>
      <div
        className="flex items-center justify-between gap-3 p-4 cursor-pointer hover-elevate rounded-md"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-template-${template.id}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isEmail ? <Mail className="w-4 h-4 text-muted-foreground shrink-0" /> : <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{template.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{template.category} / {template.channel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs">{template.channel}</Badge>
          <Badge variant={template.isActive ? "default" : "secondary"} className="text-xs">
            {template.isActive ? "Active" : "Inactive"}
          </Badge>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="pt-0 border-t">
          <div className="pt-4 space-y-3">
            {template.subject && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Subject Line</p>
                <p className="text-sm">{template.subject}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Message Body</p>
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 whitespace-pre-wrap" data-testid={`template-body-${template.id}`}>
                {isEmail ? stripHtml(template.body) : template.body}
              </div>
            </div>

            {template.mergeFields && template.mergeFields.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Merge Fields</p>
                <div className="flex flex-wrap gap-1">
                  {template.mergeFields.map((field) => (
                    <Badge key={field} variant="secondary" className="text-xs">{`{{${field}}}`}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function Automation() {
  const { data: packets, isLoading: packetsLoading } = useQuery<CollateralPacket[]>({
    queryKey: ["/api/collateral-packets"],
  });

  const { data: workflows, isLoading: workflowsLoading } = useQuery<WorkflowType[]>({
    queryKey: ["/api/workflows"],
  });

  const { data: templates, isLoading: templatesLoading } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/message-templates"],
  });

  const isLoading = packetsLoading || workflowsLoading || templatesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="automation-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="automation-page">
      <div>
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold" data-testid="text-automation-title">Automation Dashboard</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">View your workflows, message templates, and collateral packets</p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Workflow className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">Workflows ({workflows?.length || 0})</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Automated sequences that run when triggers fire. Click any workflow to see every step and the exact messages sent to merchants.</p>
        <div className="space-y-3" data-testid="workflow-list">
          {workflows && workflows.length > 0 ? (
            workflows.map((w) => <WorkflowCard key={w.id} workflow={w} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-workflows-empty">No workflows configured</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">Message Templates ({templates?.length || 0})</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Pre-written email and SMS templates used by workflows and manual sends. Click to preview the full message.</p>
        <div className="space-y-3" data-testid="template-list">
          {templates && templates.length > 0 ? (
            templates.map((t) => <TemplateCard key={t.id} template={t} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-templates-empty">No message templates configured</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">Collateral Packets ({packets?.length || 0})</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Sales packets auto-matched and sent to merchants based on their offer path or industry vertical. Click to see what each packet contains.</p>
        <div className="space-y-3" data-testid="packet-list">
          {packets && packets.length > 0 ? (
            packets.map((p) => <PacketCard key={p.id} packet={p} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-packets-empty">No collateral packets configured</p>
          )}
        </div>
      </div>
    </div>
  );
}
