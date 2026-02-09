import { useLocation, Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Upload, ArrowRight } from "lucide-react";

const estimateSchema = z.object({
  contactName: z.string().min(1, "Your name is required"),
  businessName: z.string().min(1, "Business name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid mobile number is required"),
  vertical: z.string().min(1, "Industry / Vertical is required"),
  monthlyVolume: z.string().min(1, "Monthly processing volume is required"),
  totalFees: z.string().min(1, "Total processing fees is required"),
  currentProvider: z.string().optional(),
  notes: z.string().optional(),
  consent: z.boolean().refine((val) => val === true, {
    message: "You must consent to receive communications",
  }),
});

type EstimateFormData = z.infer<typeof estimateSchema>;

const verticals = [
  "Medical/Dental/Medspa",
  "Automotive",
  "Restaurant",
  "Home Services",
  "Retail",
  "Other",
];

export default function Estimate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<EstimateFormData>({
    resolver: zodResolver(estimateSchema),
    defaultValues: {
      contactName: "",
      businessName: "",
      email: "",
      phone: "",
      vertical: "",
      monthlyVolume: "",
      totalFees: "",
      currentProvider: "",
      notes: "",
      consent: false,
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: EstimateFormData) => {
      const res = await apiRequest("POST", "/api/public/estimate", {
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        monthlyVolume: data.monthlyVolume,
        totalFees: data.totalFees,
        currentProvider: data.currentProvider || undefined,
        notes: data.notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setLocation("/thanks-estimate");
    },
    onError: (error: Error) => {
      toast({
        title: "Submission Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EstimateFormData) => {
    submitMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="bg-background py-20 lg:py-28" data-testid="section-estimate-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1
              className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight mb-6"
              data-testid="text-estimate-heading"
            >
              Get a Fast Effective Rate Estimate
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-6"
              data-testid="text-estimate-subheadline"
            >
              Share monthly volume and total fees. We'll estimate your effective rate and recommend next steps. For a definitive comparison, upload a statement anytime.
            </p>
            <Link
              href="/upload-statement"
              className="text-sm font-medium text-primary hover:underline"
              data-testid="link-upload-instead"
            >
              Upload a Statement Instead
            </Link>
          </div>
        </section>

        <section className="bg-muted py-20" data-testid="section-estimate-form">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card data-testid="card-estimate-form">
              <CardHeader>
                <CardTitle data-testid="text-estimate-form-title">
                  Get My Estimate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                    data-testid="form-estimate"
                  >
                    <FormField
                      control={form.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Full name"
                              data-testid="input-contact-name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Your business name"
                              data-testid="input-business-name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder="you@business.com"
                                data-testid="input-email"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mobile Number</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="(555) 123-4567"
                                data-testid="input-phone"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="vertical"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Industry / Vertical</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-vertical">
                                <SelectValue placeholder="Select your industry" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {verticals.map((v) => (
                                <SelectItem key={v} value={v} data-testid={`select-vertical-${v.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                                  {v}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="monthlyVolume"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Monthly Processing Volume ($)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="e.g. 18000"
                                data-testid="input-monthly-volume"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="totalFees"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Processing Fees ($)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="e.g. 450"
                                data-testid="input-total-fees"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="currentProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Provider (optional)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Square, Stripe, Clover"
                              data-testid="input-current-provider"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Anything you want us to focus on? (optional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Any additional details..."
                              className="resize-none"
                              rows={3}
                              data-testid="textarea-notes"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="consent"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-consent"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="text-sm font-normal text-muted-foreground">
                              I consent to receive text/email communications from Liberty Bancard.
                            </FormLabel>
                            <FormMessage />
                          </div>
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={submitMutation.isPending}
                      data-testid="button-estimate-submit"
                    >
                      {submitMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Submitting...
                        </>
                      ) : (
                        "Get My Estimate"
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="bg-background py-20" data-testid="section-effective-rate-education">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6"
              data-testid="text-effective-rate-heading"
            >
              What Is an Effective Rate?
            </h2>
            <div className="space-y-4 mb-6">
              <p className="text-muted-foreground" data-testid="text-effective-rate-intro">
                Your effective rate is the simplest reality check:
              </p>
              <p className="text-foreground font-medium" data-testid="text-effective-rate-formula">
                Effective rate = total fees divided by total volume.
              </p>
              <p className="text-muted-foreground" data-testid="text-effective-rate-example">
                Example: $450 in fees on $18,000 volume = 2.5% effective rate.
              </p>
            </div>
            <p
              className="text-sm text-muted-foreground mb-6"
              data-testid="text-effective-rate-microcopy"
            >
              For the exact line-item breakdown (and to identify the cost drivers), upload a statement.
            </p>
            <Link href="/upload-statement" data-testid="link-education-upload-statement">
              <Button className="gap-2">
                <Upload className="w-4 h-4" />
                Upload Statement (Exact Breakdown)
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
