import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-left"
      richColors
      toastOptions={{
        style: {
          fontFamily: '"Inter", system-ui, sans-serif',
        },
      }}
    />
  );
}
