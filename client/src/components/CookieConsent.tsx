import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "wouter";
import { Shield, X, Settings, Check } from "lucide-react";

type ConsentPreferences = {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
};

const CONSENT_KEY = "lb_cookie_consent";
const CONSENT_PREFS_KEY = "lb_cookie_prefs";

function getStoredConsent(): string | null {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function getStoredPrefs(): ConsentPreferences {
  try {
    const raw = localStorage.getItem(CONSENT_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { necessary: true, analytics: false, marketing: false, functional: false };
}

function storeConsent(level: string, prefs: ConsentPreferences) {
  try {
    localStorage.setItem(CONSENT_KEY, level);
    localStorage.setItem(CONSENT_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<ConsentPreferences>(getStoredPrefs());

  useEffect(() => {
    const consent = getStoredConsent();
    if (!consent) setVisible(true);
  }, []);

  if (!visible) return null;

  const acceptAll = () => {
    const all = { necessary: true, analytics: true, marketing: true, functional: true };
    storeConsent("all", all);
    setVisible(false);
  };

  const rejectNonEssential = () => {
    const essential = { necessary: true, analytics: false, marketing: false, functional: false };
    storeConsent("essential", essential);
    setVisible(false);
  };

  const savePrefs = () => {
    storeConsent("custom", { ...prefs, necessary: true });
    setVisible(false);
  };

  const togglePref = (key: keyof ConsentPreferences) => {
    if (key === "necessary") return;
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-4" data-testid="cookie-consent-banner">
      <Card className="max-w-2xl mx-auto p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3">
            {!showPrefs ? (
              <>
                <div>
                  <p className="text-sm font-medium text-foreground mb-1">We value your privacy</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    We use cookies and similar technologies to improve your experience, analyze site traffic, and personalize content. By clicking "Accept All," you consent to our use of cookies. You can manage your preferences or reject non-essential cookies.{" "}
                    <Link href="/privacy-policy" className="underline">Privacy Policy</Link>{" | "}
                    <Link href="/cookie-policy" className="underline">Cookie Policy</Link>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={acceptAll} data-testid="button-cookie-accept">
                    Accept All
                  </Button>
                  <Button size="sm" variant="outline" onClick={rejectNonEssential} data-testid="button-cookie-reject">
                    Reject Non-Essential
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowPrefs(true)} data-testid="button-cookie-manage">
                    <Settings className="w-3.5 h-3.5 mr-1" />
                    Manage Preferences
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Cookie Preferences</p>
                <div className="space-y-2">
                  {([
                    { key: "necessary" as const, label: "Strictly Necessary", desc: "Required for the website to function. Cannot be disabled.", locked: true },
                    { key: "functional" as const, label: "Functional", desc: "Enable enhanced functionality and personalization.", locked: false },
                    { key: "analytics" as const, label: "Analytics", desc: "Help us understand how visitors interact with our website.", locked: false },
                    { key: "marketing" as const, label: "Marketing", desc: "Used to deliver relevant advertisements and track campaigns.", locked: false },
                  ]).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                    >
                      <div
                        className={`w-8 h-5 rounded-full relative transition-colors ${prefs[item.key] ? "bg-primary" : "bg-muted"} ${item.locked ? "opacity-60" : ""}`}
                        onClick={(e) => { e.preventDefault(); if (!item.locked) togglePref(item.key); }}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${prefs[item.key] ? "translate-x-3.5" : "translate-x-0.5"}`} />
                      </div>
                      <div className="flex-1">
                        <span className="text-xs font-medium text-foreground">{item.label}</span>
                        <span className="text-xs text-muted-foreground ml-1">- {item.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={savePrefs} data-testid="button-cookie-save-prefs">
                    <Check className="w-3.5 h-3.5 mr-1" />
                    Save Preferences
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowPrefs(false)}>
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
          <button onClick={rejectNonEssential} className="text-muted-foreground hover:text-foreground p-1" data-testid="button-cookie-close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </Card>
    </div>
  );
}
