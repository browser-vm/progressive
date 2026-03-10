# Progressive Image Viewer

A modern, responsive web application featuring progressive image loading tied to user zoom interactions, enveloped in a sleek iOS-inspired glassmorphism UI.

![Progressive Image Viewer](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-cyan)

## Features

- **Progressive Image Loading**: Image detail enhances as you zoom in using a multi-resolution quality tier system
- **Two Input Methods**: 
  - Direct local file uploads (supports files up to 500MB)
  - Remote URL inputs via Image-to-WebP Optimizer API
- **iOS-Inspired Design**: Modern glassmorphism UI with blur effects and smooth animations
- **Responsive Layout**: Works on desktop and mobile devices
- **Zoom Controls**: Mouse wheel, slider, and button controls for intuitive zoom interaction

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (or npm/yarn/bun)

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env.local
```

### Configuration

Edit `.env.local` and set your Image-to-WebP Optimizer API URL:

```env
NEXT_PUBLIC_IMAGE_OPTIMIZER_API=https://your-workspace--image-to-webp-optimizer-optimize-image.modal.run
```

> **Note**: You'll need to deploy your own Image-to-WebP Optimizer API using Modal or similar service. See the `openapi.yaml` for API specifications.

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
pnpm build
pnpm start
```

## Usage

### Upload Local File

1. Click the "Upload" tab
2. Drag and drop an image file or click to browse
3. The image loads with a blur effect at low quality
4. Use mouse wheel, slider, or +/- buttons to zoom in
5. As zoom increases, quality progressively improves

### Load from URL

1. Click the "URL" tab
2. Enter the image URL
3. Click "Optimize & Load"
4. The image is processed through the WebP Optimizer API
5. View and zoom as with local files

## Quality Tiers

The progressive rendering engine uses three quality tiers based on zoom level:

| Zoom Level | Quality | Blur | Badge |
|------------|---------|------|-------|
| 0.5x - 1.5x | Low | 2px | Preview |
| 1.5x - 3x | Medium | 1px | SD |
| 3x+ | High | 0px | HD |

## Tech Stack

- **Framework**: Next.js 16
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **State Management**: React Hooks
- **API**: REST (Image-to-WebP Optimizer)

## Project Structure

```
progressive/
├── app/
│   ├── globals.css       # Global styles with glassmorphism
│   ├── layout.tsx        # Root layout
│   ├── page.tsx          # Main application page
│   ├── hooks/
│   │   └── useProgressiveImage.ts  # Progressive rendering hook
│   └── lib/
│       └── types.ts      # TypeScript types
├── .env.local            # Local environment variables
├── .env.example          # Environment template
└── openapi.yaml          # API specification
```

## License

MIT
