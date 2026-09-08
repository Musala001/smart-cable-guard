import type { CableDetection, ReviewStatus } from "./types";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  awaiting: "Awaiting review",
  confirmed: "Confirmed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const RAIL_ROUTES: [number, number][][] = [
  [
    [-33.9226, 18.4262], [-33.9205, 18.433], [-33.923, 18.445],
    [-33.9275, 18.455], [-33.927, 18.463], [-33.922, 18.474],
    [-33.9165, 18.486], [-33.9195, 18.495], [-33.9255, 18.505],
    [-33.9315, 18.51], [-33.939, 18.515],
  ],
  [
    [-33.927, 18.463], [-33.937, 18.468], [-33.944, 18.472],
    [-33.951, 18.474], [-33.9575, 18.472], [-33.964, 18.468],
    [-33.976, 18.467],
  ],
];

export const STATIONS = [
  { name: "Central", position: RAIL_ROUTES[0][0] },
  { name: "Woodstock", position: RAIL_ROUTES[0][2] },
  { name: "Salt River", position: RAIL_ROUTES[0][4] },
  { name: "East Junction", position: RAIL_ROUTES[0][7] },
  { name: "Depot", position: RAIL_ROUTES[0][10] },
  { name: "Observatory", position: RAIL_ROUTES[1][2] },
  { name: "Southern Yard", position: RAIL_ROUTES[1][6] },
];

export function createSampleDetections(assetBasePath = "/rail-dashboard"): CableDetection[] {
  const entries: [string, number, number, number, string, number, ReviewStatus][] = [
    ["F-018", 0, 7, 0.35, "East Junction", 0.94, "awaiting"],
    ["F-017", 0, 8, 0.65, "Near Depot", 0.91, "awaiting"],
    ["F-016", 0, 0, 0.35, "Central", 0.88, "awaiting"],
    ["F-015", 1, 1, 0.55, "Observatory", 0.96, "confirmed"],
    ["F-014", 0, 3, 0.45, "Salt River", 0.93, "awaiting"],
    ["F-013", 0, 1, 0.5, "Woodstock", 0.89, "awaiting"],
    ["F-012", 1, 2, 0.6, "Mowbray", 0.87, "awaiting"],
    ["F-011", 0, 5, 0.5, "Maitland", 0.95, "confirmed"],
    ["F-010", 0, 6, 0.45, "East Junction", 0.9, "awaiting"],
    ["F-009", 1, 4, 0.5, "Rosebank", 0.97, "awaiting"],
    ["F-008", 0, 9, 0.7, "Depot", 0.92, "confirmed"],
    ["F-007", 1, 5, 0.5, "Southern Yard", 0.84, "awaiting"],
    ["F-006", 0, 2, 0.55, "Woodstock", 0.9, "awaiting"],
    ["F-005", 0, 4, 0.5, "Salt River", 0.85, "confirmed"],
    ["F-004", 1, 0, 0.55, "Observatory", 0.91, "awaiting"],
    ["F-003", 1, 3, 0.5, "Mowbray", 0.86, "awaiting"],
    ["F-002", 0, 7, 0.85, "Pinelands", 0.88, "resolved"],
    ["F-001", 0, 1, 0.15, "Central", 0.95, "resolved"],
  ];

  return entries.map(([id, route, index, t, location, confidence, status], row) => {
    const a = RAIL_ROUTES[route][index];
    const b = RAIL_ROUTES[route][index + 1];
    return {
      id,
      type: "Damaged cable",
      latitude: a[0] + (b[0] - a[0]) * t,
      longitude: a[1] + (b[1] - a[1]) * t,
      confidence,
      status,
      location,
      chainageKm: Number((1.2 + (index + t) * 1.4).toFixed(1)),
      detectedAt: new Date(Date.UTC(2026, 8, 8, 9, 42) - row * 27 * 60_000).toISOString(),
      inspectionId: `INS-00${Math.floor(row / 5) + 1}`,
      imageUrl: `${assetBasePath.replace(/\/$/, "")}/cable-demo.png`,
      bbox: [0.43, 0.38, 0.2, 0.23],
      cause: "Not established",
      note: status === "resolved" ? "Demonstration review: repair recorded during follow-up inspection." : "",
      isDemo: true,
    };
  });
}

