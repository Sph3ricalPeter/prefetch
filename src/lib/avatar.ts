interface HSL { h: number; s: number; l: number }

function hslToHex({ h, s, l }: HSL): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export function getAvatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  }
  const h = ((hash % 360) + 360) % 360;
  return hslToHex({ h, s: 55, l: 50 });
}

export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
}

// ── Profile color palette ──────────────────────────────────────────

const PROFILE_COLORS = [
  "#7c9cbf", // steel
  "#6ba892", // sage
  "#c4a054", // sand
  "#9b85c4", // lavender
  "#5ea8a8", // teal
  "#c47d94", // rose
  "#c48a5e", // terracotta
  "#b87070", // coral
];

export { PROFILE_COLORS };

export function pickProfileColor(existingCount: number): string {
  return PROFILE_COLORS[existingCount % PROFILE_COLORS.length];
}

/** Darken a hex color by multiplying RGB channels. Factor 0.5 = 50% brightness. */
export function darkenHex(hex: string, factor: number = 0.5): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Shared icon element type ──────────────────────────────────────

export type IconElement = readonly [tag: string, attrs: Record<string, string>];

// ── Profile icon system ───────────────────────────────────────────

export interface ProfileIconDef {
  id: string;
  label: string;
  viewBox: number;
  elements: readonly IconElement[];
  stroke: boolean;
}

