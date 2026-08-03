import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "안건톡",
  description: "건설 현장 업무 메신저 — 안건톡",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0d0e11",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body className="h-full bg-[#050506]">
        <div className="mx-auto flex h-dvh max-w-[480px] flex-col bg-bg sm:my-0 sm:h-dvh">
          {children}
        </div>
      </body>
    </html>
  );
}
