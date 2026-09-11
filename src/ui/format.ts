/** Display formatting. Pure, so the unit conversions are testable without a DOM. */

/** m:ss, or h:mm:ss past an hour. */
export function clock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * The same duration split into value/unit pairs — `45 m 10 s`, the way the site's
 * own metric tiles read it. Hours only appear once there are any.
 */
export function hms(totalSeconds: number): (readonly [string, string])[] {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
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

export function machineLabel(machineType: string): string {
  const known: Record<string, string> = {
    upright_bike: "Upright bike",
    recumbent_bike: "Recumbent bike",
    treadmill: "Treadmill",
    rower: "Rower",
    elliptical: "Elliptical",
  };
  return known[machineType] ?? machineType.replace(/_/g, " ");
}

export function modeLabel(mode: string, programType: number | null): string {
  const known: Record<string, string> = {
    sprint_8: "Sprint 8",
    target_heart_rate: "Target heart rate",
    target_watts: "Target watts",
    fitness_test: "Fitness test",
  };
  const name = known[mode];
  if (name) return name;
  // An unmapped program id is shown as the raw number rather than guessed at.
  return programType === null ? "Unidentified program" : `Program ${programType}`;
}

export function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}
