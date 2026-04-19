import { AppLayout } from "@/components/layout/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <AppLayout />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
