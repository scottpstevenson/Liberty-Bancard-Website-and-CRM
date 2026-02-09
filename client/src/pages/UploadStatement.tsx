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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  UploadCloud,
  FileText,
  ShieldCheck,
  Clock,
  FileSearch,
  Calendar,
  Loader2,
  CheckCircle,
} from "lucide-react";

const uploadSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  contactName: z.string().min(1, "Contact name is required"),
  email: z.string().email("Valid email is required"),
  mobile: z.string().min(10, "Valid mobile number is required"),
  vertical: z.string().min(1, "Please select a vertical"),
  fileName: z.string().optional(),
  currentProvider: z.string().optional(),
  interestedIn0Percent: z.string().default("no"),
  needTerminal: z.string().default("no"),
  notes: z.string().optional(),
  consentSms: z.boolean().refine((v) => v === true, {
    message: "You must agree to receive communications",
  }),
});

type UploadFormData = z.infer<typeof uploadSchema>;

export default function UploadStatement() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [droppedFileName, setDroppedFileName] = useState<string>("");

  const form = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      businessName: "",
      contactName: "",
      email: "",
      mobile: "",
      vertical: "",
      fileName: "",
      currentProvider: "",
      interestedIn0Percent: "no",
      needTerminal: "no",
      notes: "",
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
    accept: {
      "application/pdf": [".pdf"],
      "image/*": [".png", ".jpg", ".jpeg"],
    },
    maxFiles: 1,
  });

  const submitMutation = useMutation({
    mutationFn: async (data: UploadFormData) => {
      const res = await apiRequest("POST", "/api/public/statement-upload", {
        businessName: data.businessName,
        contactName: data.contactName,
        email: data.email,
        mobile: data.mobile,
        vertical: data.vertical,
        currentProvider: data.currentProvider,
        interestedIn0Percent: data.interestedIn0Percent === "yes",
        needTerminal: data.needTerminal === "yes",
        notes: data.notes,
        consentSms: data.consentSms,
      });
      return res.json();
    },
    onSuccess: () => {
      setLocation("/thanks-statement");
    },
    onError: (error: Error) => {
      toast({
        title: "Submission Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UploadFormData) => {
    submitMutation.mutate(data);
  };

  const verticals = [
    "Medical/Dental/Medspa",
    "Automotive",
    "Restaurant",
    "Home Services",
    "Retail",
    "Other",
  ];

  const trustBullets = [
    {
      icon: FileSearch,
      title: "Written breakdown you keep",
      description:
        "You get a clear, line-by-line breakdown of your current costs that is yours to keep regardless.",
    },
    {
      icon: ShieldCheck,
      title: "Proof-first, no pressure",
      description:
        "We show you the math before asking for anything. No obligation, no hard sell.",
    },
    {
      icon: Clock,
      title: "Fast turnaround during business hours",
      description:
        "Most reviews are completed within a few hours during normal business days.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow pt-32 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1
              className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
              data-testid="text-upload-heading"
            >
              Upload Your Statement (Secure)
            </h1>
            <p
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
              data-testid="text-upload-subheadline"
            >
              PDF or photo. Redact account numbers if you want - totals + fee
              lines are all we need.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {trustBullets.map((bullet) => (
              <Card key={bullet.title} data-testid={`card-trust-${bullet.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
                  <bullet.icon className="w-8 h-8 text-primary" />
                  <h3 className="font-semibold text-foreground">
                    {bullet.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {bullet.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card data-testid="card-upload-form">
            <CardHeader>
              <CardTitle data-testid="text-form-title">
                Statement Upload Form
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-6"
                  data-testid="form-upload-statement"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                  <FormField
                    control={form.control}
                    name="vertical"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vertical *</FormLabel>
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
                              <SelectItem
                                key={v}
                                value={v}
                                data-testid={`select-item-${v.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                              >
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <Label className="text-sm font-medium mb-2 block">
                      Upload Statement
                    </Label>
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
                        isDragActive
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                      data-testid="dropzone-statement"
                    >
                      <input {...getInputProps()} data-testid="input-file" />
                      <UploadCloud className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
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
                        <div>
                          <p className="text-sm text-foreground font-medium mb-1">
                            {isDragActive
                              ? "Drop your file here"
                              : "Click or drag your statement here"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            PDF, JPG, or PNG accepted
                          </p>
                        </div>
                      )}
                    </div>
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="interestedIn0Percent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Interested in 0% Processing?</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="flex gap-4"
                              data-testid="radio-interested-0-percent"
                            >
                              <div className="flex items-center gap-2">
                                <RadioGroupItem
                                  value="yes"
                                  id="zero-yes"
                                  data-testid="radio-0-percent-yes"
                                />
                                <Label htmlFor="zero-yes">Yes</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <RadioGroupItem
                                  value="no"
                                  id="zero-no"
                                  data-testid="radio-0-percent-no"
                                />
                                <Label htmlFor="zero-no">No</Label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="needTerminal"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Need a Terminal?</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="flex gap-4"
                              data-testid="radio-need-terminal"
                            >
                              <div className="flex items-center gap-2">
                                <RadioGroupItem
                                  value="yes"
                                  id="terminal-yes"
                                  data-testid="radio-terminal-yes"
                                />
                                <Label htmlFor="terminal-yes">Yes</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <RadioGroupItem
                                  value="no"
                                  id="terminal-no"
                                  data-testid="radio-terminal-no"
                                />
                                <Label htmlFor="terminal-no">No</Label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes (optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What are you trying to fix?"
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
                            about your statement review. Reply STOP to opt out.
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
                    data-testid="button-upload-submit"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Submitting...
                      </>
                    ) : (
                      "Upload My Statement"
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
              <Card data-testid="card-step-1">
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto text-lg font-bold">
                    1
                  </div>
                  <h3 className="font-semibold text-foreground">
                    Confirmation
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    We confirm we received your file (SMS/email)
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-step-2">
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto text-lg font-bold">
                    2
                  </div>
                  <h3 className="font-semibold text-foreground">Analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    We calculate your effective rate and identify cost drivers
                    line-by-line
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-step-3">
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto text-lg font-bold">
                    3
                  </div>
                  <h3 className="font-semibold text-foreground">Options</h3>
                  <p className="text-sm text-muted-foreground">
                    We send you 2-3 clear options with apples-to-apples math
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

          <div
            className="mt-10 text-center"
            data-testid="section-secondary-cta"
          >
            <p className="text-muted-foreground mb-3">
              Prefer to Talk First?
            </p>
            <Link href="#">
              <Button variant="outline" className="gap-2" data-testid="button-book-call">
                <Calendar className="w-4 h-4" />
                Book a 10-Minute Call
              </Button>
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
