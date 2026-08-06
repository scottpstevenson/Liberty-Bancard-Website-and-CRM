import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Phone, X, MessageCircle, Loader2, CheckCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackPhoneCallClick } from "@/lib/analytics";

export function ContactBubble() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/callback", {
        name, phone, bestTime: "ASAP",
      });
      setSubmitted(true);
    } catch (error: any) {
      toast({
        title: "Something went wrong",
        description: "Please try calling us at 954-266-8214.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 hidden lg:block" data-testid="contact-bubble">
      {open && (
        <Card className="mb-3 w-72 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200" data-testid="contact-bubble-panel">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-sm font-semibold text-foreground">Need a quick answer?</span>
              <Button size="icon" variant="ghost" aria-label="Close" onClick={() => setOpen(false)} data-testid="button-bubble-close">
                <X className="w-4 h-4" />
              </Button>
            </div>
            {submitted ? (
              <div className="text-center py-4">
                <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">We'll call you back shortly.</p>
                <p className="text-xs text-muted-foreground mt-1">Usually within 30 minutes during business hours.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Leave your number and we'll call you back. No pressure.</p>
                <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-bubble-name" />
                <Input type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-bubble-phone" />
                <Button className="w-full gap-2" onClick={handleSubmit} disabled={submitting || !name.trim() || !phone.trim()} data-testid="button-bubble-submit">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                  Request Callback
                </Button>
                <div className="text-center">
                  <a href="tel:9542668214" className="text-xs text-primary font-medium" data-testid="link-bubble-call" onClick={() => trackPhoneCallClick({}).catch(() => {})}>
                    Or call 954-266-8214
                  </a>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Button
        size="icon"
        className="rounded-full shadow-lg"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close contact bubble" : "Open contact bubble"}
        data-testid="button-bubble-toggle"
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </Button>
    </div>
  );
}
