import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Target,
  FileText,
  Users,
  TrendingUp,
  CheckCircle,
  Rocket,
  Lock,
  Brain,
  Send,
  History,
  Star,
  Trophy,
  ChevronRight,
  Play,
  RotateCcw,
  MessageSquare,
  User,
  Bot,
  ClipboardList,
  ArrowLeft,
} from "lucide-react";

interface TrainingFolder {
  id: string;
  name: string;
  docId: string;
  docTitle: string;
  docUrl: string;
}

interface TrainingHubStatus {
  exists: boolean;
  folderId?: string;
  folders?: TrainingFolder[];
}

interface RoleplaySession {
  id: number;
  scenario: string;
  persona: string;
  difficulty: string | null;
  status: string;
  totalExchanges: number;
  overallScore: number | null;
  coachingSummary: string | null;
  strengths: string[] | null;
  gaps: string[] | null;
  suggestedPhrasing: string[] | null;
  createdAt: string;
  completedAt: string | null;
}

interface Exchange {
  id: number;
  repMessage: string;
  merchantReply: string;
  toneScore: number | null;
  clarityScore: number | null;
  objectionAddressed: boolean | null;
  feedback: string | null;
}

interface ScoreData {
  toneScore: number;
  clarityScore: number;
  objectionAddressed: boolean;
  feedback: string;
}

interface CoachingSummary {
  summary: string;
  strengths: string[];
  gaps: string[];
  suggestedPhrasing: string[];
  overallScore: number;
  avgTone: number;
  avgClarity: number;
  objectionRate: number;
}

