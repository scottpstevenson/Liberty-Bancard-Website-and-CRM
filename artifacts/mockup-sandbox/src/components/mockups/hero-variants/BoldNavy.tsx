import React from 'react';
import { ArrowRight, ShieldCheck, UploadCloud, CheckCircle2 } from 'lucide-react';

export function BoldNavy() {
  return (
    <section className="relative min-h-[100dvh] w-full bg-[#0F172A] flex flex-col items-center justify-center overflow-hidden font-jakarta text-slate-50 selection:bg-amber-500/30">
      {/* Font & custom styles */}
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .font-jakarta { font-family: 'Plus Jakarta Sans', sans-serif; }
        .bg-mesh-navy {
          background-color: #0F172A;
          background-image: 
            radial-gradient(at 40% 20%, rgba(20, 83, 200, 0.15) 0px, transparent 50%),
            radial-gradient(at 80% 0%, rgba(245, 158, 11, 0.05) 0px, transparent 50%),
            radial-gradient(at 0% 50%, rgba(16, 185, 129, 0.05) 0px, transparent 50%);
        }
        .noise-overlay {
          position: absolute;
          inset: 0;
          opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          pointer-events: none;
        }
      `}} />

      <div className="absolute inset-0 bg-mesh-navy z-0"></div>
      <div className="noise-overlay z-0"></div>

      <div className="container relative z-10 mx-auto px-4 md:px-6 py-20 flex flex-col items-center text-center">
        
        {/* Top Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/50 border border-slate-700/50 text-sm font-medium text-slate-300 mb-8 backdrop-blur-sm">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
          South Florida's Trusted Payment Processor
        </div>

        {/* Headline */}
        <h1 className="max-w-4xl text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.1]">
          Stop losing margin to <span className="text-[#F59E0B]">hidden fees.</span>
        </h1>

        {/* Subheadline */}
        <p className="max-w-2xl text-lg md:text-xl text-slate-400 mb-10 leading-relaxed">
          Get a transparent statement analysis and see exactly what you're paying. No contracts, zero setup fees, institutional reliability.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center mb-16">
          <a href="/upload-statement" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-[#F59E0B] text-slate-900 font-bold text-lg hover:bg-amber-400 transition-colors shadow-[0_0_40px_-10px_rgba(245,158,11,0.5)]">
            <UploadCloud className="w-5 h-5" />
            Upload My Statement — Free
          </a>
          <a href="/contact" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-transparent text-white font-semibold text-lg border border-slate-700 hover:bg-slate-800 hover:border-slate-600 transition-colors">
            Get a Free Quote
            <ArrowRight className="w-5 h-5" />
          </a>
        </div>

        {/* Trust Signals */}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-12 pt-8 border-t border-slate-800/60 w-full max-w-4xl">
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="font-medium text-sm md:text-base">Free Analysis</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <ShieldCheck className="w-5 h-5 text-[#F59E0B]" />
            <span className="font-medium text-sm md:text-base">No Contracts</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="font-medium text-sm md:text-base">Next-Day Funding</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="font-medium text-sm md:text-base">Local Support</span>
          </div>
        </div>

      </div>
    </section>
  );
}
