import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { useDropzone } from "react-dropzone";
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
import {
  Phone,
  Loader2,
  UploadCloud,
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";

const supportSchema = z.object({
  name: z.string().min(1, "Name is required"),
  businessName: z.string().min(1, "Business name is required"),
  email: z.string().email("Valid email is required"),
  mobile: z.string().min(10, "Valid mobile number is required"),
  issueType: z.string().min(1, "Please select an issue type"),
  priority: z.string().min(1, "Please select a priority"),
  message: z.string().min(1, "Message is required"),
  fileName: z.string().optional(),
  consentSms: z.boolean().refine((v) => v === true, {
    message: "You must agree to receive communications",
  }),
});

type SupportFormData = z.infer<typeof supportSchema>;

export default function Support() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [droppedFileName, setDroppedFileName] = useState<string>("");

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

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const name = acceptedFiles[0].name;
        setDroppedFileName(name);
        form.setValue("fileName", name);
      }
    },
    [form],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
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
    "Funding/Deposits",
    "Terminal",
    "Chargeback/Dispute",
    "PCI",
    "Other",
  ];

  const priorities = ["Normal", "Urgent"];

  const scrollToForm = () => {
    document.getElementById("support-form")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow pt-32 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1
              className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
              data-testid="text-support-heading"
            >
              Support That Actually Answers.
            </h1>
            <p
              className="text-lg text-muted-foreground max-w-xl mx-auto mb-6"
              data-testid="text-support-subheadline"
            >
              Tell us what's going on and we'll route it to the right person.
              For urgent issues, call/text us directly.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button
                onClick={scrollToForm}
                data-testid="button-scroll-to-form"
              >
                Submit Support Request
              </Button>
              <a href="tel:9542668214" data-testid="link-call-support">
                <Button variant="outline" className="gap-2">
                  <Phone className="w-4 h-4" />
                  Call/Text 954-266-8214
                </Button>
              </a>
            </div>
          </div>

          <Card id="support-form" data-testid="card-support-form">
            <CardHeader>
              <CardTitle data-testid="text-support-form-title">
                Support Request
              </CardTitle>
            </CardHeader>
            <CardContent>
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
                          <FormLabel>Name *</FormLabel>
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
                          <FormLabel>Business Name *</FormLabel>
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
                      name="mobile"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mobile *</FormLabel>
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
                          <FormLabel>Issue Type *</FormLabel>
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
                          <FormLabel>Priority *</FormLabel>
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
                        <FormLabel>Message *</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe your issue in detail..."
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

                  <div>
                    <FormLabel className="text-sm font-medium mb-2 block">
                      Attachment (optional)
                    </FormLabel>
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
                        isDragActive
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                      data-testid="dropzone-support"
                    >
                      <input {...getInputProps()} data-testid="input-file" />
                      {droppedFileName ? (
                        <div className="flex items-center justify-center gap-2">
                          <FileText className="w-5 h-5 text-primary" />
                          <span
                            className="text-sm font-medium text-foreground"
                            data-testid="text-file-name"
                          >
                            {droppedFileName}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <UploadCloud className="w-8 h-8 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            Click or drag a file here (optional)
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

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
                            By submitting, you agree to receive texts/emails
                            about your support request. Reply STOP to opt out.
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
                        Sending...
                      </>
                    ) : (
                      "Send to Support"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <div className="mt-16" data-testid="section-what-happens-next">
            <h2 className="text-2xl font-bold text-foreground text-center mb-8">
              What Happens Next
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="card-next-step-1">
                <CardContent className="pt-6 text-center space-y-3">
                  <CheckCircle className="w-8 h-8 text-primary mx-auto" />
                  <h3 className="font-semibold text-foreground">
                    Confirmation
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    You will receive a confirmation that your request has been
                    received and assigned.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-next-step-2">
                <CardContent className="pt-6 text-center space-y-3">
                  <Clock className="w-8 h-8 text-primary mx-auto" />
                  <h3 className="font-semibold text-foreground">
                    Business Hours Response
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Our team responds during business hours, typically within a
                    few hours of submission.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-next-step-3">
                <CardContent className="pt-6 text-center space-y-3">
                  <AlertTriangle className="w-8 h-8 text-primary mx-auto" />
                  <h3 className="font-semibold text-foreground">
                    Urgent Issues
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    For urgent matters, call or text 954-266-8214 directly for
                    the fastest response.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

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
