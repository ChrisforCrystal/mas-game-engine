import type { Metadata } from "next";
import { Suspense } from "react";
import { Big_Shoulders_Display, Plus_Jakarta_Sans } from "next/font/google";

import "./globals.css";
import { TopNav } from "./top-nav";

const display = Big_Shoulders_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const body = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "智能体竞技回放台",
  description: "内部机器人对抗回放页面",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <Suspense><TopNav /></Suspense>
        <div style={{ paddingTop: 56 }}>{children}</div>
      </body>
    </html>
  );
}
