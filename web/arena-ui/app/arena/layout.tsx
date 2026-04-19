import { Suspense } from "react";

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