const ICON_BRIEFCASE: readonly IconElement[] = [
  ["path", { d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" }],
  ["rect", { width: "20", height: "14", x: "2", y: "6", rx: "2" }],
];

const ICON_CODE: readonly IconElement[] = [
  ["path", { d: "M16 18L22 12L16 6" }],
  ["path", { d: "M8 6L2 12L8 18" }],
];

const ICON_TERMINAL: readonly IconElement[] = [
  ["path", { d: "M4 17L10 11L4 5" }],
  ["path", { d: "M12 19L20 19" }],
];

const ICON_ROCKET: readonly IconElement[] = [
  ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
  ["path", { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" }],
  ["path", { d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" }],
  ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }],
];

const ICON_HEART: readonly IconElement[] = [
  ["path", { d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" }],
];

const ICON_STAR: readonly IconElement[] = [
  ["path", { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }],
];

const ICON_SHIELD: readonly IconElement[] = [
  ["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
];

const ICON_FLAME: readonly IconElement[] = [
  ["path", { d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" }],
];

const ICON_MUSIC: readonly IconElement[] = [
  ["path", { d: "M9 18V5l12-2v13" }],
  ["circle", { cx: "6", cy: "18", r: "3" }],
  ["circle", { cx: "18", cy: "16", r: "3" }],
];

const ICON_WRENCH: readonly IconElement[] = [
  ["path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" }],
];

const ICON_PALETTE: readonly IconElement[] = [
  ["path", { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }],
  ["circle", { cx: "13.5", cy: "6.5", r: "0.5", fill: "currentColor" }],
  ["circle", { cx: "17.5", cy: "10.5", r: "0.5", fill: "currentColor" }],
  ["circle", { cx: "6.5", cy: "12.5", r: "0.5", fill: "currentColor" }],
  ["circle", { cx: "8.5", cy: "7.5", r: "0.5", fill: "currentColor" }],
];

const ICON_GRADUATION: readonly IconElement[] = [
  ["path", { d: "M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" }],
  ["path", { d: "M22 10v6" }],
  ["path", { d: "M6 12.5V16a6 3 0 0 0 12 0v-3.5" }],
];

export const PROFILE_ICONS: ProfileIconDef[] = [
  { id: "briefcase", label: "Briefcase", viewBox: 24, elements: ICON_BRIEFCASE, stroke: true },
  { id: "code", label: "Code", viewBox: 24, elements: ICON_CODE, stroke: true },
  { id: "terminal", label: "Terminal", viewBox: 24, elements: ICON_TERMINAL, stroke: true },
  { id: "rocket", label: "Rocket", viewBox: 24, elements: ICON_ROCKET, stroke: true },
  { id: "heart", label: "Heart", viewBox: 24, elements: ICON_HEART, stroke: true },
  { id: "star", label: "Star", viewBox: 24, elements: ICON_STAR, stroke: true },
  { id: "shield", label: "Shield", viewBox: 24, elements: ICON_SHIELD, stroke: true },
  { id: "flame", label: "Flame", viewBox: 24, elements: ICON_FLAME, stroke: true },
  { id: "music", label: "Music", viewBox: 24, elements: ICON_MUSIC, stroke: true },
  { id: "wrench", label: "Wrench", viewBox: 24, elements: ICON_WRENCH, stroke: true },
  { id: "palette", label: "Palette", viewBox: 24, elements: ICON_PALETTE, stroke: true },
  { id: "graduation", label: "Graduation", viewBox: 24, elements: ICON_GRADUATION, stroke: true },
];

export function getProfileIcon(id: string): ProfileIconDef | undefined {
  return PROFILE_ICONS.find((i) => i.id === id);
}

/** Draw a profile icon on a Canvas context (circle bg + icon). */
export function drawProfileIconOnCanvas(
  ctx: CanvasRenderingContext2D,
  iconId: string,
  cx: number,
  cy: number,
  radius: number,
  bgColor: string,
): void {
  const def = getProfileIcon(iconId);
  if (!def) return;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();

  const fg = getContrastColor(bgColor);
  const iconSize = radius * 1.4;
  const scale = iconSize / def.viewBox;
  ctx.save();
  ctx.translate(cx - iconSize / 2, cy - iconSize / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = fg;

  if (def.stroke) {
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  for (const [element, attrs] of def.elements) {
    switch (element) {
      case "path": {
        const p = new Path2D(attrs.d);
        if (attrs.fill === "currentColor" || !def.stroke) ctx.fill(p);
        if (def.stroke) ctx.stroke(p);
        break;
      }
      case "rect": {
        ctx.beginPath();
        ctx.roundRect(
          parseFloat(attrs.x || "0"),
          parseFloat(attrs.y || "0"),
          parseFloat(attrs.width),
          parseFloat(attrs.height),
          parseFloat(attrs.rx || "0"),
        );
        if (def.stroke) ctx.stroke();
        else ctx.fill();
        break;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(parseFloat(attrs.x1), parseFloat(attrs.y1));
        ctx.lineTo(parseFloat(attrs.x2), parseFloat(attrs.y2));
        if (def.stroke) ctx.stroke();
        break;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(parseFloat(attrs.cx), parseFloat(attrs.cy), parseFloat(attrs.r), 0, Math.PI * 2);
        if (attrs.fill === "currentColor" || !def.stroke) ctx.fill();
        if (def.stroke) ctx.stroke();
        break;
      }
    }
  }
  ctx.restore();
}

// ── Bot / AI avatar system ─────────────────────────────────────────

export interface BotInfo {
  id: string;
  label: string;
  bgColor: string;
  fgColor: string;
  iconViewBox: number;
  iconElements: readonly IconElement[];
  iconStroke?: boolean;
}

// Claude calligraphy asterisk (fill-only, 16×16 viewBox — from Bootstrap Icons)
const ICON_CLAUDE: readonly IconElement[] = [
  ["path", { d: "m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z", fill: "currentColor" }],
];

// Lucide "Bot" icon (stroke, 24×24 viewBox)
const ICON_BOT: readonly IconElement[] = [
  ["path", { d: "M12 8V4H8" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2" }],
  ["path", { d: "M2 14h2" }],
  ["path", { d: "M20 14h2" }],
  ["path", { d: "M15 13v2" }],
  ["path", { d: "M9 13v2" }],
];

const CLAUDE_BOT: BotInfo = {
  id: "claude", label: "Claude", bgColor: "#E8734A", fgColor: "#ffffff",
  iconViewBox: 16, iconElements: ICON_CLAUDE,
};

const DEPENDABOT: BotInfo = {
  id: "dependabot", label: "Dependabot", bgColor: "#0969da", fgColor: "#ffffff",
  iconViewBox: 24, iconElements: ICON_BOT, iconStroke: true,
};

const GITHUB_ACTIONS: BotInfo = {
  id: "github-actions", label: "GitHub Actions", bgColor: "#24292f", fgColor: "#ffffff",
  iconViewBox: 24, iconElements: ICON_BOT, iconStroke: true,
};

const RENOVATE_BOT: BotInfo = {
  id: "renovate", label: "Renovate", bgColor: "#1a7fd4", fgColor: "#ffffff",
  iconViewBox: 24, iconElements: ICON_BOT, iconStroke: true,
};

const GENERIC_BOT: BotInfo = {
  id: "bot", label: "Bot", bgColor: "#6b7280", fgColor: "#ffffff",
  iconViewBox: 24, iconElements: ICON_BOT, iconStroke: true,
};

interface BotMatcher {
  match: (name: string, email: string) => boolean;
  info: BotInfo;
}

const BOT_MATCHERS: BotMatcher[] = [
  { match: (_, e) => e.includes("anthropic.com") || e.includes("noreply@claude"), info: CLAUDE_BOT },
  { match: (_, e) => e.includes("dependabot"), info: DEPENDABOT },
  { match: (_, e) => e.includes("github-actions"), info: GITHUB_ACTIONS },
  { match: (_, e) => e.includes("renovate"), info: RENOVATE_BOT },
  { match: (n, e) => e.includes("[bot]") || n.includes("[bot]"), info: GENERIC_BOT },
];

export function detectBot(name: string, email: string): BotInfo | null {
  const nl = name.toLowerCase();
  const el = email.toLowerCase();
  for (const { match, info } of BOT_MATCHERS) {
    if (match(nl, el)) return info;
  }
  return null;
}
