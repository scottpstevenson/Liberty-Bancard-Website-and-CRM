/**
 * Recipient facts, not provider/source/container labels, determine email type.
 * Classification does not establish deliverability or authorize a send.
 */
const ROLE_MAILBOX = /^(info|sales|support|contact|office|admin|billing|accounts|accounting|hello|help|service|services|team|reception|appointments|booking|bookings|enquiries|inquiries|customerservice|orders|general|marketing|dispatch|operations|reservations)$/i;

export type SfpRecipientType = "role_inbox" | "corroborated_business_contact" | "named_employee" | "unresolved";
export function classifySfpRecipientFacts(input: {
  address: string; subjectType: string; personNameEvidence?: string | null;
  verifiedBusinessAssociation: boolean;
}): { type: SfpRecipientType; namedContact: boolean; roleInbox: boolean; businessAssociated: boolean } {
  const localPart = input.address.trim().split("@")[0]?.split("+")[0] ?? "";
  const roleInbox = ROLE_MAILBOX.test(localPart);
  const name = input.personNameEvidence?.trim() ?? "";
  const actualPersonName = !!name && !/^(owner|staff|customer|merchant|contact|business|office|info|sales|unknown|n\/a)$/i.test(name);
  const namedContact = !roleInbox && actualPersonName;
  return {
    type: roleInbox ? "role_inbox" : namedContact ? "named_employee"
      : input.verifiedBusinessAssociation ? "corroborated_business_contact" : "unresolved",
    roleInbox,namedContact,businessAssociated: input.verifiedBusinessAssociation,
  };
}