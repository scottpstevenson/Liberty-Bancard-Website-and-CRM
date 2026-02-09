import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCreateContact } from "@/hooks/use-contacts";
import { ArrowLeft, ArrowRight, Loader2, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const steps = [
  { id: 1, title: "Industry" },
  { id: 2, title: "Volume" },
  { id: 3, title: "Needs" },
  { id: 4, title: "Contact" }
];

const formSchema = z.object({
  vertical: z.string().min(1, "Required"),
  monthlyVolume: z.string().min(1, "Required"),
  primaryOfferPath: z.string().min(1, "Required"),
  firstName: z.string().min(2, "Name too short"),
  lastName: z.string().min(2, "Name too short"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(10, "Invalid phone"),
  companyName: z.string().min(1, "Company required"),
});

type FormData = z.infer<typeof formSchema>;

export default function GetStarted() {
  const [currentStep, setCurrentStep] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createContact = useCreateContact();
  
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      vertical: "",
      monthlyVolume: "",
      primaryOfferPath: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      companyName: "",
    }
  });

  const onSubmit = async (data: FormData) => {
    try {
      await createContact.mutateAsync({
        ...data,
        interestedIn0Percent: data.primaryOfferPath === "0% Processing",
        needTerminal: false,
        status: "New"
      });
      
      toast({
        title: "Application Received!",
        description: "One of our specialists will reach out shortly.",
      });
      
      // Redirect to home or dashboard after delay
      setTimeout(() => setLocation("/"), 2000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const nextStep = async () => {
    // Basic validation per step could go here
    if (currentStep === 1 && !form.getValues("vertical")) return;
    if (currentStep === 2 && !form.getValues("monthlyVolume")) return;
    if (currentStep === 3 && !form.getValues("primaryOfferPath")) return;
    
    setCurrentStep(prev => Math.min(prev + 1, 4));
  };

  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-display font-bold text-primary mb-2">Let's build your profile</h1>
          <p className="text-muted-foreground">Answer a few questions to find the perfect payment solution.</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted rounded-full h-2 mb-8 overflow-hidden">
          <motion.div 
            className="h-full bg-accent"
            initial={{ width: "0%" }}
            animate={{ width: `${(currentStep / steps.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <Card className="border-border shadow-xl">
          <CardContent className="p-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)}>
                <AnimatePresence mode="wait">
                  {currentStep === 1 && (
                    <motion.div
                      key="step1"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <h2 className="text-xl font-bold">What industry are you in?</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {["Retail", "Restaurant", "E-Commerce", "Professional Services", "Healthcare", "Other"].map((option) => (
                          <div 
                            key={option}
                            onClick={() => form.setValue("vertical", option)}
                            className={`
                              p-4 rounded-xl border cursor-pointer transition-all
                              ${form.watch("vertical") === option 
                                ? "border-accent bg-accent/5 ring-2 ring-accent ring-offset-2" 
                                : "border-border hover:border-accent/50 hover:bg-muted/50"}
                            `}
                          >
                            <div className="font-semibold">{option}</div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {currentStep === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <h2 className="text-xl font-bold">What is your monthly processing volume?</h2>
                      <div className="grid grid-cols-1 gap-4">
                        {["Less than $10,000", "$10,000 - $50,000", "$50,000 - $100,000", "$100,000+"].map((option) => (
                          <div 
                            key={option}
                            onClick={() => form.setValue("monthlyVolume", option)}
                            className={`
                              p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between
                              ${form.watch("monthlyVolume") === option 
                                ? "border-accent bg-accent/5 ring-2 ring-accent ring-offset-2" 
                                : "border-border hover:border-accent/50 hover:bg-muted/50"}
                            `}
                          >
                            <span className="font-semibold">{option}</span>
                            {form.watch("monthlyVolume") === option && <CheckCircle className="w-5 h-5 text-accent" />}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {currentStep === 3 && (
                    <motion.div
                      key="step3"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <h2 className="text-xl font-bold">What solution interests you most?</h2>
                      <div className="grid grid-cols-1 gap-4">
                        {[
                          { val: "0% Processing", desc: "Eliminate fees by passing them to customers" },
                          { val: "Standard Interchange", desc: "Traditional low-rate processing" },
                          { val: "Hardware Only", desc: "I just need new terminals" }
                        ].map((option) => (
                          <div 
                            key={option.val}
                            onClick={() => form.setValue("primaryOfferPath", option.val)}
                            className={`
                              p-4 rounded-xl border cursor-pointer transition-all
                              ${form.watch("primaryOfferPath") === option.val 
                                ? "border-accent bg-accent/5 ring-2 ring-accent ring-offset-2" 
                                : "border-border hover:border-accent/50 hover:bg-muted/50"}
                            `}
                          >
                            <div className="font-bold">{option.val}</div>
                            <div className="text-sm text-muted-foreground">{option.desc}</div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {currentStep === 4 && (
                    <motion.div
                      key="step4"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <h2 className="text-xl font-bold">Final Details</h2>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="firstName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>First Name</FormLabel>
                              <FormControl><Input {...field} placeholder="Jane" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="lastName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Last Name</FormLabel>
                              <FormControl><Input {...field} placeholder="Doe" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={form.control}
                        name="companyName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Company Name</FormLabel>
                            <FormControl><Input {...field} placeholder="Acme Inc." /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl><Input {...field} type="email" placeholder="jane@acme.com" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone</FormLabel>
                              <FormControl><Input {...field} placeholder="(555) 123-4567" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex justify-between mt-8 pt-6 border-t border-border">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={prevStep} 
                    disabled={currentStep === 1}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  
                  {currentStep < 4 ? (
                    <Button type="button" onClick={nextStep} className="bg-primary hover:bg-primary/90">
                      Next
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  ) : (
                    <Button type="submit" className="bg-accent hover:bg-accent/90" disabled={createContact.isPending}>
                      {createContact.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : "Submit Application"}
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
