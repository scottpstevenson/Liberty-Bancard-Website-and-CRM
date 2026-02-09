import { useLocation } from "wouter";
import { Link } from "wouter";
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
import { Loader2, Calculator } from "lucide-react";

const estimateSchema = z.object({
  contactName: z.string().min(1, "Contact name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  monthlyVolume: z.string().min(1, "Monthly volume is required"),
  totalFees: z.string().min(1, "Total fees is required"),
  currentProvider: z.string().optional(),
  notes: z.string().optional(),
});

type EstimateFormData = z.infer<typeof estimateSchema>;

export default function Estimate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<EstimateFormData>({
    resolver: zodResolver(estimateSchema),
    defaultValues: {
      contactName: "",
      email: "",
      phone: "",
      monthlyVolume: "",
      totalFees: "",
      currentProvider: "",
      notes: "",
    },
  });

  const monthlyVolume = parseFloat(form.watch("monthlyVolume") || "0");
  const totalFees = parseFloat(form.watch("totalFees") || "0");
  const effectiveRate =
    monthlyVolume > 0 ? ((totalFees / monthlyVolume) * 100).toFixed(2) : null;

  const submitMutation = useMutation({
    mutationFn: async (data: EstimateFormData) => {
      const res = await apiRequest("POST", "/api/public/estimate", {
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        monthlyVolume: data.monthlyVolume,
        totalFees: data.totalFees,
        currentProvider: data.currentProvider,
        notes: data.notes,
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
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow pt-32 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1
              className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
              data-testid="text-estimate-heading"
            >
              Effective Rate Estimate
            </h1>
            <p
              className="text-lg text-muted-foreground max-w-xl mx-auto"
              data-testid="text-estimate-subheadline"
            >
              Get a quick estimate of your effective processing rate without
              uploading a statement. Just enter your numbers and we will do the
              math.
            </p>
          </div>

          {effectiveRate !== null && monthlyVolume > 0 && totalFees > 0 && (
            <Card className="mb-8" data-testid="card-effective-rate">
              <CardContent className="pt-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Calculator className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Your Estimated Effective Rate
                  </span>
                </div>
                <p
                  className="text-4xl font-bold text-primary"
                  data-testid="text-effective-rate-value"
                >
                  {effectiveRate}%
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Based on ${totalFees.toLocaleString()} in fees on $
                  {monthlyVolume.toLocaleString()} monthly volume
                </p>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-estimate-form">
            <CardHeader>
              <CardTitle data-testid="text-estimate-form-title">
                Enter Your Numbers
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
                        <FormLabel>Contact Name *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Your full name"
                            data-testid="input-contact-name"
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
                          <FormLabel>Email *</FormLabel>
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
                          <FormLabel>Phone *</FormLabel>
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="monthlyVolume"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Monthly Volume ($) *</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="e.g. 50000"
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
                          <FormLabel>Total Processing Fees ($) *</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="e.g. 1500"
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
                            placeholder="e.g. Square, Stripe, Clover, etc."
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
                        <FormLabel>Notes (optional)</FormLabel>
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

          <p
            className="text-[10px] text-muted-foreground text-center mt-8"
            data-testid="text-compliance-microline"
          >
            Eligibility, underwriting, card brand rules, and applicable laws
            apply. No savings claims without statement review.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
