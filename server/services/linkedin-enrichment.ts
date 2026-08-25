import { storage } from "../storage";
import { assertProviderActivation } from "./provider-manifest";

export interface LinkedInProfile {
  firstName?: string;
  lastName?: string;
  title?: string;
  companyName?: string;
  city?: string;
  state?: string;
  industry?: string;
  connectionCount?: number;
  lastActivityDate?: string;
  summary?: string;
  profilePictureUrl?: string;
}

export interface EnrichmentResult {
  success: boolean;
  profile?: LinkedInProfile;
  fieldsUpdated?: string[];
  error?: string;
  provider?: string;
}

function isProxycurlConfigured(): boolean {
  return !!process.env.PROXYCURL_API_KEY;
}

async function fetchProxycurlProfile(linkedinUrl: string): Promise<LinkedInProfile> {
  assertProviderActivation({
    sourceId: "proxycurl",
    caller: "unapproved",
    explicitPaidApproval: false,
  });
  const apiKey = process.env.PROXYCURL_API_KEY!;
  const url = new URL("https://nubela.co/proxycurl/api/v2/linkedin");
  url.searchParams.set("linkedin_profile_url", linkedinUrl);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Proxycurl API error ${response.status}: ${text}`);
  }

  const data = await response.json();

  const profile: LinkedInProfile = {
    firstName: data.first_name,
    lastName: data.last_name,
    title: data.occupation || data.headline,
    companyName: data.experiences?.[0]?.company,
    city: data.city,
    state: data.state,
    industry: data.industry,
    connectionCount: data.connections,
    summary: data.summary,
    profilePictureUrl: data.profile_pic_url,
  };

  if (data.activity && Array.isArray(data.activity) && data.activity.length > 0) {
    const latest = data.activity[0];
    if (latest.activity_status) {
      profile.lastActivityDate = new Date().toISOString().split("T")[0];
    }
  }

  return profile;
}

export async function enrichContactFromLinkedIn(contactId: number): Promise<EnrichmentResult> {
  const contact = await storage.getContact(contactId);
  if (!contact) {
    return { success: false, error: "Contact not found" };
  }

  if (!contact.linkedinUrl) {
    return { success: false, error: "Contact has no LinkedIn URL" };
  }

  if (!isProxycurlConfigured()) {
    return {
      success: false,
      error: "PROXYCURL_API_KEY is not configured. Set this environment variable to enable LinkedIn enrichment.",
      provider: "proxycurl",
    };
  }

  try {
    const profile = await fetchProxycurlProfile(contact.linkedinUrl);

    const updates: Record<string, any> = {};
    const fieldsUpdated: string[] = [];

    if (profile.firstName && !contact.firstName) {
      updates.firstName = profile.firstName;
      fieldsUpdated.push("firstName");
    }
    if (profile.lastName && !contact.lastName) {
      updates.lastName = profile.lastName;
      fieldsUpdated.push("lastName");
    }
    if (profile.title && !contact.title) {
      updates.title = profile.title;
      fieldsUpdated.push("title");
    }
    if (profile.companyName && !contact.companyName) {
      updates.companyName = profile.companyName;
      fieldsUpdated.push("companyName");
    }
    if (profile.city && !contact.city) {
      updates.city = profile.city;
      fieldsUpdated.push("city");
    }
    if (profile.state && !contact.state) {
      updates.state = profile.state;
      fieldsUpdated.push("state");
    }
    if (profile.industry && !contact.industry) {
      updates.industry = profile.industry;
      fieldsUpdated.push("industry");
    }

    const now = new Date();
    const logEntry = {
      enrichedAt: now.toISOString(),
      provider: "proxycurl",
      fieldsUpdated,
      connectionCount: profile.connectionCount,
      lastActivityDate: profile.lastActivityDate,
      title: profile.title,
      companyName: profile.companyName,
      activitySummary: profile.summary || null,
    };

    const existingLog = (contact.linkedinEnrichmentLog as any[] | null) ?? [];
    updates.linkedinEnrichedAt = now;
    updates.linkedinEnrichmentLog = [logEntry, ...existingLog].slice(0, 20);

    if (Object.keys(updates).length > 0) {
      await storage.updateContact(contactId, updates);
    }

    return {
      success: true,
      profile,
      fieldsUpdated,
      provider: "proxycurl",
    };
  } catch (err: any) {
    console.error(`[LinkedIn Enrichment] Failed for contact ${contactId}:`, err.message);
    return { success: false, error: err.message, provider: "proxycurl" };
  }
}

export async function bulkEnrichFromLinkedIn(contactIds: number[]): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  noLinkedIn: number;
  results: { contactId: number; status: string; error?: string }[];
}> {
  const results: { contactId: number; status: string; error?: string }[] = [];
  let succeeded = 0;
  let failed = 0;
  let noLinkedIn = 0;

  for (const id of contactIds) {
    const contact = await storage.getContact(id);
    if (!contact?.linkedinUrl) {
      noLinkedIn++;
      results.push({ contactId: id, status: "skipped_no_linkedin" });
      continue;
    }

    const result = await enrichContactFromLinkedIn(id);
    if (result.success) {
      succeeded++;
      results.push({ contactId: id, status: "success" });
    } else {
      failed++;
      results.push({ contactId: id, status: "failed", error: result.error });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return {
    processed: contactIds.length,
    succeeded,
    failed,
    noLinkedIn,
    results,
  };
}
