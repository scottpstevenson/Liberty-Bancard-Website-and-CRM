import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2, Star } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface SurveyData {
  status: string;
  dayTrigger: number;
  token?: string;
}

interface SubmitResult {
  status: string;
  score: number;
  isPromoter: boolean;
  isDetractor: boolean;
}

const REVIEW_URLS = {
  google: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
  trustpilot: "https://www.trustpilot.com/review/libertybancard.com",
};

export default function NpsSurvey() {
  const { token } = useParams<{ token: string }>();
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const { data: survey, isLoading, isError } = useQuery<SurveyData>({
    queryKey: ["/api/nps", token],
    queryFn: async () => {
      const res = await fetch(`/api/nps/${token}`);
      if (!res.ok) throw new Error("Survey not found");
      return res.json();
    },
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: async ({ score, comment }: { score: number; comment: string }) => {
      const res = await fetch(`/api/nps/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Submission failed");
      }
      return res.json() as Promise<SubmitResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setSubmitted(true);
    },
  });

  const trackClick = async (platform: "google" | "trustpilot") => {
    try {
      await fetch(`/api/review-requests/0/track-click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
    } catch {}
    window.open(REVIEW_URLS[platform], "_blank");
  };

  const getScoreLabel = (score: number) => {
    if (score >= 9) return "Excellent";
    if (score >= 7) return "Good";
    if (score >= 5) return "Fair";
    return "Poor";
  };

  const getScoreColor = (score: number, selected: boolean) => {
    if (!selected) return "border-border bg-background hover:bg-muted";
    if (score >= 9) return "border-green-500 bg-green-500 text-white";
    if (score >= 7) return "border-blue-500 bg-blue-500 text-white";
    if (score >= 5) return "border-amber-500 bg-amber-500 text-white";
    return "border-red-500 bg-red-500 text-white";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !survey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-2">
            <p className="text-lg font-semibold">Survey Not Found</p>
            <p className="text-sm text-muted-foreground">This survey link is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (survey.status === "already_submitted") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-10 pb-10 text-center space-y-4">
            <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
            <p className="text-lg font-semibold">Already Submitted</p>
            <p className="text-sm text-muted-foreground">You've already completed this survey. Thank you!</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted && result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4">
        <Card className="max-w-lg w-full">
          <CardContent className="pt-10 pb-10 text-center space-y-6">
            <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
            <div>
              <p className="text-xl font-bold">Thank you for your feedback!</p>
              <p className="text-sm text-muted-foreground mt-1">Your response helps us improve our service.</p>
            </div>
            {result.isPromoter && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-muted-foreground">We're glad you're happy! Would you mind sharing your experience?</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button
                    onClick={() => trackClick("google")}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="button-google-review"
                  >
                    Leave a Google Review
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => trackClick("trustpilot")}
                    data-testid="button-trustpilot-review"
                  >
                    Review on Trustpilot
                  </Button>
                </div>
              </div>
            )}
            {result.isDetractor && (
              <p className="text-sm text-muted-foreground">
                We're sorry to hear you weren't fully satisfied. A member of our team will reach out to you shortly.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="max-w-2xl w-full" data-testid="nps-survey-card">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <img src="/logo.svg" alt="Liberty Bancard" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
          <CardTitle className="text-xl" data-testid="nps-title">
            How are we doing?
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Day {survey.dayTrigger} check-in — your feedback helps us serve you better
          </p>
        </CardHeader>
        <CardContent className="space-y-8 pt-4">
          <div className="space-y-4">
            <p className="text-sm font-medium text-center">
              How likely are you to recommend Liberty Bancard to a fellow business owner?
            </p>
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>Not likely</span>
              <span>Extremely likely</span>
            </div>
            <div className="grid grid-cols-11 gap-1" data-testid="nps-score-grid">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                <button
                  key={score}
                  onClick={() => setSelectedScore(score)}
                  className={`h-10 rounded-md border-2 text-sm font-semibold transition-all ${getScoreColor(score, selectedScore === score)}`}
                  data-testid={`nps-score-${score}`}
                >
                  {score}
                </button>
              ))}
            </div>
            {selectedScore !== null && (
              <div className="text-center">
                <Badge variant="secondary" className="text-sm">
                  <Star className="w-3 h-3 mr-1 inline" />
                  {getScoreLabel(selectedScore)}
                </Badge>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Any comments? <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us what you love or how we can improve..."
              rows={3}
              data-testid="nps-comment"
            />
          </div>

          <Button
            onClick={() => {
              if (selectedScore !== null) {
                submitMutation.mutate({ score: selectedScore, comment });
              }
            }}
            disabled={selectedScore === null || submitMutation.isPending}
            className="w-full"
            data-testid="nps-submit-button"
          >
            {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {submitMutation.isPending ? "Submitting..." : "Submit Feedback"}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Your response is confidential and helps us improve our service.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
