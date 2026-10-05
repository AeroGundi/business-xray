import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description = "See what is really happening inside a business. An interactive investigation: scan, locate, explain, size and simulate.";

export const metadata: Metadata = {
  title: "Business X-Ray",
  description,
  openGraph: { title: "Business X-Ray", description, type: "website" },
};

export const viewport: Viewport = { themeColor: "#06070a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
