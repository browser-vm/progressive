import {
  QualityLevel,
  LoadingProgress,
  PredictivePreloadState,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  ImageBuffer,
} from "./types";
import { BufferPool } from "./bufferPool";

type ProgressCallback = (progress: LoadingProgress) => void;
type PreloadCallback = (quality: QualityLevel) => void;

/**
 * ImageBufferManager - Handles multi-resolution buffering with retry logic and progress tracking
 */
export class ImageBufferManager {
  private bufferPool: BufferPool;
  private retryConfig: RetryConfig;
  private currentImageId: string | null = null;
  private currentSource: string | null = null;
  private progressCallback: ProgressCallback | null = null;
  private preloadCallback: PreloadCallback | null = null;
  private preloadState: PredictivePreloadState = {
    direction: "idle",
    predictedQuality: "low",
    preloadQueued: false,
    lastZoomVelocity: 0,
  };
  private preloadTimeout: NodeJS.Timeout | null = null;
  private abortController: AbortController | null = null;

  constructor(bufferPool: BufferPool, retryConfig: Partial<RetryConfig> = {}) {
    this.bufferPool = bufferPool;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Set progress callback
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Set preload callback
   */
  onPreload(callback: PreloadCallback): void {
    this.preloadCallback = callback;
  }

  /**
   * Load image from ArrayBuffer with progressive decoding
   */
  async loadFromArrayBuffer(
    arrayBuffer: ArrayBuffer,
    source: string,
    imageId: string
  ): Promise<ImageBuffer[]> {
    this.abortIfNeeded();
    
    this.currentImageId = imageId;
    this.currentSource = source;
    this.bufferPool.clearAll();

    const loadedBuffers: ImageBuffer[] = [];

    // Create buffers for all quality levels
    const qualities: QualityLevel[] = ["low", "medium", "high"];
    
    for (const quality of qualities) {
      this.abortIfNeeded();
      
      try {
        const buffer = await this.loadBufferWithRetry(arrayBuffer, quality);
        loadedBuffers.push(buffer);
        
        // Report progress after each buffer loads
        this.reportProgress(
          "buffering",
          (qualities.indexOf(quality) + 1) / qualities.length * 100,
          arrayBuffer.byteLength,
          arrayBuffer.byteLength,
          quality,
          qualities.slice(0, qualities.indexOf(quality) + 1) as QualityLevel[]
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        console.error(`Failed to load ${quality} quality buffer:`, error);
      }
    }

    // Only report complete if at least one buffer loaded
    if (loadedBuffers.length > 0) {
      const successfullyLoaded = loadedBuffers.filter(b => b && b.quality);
      const lastLoadedQuality = successfullyLoaded.length > 0 
        ? successfullyLoaded[successfullyLoaded.length - 1].quality 
        : "low";
      this.reportProgress(
        "complete", 
        100, 
        arrayBuffer.byteLength, 
        arrayBuffer.byteLength, 
        lastLoadedQuality, 
        successfullyLoaded.map(b => b.quality)
      );
    } else {
      this.reportProgress("complete", 100, arrayBuffer.byteLength, arrayBuffer.byteLength, "low", []);
    }

    return loadedBuffers;
  }

  /**
   * Load image from URL with progressive loading
   */
  async loadFromUrl(
    url: string,
    imageId: string,
    signal?: AbortSignal
  ): Promise<ImageBuffer[]> {
    this.abortIfNeeded();
    
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    
    const effectiveSignal = signal || this.abortController.signal;

    this.currentImageId = imageId;
    this.currentSource = url;
    this.bufferPool.clearAll();

    const loadedBuffers: ImageBuffer[] = [];
    const qualities: QualityLevel[] = ["low", "medium", "high"];

    // First, fetch the full image
    this.reportProgress("fetching", 0, 0, 0, "low", []);

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    
    try {
      const response = await fetch(url, { signal: effectiveSignal });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      const chunks: Uint8Array[] = [];
      let receivedLength = 0;
      const contentLength = response.headers.get("content-length");
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      while (true) {
        this.abortIfNeeded();
        
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;

        if (totalBytes > 0) {
          const progress = (receivedLength / totalBytes) * 100;
          this.reportProgress("fetching", progress, receivedLength, totalBytes, "low", []);
        }
      }

      // Combine chunks into single array
      const fullBuffer = new Uint8Array(receivedLength);
      let position = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, position);
        position += chunk.length;
      }

      // Release reader lock before processing
      reader.releaseLock();

      // Now load each quality level
      for (const quality of qualities) {
        this.abortIfNeeded();
        
        try {
          const buffer = await this.loadBufferWithRetry(fullBuffer.buffer, quality);
          loadedBuffers.push(buffer);
          
          const bufferProgress = ((qualities.indexOf(quality) + 1) / qualities.length) * 100;
          this.reportProgress(
            "buffering",
            bufferProgress,
            receivedLength,
            receivedLength,
            quality,
            qualities.slice(0, qualities.indexOf(quality) + 1) as QualityLevel[]
          );
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw error;
          }
          console.error(`Failed to load ${quality} quality buffer:`, error);
        }
      }

      this.reportProgress("complete", 100, receivedLength, receivedLength, "high", qualities);

    } finally {
      reader?.releaseLock();
    }

