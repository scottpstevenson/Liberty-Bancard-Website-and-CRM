// Static inline illustrations for the Home payment-setup block (Mobile and Online contexts). They are
// plain SVG strings so the React page and the server-rendered Home emit identical markup. They are
// decorative (the surrounding text names each context), contain no text, and show no real product.

const NAVY = "#071D57";
const BLUE = "#174B93";
const RED = "#C8102E";
const LINE = "#D9E0EC";

/** Phone shape: navy body, white screen, a blue header bar, two content lines and a red confirm button. */
export const HOME_VISUAL_PHONE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 144" width="96" height="144" focusable="false" aria-hidden="true">` +
  `<rect x="26" y="8" width="44" height="128" rx="9" fill="${NAVY}"/>` +
  `<rect x="31" y="20" width="34" height="100" rx="3" fill="#fff"/>` +
  `<rect x="35" y="26" width="26" height="8" rx="2" fill="${BLUE}"/>` +
  `<rect x="35" y="42" width="26" height="4" rx="2" fill="${LINE}"/>` +
  `<rect x="35" y="50" width="18" height="4" rx="2" fill="${LINE}"/>` +
  `<rect x="35" y="96" width="26" height="12" rx="3" fill="${RED}"/>` +
  `<rect x="40" y="12" width="16" height="3" rx="1.5" fill="#fff" opacity=".35"/>` +
  `<rect x="40" y="126" width="16" height="3" rx="1.5" fill="#fff" opacity=".5"/>` +
  `</svg>`;

/** Browser-window shape: navy title bar with three dots, a blue banner, content lines and a red button. */
export const HOME_VISUAL_BROWSER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 144" width="96" height="144" focusable="false" aria-hidden="true">` +
  `<rect x="6" y="36" width="84" height="72" rx="8" fill="#fff" stroke="${NAVY}" stroke-width="3"/>` +
  `<path d="M6 44a8 8 0 0 1 8-8h68a8 8 0 0 1 8 8v8H6z" fill="${NAVY}"/>` +
  `<circle cx="15" cy="44" r="2.2" fill="#fff" opacity=".8"/>` +
  `<circle cx="23" cy="44" r="2.2" fill="#fff" opacity=".8"/>` +
  `<circle cx="31" cy="44" r="2.2" fill="#fff" opacity=".8"/>` +
  `<rect x="14" y="60" width="44" height="9" rx="2" fill="${BLUE}"/>` +
  `<rect x="14" y="74" width="68" height="4" rx="2" fill="${LINE}"/>` +
  `<rect x="14" y="82" width="52" height="4" rx="2" fill="${LINE}"/>` +
  `<rect x="14" y="92" width="28" height="10" rx="3" fill="${RED}"/>` +
  `</svg>`;
