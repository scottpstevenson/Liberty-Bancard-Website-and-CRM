import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  ExternalLink,
  Send,
  MoreVertical,
  Zap,
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
} from "lucide-react";
import { format } from "date-fns";
import type { CoBrandedProposal, Contact } from "@shared/schema";

type ProposalWithContact = CoBrandedProposal & {
  contact: Pick<Contact, "id" | "firstName" | "lastName" | "email" | "ghlContactId"> | null;
};

export default function CoBrandedProposals() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedProposal, setSelectedProposal] = useState<ProposalWithContact | null>(null);
  const [workflowKey, setWorkflowKey] = useState("");

  const { data: proposals = [], isLoading } = useQuery<ProposalWithContact[]>({
    queryKey: ["/api/co-branded-proposals"],
  });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/co-branded-proposals/${id}/send`);
    },
    onSuccess: () => {
      toast({ title: "Proposal sent successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/co-branded-proposals"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to send proposal",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async ({ id, workflowKey }: { id: number; workflowKey: string }) => {
      await apiRequest("POST", `/api/co-branded-proposals/${id}/enroll-workflow`, { workflowKey });
    },
    onSuccess: () => {
      toast({ title: "Enrolled in workflow successfully" });
      setSelectedProposal(null);
      setWorkflowKey("");
    },
    onError: (err: Error) => {
      toast({
        title: "Enrollment failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/co-branded-proposal/${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied to clipboard" });
  };

  const filteredProposals = proposals.filter((p) =>
    p.merchantName?.toLowerCase().includes(search.toLowerCase()) ||
    p.token.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Co-Branded Proposals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage and track all co-branded partner proposals
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search merchants..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-proposals"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>GHL Sync</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredProposals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    No proposals found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProposals.map((proposal) => (
                  <TableRow key={proposal.id} data-testid={`row-proposal-${proposal.id}`}>
                    <TableCell>
                      <div className="font-medium">{proposal.merchantName}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {proposal.token}
                      </div>
                    </TableCell>
                    <TableCell>
                      {proposal.contact?.ghlContactId ? (
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-xs">Synced</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span className="text-xs">Pending</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={proposal.status === "accepted" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {proposal.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {proposal.merchantMonthlyVolume ? `$${proposal.merchantMonthlyVolume}` : "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {proposal.createdAt ? format(new Date(proposal.createdAt), "MMM d, yyyy") : "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {proposal.createdBy || "System"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${proposal.id}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem
                            onClick={() => copyLink(proposal.token)}
                            className="gap-2"
                            data-testid={`button-copy-link-${proposal.id}`}
                          >
                            <Copy className="w-4 h-4" /> Copy Link
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a
                              href={`/co-branded-proposal/${proposal.token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="gap-2 w-full cursor-pointer"
                              data-testid={`button-preview-${proposal.id}`}
                            >
                              <ExternalLink className="w-4 h-4" /> Preview
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => sendMutation.mutate(proposal.id)}
                            disabled={sendMutation.isPending}
                            className="gap-2"
                            data-testid={`button-send-ghl-${proposal.id}`}
                          >
                            <Send className="w-4 h-4" />
                            {sendMutation.isPending ? "Sending..." : "Send via GHL"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedProposal(proposal)}
                            className="gap-2 text-primary focus:text-primary"
                            data-testid={`button-enroll-workflow-${proposal.id}`}
                          >
                            <Zap className="w-4 h-4" /> Enroll in Workflow
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedProposal} onOpenChange={(open) => !open && setSelectedProposal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll in GHL Workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Workflow</label>
              <Select value={workflowKey} onValueChange={setWorkflowKey}>
                <SelectTrigger data-testid="select-workflow">
                  <SelectValue placeholder="Choose a workflow..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proposal_followup">Proposal Follow-Up</SelectItem>
                  <SelectItem value="long_term_nurture">Long-Term Nurture</SelectItem>
                  <SelectItem value="statement_analyzed">Statement Analyzed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setSelectedProposal(null)}>
                Cancel
              </Button>
              <Button
                disabled={!workflowKey || enrollMutation.isPending}
                onClick={() =>
                  selectedProposal &&
                  enrollMutation.mutate({ id: selectedProposal.id, workflowKey })
                }
                data-testid="button-confirm-enroll"
              >
                {enrollMutation.isPending ? "Enrolling..." : "Enroll Now"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
