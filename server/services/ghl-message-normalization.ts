/** Official HighLevel message contract (search is a conversation projection,
 * not an occurrence). Identity is provider/location/message, never channel,
 * conversation, timestamp or body. Unknown projections are not guessed. */
export type NormalizedGhlMessage = {
  id:string; providerMessageId:string; ghlConversationId:string;
  channel:"email"|"sms"|"ghl_chat"|"voicemail"; direction:"inbound";
  receivedAt:string; body:string; voicemailUrl?:string|null;
  voicemailDuration?:number|null; transcript?:string|null;
};
export function normalizeGhlMessage(locationId:string, raw:any): NormalizedGhlMessage | null {
  if(!raw || typeof raw.id!=="string" || !raw.id || raw.locationId!==locationId ||
    typeof raw.conversationId!=="string" || !raw.conversationId ||
    typeof raw.dateAdded!=="string" || !Number.isFinite(Date.parse(raw.dateAdded))) {
    throw new Error("GHL_MESSAGE_IDENTITY_UNAVAILABLE");
  }
  if(raw.direction==="outbound") return null;
  if(raw.direction!=="inbound") throw new Error("GHL_MESSAGE_DIRECTION_UNAVAILABLE");
  const type=String(raw.messageType ?? "").toUpperCase().replace(/^TYPE_/,"");
  const channel = ["SMS","CAMPAIGN_SMS","SMS_REVIEW_REQUEST","SMS_NO_SHOW_REQUEST"].includes(type)?"sms"
    : ["EMAIL","CAMPAIGN_EMAIL"].includes(type)?"email"
    : ["WEBCHAT","LIVE_CHAT"].includes(type)?"ghl_chat"
     : ["VOICEMAIL","CAMPAIGN_VOICEMAIL"].includes(type) ? "voicemail" : null;
  // A call, including missed/inbound calls, is not proof of voicemail.
  if(!channel) return null;
  return {id:`ghl:${encodeURIComponent(locationId)}::message:${encodeURIComponent(raw.id)}`,
    providerMessageId:raw.id,ghlConversationId:raw.conversationId,channel,direction:"inbound",
    receivedAt:new Date(raw.dateAdded).toISOString(),body:typeof raw.body==="string"?raw.body.slice(0,2000):"",
    ...(channel==="voicemail"?{voicemailUrl:raw.voicemailUrl ?? raw.meta?.voicemailUrl ?? null,
      voicemailDuration:typeof raw.meta?.callDuration==="number"?raw.meta.callDuration:null,
      transcript:typeof raw.transcript==="string"?raw.transcript:null}:{})};
}
