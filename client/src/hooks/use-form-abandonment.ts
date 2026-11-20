import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { hasAnalyticsConsent, hasMarketingConsent, trackFormAbandoned } from "@/lib/tracking";

const ABANDONED_FORMS_KEY = "lb_abandoned_forms";

function getAbandonedForms(): Set<string> {
  if (!hasAnalyticsConsent() && !hasMarketingConsent()) return new Set();
  try {
    const stored = sessionStorage.getItem(ABANDONED_FORMS_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function markFormAbandoned(formId: string): void {
  if (!hasAnalyticsConsent() && !hasMarketingConsent()) return;
  try {
    const forms = getAbandonedForms();
    forms.add(formId);
    sessionStorage.setItem(ABANDONED_FORMS_KEY, JSON.stringify([...forms]));
  } catch {}
}

function fireAbandonmentEvent(formId: string): void {
  trackFormAbandoned(formId);
}

/**
 * Wave 8 — Form Abandonment Hook
 *
 * Fires "form_abandoned" to GA4/fbq (client-side only — no server ingestion)
 * when the user navigates away or hides the tab while the form is dirty
 * and has not been submitted.
 *
 * Usage: call near the top of a form component, passing formState.isDirty.
 *   useFormAbandonment("upload_statement", isDirty);
 *
 * Rules:
 * - Fires at most once per formId per session
 * - Never fires on submitted forms (caller must set isDirty=false on submit)
 * - Reads no field values
 * - Degrades safely if beacon/gtag/fbq are unavailable
 */
export function useFormAbandonment(formId: string, isDirty: boolean): void {
  const [location] = useLocation();
  const prevLocation = useRef(location);
  const submittedRef = useRef(false);
  const firedRef = useRef(false);

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    if (isDirty) {
      submittedRef.current = false;
    }
  }, [isDirty]);

  useEffect(() => {
    const already = getAbandonedForms();
    if (already.has(formId)) {
      firedRef.current = true;
    }
  }, [formId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        (hasAnalyticsConsent() || hasMarketingConsent()) &&
        document.visibilityState === "hidden" &&
        isDirtyRef.current &&
        !submittedRef.current &&
        !firedRef.current
      ) {
        firedRef.current = true;
        markFormAbandoned(formId);
        fireAbandonmentEvent(formId);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [formId]);

  useEffect(() => {
    if (
      (hasAnalyticsConsent() || hasMarketingConsent()) &&
      prevLocation.current !== location &&
      isDirtyRef.current &&
      !submittedRef.current &&
      !firedRef.current
    ) {
      firedRef.current = true;
      markFormAbandoned(formId);
      fireAbandonmentEvent(formId);
    }
    prevLocation.current = location;
  }, [location, formId]);
}
