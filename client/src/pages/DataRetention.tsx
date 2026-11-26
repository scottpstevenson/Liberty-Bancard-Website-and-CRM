import { DataRetentionContent, dataRetentionSeo } from "@/components/PublicPolicyContent";
import { useRef, useState } from "react";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { trackPhoneCallClick } from "@/lib/analytics";

const deleteRequestSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Valid email is required"),
  requestType: z.string().min(1, "Request type is required"),
  description: z.string().optional(),
});

type DeleteRequestForm = z.infer<typeof deleteRequestSchema>;

export default function DataRetention() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const requestKey = useRef<string | null>(null);

  const form = useForm<z.input<typeof deleteRequestSchema>, unknown, DeleteRequestForm>({
    resolver: zodResolver(deleteRequestSchema),
    defaultValues: {
      fullName: "",
      email: "",
      requestType: "",
      description: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: DeleteRequestForm) => {
      requestKey.current ??= crypto.randomUUID();
      try {
        await apiRequest("POST", "/api/data-requests", data, { "Idempotency-Key": requestKey.current });
      } catch (error) {
        // apiRequest throws on a server answer (rotate: the next submit is a new request) and on network failure
        // (keep: the retry replays). A server answer carries an HTTP status prefix.
        if (error instanceof Error && /^\d{3}:/.test(error.message)) requestKey.current = null;
        throw error;
      }
    },
    onSuccess: () => {
      requestKey.current = null;
      setSubmitted(true);
      toast({ title: "Request received", description: "Our team will review it and contact you at the email address provided." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: DeleteRequestForm) => {
    mutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO {...dataRetentionSeo} />
      <Navbar />
      <main className="flex-grow pt-16">
        <DataRetentionContent
          onPhoneClick={() => trackPhoneCallClick({ sourcePage: dataRetentionSeo.path })}
          requestForm={submitted ? (
            <Card data-testid="card-request-success">
              <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                <CheckCircle className="w-10 h-10 text-green-600" />
                <h3 className="text-lg font-semibold text-foreground" data-testid="text-request-success">
                  Request received
                </h3>
                <p className="text-muted-foreground" data-testid="text-request-success-desc">
                  We have recorded your data request. It is received, not yet verified or completed. Our team will review it and contact you at the email address provided; we may ask you to confirm your identity first.
                </p>
                <Button variant="outline" className="min-h-11" onClick={() => { setSubmitted(false); form.reset(); }} data-testid="button-submit-another">
                  Submit Another Request
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="card-request-form">
              <CardContent className="pt-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input className="min-h-11" placeholder="Your full name" {...field} data-testid="input-request-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input className="min-h-11" type="email" placeholder="you@example.com" {...field} data-testid="input-request-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="requestType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Request Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="min-h-11" data-testid="select-request-type">
                                <SelectValue placeholder="Select request type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Delete My Data" data-testid="option-delete">Delete My Data</SelectItem>
                              <SelectItem value="Access My Data" data-testid="option-access">Access My Data</SelectItem>
                              <SelectItem value="Correct My Data" data-testid="option-correct">Correct My Data</SelectItem>
                              <SelectItem value="Data Portability" data-testid="option-portability">Data Portability</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (optional)</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Provide additional details about your request..." {...field} data-testid="input-request-description" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="min-h-11" disabled={mutation.isPending} data-testid="button-submit-request">
                      {mutation.isPending ? "Submitting..." : "Submit Request"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}
        />
      </main>
      <Footer />
    </div>
  );
}
