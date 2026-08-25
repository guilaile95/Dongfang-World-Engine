export function addMinutes(time: string, minutes: number): string {
  const ms = Date.parse(time);
  const base = Number.isFinite(ms) ? ms : Date.UTC(2000, 0, 1);
  return new Date(base + minutes * 60_000).toISOString();
}

export function minutesBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 60_000));
}

export function playerTimeLabel(time: string, fallback: string): string {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
