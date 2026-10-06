/** Existing local conversation text; no transport or message delivery. */
export function ticketStatusMessage(status:string, merchantName="there") {
  return ({
    "In Progress": `Hi ${merchantName} — just a quick heads up that we've picked this up and are actively working on it. You don't need to do anything right now — we'll follow up as soon as we have something for you.\n\nIf anything changes on your end in the meantime, feel free to reply here or give us a call at 954-266-8214.`,
    "Waiting on Merchant": `Hey ${merchantName} — we've looked into this and we need a couple of things from your side before we can move forward. Check the notes above for details on what we need.\n\nNo rush, but the sooner we get that info the faster we can wrap this up for you. Just reply here or email support@libertybancard.com and we'll pick it right back up.`,
    "Resolved": `Hi ${merchantName} — good news, this one's been taken care of. Here's a quick recap of what we did:\n\nIf everything looks good on your end, you're all set. If anything comes up again or doesn't seem right, just let us know — we're always here.\n\nThanks for your patience, and thanks for being with Liberty Bancard.`,
    "Closed": `This ticket has been closed. If you need further help with this issue or anything else, you can always open a new request at libertybancard.com/support or call us at 954-266-8214.\n\nWe appreciate your business.`,
  } as Record<string,string>)[status];
}
