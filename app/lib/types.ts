// Progressive Image Types

export type QualityLevel = "low" | "medium" | "high";

export interface ImageSource {
  src: string;
  quality: QualityLevel;
  width: number;
  height: number;
}

export interface ProgressiveImageState {
  currentSource: ImageSource | null;
  loadedQualities: Set<QualityLevel>;
  isLoading: boolean;
  error: string | null;
}

export interface ZoomState {
  level: number;
  min: number;
  max: number;
}

export const QUALITY_THRESHOLDS: Record<QualityLevel, { minZoom: number; maxZoom: number }> = {
  low: { minZoom: 0, maxZoom: 1.5 },
  medium: { minZoom: 1.5, maxZoom: 3 },
  high: { minZoom: 3, maxZoom: Infinity },
};

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
