import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bookmark, X, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SavedFilter } from "@shared/schema";

interface SavedFilterBarProps {
  entityType: string;
  currentFilters: Record<string, unknown>;
  onApplyFilter: (filters: Record<string, unknown>) => void;
}

export default function SavedFilterBar({ entityType, currentFilters, onApplyFilter }: SavedFilterBarProps) {
  const { toast } = useToast();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);

  const { data: savedFilters } = useQuery<SavedFilter[]>({
    queryKey: ["/api/saved-filters", { entityType }],
    queryFn: async () => {
      const res = await fetch(`/api/saved-filters?entityType=${entityType}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createFilterMutation = useMutation({
    mutationFn: async (data: { name: string; entityType: string; filters: Record<string, unknown> }) => {
      const res = await apiRequest("POST", "/api/saved-filters", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters"] });
      setSaveDialogOpen(false);
      setFilterName("");
      toast({ title: "Filter saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save filter", description: err.message, variant: "destructive" });
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/saved-filters/${id}`);
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters"] });
      if (activeFilterId === deletedId) {
        setActiveFilterId(null);
      }
      toast({ title: "Filter deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete filter", description: err.message, variant: "destructive" });
    },
  });

  const hasActiveFilters = Object.values(currentFilters).some(v => v !== "" && v !== "all" && v !== undefined && v !== null);

  const handleSave = () => {
    if (!filterName.trim()) return;
    createFilterMutation.mutate({
      name: filterName.trim(),
      entityType,
      filters: currentFilters,
    });
  };

  const handleApply = (filter: SavedFilter) => {
    setActiveFilterId(filter.id);
    onApplyFilter(filter.filters as Record<string, unknown>);
  };

  const handleClearActive = () => {
    setActiveFilterId(null);
    onApplyFilter({});
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="saved-filter-bar">
      <Bookmark className="w-4 h-4 text-muted-foreground shrink-0" />

      {savedFilters && savedFilters.length > 0 && (
        savedFilters.map((filter) => (
          <div key={filter.id} className="flex items-center gap-0.5" data-testid={`saved-filter-${filter.id}`}>
            <Badge
              variant={activeFilterId === filter.id ? "default" : "outline"}
              className="cursor-pointer gap-1"
              onClick={() => handleApply(filter)}
              data-testid={`button-apply-filter-${filter.id}`}
            >
              {filter.name}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => { e.stopPropagation(); deleteFilterMutation.mutate(filter.id); }}
              aria-label={`Delete filter ${filter.name}`}
              data-testid={`button-delete-filter-${filter.id}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))
      )}

      {activeFilterId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearActive}
          data-testid="button-clear-filter"
        >
          Clear
        </Button>
      )}

      {hasActiveFilters && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setSaveDialogOpen(true)}
          data-testid="button-save-filter"
        >
          <Save className="w-3 h-3" />
          Save Filter
        </Button>
      )}

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent data-testid="dialog-save-filter">
          <DialogHeader>
            <DialogTitle>Save Current Filter</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="Filter name..."
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              data-testid="input-filter-name"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)} data-testid="button-cancel-save-filter">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!filterName.trim() || createFilterMutation.isPending}
                data-testid="button-confirm-save-filter"
              >
                {createFilterMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
