// lucide-react icon per conventional-commit type. Lives apart from
// `commit-type.ts` (a pure, React-free module shared with the canvas) so DOM
// components can render the same glyphs the canvas strokes via
// COMMIT_TYPE_ICON_NODES — keep the two maps in sync.
import {
  Sparkles,
  Bug,
  BookText,
  Palette,
  Hammer,
  Zap,
  FlaskConical,
  Package,
  Workflow,
  Wrench,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { CommitType } from "@/lib/commit-type";

export const COMMIT_TYPE_ICONS: Record<CommitType, LucideIcon> = {
  feat: Sparkles,
  fix: Bug,
  docs: BookText,
  style: Palette,
  refactor: Hammer,
  perf: Zap,
  test: FlaskConical,
  build: Package,
  ci: Workflow,
  chore: Wrench,
  revert: Undo2,
};
