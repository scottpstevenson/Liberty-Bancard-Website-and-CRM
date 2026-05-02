import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Check,
  Star,
  Wifi,
  Smartphone,
  CreditCard,
  Monitor,
  ArrowRight,
  Shield,
  Zap,
  DollarSign,
  Phone,
  ShoppingCart,
} from "lucide-react";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import imgCloverMini3 from "@assets/images/terminal-clover-mini-3.png";
import imgCloverStationDuo from "@assets/images/terminal-clover-station-duo.png";
import imgDejavooQD4 from "@assets/images/terminal-dejavoo-qd4.png";
import imgPaxA920 from "@assets/images/terminal-pax-a920.png";
import imgSwipeSimpleB250 from "@assets/images/terminal-swipesimple-b250.png";

interface Terminal {
  id: string;
  name: string;
  brand: string;
  tagline: string;
  description: string;
  image: string;
  popular?: boolean;
  price: string;
  monthlyFee: string;
  features: string[];
  specs: { label: string; value: string }[];
  bestFor: string[];
  connectivity: string[];
}

const terminals: Terminal[] = [
  {
    id: "clover-flex-3",
    name: "Clover Flex 3",
    brand: "Clover",
    tagline: "All-in-one handheld POS",
    description: "The Clover Flex 3 is a powerful, portable point-of-sale system that fits in your hand. Built-in printer, camera for barcode scanning, and a full suite of business management tools. Perfect for tableside service, line-busting, or mobile businesses.",
    image: imgCloverFlex3,
    popular: true,
    price: "Contact for pricing",
    monthlyFee: "Varies by plan",
    features: [
      "6-inch touchscreen display",
      "Built-in receipt printer",
      "Barcode scanner camera",
      "Accept chip, swipe, tap, and QR",
      "Wi-Fi + 4G LTE connectivity",
      "Clover App Market access",
      "Employee management & permissions",
      "Inventory tracking",
      "Real-time sales reporting",
      "Customer engagement tools",
    ],
    specs: [
      { label: "Display", value: "6\" HD touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Battery", value: "All-day battery life" },
      { label: "Connectivity", value: "Wi-Fi, 4G LTE, Bluetooth" },
      { label: "Payment Types", value: "EMV, NFC, Magstripe, QR" },
      { label: "OS", value: "Clover OS (Android-based)" },
    ],
    bestFor: ["Restaurants", "Retail", "Service businesses", "Mobile vendors"],
    connectivity: ["Wi-Fi", "4G LTE", "Bluetooth"],
  },
  {
    id: "clover-mini-3",
    name: "Clover Mini 3",
    brand: "Clover",
    tagline: "Compact countertop powerhouse",
    description: "The Clover Mini 3 brings full POS functionality to a compact countertop form factor. An 8-inch touchscreen, built-in printer, and access to the complete Clover ecosystem make it the ideal solution for businesses that need power without bulk.",
    image: imgCloverMini3,
    price: "Contact for pricing",
    monthlyFee: "Varies by plan",
    features: [
      "8-inch touchscreen display",
      "Built-in receipt printer",
      "Fingerprint reader for staff login",
      "Accept chip, swipe, tap, and QR",
      "Wi-Fi + Ethernet connectivity",
      "Clover App Market access",
      "Table management (restaurants)",
      "Customer-facing display option",
      "Offline payment capability",
      "Tip adjustment on screen",
    ],
    specs: [
      { label: "Display", value: "8\" HD touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Dimensions", value: "Compact countertop" },
      { label: "Connectivity", value: "Wi-Fi, Ethernet" },
      { label: "Payment Types", value: "EMV, NFC, Magstripe, QR" },
      { label: "Security", value: "Fingerprint reader" },
    ],
    bestFor: ["Quick-service restaurants", "Cafes & bakeries", "Small retail", "Service counters"],
    connectivity: ["Wi-Fi", "Ethernet"],
  },
  {
    id: "clover-station-duo",
    name: "Clover Station Duo",
    brand: "Clover",
    tagline: "Full-featured POS station",
    description: "The Clover Station Duo is the flagship countertop POS system with dual screens — a merchant-facing display and a customer-facing touchscreen. Cash drawer, receipt printer, and the full Clover software suite deliver a complete register experience.",
    image: imgCloverStationDuo,
    price: "Contact for pricing",
    monthlyFee: "Varies by plan",
    features: [
      "14-inch merchant display",
      "8-inch customer-facing screen",
      "Built-in receipt printer",
      "Cash drawer included",
      "Fingerprint login for staff",
      "Full Clover App Market",
      "Advanced inventory management",
      "Employee scheduling & timeclock",
      "Detailed sales analytics",
      "Multi-location management",
    ],
    specs: [
      { label: "Merchant Display", value: "14\" HD touchscreen" },
      { label: "Customer Display", value: "8\" touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Connectivity", value: "Wi-Fi, Ethernet" },
      { label: "Payment Types", value: "EMV, NFC, Magstripe, QR" },
      { label: "Peripherals", value: "Cash drawer, scale, scanner" },
    ],
    bestFor: ["Full-service restaurants", "Retail stores", "Multi-location businesses", "High-volume merchants"],
    connectivity: ["Wi-Fi", "Ethernet"],
  },
  {
    id: "dejavoo-qd4",
    name: "Dejavoo QD4",
    brand: "Dejavoo",
    tagline: "Rugged mobile smart terminal",
    description: "The Dejavoo QD4 is a versatile Android-based smart terminal built for businesses that need reliable payment processing on the go. Its rugged design, long battery life, and dual connectivity make it a workhorse for field service, delivery, and pop-up operations.",
    image: imgDejavooQD4,
    popular: true,
    price: "Contact for pricing",
    monthlyFee: "$0/month with processing",
    features: [
      "5.5-inch touchscreen display",
      "Built-in thermal printer",
      "Dual SIM + Wi-Fi connectivity",
      "Accept chip, swipe, and tap",
      "Android-based smart terminal",
      "Long-lasting battery",
      "Drop-resistant design",
      "Tip adjust on screen",
      "Quick settlement & batching",
      "Surcharge/cash discount ready",
    ],
    specs: [
      { label: "Display", value: "5.5\" touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Battery", value: "Extended life (8+ hours)" },
      { label: "Connectivity", value: "4G LTE, Wi-Fi, Bluetooth" },
      { label: "Payment Types", value: "EMV, NFC, Magstripe" },
      { label: "Durability", value: "Drop-tested, rugged build" },
    ],
    bestFor: ["Delivery services", "Field service", "Food trucks", "Pop-up events", "Contractors"],
    connectivity: ["4G LTE", "Wi-Fi", "Bluetooth"],
  },
  {
    id: "pax-a920",
    name: "PAX A920",
    brand: "PAX",
    tagline: "Smart Android terminal",
    description: "The PAX A920 is a sleek, Android-powered smart terminal that combines elegant design with powerful performance. Its 5-inch HD display, fast processor, and all-day battery make it one of the most popular smart terminals on the market for merchants who want speed and style.",
    image: imgPaxA920,
    popular: true,
    price: "Contact for pricing",
    monthlyFee: "$0/month with processing",
    features: [
      "5-inch HD touchscreen",
      "Built-in thermal printer",
      "Dual cameras (front + rear)",
      "Accept chip, swipe, tap, and QR",
      "4G LTE + Wi-Fi + Bluetooth",
      "Android 7.1 operating system",
      "Fast quad-core processor",
      "All-day battery life",
      "Slim, lightweight design",
      "Supports cash discount programs",
    ],
    specs: [
      { label: "Display", value: "5\" HD IPS touchscreen" },
      { label: "Printer", value: "Built-in high-speed thermal" },
      { label: "Processor", value: "Quad-core 1.4GHz" },
      { label: "Connectivity", value: "4G LTE, Wi-Fi, Bluetooth 4.0" },
      { label: "Payment Types", value: "EMV, NFC, Magstripe, QR" },
      { label: "Battery", value: "5,250 mAh (all-day)" },
    ],
    bestFor: ["Retail", "Restaurants", "Salons & spas", "Professional services"],
    connectivity: ["4G LTE", "Wi-Fi", "Bluetooth"],
  },
  {
    id: "swipe-simple",
    name: "SwipeSimple",
    brand: "SwipeSimple",
    tagline: "Mobile payments made simple",
    description: "SwipeSimple turns any smartphone or tablet into a full payment terminal. With the SwipeSimple card reader and app, you can accept chip, swipe, and contactless payments anywhere. No bulky hardware, no long-term commitments — just simple, affordable mobile payment processing.",
    image: imgSwipeSimpleB250,
    price: "Reader from $49",
    monthlyFee: "$0/month",
    features: [
      "Works with iOS and Android",
      "Bluetooth card reader",
      "Accept chip, swipe, and tap",
      "Digital receipts (email/SMS)",
      "Recurring payments & invoicing",
      "Product catalog & inventory",
      "Virtual terminal built in",
      "Real-time transaction dashboard",
      "No long-term contract",
      "Integrates with QuickBooks",
    ],
    specs: [
      { label: "Reader", value: "Bluetooth chip/swipe/tap" },
      { label: "App", value: "iOS 13+ / Android 8+" },
      { label: "Connectivity", value: "Bluetooth to phone" },
      { label: "Payment Types", value: "EMV, NFC, Magstripe" },
      { label: "Receipts", value: "Email, SMS, print via AirPrint" },
      { label: "Virtual Terminal", value: "Built-in keyed entry" },
    ],
    bestFor: ["Solo entrepreneurs", "Market vendors", "Home services", "Small businesses", "Pop-ups"],
    connectivity: ["Bluetooth"],
  },
];

