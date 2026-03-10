import { useState, useCallback, useEffect, useRef } from "react";
import { 
  QualityLevel, 
  ImageSource, 
  ProgressiveImageState,
  ZoomState,
  QUALITY_THRESHOLDS,
  MAX_FILE_SIZE
} from "../lib/types";

interface UseProgressiveImageReturn {
  // State
  imageState: ProgressiveImageState;
  zoomState: ZoomState;
  
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

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);

  // Determine quality level from zoom
  const getQualityFromZoom = useCallback((zoom: number): QualityLevel => {
    if (zoom >= QUALITY_THRESHOLDS.high.minZoom) return "high";
    if (zoom >= QUALITY_THRESHOLDS.medium.minZoom) return "medium";
    return "low";
  }, []);

  // Load image from local file
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

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = dataUrl;
      });

      const loadedQualities = new Set<QualityLevel>(["low"]);
      
      setImageState({
        currentSource: {
          src: dataUrl,
          quality: "low",
          width: img.width,
          height: img.height,
        },
        loadedQualities,
        isLoading: false,
        error: null,
      });

      // Pre-load higher quality versions for larger images
      if (img.width * img.height > 2000 * 2000) {
        // For large images, we would ideally generate multiple resolution variants
        // In this implementation, we mark medium as available after a delay
        setTimeout(() => {
          setImageState(prev => ({
            ...prev,
            loadedQualities: new Set([...prev.loadedQualities, "medium"]),
          }));
        }, 1000);

        setTimeout(() => {
          setImageState(prev => ({
            ...prev,
            loadedQualities: new Set([...prev.loadedQualities, "high"]),
          }));
        }, 2000);
      } else {
        // Small images get all qualities immediately
        setImageState(prev => ({
          ...prev,
          loadedQualities: new Set(["low", "medium", "high"]),
        }));
      }

      setZoomState(prev => ({ ...prev, level: 1 }));

    } catch (err) {
      setImageState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load image",
      }));
    }
  }, []);

  // Load image from URL via API
  const loadFromUrl = useCallback(async (url: string, apiUrl: string): Promise<void> => {
    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

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
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `API error: ${response.status}`);
      }

      // Get raw Base64 string from response
      const base64String = await response.text();
      
      // Convert Base64 to data URL
      const dataUrl = `data:image/webp;base64,${base64String}`;
      
      // Load the image to get dimensions
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to decode optimized image"));
        img.src = dataUrl;
      });

      setImageState({
        currentSource: {
          src: dataUrl,
          quality: "high",
          width: img.width,
          height: img.height,
        },
        loadedQualities: new Set(["low", "medium", "high"]),
        isLoading: false,
        error: null,
      });

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
    }
  }, []);

  // Clear image
  const clearImage = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setImageState({
      currentSource: null,
      loadedQualities: new Set(),
      isLoading: false,
      error: null,
    });
    setZoomState(prev => ({ ...prev, level: 1 }));
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setZoomState(prev => ({
      ...prev,
      level: Math.min(prev.level * 1.5, prev.max),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState(prev => ({
      ...prev,
      level: Math.max(prev.level / 1.5, prev.min),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setZoomState(prev => ({ ...prev, level: 1 }));
  }, []);

  const setZoom = useCallback((level: number) => {
    setZoomState(prev => ({
      ...prev,
      level: Math.max(prev.min, Math.min(prev.max, level)),
    }));
  }, []);

  const handleWheelZoom = useCallback((delta: number) => {
    const factor = delta > 0 ? 0.9 : 1.1;
    setZoomState(prev => ({
      ...prev,
      level: Math.max(prev.min, Math.min(prev.max, prev.level * factor)),
    }));
  }, []);

  // Computed values
  const currentQuality = getQualityFromZoom(zoomState.level);
  const canZoomIn = zoomState.level < zoomState.max;
  const canZoomOut = zoomState.level > zoomState.min;

  // Update quality when zoom changes
  useEffect(() => {
    if (imageState.currentSource) {
      const newQuality = getQualityFromZoom(zoomState.level);
      setImageState(prev => {
        if (prev.currentSource && prev.currentSource.quality !== newQuality) {
          return {
            ...prev,
            currentSource: {
              ...prev.currentSource,
              quality: newQuality,
            },
          };
        }
        return prev;
      });
    }
  }, [zoomState.level, getQualityFromZoom, imageState.currentSource]);

  return {
    imageState,
    zoomState,
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
  };
}
