/**
 * Default transport implementations — GHL-backed.
 *
 * Import the singleton orchestrator from here rather than constructing your own.
 * To swap providers (e.g., replace GHL SMS with Twilio), update this file only.
 */

import { ChannelOrchestrator } from "../channel-orchestrator";
import { GhlEmailTransport } from "./ghl-email-transport";
import { GhlSmsTransport } from "./ghl-sms-transport";
import { GhlRvmTransport } from "./ghl-rvm-transport";

export { GhlEmailTransport } from "./ghl-email-transport";
export { GhlSmsTransport } from "./ghl-sms-transport";
export { GhlRvmTransport } from "./ghl-rvm-transport";

/**
 * Singleton ChannelOrchestrator with GHL transport adapters.
 * Use this for all outbound channel sends.
 */
export const channelOrchestrator = new ChannelOrchestrator({
  email: new GhlEmailTransport(),
  sms: new GhlSmsTransport(),
  rvm: new GhlRvmTransport(),
});
