// The city and vertical definitions live in shared/public-locations.ts so the server documents, the
// client routes, the sitemap and /areas-served read one inventory. This file keeps the names the
// server routes and scripts/seo-audit.ts already import.
export {
  LOCATION_CITIES as CITIES,
  LOCATION_VERTICALS as VERTICALS,
  getLocationCity as getCityData,
  getLocationVertical as getVerticalData,
  isValidLocationCombination,
} from "../../shared/public-locations";
export type { LocationCity as CityData, LocationVertical as VerticalData } from "../../shared/public-locations";
