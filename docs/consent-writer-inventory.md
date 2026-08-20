# BT-04A consent writer inventory

Canonical semantic consent and suppression writes are routed through
`applyConsentCommand`:

- public forms and unsubscribe links
- campaign unsubscribe webhooks
- inbox STOP/angry actions
- GHL unsubscribe and DND webhooks
- workflow unsubscribe actions
- SDR operator edits and GHL opt-out handling
- dashboard contact global-DNC actions
- generic dashboard contact creation strips authority-owned fields before the
  GHL pre-write and local insert; evidence-backed consent uses a later canonical
  command rather than a create payload
- SDR contact-to-lead bridge starts a distinct SDR subject as unknown/not consented
- bounce and communication feedback append reachability facts before their
  compatibility projection; feedback never mutates consent or global suppression
- SDR webhook opt-outs and call DNC dispositions bind to an SDR lead-state
  consent subject before compatibility compliance views are updated
- SDR CRM webhook matching appends canonical contact opt-out/DNC evidence before
  attempting best-effort enrollment suppression, so queue failures cannot drop a withdrawal
- PEWC evidence capture

Delivery-only feedback (`communication-feedback` and `bounce-feedback`) writes
reachability through `recordReachabilityObservation`; it must not mutate
consent fields. Legacy contact and SDR fields are compatibility projections
written by the reducer, not independent authority.

The static guard is `npm run test:consent-writer-dominance`. Provider sink
enforcement and delivery reconciliation intentionally remain BT-04B/BT-04C.