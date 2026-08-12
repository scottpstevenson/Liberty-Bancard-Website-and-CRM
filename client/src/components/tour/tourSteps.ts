// Tour step definitions for each staff role.
// Each step uses a Lucide icon name + an accent colour for the illustration panel.

export type TourRole = "admin" | "manager" | "agent";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Lucide icon component — imported and passed in at render time */
  iconName: string;
  /** Tailwind bg class for the illustration panel */
  accentBg: string;
  /** Tailwind text class for the icon */
  accentText: string;
  /** Optional final CTA */
  cta?: { label: string; href: string };
}

const adminSteps: TourStep[] = [
  {
    id: "admin-welcome",
    title: "Welcome to Liberty Bancard",
    body: "You're now set up as an admin — the highest level of access on the platform. This short tour covers the key areas you'll use every day so you can hit the ground running.",
    iconName: "Sparkles",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-contacts",
    title: "Contacts & Pipeline",
    body: "Every merchant and prospect lives under Contacts & Leads. Use the Pipeline view to track deals through each stage — from first contact to fully onboarded and processing. Filters and search let you zero-in instantly.",
    iconName: "Users",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-outreach",
    title: "Outreach Command Centre",
    body: "The Outreach hub is your control tower for all outbound activity. Launch campaigns, monitor SMS and email health, and see how each channel is performing — all from a single screen.",
    iconName: "Send",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-sequences",
    title: "Sequences & Automation",
    body: "Sequences are timed, multi-step follow-up campaigns that run automatically. Build one once and let the platform nurture contacts for you — from cold intro to signed deal — without manual intervention.",
    iconName: "Repeat",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-reports",
    title: "Reports & KPIs",
    body: "The Reports section gives you real-time visibility into revenue, conversion rates, agent performance, and outreach effectiveness. Drill down by time period, channel, or agent to understand what's driving results.",
    iconName: "BarChart3",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-merchant-health",
    title: "Merchant Health & Churn",
    body: "The Merchant Health dashboard surfaces at-risk accounts before they churn. Churn scores update nightly and trigger automated save-case workflows so your team can intervene at exactly the right moment.",
    iconName: "HeartPulse",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-operator",
    title: "Operator Dashboard",
    body: "Settings, integrations, feature flags, and advanced controls live in the Admin Hub and Operator Dashboard. You can configure GHL sync, manage agents, set up sequences, and review system health — all without touching code.",
    iconName: "Settings",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "admin-setup",
    title: "You're Ready to Go",
    body: "Start by visiting the Setup Wizard to connect GHL, verify your SMTP settings, and run a quick connectivity check. Everything you need is there — it takes about five minutes.",
    iconName: "FlaskConical",
    accentBg: "bg-blue-50 dark:bg-blue-950",
    accentText: "text-blue-600 dark:text-blue-400",
    cta: { label: "Open Setup Wizard", href: "/dashboard/setup-wizard" },
  },
];

const managerSteps: TourStep[] = [
  {
    id: "manager-welcome",
    title: "Welcome to Liberty Bancard",
    body: "As a manager you have full visibility into your team's activity, pipeline, and outreach performance. This tour walks you through the areas you'll live in every day.",
    iconName: "Sparkles",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "manager-contacts",
    title: "Contacts & Pipeline",
    body: "All prospects and merchants are in Contacts & Leads. The Pipeline board shows every deal's stage at a glance — use it to coach reps, prioritise follow-ups, and spot stalled deals before they fall through.",
    iconName: "GitBranch",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "manager-outreach",
    title: "Outreach & Campaigns",
    body: "Create and schedule campaigns from the Outreach hub. You can send one-off broadcasts or kick off long-running drip campaigns. Real-time analytics show opens, clicks, and replies as they happen.",
    iconName: "Megaphone",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "manager-sequences",
    title: "Sequences",
    body: "Sequences automate the follow-up work your agents shouldn't have to remember. Configure timing, channels, and messaging once; the platform handles execution and logs every touch automatically.",
    iconName: "Repeat",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "manager-reports",
    title: "Reports",
    body: "Track team performance, leaderboard rankings, and revenue trends in the Reports section. Export any view for leadership updates or share a filtered link directly with an agent for coaching.",
    iconName: "BarChart3",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "manager-merchant-health",
    title: "Merchant Health",
    body: "The Merchant Health view scores every active account for churn risk. High-risk accounts surface automatically so you can assign save cases, schedule check-in calls, and protect your portfolio.",
    iconName: "HeartPulse",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
  },
  {
    id: "manager-done",
    title: "You're All Set",
    body: "Check the Setup Wizard to confirm all your team's integrations are connected. Then head to the Pipeline to see where your deals stand today.",
    iconName: "Trophy",
    accentBg: "bg-indigo-50 dark:bg-indigo-950",
    accentText: "text-indigo-600 dark:text-indigo-400",
    cta: { label: "Open Setup Wizard", href: "/dashboard/setup-wizard" },
  },
];

const agentSteps: TourStep[] = [
  {
    id: "agent-welcome",
    title: "Welcome to Liberty Bancard",
    body: "You're logged in as an agent. This quick tour shows you where everything lives so you can start working your pipeline and earning immediately.",
    iconName: "Sparkles",
    accentBg: "bg-emerald-50 dark:bg-emerald-950",
    accentText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "agent-myday",
    title: "My Day",
    body: "My Day is your personalised daily brief. It surfaces your most important tasks, upcoming appointments, and any contacts that need attention — so you always know exactly what to do next.",
    iconName: "Star",
    accentBg: "bg-emerald-50 dark:bg-emerald-950",
    accentText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "agent-contacts",
    title: "My Contacts",
    body: "Your assigned contacts live here. Add notes, log calls, send emails or SMS, and move contacts through stages directly from their detail page. Everything is tracked automatically.",
    iconName: "Users",
    accentBg: "bg-emerald-50 dark:bg-emerald-950",
    accentText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "agent-pipeline",
    title: "My Pipeline",
    body: "The Pipeline board shows your deals by stage. Drag cards to update stages, click in to log activity, and use filters to focus on deals most likely to close this week.",
    iconName: "GitBranch",
    accentBg: "bg-emerald-50 dark:bg-emerald-950",
    accentText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "agent-ai",
    title: "AI Advisor",
    body: "The AI Advisor answers questions about your contacts, suggests the best next action, and can draft outreach messages for you. Access it any time from the chat icon in the top bar.",
    iconName: "Bot",
    accentBg: "bg-emerald-50 dark:bg-emerald-950",
    accentText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "agent-leaderboard",
    title: "Leaderboard & Earnings",
    body: "Track your ranking, commission, and performance metrics in real time. My Earnings shows a detailed breakdown of what you've earned and what's in the pipeline so there are never any surprises.",
    iconName: "Trophy",
    accentBg: "bg-emerald-50 dark:bg-emerald-950",
    accentText: "text-emerald-600 dark:text-emerald-400",
  },
];

export const TOUR_STEPS: Record<TourRole, TourStep[]> = {
  admin: adminSteps,
  manager: managerSteps,
  agent: agentSteps,
};
