import { blogPosts } from "./blog-data";
import { blogPosts2 } from "./blog-data-2";
import { blogPosts3 } from "./blog-data-3";
import { blogPosts4 } from "./blog-data-4";
import { blogPosts5 } from "./blog-data-5";
export type { BlogPost, BlogSection } from "./blog-data";

export const allBlogPosts = [
  ...blogPosts,
  ...blogPosts2,
  ...blogPosts3,
  ...blogPosts4,
  ...blogPosts5,
];

export const blogCategories = Array.from(
  new Set(allBlogPosts.map((p) => p.category))
);

export const allBlogSlugs = allBlogPosts.map((p) => p.slug);
