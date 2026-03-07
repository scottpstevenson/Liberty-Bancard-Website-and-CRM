import { useState, useMemo } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, User, Search } from "lucide-react";
import { allBlogPosts, blogCategories } from "@/lib/all-blog-data";

const POSTS_PER_PAGE = 12;

export default function Blog() {
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_PAGE);

  const filtered = useMemo(() => {
    let posts = allBlogPosts;
    if (activeCategory !== "All") {
      posts = posts.filter((p) => p.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      posts = posts.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.keywords.toLowerCase().includes(q)
      );
    }
    return posts;
  }, [activeCategory, searchQuery]);

  const featured = activeCategory === "All" && !searchQuery ? allBlogPosts[0] : null;
  const displayPosts = featured ? filtered.slice(1) : filtered;
  const visible = displayPosts.slice(0, visibleCount);
  const hasMore = visibleCount < displayPosts.length;

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Blog - Payment Processing Insights"
        description="Expert guides on credit card processing, merchant services, PCI compliance, and saving money on payment fees. 50+ free resources for business owners."
        path="/blog"
        keywords="payment processing blog, credit card processing tips, merchant services guide, PCI compliance, interchange fees"
        breadcrumbs={[{ name: "Blog", path: "/blog" }]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Liberty Bancard Blog",
          description: "Expert guides on credit card processing and merchant services",
          url: "https://libertybancard.com/blog",
          publisher: {
            "@type": "Organization",
            name: "Liberty Bancard",
            url: "https://libertybancard.com",
          },
        }}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="bg-muted/30 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3" data-testid="text-blog-heading">
              Payment Processing Insights
            </h1>
            <p className="text-muted-foreground max-w-2xl mb-8" data-testid="text-blog-subheading">
              Expert guides to help you understand your processing costs, avoid hidden fees, and make smarter decisions about merchant services.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search articles..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setVisibleCount(POSTS_PER_PAGE);
                  }}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  data-testid="input-blog-search"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-10">
              <button
                onClick={() => { setActiveCategory("All"); setVisibleCount(POSTS_PER_PAGE); }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${activeCategory === "All" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                data-testid="button-category-all"
              >
                All ({allBlogPosts.length})
              </button>
              {blogCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setVisibleCount(POSTS_PER_PAGE); }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  data-testid={`button-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {cat} ({allBlogPosts.filter((p) => p.category === cat).length})
                </button>
              ))}
            </div>

            {featured && (
              <Link href={`/blog/${featured.slug}`} data-testid="link-featured-post">
                <Card className="hover-elevate mb-12">
                  <CardContent className="p-6 md:p-8">
                    <div className="flex flex-col md:flex-row gap-6 md:gap-8">
                      <div className="flex-1">
                        <Badge variant="secondary" className="mb-3" data-testid="badge-featured">Featured</Badge>
                        <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3" data-testid="text-featured-title">
                          {featured.title}
                        </h2>
                        <p className="text-muted-foreground mb-4 leading-relaxed" data-testid="text-featured-excerpt">
                          {featured.excerpt}
                        </p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5" />
                            {featured.author}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {featured.readTime}
                          </span>
                          <span>{featured.publishDate}</span>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <Button variant="outline" className="gap-2">
                          Read Article <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )}

            {filtered.length === 0 && (
              <div className="text-center py-16">
                <p className="text-muted-foreground text-lg" data-testid="text-no-results">No articles found matching your search.</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((post) => (
                <Link key={post.slug} href={`/blog/${post.slug}`} data-testid={`link-post-${post.slug}`}>
                  <Card className="hover-elevate h-full">
                    <CardContent className="p-6 flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <Badge variant="outline">{post.category}</Badge>
                      </div>
                      <h3 className="text-lg font-display font-bold text-foreground mb-2" data-testid={`text-post-title-${post.slug}`}>
                        {post.title}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4 flex-1 leading-relaxed">
                        {post.excerpt}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {post.readTime}
                        </span>
                        <span>{post.publishDate}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {hasMore && (
              <div className="text-center mt-10">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setVisibleCount((c) => c + POSTS_PER_PAGE)}
                  data-testid="button-load-more"
                >
                  Load More Articles ({displayPosts.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-16">
          <div className="max-w-3xl mx-auto px-4 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4" data-testid="text-blog-cta-heading">
              Ready to See What You're Really Paying?
            </h2>
            <p className="text-primary-foreground/80 mb-6">
              Upload your processing statement for a free, line-by-line breakdown. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-blog-cta-upload">
                <Button size="lg" variant="secondary" className="gap-2">
                  Upload Statement
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/savings-calculator" data-testid="link-blog-cta-calculator">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  Try Savings Calculator
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
