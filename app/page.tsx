"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useProgressiveImage } from "./hooks/useProgressiveImage";
import { LoadingProgress } from "./lib/types";

type InputMode = "file" | "url";

interface ProcessingState {
  isProcessing: boolean;
  progress: number;
  message: string;
}

// Helper function to get loading message
const getLoadingMessage = (progress: LoadingProgress): string => {
  switch (progress.phase) {
    case "fetching":
      return `Fetching image... ${progress.percent.toFixed(0)}%`;
    case "decoding":
      return "Decoding image...";
    case "buffering":
      return `Creating ${progress.currentQuality} quality buffer...`;
    case "complete":
      return "Image loaded";
    default:
      return "Loading...";
  }
};

export default function Home() {
  // Input state
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [urlInput, setUrlInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Use progressive image hook with advanced buffering
  const {
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
    loadingProgress,
    preloadState,
    memoryUsage,
  } = useProgressiveImage();

  // Get API URL from environment
  const apiUrl = process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_API;

  // Compute processing state from loading progress
  const processing: ProcessingState = useMemo(() => ({
    isProcessing: imageState.isLoading,
    progress: loadingProgress?.percent || 0,
    message: loadingProgress ? getLoadingMessage(loadingProgress) : "",
  }), [imageState.isLoading, loadingProgress]);

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    await loadFromFile(file);
  }, [loadFromFile]);

  // Handle URL submission with processing state
  const handleUrlSubmit = useCallback(async () => {
    if (!urlInput.trim()) return;
    if (!apiUrl) return;

    await loadFromUrl(urlInput.trim(), apiUrl);
  }, [urlInput, apiUrl, loadFromUrl]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  // Computed zoom state
  const canZoomIn = zoomState.level < zoomState.max;
  const canZoomOut = zoomState.level > zoomState.min;

  // Get quality badge class
  const getQualityBadgeClass = (quality: string) => {
    switch (quality) {
      case "high": return "quality-badge high";
      case "medium": return "quality-badge medium";
      default: return "quality-badge low";
    }
  };

  // Get blur amount based on quality
  const getBlurAmount = (quality: string) => {
    switch (quality) {
      case "high": return "blur(0px)";
      case "medium": return "blur(1px)";
      default: return "blur(2px)";
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background gradient */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 20% 20%, rgba(0, 122, 255, 0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(88, 86, 214, 0.1) 0%, transparent 50%)",
        }}
      />

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row h-screen">
        {/* Left panel - Controls */}
        <aside className="w-full lg:w-[420px] p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 overflow-y-auto">
          {/* Header */}
          <header className="animate-slide-up">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
              Progressive Image Viewer
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Zoom in to enhance detail progressively
            </p>
          </header>

          {/* Input Panel */}
          <div className="glass-panel-solid p-5 animate-slide-up delay-100">
            {/* Tabs */}
            <div className="flex gap-2 mb-5">
              <button
                className={`tab-button flex-1 ${inputMode === "file" ? "active" : ""}`}
                onClick={() => setInputMode("file")}
              >
                📁 Upload
              </button>
              <button
                className={`tab-button flex-1 ${inputMode === "url" ? "active" : ""}`}
                onClick={() => setInputMode("url")}
              >
                🔗 URL
              </button>
            </div>

            {/* File Input */}
            {inputMode === "file" && (
              <div
                className={`dropzone ${isDragging ? "active" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
                <div className="text-4xl mb-3">📂</div>
                <p className="text-white/80 font-medium">
                  Drop image here or click to browse
                </p>
                <p className="text-white/40 text-sm mt-2">
                  Supports files up to 500MB
                </p>
              </div>
            )}

            {/* URL Input */}
            {inputMode === "url" && (
              <div className="flex flex-col gap-4">
                <input
                  type="url"
                  className="input-ios"
                  placeholder="https://example.com/image.jpg"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
                />
                <button
                  className="btn-ios"
                  onClick={handleUrlSubmit}
                  disabled={processing.isProcessing || !urlInput.trim() || !apiUrl}
                >
                  {processing.isProcessing ? "Processing..." : "Optimize & Load"}
                </button>
                {!apiUrl && (
                  <p className="text-yellow-400/70 text-xs text-center">
                    ⚠️ API not configured. Set NEXT_PUBLIC_IMAGE_OPTIMIZER_API
                  </p>
                )}
              </div>
            )}

            {/* Error display */}
            {imageState.error && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm">
                {imageState.error}
              </div>
            )}

            {/* Processing indicator */}
            {processing.isProcessing && (
              <div className="mt-4">
                <div className="flex justify-between text-sm text-white/60 mb-2">
                  <span>{processing.message}</span>
                  <span>{processing.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-bar-fill" 
                    style={{ width: `${processing.progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Zoom Controls */}
          {imageState.currentSource && (
            <>
              <div className="glass-panel-solid p-5 animate-slide-up delay-200">
                <h3 className="text-sm font-semibold text-white/80 mb-4">Zoom Controls</h3>
                <div className="flex items-center gap-4">
                  <button 
                    className="zoom-control" 
                    onClick={zoomOut}
                    disabled={!canZoomOut}
                    title="Zoom Out"
                  >
                    −
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-3xl font-semibold">{zoomState.level.toFixed(1)}x</span>
                    <p className="text-white/40 text-xs mt-1">
                      {currentQuality === "high" ? "Full Detail" : 
                       currentQuality === "medium" ? "Enhanced Detail" : "Preview"}
                    </p>
                  </div>
                  <button 
                    className="zoom-control" 
                    onClick={zoomIn}
                    disabled={!canZoomIn}
                    title="Zoom In"
                  >
                    +
                  </button>
                </div>
                <div className="mt-4">
                  <input
                    type="range"
                    min={zoomState.min}
                    max={zoomState.max}
                    step="0.1"
                    value={zoomState.level}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn-ios-secondary flex-1"
                    onClick={resetZoom}
                  >
                    Reset
                  </button>
                  <button
                    className="btn-ios-secondary flex-1"
                    onClick={clearImage}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Image Info */}
              <div className="glass-panel-solid p-5 animate-slide-up delay-300">
                <h3 className="text-sm font-semibold text-white/80 mb-3">Image Info</h3>
                <div className="space-y-2 text-sm text-white/60">
                  <div className="flex justify-between">
                    <span>Dimensions</span>
                    <span>{imageState.currentSource.width} × {imageState.currentSource.height}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Zoom Level</span>
                    <span>{zoomState.level.toFixed(2)}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quality Tier</span>
                    <span className={currentQuality === "high" ? "text-green-400" : 
                                         currentQuality === "medium" ? "text-orange-400" : "text-gray-400"}>
                      {currentQuality.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Loaded Tiers</span>
                    <span className="text-blue-400">
                      {[...imageState.loadedQualities].join(", ")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Buffer Memory</span>
                    <span className="text-cyan-400">
                      {memoryUsage.toFixed(2)} MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Preload Direction</span>
                    <span className="text-purple-400">
                      {preloadState.direction === "in" ? "↑ Zoom In" : 
                       preloadState.direction === "out" ? "↓ Zoom Out" : "— Idle"}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        {/* Right panel - Image Viewer */}
        <section className="flex-1 p-4 lg:p-6 flex flex-col">
          <div className="flex-1 glass-panel-solid relative overflow-hidden">
            {imageState.currentSource ? (
              <div
                ref={imageContainerRef}
                className="absolute inset-0 flex items-center justify-center"
                onWheel={(e) => {
                  e.preventDefault();
                  handleWheelZoom(e.deltaY);
                }}
              >
                {/* Progressive rendered image */}
                <img
                  src={imageState.currentSource.src}
                  alt="Progressive loaded image"
                  className="max-w-full max-h-full transition-all duration-300 ease-out"
                  style={{
                    transform: `scale(${zoomState.level})`,
                    filter: getBlurAmount(currentQuality),
                  }}
                  draggable={false}
                />
                
                {/* Quality indicator */}
                <span className={getQualityBadgeClass(currentQuality)}>
                  {currentQuality === "high" ? "HD" : 
                   currentQuality === "medium" ? "SD" : "Preview"}
                </span>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30">
                <div className="text-6xl mb-4">🖼️</div>
                <p className="text-lg">No image loaded</p>
                <p className="text-sm mt-2">Upload a file or enter a URL to get started</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
