export function formatOutput(data: unknown, json: boolean): string {
  if (json) return JSON.stringify(data, null, 2);
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

export function printOutput(data: unknown, json: boolean): void {
  process.stdout.write(formatOutput(data, json) + "\n");
}
