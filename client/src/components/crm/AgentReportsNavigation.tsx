import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";

/** Presentation only. Existing route and reader guards remain authoritative;
 * agents never enter the privileged ReportingHub through this navigation. */
export function AgentReportsNavigation() {
  const [location] = useLocation();
  return (
    <nav aria-label="Your reports" className="flex flex-wrap items-center gap-2" data-testid="agent-reports-navigation">
      <span className="text-xs font-medium text-muted-foreground">Your reports</span>
      {[
        {href:"/dashboard/my-earnings",label:"Earnings"},
        {href:"/dashboard/leaderboard",label:"Leaderboard"},
      ].map(({href,label})=>(
        <Button key={href} asChild variant={location===href?"secondary":"outline"} className="min-h-11">
          <Link href={href} aria-current={location===href?"page":undefined}>{label}</Link>
        </Button>
      ))}
    </nav>
  );
}
