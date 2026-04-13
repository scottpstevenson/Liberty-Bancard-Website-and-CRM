import { blogPosts } from "./blog-data";
import { blogPosts2 } from "./blog-data-2";
import { blogPosts3 } from "./blog-data-3";
import { blogPosts4 } from "./blog-data-4";
import { blogPosts5 } from "./blog-data-5";
import { blogPosts6 } from "./blog-data-6";
import { blogPosts7 } from "./blog-data-7";
export type { BlogPost, BlogSection } from "./blog-data";
import type { BlogPost, BlogSection } from "./blog-data";

export interface GeneratedBlogPostResponse {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  readTime: string;
  publishDate: string;
  publishedISO: string;
  modifiedISO: string;
  keywords: string;
  metaDescription: string;
  content: BlogSection[];
  faqs: { question: string; answer: string }[] | null;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  createdBy: number | null;
}

export function dbPostToBlogPost(p: GeneratedBlogPostResponse): BlogPost {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    category: p.category,
    author: p.author,
    readTime: p.readTime,
    publishDate: p.publishDate,
    publishedISO: p.publishedISO,
    modifiedISO: p.modifiedISO,
    keywords: p.keywords,
    metaDescription: p.metaDescription,
    content: p.content,
    faqs: p.faqs ?? undefined,
  };
}

export const allBlogPosts = [
  ...blogPosts,
  ...blogPosts2,
  ...blogPosts3,
  ...blogPosts4,
  ...blogPosts5,
  ...blogPosts6,
  ...blogPosts7,
];

export const blogCategories = Array.from(
  new Set(allBlogPosts.map((p) => p.category))
);

export const allBlogSlugs = allBlogPosts.map((p) => p.slug);
