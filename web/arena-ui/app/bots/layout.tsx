import { Suspense } from "react";

export default function BotsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
