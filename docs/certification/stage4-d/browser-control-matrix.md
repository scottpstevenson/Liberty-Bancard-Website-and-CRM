# Browser control matrix

Not browser-verified in this pass (no signed-in browser session was available; the capture browser cannot sign in). The following were checked by source contract only (S4D-26, stage4c2-calendar-contract) and by the application workflow restarting without errors.

| Control | Test id | Roles | Verified by |
|---|---|---|---|
| Create provider appointment button / dialog (`button-create-provider-appointment`, `dialog-create-provider-appointment`) | Calendar.tsx | visible admin/manager; execute admin | source contract only |
| Campaign catalog badges (`badge-catalog-class-<id>`) | Campaigns.tsx | admin/manager; hidden when unreadable | source only |
| Held enrollment expiry note (`text-held-enrollment-expiry`) | ProgramHealthPanel.tsx | Program Health viewers | source only |

Open: a signed-in browser pass of these three controls at desktop and narrow widths.
