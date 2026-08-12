import { ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { TourContext } from "./TourContext";
import { TourModal } from "./TourModal";
import { getCsrfToken } from "@/lib/queryClient";
import type { TourRole } from "./tourSteps";

interface TourProviderProps {
  children: ReactNode;
}

export function TourProvider({ children }: TourProviderProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tourOpen, setTourOpen] = useState(false);
  // Track whether we've already auto-opened to avoid doing it again on re-render
  const autoOpened = useRef(false);

  // Determine role for step selection
  const role = (user?.role as TourRole | undefined);
  const isStaff = role === "admin" || role === "manager" || role === "agent";

  // Auto-open on first login (tour_completed_at is null)
  useEffect(() => {
    if (!user || !isStaff || autoOpened.current) return;
    // tour_completed_at comes back as a string from JSON or null
    const completed = (user as any).tourCompletedAt ?? (user as any).tour_completed_at;
    if (!completed) {
      autoOpened.current = true;
      const t = setTimeout(() => setTourOpen(true), 1000);
      return () => clearTimeout(t);
    }
  }, [user, isStaff]);

  const markComplete = useCallback(async () => {
    try {
      const csrfToken = getCsrfToken();
      await fetch("/api/auth/tour-complete", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
      });
      // Refresh the user object so tour_completed_at is populated
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch {
      // Non-critical — don't surface errors for tour completion
    }
  }, [queryClient]);

  const openTour = useCallback(() => {
    setTourOpen(true);
  }, []);

  const closeTour = useCallback(() => {
    setTourOpen(false);
  }, []);

  function handleTourClose(completed: boolean) {
    setTourOpen(false);
    // Always mark complete on skip or finish (idempotent server-side)
    markComplete();
  }

  return (
    <TourContext.Provider value={{ openTour, closeTour }}>
      {children}
      {isStaff && (
        <TourModal
          open={tourOpen}
          role={role!}
          onClose={handleTourClose}
        />
      )}
    </TourContext.Provider>
  );
}
