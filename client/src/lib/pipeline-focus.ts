/**
 * Pipeline presentation contracts: which stages the board shows first, and the identity facts every deal card states.
 * Nothing here filters, moves or authorizes a deal; the deal list and its filters come from the authorized reader.
 */

/** Terminal or parked sales stages. They stay on the board; they open on demand because a rep's daily work is in the others. */
export const SECONDARY_SALES_STAGES: readonly string[] = ["Closed Won", "Closed Lost", "Nurture / Not Now"];

export type FocusedStages = {
  /** Stages rendered now, in the board's own order. */
  visible: string[];
  /** Secondary stages held back, with the deal count the board's filters give them. */
  hidden: Array<{ stage: string; count: number }>;
  /** Every stage the board knows. `visible.length + hidden.length` always equals this. */
  total: number;
};

/**
 * Splits the board's stages into the focused default and the on-demand remainder.
 * An unknown or legacy stage is never secondary, and the stage of an exactly selected deal is always visible, so a
 * deep link to a Closed Won deal still lands on its card.
 */
export function focusedBoardStages(input: {
  stages: readonly string[];
  showAll: boolean;
  selectedStage?: string | null;
  /** A stage opened from a count elsewhere (Reports). Only that stage shows, whatever the default focus would be. */
  pinnedStage?: string | null;
  countFor: (stage: string) => number;
}): FocusedStages {
  if (input.pinnedStage && input.stages.includes(input.pinnedStage)) {
    return { visible: [input.pinnedStage], hidden: [], total: input.stages.length };
  }
  const visible: string[] = [];
  const hidden: Array<{ stage: string; count: number }> = [];
  for (const stage of input.stages) {
    const secondary = SECONDARY_SALES_STAGES.includes(stage) && stage !== input.selectedStage;
    if (input.showAll || !secondary) visible.push(stage);
    else hidden.push({ stage, count: input.countFor(stage) });
  }
  return { visible, hidden, total: input.stages.length };
}

export type DealCardFactsInput = {
  stage?: string | null;
  owner?: string | null;
  assignedTo?: string | null;
  nextFollowUp?: string | Date | null;
  updatedAt?: string | Date | null;
};
export type DealCardFacts = {
  owner: { state: "recorded" | "none"; text: string };
  lastUpdated: { state: "recorded" | "unknown"; text: string };
  nextAction: { state: "scheduled" | "overdue" | "none" | "closed"; text: string };
  /** Short, factual reasons the deal needs attention. Empty means none are recorded, not that none exist. */
  blockers: string[];
};

const TERMINAL = new Set(["Closed Won", "Closed Lost"]);
const dateOrNull = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** The same four facts for every card, so a rep compares deals without opening each one. */
export function dealCardFacts(deal: DealCardFactsInput, now: Date): DealCardFacts {
  const ownerName = (deal.owner || deal.assignedTo || "").trim();
  const owner = ownerName ? { state: "recorded" as const, text: ownerName } : { state: "none" as const, text: "No owner recorded" };

  const updated = dateOrNull(deal.updatedAt);
  const days = updated ? Math.max(0, Math.floor((now.getTime() - updated.getTime()) / 86_400_000)) : null;
  const lastUpdated = days === null
    ? { state: "unknown" as const, text: "Last update unknown" }
    : { state: "recorded" as const, text: days === 0 ? "Updated today" : `Updated ${days}d ago` };

  const terminal = TERMINAL.has(deal.stage ?? "");
  const followUp = dateOrNull(deal.nextFollowUp);
  const blockers: string[] = [];
  let nextAction: DealCardFacts["nextAction"];
  if (terminal) {
    nextAction = { state: "closed", text: "Closed" };
  } else if (!followUp) {
    nextAction = { state: "none", text: "No follow-up scheduled" };
    blockers.push("No next action");
  } else if (followUp.getTime() < now.getTime()) {
    nextAction = { state: "overdue", text: `Follow-up overdue since ${followUp.toLocaleDateString()}` };
    blockers.push("Follow-up overdue");
  } else {
    nextAction = { state: "scheduled", text: `Follow-up ${followUp.toLocaleDateString()}` };
  }
  if (owner.state === "none" && !terminal) blockers.push("No owner");
  return { owner, lastUpdated, nextAction, blockers };
}
