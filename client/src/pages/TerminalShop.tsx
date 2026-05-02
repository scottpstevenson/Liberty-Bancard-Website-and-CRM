import { useState } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getStoredUTMParams } from "@/lib/utm";
import { trackEquipmentOrder } from "@/lib/tracking";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Star,
  ShoppingCart,
  ArrowRight,
  ArrowLeft,
  Wifi,
  Smartphone,
  Monitor,
  CreditCard,
  Shield,
  Truck,
  Phone,
  CheckCircle,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { PromoBanner, PromoList } from "@/components/PromoBanner";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import imgCloverMini3 from "@assets/images/terminal-clover-mini-3.png";
import imgCloverStationDuo from "@assets/images/terminal-clover-station-duo.png";
import imgDejavooQD4 from "@assets/images/terminal-dejavoo-qd4.png";
import imgPaxA920 from "@assets/images/terminal-pax-a920.png";
import imgSwipeSimpleB250 from "@assets/images/terminal-swipesimple-b250.png";

interface ShopTerminal {
  id: string;
  name: string;
  brand: string;
  tagline: string;
  shortDescription: string;
  image: string;
  popular?: boolean;
  price: number | null;
  priceLabel: string;
  monthlyFee: string;
  highlights: string[];
  specs: { label: string; value: string }[];
  bestFor: string[];
  connectivity: string[];
  includes: string[];
}

