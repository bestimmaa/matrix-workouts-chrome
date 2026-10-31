/** Display formatting. Pure, so the unit conversions are testable without a DOM. */

/** Whole hours, minutes and seconds, never negative. */
function split(totalSeconds: number): { h: number; m: number; s: number } {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60), s: seconds % 60 };
}

/** m:ss, or h:mm:ss past an hour. */
export function clock(totalSeconds: number): string {
  const { h, m, s } = split(totalSeconds);
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * The same duration split into value/unit pairs — `45 m 10 s`, the way the site's
 * own metric tiles read it. Hours only appear once there are any.
 */
export function hms(totalSeconds: number): (readonly [string, string])[] {
  const { h, m, s } = split(totalSeconds);
  return [
    ...(h > 0 ? [[String(h), "h"] as const] : []),
    [String(m), "m"] as const,
    [String(s), "s"] as const,
  ];
}

/** The record stores meters; the site shows km, and so do we. */
export function km(meters: number): string {
  return (meters / 1000).toFixed(2);
}

const MACHINE_LABELS: Record<string, string> = {
  upright_bike: "Upright bike",
  recumbent_bike: "Recumbent bike",
  treadmill: "Treadmill",
  rower: "Rower",
  elliptical: "Elliptical",
};

export function machineLabel(machineType: string): string {
  return MACHINE_LABELS[machineType] ?? machineType.replace(/_/g, " ");
}

const MODE_LABELS: Record<string, string> = {
  sprint_8: "Sprint 8",
  target_heart_rate: "Target heart rate",
  target_watts: "Target watts",
  fitness_test: "Fitness test",
  virtual_active: "Virtual Active",
  hills: "Hills",
};

export function modeLabel(mode: string, programType: number | null): string {
  const name = MODE_LABELS[mode];
  if (name) return name;
  // An unmapped program id is shown as the raw number rather than guessed at.
  return programType === null ? "Unidentified program" : `Program ${programType}`;
}

export function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}
