import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  QualityLevel,
  ImageSource,
  ProgressiveImageState,
  ZoomState,
  QUALITY_THRESHOLDS,
  MAX_FILE_SIZE,
  LoadingProgress,
  PredictivePreloadState,
} from "../lib/types";
import { BufferPool } from "../lib/bufferPool";
import { ImageBufferManager } from "../lib/imageBufferManager";

interface UseProgressiveImageReturn {
  // State
  imageState: ProgressiveImageState;
  zoomState: ZoomState;
  loadingProgress: LoadingProgress | null;
  preloadState: PredictivePreloadState;

  // Image loading
  loadFromFile: (file: File) => Promise<void>;
  loadFromUrl: (url: string, apiUrl: string) => Promise<void>;
  clearImage: () => void;

  // Zoom controls
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoom: (level: number) => void;
  handleWheelZoom: (delta: number) => void;

  // Computed
  currentQuality: QualityLevel;
  canZoomIn: boolean;
  canZoomOut: boolean;

  // Buffer info
  memoryUsage: number;
}

export function useProgressiveImage(): UseProgressiveImageReturn {
  // Image state
  const [imageState, setImageState] = useState<ProgressiveImageState>({
    currentSource: null,
    loadedQualities: new Set(),
    isLoading: false,
    error: null,
  });

  // Zoom state
  const [zoomState, setZoomState] = useState<ZoomState>({
    level: 1,
    min: 0.5,
    max: 10,
  });

  // Loading progress
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);

  // Preload state
  const [preloadState, setPreloadState] = useState<PredictivePreloadState>({
    direction: "idle",
    predictedQuality: "low",
    preloadQueued: false,
    lastZoomVelocity: 0,
  });

  // Refs for managers
  const bufferPoolRef = useRef<BufferPool | null>(null);
  const bufferManagerRef = useRef<ImageBufferManager | null>(null);
  const lastZoomRef = useRef<number>(1);
  const zoomHistoryRef = useRef<number[]>([]);

  // Initialize buffer pool and manager
  useEffect(() => {
    bufferPoolRef.current = new BufferPool();
    bufferManagerRef.current = new ImageBufferManager(bufferPoolRef.current);

    // Set up progress callback
    bufferManagerRef.current.onProgress((progress) => {
      setLoadingProgress(progress);
    });

    // Set up preload callback
    bufferManagerRef.current.onPreload((quality) => {
      console.log(`Preloading quality: ${quality}`);
      // In a real implementation, this would trigger actual loading
    });

    return () => {
      bufferManagerRef.current?.dispose();
    };
  }, []);

  // Determine quality level from zoom
  const getQualityFromZoom = useCallback((zoom: number): QualityLevel => {
    if (zoom >= QUALITY_THRESHOLDS.high.minZoom) return "high";
    if (zoom >= QUALITY_THRESHOLDS.medium.minZoom) return "medium";
    return "low";
  }, []);

  // Track zoom direction for predictive preloading
  const trackZoomDirection = useCallback((newZoom: number, oldZoom: number) => {
    const direction = newZoom > oldZoom ? "in" : newZoom < oldZoom ? "out" : "idle";
    const velocity = Math.abs(newZoom - oldZoom);

    // Track zoom history for velocity calculation
    zoomHistoryRef.current.push(velocity);
    if (zoomHistoryRef.current.length > 5) {
      zoomHistoryRef.current.shift();
    }

    const avgVelocity = zoomHistoryRef.current.reduce((a, b) => a + b, 0) / zoomHistoryRef.current.length;
    const currentQuality = getQualityFromZoom(newZoom);

    // Update preload state
    bufferManagerRef.current?.updatePreloadPrediction(currentQuality, direction, avgVelocity);

    setPreloadState(bufferManagerRef.current?.getPreloadState() || {
      direction,
      predictedQuality: getQualityFromZoom(newZoom),
      preloadQueued: false,
      lastZoomVelocity: avgVelocity,
    });
  }, [getQualityFromZoom]);

  // Load image from local file with ArrayBuffer
  const loadFromFile = useCallback(async (file: File): Promise<void> => {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setImageState(prev => ({
        ...prev,
        error: `File size exceeds 500MB limit. Selected: ${(file.size / 1024 / 1024).toFixed(2)}MB`
      }));
      return;
    }

    setImageState({
      currentSource: null,
      loadedQualities: new Set(),
      isLoading: true,
      error: null,
    });

    setLoadingProgress({
      phase: "fetching",
      percent: 0,
      bytesLoaded: 0,
      totalBytes: file.size,
      currentQuality: "low",
      bufferedQualities: [],
      estimatedTimeRemaining: null,
    });

    try {
      // Read file as ArrayBuffer for more efficient handling
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsArrayBuffer(file);
      });

      const imageId = `file_${Date.now()}`;

      // Load buffers using the manager
      await bufferManagerRef.current?.loadFromArrayBuffer(arrayBuffer, file.name, imageId);

      // Get the high quality buffer for dimensions
      const bufferPool = bufferPoolRef.current;
      const highBuffer = bufferPool?.getBuffer("high");

      if (highBuffer && highBuffer.blobUrl) {
        const loadedQualities = new Set<QualityLevel>(["low", "medium", "high"]);

        setImageState({
          currentSource: {
            src: highBuffer.blobUrl!,
            quality: "high",
            width: highBuffer.width,
            height: highBuffer.height,
          },
          loadedQualities,
          isLoading: false,
          error: null,
        });

        setLoadingProgress({
          phase: "complete",
          percent: 100,
          bytesLoaded: file.size,
          totalBytes: file.size,
          currentQuality: "high",
          bufferedQualities: ["low", "medium", "high"],
          estimatedTimeRemaining: null,
        });
      }

      setZoomState(prev => ({ ...prev, level: 1 }));

    } catch (err) {
      setImageState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load image",
      }));
      setLoadingProgress(null);
    }
  }, []);

  // Load image from URL via API
  const loadFromUrl = useCallback(async (url: string, apiUrl: string): Promise<void> => {
    // Cancel any previous request
    bufferManagerRef.current?.abort();

    setImageState({
      currentSource: null,
      loadedQualities: new Set(),
      isLoading: true,
      error: null,
    });

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `API error: ${response.status}`);
      }

      // Get raw Base64 string from response
      const base64String = await response.text();

      // Convert Base64 to ArrayBuffer
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      const imageId = `url_${Date.now()}`;

      // Load buffers using the manager
      await bufferManagerRef.current?.loadFromArrayBuffer(arrayBuffer, url, imageId);

      // Get the high quality buffer for dimensions
      const bufferPool = bufferPoolRef.current;
      const highBuffer = bufferPool?.getBuffer("high");

      if (highBuffer && highBuffer.blobUrl) {
        const loadedQualities = new Set<QualityLevel>(["low", "medium", "high"]);

        setImageState({
          currentSource: {
            src: highBuffer.blobUrl!,
            quality: "high",
            width: highBuffer.width,
            height: highBuffer.height,
          },
          loadedQualities,
          isLoading: false,
          error: null,
        });
      }

      setZoomState(prev => ({ ...prev, level: 1 }));

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Request was cancelled
      }
      setImageState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to process image",
      }));
      setLoadingProgress(null);
    }
  }, []);

  // Clear image
  const clearImage = useCallback(() => {
    bufferManagerRef.current?.abort();
    bufferPoolRef.current?.clearAll();
    setImageState({
      currentSource: null,
      loadedQualities: new Set(),
      isLoading: false,
      error: null,
    });
    setZoomState(prev => ({ ...prev, level: 1 }));
    setLoadingProgress(null);
    setPreloadState({
      direction: "idle",
      predictedQuality: "low",
      preloadQueued: false,
      lastZoomVelocity: 0,
    });
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setZoomState(prev => {
      const newLevel = Math.min(prev.level * 1.5, prev.max);
      trackZoomDirection(newLevel, prev.level);
      return {
        ...prev,
        level: newLevel,
      };
    });
  }, [trackZoomDirection]);

  const zoomOut = useCallback(() => {
    setZoomState(prev => {
      const newLevel = Math.max(prev.level / 1.5, prev.min);
      trackZoomDirection(newLevel, prev.level);
      return {
        ...prev,
        level: newLevel,
      };
    });
  }, [trackZoomDirection]);

  const resetZoom = useCallback(() => {
    setZoomState(prev => {
      trackZoomDirection(1, prev.level);
      return { ...prev, level: 1 };
    });
  }, [trackZoomDirection]);

  const setZoom = useCallback((level: number) => {
    setZoomState(prev => {
      const newLevel = Math.max(prev.min, Math.min(prev.max, level));
      trackZoomDirection(newLevel, prev.level);
      return {
        ...prev,
        level: newLevel,
      };
    });
  }, [trackZoomDirection]);

  const handleWheelZoom = useCallback((delta: number) => {
    const factor = delta > 0 ? 0.9 : 1.1;
    setZoomState(prev => {
      const newLevel = Math.max(prev.min, Math.min(prev.max, prev.level * factor));
      trackZoomDirection(newLevel, prev.level);
      return {
        ...prev,
        level: newLevel,
      };
    });
  }, [trackZoomDirection]);

  // Computed values
  const currentQuality = getQualityFromZoom(zoomState.level);
  const canZoomIn = zoomState.level < zoomState.max;
  const canZoomOut = zoomState.level > zoomState.min;

  // Memory usage
  const memoryUsage = useMemo(() => {
    return bufferPoolRef.current?.getMemoryUsageMB() || 0;
  }, [imageState]);

  // Update quality when zoom changes - switch to appropriate buffer
  useEffect(() => {
    if (imageState.currentSource && bufferPoolRef.current) {
      const newQuality = getQualityFromZoom(zoomState.level);
      const buffer = bufferPoolRef.current.getBuffer(newQuality);

      if (buffer && buffer.blobUrl && buffer.status === "loaded") {
        setImageState(prev => {
          if (prev.currentSource && prev.currentSource.quality !== newQuality) {
            return {
              ...prev,
              currentSource: {
                ...prev.currentSource,
                src: buffer.blobUrl!,
                quality: newQuality,
                width: buffer.width,
                height: buffer.height,
              },
            };
          }
          return prev;
        });
      }
    }

    lastZoomRef.current = zoomState.level;
  }, [zoomState.level, getQualityFromZoom, imageState.currentSource]);

  return {
    imageState,
    zoomState,
    loadingProgress,
    preloadState,
    loadFromFile,
    loadFromUrl,
    clearImage,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    handleWheelZoom,
    currentQuality,
    canZoomIn,
    canZoomOut,
    memoryUsage,
  };
}
