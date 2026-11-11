/**
 * Document title and page heading of /get-started (the application path; the terminal inquiry entrance keeps its own
 * record in shared/public-terminal-inquiry.ts). The server document (server/ssr/pages.ts) and the React page
 * (client/src/pages/GetStarted.tsx) both read this record, so the headline and title a visitor or crawler sees before
 * the page loads are the ones they see after it loads. Same pattern as shared/public-locations.ts.
 *
 * No database or server imports: the client bundle imports this file.
 */

export const GET_STARTED_PATH = "/get-started";

const HEADING_LEAD = "Start Accepting Payments";
const HEADING_ACCENT = "with Liberty Bancard";

export const GET_STARTED_PAGE = {
  path: GET_STARTED_PATH,
  /** The complete document title, site name included (63 characters). The React page passes brandSuffix={false}. */
  title: "Get Started with Liberty Bancard | Merchant Account Application",
  /** The page's one h1: the React hero renders headingLead and headingAccent in two colours, the server document renders heading. */
  headingLead: HEADING_LEAD,
  headingAccent: HEADING_ACCENT,
  heading: `${HEADING_LEAD} ${HEADING_ACCENT}`,
} as const;