const programs = [
  {
    title: "Liberty Zero™ Program",
    description: "Eliminate processing fees entirely. Customers who pay cash get the listed price; card payments include a small service fee — fully compliant with proper disclosures, signage, and staff scripts handled for you.",
    icon: DollarSign,
    savings: "Save up to 100% on processing",
  },
  {
    title: "Interchange Plus",
    description: "The most transparent pricing model. You pay the actual interchange rate set by card brands plus a small fixed markup. No hidden fees, no bundled pricing.",
    icon: Shield,
    savings: "Save 20-40% vs flat rate",
  },
  {
    title: "Flat Rate",
    description: "Simple, predictable pricing at a single rate for all card types. Easy to understand and budget for. Best for lower-volume merchants.",
    icon: Zap,
    savings: "Predictable monthly costs",
  },
];

export default function Equipment() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Payment Terminals & Equipment"
        description="Explore our selection of payment terminals including Clover, Dejavoo QD4, PAX A920, and SwipeSimple. Find the perfect solution for your business."
        path="/equipment"
        noindex={true}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <Badge variant="secondary" className="mb-4" data-testid="badge-internal">
                Sales Team Resource — Not Public
              </Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4" data-testid="text-equipment-heading">
                Payment Terminals & Equipment
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed" data-testid="text-equipment-subheading">
                Everything you need to present hardware options to merchants. All terminals are available with our processing programs — no equipment leases required.
              </p>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-8" data-testid="text-terminals-heading">
              Available Terminals
            </h2>

            <div className="space-y-12">
              {terminals.map((terminal) => (
                <Card key={terminal.id} className="overflow-hidden" data-testid={`card-terminal-${terminal.id}`}>
                  <CardContent className="p-0">
                    <div className="grid grid-cols-1 lg:grid-cols-3">
                      <div className="bg-muted/30 p-8 flex items-center justify-center">
                        <img
                          src={terminal.image}
                          alt={terminal.name}
                          className="max-h-64 w-auto object-contain"
                          data-testid={`img-terminal-${terminal.id}`}
                        />
                      </div>

                      <div className="lg:col-span-2 p-6 lg:p-8">
                        <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline">{terminal.brand}</Badge>
                              {terminal.popular && (
                                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                                  <Star className="w-3 h-3 mr-1" /> Popular
                                </Badge>
                              )}
                            </div>
                            <h3 className="text-2xl font-display font-bold text-foreground" data-testid={`text-terminal-name-${terminal.id}`}>
                              {terminal.name}
                            </h3>
                            <p className="text-primary font-medium">{terminal.tagline}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-foreground">{terminal.price}</p>
                            <p className="text-sm text-muted-foreground">{terminal.monthlyFee}</p>
                          </div>
                        </div>

                        <p className="text-muted-foreground mb-6 leading-relaxed">{terminal.description}</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          <div>
                            <h4 className="font-semibold text-sm text-foreground mb-3">Key Features</h4>
                            <ul className="space-y-1.5">
                              {terminal.features.slice(0, 6).map((f, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                  {f}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm text-foreground mb-3">More Features</h4>
                            <ul className="space-y-1.5">
                              {terminal.features.slice(6).map((f, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                  {f}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                          {terminal.specs.map((spec, i) => (
                            <div key={i} className="bg-muted/50 rounded-lg p-3">
                              <p className="text-xs text-muted-foreground">{spec.label}</p>
                              <p className="text-sm font-medium text-foreground">{spec.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap gap-6 mb-6">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5">Best For</p>
                            <div className="flex flex-wrap gap-1.5">
                              {terminal.bestFor.map((b) => (
                                <Badge key={b} variant="secondary" className="text-xs">{b}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5">Connectivity</p>
                            <div className="flex flex-wrap gap-1.5">
                              {terminal.connectivity.map((c) => (
                                <Badge key={c} variant="outline" className="text-xs">
                                  {c === "Wi-Fi" ? <Wifi className="w-3 h-3 mr-1" /> : c === "Bluetooth" ? <Smartphone className="w-3 h-3 mr-1" /> : <Monitor className="w-3 h-3 mr-1" />}
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
                          <Link
                            href={`/estimate?terminal=${encodeURIComponent(terminal.name)}&utm_source=equipment&utm_content=${terminal.id}`}
                            data-testid={`link-request-terminal-${terminal.id}`}
                          >
                            <Button className="gap-2 w-full sm:w-auto">
                              Request This Terminal
                              <ArrowRight className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Link href="/upload-statement" data-testid={`link-statement-for-terminal-${terminal.id}`}>
                            <Button variant="outline" className="gap-2 w-full sm:w-auto">
                              <DollarSign className="w-4 h-4" />
                              See My Savings First
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-programs-heading">
              Available Processing Programs
            </h2>
            <p className="text-muted-foreground mb-8">
              All terminals above work with any of our processing programs. Help merchants choose the best fit.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {programs.map((program) => (
                <Card key={program.title} data-testid={`card-program-${program.title.toLowerCase().replace(/\s+/g, "-")}`}>
                  <CardHeader>
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                      <program.icon className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{program.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">{program.description}</p>
                    <Badge variant="secondary" className="text-xs">{program.savings}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-8" data-testid="text-comparison-heading">
              Quick Comparison
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-comparison">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Terminal</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Display</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Printer</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Connectivity</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Best For</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="py-3 px-4 font-medium text-foreground">Clover Flex 3</td>
                    <td className="py-3 px-4 text-muted-foreground">Handheld</td>
                    <td className="py-3 px-4 text-muted-foreground">6" touch</td>
                    <td className="py-3 px-4 text-green-600">Built-in</td>
                    <td className="py-3 px-4 text-muted-foreground">Wi-Fi, 4G, BT</td>
                    <td className="py-3 px-4 text-muted-foreground">Tableside, mobile</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 px-4 font-medium text-foreground">Clover Mini 3</td>
                    <td className="py-3 px-4 text-muted-foreground">Countertop</td>
                    <td className="py-3 px-4 text-muted-foreground">8" touch</td>
                    <td className="py-3 px-4 text-green-600">Built-in</td>
                    <td className="py-3 px-4 text-muted-foreground">Wi-Fi, Ethernet</td>
                    <td className="py-3 px-4 text-muted-foreground">Counter service</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 px-4 font-medium text-foreground">Clover Station Duo</td>
                    <td className="py-3 px-4 text-muted-foreground">Full POS</td>
                    <td className="py-3 px-4 text-muted-foreground">14" + 8" dual</td>
                    <td className="py-3 px-4 text-green-600">Built-in</td>
                    <td className="py-3 px-4 text-muted-foreground">Wi-Fi, Ethernet</td>
                    <td className="py-3 px-4 text-muted-foreground">Full-service, retail</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 px-4 font-medium text-foreground">Dejavoo QD4</td>
                    <td className="py-3 px-4 text-muted-foreground">Smart terminal</td>
                    <td className="py-3 px-4 text-muted-foreground">5.5" touch</td>
                    <td className="py-3 px-4 text-green-600">Built-in</td>
                    <td className="py-3 px-4 text-muted-foreground">4G, Wi-Fi, BT</td>
                    <td className="py-3 px-4 text-muted-foreground">Field, delivery</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 px-4 font-medium text-foreground">PAX A920</td>
                    <td className="py-3 px-4 text-muted-foreground">Smart terminal</td>
                    <td className="py-3 px-4 text-muted-foreground">5" HD touch</td>
                    <td className="py-3 px-4 text-green-600">Built-in</td>
                    <td className="py-3 px-4 text-muted-foreground">4G, Wi-Fi, BT</td>
                    <td className="py-3 px-4 text-muted-foreground">All-purpose</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-foreground">SwipeSimple</td>
                    <td className="py-3 px-4 text-muted-foreground">Mobile reader</td>
                    <td className="py-3 px-4 text-muted-foreground">Phone/tablet</td>
                    <td className="py-3 px-4 text-muted-foreground">Via phone</td>
                    <td className="py-3 px-4 text-muted-foreground">Bluetooth</td>
                    <td className="py-3 px-4 text-muted-foreground">Solo, pop-ups</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-8" data-testid="text-talk-tracks-heading">
              Sales Talk Tracks
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                    Merchant asks: "What terminal should I get?"
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p><strong>Counter-only business:</strong> "The Clover Mini 3 gives you a compact countertop setup with a built-in printer and the full Clover app ecosystem. For a full register, the Station Duo adds a customer-facing screen and cash drawer."</p>
                  <p><strong>Needs mobility:</strong> "The PAX A920 or Dejavoo QD4 are both great options — handheld, 4G + Wi-Fi, built-in printer. The QD4 is especially rugged for field work."</p>
                  <p><strong>Just getting started / low volume:</strong> "SwipeSimple is the simplest option — it pairs with your phone, no monthly fee, and you can accept chip, swipe, and tap right away."</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-primary" />
                    Merchant asks: "Do I have to lease equipment?"
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p><strong>Never recommend a lease.</strong> Equipment leases are one of the worst deals in payment processing — merchants end up paying 3-5x the value of the terminal over 48 months and can't cancel.</p>
                  <p>Our approach: <strong>Purchase or free placement.</strong> Depending on the processing program and volume, terminals may be available at no upfront cost with a processing agreement. Always present the purchase option as the most straightforward path.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    Merchant asks: "How does cash discount work with these?"
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>All terminals listed here support cash discount / dual pricing programs. The terminal automatically adds the service fee to card transactions and removes it for cash.</p>
                  <p><strong>Key compliance points:</strong> Signage must be posted at the entrance and point of sale. The fee appears as a separate line item on the receipt. The program must be registered with the card brands through us.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Phone className="w-4 h-4 text-primary" />
                    Merchant asks: "What about my existing POS system?"
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>If the merchant already has a POS they like (Toast, Square, Shopify, etc.), we can often integrate with a standalone terminal alongside their existing system, or provide a semi-integrated solution.</p>
                  <p><strong>For Clover users migrating:</strong> Their data (menu items, customers, inventory) can typically be imported. Check with onboarding for migration support.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground py-16">
          <div className="max-w-3xl mx-auto px-4 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4" data-testid="text-equipment-cta-heading">
              Ready to Get a Merchant Set Up?
            </h2>
            <p className="text-primary-foreground/80 mb-6">
              Start with a statement review to find the right program and equipment match.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-equipment-upload">
                <Button size="lg" variant="secondary" className="gap-2">
                  Upload Statement <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/merchant-application" data-testid="link-equipment-application">
                <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
                  Merchant Application
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