const shopTerminals: ShopTerminal[] = [
  {
    id: "clover-flex-3",
    name: "Clover Flex 3",
    brand: "Clover",
    tagline: "All-in-one handheld POS",
    shortDescription: "Powerful handheld POS with built-in printer, barcode scanner, and 4G LTE. Take payments anywhere — tableside, curbside, or on the go.",
    image: imgCloverFlex3,
    popular: true,
    price: null,
    priceLabel: "Custom Quote",
    monthlyFee: "Varies by plan",
    highlights: [
      "6\" HD touchscreen",
      "Built-in printer & camera",
      "Wi-Fi + 4G LTE",
      "Chip, swipe, tap, QR",
      "Full Clover app ecosystem",
      "All-day battery",
    ],
    specs: [
      { label: "Display", value: "6\" HD touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Battery", value: "All-day" },
      { label: "Connectivity", value: "Wi-Fi, 4G LTE, Bluetooth" },
    ],
    bestFor: ["Restaurants", "Retail", "Mobile", "Service"],
    connectivity: ["Wi-Fi", "4G LTE", "Bluetooth"],
    includes: ["Terminal", "Charging cable", "Quick start guide", "Clover account setup"],
  },
  {
    id: "clover-mini-3",
    name: "Clover Mini 3",
    brand: "Clover",
    tagline: "Compact countertop powerhouse",
    shortDescription: "Full POS functionality in a compact 8\" countertop form. Built-in printer, fingerprint login, and the complete Clover ecosystem.",
    image: imgCloverMini3,
    price: null,
    priceLabel: "Custom Quote",
    monthlyFee: "Varies by plan",
    highlights: [
      "8\" HD touchscreen",
      "Built-in printer",
      "Fingerprint staff login",
      "Chip, swipe, tap, QR",
      "Customer-facing display option",
      "Offline payment capable",
    ],
    specs: [
      { label: "Display", value: "8\" HD touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Security", value: "Fingerprint reader" },
      { label: "Connectivity", value: "Wi-Fi, Ethernet" },
    ],
    bestFor: ["Cafes", "Quick-service", "Small retail", "Service counters"],
    connectivity: ["Wi-Fi", "Ethernet"],
    includes: ["Terminal", "Power adapter", "Ethernet cable", "Quick start guide", "Clover account setup"],
  },
  {
    id: "clover-station-duo",
    name: "Clover Station Duo",
    brand: "Clover",
    tagline: "Full register experience",
    shortDescription: "Flagship dual-screen POS: 14\" merchant display + 8\" customer screen. Cash drawer, printer, and full suite included. The complete register.",
    image: imgCloverStationDuo,
    price: null,
    priceLabel: "Custom Quote",
    monthlyFee: "Varies by plan",
    highlights: [
      "14\" + 8\" dual screens",
      "Cash drawer included",
      "Built-in printer",
      "Fingerprint staff login",
      "Advanced inventory & reporting",
      "Multi-location support",
    ],
    specs: [
      { label: "Merchant Display", value: "14\" HD touchscreen" },
      { label: "Customer Display", value: "8\" touchscreen" },
      { label: "Peripherals", value: "Cash drawer, scanner" },
      { label: "Connectivity", value: "Wi-Fi, Ethernet" },
    ],
    bestFor: ["Full-service restaurants", "Retail stores", "Multi-location", "High volume"],
    connectivity: ["Wi-Fi", "Ethernet"],
    includes: ["Merchant terminal", "Customer display", "Cash drawer", "Receipt printer", "Power supply", "Clover account setup"],
  },
  {
    id: "dejavoo-qd4",
    name: "Dejavoo QD4",
    brand: "Dejavoo",
    tagline: "Rugged mobile smart terminal",
    shortDescription: "Built tough for the field. Android-based smart terminal with dual SIM, long battery, and drop-resistant design. Perfect for delivery, contractors, and mobile merchants.",
    image: imgDejavooQD4,
    popular: true,
    price: 299,
    priceLabel: "$299",
    monthlyFee: "$0/mo with processing",
    highlights: [
      "5.5\" touchscreen",
      "Built-in printer",
      "4G LTE + Wi-Fi",
      "8+ hour battery",
      "Drop-resistant build",
      "Cash discount ready",
    ],
    specs: [
      { label: "Display", value: "5.5\" touchscreen" },
      { label: "Printer", value: "Built-in thermal" },
      { label: "Battery", value: "8+ hours" },
      { label: "Connectivity", value: "4G LTE, Wi-Fi, Bluetooth" },
    ],
    bestFor: ["Delivery", "Field service", "Food trucks", "Contractors"],
    connectivity: ["4G LTE", "Wi-Fi", "Bluetooth"],
    includes: ["Terminal", "Charging dock", "SIM card", "Quick start guide"],
  },
  {
    id: "pax-a920",
    name: "PAX A920",
    brand: "PAX",
    tagline: "Sleek Android smart terminal",
    shortDescription: "One of the most popular smart terminals on the market. Slim design, fast processor, dual cameras, and all-day battery. Accepts everything — chip, swipe, tap, QR.",
    image: imgPaxA920,
    popular: true,
    price: 249,
    priceLabel: "$249",
    monthlyFee: "$0/mo with processing",
    highlights: [
      "5\" HD IPS display",
      "Built-in printer",
      "Dual cameras",
      "Quad-core processor",
      "5,250 mAh battery",
      "Slim & lightweight",
    ],
    specs: [
      { label: "Display", value: "5\" HD IPS touchscreen" },
      { label: "Processor", value: "Quad-core 1.4GHz" },
      { label: "Battery", value: "5,250 mAh" },
      { label: "Connectivity", value: "4G LTE, Wi-Fi, Bluetooth" },
    ],
    bestFor: ["Retail", "Restaurants", "Salons", "Professional services"],
    connectivity: ["4G LTE", "Wi-Fi", "Bluetooth"],
    includes: ["Terminal", "Charging cable", "Quick start guide"],
  },
  {
    id: "swipe-simple",
    name: "SwipeSimple B250",
    brand: "SwipeSimple",
    tagline: "Turn your phone into a terminal",
    shortDescription: "No terminal needed — just pair the Bluetooth reader with your phone or tablet. Accept chip, swipe, and tap. Perfect for solo businesses and pop-ups.",
    image: imgSwipeSimpleB250,
    price: 49,
    priceLabel: "From $49",
    monthlyFee: "$0/mo",
    highlights: [
      "Works with iOS & Android",
      "Bluetooth chip/tap reader",
      "Digital receipts",
      "Invoicing built in",
      "No contract",
      "QuickBooks integration",
    ],
    specs: [
      { label: "Reader", value: "Bluetooth chip/swipe/tap" },
      { label: "App", value: "iOS 13+ / Android 8+" },
      { label: "Receipts", value: "Email, SMS, AirPrint" },
      { label: "Virtual Terminal", value: "Built-in keyed entry" },
    ],
    bestFor: ["Solo entrepreneurs", "Market vendors", "Home services", "Pop-ups"],
    connectivity: ["Bluetooth"],
    includes: ["Card reader", "Micro-USB cable", "SwipeSimple app access"],
  },
];

