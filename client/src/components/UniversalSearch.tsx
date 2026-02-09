import { useState, useEffect, useRef } from "react"
import { useLocation } from "wouter"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Search, Users, TrendingUp, Ticket, ClipboardList, Target, Loader2 } from "lucide-react"

interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  href: string;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
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
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  function handleResultClick(href: string) {
    setIsOpen(false);
    setQuery("");
    setLocation(href);
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  return (
    <div ref={containerRef} className="relative max-w-sm" onKeyDown={handleKeyDown}>
      <div className="relative">
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

      {isOpen && (
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
