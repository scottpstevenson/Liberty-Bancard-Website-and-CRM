import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { storage } from "../storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsData = JSON.parse(
  readFileSync(join(__dirname, "../data/seeds/workflows.json"), "utf-8"),
) as {
  PREBUILT_WORKFLOWS: any[];
  DEFAULT_SLA_CONFIGS: any[];
  DEFAULT_MESSAGE_TEMPLATES: any[];
  DEFAULT_COLLATERAL_PACKETS: any[];
  PILLAR_SDR_CAMPAIGNS: Array<{ campaign: any; steps: any[] }>;
};

const PREBUILT_WORKFLOWS = workflowsData.PREBUILT_WORKFLOWS;
const DEFAULT_SLA_CONFIGS = workflowsData.DEFAULT_SLA_CONFIGS;
const DEFAULT_MESSAGE_TEMPLATES = workflowsData.DEFAULT_MESSAGE_TEMPLATES;
const DEFAULT_COLLATERAL_PACKETS = workflowsData.DEFAULT_COLLATERAL_PACKETS;
const PILLAR_SDR_CAMPAIGNS = workflowsData.PILLAR_SDR_CAMPAIGNS;

export async function seedDefaultData() {
  try {
    const existingWorkflows = await storage.getWorkflows();
    const existingNames = new Set(existingWorkflows.map(w => w.name));
    const newWorkflows = PREBUILT_WORKFLOWS.filter(wf => !existingNames.has(wf.name));
    if (newWorkflows.length > 0) {
      console.log(`Seeding ${newWorkflows.length} pre-built workflows...`);
      for (const wf of newWorkflows) {
        await storage.createWorkflow(wf);
      }
      console.log(`Seeded ${newWorkflows.length} workflows`);
    }

    const WORKFLOWS_TO_UPDATE: Record<string, { actions: any[] }> = {
      "F. Closed Won - Onboarding Kickoff": {
        actions: PREBUILT_WORKFLOWS.find(w => w.name === "F. Closed Won - Onboarding Kickoff")!.actions,
      },
      "G. Go-Live Lifecycle (Day 2/7/14/30)": {
        actions: PREBUILT_WORKFLOWS.find(w => w.name === "G. Go-Live Lifecycle (Day 2/7/14/30)")!.actions,
      },
    };

    for (const [name, updates] of Object.entries(WORKFLOWS_TO_UPDATE)) {
      const existing = existingWorkflows.find(w => w.name === name);
      if (existing) {
        const existingActions = JSON.stringify(existing.actions);
        const newActions = JSON.stringify(updates.actions);
        if (existingActions !== newActions) {
          await storage.updateWorkflow(existing.id, { actions: updates.actions });
          console.log(`[Seed] Updated workflow "${name}" with new actions`);
        }
      }
    }

    const existingSlaConfigs = await storage.getSlaConfigs();
    if (existingSlaConfigs.length === 0) {
      console.log("Seeding SLA configurations...");
      for (const config of DEFAULT_SLA_CONFIGS) {
        await storage.createSlaConfig(config);
      }
      console.log(`Seeded ${DEFAULT_SLA_CONFIGS.length} SLA configs`);
    }

    const existingTemplates = await storage.getMessageTemplates();
    if (existingTemplates.length === 0) {
      console.log("Seeding message templates...");
      for (const template of DEFAULT_MESSAGE_TEMPLATES) {
        await storage.createMessageTemplate(template);
      }
      console.log(`Seeded ${DEFAULT_MESSAGE_TEMPLATES.length} message templates`);
    }

    const existingPackets = await storage.getCollateralPackets();
    if (existingPackets.length === 0) {
      console.log("Seeding collateral packets...");
      for (const packet of DEFAULT_COLLATERAL_PACKETS) {
        await storage.createCollateralPacket(packet);
      }
      console.log(`Seeded ${DEFAULT_COLLATERAL_PACKETS.length} collateral packets`);
    }

    const existingCampaigns = await storage.getCampaigns();
    const existingCampaignNames = new Set(existingCampaigns.map(c => c.name));
    const newCampaigns = PILLAR_SDR_CAMPAIGNS.filter(c => !existingCampaignNames.has(c.campaign.name));
    if (newCampaigns.length > 0) {
      console.log(`Seeding ${newCampaigns.length} pillar SDR campaigns...`);
      for (const { campaign, steps } of newCampaigns) {
        const created = await storage.createCampaign(campaign as any);
        for (const step of steps) {
          await storage.createCampaignStep({ ...step, campaignId: created.id } as any);
        }
      }
      console.log(`Seeded ${newCampaigns.length} SDR campaigns with steps`);
    }
  } catch (err) {
    console.error("Seed error:", err);
  }
}
