import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Progressive Image Viewer",
  description: "A modern image viewer with progressive loading tied to zoom interactions. Features iOS-inspired glassmorphism UI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
