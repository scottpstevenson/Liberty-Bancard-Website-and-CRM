import { useParams, Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Clock, User, Calendar, Upload } from "lucide-react";
import { ShareButtons } from "@/components/ShareButtons";
import { allBlogPosts, type BlogPost as BlogPostType, type GeneratedBlogPostResponse, dbPostToBlogPost } from "@/lib/all-blog-data";
import { getFAQSchema, getArticleSchema, getBreadcrumbSchema } from "@/components/SEO";
import type { BlogSection } from "@/lib/all-blog-data";
import { useQuery } from "@tanstack/react-query";

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

function generateFaqsFromContent(content: BlogSection[]): { question: string; answer: string }[] {
  const faqs: { question: string; answer: string }[] = [];
  for (let i = 0; i < content.length; i++) {
    const section = content[i];
    if (section.type === "heading" && section.text) {
      const nextSection = content[i + 1];
      if (nextSection && (nextSection.type === "paragraph" || nextSection.type === "list") && (nextSection.text || nextSection.items)) {
        const question = section.text.endsWith("?") ? section.text : `What about ${section.text.toLowerCase()}?`;
        const answer = nextSection.type === "paragraph" ? (nextSection.text || "") : (nextSection.items || []).join(". ");
        if (answer.length > 20) {
          faqs.push({ question, answer: answer.slice(0, 500) });
        }
      }
    }
    if (faqs.length >= 5) break;
  }
  return faqs;
}

export default function BlogPost() {
  const params = useParams<{ slug: string }>();
  const staticPost = allBlogPosts.find((p) => p.slug === params.slug);

  const { data: dbPost, isLoading } = useQuery<GeneratedBlogPostResponse[], Error, BlogPostType | null>({
    queryKey: ["/api/blog/generated/published"],
    enabled: !staticPost,
    select: (data: GeneratedBlogPostResponse[]) => {
      const found = data?.find((p) => p.slug === params.slug);
      if (!found) return null;
      return dbPostToBlogPost(found);
    },
  });

  const post = staticPost || dbPost;

  if (!post && isLoading) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-28 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

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

  const currentIndex = allBlogPosts.findIndex((p) => p.slug === post.slug);
  const prevPost = currentIndex > 0 ? allBlogPosts[currentIndex - 1] : null;
  const nextPost = currentIndex < allBlogPosts.length - 1 ? allBlogPosts[currentIndex + 1] : null;

  const relatedPosts = allBlogPosts
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
          getArticleSchema({
            slug: post.slug,
            title: post.title,
            description: post.metaDescription,
            author: post.author,
            publishedTime: post.publishedISO,
            modifiedTime: post.modifiedISO,
            section: post.category,
            tags: post.keywords.split(", "),
          }),
          getBreadcrumbSchema([
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
          getFAQSchema(post.faqs && post.faqs.length > 0 ? post.faqs : generateFaqsFromContent(post.content)),
        ]}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4">
          <Breadcrumbs
            items={[
              { name: "Blog", path: "/blog" },
              { name: post.title, path: `/blog/${post.slug}` },
            ]}
          />
        </div>
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

          <div className="mb-6 flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Share this article</span>
            <ShareButtons title={post.title} description={post.excerpt} hashtags={["payments", "smallbusiness"]} />
          </div>

          <div className="prose-custom" data-testid="article-content">
            {post.content.map((section, index) => renderSection(section, index))}
          </div>

          <div className="mt-8 pt-6 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Found this useful? Share it.</span>
            <ShareButtons title={post.title} description={post.excerpt} hashtags={["payments", "smallbusiness"]} />
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

        <section className="bg-primary text-primary-foreground py-16">
          <div className="max-w-3xl mx-auto px-4 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4" data-testid="text-blogpost-cta-heading">
              Ready to See What You're Really Paying?
            </h2>
            <p className="text-primary-foreground/80 mb-6">
              Upload your processing statement for a free, line-by-line breakdown. Keep the analysis even if you don't switch.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-blogpost-cta-upload">
                <Button size="lg" variant="secondary" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
              <Link href="/free-analysis" data-testid="link-blogpost-cta-analysis">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  Get Free Analysis
                  <ArrowRight className="w-4 h-4" />
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
