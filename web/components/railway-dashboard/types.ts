export type ReviewStatus = "awaiting" | "confirmed" | "resolved" | "dismissed";

export type CableDetection = {
  id: string;
  type: "Damaged cable";
  latitude: number;
  longitude: number;
  confidence: number | null;
  status: ReviewStatus;
  location: string;
  chainageKm: number | null;
  detectedAt: string | null;
  inspectionId: string;
  imageUrl?: string;
  bbox?: [number, number, number, number];
  cause: string;
  note: string;
  isDemo?: boolean;
};

export type DashboardProps = {
  initialDetections?: CableDetection[];
  onReviewSave?: (detection: CableDetection, review: { status: ReviewStatus; note: string }) => void | Promise<void>;
  workspaceName?: string;
  assetBasePath?: string;
};
