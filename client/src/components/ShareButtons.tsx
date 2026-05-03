import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Linkedin, Twitter, Facebook, Mail } from "lucide-react";

interface ShareButtonsProps {
  url?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
  size?: "sm" | "default";
  className?: string;
}

export function ShareButtons({
  url,
  title = "",
  description = "",
  hashtags = [],
  size = "sm",
  className = "",
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl = (() => {
    if (url) return url;
    if (typeof window !== "undefined") return window.location.href;
    return "";
  })();
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);
  const encodedDesc = encodeURIComponent(description);
  const tagString = encodeURIComponent(hashtags.join(","));

  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
  const twitter = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}${
    tagString ? `&hashtags=${tagString}` : ""
  }`;
  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  const mail = `mailto:?subject=${encodedTitle}&body=${encodedDesc}%0A%0A${encodedUrl}`;

  const open = (href: string) => {
    if (typeof window === "undefined") return;
    window.open(href, "_blank", "noopener,noreferrer,width=600,height=600");
  };

  const copyToClipboard = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      data-testid="share-buttons"
      role="group"
      aria-label="Share this article"
    >
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => open(linkedin)}
        aria-label="Share on LinkedIn"
        data-testid="button-share-linkedin"
        title="Share on LinkedIn"
      >
        <Linkedin className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => open(twitter)}
        aria-label="Share on Twitter"
        data-testid="button-share-twitter"
        title="Share on Twitter / X"
      >
        <Twitter className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => open(facebook)}
        aria-label="Share on Facebook"
        data-testid="button-share-facebook"
        title="Share on Facebook"
      >
        <Facebook className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => (window.location.href = mail)}
        aria-label="Share by email"
        data-testid="button-share-email"
        title="Share by email"
      >
        <Mail className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={copyToClipboard}
        aria-label="Copy link"
        data-testid="button-share-copy"
        title="Copy link"
      >
        {copied ? (
          <Check className={`${size === "sm" ? "h-4 w-4" : "h-5 w-5"} text-green-600`} />
        ) : (
          <Copy className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
        )}
      </Button>
    </div>
  );
}
