import { Suspense } from "react";
import { AutopilotProvider } from "@/components/autopilot";
import { MobileNav, Sidebar, SidebarNav, SidebarNavFallback, Topbar } from "@/components/app-shell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AutopilotProvider>
      <div className="flex min-h-svh">
        <Sidebar
          nav={
            <Suspense fallback={<SidebarNavFallback />}>
              <SidebarNav />
            </Suspense>
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <Suspense>
            <MobileNav />
          </Suspense>
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </AutopilotProvider>
  );
}