    return loadedBuffers;
  }

  /**
   * Load a single buffer with retry logic
   */
  private async loadBufferWithRetry(
    arrayBuffer: ArrayBuffer,
    quality: QualityLevel
  ): Promise<ImageBuffer> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        this.abortIfNeeded();
        
        // Create buffer entry
        const buffer = this.bufferPool.createBuffer(quality, 0, 0);
        this.bufferPool.setBufferLoading(quality, 0);

        // Simulate different compression levels based on quality
        // In a real implementation, this would use an image processing library
        const blob = await this.processImage(arrayBuffer, quality);
        
        this.abortIfNeeded();
        
        const blobUrl = URL.createObjectURL(blob);
        
        // Get dimensions from the blob
        const dimensions = await this.getImageDimensions(blobUrl);
        
        // Update buffer with actual data
        const arrayBufferCopy = await blob.arrayBuffer();
        this.bufferPool.updateBuffer(
          quality,
          arrayBufferCopy,
          blobUrl,
          100
        );

        // Update dimensions
        const finalBuffer = this.bufferPool.getBuffer(quality);
        if (finalBuffer) {
          finalBuffer.width = dimensions.width;
          finalBuffer.height = dimensions.height;
        }

        return finalBuffer!;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.retryConfig.maxRetries) {
          await this.delay(delay);
          delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelay);
        }
      }
    }

    this.bufferPool.setBufferError(quality, lastError!);
    throw lastError;
  }

  /**
   * Process image to generate different quality versions
   * In a real implementation, this would use canvas or a WASM image processor
   */
  private async processImage(arrayBuffer: ArrayBuffer, quality: QualityLevel): Promise<Blob> {
    return new Promise((resolve, reject) => {
      // Create image from buffer
      const blob = new Blob([arrayBuffer]);
      const url = URL.createObjectURL(blob);
      
      const img = new Image();
      img.onload = () => {
        try {
          // Calculate target dimensions based on quality
          const scaleFactors: Record<QualityLevel, number> = {
            low: 0.25,
            medium: 0.5,
            high: 1,
          };
          
          const scale = scaleFactors[quality];
          const targetWidth = Math.max(1, Math.round(img.width * scale));
          const targetHeight = Math.max(1, Math.round(img.height * scale));

          // Use canvas to resize
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to get canvas context"));
            return;
          }
          
          // Use better scaling for quality
          ctx.imageSmoothingEnabled = quality !== "low";
          ctx.imageSmoothingQuality = quality === "high" ? "high" : "medium";
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          // Clean up original URL
          URL.revokeObjectURL(url);

          // Convert to blob
          canvas.toBlob(
            (result) => {
              if (result) {
                resolve(result);
              } else {
                reject(new Error("Failed to create blob"));
              }
            },
            "image/webp",
            quality === "high" ? 0.92 : quality === "medium" ? 0.8 : 0.6
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  }

  /**
   * Get image dimensions from URL
   */
  private getImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
  }

  /**
   * Update predictive preloading based on zoom changes
   */
  updatePreloadPrediction(
    currentQuality: QualityLevel,
    zoomDirection: "in" | "out" | "idle",
    zoomVelocity: number
  ): void {
    const newState: PredictivePreloadState = {
      direction: zoomDirection,
      predictedQuality: currentQuality,
      preloadQueued: false,
      lastZoomVelocity: zoomVelocity,
    };

    // Determine predicted quality based on zoom direction
    if (zoomDirection === "in") {
      newState.predictedQuality = this.bufferPool.getNextQuality(currentQuality, "up") || "high";
    } else if (zoomDirection === "out") {
      newState.predictedQuality = this.bufferPool.getNextQuality(currentQuality, "down") || "low";
    }

    // Queue preload if prediction changed
    if (
      newState.predictedQuality !== this.preloadState.predictedQuality ||
      zoomDirection !== this.preloadState.direction
    ) {
      this.queuePreload(newState.predictedQuality);
    }

    this.preloadState = newState;
  }

  /**
   * Queue a preload operation
   */
  private queuePreload(quality: QualityLevel): void {
    if (this.preloadTimeout) {
      clearTimeout(this.preloadTimeout);
    }

    // Small delay to debounce rapid zoom changes
    this.preloadTimeout = setTimeout(() => {
      if (this.preloadCallback && !this.bufferPool.isQualityLoaded(quality)) {
        this.preloadCallback(quality);
      }
    }, 150);
  }

  /**
   * Report loading progress
   */
  private reportProgress(
    phase: LoadingProgress["phase"],
    percent: number,
    bytesLoaded: number,
    totalBytes: number,
    currentQuality: QualityLevel,
    bufferedQualities: QualityLevel[]
  ): void {
    if (this.progressCallback) {
      const progress: LoadingProgress = {
        phase,
        percent: Math.min(100, Math.max(0, percent)),
        bytesLoaded,
        totalBytes,
        currentQuality,
        bufferedQualities,
        estimatedTimeRemaining: this.estimateTimeRemaining(percent, bytesLoaded, totalBytes),
      };
      this.progressCallback(progress);
    }
  }

  /**
   * Estimate remaining time based on current progress
   */
  private estimateTimeRemaining(
    percent: number,
    bytesLoaded: number,
    totalBytes: number
  ): number | null {
    if (percent >= 100 || bytesLoaded === 0 || totalBytes === 0) {
      return null;
    }

    // Simple estimation - assume linear progress
    const bytesPerPercent = bytesLoaded / percent;
    const remainingBytes = totalBytes - bytesLoaded;
    const remainingPercent = remainingBytes / bytesPerPercent;

    // Assume 100ms per percent (very rough estimate)
    return remainingPercent * 100;
  }

  /**
   * Abort if signal is aborted
   */
  private abortIfNeeded(): void {
    if (this.abortController?.signal.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Abort all operations
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.preloadTimeout) {
      clearTimeout(this.preloadTimeout);
    }
  }

  /**
   * Get preload state
   */
  getPreloadState(): PredictivePreloadState {
    return { ...this.preloadState };
  }

  /**
   * Get buffer pool
   */
  getBufferPool(): BufferPool {
    return this.bufferPool;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.abort();
    this.bufferPool.clearAll();
    this.progressCallback = null;
    this.preloadCallback = null;
  }
}