const CATEGORY_META: Record<string, { icon: React.ElementType; description: string; color: string }> = {
  Prospecting: {
    icon: Target,
    description: "Find and qualify merchants by vertical, lead sources, cold call openers, LinkedIn, and door-to-door tactics.",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  "How to Sell": {
    icon: TrendingUp,
    description: "Value proposition scripts, objection handling, pain point identification, dual pricing pitch, and high-risk pitch.",
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  "Statement Review": {
    icon: FileText,
    description: "Step-by-step guide to reading a merchant processing statement, identifying effective rate, and finding savings.",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  Closing: {
    icon: CheckCircle,
    description: "Closing scripts, urgency triggers, trial closes, what to do when they stall, and follow-up cadence after demo.",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  "Onboarding & Compliance": {
    icon: Users,
    description: "What happens after signing, merchant expectations, PCI basics, and chargeback prevention.",
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  "Agent Quick-Start Guide": {
    icon: Rocket,
    description: "Day-one orientation for new reps: systems access, first calls, compensation structure, and how residuals work.",
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
};

const SCENARIOS = [
  "Cold Call",
  "Objection Handling",
  "Statement Review Close",
  "Competitor Switch",
  "0% Program Pitch",
];

type Difficulty = "standard" | "hard" | "expert";

const DIFFICULTIES: { value: Difficulty; label: string; description: string }[] = [
  { value: "standard", label: "Standard", description: "Realistic merchant — typical resistance" },
  { value: "hard", label: "Hard", description: "More skeptical, demands specifics" },
  { value: "expert", label: "Expert", description: "Sophisticated, near-impossible to convert" },
];

const normalizeDifficulty = (d: string | null | undefined): Difficulty =>
  d === "hard" || d === "expert" ? d : "standard";

const difficultyLabel = (d: string | null | undefined) =>
  DIFFICULTIES.find(x => x.value === normalizeDifficulty(d))?.label || "Standard";

const difficultyBadgeClass = (d: string | null | undefined) => {
  switch (normalizeDifficulty(d)) {
    case "hard": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "expert": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  }
};

const PERSONAS = [
  "Auto Shop Owner",
  "Dentist",
  "Restaurant Owner",
  "Retail Store Owner",
  "Home Services Contractor",
  "Medspa Owner",
];

function ScoreBar({ label, score, max = 10 }: { label: string; score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{score}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-green-600" : pct >= 60 ? "bg-amber-500" : "bg-destructive"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RoleplayPractice() {
  const { toast } = useToast();
  const [selectedScenario, setSelectedScenario] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>("standard");
  const [currentSession, setCurrentSession] = useState<RoleplaySession | null>(null);
  const [repMessage, setRepMessage] = useState("");
  const [exchanges, setExchanges] = useState<(Exchange & { score?: ScoreData })[]>([]);
  const [conversationHistory, setConversationHistory] = useState<{ role: string; content: string }[]>([]);
  const [coachingSummary, setCoachingSummary] = useState<CoachingSummary | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] = useState<RoleplaySession | null>(null);
  const [historyExchanges, setHistoryExchanges] = useState<Exchange[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: sessions, refetch: refetchSessions } = useQuery<RoleplaySession[]>({
    queryKey: ["/api/training/roleplay/sessions"],
  });

  const startMutation = useMutation({
    mutationFn: async (overrides?: { scenario?: string; persona?: string; difficulty?: Difficulty }) => {
      const payload = {
        scenario: overrides?.scenario ?? selectedScenario,
        persona: overrides?.persona ?? selectedPersona,
        difficulty: overrides?.difficulty ?? selectedDifficulty,
      };
      const res = await apiRequest("POST", "/api/training/roleplay/start", payload);
      const session = await res.json();
      return { session, payload };
    },
    onSuccess: ({ session, payload }) => {
      setSelectedScenario(payload.scenario);
      setSelectedPersona(payload.persona);
      setSelectedDifficulty(payload.difficulty);
      setCurrentSession(session);
      setExchanges([]);
      setConversationHistory([]);
      setCoachingSummary(null);
      setRepMessage("");
    },
    onError: (err: any) => toast({ title: "Failed to start session", description: err.message, variant: "destructive" }),
  });

  const nextDifficulty = (d: string | null | undefined): Difficulty =>
    normalizeDifficulty(d) === "standard" ? "hard" : "expert";

  const retrySameScenario = () => {
    if (!currentSession) return;
    startMutation.mutate({
      scenario: currentSession.scenario,
      persona: currentSession.persona,
      difficulty: normalizeDifficulty(currentSession.difficulty),
    });
  };

  const tryHarderVersion = () => {
    if (!currentSession) return;
    startMutation.mutate({
      scenario: currentSession.scenario,
      persona: currentSession.persona,
      difficulty: nextDifficulty(currentSession.difficulty),
    });
  };

  const exchangeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/training/roleplay/exchange", {
        sessionId: currentSession!.id,
        repMessage,
        conversationHistory,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const newExchange = { ...data.exchange, score: data.score };
      setExchanges(prev => [...prev, newExchange]);
      setConversationHistory(prev => [
        ...prev,
        { role: "user", content: repMessage },
        { role: "assistant", content: data.merchantReply },
      ]);
      setRepMessage("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (err: any) => toast({ title: "Failed to send message", description: err.message, variant: "destructive" }),
  });

  const endMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/training/roleplay/end", { sessionId: currentSession!.id });
      return res.json();
    },
    onSuccess: (data) => {
      setCoachingSummary(data);
      setCurrentSession(prev => prev ? { ...prev, status: "completed" } : null);
      refetchSessions();
    },
    onError: (err: any) => toast({ title: "Failed to end session", description: err.message, variant: "destructive" }),
  });

  const loadHistorySession = async (session: RoleplaySession) => {
    setSelectedHistorySession(session);
    try {
      const res = await fetch(`/api/training/roleplay/sessions/${session.id}/exchanges`, { credentials: "include" });
      const data = await res.json();
      setHistoryExchanges(data);
    } catch {
      setHistoryExchanges([]);
    }
  };

  const resetSession = () => {
    setCurrentSession(null);
    setExchanges([]);
    setConversationHistory([]);
    setCoachingSummary(null);
    setRepMessage("");
    setSelectedScenario("");
    setSelectedPersona("");
    setSelectedDifficulty("standard");
  };

  const canStart = selectedScenario && selectedPersona;
  const isActive = currentSession && currentSession.status === "active";
  const isCompleted = currentSession && currentSession.status === "completed";

  if (showHistory) {
    return (
      <div className="space-y-4" data-testid="roleplay-history">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setShowHistory(false); setSelectedHistorySession(null); }} data-testid="button-back-to-practice">
            ← Back to Practice
          </Button>
          <h2 className="font-semibold">Session History</h2>
        </div>
        {!sessions || sessions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No practice sessions yet. Start your first roleplay above.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              {sessions.map(session => (
                <Card
                  key={session.id}
                  className={`cursor-pointer hover:shadow-sm transition-shadow ${selectedHistorySession?.id === session.id ? "border-primary" : ""}`}
                  onClick={() => loadHistorySession(session)}
                  data-testid={`card-history-session-${session.id}`}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{session.scenario}</p>
                        <p className="text-xs text-muted-foreground">{session.persona} · {new Date(session.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${difficultyBadgeClass(session.difficulty)}`} data-testid={`badge-difficulty-${session.id}`}>
                          {difficultyLabel(session.difficulty)}
                        </Badge>
                        {session.overallScore !== null && (
                          <Badge variant="secondary" className="text-xs" data-testid={`badge-session-score-${session.id}`}>
                            <Star className="w-3 h-3 mr-1 text-yellow-500" />
                            {session.overallScore}/10
                          </Badge>
                        )}
                        <Badge variant={session.status === "completed" ? "secondary" : "outline"} className="text-xs">
                          {session.status === "completed" ? "Done" : "Active"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {selectedHistorySession && (
              <div className="space-y-3">
                {selectedHistorySession.coachingSummary && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Coaching Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p className="text-muted-foreground">{selectedHistorySession.coachingSummary}</p>
                      {selectedHistorySession.overallScore !== null && (
                        <ScoreBar label="Overall Score" score={selectedHistorySession.overallScore} />
                      )}
                      {selectedHistorySession.strengths && selectedHistorySession.strengths.length > 0 && (
                        <div>
                          <p className="font-medium text-green-600 mb-1">Strengths</p>
                          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                            {selectedHistorySession.strengths.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                      {selectedHistorySession.gaps && selectedHistorySession.gaps.length > 0 && (
                        <div>
                          <p className="font-medium text-amber-600 mb-1">Areas to Improve</p>
                          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                            {selectedHistorySession.gaps.map((g, i) => <li key={i}>{g}</li>)}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{historyExchanges.length} Exchanges</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {historyExchanges.map((ex, i) => (
                      <div key={ex.id} className="border rounded-md p-3 space-y-2 text-sm">
                        <div className="flex items-start gap-2">
                          <User className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                          <span>{ex.repMessage}</span>
                        </div>
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{ex.merchantReply}</span>
                        </div>
                        {ex.toneScore !== null && (
                          <div className="flex gap-3 pt-1">
                            <Badge variant="outline" className="text-xs">Tone {ex.toneScore}/10</Badge>
                            <Badge variant="outline" className="text-xs">Clarity {ex.clarityScore}/10</Badge>
                            {ex.objectionAddressed && <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Objection ✓</Badge>}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="roleplay-practice">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            AI Roleplay Coach
          </h2>
          <p className="text-sm text-muted-foreground">Practice sales scenarios with an AI merchant persona — get scored and coached in real time.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowHistory(true)} data-testid="button-view-history">
          <History className="w-4 h-4 mr-2" />
          History {sessions && sessions.length > 0 ? `(${sessions.length})` : ""}
        </Button>
      </div>

      {!currentSession ? (
        <Card data-testid="card-start-session">
          <CardHeader>
            <CardTitle className="text-base">Start a Practice Session</CardTitle>
            <CardDescription>Choose a scenario and merchant persona to practice with</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Scenario</label>
                <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                  <SelectTrigger data-testid="select-scenario">
                    <SelectValue placeholder="Choose a scenario..." />
                  </SelectTrigger>
                  <SelectContent>
                    {SCENARIOS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Merchant Persona</label>
                <Select value={selectedPersona} onValueChange={setSelectedPersona}>
                  <SelectTrigger data-testid="select-persona">
                    <SelectValue placeholder="Choose a merchant..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSONAS.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SCENARIOS.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedScenario(s)}
                  className={`p-3 rounded-lg border text-left text-sm transition-colors hover:border-primary ${selectedScenario === s ? "border-primary bg-primary/5 font-medium" : "border-border"}`}
                  data-testid={`button-scenario-${s.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Difficulty</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setSelectedDifficulty(d.value)}
                    className={`p-3 rounded-lg border text-left text-sm transition-colors hover:border-primary ${selectedDifficulty === d.value ? "border-primary bg-primary/5 font-medium" : "border-border"}`}
                    data-testid={`button-difficulty-${d.value}`}
                  >
                    <div className="font-medium">{d.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{d.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!canStart || startMutation.isPending}
              onClick={() => startMutation.mutate(undefined)}
              data-testid="button-start-session"
            >
              {startMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {startMutation.isPending ? "Starting..." : "Start Practice Session"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{currentSession.scenario}</Badge>
              <Badge variant="outline">{currentSession.persona}</Badge>
              <Badge className={difficultyBadgeClass(currentSession.difficulty)} data-testid="badge-current-difficulty">
                {difficultyLabel(currentSession.difficulty)}
              </Badge>
              {isCompleted && <Badge className="bg-green-600 text-white">Session Complete</Badge>}
            </div>
            <div className="flex gap-2">
              {isActive && exchanges.length >= 1 && (
                <Button variant="outline" size="sm" onClick={() => endMutation.mutate()} disabled={endMutation.isPending} data-testid="button-end-session">
                  {endMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                  End & Get Feedback
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={resetSession} data-testid="button-reset-session">
                <RotateCcw className="w-4 h-4 mr-1" />
                New Session
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card data-testid="card-conversation">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Conversation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64 pr-2">
                    {exchanges.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-8">
                        Start the conversation — type what you'd say to this merchant.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {exchanges.map((ex, i) => (
                          <div key={ex.id} className="space-y-3" data-testid={`exchange-${i}`}>
                            <div className="flex items-start gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                <User className="w-3 h-3 text-primary" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium mb-0.5">You</p>
                                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-2.5">{ex.repMessage}</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                <Bot className="w-3 h-3 text-amber-600" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium mb-0.5">{currentSession.persona}</p>
                                <p className="text-sm text-muted-foreground rounded-lg p-2.5 border">{ex.merchantReply}</p>
                                {ex.toneScore !== null && (
                                  <div className="flex gap-2 mt-1.5 flex-wrap">
                                    <Badge variant="outline" className="text-xs" data-testid={`badge-tone-${i}`}>Tone {ex.toneScore}/10</Badge>
                                    <Badge variant="outline" className="text-xs" data-testid={`badge-clarity-${i}`}>Clarity {ex.clarityScore}/10</Badge>
                                    {ex.objectionAddressed ? (
                                      <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" data-testid={`badge-objection-${i}`}>
                                        Objection ✓
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs text-amber-600" data-testid={`badge-objection-missed-${i}`}>
                                        Objection not addressed
                                      </Badge>
                                    )}
                                    {ex.feedback && (
                                      <span className="text-xs text-muted-foreground italic w-full mt-0.5" data-testid={`text-feedback-${i}`}>💡 {ex.feedback}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div ref={bottomRef} />
                      </div>
                    )}
                  </ScrollArea>

                  {isActive && (
                    <div className="mt-4 flex gap-2">
                      <Textarea
                        placeholder={`What would you say to this ${currentSession.persona.toLowerCase()}?`}
                        value={repMessage}
                        onChange={(e) => setRepMessage(e.target.value)}
                        className="resize-none text-sm"
                        rows={3}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && repMessage.trim()) {
                            e.preventDefault();
                            exchangeMutation.mutate();
                          }
                        }}
                        data-testid="textarea-rep-message"
                      />
                      <Button
                        className="self-end"
                        disabled={!repMessage.trim() || exchangeMutation.isPending}
                        onClick={() => exchangeMutation.mutate()}
                        data-testid="button-send-message"
                      >
                        {exchangeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  )}
                  {isActive && (
                    <p className="text-xs text-muted-foreground mt-1.5">Tip: Press Cmd+Enter to send</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              {exchanges.length > 0 && (
                <Card data-testid="card-running-scores">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Turn Scores</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {exchanges.map((ex, i) => (
                      <div key={ex.id} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Turn {i + 1}</p>
                        {ex.toneScore !== null && (
                          <>
                            <ScoreBar label="Tone" score={ex.toneScore} />
                            <ScoreBar label="Clarity" score={ex.clarityScore ?? 0} />
                          </>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {coachingSummary && (
                <Card className="border-green-200 dark:border-green-800" data-testid="card-coaching-summary">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-yellow-500" />
                      Session Complete
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="space-y-1.5">
                      <ScoreBar label="Overall Score" score={coachingSummary.overallScore} />
                      <ScoreBar label="Avg Tone" score={coachingSummary.avgTone} />
                      <ScoreBar label="Avg Clarity" score={coachingSummary.avgClarity} />
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">{coachingSummary.summary}</p>
                    {coachingSummary.strengths.length > 0 && (
                      <div>
                        <p className="font-medium text-green-600 text-xs mb-1">Strengths</p>
                        <ul className="space-y-0.5">
                          {coachingSummary.strengths.map((s, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                              <CheckCircle className="w-3 h-3 text-green-600 mt-0.5 shrink-0" /> {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {coachingSummary.gaps.length > 0 && (
                      <div>
                        <p className="font-medium text-amber-600 text-xs mb-1">Improve</p>
                        <ul className="space-y-0.5">
                          {coachingSummary.gaps.map((g, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                              <ChevronRight className="w-3 h-3 text-amber-600 mt-0.5 shrink-0" /> {g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {coachingSummary.suggestedPhrasing.length > 0 && (
                      <div>
                        <p className="font-medium text-primary text-xs mb-1">Try saying:</p>
                        <ul className="space-y-1">
                          {coachingSummary.suggestedPhrasing.map((p, i) => (
                            <li key={i} className="text-xs text-muted-foreground italic border-l-2 border-primary pl-2">{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="pt-2 border-t space-y-2">
                      <p className="text-xs font-medium">Practice again</p>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={retrySameScenario}
                          disabled={startMutation.isPending}
                          data-testid="button-retry-same"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                          Retry Same Scenario
                        </Button>
                        {normalizeDifficulty(currentSession?.difficulty) !== "expert" && (
                          <Button
                            size="sm"
                            onClick={tryHarderVersion}
                            disabled={startMutation.isPending}
                            data-testid="button-try-harder"
                          >
                            <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                            Try a Harder Version ({difficultyLabel(nextDifficulty(currentSession?.difficulty))})
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AdminSession extends RoleplaySession {
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  userRole: string | null;
  avgTone: number | null;
  avgClarity: number | null;
}

interface RepSummary {
  userId: string;
  name: string;
  email: string;
  role: string;
  sessionsCompleted: number;
  totalSessions: number;
  avgTone: number | null;
  avgClarity: number | null;
  avgOverall: number | null;
  lastSessionAt: string | null;
  sessions: AdminSession[];
}

function CoachingDashboard() {
  const [selectedRep, setSelectedRep] = useState<RepSummary | null>(null);
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null);
  const [drillExchanges, setDrillExchanges] = useState<Exchange[]>([]);
  const [loadingExchanges, setLoadingExchanges] = useState(false);

  const { data: sessions, isLoading } = useQuery<AdminSession[]>({
    queryKey: ["/api/training/roleplay/admin/sessions"],
  });

  const reps: RepSummary[] = (() => {
    if (!sessions) return [];
    const map = new Map<string, RepSummary>();
    for (const s of sessions) {
      if (!s.userId) continue;
      const name = [s.userFirstName, s.userLastName].filter(Boolean).join(" ") || s.userEmail || "Unknown";
      const existing = map.get(s.userId) || {
        userId: s.userId,
        name,
        email: s.userEmail || "",
        role: s.userRole || "agent",
        sessionsCompleted: 0,
        totalSessions: 0,
        avgTone: null,
        avgClarity: null,
        avgOverall: null,
        lastSessionAt: null,
        sessions: [],
      };
      existing.totalSessions += 1;
      if (s.status === "completed") existing.sessionsCompleted += 1;
      existing.sessions.push(s);
      if (!existing.lastSessionAt || (s.createdAt && s.createdAt > existing.lastSessionAt)) {
        existing.lastSessionAt = s.createdAt;
      }
      map.set(s.userId, existing);
    }
    // Compute averages from completed sessions
    for (const rep of Array.from(map.values())) {
      const tones = rep.sessions.map(s => s.avgTone).filter((v): v is number => v !== null);
      const clarities = rep.sessions.map(s => s.avgClarity).filter((v): v is number => v !== null);
      const overalls = rep.sessions.map(s => s.overallScore).filter((v): v is number => v !== null);
      const avg = (a: number[]) => a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null;
      rep.avgTone = avg(tones);
      rep.avgClarity = avg(clarities);
      rep.avgOverall = avg(overalls);
    }
    return Array.from(map.values()).sort((a, b) => (b.lastSessionAt || "").localeCompare(a.lastSessionAt || ""));
  })();

  const loadSession = async (s: AdminSession) => {
    setSelectedSession(s);
    setDrillExchanges([]);
    setLoadingExchanges(true);
    try {
      const res = await fetch(`/api/training/roleplay/admin/sessions/${s.id}/exchanges`, { credentials: "include" });
      const data = await res.json();
      setDrillExchanges(data);
    } catch {
      setDrillExchanges([]);
    } finally {
      setLoadingExchanges(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="coaching-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!reps.length) {
    return (
      <Card data-testid="coaching-empty">
        <CardContent className="py-12 text-center text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No roleplay activity yet</p>
          <p className="text-sm mt-1">Once reps start practicing, their scores and trends will show up here.</p>
        </CardContent>
      </Card>
    );
  }

  // Drill into a specific session
  if (selectedRep && selectedSession) {
    return (
      <div className="space-y-4" data-testid="coaching-session-detail">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedSession(null); setDrillExchanges([]); }} data-testid="button-back-to-rep">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to {selectedRep.name}
          </Button>
        </div>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base">{selectedSession.scenario}</CardTitle>
                <CardDescription>
                  {selectedSession.persona} · {selectedSession.createdAt ? new Date(selectedSession.createdAt).toLocaleString() : ""}
                </CardDescription>
              </div>
              {selectedSession.overallScore !== null && (
                <Badge variant="secondary" data-testid="badge-detail-overall">
                  <Star className="w-3 h-3 mr-1 text-yellow-500" />
                  Overall {selectedSession.overallScore}/10
                </Badge>
              )}
            </div>
          </CardHeader>
          {selectedSession.coachingSummary && (
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{selectedSession.coachingSummary}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {selectedSession.overallScore !== null && <ScoreBar label="Overall" score={selectedSession.overallScore} />}
                {selectedSession.avgTone !== null && <ScoreBar label="Avg Tone" score={Math.round(selectedSession.avgTone)} />}
                {selectedSession.avgClarity !== null && <ScoreBar label="Avg Clarity" score={Math.round(selectedSession.avgClarity)} />}
              </div>
              {selectedSession.strengths && selectedSession.strengths.length > 0 && (
                <div>
                  <p className="font-medium text-green-600 mb-1">Strengths</p>
                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                    {selectedSession.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {selectedSession.gaps && selectedSession.gaps.length > 0 && (
                <div>
                  <p className="font-medium text-amber-600 mb-1">Areas to Improve</p>
                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                    {selectedSession.gaps.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}
              {selectedSession.suggestedPhrasing && selectedSession.suggestedPhrasing.length > 0 && (
                <div>
                  <p className="font-medium text-primary mb-1">Suggested phrasing</p>
                  <ul className="space-y-1">
                    {selectedSession.suggestedPhrasing.map((p, i) => (
                      <li key={i} className="text-xs text-muted-foreground italic border-l-2 border-primary pl-2">{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{drillExchanges.length} Exchanges</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingExchanges ? (
              <Skeleton className="h-24 w-full" />
            ) : drillExchanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No exchanges recorded.</p>
            ) : drillExchanges.map((ex) => (
              <div key={ex.id} className="border rounded-md p-3 space-y-2 text-sm" data-testid={`exchange-detail-${ex.id}`}>
                <div className="flex items-start gap-2">
                  <User className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                  <span>{ex.repMessage}</span>
                </div>
                <div className="flex items-start gap-2 text-muted-foreground">
                  <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{ex.merchantReply}</span>
                </div>
                {ex.toneScore !== null && (
                  <div className="flex gap-3 pt-1 flex-wrap">
                    <Badge variant="outline" className="text-xs">Tone {ex.toneScore}/10</Badge>
                    <Badge variant="outline" className="text-xs">Clarity {ex.clarityScore}/10</Badge>
                    {ex.objectionAddressed && <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Objection ✓</Badge>}
                  </div>
                )}
                {ex.feedback && <p className="text-xs italic text-muted-foreground">💡 {ex.feedback}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Rep detail view
  if (selectedRep) {
    return (
      <div className="space-y-4" data-testid="coaching-rep-detail">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedRep(null)} data-testid="button-back-to-reps">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to all reps
          </Button>
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <CardTitle data-testid="text-rep-name">{selectedRep.name}</CardTitle>
                <CardDescription>{selectedRep.email} · {selectedRep.role}</CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" data-testid="badge-rep-completed">{selectedRep.sessionsCompleted} completed</Badge>
                {selectedRep.avgOverall !== null && (
                  <Badge variant="secondary" data-testid="badge-rep-avg-overall">
                    <Star className="w-3 h-3 mr-1 text-yellow-500" />
                    Avg {selectedRep.avgOverall}/10
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {selectedRep.avgOverall !== null && <ScoreBar label="Avg Overall" score={Math.round(selectedRep.avgOverall)} />}
            {selectedRep.avgTone !== null && <ScoreBar label="Avg Tone" score={Math.round(selectedRep.avgTone)} />}
            {selectedRep.avgClarity !== null && <ScoreBar label="Avg Clarity" score={Math.round(selectedRep.avgClarity)} />}
          </CardContent>
        </Card>
        <div className="space-y-2">
          <h3 className="font-medium text-sm">Session History ({selectedRep.sessions.length})</h3>
          {selectedRep.sessions.map(s => (
            <Card
              key={s.id}
              className="cursor-pointer hover:shadow-sm transition-shadow"
              onClick={() => loadSession(s)}
              data-testid={`card-rep-session-${s.id}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s.scenario}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.persona} · {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ""} · {s.totalExchanges} turns
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.avgTone !== null && <Badge variant="outline" className="text-xs">Tone {s.avgTone}</Badge>}
                    {s.avgClarity !== null && <Badge variant="outline" className="text-xs">Clarity {s.avgClarity}</Badge>}
                    {s.overallScore !== null && (
                      <Badge variant="secondary" className="text-xs">
                        <Star className="w-3 h-3 mr-1 text-yellow-500" />
                        {s.overallScore}/10
                      </Badge>
                    )}
                    <Badge variant={s.status === "completed" ? "secondary" : "outline"} className="text-xs">
                      {s.status === "completed" ? "Done" : "Active"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Rep list view
  return (
    <div className="space-y-3" data-testid="coaching-rep-list">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" />
            Team Coaching
          </h2>
          <p className="text-sm text-muted-foreground">Review your team's roleplay activity, scores, and trends. Click a rep to drill into their sessions.</p>
        </div>
        <Badge variant="outline" data-testid="badge-rep-count">{reps.length} {reps.length === 1 ? "rep" : "reps"}</Badge>
      </div>
      <div className="space-y-2">
        {reps.map(rep => (
          <Card
            key={rep.userId}
            className="cursor-pointer hover:shadow-sm transition-shadow"
            onClick={() => setSelectedRep(rep)}
            data-testid={`card-rep-${rep.userId}`}
          >
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm" data-testid={`text-rep-name-${rep.userId}`}>{rep.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {rep.email} · last session {rep.lastSessionAt ? new Date(rep.lastSessionAt).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs" data-testid={`badge-rep-sessions-${rep.userId}`}>
                    {rep.sessionsCompleted}/{rep.totalSessions} sessions
                  </Badge>
                  {rep.avgTone !== null && (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-rep-tone-${rep.userId}`}>Tone {rep.avgTone}</Badge>
                  )}
                  {rep.avgClarity !== null && (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-rep-clarity-${rep.userId}`}>Clarity {rep.avgClarity}</Badge>
                  )}
                  {rep.avgOverall !== null && (
                    <Badge variant="secondary" className="text-xs" data-testid={`badge-rep-overall-${rep.userId}`}>
                      <Star className="w-3 h-3 mr-1 text-yellow-500" />
                      {rep.avgOverall}/10
                    </Badge>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function Training() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isSettingUp, setIsSettingUp] = useState(false);

  const role = (user?.role as string) || "merchant";
  const isInternalUser = role === "admin" || role === "manager" || role === "agent";
  const canManageHub = role === "admin" || role === "manager";

  useEffect(() => {
    if (user && !isInternalUser) {
      setLocation("/dashboard");
    }
  }, [user, isInternalUser, setLocation]);

  const { data: status, isLoading } = useQuery<TrainingHubStatus>({
    queryKey: ["/api/training/status"],
    enabled: isInternalUser,
  });

  const setupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/training/setup"),
    onMutate: () => setIsSettingUp(true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/training/status"] });
      toast({
        title: "Training Hub Created",
        description: "All 6 training documents have been created in Google Drive.",
      });
      setIsSettingUp(false);
    },
    onError: (error: any) => {
      toast({
        title: "Setup Failed",
        description: error.message || "Failed to create training hub. Please try again.",
        variant: "destructive",
      });
      setIsSettingUp(false);
    },
  });

  const handleSetup = () => setupMutation.mutate();
  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ["/api/training/status"] });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-training-title">
            <BookOpen className="w-7 h-7 text-primary" />
            Sales Training Hub
          </h1>
          <p className="text-muted-foreground mt-1">
            Structured training docs and AI-powered roleplay practice for every stage of the sales process.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            data-testid="button-refresh-training"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {status?.exists && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://drive.google.com/drive/folders/${status.folderId}`, "_blank")}
              data-testid="button-open-drive-folder"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Open in Drive
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="docs" className="w-full">
        <TabsList className="mb-6" data-testid="tabs-training">
          <TabsTrigger value="docs" data-testid="tab-docs">
            <BookOpen className="w-4 h-4 mr-2" />
            Training Docs
          </TabsTrigger>
          <TabsTrigger value="practice" data-testid="tab-practice">
            <Brain className="w-4 h-4 mr-2" />
            AI Practice
          </TabsTrigger>
          {canManageHub && (
            <TabsTrigger value="coaching" data-testid="tab-coaching">
              <ClipboardList className="w-4 h-4 mr-2" />
              Team Coaching
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="docs">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full mt-2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-9 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !status?.exists ? (
            <Card className="border-dashed" data-testid="card-training-setup">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  {canManageHub ? (
                    <BookOpen className="w-8 h-8 text-primary" />
                  ) : (
                    <Lock className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <h2 className="text-xl font-semibold mb-2">Training Hub Not Set Up</h2>
                {canManageHub ? (
                  <>
                    <p className="text-muted-foreground max-w-md mb-6">
                      Click the button below to automatically create the "Sales Training Hub" folder structure in Google Drive,
                      with all 6 training documents pre-populated with content.
                    </p>
                    <div className="flex flex-col items-center gap-3">
                      <Button
                        size="lg"
                        onClick={handleSetup}
                        disabled={isSettingUp || setupMutation.isPending}
                        data-testid="button-setup-training-hub"
                      >
                        {(isSettingUp || setupMutation.isPending) ? (
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        ) : (
                          <Plus className="w-5 h-5 mr-2" />
                        )}
                        {(isSettingUp || setupMutation.isPending) ? "Creating Training Hub..." : "Create Training Hub"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        This will create folders and documents in your connected Google Drive account.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground max-w-md">
                    The training hub hasn't been set up yet. Please contact your manager or admin to initialize it.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="secondary" className="bg-green-500/10 text-green-700 dark:text-green-400" data-testid="badge-hub-status">
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  Training Hub Active
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {status.folders?.length || 0} training modules available
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {status.folders?.map((folder) => {
                  const meta = CATEGORY_META[folder.name] || {
                    icon: BookOpen,
                    description: "Training content for this category.",
                    color: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
                  };
                  const Icon = meta.icon;

                  return (
                    <Card
                      key={folder.id}
                      className="hover:shadow-md transition-shadow"
                      data-testid={`card-training-${folder.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${meta.color}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base leading-snug" data-testid={`text-training-category-${folder.name}`}>
                              {folder.name}
                            </CardTitle>
                          </div>
                        </div>
                        <CardDescription className="text-sm mt-2 leading-relaxed">
                          {meta.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {folder.docUrl ? (
                          <Button
                            className="w-full"
                            variant="outline"
                            onClick={() => window.open(folder.docUrl, "_blank")}
                            data-testid={`button-open-doc-${folder.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Open Training Doc
                          </Button>
                        ) : (
                          <Button className="w-full" variant="outline" disabled>
                            <FileText className="w-4 h-4 mr-2" />
                            No document found
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {canManageHub && (
                <Card className="mt-6 border-dashed" data-testid="card-rebuild-hub">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium text-sm">Rebuild Training Hub</p>
                      <p className="text-xs text-muted-foreground">
                        Re-run setup to add any missing folders or documents. Existing content will not be overwritten.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSetup}
                      disabled={isSettingUp || setupMutation.isPending}
                      data-testid="button-rebuild-training-hub"
                    >
                      {(isSettingUp || setupMutation.isPending) ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-2" />
                      )}
                      {(isSettingUp || setupMutation.isPending) ? "Rebuilding..." : "Rebuild"}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="practice">
          <RoleplayPractice />
        </TabsContent>

        {canManageHub && (
          <TabsContent value="coaching">
            <CoachingDashboard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
