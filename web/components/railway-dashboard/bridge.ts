// Shared localStorage bridge between the detector and the dashboard.
import type { CableDetection } from "./types";

export const DETECTIONS_KEY = "cableguard_detections";
export const INSPECTIONS_KEY = "cableguard_inspections";

type IncidentLike = {
  id: number; cls: number; sev: string; conf: number; ts: number;
  thumb: string; region: string; areaFrac: number; persist: number;
  action: string; geo: { lat: number; lon: number; acc: number } | null;
};

type AILike = {
  cablePresent: string; observation: string; condition: string;
  concerns: string; verdict: string;
} | null;

export type InspectionRecord = {
  id: string;
  createdAt: string;
  mode: string;
  operator: string;
  frames: number;
  durationSec: number;
  geo: { lat: number; lon: number; acc: number } | null;
  hero: string | null;
  ai: AILike;
  findings: {
    id: string; cls: number; className: string; sev: string; conf: number;
    ts: number; thumb: string; region: string; areaFrac: number;
    persist: number; action: string; lat: number | null; lon: number | null;
  }[];
};

const CLASS_NAMES = ["Break", "Thunderbolt (arc)", "Foreign object"];

// ---- map points (unchanged) ----
export function incidentToDetection(inc: IncidentLike, inspectionId: string): CableDetection | null {
  if (!inc.geo) return null;
  const cls = CLASS_NAMES[inc.cls] ?? "Cable fault";
  return {
    id: `CG-${inc.ts}`,
    type: "Damaged cable",
    latitude: inc.geo.lat,
    longitude: inc.geo.lon,
    confidence: inc.conf,
    status: "awaiting",
    location: `${inc.geo.lat.toFixed(4)}, ${inc.geo.lon.toFixed(4)}`,
    chainageKm: null,
    detectedAt: new Date(inc.ts).toISOString(),
    inspectionId,
    imageUrl: inc.thumb,
    cause: `${cls} · ${inc.sev} · ${inc.region}`,
    note: "",
  };
}

export function readDetections(): CableDetection[] {
  try { const r = localStorage.getItem(DETECTIONS_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
export function appendDetections(items: CableDetection[]) {
  if (!items.length) return;
  const byId = new Map(readDetections().map((d) => [d.id, d]));
  for (const it of items) byId.set(it.id, it);
  const merged = [...byId.values()].sort((a, b) => (Date.parse(b.detectedAt || "") || 0) - (Date.parse(a.detectedAt || "") || 0)).slice(0, 500);
  try { localStorage.setItem(DETECTIONS_KEY, JSON.stringify(merged)); } catch {}
}
export function writeDetections(items: CableDetection[]) {
  try { localStorage.setItem(DETECTIONS_KEY, JSON.stringify(items)); } catch {}
}

// ---- full inspection records (for reports) ----
export function readInspections(): InspectionRecord[] {
  try { const r = localStorage.getItem(INSPECTIONS_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
export function writeInspections(items: InspectionRecord[]) {
  try { localStorage.setItem(INSPECTIONS_KEY, JSON.stringify(items)); } catch {}
}
export function saveInspection(rec: InspectionRecord) {
  const all = readInspections().filter((x) => x.id !== rec.id);
  const merged = [rec, ...all].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 100);
  writeInspections(merged);
}

export function buildInspection(args: {
  incidents: IncidentLike[]; ai: AILike; mode: string; frames: number;
  durationSec: number; hero: string | null; geo: IncidentLike["geo"]; operator: string;
}): InspectionRecord | null {
  if (args.incidents.length === 0 && !args.ai) return null;
  const id = `INS-${Date.now()}`;
  return {
    id,
    createdAt: new Date().toISOString(),
    mode: args.mode,
    operator: args.operator,
    frames: args.frames,
    durationSec: args.durationSec,
    geo: args.geo,
    hero: args.hero,
    ai: args.ai,
    findings: args.incidents.map((i) => ({
      id: `${id}-${i.id}`, cls: i.cls, className: CLASS_NAMES[i.cls] ?? "Cable fault",
      sev: i.sev, conf: i.conf, ts: i.ts, thumb: i.thumb, region: i.region,
      areaFrac: i.areaFrac, persist: i.persist, action: i.action,
      lat: i.geo?.lat ?? null, lon: i.geo?.lon ?? null,
    })),
  };
}