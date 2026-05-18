export type DateFormatId = "relative" | "short" | "long" | "iso";

export const DATE_FORMATS: { id: DateFormatId; label: string; example: string }[] = [
  { id: "relative", label: "Relative", example: "5m, 2h, 3d" },
  { id: "short", label: "Short", example: "9 May 14:30" },
  { id: "long", label: "Long", example: "9 May 2025 14:30" },
  { id: "iso", label: "ISO", example: "2025-05-09 14:30" },
];
