import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cable-Guard",
  description: "Real-time cable fault detection",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
