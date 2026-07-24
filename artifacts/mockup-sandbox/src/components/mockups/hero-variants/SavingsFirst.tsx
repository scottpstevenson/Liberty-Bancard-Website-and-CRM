import React from "react";
import { Star, FileText, ArrowRight, ShieldCheck, CheckCircle2, TrendingDown } from "lucide-react";

export function SavingsFirst() {
  return (
    <section className="relative min-h-[100dvh] w-full flex items-center justify-center overflow-hidden bg-slate-900 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        
        .font-outfit { font-family: 'Outfit', sans-serif; }
        .font-jakarta { font-family: 'Plus Jakarta Sans', sans-serif; }
        
        .bg-savings-gradient {
          background: linear-gradient(135deg, #0F172A 0%, #0F2027 50%, #1E293B 100%);
        }
        
        .glass-card {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .text-glow {
          text-shadow: 0 0 40px rgba(16, 185, 129, 0.3);
        }
      `}</style>

      {/* Background Effects */}
      <div className="absolute inset-0 bg-savings-gradient z-0"></div>
      
      {/* Decorative shapes */}
      <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-emerald-500/10 blur-[120px] mix-blend-screen pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-blue-500/10 blur-[100px] mix-blend-screen pointer-events-none"></div>
      
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-50 z-0"></div>

      <div className="container relative z-10 mx-auto px-4 md:px-6 py-12 md:py-20 lg:py-24 max-w-6xl">
        <div className="flex flex-col items-center text-center space-y-10">
          
          {/* Top Trust Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-jakarta text-sm font-semibold tracking-wide animate-fade-in-up">
            <ShieldCheck className="w-4 h-4" />
            <span>South Florida's #1 Rated Processor</span>
          </div>

          {/* Main Headline Group */}
          <div className="space-y-6 max-w-4xl mx-auto">
            <h1 className="font-outfit text-white font-bold tracking-tight text-4xl md:text-5xl lg:text-7xl leading-[1.1]">
              Merchants Save <br className="hidden md:block" />
              <span className="text-emerald-400 text-glow inline-block mt-2 text-6xl md:text-7xl lg:text-8xl">$600–$3,200</span>
              <span className="text-2xl md:text-3xl lg:text-4xl text-slate-300 ml-2 font-normal">/Year</span>
            </h1>
            <p className="font-jakarta text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Stop overpaying for payment processing. Let our local experts find hidden fees in your current statement.
            </p>
          </div>

          {/* Social Proof Row */}
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 pt-4 pb-2 border-y border-white/10 w-full max-w-2xl justify-center">
            <div className="flex items-center gap-2">
              <div className="flex text-amber-500">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="w-5 h-5 fill-current" />
                ))}
              </div>
              <span className="text-white font-jakarta font-medium">5.0</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-slate-600"></div>
            <span className="text-slate-300 font-jakarta">Trusted by <strong className="text-white">2,500+</strong> local businesses</span>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-slate-600"></div>
            <span className="text-slate-300 font-jakarta">A+ BBB Rating</span>
          </div>

          {/* Action Area */}
          <div className="w-full max-w-3xl pt-6">
            <div className="glass-card p-6 md:p-8 rounded-3xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              
              <div className="relative z-10 flex flex-col md:flex-row items-center gap-6 justify-between">
                <div className="text-left space-y-2 flex-1 w-full text-center md:text-left">
                  <h3 className="text-white font-outfit text-2xl font-semibold flex items-center justify-center md:justify-start gap-2">
                    <TrendingDown className="w-6 h-6 text-amber-500" />
                    Want to see your savings?
                  </h3>
                  <p className="text-slate-400 font-jakarta text-sm">
                    Upload your recent processing statement for a free, side-by-side comparison.
                  </p>
                </div>

                <div className="flex flex-col gap-3 w-full md:w-auto shrink-0">
                  <a href="/upload-statement" className="inline-flex items-center justify-center px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold font-jakarta rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.4)] group-hover:shadow-[0_0_30px_rgba(16,185,129,0.6)]">
                    <FileText className="w-5 h-5 mr-2" />
                    Upload My Statement — Free
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                  <a href="/schedule" className="inline-flex items-center justify-center px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold font-jakarta rounded-xl transition-all duration-300">
                    Get a Free Quote
                  </a>
                </div>
              </div>

              {/* Guarantees */}
              <div className="mt-8 pt-6 border-t border-white/10 flex flex-wrap items-center justify-center md:justify-between gap-4">
                {[
                  "100% Free Analysis",
                  "No Commitment",
                  "Results in 24hrs"
                ].map((text, i) => (
                  <div key={i} className="flex items-center text-slate-300 text-sm font-jakarta">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mr-2" />
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