interface CartItem {
  terminalId: string;
  quantity: number;
}

type CheckoutStep = "browse" | "cart" | "info" | "confirm";

export default function TerminalShop() {
  const { toast } = useToast();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<CheckoutStep>("browse");
  const [selectedTerminal, setSelectedTerminal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [promoCode, setPromoCode] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const promo = params.get("promo");
      if (promo) {
        localStorage.setItem("lb_promo_code", promo.toUpperCase());
        return promo.toUpperCase();
      }
      return localStorage.getItem("lb_promo_code") || "";
    }
    return "";
  });
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    businessName: "",
    message: "",
  });

  const addToCart = (terminalId: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.terminalId === terminalId);
      if (existing) {
        return prev.map((i) =>
          i.terminalId === terminalId ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { terminalId, quantity: 1 }];
    });
    const terminal = shopTerminals.find((t) => t.id === terminalId);
    toast({ title: `${terminal?.name} added`, description: "View your cart to continue." });
  };

  const updateQuantity = (terminalId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.terminalId === terminalId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i
        )
        .filter((i) => i.quantity > 0)
    );
  };

  const removeFromCart = (terminalId: string) => {
    setCart((prev) => prev.filter((i) => i.terminalId !== terminalId));
  };

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const handleSubmit = async () => {
    if (!form.firstName || !form.email || !form.phone) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Your cart is empty", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const orderItems = cart.map((item) => {
        const t = shopTerminals.find((t) => t.id === item.terminalId);
        return { name: t?.name || "", quantity: Math.min(Math.max(1, item.quantity), 50), price: t?.priceLabel || "" };
      });
      const refCode = localStorage.getItem("lb_ref_code") || undefined;
      const utmParams = getStoredUTMParams();
      const response = await fetch("/api/equipment-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, items: orderItems, referralCode: refCode, promoCode: promoCode || undefined, ...utmParams }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ message: "Something went wrong" }));
        toast({ title: data.message || "Submission failed", variant: "destructive" });
        return;
      }
      trackEquipmentOrder();
      setSubmitted(true);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const detail = selectedTerminal
    ? shopTerminals.find((t) => t.id === selectedTerminal)
    : null;

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <SEO title="Order Received" description="Your equipment order has been submitted." path="/shop" noindex={true} />
        <Navbar />
        <main className="flex-grow pt-28">
          <section className="py-20">
            <div className="max-w-lg mx-auto px-4 text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground mb-4" data-testid="text-order-success">
                Order Request Received
              </h1>
              <p className="text-muted-foreground mb-2">
                Thank you, {form.firstName}! We've received your equipment request.
              </p>
              <p className="text-muted-foreground mb-2">
                A team member will reach out within 1 business day to finalize your order, review pricing, and coordinate setup.
              </p>
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-2 text-sm font-medium mb-8" data-testid="text-processing-time">
                <Truck className="w-4 h-4" />
                24-hour setup & testing before shipment
              </div>
              <div className="bg-muted/50 rounded-lg p-4 mb-4 text-left">
                <h3 className="font-semibold text-sm mb-3">Order Summary</h3>
                {cart.map((item) => {
                  const t = shopTerminals.find((t) => t.id === item.terminalId);
                  return (
                    <div key={item.terminalId} className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">{t?.name} × {item.quantity}</span>
                      <span className="text-foreground font-medium">{t?.priceLabel}</span>
                    </div>
                  );
                })}
              </div>
              <div className="bg-muted/30 rounded-lg p-4 mb-8 text-left">
                <h3 className="font-semibold text-sm mb-2">What Happens Next</h3>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
                    <span>We confirm your order and processing program within 1 business day</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
                    <span>Your terminal is programmed with your merchant account and tested for 24 hours</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
                    <span>Terminal ships pre-configured — plug in and start accepting payments</span>
                  </li>
                </ol>
              </div>
              <div className="flex gap-4 justify-center flex-wrap">
                <Link href="/" data-testid="link-back-home">
                  <Button variant="outline">Back to Home</Button>
                </Link>
                <Link href="/upload-statement" data-testid="link-upload-statement">
                  <Button className="gap-2">Upload Statement <ArrowRight className="w-4 h-4" /></Button>
                </Link>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Payment Terminals — Buy or Lease-Free Equipment"
        description="Shop payment terminals from Clover, Dejavoo, PAX, and SwipeSimple. No leases, no hidden fees. Buy outright or get free placement with a processing agreement."
        path="/shop"
        keywords="buy payment terminal, clover terminal, dejavoo qd4, pax a920, swipesimple, credit card machine, pos terminal"
        structuredData={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Payment Terminal Shop",
          description: "Shop payment terminals from Liberty Bancard",
          url: "https://libertybancard.com/shop",
        }}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <PromoBanner variant="bar" promoId="free-processing" showCountdown />

        {step === "browse" && !detail && (
          <>
            <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-16">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-2">
                  <div>
                    <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-shop-heading">
                      Payment Terminals & Equipment
                    </h1>
                    <p className="text-muted-foreground max-w-2xl" data-testid="text-shop-subheading">
                      No leases. No markup. Buy outright or get free placement with a processing agreement. Every terminal ships pre-configured and ready to accept payments.
                    </p>
                  </div>
                  {cartCount > 0 && (
                    <Button
                      onClick={() => setStep("cart")}
                      className="gap-2 shrink-0"
                      data-testid="button-view-cart"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      View Cart ({cartCount})
                    </Button>
                  )}
                </div>
              </div>
            </section>

            <section className="py-12">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {shopTerminals.map((terminal) => (
                    <Card key={terminal.id} className="flex flex-col overflow-hidden" data-testid={`card-shop-${terminal.id}`}>
                      <div className="bg-muted/30 p-6 flex items-center justify-center h-48 relative">
                        {terminal.popular && (
                          <Badge className="absolute top-3 right-3 bg-amber-500/10 text-amber-600 border-amber-500/20">
                            <Star className="w-3 h-3 mr-1" /> Popular
                          </Badge>
                        )}
                        <img
                          src={terminal.image}
                          alt={terminal.name}
                          className="max-h-36 w-auto object-contain"
                        />
                      </div>
                      <CardContent className="p-5 flex flex-col flex-1">
                        <Badge variant="outline" className="w-fit mb-2 text-xs">{terminal.brand}</Badge>
                        <h3 className="text-lg font-display font-bold text-foreground mb-1" data-testid={`text-shop-name-${terminal.id}`}>
                          {terminal.name}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-3 flex-1">{terminal.shortDescription}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mb-3">
                          {terminal.connectivity.map((c) => (
                            <Badge key={c} variant="secondary" className="text-xs gap-1">
                              {c === "Wi-Fi" ? <Wifi className="w-3 h-3" /> : c === "Bluetooth" ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                              {c}
                            </Badge>
                          ))}
                        </div>
                        <div className="border-t border-border pt-3 mt-auto">
                          <div className="flex items-end justify-between mb-3">
                            <div>
                              <p className="text-xl font-bold text-foreground">{terminal.priceLabel}</p>
                              <p className="text-xs text-muted-foreground">{terminal.monthlyFee}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => setSelectedTerminal(terminal.id)}
                              data-testid={`button-details-${terminal.id}`}
                            >
                              Details
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 gap-1.5"
                              onClick={() => addToCart(terminal.id)}
                              data-testid={`button-add-${terminal.id}`}
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              Add
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </section>

            <section className="bg-muted/30 py-12">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Shield className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">No Leases. Ever.</h3>
                      <p className="text-sm text-muted-foreground">We never lease equipment. Buy outright or qualify for free placement with your processing agreement.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Truck className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">24-Hour Setup & Testing</h3>
                      <p className="text-sm text-muted-foreground">Every terminal goes through 24 hours of hands-on setup and testing before shipping. We program your merchant account, test all payment types, and verify connectivity so it works on arrival.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Phone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Expert Setup Support</h3>
                      <p className="text-sm text-muted-foreground">Our team walks you through setup over the phone. Most merchants are processing within 24 hours of delivery.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="py-12">
              <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                <h2 className="text-xl font-display font-bold text-foreground mb-4 text-center" data-testid="text-active-promos-heading">
                  Current Promotions
                </h2>
                <PromoList />
              </div>
            </section>
          </>
        )}

        {step === "browse" && detail && (
          <section className="py-12">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <Button
                variant="ghost"
                className="gap-2 mb-6"
                onClick={() => setSelectedTerminal(null)}
                data-testid="button-back-browse"
              >
                <ArrowLeft className="w-4 h-4" /> Back to All Terminals
              </Button>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-muted/30 rounded-xl p-8 flex items-center justify-center">
                  <img src={detail.image} alt={detail.name} className="max-h-80 w-auto object-contain" />
                </div>

                <div>
                  <Badge variant="outline" className="mb-2">{detail.brand}</Badge>
                  {detail.popular && (
                    <Badge className="ml-2 bg-amber-500/10 text-amber-600 border-amber-500/20">
                      <Star className="w-3 h-3 mr-1" /> Popular
                    </Badge>
                  )}
                  <h1 className="text-3xl font-display font-bold text-foreground mb-1" data-testid="text-detail-name">
                    {detail.name}
                  </h1>
                  <p className="text-primary font-medium mb-4">{detail.tagline}</p>
                  <p className="text-muted-foreground mb-6">{detail.shortDescription}</p>

                  <div className="flex items-end gap-4 mb-6">
                    <div>
                      <p className="text-3xl font-bold text-foreground">{detail.priceLabel}</p>
                      <p className="text-sm text-muted-foreground">{detail.monthlyFee}</p>
                    </div>
                  </div>

                  <Button
                    size="lg"
                    className="gap-2 w-full sm:w-auto mb-6"
                    onClick={() => addToCart(detail.id)}
                    data-testid="button-detail-add"
                  >
                    <ShoppingCart className="w-4 h-4" /> Add to Cart
                  </Button>

                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-sm text-foreground mb-2">Highlights</h3>
                      <div className="grid grid-cols-2 gap-1.5">
                        {detail.highlights.map((h) => (
                          <div key={h} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                            {h}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-sm text-foreground mb-2">Specifications</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {detail.specs.map((s) => (
                          <div key={s.label} className="bg-muted/50 rounded-lg p-2.5">
                            <p className="text-xs text-muted-foreground">{s.label}</p>
                            <p className="text-sm font-medium text-foreground">{s.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-sm text-foreground mb-2">What's in the Box</h3>
                      <ul className="space-y-1">
                        {detail.includes.map((item) => (
                          <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h3 className="font-semibold text-sm text-foreground mb-2">Best For</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.bestFor.map((b) => (
                          <Badge key={b} variant="secondary" className="text-xs">{b}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {step === "cart" && (
          <section className="py-12">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
              <Button
                variant="ghost"
                className="gap-2 mb-6"
                onClick={() => setStep("browse")}
                data-testid="button-back-shop"
              >
                <ArrowLeft className="w-4 h-4" /> Continue Shopping
              </Button>

              <h1 className="text-2xl font-display font-bold text-foreground mb-6" data-testid="text-cart-heading">
                Your Cart ({cartCount} {cartCount === 1 ? "item" : "items"})
              </h1>

              {cart.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <ShoppingCart className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                    <p className="text-muted-foreground">Your cart is empty.</p>
                    <Button variant="outline" className="mt-4" onClick={() => setStep("browse")} data-testid="button-start-shopping">
                      Browse Terminals
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="space-y-4 mb-8">
                    {cart.map((item) => {
                      const t = shopTerminals.find((t) => t.id === item.terminalId)!;
                      return (
                        <Card key={item.terminalId} data-testid={`card-cart-${item.terminalId}`}>
                          <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-muted/30 rounded-lg flex items-center justify-center shrink-0">
                                  <img src={t.image} alt={t.name} className="max-h-10 sm:max-h-12 w-auto object-contain" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-foreground truncate">{t.name}</h3>
                                  <p className="text-sm text-muted-foreground">{t.brand} · {t.priceLabel}</p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between sm:justify-end gap-2">
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => updateQuantity(item.terminalId, -1)}
                                    data-testid={`button-qty-minus-${item.terminalId}`}
                                  >
                                    <Minus className="w-3 h-3" />
                                  </Button>
                                  <span className="w-8 text-center font-medium text-foreground" data-testid={`text-qty-${item.terminalId}`}>
                                    {item.quantity}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => updateQuantity(item.terminalId, 1)}
                                    data-testid={`button-qty-plus-${item.terminalId}`}
                                  >
                                    <Plus className="w-3 h-3" />
                                  </Button>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground"
                                  onClick={() => removeFromCart(item.terminalId)}
                                  data-testid={`button-remove-${item.terminalId}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  <Card className="mb-4">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Truck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                        <span><strong className="text-foreground">24-Hour Setup & Testing:</strong> Every terminal goes through hands-on configuration, payment testing, and connectivity verification before shipping. Expect shipment within 1-2 business days.</span>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="mb-6">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CreditCard className="w-4 h-4 shrink-0" />
                        <span>Final pricing confirmed by our team based on your processing program. No surprise charges.</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Button
                    size="lg"
                    className="w-full gap-2"
                    onClick={() => setStep("info")}
                    data-testid="button-proceed-checkout"
                  >
                    Proceed to Checkout <ArrowRight className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </section>
        )}

        {step === "info" && (
          <section className="py-12">
            <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8">
              <Button
                variant="ghost"
                className="gap-2 mb-6"
                onClick={() => setStep("cart")}
                data-testid="button-back-cart"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Cart
              </Button>

              <h1 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-checkout-heading">
                Complete Your Order
              </h1>
              <p className="text-muted-foreground mb-8">
                Enter your information below and our team will contact you to finalize pricing and arrange delivery.
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">First Name *</label>
                    <Input
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      placeholder="John"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Last Name</label>
                    <Input
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      placeholder="Smith"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Email *</label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="john@business.com"
                    data-testid="input-email"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Phone *</label>
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    data-testid="input-phone"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Business Name</label>
                  <Input
                    value={form.businessName}
                    onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                    placeholder="My Business LLC"
                    data-testid="input-business-name"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Notes or Questions</label>
                  <Textarea
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="Any specific requirements, questions about programs, or preferred delivery date..."
                    rows={3}
                    data-testid="input-message"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Promo Code</label>
                  <Input
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="Enter promo code (optional)"
                    data-testid="input-promo-code"
                  />
                </div>

                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-sm mb-3">Order Summary</h3>
                    {cart.map((item) => {
                      const t = shopTerminals.find((t) => t.id === item.terminalId)!;
                      return (
                        <div key={item.terminalId} className="flex justify-between text-sm py-1">
                          <span className="text-muted-foreground">{t.name} × {item.quantity}</span>
                          <span className="text-foreground font-medium">{t.priceLabel}</span>
                        </div>
                      );
                    })}
                    <div className="border-t border-border mt-2 pt-2 space-y-1">
                      <p className="text-xs text-muted-foreground">Final pricing confirmed after review. No payment collected now.</p>
                      <div className="flex items-center gap-1.5 text-xs text-primary">
                        <Truck className="w-3 h-3" />
                        <span>24-hour setup & testing before shipment</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Button
                  size="lg"
                  className="w-full gap-2"
                  onClick={handleSubmit}
                  disabled={submitting}
                  data-testid="button-submit-order"
                >
                  {submitting ? "Submitting..." : "Submit Order Request"}
                  {!submitting && <ArrowRight className="w-4 h-4" />}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  By submitting, you agree to our{" "}
                  <Link href="/terms" className="underline">Terms of Service</Link>{" "}
                  and{" "}
                  <Link href="/privacy-policy" className="underline">Privacy Policy</Link>.
                  No payment is collected at this time.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
