import { npsStatsReadSchema, npsRecordsReadSchema } from "@shared/nps-observation";

async function read(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error("NPS source unavailable");
  return response.json();
}
export async function readNpsStats(signal?: AbortSignal) {
  return npsStatsReadSchema.parse(await read("/api/nps/stats", signal));
}
export async function readNpsRecords(signal?: AbortSignal) {
  return npsRecordsReadSchema.parse(await read("/api/nps", signal));
}
