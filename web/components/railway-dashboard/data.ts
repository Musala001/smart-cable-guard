import type { CableDetection, ReviewStatus } from "./types";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  awaiting: "Awaiting review",
  confirmed: "Confirmed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

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
    let s = String(value ?? "");
    if (/^\s*[=+\-@]/.test(s) && typeof value !== "number") s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...records.map((r) => columns.map((k) => quote(r[k])).join(","))].join("\r\n");
}