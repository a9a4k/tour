import { homedir } from "node:os";
import { resolve } from "node:path";

export function tourHome(env: { TOUR_HOME?: string } = process.env): string {
  const configured = env.TOUR_HOME;
  if (configured && configured.trim() !== "") {
    return resolve(configured);
  }
  return resolve(homedir(), ".tour");
}
