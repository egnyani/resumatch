import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toaster";
import { ToastStateProvider } from "@/components/ui/use-toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "resumatch",
  description: "ATS resume tailoring tool built with Next.js, Gemini, and Supabase.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background font-sans antialiased">
        <ToastStateProvider>
          {children}
          <Toaster />
        </ToastStateProvider>
      </body>
    </html>
  );
}
