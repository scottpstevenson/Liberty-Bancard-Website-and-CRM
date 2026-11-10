import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Phone } from "lucide-react";
import { PHONE_NUMBER, PHONE_TEL } from "@/lib/constants";
import { trackPhoneCallClick } from "@/lib/analytics";
import { TerminalInquiryForm } from "@/components/intake/TerminalInquiryForm";
import { TERMINAL_INQUIRY_PAGE, TERMINAL_INQUIRY_PATH, readTerminalIntent } from "@shared/public-terminal-inquiry";

/**
 * Terminal-specific eligibility mode of /get-started. It replaces the six-question goal quiz when terminal intent is already
 * known (`?offer=free-terminal` or the compatible `?terminal=yes`). The offer is an allowlisted route value: it only selects a
 * server-owned offer record and is never echoed, stored as a destination, or used to navigate. The intent contract and the
 * page copy live in a shared module so the server-rendered first response says the same thing.
 */
export { readTerminalIntent };

export default function GetStartedTerminal({ offer }: { offer: "free-terminal" | null }) {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={TERMINAL_INQUIRY_PAGE.title}
        description={TERMINAL_INQUIRY_PAGE.description}
        path={TERMINAL_INQUIRY_PATH}
        breadcrumbs={[{ name: "Get Started", path: TERMINAL_INQUIRY_PATH }]}
      />
      <Navbar />
      <main className="marketing-surface flex-grow public-main-offset" data-testid="page-get-started-terminal">
        <section className="bg-background border-b border-border" data-testid="section-terminal-inquiry-hero">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
            <div className="accent-rule pt-5">
              <h1 className="public-h1 font-display font-bold text-foreground mb-4" data-testid="text-terminal-inquiry-heading">
                {TERMINAL_INQUIRY_PAGE.heading}
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed" data-testid="text-terminal-inquiry-body">
                {TERMINAL_INQUIRY_PAGE.body}
              </p>
            </div>
          </div>
        </section>
        <section className="bg-muted/30 py-10" data-testid="section-terminal-inquiry-form">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            <TerminalInquiryForm offer={offer} />
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {TERMINAL_INQUIRY_PAGE.phoneLead}{" "}
              <a href={PHONE_TEL} className="inline-flex items-center gap-1 underline" data-testid="link-terminal-inquiry-phone" onClick={() => trackPhoneCallClick({ sourcePage: "/get-started" })}>
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                {PHONE_NUMBER}
              </a>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
