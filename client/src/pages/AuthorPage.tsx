import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Linkedin, Globe, Mail, ArrowRight, User } from "lucide-react";
import { allBlogPosts, type GeneratedBlogPostResponse, dbPostToBlogPost } from "@/lib/all-blog-data";

interface Author {
  id: number;
  slug: string;
  name: string;
  title: string;
  bio: string;
  longBio: string | null;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  websiteUrl: string | null;
  expertise: string[] | null;
  email: string | null;
}

export default function AuthorPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { data: author, isLoading, error } = useQuery<Author>({
    queryKey: [`/api/authors/${slug}`],
    enabled: !!slug,
  });

  const { data: dbPosts = [] } = useQuery<GeneratedBlogPostResponse[]>({
    queryKey: ["/api/blog/generated/published"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <div className="flex-1 container mx-auto py-20 text-center text-muted-foreground">Loading author...</div>
        <Footer />
      </div>
    );
  }

  if (error || !author) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <div className="flex-1 container mx-auto py-20 text-center" data-testid="text-author-notfound">
          <h1 className="text-2xl font-bold">Author not found</h1>
          <p className="mt-2 text-muted-foreground">The author you're looking for doesn't exist.</p>
          <Link href="/blog" className="text-primary mt-4 inline-block">← Back to blog</Link>
        </div>
        <Footer />
      </div>
    );
  }

  const allPosts = [
    ...allBlogPosts,
    ...dbPosts.map(dbPostToBlogPost),
  ];
  const posts = allPosts
    .filter((p) => p.author === author.name)
    .sort((a, b) => +new Date(b.publishedISO) - +new Date(a.publishedISO));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title={`${author.name} — ${author.title} | Liberty Bancard`}
        description={author.bio ?? ""}
        canonical={`https://libertybancard.com/authors/${author.slug}`}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "Person",
          "name": author.name,
          "jobTitle": author.title,
          "description": author.bio,
          "url": `https://libertybancard.com/authors/${author.slug}`,
          "sameAs": [author.linkedinUrl, author.twitterUrl, author.websiteUrl].filter(Boolean),
        }}
      />
      <Navbar />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 max-w-4xl">
          <div className="flex items-start gap-6 mb-8">
            <div className="shrink-0 w-24 h-24 rounded-full bg-muted flex items-center justify-center overflow-hidden">
              {author.avatarUrl ? (
                <img src={author.avatarUrl} alt={author.name} className="w-full h-full object-cover" data-testid="img-author-avatar" />
              ) : (
                <User className="w-10 h-10 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-display font-bold text-foreground" data-testid="text-author-name">{author.name}</h1>
              <p className="text-lg text-muted-foreground mt-1" data-testid="text-author-title">{author.title}</p>
              <div className="flex gap-3 mt-3">
                {author.linkedinUrl && (
                  <a href={author.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1" data-testid="link-author-linkedin">
                    <Linkedin className="w-4 h-4" /> LinkedIn
                  </a>
                )}
                {author.websiteUrl && (
                  <a href={author.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1" data-testid="link-author-web">
                    <Globe className="w-4 h-4" /> Website
                  </a>
                )}
                {author.email && (
                  <a href={`mailto:${author.email}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="link-author-email">
                    <Mail className="w-4 h-4" /> Email
                  </a>
                )}
              </div>
            </div>
          </div>

          <Card className="mb-8">
            <CardContent className="pt-6">
              <p className="text-foreground leading-relaxed" data-testid="text-author-bio">{author.bio}</p>
              {author.longBio && (
                <p className="text-foreground/80 leading-relaxed mt-4" data-testid="text-author-longbio">{author.longBio}</p>
              )}
              {author.expertise && author.expertise.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Areas of expertise:</p>
                  <div className="flex flex-wrap gap-2">
                    {author.expertise.map((e) => <Badge key={e} variant="secondary" data-testid={`badge-exp-${e}`}>{e}</Badge>)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-4" data-testid="text-author-posts-heading">
              Articles by {author.name} ({posts.length})
            </h2>
            {posts.length === 0 ? (
              <p className="text-muted-foreground" data-testid="text-no-author-posts">No articles published yet.</p>
            ) : (
              <div className="space-y-3">
                {posts.map((p) => (
                  <Link key={p.slug} href={`/blog/${p.slug}`} data-testid={`link-author-post-${p.slug}`}>
                    <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground">{p.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.excerpt}</p>
                            <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className="text-xs">{p.category}</Badge>
                              <span>{p.readTime}</span>
                              <span>{p.publishDate}</span>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
