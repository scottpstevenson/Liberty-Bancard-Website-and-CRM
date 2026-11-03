# Browser control matrix

| Control | Test id | Verified by |
|---|---|---|
| New provider appointment button / dialog / create console (purpose, IANA zone, disabled preview, no apply before preview, touch targets, fit, no sideways scroll) | `button-create-provider-appointment`, `booking-create-panel` | **Real browser**, 1280/768/390 x light/dark, `test-stage4c2-workspace-browser.ts` (173 checks pass) |
| Add local event (separate label) | `button-add-event` | Real browser, same run |
| Campaign ownership filter and catalog badges | `campaign-ownership-filter`, `badge-catalog-class-<id>` | **Not browser-verified**; syntax-checked and built only |
| Held enrollment expiry note | `text-held-enrollment-expiry` | **Not browser-verified**; source/cert only |
| Roles: manager and agent sessions on the Calendar | existing role matrix in the suite | Real browser (existing suite section) |

Not run: `test-stage4b-workspace-browser.ts`, `test-stage4c1-browser.ts`.
