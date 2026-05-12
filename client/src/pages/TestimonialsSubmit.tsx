import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackConversion } from "@/lib/analytics";
import {
  Video,
  CheckCircle,
  Loader2,
  ArrowLeft,
  Star,
  Upload,
  Link2,
} from "lucide-react";

export default function TestimonialsSubmit() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [industry, setIndustry] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [savingsAmount, setSavingsAmount] = useState("");
  const [story, setStory] = useState("");

  const canSubmit = name.trim() && businessName.trim() && email.trim() && story.trim();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/testimonial-submit", {
        name,
        businessName,
        email,
        phone,
        industry,
        videoLink,
        savingsAmount,
        story,
      });
      trackConversion("testimonial_submit", { industry, has_video: !!videoLink });
      setSubmitted(true);
    } catch (error: any) {
      toast({
        title: "Something went wrong",
        description: error.message || "Please try again or email us directly.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const industries = [
    "Restaurant",
    "Retail",
    "Healthcare / Medical",
    "Auto Repair",
    "Home Services",
    "E-Commerce",
    "Salon / Spa",
    "Construction",
    "Other",
  ];

  return (
    <>
      <SEO
        title="Submit Your Merchant Testimonial"
        description="Share your Liberty Bancard success story. Tell us your savings and we will feature your testimonial to help other merchants learn about transparent payment processing."
        path="/testimonials/submit"
        keywords="submit testimonial, merchant story, payment processing review, Liberty Bancard feedback"
        breadcrumbs={[
          { name: "Testimonials", path: "/testimonials" },
          { name: "Submit Your Story", path: "/testimonials/submit" },
        ]}
      />

      <Navbar />

      <main className="pt-32 pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <Link
              href="/testimonials"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
              data-testid="link-back-testimonials"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Testimonials
            </Link>

            <Badge variant="secondary" className="mb-4" data-testid="badge-submit">
              Merchant Stories
            </Badge>
            <h1
              className="text-3xl sm:text-4xl font-bold tracking-tight mb-4"
              data-testid="text-submit-title"
            >
              Submit Your Story
            </h1>
            <p
              className="text-muted-foreground leading-relaxed"
              data-testid="text-submit-subtitle"
            >
              We'd love to feature you on our testimonials page. Share what you were paying, what changed, and what the savings meant for your business.
            </p>
          </div>

          {submitted ? (
            <Card
              className="border-2 border-emerald-200 dark:border-emerald-800"
              data-testid="card-submit-success"
            >
              <CardContent className="p-10 text-center">
                <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
                <h2
                  className="text-2xl font-bold mb-3"
                  data-testid="text-submit-success-heading"
                >
                  Thank You!
                </h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  We've received your submission. Our team will review it and reach out within 2 business days to talk through the details and get your story featured.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <Link href="/testimonials" data-testid="link-success-back">
                    <Button variant="outline" className="gap-2">
                      <ArrowLeft className="w-4 h-4" />
                      View Testimonials
                    </Button>
                  </Link>
                  <Link href="/case-studies" data-testid="link-success-case-studies">
                    <Button className="gap-2">
                      Read Case Studies
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card data-testid="card-submit-form">
                <CardContent className="p-6 space-y-5">
                  <h2 className="text-lg font-semibold text-foreground">Your Info</h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        className="text-sm font-medium text-foreground mb-1.5 block"
                        htmlFor="submit-name"
                      >
                        Your Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="submit-name"
                        placeholder="First and Last"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        data-testid="input-name"
                      />
                    </div>
                    <div>
                      <label
                        className="text-sm font-medium text-foreground mb-1.5 block"
                        htmlFor="submit-business"
                      >
                        Business Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="submit-business"
                        placeholder="Your Business"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        data-testid="input-business-name"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        className="text-sm font-medium text-foreground mb-1.5 block"
                        htmlFor="submit-email"
                      >
                        Email <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="submit-email"
                        type="email"
                        placeholder="you@business.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        data-testid="input-email"
                      />
                    </div>
                    <div>
                      <label
                        className="text-sm font-medium text-foreground mb-1.5 block"
                        htmlFor="submit-phone"
                      >
                        Phone (optional)
                      </label>
                      <Input
                        id="submit-phone"
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        data-testid="input-phone"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Industry
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {industries.map((ind) => (
                        <button
                          key={ind}
                          onClick={() => setIndustry(ind)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            industry === ind
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:border-primary/50"
                          }`}
                          data-testid={`button-industry-${ind.toLowerCase().replace(/\s|\//g, "-")}`}
                        >
                          {ind}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-submit-story">
                <CardContent className="p-6 space-y-5">
                  <h2 className="text-lg font-semibold text-foreground">Your Story</h2>

                  <div>
                    <label
                      className="text-sm font-medium text-foreground mb-1.5 block"
                      htmlFor="submit-savings"
                    >
                      Approximate Annual Savings (optional)
                    </label>
                    <Input
                      id="submit-savings"
                      placeholder="e.g. $3,500/year"
                      value={savingsAmount}
                      onChange={(e) => setSavingsAmount(e.target.value)}
                      data-testid="input-savings"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      What did your statement review reveal you were saving?
                    </p>
                  </div>

                  <div>
                    <label
                      className="text-sm font-medium text-foreground mb-1.5 block"
                      htmlFor="submit-story"
                    >
                      Tell Us Your Story <span className="text-red-500">*</span>
                    </label>
                    <Textarea
                      id="submit-story"
                      placeholder="What were you paying before? What changed? What has the savings meant for your business?"
                      value={story}
                      onChange={(e) => setStory(e.target.value)}
                      rows={5}
                      data-testid="textarea-story"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      A few sentences is fine — we'll follow up to fill in any details.
                    </p>
                  </div>

                  <div>
                    <label
                      className="text-sm font-medium text-foreground mb-1.5 block"
                      htmlFor="submit-video"
                    >
                      Video Link (optional)
                    </label>
                    <div className="relative">
                      <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="submit-video"
                        type="url"
                        placeholder="https://youtube.com/... or https://vimeo.com/..."
                        value={videoLink}
                        onChange={(e) => setVideoLink(e.target.value)}
                        className="pl-9"
                        data-testid="input-video-link"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Have a video on YouTube, Vimeo, or another platform? Paste the link here. No video? No problem — we can help you record one.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-muted/30" data-testid="card-submit-consent">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <Star className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">
                        How We Use Your Story
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        By submitting, you give Liberty Bancard permission to feature your testimonial on our website, social media, and marketing materials. We'll always use your first name and general location only (e.g., "Maria R. — South Miami, FL"). We'll reach out before publishing anything.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  className="flex-1 gap-2"
                  onClick={handleSubmit}
                  disabled={submitting || !canSubmit}
                  data-testid="button-submit-story"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  Submit My Story
                </Button>
                <Link href="/testimonials" data-testid="link-cancel-submit">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    Cancel
                  </Button>
                </Link>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Questions? Email{" "}
                <a
                  href="mailto:support@libertybancard.com"
                  className="text-primary underline"
                  data-testid="link-email-support"
                >
                  support@libertybancard.com
                </a>
              </p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </>
  );
}
