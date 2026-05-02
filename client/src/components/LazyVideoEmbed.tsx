import { useState } from "react";
import { Play, Video } from "lucide-react";
import { Link } from "wouter";

interface LazyVideoEmbedProps {
  youtubeId: string | null;
  thumbnailUrl?: string;
  merchantName: string;
  duration: string;
  isDemo?: boolean;
}

export function LazyVideoEmbed({
  youtubeId,
  thumbnailUrl,
  merchantName,
  duration,
  isDemo = false,
}: LazyVideoEmbedProps) {
  const [loaded, setLoaded] = useState(false);

  if (!youtubeId) {
    return (
      <div
        className="relative w-full aspect-video bg-gradient-to-br from-primary/20 to-sky-500/20 rounded-md overflow-hidden flex items-center justify-center"
        data-testid={`video-placeholder-${merchantName}`}
      >
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
            <Video className="w-7 h-7 text-primary/60" />
          </div>
          <p className="text-xs text-muted-foreground font-medium">Video coming soon</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            <Link href="/testimonials/submit" className="text-primary underline">
              Share your story
            </Link>{" "}
            to be featured
          </p>
        </div>
        <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          {duration}
        </div>
      </div>
    );
  }

  const thumbSrc = thumbnailUrl || `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`;

  return (
    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-black">
      {isDemo && (
        <div className="absolute top-2 left-2 z-10 bg-amber-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
          Demo
        </div>
      )}
      {!loaded ? (
        <button
          className="absolute inset-0 w-full h-full group"
          onClick={() => setLoaded(true)}
          aria-label={`Play ${merchantName} testimonial video`}
          data-testid={`button-play-${merchantName}`}
        >
          <img
            src={thumbSrc}
            alt={`${merchantName} testimonial thumbnail`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Play className="w-7 h-7 text-primary fill-primary ml-1" />
            </div>
          </div>
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
            {duration}
          </div>
        </button>
      ) : (
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`}
          title={`${merchantName} testimonial`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      )}
    </div>
  );
}
