import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, BarChart3, Users } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      
      <main className="flex-grow pt-16">
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-background pt-20 pb-32">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100 via-transparent to-transparent opacity-50" />
          
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-medium text-sm mb-6">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                  </span>
                  Accepting new business partners
                </div>
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold text-primary leading-[1.1] mb-6">
                  We don't sell rates. <br/>
                  <span className="text-accent">We prove value.</span>
                </h1>
                <p className="text-xl text-muted-foreground mb-8 max-w-lg leading-relaxed">
                  Stop overpaying for payment processing. We analyze your statement, prove your real cost, and optimize your financial infrastructure.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link href="/get-started">
                    <Button size="lg" className="h-14 px-8 text-lg font-semibold shadow-xl shadow-primary/20 hover:translate-y-[-2px] transition-all">
                      Get Your Free Analysis
                      <ArrowRight className="ml-2 w-5 h-5" />
                    </Button>
                  </Link>
                  <Link href="/upload-statement">
                    <Button size="lg" variant="outline" className="h-14 px-8 text-lg bg-white/50 backdrop-blur-sm">
                      Upload Statement
                    </Button>
                  </Link>
                </div>
                
                <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-accent" />
                    <span>No hidden fees</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-accent" />
                    <span>24/7 Support</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-accent" />
                    <span>Cancel anytime</span>
                  </div>
                </div>
              </motion.div>
              
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="relative"
              >
                <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-border/50 bg-white">
                  {/* Abstract UI representation */}
                  <div className="absolute top-0 w-full h-12 bg-muted/50 border-b border-border flex items-center px-4 gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-400"/>
                    <div className="w-3 h-3 rounded-full bg-yellow-400"/>
                    <div className="w-3 h-3 rounded-full bg-green-400"/>
                  </div>
                  <div className="pt-12 p-8 bg-gradient-to-br from-white to-gray-50 min-h-[500px]">
                    {/* Placeholder for dashboard preview image */}
                    {/* corporate office building clean glass */}
                    <img 
                      src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80" 
                      alt="Modern Office" 
                      className="rounded-xl shadow-lg mb-6 w-full object-cover h-64"
                    />
                    <div className="space-y-4">
                      <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                      <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
                      <div className="h-20 bg-accent/5 rounded-xl border border-accent/10 p-4 flex items-center justify-between">
                        <div>
                          <div className="text-sm text-muted-foreground">Monthly Savings</div>
                          <div className="text-2xl font-bold text-primary">$1,240.50</div>
                        </div>
                        <div className="h-10 w-10 bg-accent/20 rounded-full flex items-center justify-center text-accent">
                          <BarChart3 className="w-6 h-6" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Floating Elements */}
                <motion.div 
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  className="absolute -right-8 top-20 bg-white p-4 rounded-xl shadow-xl border border-border max-w-[200px]"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <ShieldCheck className="w-8 h-8 text-green-500" />
                    <div>
                      <div className="font-bold text-primary">Secure</div>
                      <div className="text-xs text-muted-foreground">PCI Compliant</div>
                    </div>
                  </div>
                </motion.div>
                
                <motion.div 
                  animate={{ y: [0, 10, 0] }}
                  transition={{ repeat: Infinity, duration: 5, ease: "easeInOut", delay: 1 }}
                  className="absolute -left-8 bottom-20 bg-white p-4 rounded-xl shadow-xl border border-border"
                >
                  <div className="flex items-center gap-3">
                    <Users className="w-8 h-8 text-accent" />
                    <div>
                      <div className="font-bold text-primary">5,000+</div>
                      <div className="text-xs text-muted-foreground">Merchants Trusted</div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-display font-bold text-primary mb-4">Enterprise-grade solutions for every business</h2>
              <p className="text-lg text-muted-foreground">Whether you're a small boutique or a national chain, our platform scales with your needs.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: "0% Processing", desc: "Eliminate credit card fees entirely with our compliant surcharge program.", icon: "💎" },
                { title: "Next Day Funding", desc: "Get access to your capital faster. We settle funds within 24 hours.", icon: "⚡" },
                { title: "Real-time Analytics", desc: "Track every transaction and spot trends with our advanced dashboard.", icon: "📊" },
              ].map((feature, i) => (
                <div key={i} className="group p-8 rounded-2xl bg-muted/30 border border-border/50 hover:border-accent/50 hover:bg-accent/5 transition-all duration-300">
                  <div className="text-4xl mb-6">{feature.icon}</div>
                  <h3 className="text-xl font-bold text-primary mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 bg-primary relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
          <div className="max-w-4xl mx-auto px-4 text-center relative z-10">
            <h2 className="text-4xl md:text-5xl font-display font-bold text-white mb-6">Ready to see your real savings?</h2>
            <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
              Upload your most recent merchant statement and our AI will analyze exactly how much you can save.
            </p>
            <Link href="/upload-statement">
              <Button size="lg" className="h-16 px-10 text-lg bg-white text-primary hover:bg-blue-50 font-bold shadow-2xl">
                Start Free Analysis
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
