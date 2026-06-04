import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Code2, Copy, CheckCircle, ArrowRight, Zap, Globe, TrendingUp, Shield,
} from "lucide-react";

const steps = [
  {
    num: "1",
    title: "Get your embed code",
    desc: "Log in to the partner portal and visit the Widget Generator page. Enter your referral code and choose a light or dark theme to match your site.",
    code: null,
  },
  {
    num: "2",
    title: "Paste it into your website",
    desc: "Copy the single-line snippet and paste it anywhere in your page HTML — inside a sidebar, footer, landing page, or blog post. No developer needed.",
    code: `<div id="lb-widget"></div>\n<script src="https://libertybancard.com/widget/savings-calculator.js"\n  data-ref="YOUR_CODE"\n  data-theme="light">\n<\/script>`,
  },
  {
    num: "3",
    title: "Widget appears instantly",
    desc: "The calculator renders automatically, styled to fit your site. Visitors enter their monthly volume and current rate to see their estimated savings.",
    code: null,
  },
  {
    num: "4",
    title: "Earn on every lead",
    desc: "When a visitor clicks 'Get My Free Analysis,' they're sent to Liberty Bancard's statement upload page with your referral code pre-filled. Every lead is credited to you.",
    code: null,
  },
];

const benefits = [
  {
    icon: Zap,
    title: "One script tag — done",
    desc: "No React, no npm, no build step. Paste the snippet and it works on any site including WordPress, Squarespace, and Wix.",
  },
  {
    icon: Globe,
    title: "Embeds on any domain",
    desc: "The widget is served with open CORS headers (`Access-Control-Allow-Origin: *`) so it loads on any third-party domain without additional configuration.",
  },
  {
    icon: TrendingUp,
    title: "Passive lead generation",
    desc: "Every visitor who interacts with the widget and clicks through is a warm lead automatically attributed to your referral code.",
  },
  {
    icon: Shield,
    title: "Privacy-safe",
    desc: "The widget is purely client-side and collects no data from your visitors. No cookies, no tracking pixels.",
  },
];

const faqs = [
  {
    q: "Will this slow down my website?",
    a: "No. The widget script is tiny (under 5KB) and loads asynchronously so it never blocks your page.",
  },
  {
    q: "Can I put it in a sidebar or footer?",
    a: "Yes. Paste the snippet anywhere in your HTML — sidebar, blog post, landing page, or footer. The widget is responsive down to 300px width.",
  },
  {
    q: "What if my site uses a dark background?",
    a: "Set data-theme=\"dark\" in your snippet (available in the Widget Generator) and the widget will render with a dark color palette.",
  },
  {
    q: "How do I know which leads came from my widget?",
    a: "Every click on the 'Get My Free Analysis' button includes UTM parameters and your referral code in the URL, so all leads are tracked back to your embed automatically.",
  },
  {
    q: "Do I need to be an approved partner first?",
    a: "Yes. You need an approved partner account to access the Widget Generator and receive a referral code. Apply at the link below.",
  },
];

