const LAST_SEEN_KEY = "livechat_last_seen";

export function getLastSeenTimes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}");
  } catch {
    return {};
  }
}

export function markSessionSeen(sessionId: number): void {
  const times = getLastSeenTimes();
  times[String(sessionId)] = Date.now();
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(times));
}

export function countUnreadSessions(sessions: Array<{ id: number; lastMessageAt: string }>): number {
  const times = getLastSeenTimes();
  return sessions.filter((s) => {
    const lastSeen = times[String(s.id)];
    if (!lastSeen) return true;
    return new Date(s.lastMessageAt).getTime() > lastSeen;
  }).length;
}

export function playChime(): void {
  try {
    const win = window as Window & { webkitAudioContext?: typeof AudioContext };
    const AudioCtx = (win as any).AudioContext || win.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch {
    // Audio not supported — silent fallback
  }
}
