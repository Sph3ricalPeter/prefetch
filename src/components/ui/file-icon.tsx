import {
  FileText,
  FileCode,
  FileJson,
  FileImage,
  Globe,
  Palette,
  Cog,
  Settings,
  FileType,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  // Code
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  rs: Cog,
  py: FileCode,
  go: FileCode,
  java: FileCode,
  // Data
  json: FileJson,
  // Web
  html: Globe,
  htm: Globe,
  css: Palette,
  scss: Palette,
  less: Palette,
  // Config
  toml: Settings,
  yml: Settings,
  yaml: Settings,
  env: Settings,
  lock: Settings,
  // Docs
  md: FileType,
  mdx: FileType,
  txt: FileText,
  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  ico: FileImage,
  webp: FileImage,
};

export function FileIcon({
  filename,
  className,
}: {
  filename: string;
  className?: string;
}) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const Icon = ICON_MAP[ext] ?? FileText;
  return <Icon className={className} />;
}
