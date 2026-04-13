import { useState, useMemo } from "react";
import { Link } from "wouter";
import { SEO, getFAQSchema, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Rocket,
  Receipt,
  Wrench,
  Settings,
  ShieldCheck,
  HelpCircle,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import {
  helpCategories,
  helpArticles,
  getArticlesByCategory,
  getPopularArticles,
  searchArticles,
} from "@/lib/help-center-data";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

const iconMap: Record<string, typeof Rocket> = {
  Rocket,
  Receipt,
  Wrench,
  Settings,
  ShieldCheck,
  HelpCircle,
};

export default function HelpCenter() {
  const [query, setQuery] = useState("");
  const containerRef = useScrollReveal();

  const results = useMemo(() => {
    if (query.trim().length < 2) return [];
    return searchArticles(query.trim()).slice(0, 10);
  }, [query]);

  const popular = getPopularArticles();

  const faqItems = [
    { question: "How long does merchant account approval take?", answer: "Most merchant applications are reviewed and approved within 24-48 hours. The complete process from application to first transaction is typically 3-5 business days." },
    { question: "Do I need a long-term contract?", answer: "Liberty Bancard offers month-to-month processing agreements with no early termination fees. You can close your account at any time without penalty." },
    { question: "What is next-day funding?", answer: "Next-day funding means the money from your credit card transactions is deposited into your bank account the following business day, instead of the standard 2-3 days." },
    { question: "What is PCI compliance?", answer: "PCI DSS is a set of security requirements to protect cardholder data. Every business that accepts credit cards must comply, typically by completing an annual Self-Assessment Questionnaire." },
    { question: "Can I accept American Express?", answer: "Yes, all Liberty Bancard merchants can accept American Express through the OptBlue program with competitive interchange-plus pricing." },
    { question: "What is a cash discount program?", answer: "A cash discount program offers a discount to customers who pay with cash while charging a service fee to card users, effectively eliminating your processing costs." },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Help Center"
        description="Find answers to your payment processing questions. Browse articles on account setup, billing, terminals, compliance, and more."
        path="/help"
        keywords="help center, knowledge base, support center, payment processing help, merchant support"
        breadcrumbs={[{ name: "Help Center", path: "/help" }]}
        structuredData={[
          getFAQSchema(faqItems),
          getBreadcrumbSchema([{ name: "Help Center", path: "/help" }]),
        ]}
      />
      <Navbar />

      <main className="flex-grow pt-20" ref={containerRef}>
        <section className="bg-primary text-primary-foreground py-16" data-testid="section-help-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-80" />
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4"
              data-testid="text-help-heading"
            >
              How can we help?
            </h1>
            <p
              className="text-primary-foreground/70 text-lg mb-8 max-w-xl mx-auto"
              data-testid="text-help-subheading"
            >
              Search our knowledge base or browse by category to find the answers you need.
            </p>

            <div className="relative max-w-lg mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search for articles..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 bg-background text-foreground"
                data-testid="input-help-search"
              />
              {results.length > 0 && (
                <Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-80 overflow-auto">
                  <CardContent className="p-2">
                    {results.map((article) => (
                      <Link
                        key={article.slug}
                        href={`/help/${article.categorySlug}/${article.slug}`}
                        className="block px-3 py-2.5 rounded-md text-sm text-foreground hover-elevate transition-colors"
                        data-testid={`link-search-result-${article.slug}`}
                      >
                        <span className="font-medium">{article.title}</span>
                        <span className="block text-xs text-muted-foreground mt-0.5">{article.category}</span>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}
              {query.trim().length >= 2 && results.length === 0 && (
                <Card className="absolute top-full left-0 right-0 mt-2 z-50">
                  <CardContent className="p-4 text-center text-sm text-muted-foreground">
                    No articles found for "{query}". Try a different search term.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </section>

        <section className="py-16" data-testid="section-help-categories">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-2xl font-bold text-foreground text-center mb-10 reveal"
              data-testid="text-browse-categories"
            >
              Browse by Category
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {helpCategories.map((cat, i) => {
                const Icon = iconMap[cat.icon] || HelpCircle;
                const count = getArticlesByCategory(cat.slug).length;
                return (
                  <Link
                    key={cat.slug}
                    href={`/help/${cat.slug}`}
                    data-testid={`link-help-category-${cat.slug}`}
                  >
                    <Card className={`h-full hover-elevate transition-all reveal reveal-delay-${(i % 3) + 1}`}>
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Icon className="w-5 h-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-foreground mb-1">{cat.name}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{cat.description}</p>
                            <Badge variant="secondary" className="mt-2">{count} articles</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-popular-articles">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-2xl font-bold text-foreground text-center mb-10 reveal"
              data-testid="text-popular-articles"
            >
              Popular Articles
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {popular.map((article, i) => (
                <Link
                  key={article.slug}
                  href={`/help/${article.categorySlug}/${article.slug}`}
                  data-testid={`link-popular-article-${article.slug}`}
                >
                  <Card className={`h-full hover-elevate transition-all reveal reveal-delay-${(i % 3) + 1}`}>
                    <CardContent className="pt-6">
                      <Badge variant="outline" className="mb-2">{article.category}</Badge>
                      <h3 className="font-semibold text-foreground mb-2">{article.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{article.summary}</p>
                      <span className="inline-flex items-center gap-1 text-sm text-primary mt-3 font-medium">
                        Read more <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16" data-testid="section-help-faq">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-2xl font-bold text-foreground text-center mb-10 reveal"
              data-testid="text-help-faq-heading"
            >
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {faqItems.map((faq, i) => (
                <Card key={i} className={`reveal reveal-delay-${(i % 3) + 1}`} data-testid={`card-faq-${i}`}>
                  <CardContent className="pt-6">
                    <h3 className="font-semibold text-foreground mb-2">{faq.question}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-12" data-testid="section-help-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <h2 className="text-2xl font-bold mb-3" data-testid="text-help-cta-heading">
              Still need help?
            </h2>
            <p className="text-primary-foreground/70 mb-6" data-testid="text-help-cta-body">
              Our support team responds within 4 business hours. Submit a request and a real person will follow up.
            </p>
            <Link href="/support" data-testid="link-help-contact-support">
              <span className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-background text-foreground font-medium hover:opacity-90 transition-opacity">
                Contact Support <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
