import { Link } from "wouter";
import { ADAComplianceContent, adaComplianceSeo } from "@/components/PublicPolicyContent";
import { SEO, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { trackPhoneCallClick } from "@/lib/analytics";

export default function ADACompliance() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        {...adaComplianceSeo}
        breadcrumbs={[{ name: "ADA Compliance", path: adaComplianceSeo.path }]}
        structuredData={getBreadcrumbSchema([{ name: "ADA Compliance", path: adaComplianceSeo.path }])}
      />
      <Navbar />
      <main className="flex-grow pt-16">
        <ADAComplianceContent
          Link={Link}
          onPhoneClick={() => trackPhoneCallClick({ sourcePage: adaComplianceSeo.path })}
        />
      </main>
      <Footer />
    </div>
  );
}
