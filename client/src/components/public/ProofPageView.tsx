import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { OverviewPageView } from "@/components/public/OverviewPageView";
import { proofOverviewPage, type ProofSurface, type PublicProofItem } from "@shared/public-proof";

/**
 * Case studies and testimonials. The page record comes from the shared proof projection that the server
 * renderer also uses. Until (or unless) the server returns an evidence-backed item, and whenever the
 * request fails, the visitor sees the fallback; this page never substitutes a result of its own.
 */
export function ProofPageView({ surface }: { surface: ProofSurface }) {
  const { data } = useQuery<PublicProofItem[]>({
    queryKey: [`/api/public/testimonials/approved?surface=${surface}`],
  });
  const page = useMemo(() => proofOverviewPage(surface, Array.isArray(data) ? data : []), [surface, data]);
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={page.shortTitle}
        description={page.description}
        path={page.path}
        keywords={page.keywords}
        breadcrumbs={[{ name: page.breadcrumbLabel, path: page.path }]}
      />
      <Navbar />
      <main className="marketing-surface flex-grow pt-[var(--public-header-height)] md:pt-24 dock-clearance-main md:pb-0">
        <OverviewPageView page={page} />
      </main>
      <Footer />
    </div>
  );
}
