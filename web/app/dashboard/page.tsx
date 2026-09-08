"use client";

import { useEffect, useState, useCallback } from "react";
import { RailwayDashboard, type CableDetection, type ReviewStatus } from "../../components/railway-dashboard";
import {
  readDetections, writeDetections, DETECTIONS_KEY,
  readInspections, writeInspections, INSPECTIONS_KEY, type InspectionRecord,
} from "../../components/railway-dashboard/bridge";

export default function DashboardPage() {
  const [detections, setDetections] = useState<CableDetection[] | null>(null);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);

  const refresh = useCallback(() => {
    setDetections(readDetections());
    setInspections(readInspections());
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => { if (e.key === DETECTIONS_KEY || e.key === INSPECTIONS_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(refresh, 4000);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(id); };
  }, [refresh]);

  const saveReview = useCallback(async (detection: CableDetection, review: { status: ReviewStatus; note: string }) => {
    const all = readDetections();
    const next = all.map((d) => d.id === detection.id ? { ...d, status: review.status, note: review.note } : d);
    writeDetections(next);
    setDetections(next);
  }, []);

  const deleteInspection = useCallback((id: string) => {
    const next = readInspections().filter((x) => x.id !== id);
    writeInspections(next);
    setInspections(next);
  }, []);

  if (detections === null) return null;

  return (
    <RailwayDashboard
      initialDetections={detections.length ? detections : undefined}
      inspections={inspections}
      onReviewSave={saveReview}
      onDeleteInspection={deleteInspection}
      workspaceName="Cable-Guard"
    />
  );
}
