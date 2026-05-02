import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  CreditCard, CheckCircle2, XCircle, Loader2, RefreshCw, Lock, Terminal, AlertTriangle,
} from "lucide-react";

interface VTTransaction {
  id: number;
  gatewayTransactionId: string | null;
  authCode: string | null;
  status: string;
  amount: string;
  refundedAmount: string | null;
  cardType: string | null;
  lastFour: string | null;
  cardholderName: string | null;
  billingZip: string | null;
  memo: string | null;
  responseCode: string | null;
  responseText: string | null;
  processedBy: string | null;
  createdAt: string;
}

interface ChargeResult {
  transaction: VTTransaction;
  approved: boolean;
  authCode: string | null;
  gatewayTransactionId: string | null;
  responseCode: string | null;
  responseText: string;
  sandboxMode: boolean;
}

function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]);
    if (isEven) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

function detectCardBrand(num: string): { brand: string; icon: string; cvvLen: number } {
  const n = num.replace(/\D/g, "");
  if (/^4/.test(n)) return { brand: "Visa", icon: "💳", cvvLen: 3 };
  if (/^(5[1-5]|2[2-7])/.test(n)) return { brand: "Mastercard", icon: "💳", cvvLen: 3 };
  if (/^3[47]/.test(n)) return { brand: "Amex", icon: "💳", cvvLen: 4 };
  if (/^(6011|622|64[4-9]|65)/.test(n)) return { brand: "Discover", icon: "💳", cvvLen: 3 };
  return { brand: "", icon: "💳", cvvLen: 3 };
}

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 19);
  if (/^3[47]/.test(digits)) {
    return digits.replace(/(\d{4})(\d{6})(\d{0,5})/, (_, a, b, c) => [a, b, c].filter(Boolean).join(" "));
  }
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

