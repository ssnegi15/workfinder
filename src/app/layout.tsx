import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FirebaseSessionProvider } from "@/components/firebase-session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Workfinder | Career intelligence",
  description:
    "Research engineering roles, understand your matches, and prepare with a personal career agent.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <FirebaseSessionProvider>{children}</FirebaseSessionProvider>
      </body>
    </html>
  );
}
