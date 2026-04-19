import { Suspense } from "react";

export default function MapsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
