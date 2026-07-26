import { Link } from "wouter";
import { ShieldOff, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <ShieldOff className="w-14 h-14 text-muted-foreground mb-4" />
      <h1 className="text-2xl font-bold mb-2">Access Restricted</h1>
      <p className="text-muted-foreground max-w-sm mb-6">
        You don't have permission to view this section. If you believe this is an error, contact your administrator.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Link>
      </Button>
    </div>
  );
}
