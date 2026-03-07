import { useParams, Link } from "wouter";
import { SEO, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import {
  helpCategories,
  getArticlesByCategory,
  getArticleBySlug,
} from "@/lib/help-center-data";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

export default function HelpArticle() {
  const params = useParams<{ category: string; slug: string }>();
  const containerRef = useScrollReveal();

  const category = params.category || "";
  const slug = params.slug || "";

  const categoryInfo = helpCategories.find((c) => c.slug === category);
  const categoryArticles = getArticlesByCategory(category);
  const article = slug ? getArticleBySlug(category, slug) : null;

  if (!categoryInfo) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SEO title="Category Not Found" description="The help category you're looking for doesn't exist." />
        <Navbar />
        <main className="flex-grow pt-28 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4" data-testid="text-not-found">Category Not Found</h1>
            <Link href="/help" className="text-primary font-medium" data-testid="link-back-help">
              Back to Help Center
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!slug) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SEO
          title={`${categoryInfo.name} - Help Center`}
          description={categoryInfo.description}
          path={`/help/${category}`}
          keywords={`${categoryInfo.name.toLowerCase()}, help, support, payment processing`}
          breadcrumbs={[
            { name: "Help Center", path: "/help" },
            { name: categoryInfo.name, path: `/help/${category}` },
          ]}
          structuredData={getBreadcrumbSchema([
            { name: "Help Center", path: "/help" },
            { name: categoryInfo.name, path: `/help/${category}` },
          ])}
        />
        <Navbar />
        <main className="flex-grow pt-28" ref={containerRef}>
          <section className="py-8 bg-muted/30 border-b border-border/30">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 flex-wrap" data-testid="nav-breadcrumbs">
                <Link href="/help" className="hover:text-foreground transition-colors" data-testid="link-breadcrumb-help">
                  Help Center
                </Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-foreground font-medium">{categoryInfo.name}</span>
              </nav>
              <h1
                className="text-2xl sm:text-3xl font-bold text-foreground reveal"
                data-testid="text-category-heading"
              >
                {categoryInfo.name}
              </h1>
              <p className="text-muted-foreground mt-2 reveal reveal-delay-1" data-testid="text-category-description">
                {categoryInfo.description}
              </p>
            </div>
          </section>

          <section className="py-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="space-y-3">
                {categoryArticles.map((a, i) => (
                  <Link
                    key={a.slug}
                    href={`/help/${category}/${a.slug}`}
                    data-testid={`link-article-${a.slug}`}
                  >
                    <Card className={`hover-elevate transition-all reveal reveal-delay-${(i % 3) + 1}`}>
                      <CardContent className="pt-6 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-foreground mb-1">{a.title}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2">{a.summary}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>

              <div className="mt-8">
                <Link
                  href="/help"
                  className="inline-flex items-center gap-2 text-sm text-primary font-medium"
                  data-testid="link-back-all-categories"
                >
                  <ArrowLeft className="w-4 h-4" />
                  All categories
                </Link>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SEO title="Article Not Found" description="The help article you're looking for doesn't exist." />
        <Navbar />
        <main className="flex-grow pt-28 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4" data-testid="text-article-not-found">Article Not Found</h1>
            <Link href={`/help/${category}`} className="text-primary font-medium" data-testid="link-back-category">
              Back to {categoryInfo.name}
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const currentIndex = categoryArticles.findIndex((a) => a.slug === slug);
  const prevArticle = currentIndex > 0 ? categoryArticles[currentIndex - 1] : null;
  const nextArticle = currentIndex < categoryArticles.length - 1 ? categoryArticles[currentIndex + 1] : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title={`${article.title} - Help Center`}
        description={article.summary}
        path={`/help/${category}/${slug}`}
        keywords={article.keywords}
        breadcrumbs={[
          { name: "Help Center", path: "/help" },
          { name: categoryInfo.name, path: `/help/${category}` },
          { name: article.title, path: `/help/${category}/${slug}` },
        ]}
        structuredData={getBreadcrumbSchema([
          { name: "Help Center", path: "/help" },
          { name: categoryInfo.name, path: `/help/${category}` },
          { name: article.title, path: `/help/${category}/${slug}` },
        ])}
      />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <section className="py-8 bg-muted/30 border-b border-border/30">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 flex-wrap" data-testid="nav-article-breadcrumbs">
              <Link href="/help" className="hover:text-foreground transition-colors" data-testid="link-breadcrumb-help">
                Help Center
              </Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <Link href={`/help/${category}`} className="hover:text-foreground transition-colors" data-testid="link-breadcrumb-category">
                {categoryInfo.name}
              </Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-foreground font-medium">{article.title}</span>
            </nav>
            <Badge variant="outline" className="mb-3">{article.category}</Badge>
            <h1
              className="text-2xl sm:text-3xl font-bold text-foreground reveal"
              data-testid="text-article-title"
            >
              {article.title}
            </h1>
            <p className="text-muted-foreground mt-2 reveal reveal-delay-1" data-testid="text-article-summary">
              {article.summary}
            </p>
          </div>
        </section>

        <section className="py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              <div className="lg:col-span-3 reveal">
                <div
                  className="prose prose-sm sm:prose dark:prose-invert max-w-none
                    prose-headings:text-foreground prose-p:text-muted-foreground
                    prose-li:text-muted-foreground prose-strong:text-foreground
                    prose-a:text-primary prose-ol:text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: article.content }}
                  data-testid="div-article-content"
                />

                <div className="mt-12 pt-8 border-t border-border/50 flex flex-wrap items-center justify-between gap-4">
                  {prevArticle ? (
                    <Link
                      href={`/help/${category}/${prevArticle.slug}`}
                      className="inline-flex items-center gap-2 text-sm text-primary font-medium"
                      data-testid="link-prev-article"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      {prevArticle.title}
                    </Link>
                  ) : (
                    <div />
                  )}
                  {nextArticle && (
                    <Link
                      href={`/help/${category}/${nextArticle.slug}`}
                      className="inline-flex items-center gap-2 text-sm text-primary font-medium"
                      data-testid="link-next-article"
                    >
                      {nextArticle.title}
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              </div>

              <aside className="lg:col-span-1 reveal reveal-delay-1">
                <div className="sticky top-32">
                  <h3 className="text-sm font-semibold text-foreground mb-3">In this category</h3>
                  <nav className="space-y-1">
                    {categoryArticles.map((a) => (
                      <Link
                        key={a.slug}
                        href={`/help/${category}/${a.slug}`}
                        className={`block text-sm px-3 py-2 rounded-md transition-colors ${
                          a.slug === slug
                            ? "text-primary bg-primary/5 font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                        data-testid={`link-sidebar-${a.slug}`}
                      >
                        {a.title}
                      </Link>
                    ))}
                  </nav>

                  <div className="mt-6 pt-6 border-t border-border/50">
                    <Link
                      href="/help"
                      className="inline-flex items-center gap-2 text-sm text-primary font-medium"
                      data-testid="link-sidebar-all-categories"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      All categories
                    </Link>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
