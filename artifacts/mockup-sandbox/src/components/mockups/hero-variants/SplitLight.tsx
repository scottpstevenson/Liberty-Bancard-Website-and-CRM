import { UploadCloud, Phone, CheckCircle, ArrowRight, ShieldCheck, FileText, ChevronRight, TrendingDown } from 'lucide-react';

export function SplitLight() {
  return (
    <section className="relative w-full min-h-[100dvh] flex flex-col lg:flex-row overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Left Column - Content */}
      <div className="w-full lg:w-1/2 bg-[#F8FAFC] flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-20 xl:px-24">
        <div className="max-w-xl mx-auto lg:mr-auto lg:ml-0 w-full">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 mb-8">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Trusted in South Florida</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[#0F172A] leading-[1.1] mb-6 tracking-tight">
            Stop overpaying <br className="hidden sm:block" />
            for <span className="text-[#F59E0B]">payment</span> processing.
          </h1>

          <p className="text-lg text-slate-600 mb-10 leading-relaxed max-w-lg">
            Liberty Bancard delivers transparent rates, next-day funding, and zero hidden fees. Upload your statement for a free, no-obligation savings analysis.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mb-10">
            <a
              href="/upload-statement"
              className="inline-flex items-center justify-center px-6 py-4 rounded-xl bg-[#F59E0B] text-slate-900 font-bold hover:bg-[#d97706] transition-colors shadow-lg group"
            >
              <UploadCloud className="w-5 h-5 mr-2" />
              Upload My Statement — Free
            </a>
            <a
              href="/quote"
              className="inline-flex items-center justify-center px-6 py-4 rounded-xl bg-white border-2 border-slate-200 text-slate-700 font-semibold hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <Phone className="w-5 h-5 mr-2 text-slate-400" />
              Schedule a Call
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Bank-level security</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>No contracts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>Free analysis</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column - Dark Navy with Statement Analysis UI */}
      <div className="w-full lg:w-1/2 bg-[#0F172A] relative flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16 min-h-[500px] lg:min-h-screen">
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)', backgroundSize: '28px 28px' }}
        />
        {/* Glow accents */}
        <div className="absolute top-1/4 right-0 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-0 w-64 h-64 bg-[#F59E0B]/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative w-full max-w-lg mx-auto z-10">
          {/* Statement Analysis Card */}
          <div className="bg-[#1E293B] border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden">
            {/* Card Header */}
            <div className="px-6 py-5 border-b border-slate-700/60 flex justify-between items-center bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-slate-200 font-semibold text-sm">Statement Analysis</p>
                  <p className="text-slate-400 text-xs">June 2024 Processing</p>
                </div>
              </div>
              <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                <span className="text-emerald-400 text-xs font-bold tracking-wide">COMPLETED</span>
              </div>
            </div>

            {/* Savings figure */}
            <div className="px-6 pt-6 pb-4">
              <p className="text-slate-400 text-sm mb-1">Projected Monthly Savings</p>
              <div className="flex items-end gap-3">
                <h2 className="text-4xl font-extrabold text-white">$487<span className="text-xl text-slate-500 font-medium">.50</span></h2>
                <div className="flex items-center text-emerald-400 text-sm font-semibold mb-1.5 bg-emerald-500/10 px-2 py-0.5 rounded">
                  <TrendingDown className="w-3 h-3 mr-1" />
                  −32%
                </div>
              </div>
            </div>

            {/* Line items */}
            <div className="px-6 pb-6 space-y-3">
              {[
                { label: 'Effective Rate', from: '3.24%', to: '1.85%', barPct: '57%', color: 'bg-emerald-500' },
                { label: 'Hidden Fees', from: '$145/mo', to: '$0.00', barPct: '0%', color: 'bg-emerald-500' },
                { label: 'Markup', from: '1.40%', to: '0.25%', barPct: '18%', color: 'bg-amber-400' },
              ].map((item) => (
                <div key={item.label} className="p-4 rounded-xl bg-[#0F172A]/60 border border-slate-700/30 flex justify-between items-center">
                  <div>
                    <p className="text-slate-300 text-sm font-medium mb-1">{item.label}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="line-through">{item.from}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                      <span className="text-emerald-400 font-semibold">{item.to}</span>
                    </div>
                  </div>
                  <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: item.barPct }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Card footer */}
            <div className="bg-slate-800/40 px-6 py-4 border-t border-slate-700/50 flex items-center justify-between">
              <span className="text-slate-500 text-xs">Powered by Liberty Bancard AI</span>
              <button className="flex items-center gap-1 text-sm font-medium text-slate-400 hover:text-white transition-colors">
                View Full Breakdown
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Floating PCI badge */}
          <div className="hidden sm:flex absolute -bottom-5 -left-4 bg-[#1E293B] border border-slate-700 p-3.5 rounded-xl shadow-xl items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-white text-xs font-bold">PCI Compliant</p>
              <p className="text-slate-400 text-[11px]">Level 1 Security</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
