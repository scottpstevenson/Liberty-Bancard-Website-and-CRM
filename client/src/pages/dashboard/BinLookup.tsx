import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CreditCard, Search, Building2, Globe, Phone, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface BinResult {
  found: boolean;
  bin?: string;
  brand?: string;
  cardType?: string;
  usage?: string;
  prepaid?: boolean;
  country?: string;
  countryCode?: string;
  bank?: string;
  bankPhone?: string;
  bankUrl?: string;
  interchangeCategory?: string;
  rewardsIndicator?: string | null;
  message?: string;
  raw?: Record<string, any>;
}

const brandColors: Record<string, string> = {
  Visa: "bg-blue-500",
  Mastercard: "bg-red-500",
  "American Express": "bg-green-600",
  Discover: "bg-orange-500",
  JCB: "bg-indigo-500",
  UnionPay: "bg-red-700",
};

export default function BinLookup() {
  const [bin, setBin] = useState("");
  const [submittedBin, setSubmittedBin] = useState("");

  const { data, isLoading, isError, error } = useQuery<BinResult>({
    queryKey: ["/api/tools/bin-lookup", submittedBin],
    queryFn: async () => {
      if (!submittedBin) return { found: false };
      const res = await fetch(`/api/tools/bin-lookup?bin=${encodeURIComponent(submittedBin)}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Lookup failed");
      }
      return res.json();
    },
    enabled: !!submittedBin,
    staleTime: 10 * 60 * 1000,
  });

  const handleLookup = () => {
    const cleaned = bin.replace(/\D/g, "").slice(0, 8);
    if (cleaned.length >= 6) setSubmittedBin(cleaned);
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="page-bin-lookup">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CreditCard className="w-6 h-6" />
          BIN Lookup
        </h2>
        <p className="text-muted-foreground text-sm">
          Identify card type, brand, bank, and interchange category from the first 6–8 digits of a card number
        </p>
      </div>

      <Card data-testid="card-bin-input">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="bin-input" className="text-sm font-medium mb-1.5 block">
                Card BIN (first 6–8 digits)
              </Label>
              <Input
                id="bin-input"
                placeholder="e.g. 411111 or 41111111"
                value={bin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 8);
                  setBin(val);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                maxLength={8}
                className="font-mono text-base tracking-wider"
                data-testid="input-bin"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter only the first 6–8 digits — never the full card number
              </p>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleLookup}
                disabled={bin.replace(/\D/g, "").length < 6 || isLoading}
                data-testid="button-bin-lookup"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Search className="w-4 h-4 mr-2" />
                )}
                Look Up
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Card data-testid="card-bin-error">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{(error as Error)?.message || "Lookup failed"}</p>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <Card data-testid="card-bin-result">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {data.found ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  BIN Identified
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-muted-foreground" />
                  BIN Not Found
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data.found ? (
              <p className="text-sm text-muted-foreground">{data.message || "No information found for this BIN."}</p>
            ) : (
              <div className="space-y-4">
                {/* Brand and type header */}
                <div className="flex flex-wrap gap-3 items-center">
                  {data.brand && (
                    <div className={`px-3 py-1.5 rounded-lg text-white text-sm font-bold ${brandColors[data.brand] || "bg-gray-600"}`} data-testid="text-bin-brand">
                      {data.brand}
                    </div>
                  )}
                  {data.cardType && (
                    <Badge variant={data.cardType === "Debit" ? "secondary" : "default"} className="text-sm" data-testid="badge-bin-card-type">
                      {data.cardType}
                    </Badge>
                  )}
                  {data.usage && (
                    <Badge variant="outline" className="text-sm" data-testid="badge-bin-usage">
                      {data.usage}
                    </Badge>
                  )}
                  {data.prepaid && (
                    <Badge variant="destructive" className="text-sm" data-testid="badge-bin-prepaid">
                      Prepaid
                    </Badge>
                  )}
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div data-testid="text-bin-interchange">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Interchange Category</p>
                      <p className="text-sm font-medium mt-0.5">{data.interchangeCategory || "Standard"}</p>
                    </div>
                    {data.country && (
                      <div data-testid="text-bin-country">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                          <Globe className="w-3 h-3" /> Country
                        </p>
                        <p className="text-sm mt-0.5">
                          {data.countryCode && (
                            <span className="mr-1">{data.countryCode}</span>
                          )}
                          {data.country}
                        </p>
                      </div>
                    )}
                  </div>
                  {data.bank && (
                    <div className="space-y-3">
                      <div data-testid="text-bin-bank">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> Issuing Bank
                        </p>
                        <p className="text-sm font-medium mt-0.5">{data.bank}</p>
                      </div>
                      {data.bankPhone && (
                        <div data-testid="text-bin-bank-phone">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                            <Phone className="w-3 h-3" /> Bank Phone
                          </p>
                          <p className="text-sm mt-0.5">{data.bankPhone}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {data.rewardsIndicator && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2" data-testid="text-bin-rewards">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Rewards Indicator</p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">{data.rewardsIndicator}</p>
                  </div>
                )}

                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    BIN: <span className="font-mono">{data.bin}</span> · Data provided by BINList.net
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-bin-help">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">
            <strong>What is a BIN?</strong> The Bank Identification Number (BIN) is the first 6–8 digits of a payment card.
            It identifies the card network (Visa, Mastercard, etc.), card type (credit/debit), issuing bank, and country.
            This helps estimate interchange fees and identify card categories at the point of sale.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
