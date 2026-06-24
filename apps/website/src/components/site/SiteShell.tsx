import { type ReactNode } from "react";
import { DemoModalProvider } from "./DemoModal";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <DemoModalProvider>
      <div className="flex min-h-screen flex-col">
        <Nav />
        <main className="flex-1 pt-16">{children}</main>
        <Footer />
      </div>
    </DemoModalProvider>
  );
}
