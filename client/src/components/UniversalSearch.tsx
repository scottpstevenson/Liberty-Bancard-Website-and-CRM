import { useState, useEffect, useRef } from "react"
import { useLocation } from "wouter"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Users, TrendingUp, Ticket, ClipboardList, Target, Loader2, SlidersHorizontal, X } from "lucide-react"

interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  href: string;
}

interface AdvancedResults {
  contacts: any[];
  deals: any[];
  tickets: any[];
  tasks: any[];
}

const typeIcons: Record<string, typeof Users> = {
  contact: Users,
  deal: TrendingUp,
  ticket: Ticket,
  task: ClipboardList,
  prospect: Target,
};

export default function UniversalSearch() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedResults, setAdvancedResults] = useState<AdvancedResults | null>(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [tags, setTags] = useState("");
  const [entityType, setEntityType] = useState("all");

  useEffect(() => {
    if (showAdvanced) return;
    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          credentials: "include",
        });
        const data = await response.json();
        setResults(data.results || []);
        setIsOpen(true);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, showAdvanced]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (!showAdvanced) setShowAdvanced(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAdvanced]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setIsOpen(false);
      setShowAdvanced(false);
    }
  }

  function handleResultClick(href: string) {
    setIsOpen(false);
    setShowAdvanced(false);
    setQuery("");
    setAdvancedResults(null);
    setLocation(href);
  }

  async function handleAdvancedSearch() {
    setAdvancedLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (assignedTo) params.set("assignedTo", assignedTo);
      if (tags) params.set("tags", tags);
      if (entityType && entityType !== "all") params.set("entityType", entityType);

      const res = await fetch(`/api/search/advanced?${params.toString()}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAdvancedResults(data);
      }
    } catch {
      setAdvancedResults(null);
    } finally {
      setAdvancedLoading(false);
    }
  }

  function clearAdvanced() {
    setDateFrom("");
    setDateTo("");
    setAssignedTo("");
    setTags("");
    setEntityType("all");
    setAdvancedResults(null);
    setShowAdvanced(false);
  }

  function getAdvancedResultHref(type: string, item: any): string {
    switch (type) {
      case "contacts": return `/dashboard/contacts/${item.id}`;
      case "deals": return `/dashboard/pipeline`;
      case "tickets": return `/dashboard/tickets`;
      case "tasks": return `/dashboard/tasks`;
      default: return "/dashboard";
    }
  }

  function getAdvancedResultTitle(type: string, item: any): string {
    switch (type) {
      case "contacts": return `${item.firstName} ${item.lastName}`;
      case "deals": return `Deal #${item.id} - ${item.stage}`;
      case "tickets": return item.subject;
      case "tasks": return item.title;
      default: return `#${item.id}`;
    }
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  const totalAdvancedResults = advancedResults
    ? (advancedResults.contacts?.length || 0) + (advancedResults.deals?.length || 0) + (advancedResults.tickets?.length || 0) + (advancedResults.tasks?.length || 0)
    : 0;

  const advancedTypeIcons: Record<string, typeof Users> = {
    contacts: Users,
    deals: TrendingUp,
    tickets: Ticket,
    tasks: ClipboardList,
  };

  return (
    <div ref={containerRef} className="relative max-w-sm" onKeyDown={handleKeyDown}>
      <div className="relative flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            data-testid="input-universal-search"
            placeholder="Search contacts, deals, tickets..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
          {isLoading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button
          variant={showAdvanced ? "default" : "ghost"}
          size="icon"
          onClick={() => { setShowAdvanced(!showAdvanced); setIsOpen(false); }}
          data-testid="button-advanced-search"
          aria-label={showAdvanced ? "Close advanced search" : "Open advanced search"}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
      </div>

      {showAdvanced && (
        <Card
          data-testid="panel-advanced-search"
          className="absolute top-full left-0 right-0 mt-1 z-50 p-4 space-y-3"
          style={{ minWidth: "320px" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Advanced Search</span>
            <Button variant="ghost" size="icon" onClick={clearAdvanced} data-testid="button-close-advanced" aria-label="Close advanced search">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-advanced-date-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-advanced-date-to"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Assigned To</Label>
            <Input
              placeholder="Filter by assignee..."
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              data-testid="input-advanced-assigned-to"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tags (comma-separated)</Label>
            <Input
              placeholder="e.g. vip, high-value"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              data-testid="input-advanced-tags"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Entity Type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger data-testid="select-advanced-entity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="contact">Contacts</SelectItem>
                <SelectItem value="deal">Deals</SelectItem>
                <SelectItem value="ticket">Tickets</SelectItem>
                <SelectItem value="task">Tasks</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full gap-2"
            onClick={handleAdvancedSearch}
            disabled={advancedLoading}
            data-testid="button-run-advanced-search"
          >
            {advancedLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </Button>

          {advancedResults && (
            <div className="border-t pt-3 max-h-60 overflow-auto" data-testid="advanced-search-results">
              {totalAdvancedResults === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-advanced-results">
                  No results found
                </div>
              ) : (
                Object.entries(advancedResults).map(([type, items]) => {
                  if (!items || items.length === 0) return null;
                  const Icon = advancedTypeIcons[type] || Search;
                  return (
                    <div key={type} data-testid={`advanced-results-group-${type}`}>
                      <div className="px-1 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {type} ({items.length})
                      </div>
                      {items.slice(0, 10).map((item: any) => (
                        <button
                          key={`${type}-${item.id}`}
                          data-testid={`advanced-result-${type}-${item.id}`}
                          onClick={() => handleResultClick(getAdvancedResultHref(type, item))}
                          className="w-full flex items-center gap-3 px-1 py-1.5 text-left hover-elevate rounded-md"
                        >
                          <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{getAdvancedResultTitle(type, item)}</div>
                          </div>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {type.slice(0, -1)}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </Card>
      )}

      {isOpen && !showAdvanced && (
        <Card
          data-testid="dropdown-search-results"
          className="absolute top-full left-0 right-0 mt-1 max-h-80 overflow-auto z-50"
        >
          {results.length === 0 ? (
            <div
              data-testid="text-no-results"
              className="p-4 text-sm text-muted-foreground text-center"
            >
              No results found
            </div>
          ) : (
            <div className="py-1">
              {Object.entries(grouped).map(([type, items]) => (
                <div key={type}>
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {type}s
                  </div>
                  {items.map((item) => {
                    const Icon = typeIcons[item.type] || Search;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        data-testid={`search-result-${item.type}-${item.id}`}
                        onClick={() => handleResultClick(item.href)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover-elevate"
                      >
                        <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{item.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {item.type}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
