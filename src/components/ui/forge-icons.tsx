import type { ForgeKind } from "@/types/git";

interface ForgeIconProps {
  className?: string;
}

export function GitHubIcon({ className = "h-3 w-3" }: ForgeIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-label="GitHub"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function GitLabIcon({ className = "h-3 w-3" }: ForgeIconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="GitLab"
    >
      <path d="M16 30.37 21.72 12.8H10.28L16 30.37Z" fill="#E24329" />
      <path d="m16 30.37-5.72-17.57H2.17L16 30.37Z" fill="#FC6D26" />
      <path d="M2.17 12.8.07 19.28a1.43 1.43 0 0 0 .52 1.6L16 30.37 2.17 12.8Z" fill="#FCA326" />
      <path d="M2.17 12.8h8.11L6.54 1.27a.72.72 0 0 0-1.37 0L2.17 12.8Z" fill="#E24329" />
      <path d="m16 30.37 5.72-17.57h8.11L16 30.37Z" fill="#FC6D26" />
      <path d="M29.83 12.8 31.93 19.28a1.43 1.43 0 0 1-.52 1.6L16 30.37 29.83 12.8Z" fill="#FCA326" />
      <path d="M29.83 12.8h-8.11l3.74-11.53a.72.72 0 0 1 1.37 0l3 11.53Z" fill="#E24329" />
    </svg>
  );
}

export function ForgeIcon({ kind, className }: { kind: ForgeKind | null; className?: string }) {
  if (kind === "github") return <GitHubIcon className={className} />;
  if (kind === "gitlab") return <GitLabIcon className={className} />;
  return null;
}