function statusBadge(status: string) {
  switch (status) {
    case "approved": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Approved</Badge>;
    case "declined": return <Badge variant="destructive">Declined</Badge>;
    case "refunded": return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Refunded</Badge>;
    case "partially_refunded": return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Partial Refund</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function cardTypeLabel(type: string | null): string {
  switch (type) {
    case "visa": return "Visa";
    case "mastercard": return "Mastercard";
    case "amex": return "Amex";
    case "discover": return "Discover";
    default: return type || "—";
  }
}

const chargeSchema = z.object({
  cardholderName: z.string().min(2, "Cardholder name is required"),
  cardNumber: z.string().min(13, "Card number is required"),
  expiry: z.string().regex(/^\d{2}\/\d{2,4}$/, "Expiry must be MM/YY"),
  cvv: z.string().min(3, "CVV is required").max(4),
  billingZip: z.string().min(3, "Billing ZIP is required"),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount like 50.00"),
  memo: z.string().optional(),
});

type ChargeForm = z.infer<typeof chargeSchema>;

export default function VirtualTerminal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ChargeResult | null>(null);
  const [refundDialog, setRefundDialog] = useState<{ txn: VTTransaction; open: boolean } | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [cardRaw, setCardRaw] = useState("");

  const isAuthorized =
    user?.role === "admin" ||
    user?.role === "manager" ||
    (user?.permissions ?? []).includes("virtual_terminal");

  const { data: transactions, isLoading: txLoading } = useQuery<VTTransaction[]>({
    queryKey: ["/api/virtual-terminal/transactions"],
    enabled: isAuthorized,
    refetchInterval: 30000,
  });

  const form = useForm<ChargeForm>({
    resolver: zodResolver(chargeSchema),
    defaultValues: {
      cardholderName: "",
      cardNumber: "",
      expiry: "",
      cvv: "",
      billingZip: "",
      amount: "",
      memo: "",
    },
  });

  const cardBrand = detectCardBrand(cardRaw);

  const chargeMutation = useMutation({
    mutationFn: async (data: ChargeForm) => {
      const [expMonth, expYear] = data.expiry.split("/");
      const cardDigits = data.cardNumber.replace(/\s/g, "");

      if (!luhnCheck(cardDigits)) throw new Error("Card number failed Luhn validation — please check the number.");

      const res = await apiRequest("POST", "/api/virtual-terminal/charge", {
        cardholderName: data.cardholderName,
        cardNumber: cardDigits,
        expMonth: expMonth.padStart(2, "0"),
        expYear: expYear.length === 2 ? `20${expYear}` : expYear,
        cvv: data.cvv,
        billingZip: data.billingZip,
        amount: data.amount,
        memo: data.memo,
      });
      return res.json() as Promise<ChargeResult>;
    },
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/virtual-terminal/transactions"] });
      if (result.approved) {
        form.reset();
        setCardRaw("");
        toast({ title: "Payment Approved", description: `Auth code: ${result.authCode}` });
      } else {
        toast({ title: "Payment Declined", description: result.responseText, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const refundMutation = useMutation({
    mutationFn: async ({ txnId, amount }: { txnId: number; amount: string }) => {
      const res = await apiRequest("POST", `/api/virtual-terminal/refund/${txnId}`, { amount });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/virtual-terminal/transactions"] });
      setRefundDialog(null);
      setRefundAmount("");
      toast({ title: "Refund Processed", description: "The refund has been submitted successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Refund Failed", description: err.message, variant: "destructive" });
    },
  });

  if (!isAuthorized) {
    return (
      <Card data-testid="card-vt-access-denied">
        <CardContent className="p-8 text-center space-y-3">
          <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-semibold" data-testid="text-vt-denied">Virtual Terminal Access Restricted</h2>
          <p className="text-muted-foreground text-sm">You do not have permission to use the Virtual Terminal. Contact an admin to enable this feature for your account.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-virtual-terminal">
      {lastResult && (
        <Alert
          className={lastResult.approved ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-destructive bg-destructive/10"}
          data-testid="alert-charge-result"
        >
          {lastResult.approved ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-destructive" />
          )}
          <AlertTitle data-testid="text-result-title">
            {lastResult.approved ? "Payment Approved" : "Payment Declined"}
            {lastResult.sandboxMode && (
              <Badge variant="outline" className="ml-2 text-xs">Sandbox Mode</Badge>
            )}
          </AlertTitle>
          <AlertDescription className="mt-1 space-y-1 text-sm">
            {lastResult.approved && (
              <>
                <p data-testid="text-auth-code">Auth Code: <span className="font-mono font-bold">{lastResult.authCode}</span></p>
                <p data-testid="text-transaction-id">Transaction ID: <span className="font-mono">{lastResult.gatewayTransactionId}</span></p>
                <p data-testid="text-last-four">Card: ••••{lastResult.transaction.lastFour} ({cardTypeLabel(lastResult.transaction.cardType)})</p>
              </>
            )}
            {!lastResult.approved && (
              <p data-testid="text-decline-reason">
                {lastResult.responseCode ? (
                  <><span className="font-mono font-semibold">Code {lastResult.responseCode}</span> — {lastResult.responseText}</>
                ) : (
                  lastResult.responseText
                )}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-charge-form">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Charge a Card
            </CardTitle>
            <CardDescription>Manually key in a card transaction for phone orders or in-person use without a terminal.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => chargeMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount ($)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="0.00"
                          data-testid="input-amount"
                          inputMode="decimal"
                          className="text-xl font-semibold font-mono"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cardholderName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cardholder Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Jane Smith" data-testid="input-cardholder-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cardNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        Card Number
                        {cardBrand.brand && (
                          <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded" data-testid="text-card-brand">
                            {cardBrand.brand}
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="•••• •••• •••• ••••"
                          data-testid="input-card-number"
                          inputMode="numeric"
                          value={field.value}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, "").slice(0, 19);
                            setCardRaw(raw);
                            field.onChange(formatCardNumber(raw));
                          }}
                          className="font-mono tracking-widest"
                          maxLength={23}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="expiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiry (MM/YY)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="MM/YY"
                            data-testid="input-expiry"
                            inputMode="numeric"
                            maxLength={5}
                            onChange={(e) => {
                              field.onChange(formatExpiry(e.target.value));
                            }}
                            className="font-mono"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cvv"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CVV {cardBrand.cvvLen === 4 ? "(4 digits)" : ""}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={cardBrand.cvvLen === 4 ? "••••" : "•••"}
                            type="password"
                            data-testid="input-cvv"
                            inputMode="numeric"
                            maxLength={cardBrand.cvvLen}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="billingZip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing ZIP</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="12345" data-testid="input-billing-zip" inputMode="numeric" maxLength={10} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="memo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Memo (optional)</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Invoice #, notes, or order reference..." data-testid="input-memo" rows={2} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={chargeMutation.isPending}
                  data-testid="button-charge-submit"
                >
                  {chargeMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" />
                      Charge ${form.watch("amount") || "0.00"}
                    </>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                  <Lock className="w-3 h-3" />
                  Card data is transmitted securely and never stored in plain text.
                </p>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card data-testid="card-quick-info">
          <CardHeader>
            <CardTitle className="text-base">Quick Reference</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Visa</span>
              <span className="font-mono text-xs">4••• •••• •••• ••••</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Mastercard</span>
              <span className="font-mono text-xs">51–55 or 22–27</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Amex</span>
              <span className="font-mono text-xs">34•• •••••• •••••  (4-digit CVV)</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Discover</span>
              <span className="font-mono text-xs">6011, 622, 644–649, 65</span>
            </div>
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Virtual Terminal transactions are subject to higher interchange rates than swiped/dipped cards. Ensure the merchant is aware.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-transaction-history">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>All virtual terminal transactions — most recent first</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/virtual-terminal/transactions"] })} data-testid="button-refresh-history">
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {txLoading ? (
            <div className="p-6 space-y-3" data-testid="skeleton-transactions">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-transactions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Card</TableHead>
                    <TableHead>Auth Code</TableHead>
                    <TableHead>Cardholder</TableHead>
                    <TableHead>Memo</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions?.map((txn) => (
                    <TableRow key={txn.id} data-testid={`row-txn-${txn.id}`}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-date-${txn.id}`}>
                        {new Date(txn.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono font-semibold" data-testid={`text-amount-${txn.id}`}>
                        ${parseFloat(txn.amount).toFixed(2)}
                        {parseFloat(txn.refundedAmount || "0") > 0 && (
                          <div className="text-xs text-muted-foreground font-normal">
                            −${parseFloat(txn.refundedAmount || "0").toFixed(2)} refunded
                          </div>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-status-${txn.id}`}>{statusBadge(txn.status)}</TableCell>
                      <TableCell className="text-sm" data-testid={`text-card-${txn.id}`}>
                        {txn.cardType ? cardTypeLabel(txn.cardType) : ""} ••••{txn.lastFour}
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-auth-${txn.id}`}>
                        {txn.authCode || "—"}
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-cardholder-${txn.id}`}>
                        {txn.cardholderName || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-32 truncate" data-testid={`text-memo-${txn.id}`}>
                        {txn.memo || "—"}
                      </TableCell>
                      <TableCell data-testid={`cell-actions-${txn.id}`}>
                        {txn.status === "approved" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              setRefundDialog({ txn, open: true });
                              const refundable = (parseFloat(txn.amount) - parseFloat(txn.refundedAmount || "0")).toFixed(2);
                              setRefundAmount(refundable);
                            }}
                            data-testid={`button-refund-${txn.id}`}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Refund
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!transactions || transactions.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8" data-testid="text-no-transactions">
                        No transactions yet. Process a card above to get started.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!refundDialog?.open} onOpenChange={(open) => !open && setRefundDialog(null)}>
        <DialogContent data-testid="dialog-refund">
          <DialogHeader>
            <DialogTitle>Process Refund</DialogTitle>
            <DialogDescription>
              {refundDialog?.txn && (
                <>
                  Refunding transaction for {refundDialog.txn.cardholderName} — ••••{refundDialog.txn.lastFour}
                  {" "}(Original: ${parseFloat(refundDialog.txn.amount).toFixed(2)})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium block mb-1">Refund Amount ($)</label>
              <Input
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                data-testid="input-refund-amount"
                className="font-mono"
              />
              {refundDialog?.txn && (
                <p className="text-xs text-muted-foreground mt-1">
                  Max refundable: ${(parseFloat(refundDialog.txn.amount) - parseFloat(refundDialog.txn.refundedAmount || "0")).toFixed(2)}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialog(null)} data-testid="button-cancel-refund">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={refundMutation.isPending || !refundAmount}
              onClick={() => {
                if (refundDialog?.txn) {
                  refundMutation.mutate({ txnId: refundDialog.txn.id, amount: refundAmount });
                }
              }}
              data-testid="button-confirm-refund"
            >
              {refundMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Confirm Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
