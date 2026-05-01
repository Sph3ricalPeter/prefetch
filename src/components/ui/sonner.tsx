import { Toaster as SonnerToaster } from "sonner";
import { useThemeStore } from "@/stores/theme-store";

export function Toaster() {
  const themeType = useThemeStore((s) => s.appTheme.type);
  return (
    <SonnerToaster
      theme={themeType}
      position="bottom-right"
      richColors
      toastOptions={{
        style: {
          fontFamily: '"Inter", system-ui, sans-serif',
        },
      }}
    />
  );
}
