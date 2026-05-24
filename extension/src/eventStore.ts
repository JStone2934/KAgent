import * as fs from "fs";
import * as readline from "readline";
import { KagentEvent, SymbolsFile } from "./types";
import { getEventsPath, getSymbolsPath } from "./paths";

export async function readAllEvents(kagentDir: string): Promise<KagentEvent[]> {
  const filePath = getEventsPath(kagentDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const events: KagentEvent[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as KagentEvent);
    } catch {
      /* skip bad line */
    }
  }

  return events;
}

export function readSymbols(kagentDir: string): SymbolsFile {
  const filePath = getSymbolsPath(kagentDir);
  if (!fs.existsSync(filePath)) {
    return { symbols: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as SymbolsFile;
  } catch {
    return { symbols: {} };
  }
}
