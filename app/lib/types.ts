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

// Advanced Buffering Types

export type BufferStatus = "pending" | "loading" | "loaded" | "error" | "discarded";

export interface ImageBuffer {
  id: string;
  quality: QualityLevel;
  data: ArrayBuffer | null;
  blobUrl: string | null;
  width: number;
  height: number;
  size: number;
  status: BufferStatus;
  loadProgress: number;
  error: Error | null;
  createdAt: number;
  lastAccessedAt: number;
  retryCount: number;
}

export interface BufferPoolConfig {
  maxBuffers: number;
  maxMemoryMB: number;
  bufferTTL: number; // Time to live in ms
  preloadAhead: number; // How many quality levels to preload ahead
}

export interface LoadingProgress {
  phase: "fetching" | "decoding" | "buffering" | "complete";
  percent: number;
  bytesLoaded: number;
  totalBytes: number;
  currentQuality: QualityLevel;
  bufferedQualities: QualityLevel[];
  estimatedTimeRemaining: number | null;
}

export interface PredictivePreloadState {
  direction: "in" | "out" | "idle";
  predictedQuality: QualityLevel;
  preloadQueued: boolean;
  lastZoomVelocity: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_BUFFER_POOL_CONFIG: BufferPoolConfig = {
  maxBuffers: 10,
  maxMemoryMB: 500,
  bufferTTL: 5 * 60 * 1000, // 5 minutes
  preloadAhead: 2,
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 500,
  maxDelay: 10000,
  backoffMultiplier: 2,
};
