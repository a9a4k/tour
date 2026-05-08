export function generateId(opts?: { seed?: number; now?: Date }): string {
  const now = opts?.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const time = `${hh}${mm}${ss}`;
  const suffix =
    opts?.seed !== undefined
      ? seededRandom(opts.seed)
      : randomSuffix();
  return `${date}-${time}-${suffix}`;
}

export function parseIdTimestamp(id: string): Date {
  const [y, m, d, time] = id.split("-");
  const hh = time.slice(0, 2);
  const mm = time.slice(2, 4);
  const ss = time.slice(4, 6);
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
}

function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function seededRandom(seed: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = seed;
  let result = "";
  for (let i = 0; i < 4; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    result += chars[s % chars.length];
  }
  return result;
}
