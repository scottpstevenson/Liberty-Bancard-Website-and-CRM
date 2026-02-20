import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";

const PCI_CATEGORIES = [
  {
    name: "Network Security",
    icon: Shield,
    items: [
      { id: "ns1", label: "Firewall installed and configured to protect cardholder data" },
      { id: "ns2", label: "No vendor-supplied default passwords or security parameters in use" },
      { id: "ns3", label: "Network access to cardholder data environment is restricted" },
    ],
  },
  {
    name: "Data Protection",
    icon: ShieldCheck,
    items: [
      { id: "dp1", label: "Cardholder data is not stored unless absolutely necessary" },
      { id: "dp2", label: "Cardholder data is encrypted during transmission over public networks" },
      { id: "dp3", label: "Systems and applications are kept up to date with security patches" },
    ],
  },
  {
    name: "Access Control",
    icon: ShieldAlert,
    items: [
      { id: "ac1", label: "Each person with system access has a unique user ID" },
      { id: "ac2", label: "Physical access to cardholder data is restricted" },
      { id: "ac3", label: "All access to network resources and cardholder data is logged and monitored" },
    ],
  },
  {
    name: "Regular Testing",
    icon: AlertTriangle,
    items: [
      { id: "rt1", label: "Regular vulnerability scans are performed" },
      { id: "rt2", label: "Security systems and processes are tested regularly" },
      { id: "rt3", label: "An incident response plan is maintained and tested" },
    ],
  },
];

const ALL_ITEMS = PCI_CATEGORIES.flatMap((c) => c.items);

export default function PciAssessment() {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total = ALL_ITEMS.length;
  const completed = checked.size;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  let statusLabel: string;
  let statusVariant: "default" | "secondary" | "destructive" | "outline";
  let statusColor: string;

  if (percentage === 100) {
    statusLabel = "Compliant";
    statusVariant = "default";
    statusColor = "bg-green-600 text-white";
  } else if (percentage >= 75) {
    statusLabel = "Needs Improvement";
    statusVariant = "secondary";
    statusColor = "bg-yellow-500 text-black";
  } else {
    statusLabel = "Action Required";
    statusVariant = "destructive";
    statusColor = "bg-red-600 text-white";
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="page-pci-assessment">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-pci-heading">
          PCI-DSS Self-Assessment
        </h1>
        <Badge className={statusColor} data-testid="badge-pci-status">
          {statusLabel}
        </Badge>
      </div>

      <Card data-testid="card-pci-intro">
        <CardContent className="pt-6 space-y-3">
          <p className="text-muted-foreground" data-testid="text-pci-intro">
            The Payment Card Industry Data Security Standard (PCI-DSS) is a set of security requirements designed to ensure that all companies that process, store, or transmit credit card information maintain a secure environment. Compliance is mandatory for all merchants who accept card payments.
          </p>
          <p className="text-muted-foreground">
            Use this self-assessment checklist to evaluate your current compliance posture. Check each item that your business currently meets, and track your progress toward full compliance.
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-pci-progress">
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground" data-testid="text-pci-score">
              Compliance Score: {percentage}%
            </span>
            <span className="text-sm text-muted-foreground" data-testid="text-pci-completed">
              {completed} of {total} requirements met
            </span>
          </div>
          <Progress value={percentage} className="h-3" data-testid="progress-pci-score" />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {PCI_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const catCompleted = category.items.filter((i) => checked.has(i.id)).length;
          return (
            <Card key={category.name} data-testid={`card-pci-category-${category.name.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="w-4 h-4 shrink-0" />
                  {category.name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {catCompleted}/{category.items.length}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                {category.items.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-start gap-3 cursor-pointer"
                    data-testid={`checkbox-pci-${item.id}`}
                  >
                    <Checkbox
                      checked={checked.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                      data-testid={`input-pci-${item.id}`}
                    />
                    <span className="text-sm text-muted-foreground leading-tight">
                      {item.label}
                    </span>
                  </label>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card data-testid="card-pci-disclaimer">
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground italic" data-testid="text-pci-disclaimer">
            This self-assessment is for informational purposes only and does not constitute a formal PCI-DSS audit. Contact a Qualified Security Assessor (QSA) for official certification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
