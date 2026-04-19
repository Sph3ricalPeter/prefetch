import { useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";

/** Poll file status every 3 seconds when a repo is open */
function StatusPoller() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const loadStatus = useRepoStore((s) => s.loadStatus);

  useEffect(() => {
    if (!repoPath) return;

    const interval = setInterval(() => {
      loadStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [repoPath, loadStatus]);

  return null;
}

function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <AppLayout />
      <StatusPoller />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
