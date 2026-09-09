import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Phase = "pre_call" | "objection" | "follow_up" | "statement_request";
type Result = {
  available: boolean;
  reason?: string;
  answer?: string;
  sources?: Array<{ title: string; revisionId: number | null; relevance: number }>;
  lowConfidence?: boolean;
};

export default function CallAssistPanel({ contactId, className = "" }: { contactId: number; className?: string }) {
  const [phase, setPhase] = useState<Phase>("pre_call");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setResult(null), [phase]);

  async function submit() {
    setLoading(true);
    setResult(null);
    try {
      const response = await apiRequest("POST", `/api/contacts/${contactId}/call-assist`, {
        phase, objection_category: category, note, question,
      });
      setResult(await response.json());
    } catch {
      setResult({ available: false, reason: "REQUEST_FAILED" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-lg border bg-card p-4 space-y-4 ${className}`}>
      <div>
        <h3 className="font-semibold">Call Assist</h3>
        <p className="text-sm text-muted-foreground">Staff guidance for your next conversation.</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="call-assist-phase">Phase</label>
        <select id="call-assist-phase" value={phase} onChange={(e) => setPhase(e.target.value as Phase)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="pre_call">Pre-call</option>
          <option value="objection">Objection</option>
          <option value="follow_up">Follow-up</option>
          <option value="statement_request">Statement request</option>
        </select>
      </div>
      {phase === "objection" && (
        <div className="space-y-2">
          <Input placeholder="Objection category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Textarea placeholder="Notes (max 500 characters)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="text-right text-xs text-muted-foreground">{note.length}/500</div>
        </div>
      )}
      <Textarea placeholder="Optional question" value={question} onChange={(e) => setQuestion(e.target.value)} />
      <Button onClick={submit} disabled={loading || (phase === "objection" && !category.trim())}>
        {loading ? "Preparing…" : "Get guidance"}
      </Button>
      {result && (result.available ? (
        <div className="space-y-3 rounded-md bg-muted/40 p-3">
          {result.lowConfidence && <p className="text-sm font-medium text-amber-700">Low confidence: limited matching staff knowledge.</p>}
          <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
          {!!result.sources?.length && (
            <div><p className="text-xs font-medium">Sources</p><ul className="list-disc pl-5 text-xs text-muted-foreground">
              {result.sources.map((source, i) => <li key={`${source.revisionId ?? "source"}-${i}`}>{source.title}</li>)}
            </ul></div>
          )}
        </div>
      ) : <p className="text-sm text-muted-foreground">Call Assist unavailable: {result.reason?.replaceAll("_", " ").toLowerCase()}.</p>)}
    </div>
  );
}