import { Link } from "wouter";
import { DisputeResolutionContent, disputeResolutionSeo } from "@/components/PublicPolicyContent";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { trackPhoneCallClick } from "@/lib/analytics";

export default function DisputeResolution() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO {...disputeResolutionSeo} />
      <Navbar />
      <main className="flex-grow pt-16">
        <DisputeResolutionContent
          Link={Link}
          onPhoneClick={() => trackPhoneCallClick({ sourcePage: disputeResolutionSeo.path })}
        />
      </main>
      <Footer />
    </div>
  );
}