function text(value: unknown, name: string, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${name} must be non-empty text of at most ${max} characters.`);
  }
  return value.trim();
}

export function validateImport(input: unknown): CableDetection[] {
  const candidate = input as { detections?: unknown };
  const list = Array.isArray(input) ? input : candidate?.detections;
  if (!Array.isArray(list) || list.length < 1 || list.length > 2_000) {
    throw new Error("Provide an array of 1–2,000 detections, or an object with a detections array.");
  }

  const seen = new Set<string>();
  return list.map((unknownRecord, index) => {
    try {
      if (!unknownRecord || typeof unknownRecord !== "object") throw new Error("The detection must be an object.");
      const record = unknownRecord as Record<string, unknown>;
      const id = text(record.id, "id", 80);
      const type = text(record.type, "type", 80);
      if (type !== "Damaged cable") throw new Error('type must be "Damaged cable" for this dashboard.');
      if (seen.has(id)) throw new Error(`Duplicate id: ${id}.`);
      seen.add(id);

      const latitude = record.latitude;
      const longitude = record.longitude;
      if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 85.05112878) {
        throw new Error("latitude must be between -85.05112878 and 85.05112878.");
      }
      if (typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        throw new Error("longitude must be between -180 and 180.");
      }

      let confidence: number | null = null;
      if (record.confidence != null) {
        if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
          throw new Error("confidence must be between 0 and 1.");
        }
        confidence = record.confidence;
      }

      const status = (record.status ?? "awaiting") as ReviewStatus;
      if (!Object.prototype.hasOwnProperty.call(STATUS_LABEL, status)) {
        throw new Error("status must be awaiting, confirmed, resolved or dismissed.");
      }

      let detectedAt: string | null = null;
      if (record.detectedAt != null) {
        if (
          typeof record.detectedAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(record.detectedAt) ||
          !/(Z|[+-]\d{2}:\d{2})$/.test(record.detectedAt) ||
          !Number.isFinite(Date.parse(record.detectedAt))
        ) throw new Error("detectedAt must be an ISO timestamp with timezone.");
        detectedAt = record.detectedAt;
      }

      let imageUrl: string | undefined;
      if (record.imageUrl != null) {
        const raw = text(record.imageUrl, "imageUrl", 2_048);
        if (raw.startsWith("/")) imageUrl = raw;
        else {
          const url = new URL(raw);
          if (url.protocol !== "https:" || url.username || url.password) {
            throw new Error("imageUrl must be a local path or HTTPS URL without credentials.");
          }
          imageUrl = url.href;
        }
      }

      let bbox: CableDetection["bbox"];
      if (record.bbox != null) {
        if (
          !Array.isArray(record.bbox) || record.bbox.length !== 4 ||
          record.bbox.some((number) => typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1)
        ) throw new Error("bbox must be [x, y, width, height] using values from 0 to 1.");
        const box = record.bbox as [number, number, number, number];
        if (box[2] === 0 || box[3] === 0 || box[0] + box[2] > 1 || box[1] + box[3] > 1) {
          throw new Error("bbox must stay inside the image.");
        }
        bbox = box;
      }

      const chainageKm = record.chainageKm == null ? null : record.chainageKm;
      if (chainageKm !== null && (typeof chainageKm !== "number" || !Number.isFinite(chainageKm) || chainageKm < 0)) {
        throw new Error("chainageKm must be a non-negative number.");
      }

      return {
        id,
        type: "Damaged cable",
        latitude,
        longitude,
        confidence,
        status,
        location: record.location ? text(record.location, "location") : "Unlabelled location",
        chainageKm: chainageKm as number | null,
        detectedAt,
        inspectionId: record.inspectionId ? text(record.inspectionId, "inspectionId", 80) : "Imported inspection",
        imageUrl,
        bbox,
        cause: record.cause ? text(record.cause, "cause", 500) : "Not established",
        note: record.note ? text(record.note, "note", 1_500) : "",
        isDemo: false,
      };
    } catch (error) {
      throw new Error(`Detection ${index + 1}: ${(error as Error).message}`);
    }
  }).sort((a, b) => (Date.parse(b.detectedAt ?? "") || 0) - (Date.parse(a.detectedAt ?? "") || 0));
}

export function filterDetections(
  records: CableDetection[],
  filters: { search?: string; status?: ReviewStatus | "all"; inspection?: string | null },
) {
  const query = filters.search?.trim().toLowerCase() ?? "";
  return records.filter((record) => {
    const matchesSearch = !query || `${record.id} ${record.location} ${record.inspectionId}`.toLowerCase().includes(query);
    return matchesSearch &&
      (!filters.status || filters.status === "all" || record.status === filters.status) &&
      (!filters.inspection || record.inspectionId === filters.inspection);
  });
}

export function recordsToCsv(records: CableDetection[]) {
  const columns: (keyof CableDetection)[] = [
    "id", "type", "location", "latitude", "longitude", "confidence", "status",
    "detectedAt", "inspectionId", "chainageKm", "cause", "note",
  ];
  const quote = (value: unknown) => {
    let string = String(value ?? "");
    if (/^\s*[=+\-@]/.test(string) && typeof value !== "number") string = `'${string}`;
    return `"${string.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...records.map((record) => columns.map((key) => quote(record[key])).join(","))].join("\r\n");
}