export default function PartnerEmbedWidget() {
  const domain = typeof window !== "undefined" ? window.location.origin : "https://libertybancard.com";
  const exampleSnippet = `<div id="lb-widget"></div>\n<script src="${domain}/widget/savings-calculator.js"\n  data-ref="YOUR_CODE"\n  data-theme="light">\n<\/script>`;

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Embed the Savings Calculator Widget — Liberty Bancard Partners"
        description="Add a free processing savings calculator to your website in one script tag. Show your clients how much they could save on merchant services. For CPA firms, bookkeepers, and ISO partners."
        path="/partners/embed-widget"
      />
      <Navbar />
      <main className="flex-grow pt-28">

        {/* Hero */}
        <section className="bg-gradient-to-br from-primary/5 via-background to-background py-16 md:py-20 border-b border-border/30">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              Partner Embed Widget
            </Badge>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground leading-tight mb-5 max-w-3xl">
              Add a Savings Calculator to Your Site — One Script Tag
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-2xl">
              Give your website visitors an instant estimate of how much they could save on payment processing. Every click sends a warm lead to Liberty Bancard — with your referral code attached.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/partner-portal">
                <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-hero-portal">
                  Get My Widget Code <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/partners">
                <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto" data-testid="button-hero-apply">
                  Apply as a Partner
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-14 md:py-16">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {benefits.map((b) => {
                const Icon = b.icon;
                return (
                  <div key={b.title} className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{b.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* How to Install */}
        <section className="py-14 md:py-16 bg-muted/30 border-y border-border/30">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3">
                How to Install the Widget
              </h2>
              <p className="text-muted-foreground">
                Four steps from zero to a live calculator on your site.
              </p>
            </div>

            <div className="space-y-8">
              {steps.map((step) => (
                <div key={step.num} className="flex gap-5">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-base font-bold shrink-0 mt-0.5">
                    {step.num}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-base mb-1">{step.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{step.desc}</p>
                    {step.code && (
                      <div className="relative">
                        <pre className="bg-background border border-border rounded-lg p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all leading-relaxed" data-testid="code-example-snippet">
                          {step.code}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Widget Options Reference */}
        <section className="py-14 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-display font-bold text-foreground mb-6 flex items-center gap-2">
              <Code2 className="w-5 h-5 text-primary" /> Widget Options
            </h2>
            <Card className="border-border/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-4 py-3 font-semibold text-foreground w-36">Attribute</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground w-28">Values</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="px-4 py-3 font-mono text-xs text-primary">data-ref</td>
                      <td className="px-4 py-3 text-muted-foreground">Any string</td>
                      <td className="px-4 py-3 text-muted-foreground">Your partner referral code. Included in every CTA click as a UTM parameter and ref code.</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-mono text-xs text-primary">data-theme</td>
                      <td className="px-4 py-3 text-muted-foreground"><code className="font-mono">light</code> | <code className="font-mono">dark</code></td>
                      <td className="px-4 py-3 text-muted-foreground">Visual theme for the widget. Defaults to <code className="font-mono">light</code>.</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-mono text-xs text-primary">data-container</td>
                      <td className="px-4 py-3 text-muted-foreground">Element ID</td>
                      <td className="px-4 py-3 text-muted-foreground">Optional. ID of the div to render into. Defaults to <code className="font-mono">lb-widget</code>.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </section>

        {/* Example Snippet */}
        <section className="py-14 md:py-16 bg-muted/30 border-y border-border/30">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-display font-bold text-foreground mb-4">Example Snippet</h2>
            <p className="text-sm text-muted-foreground mb-4">Replace <code className="font-mono text-primary bg-primary/5 px-1 py-0.5 rounded">YOUR_CODE</code> with your actual partner referral code from the Widget Generator.</p>
            <pre className="bg-background border border-border rounded-lg p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all leading-relaxed mb-6" data-testid="code-full-example">
              {exampleSnippet}
            </pre>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-14 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-8">Frequently Asked Questions</h2>
            <div className="space-y-6">
              {faqs.map((faq) => (
                <div key={faq.q}>
                  <h3 className="font-semibold text-foreground mb-1.5">{faq.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-14 md:py-16 bg-primary/5 border-t border-primary/10">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <CheckCircle className="w-10 h-10 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-display font-bold text-foreground mb-3">Ready to add the widget?</h2>
            <p className="text-muted-foreground mb-6">
              Log in to the partner portal to get your personalized embed code from the Widget Generator, or apply now to become a partner.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/partner-portal">
                <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-cta-portal">
                  Go to Widget Generator <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/partners">
                <Button size="lg" variant="outline" className="w-full sm:w-auto" data-testid="button-cta-apply">
                  Apply as a Partner
                </Button>
              </Link>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}
