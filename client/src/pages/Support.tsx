import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Loader2,
  Clock,
  Mail,
  UserCheck,
} from "lucide-react";

const supportSchema = z.object({
  name: z.string().min(1, "Your name is required"),
  businessName: z.string().min(1, "Business name is required"),
  email: z.string().email("Valid email is required"),
  mobile: z.string().min(10, "Valid mobile number is required"),
  issueType: z.string().min(1, "Please select an issue type"),
  priority: z.string().min(1, "Please select a priority"),
  message: z.string().min(1, "Please describe your issue"),
  fileName: z.string().optional(),
  consentSms: z.boolean().refine((v) => v === true, {
    message: "You must consent to receive communications",
  }),
});

type SupportFormData = z.infer<typeof supportSchema>;

export default function Support() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<SupportFormData>({
    resolver: zodResolver(supportSchema),
    defaultValues: {
      name: "",
      businessName: "",
      email: "",
      mobile: "",
      issueType: "",
      priority: "Normal",
      message: "",
      fileName: "",
      consentSms: false,
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: SupportFormData) => {
      const res = await apiRequest("POST", "/api/public/support", {
        name: data.name,
        businessName: data.businessName,
        email: data.email,
        mobile: data.mobile,
        issueType: data.issueType,
        priority: data.priority,
        message: data.message,
        consentSms: data.consentSms,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Request Submitted",
        description: "We received your support request and will follow up shortly.",
      });
      setLocation("/thanks-support");
    },
    onError: (error: Error) => {
      toast({
        title: "Submission Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SupportFormData) => {
    submitMutation.mutate(data);
  };

  const issueTypes = [
    "Funding / Deposits",
    "Terminal",
    "Chargeback / Dispute",
    "PCI Compliance",
    "Other",
  ];

  const priorities = ["Normal", "Urgent"];

  const expectItems = [
    {
      icon: Clock,
      text: "We'll review your request and reply within 4 business hours (urgent: 1 hour).",
    },
    {
      icon: Mail,
      text: "You'll get a confirmation by text/email.",
    },
    {
      icon: UserCheck,
      text: "A real person - not a ticket loop - will follow up.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow pt-28 pb-16">
        <section className="bg-background py-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h1
                className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
                data-testid="text-support-heading"
              >
                Get Help From a Real Person
              </h1>
              <p
                className="text-lg text-muted-foreground max-w-xl mx-auto"
                data-testid="text-support-subheadline"
              >
                Terminal issues, deposit questions, chargeback deadlines, PCI compliance - we're here.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card data-testid="card-support-form">
              <CardContent className="pt-6">
                <h2
                  className="text-2xl font-bold text-foreground mb-6"
                  data-testid="text-support-form-title"
                >
                  Submit a Support Request
                </h2>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                    data-testid="form-support"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Your Name</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Your full name"
                                data-testid="input-name"
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
                        name="mobile"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mobile Number</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="(555) 123-4567"
                                data-testid="input-mobile"
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
                        name="issueType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Issue Type</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-issue-type">
                                  <SelectValue placeholder="Select issue type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {issueTypes.map((type) => (
                                  <SelectItem
                                    key={type}
                                    value={type}
                                    data-testid={`select-item-${type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                  >
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="priority"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Priority</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-priority">
                                  <SelectValue placeholder="Select priority" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {priorities.map((p) => (
                                  <SelectItem
                                    key={p}
                                    value={p}
                                    data-testid={`select-item-${p.toLowerCase()}`}
                                  >
                                    {p}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="message"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Describe your issue</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Tell us what's going on..."
                              className="resize-none"
                              rows={5}
                              data-testid="textarea-message"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="fileName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Upload supporting file (optional)</FormLabel>
                          <FormControl>
                            <Input
                              type="file"
                              data-testid="input-file"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                field.onChange(file?.name || "");
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="consentSms"
                      render={({ field }) => (
                        <FormItem className="flex items-start gap-3">
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
                      data-testid="button-support-submit"
                    >
                      {submitMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Submitting...
                        </>
                      ) : (
                        "Submit Support Request"
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-what-happens-after">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              className="text-2xl font-bold text-foreground text-center mb-8"
              data-testid="text-what-happens-after"
            >
              What Happens After You Submit
            </h2>
            <div className="space-y-4">
              {expectItems.map((item) => (
                <div
                  key={item.text}
                  className="flex items-start gap-4"
                  data-testid={`expect-item-${item.text.substring(0, 20).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <item.icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-muted-foreground text-sm">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
