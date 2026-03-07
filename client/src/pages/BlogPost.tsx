import { useParams, Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Clock, User, Calendar, Upload } from "lucide-react";
import { blogPosts } from "@/lib/blog-data";
import type { BlogSection } from "@/lib/blog-data";

function renderSection(section: BlogSection, index: number) {
  switch (section.type) {
    case "heading":
      if (section.level === 3) {
        return (
          <h3
            key={index}
            className="text-xl font-display font-bold text-foreground mt-8 mb-3"
            data-testid={`text-heading-${index}`}
          >
            {section.text}
          </h3>
        );
      }
      return (
        <h2
          key={index}
          className="text-2xl font-display font-bold text-foreground mt-10 mb-4"
          data-testid={`text-heading-${index}`}
        >
          {section.text}
        </h2>
      );
    case "paragraph":
      return (
        <p
          key={index}
          className="text-foreground/90 leading-relaxed mb-4"
          data-testid={`text-paragraph-${index}`}
        >
          {section.text}
        </p>
      );
    case "list":
      return (
        <ul
          key={index}
          className="list-disc list-outside ml-6 space-y-2 mb-6 text-foreground/90"
          data-testid={`list-${index}`}
        >
          {section.items?.map((item, i) => (
            <li key={i} className="leading-relaxed">{item}</li>
          ))}
        </ul>
      );
    case "cta":
      return (
        <Card key={index} className="my-8 border-primary/20">
          <CardContent className="p-6 text-center">
            <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="text-foreground font-medium mb-4">{section.text}</p>
            <Link href={section.ctaHref || "/upload-statement"} data-testid={`link-cta-${index}`}>
              <Button className="gap-2">
                {section.ctaText}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      );
    case "quote":
      return (
        <blockquote
          key={index}
          className="border-l-4 border-primary/30 pl-4 py-2 my-6 italic text-muted-foreground"
          data-testid={`quote-${index}`}
        >
          {section.text}
        </blockquote>
      );
    default:
      return null;
  }
}

export default function BlogPost() {
  const params = useParams<{ slug: string }>();
  const post = blogPosts.find((p) => p.slug === params.slug);

  if (!post) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-28 flex items-center justify-center">
          <div className="text-center p-8">
            <h1 className="text-2xl font-display font-bold text-foreground mb-4" data-testid="text-not-found">
              Article Not Found
            </h1>
            <p className="text-muted-foreground mb-6">The article you're looking for doesn't exist.</p>
            <Link href="/blog" data-testid="link-back-to-blog">
              <Button variant="outline" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Blog
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const currentIndex = blogPosts.findIndex((p) => p.slug === post.slug);
  const prevPost = currentIndex > 0 ? blogPosts[currentIndex - 1] : null;
  const nextPost = currentIndex < blogPosts.length - 1 ? blogPosts[currentIndex + 1] : null;

  const relatedPosts = blogPosts
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title={post.title}
        description={post.metaDescription}
        path={`/blog/${post.slug}`}
        keywords={post.keywords}
        ogType="article"
        article={{
          publishedTime: post.publishedISO,
          modifiedTime: post.modifiedISO,
          author: post.author,
          section: post.category,
          tags: post.keywords.split(", "),
        }}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.metaDescription,
            author: {
              "@type": "Organization",
              name: post.author,
            },
            publisher: {
              "@type": "Organization",
              name: "Liberty Bancard",
              url: "https://libertybancard.com",
            },
            datePublished: post.publishedISO,
            dateModified: post.modifiedISO,
            mainEntityOfPage: {
              "@type": "WebPage",
              "@id": `https://libertybancard.com/blog/${post.slug}`,
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: "https://libertybancard.com",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Blog",
                item: "https://libertybancard.com/blog",
              },
              {
                "@type": "ListItem",
                position: 3,
                name: post.title,
                item: `https://libertybancard.com/blog/${post.slug}`,
              },
            ],
          },
        ]}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
          <Link href="/blog" data-testid="link-breadcrumb-blog">
            <Button variant="ghost" className="gap-2 mb-6 -ml-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Blog
            </Button>
          </Link>

          <Badge variant="outline" className="mb-4" data-testid="badge-category">
            {post.category}
          </Badge>

          <h1
            className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4 leading-tight"
            data-testid="text-post-title"
          >
            {post.title}
          </h1>

          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8 flex-wrap" data-testid="text-post-meta">
            <span className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              {post.author}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {post.publishDate}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {post.readTime}
            </span>
          </div>

          <div className="prose-custom" data-testid="article-content">
            {post.content.map((section, index) => renderSection(section, index))}
          </div>

          <div className="border-t border-border mt-12 pt-8">
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              {prevPost ? (
                <Link href={`/blog/${prevPost.slug}`} data-testid="link-prev-post">
                  <Button variant="outline" className="gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    Previous Article
                  </Button>
                </Link>
              ) : (
                <div />
              )}
              {nextPost && (
                <Link href={`/blog/${nextPost.slug}`} data-testid="link-next-post">
                  <Button variant="outline" className="gap-2">
                    Next Article
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </article>

        <section className="bg-muted/30 py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6" data-testid="text-related-heading">
              More Articles
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {relatedPosts.map((related) => (
                <Link key={related.slug} href={`/blog/${related.slug}`} data-testid={`link-related-${related.slug}`}>
                  <Card className="hover-elevate h-full">
                    <CardContent className="p-5 flex flex-col h-full">
                      <Badge variant="outline" className="self-start mb-2">{related.category}</Badge>
                      <h3 className="font-display font-bold text-foreground mb-2">{related.title}</h3>
                      <p className="text-sm text-muted-foreground flex-1">{related.excerpt}</p>
                      <span className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {related.readTime}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
