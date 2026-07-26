import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { pool } from "../db";
import { storage } from "../storage";
import { getGhlSyncStatus } from "../services/ghl-sync";

export function registerInformationFlowRoutes(app: Express) {
  // GET /api/information-flow
  // Admin-only: returns per-stage pipeline metrics and system state.
  app.get("/api/information-flow", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }

    try {
      const [
        // Stage 1 – Lead Source / UTM / Import
        leadSourceRows,
        utmCaptureRow,
        recentImportsRow,

        // Stage 2 – CRM contact creation
        contactStatsRow,
        recentContactsRow,

        // Stage 3 – GHL Sync
        ghlStatus,

        // Stage 4 – Sequence enrollment
        enrollmentStatsRow,

        // Stage 5 – Send gate / suppression
        suppressionRows,

        // Stage 6 – GHL transport (sends)
        sendStatsRow,

        // Stage 7 – Reply / bounce / unsubscribe
        replyBounceRow,

        // Stage 8 – CRM audit update
        auditUpdateRow,

        // System state
        outboundPaused,
        outboundPausedReason,
        smsA2pStatus,
        emailOnlyMode,
        circuitBreakerState,
      ] = await Promise.all([
        // Stage 1a: contacts by lead source (top 8)
        pool.query<{ source: string; count: string }>(`
          SELECT COALESCE(lead_source, 'unknown') AS source, COUNT(*)::text AS count
          FROM contacts
          WHERE archived_at IS NULL
          GROUP BY lead_source
          ORDER BY COUNT(*) DESC
          LIMIT 8
        `),

        // Stage 1b: UTM capture coverage
        pool.query<{ total: string; with_utm: string; with_gclid: string; with_landing: string }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE utm_source IS NOT NULL)::text AS with_utm,
            COUNT(*) FILTER (WHERE gclid IS NOT NULL)::text AS with_gclid,
            COUNT(*) FILTER (WHERE landing_page IS NOT NULL)::text AS with_landing
          FROM contacts
          WHERE archived_at IS NULL
        `),

        // Stage 1c: recent imports (last 7 days)
        pool.query<{ count: string; last_at: string | null }>(`
          SELECT COUNT(*)::text AS count, MAX(started_at)::text AS last_at
          FROM import_executions
          WHERE started_at > NOW() - INTERVAL '7 days'
        `),

        // Stage 2: contact aggregate
        pool.query<{ total: string; new_last_7d: string; new_last_30d: string }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::text AS new_last_7d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::text AS new_last_30d
          FROM contacts
          WHERE archived_at IS NULL
        `),

        // Stage 2b: last contact created at
        pool.query<{ last_at: string | null }>(`
          SELECT MAX(created_at)::text AS last_at FROM contacts WHERE archived_at IS NULL
        `),

        // Stage 3: GHL sync
        getGhlSyncStatus(),

        // Stage 4: enrollment stats
        pool.query<{
          total: string; active: string; paused: string; completed: string; last_at: string | null;
        }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'active')::text AS active,
            COUNT(*) FILTER (WHERE status = 'paused')::text AS paused,
            COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
            MAX(created_at)::text AS last_at
          FROM sequence_enrollments
          WHERE created_at > NOW() - INTERVAL '30 days'
        `),

        // Stage 5: suppression / block audit events (last 30 days)
        pool.query<{ action: string; count: string }>(`
          SELECT action, COUNT(*)::text AS count
          FROM audit_logs
          WHERE action IN (
            'sequence_step_blocked_contactability',
            'sequence_enrollment_blocked_contactability',
            'sequence_step_skipped_global_pause',
            'sequence_step_deferred_daily_cap',
            'sequence_enrollment_skipped_bad_email'
          )
          AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY action
          ORDER BY COUNT(*) DESC
        `),

        // Stage 6: outbound send stats (last 30 days)
        pool.query<{
          emails_sent: string; sms_sent: string; last_email_at: string | null; last_sms_at: string | null;
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE action = 'sequence_email_sent')::text AS emails_sent,
            COUNT(*) FILTER (WHERE action = 'sequence_sms_sent')::text AS sms_sent,
            MAX(created_at) FILTER (WHERE action = 'sequence_email_sent')::text AS last_email_at,
            MAX(created_at) FILTER (WHERE action = 'sequence_sms_sent')::text AS last_sms_at
          FROM audit_logs
          WHERE action IN ('sequence_email_sent', 'sequence_sms_sent')
          AND created_at > NOW() - INTERVAL '30 days'
        `),

        // Stage 7: replies / bounces / unsubscribes (last 30 days)
        pool.query<{
          replies: string; bounces: string; unsubscribes: string; last_reply_at: string | null;
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE action = 'inbound_message_processed')::text AS replies,
            COUNT(*) FILTER (WHERE action IN ('email_bounced', 'email_bounce_recorded'))::text AS bounces,
            COUNT(*) FILTER (WHERE action IN ('email_unsubscribed', 'contact_unsubscribed'))::text AS unsubscribes,
            MAX(created_at) FILTER (WHERE action = 'inbound_message_processed')::text AS last_reply_at
          FROM audit_logs
          WHERE created_at > NOW() - INTERVAL '30 days'
        `),

        // Stage 8: CRM audit updates (last 30 days)
        pool.query<{ count: string; last_at: string | null }>(`
          SELECT COUNT(*)::text AS count, MAX(created_at)::text AS last_at
          FROM audit_logs
          WHERE created_at > NOW() - INTERVAL '30 days'
        `),

        // System state
        storage.getSystemSetting("outboundGlobalPaused"),
        storage.getSystemSetting("outboundGlobalPausedReason"),
        storage.getSystemSetting("sms_a2p_status"),
        storage.getSystemSetting("email_only_mode"),
        storage.getSystemSetting("ghl_circuit_breaker_state"),
      ]);

      const utmRow = utmCaptureRow.rows[0] ?? { total: "0", with_utm: "0", with_gclid: "0", with_landing: "0" };
      const contactRow = contactStatsRow.rows[0] ?? { total: "0", new_last_7d: "0", new_last_30d: "0" };
      const enrollRow = enrollmentStatsRow.rows[0] ?? { total: "0", active: "0", paused: "0", completed: "0", last_at: null };
      const sendRow = sendStatsRow.rows[0] ?? { emails_sent: "0", sms_sent: "0", last_email_at: null, last_sms_at: null };
      const replyRow = replyBounceRow.rows[0] ?? { replies: "0", bounces: "0", unsubscribes: "0", last_reply_at: null };
      const auditRow = auditUpdateRow.rows[0] ?? { count: "0", last_at: null };
      const importRow = recentImportsRow.rows[0] ?? { count: "0", last_at: null };

      // Suppression breakdown
      const suppressionByAction: Record<string, number> = {};
      let totalSuppressed = 0;
      for (const r of suppressionRows.rows) {
        suppressionByAction[r.action] = parseInt(r.count, 10);
        totalSuppressed += parseInt(r.count, 10);
      }

      // Determine overall stage health
      function stageHealth(count: number, lastAt: string | null): "ok" | "warn" | "error" {
        if (count === 0 && !lastAt) return "warn";
        if (!lastAt) return "warn";
        const daysSince = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 7) return "warn";
        return "ok";
      }

      const isPaused = outboundPaused === true || outboundPaused === "true";
      const ghlSyncHealth = ghlStatus.configured
        ? (ghlStatus.unsyncedToGhl > 50 ? "warn" : "ok")
        : "error";

      res.json({
        generatedAt: new Date().toISOString(),

        systemState: {
          outboundGlobalPaused: isPaused,
          outboundGlobalPausedReason: typeof outboundPausedReason === "string" ? outboundPausedReason : null,
          smsA2pStatus: typeof smsA2pStatus === "string" ? smsA2pStatus : (smsA2pStatus ? "configured" : "not_configured"),
          emailOnlyMode: emailOnlyMode === true || emailOnlyMode === "true",
          ghlConfigured: ghlStatus.configured,
          ghlSyncHealth,
          circuitBreakerState: typeof circuitBreakerState === "string" ? circuitBreakerState : "closed",
          overallHealth: isPaused ? "warn" : (!ghlStatus.configured ? "warn" : "ok"),
        },

        stages: [
          {
            id: "lead_source",
            label: "Lead Source / UTM / Import",
            description: "Leads entering via forms, ads, CSV uploads, Sunbiz, or referrals",
            count: parseInt(utmRow.total, 10),
            countLabel: "total contacts",
            lastEventAt: recentContactsRow.rows[0]?.last_at ?? null,
            health: stageHealth(parseInt(utmRow.total, 10), recentContactsRow.rows[0]?.last_at ?? null),
            metrics: {
              total: parseInt(utmRow.total, 10),
              withUtm: parseInt(utmRow.with_utm, 10),
              withGclid: parseInt(utmRow.with_gclid, 10),
              withLandingPage: parseInt(utmRow.with_landing, 10),
              utmCaptureRate: parseInt(utmRow.total, 10) > 0
                ? Math.round((parseInt(utmRow.with_utm, 10) / parseInt(utmRow.total, 10)) * 100)
                : 0,
              recentImports: parseInt(importRow.count, 10),
              lastImportAt: importRow.last_at,
            },
            warnings: parseInt(utmRow.with_utm, 10) < parseInt(utmRow.total, 10) * 0.1
              ? ["Low UTM capture — add utm_source to ad URLs"]
              : [],
            bySource: leadSourceRows.rows.map(r => ({ source: r.source, count: parseInt(r.count, 10) })),
          },
          {
            id: "crm_contact",
            label: "Replit CRM / Contact Creation",
            description: "Contacts created and scored in the Replit CRM",
            count: parseInt(contactRow.new_last_30d, 10),
            countLabel: "new (30d)",
            lastEventAt: recentContactsRow.rows[0]?.last_at ?? null,
            health: stageHealth(parseInt(contactRow.new_last_30d, 10), recentContactsRow.rows[0]?.last_at ?? null),
            metrics: {
              totalContacts: parseInt(contactRow.total, 10),
              newLast7d: parseInt(contactRow.new_last_7d, 10),
              newLast30d: parseInt(contactRow.new_last_30d, 10),
            },
            warnings: [],
          },
          {
            id: "ghl_sync",
            label: "GHL Contact Sync",
            description: "Contact records pushed to GoHighLevel CRM",
            count: ghlStatus.syncedToGhl,
            countLabel: "synced to GHL",
            lastEventAt: typeof ghlStatus.lastSyncTo === "string" ? ghlStatus.lastSyncTo : null,
            health: ghlSyncHealth,
            metrics: {
              configured: ghlStatus.configured,
              syncedToGhl: ghlStatus.syncedToGhl,
              unsyncedToGhl: ghlStatus.unsyncedToGhl,
              totalContacts: ghlStatus.totalContacts,
              syncRate: ghlStatus.totalContacts > 0
                ? Math.round((ghlStatus.syncedToGhl / ghlStatus.totalContacts) * 100)
                : 0,
            },
            warnings: [
              ...(!ghlStatus.configured ? ["GHL not configured — contacts cannot sync"] : []),
              ...(ghlStatus.configured && ghlStatus.unsyncedToGhl > 50 ? [`${ghlStatus.unsyncedToGhl} contacts not yet synced to GHL`] : []),
            ],
          },
          {
            id: "sequence_enrollment",
            label: "Sequence Enrollment Decision",
            description: "Contacts evaluated for sequence enrollment with contactability gating",
            count: parseInt(enrollRow.total, 10),
            countLabel: "enrollments (30d)",
            lastEventAt: enrollRow.last_at,
            health: parseInt(enrollRow.total, 10) === 0 ? "warn" : "ok",
            metrics: {
              total: parseInt(enrollRow.total, 10),
              active: parseInt(enrollRow.active, 10),
              paused: parseInt(enrollRow.paused, 10),
              completed: parseInt(enrollRow.completed, 10),
            },
            warnings: [
              ...(isPaused ? ["Global outbound is paused — no new enrollments running"] : []),
              ...(parseInt(enrollRow.paused, 10) > parseInt(enrollRow.active, 10) * 2
                ? ["High paused:active ratio — check GHL sync and contactability gates"]
                : []),
            ],
          },
          {
            id: "send_gate",
            label: "Send Gate / Suppression Checks",
            description: "Contactability, DNC, bounce guard, daily cap, global pause enforcement",
            count: totalSuppressed,
            countLabel: "blocked sends (30d)",
            lastEventAt: null,
            health: totalSuppressed > 1000 ? "warn" : "ok",
            metrics: {
              totalBlocked: totalSuppressed,
              byReason: suppressionByAction,
            },
            warnings: [
              ...(suppressionByAction["sequence_enrollment_skipped_bad_email"] > 50
                ? [`${suppressionByAction["sequence_enrollment_skipped_bad_email"]} sends blocked for bad email — check email validation`]
                : []),
              ...(suppressionByAction["sequence_step_skipped_global_pause"] > 0
                ? ["Some sends skipped due to global pause"]
                : []),
            ],
          },
          {
            id: "ghl_transport",
            label: "GHL Transport (Email / SMS)",
            description: "Messages dispatched via GHL email and SMS channels",
            count: parseInt(sendRow.emails_sent, 10) + parseInt(sendRow.sms_sent, 10),
            countLabel: "sent (30d)",
            lastEventAt: sendRow.last_email_at ?? sendRow.last_sms_at,
            health: stageHealth(
              parseInt(sendRow.emails_sent, 10) + parseInt(sendRow.sms_sent, 10),
              sendRow.last_email_at ?? sendRow.last_sms_at,
            ),
            metrics: {
              emailsSent: parseInt(sendRow.emails_sent, 10),
              smsSent: parseInt(sendRow.sms_sent, 10),
              lastEmailAt: sendRow.last_email_at,
              lastSmsAt: sendRow.last_sms_at,
            },
            warnings: [
              ...(parseInt(sendRow.sms_sent, 10) === 0 ? ["No SMS sends recorded — SMS may be blocked (A2P?)"] : []),
            ],
          },
          {
            id: "ghl_reply",
            label: "GHL Reply / Bounce / Unsubscribe Webhook",
            description: "Inbound replies, bounces, and unsubscribes received from GHL",
            count: parseInt(replyRow.replies, 10) + parseInt(replyRow.bounces, 10) + parseInt(replyRow.unsubscribes, 10),
            countLabel: "events (30d)",
            lastEventAt: replyRow.last_reply_at,
            health: parseInt(replyRow.bounces, 10) > parseInt(sendRow.emails_sent, 10) * 0.05 ? "warn" : "ok",
            metrics: {
              replies: parseInt(replyRow.replies, 10),
              bounces: parseInt(replyRow.bounces, 10),
              unsubscribes: parseInt(replyRow.unsubscribes, 10),
            },
            warnings: [
              ...(parseInt(replyRow.bounces, 10) > parseInt(sendRow.emails_sent, 10) * 0.05
                ? ["Bounce rate >5% — clean the contact list"]
                : []),
            ],
          },
          {
            id: "crm_audit",
            label: "CRM Task / Audit Update",
            description: "Audit log entries written after each pipeline event",
            count: parseInt(auditRow.count, 10),
            countLabel: "audit events (30d)",
            lastEventAt: auditRow.last_at,
            health: stageHealth(parseInt(auditRow.count, 10), auditRow.last_at),
            metrics: {
              auditEvents30d: parseInt(auditRow.count, 10),
            },
            warnings: [],
          },
        ],

        leadSourceFields: {
          hasLeadSource: true,
          hasUtmSource: true,
          hasUtmMedium: true,
          hasUtmCampaign: true,
          hasUtmContent: true,
          hasUtmTerm: true,
          hasGclid: true,
          hasLandingPage: true,
          hasImportBatchId: true,
          hasSourceCategory: true,
          supportedSources: ["google_ads", "sunbiz", "imported_list", "referral", "organic", "outbound", "affiliate", "partner"],
        },
      });
    } catch (err: any) {
      console.error("[information-flow]", err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
