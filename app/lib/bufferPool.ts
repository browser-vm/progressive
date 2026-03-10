import {
  ImageBuffer,
  QualityLevel,
  BufferPoolConfig,
  DEFAULT_BUFFER_POOL_CONFIG,
  BufferStatus,
} from "./types";

/**
 * BufferPool - Manages efficient memory allocation for image buffers
 * Implements LRU eviction and memory tracking
 */
export class BufferPool {
  private buffers: Map<string, ImageBuffer> = new Map();
  private config: BufferPoolConfig;
  private currentMemoryUsage: number = 0;
  private listeners: Set<(buffers: ImageBuffer[]) => void> = new Set();

  constructor(config: Partial<BufferPoolConfig> = {}) {
    this.config = { ...DEFAULT_BUFFER_POOL_CONFIG, ...config };
  }

  /**
   * Create a new buffer entry in the pool
   */
  createBuffer(quality: QualityLevel, width: number, height: number): ImageBuffer {
    const id = this.generateBufferId(quality);
    
    const buffer: ImageBuffer = {
      id,
      quality,
      data: null,
      blobUrl: null,
      width,
      height,
      size: 0,
      status: "pending",
      loadProgress: 0,
      error: null,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      retryCount: 0,
    };

    this.buffers.set(id, buffer);
    this.notifyListeners();
    
    return buffer;
  }

  /**
   * Get a buffer by quality level
   */
  getBuffer(quality: QualityLevel): ImageBuffer | undefined {
    const id = this.generateBufferId(quality);
    const buffer = this.buffers.get(id);
    
    if (buffer && buffer.status === "loaded") {
      // Update last accessed time (LRU)
      buffer.lastAccessedAt = Date.now();
    }
    
    return buffer;
  }

  /**
   * Update buffer with loaded data
   */
  updateBuffer(
    quality: QualityLevel,
    data: ArrayBuffer,
    blobUrl: string,
    loadProgress: number
  ): ImageBuffer | undefined {
    const id = this.generateBufferId(quality);
    const buffer = this.buffers.get(id);
    
    if (!buffer) return undefined;

    // Release old resources
    if (buffer.blobUrl) {
      URL.revokeObjectURL(buffer.blobUrl);
      this.currentMemoryUsage -= buffer.size;
    }

    buffer.data = data;
    buffer.blobUrl = blobUrl;
    buffer.size = data.byteLength;
    buffer.status = "loaded";
    buffer.loadProgress = loadProgress;
    buffer.lastAccessedAt = Date.now();

    this.currentMemoryUsage += buffer.size;

    // Check memory limits and evict if needed
    this.enforceMemoryLimits();

    this.notifyListeners();
    
    return buffer;
  }

  /**
   * Mark buffer as loading
   */
  setBufferLoading(quality: QualityLevel, progress: number): void {
    const buffer = this.getBuffer(quality);
    if (buffer) {
      buffer.status = "loading";
      buffer.loadProgress = progress;
      this.notifyListeners();
    }
  }

  /**
   * Mark buffer as errored
   */
  setBufferError(quality: QualityLevel, error: Error): void {
    const buffer = this.getBuffer(quality);
    if (buffer) {
      buffer.status = "error";
      buffer.error = error;
      buffer.retryCount++;
      this.notifyListeners();
    }
  }

  /**
   * Discard a buffer to free memory
   */
  discardBuffer(quality: QualityLevel): void {
    const id = this.generateBufferId(quality);
    const buffer = this.buffers.get(id);
    
    if (buffer) {
      if (buffer.blobUrl) {
        URL.revokeObjectURL(buffer.blobUrl);
        this.currentMemoryUsage -= buffer.size;
      }
      buffer.status = "discarded";
      buffer.data = null;
      buffer.blobUrl = null;
      buffer.size = 0;
      this.notifyListeners();
    }
  }

  /**
   * Clear all buffers
   */
  clearAll(): void {
    for (const [id, buffer] of this.buffers) {
      if (buffer.blobUrl) {
        URL.revokeObjectURL(buffer.blobUrl);
      }
    }
    this.buffers.clear();
    this.currentMemoryUsage = 0;
    this.notifyListeners();
  }

  /**
   * Get all loaded buffers
   */
  getAllBuffers(): ImageBuffer[] {
    return Array.from(this.buffers.values()).filter(
      (b) => b.status === "loaded"
    );
  }

  /**
   * Get buffer status
   */
  getBufferStatus(quality: QualityLevel): BufferStatus | undefined {
    return this.getBuffer(quality)?.status;
  }

  /**
   * Get current memory usage in MB
   */
  getMemoryUsageMB(): number {
    return this.currentMemoryUsage / (1024 * 1024);
  }

  /**
   * Check if a quality level is loaded
   */
  isQualityLoaded(quality: QualityLevel): boolean {
    const buffer = this.getBuffer(quality);
    return buffer?.status === "loaded";
  }

  /**
   * Get the next quality level to load based on current
   */
  getNextQuality(current: QualityLevel, direction: "up" | "down"): QualityLevel | null {
    const levels: QualityLevel[] = ["low", "medium", "high"];
    const currentIndex = levels.indexOf(current);
    
    if (direction === "up") {
      return currentIndex < levels.length - 1 ? levels[currentIndex + 1] : null;
    } else {
      return currentIndex > 0 ? levels[currentIndex - 1] : null;
    }
  }

  /**
   * Subscribe to buffer changes
   */
  subscribe(listener: (buffers: ImageBuffer[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Generate unique buffer ID
   */
  private generateBufferId(quality: QualityLevel): string {
    return `buffer_${quality}_${Date.now()}`;
  }

  /**
   * Enforce memory limits by evicting LRU buffers
   */
  private enforceMemoryLimits(): void {
    const maxMemoryBytes = this.config.maxMemoryMB * 1024 * 1024;
    const maxBuffers = this.config.maxBuffers;

    // Evict by memory limit
    while (
      this.currentMemoryUsage > maxMemoryBytes &&
      this.buffers.size > 0
    ) {
      this.evictLRU();
    }

    // Evict by buffer count
    while (this.buffers.size > maxBuffers) {
      this.evictLRU();
    }

    // Evict expired buffers
    this.evictExpired();
  }

  /**
   * Evict least recently used buffer
   */
  private evictLRU(): void {
    let oldest: ImageBuffer | null = null;
    let oldestId: string | null = null;

    for (const [id, buffer] of this.buffers) {
      if (buffer.status === "loaded" && (!oldest || buffer.lastAccessedAt < oldest.lastAccessedAt)) {
        oldest = buffer;
        oldestId = id;
      }
    }

    if (oldestId && oldest) {
      this.discardBuffer(oldest.quality);
    }
  }

  /**
   * Evict expired buffers based on TTL
   */
  private evictExpired(): void {
    const now = Date.now();
    
    for (const [id, buffer] of this.buffers) {
      if (buffer.status === "loaded" && now - buffer.lastAccessedAt > this.config.bufferTTL) {
        this.discardBuffer(buffer.quality);
      }
    }
  }

  /**
   * Notify listeners of changes
   */
  private notifyListeners(): void {
    const buffers = this.getAllBuffers();
    this.listeners.forEach((listener) => listener(buffers));
  }
}

// Export singleton instance
export const bufferPool = new BufferPool();
