/**
 * Raw failure text (an error message, a response body, an error code) belongs in a named disclosure, not in the sentence an
 * operator reads. The plain sentence says what is unavailable; this holds what a developer needs. Renders nothing when
 * there is no raw text, so a plain unavailable state never shows an empty control.
 */
export function TechnicalDetails({ text, testId, label = "Technical details" }: { text: string | null | undefined; testId: string; label?: string }) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;
  return (
    <details className="text-xs text-muted-foreground" data-testid={testId}>
      <summary className="min-h-8 cursor-pointer select-none font-medium">{label}</summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-2 font-mono text-[11px]">{raw}</pre>
    </details>
  );
}
