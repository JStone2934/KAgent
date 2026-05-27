import * as fs from "fs";
import * as path from "path";
import { withKagentLockSync } from "./fileLock";
import {
  computeEditStats,
  contentHash,
  countLines,
  EditPatch,
  reconcileStatsWithFile,
  simulateRoundExtremes,
  statsForTextPair,
} from "./lineStats";
import { getCoalesceWindowMs, isIgnored, loadKagentConfig } from "./kagentConfig";
import { getEventsPath, getSymbolsPath } from "./paths";
import { KagentEvent, SymbolsFile } from "./types";

export type RecordActor = "agent" | "human" | "unknown";
export type RecordSource = "afterFileEdit" | "onSave" | "simulate";

export interface RecordChangeInput {
  workspaceRoot: string;
  relativeFile: string;
  linesAfter: number;
  /** 保存/Hook 前的全文；无则按 symbols.last_lines 推算 */
  oldText?: string;
  edits?: EditPatch[];
  source: RecordSource;
  actor: RecordActor;
  conversation_id?: string | null;
  generation_id?: string | null;
  save_reason?: string;
  editor?: string;
}

export interface RecordChangeResult {
  recorded: boolean;
  reason?: "ignored" | "unchanged" | "coalesced";
  event?: KagentEvent;
}

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function saveJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function appendNdjson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
}

function shouldCoalesceWithDir(
  kagentDir: string,
  existing: SymbolsFile["symbols"][string] | undefined,
  linesAfter: number,
  source: RecordSource,
  newHash: string,
  stats: { added: number; removed: number }
): boolean {
  if (!existing?.last_ts) {
    return false;
  }
  const windowMs = getCoalesceWindowMs(kagentDir);
  if (Date.now() - existing.last_ts > windowMs) {
    return false;
  }
  if (existing.last_lines !== linesAfter) {
    return false;
  }
  if (existing.last_content_hash === newHash) {
    return true;
  }
  if (
    stats.added === 0 &&
    stats.removed === 0 &&
    existing.last_lines === linesAfter
  ) {
    return true;
  }
  if (
    source === "onSave" &&
    existing.last_source === "afterFileEdit" &&
    existing.last_lines === linesAfter
  ) {
    return true;
  }
  return false;
}

export function recordFileChange(input: RecordChangeInput): RecordChangeResult {
  const kagentDir = path.join(input.workspaceRoot, ".kagent");
  const config = loadKagentConfig(kagentDir);

  if (isIgnored(input.relativeFile, config)) {
    return { recorded: false, reason: "ignored" };
  }

  return withKagentLockSync(kagentDir, () => {
    const symbolsPath = getSymbolsPath(kagentDir);
    const symbolsDoc = loadJson<SymbolsFile>(symbolsPath, { symbols: {} });
    const existing = symbolsDoc.symbols[input.relativeFile];
    const isIpo = !existing;

    let linesBefore: number;
    let stats: { added: number; removed: number; net: number };
    let lines_high: number;
    let lines_low: number;

    const edits = input.edits;

    if (input.oldText !== undefined) {
      const oldText = input.oldText;
      const newText =
        input.linesAfter === 0
          ? ""
          : readFileText(path.join(input.workspaceRoot, input.relativeFile));
      linesBefore = countLines(oldText);
      const textStats =
        edits && edits.length > 0
          ? reconcileStatsWithFile(
              computeEditStats(edits),
              linesBefore,
              input.linesAfter
            )
          : reconcileStatsWithFile(
              statsForTextPair(oldText, newText),
              linesBefore,
              input.linesAfter
            );
      stats = textStats;
      if (edits && edits.length > 0) {
        const { high: simHigh, low: simLow } = simulateRoundExtremes(
          linesBefore,
          edits
        );
        lines_high = Math.max(simHigh, linesBefore, input.linesAfter);
        lines_low = Math.min(simLow, linesBefore, input.linesAfter);
      } else {
        lines_high = Math.max(linesBefore, input.linesAfter);
        lines_low = Math.min(linesBefore, input.linesAfter);
      }
    } else if (existing && typeof existing.last_lines === "number") {
      linesBefore = existing.last_lines;
      if (edits && edits.length > 0) {
        stats = reconcileStatsWithFile(
          computeEditStats(edits),
          linesBefore,
          input.linesAfter
        );
        const { high: simHigh, low: simLow } = simulateRoundExtremes(
          linesBefore,
          edits
        );
        lines_high = Math.max(simHigh, linesBefore, input.linesAfter);
        lines_low = Math.min(simLow, linesBefore, input.linesAfter);
      } else {
        const delta = input.linesAfter - linesBefore;
        if (delta > 0) {
          stats = { added: delta, removed: 0, net: delta };
        } else if (delta < 0) {
          stats = { added: 0, removed: -delta, net: delta };
        } else {
          stats = { added: 0, removed: 0, net: 0 };
        }
        lines_high = Math.max(linesBefore, input.linesAfter);
        lines_low = Math.min(linesBefore, input.linesAfter);
      }
    } else {
      const preStats = computeEditStats(edits);
      linesBefore =
        preStats.net !== 0
          ? Math.max(0, input.linesAfter - preStats.net)
          : input.linesAfter;
      stats = reconcileStatsWithFile(preStats, linesBefore, input.linesAfter);
      const { high: simHigh, low: simLow } = simulateRoundExtremes(
        linesBefore,
        edits
      );
      lines_high = Math.max(simHigh, linesBefore, input.linesAfter);
      lines_low = Math.min(simLow, linesBefore, input.linesAfter);
    }

    const absPath = path.join(input.workspaceRoot, input.relativeFile);
    const diskText = readFileText(absPath);
    const hashAfter = contentHash(diskText);

    if (
      shouldCoalesceWithDir(
        kagentDir,
        existing,
        input.linesAfter,
        input.source,
        hashAfter,
        stats
      )
    ) {
      return { recorded: false, reason: "coalesced" };
    }

    if (
      stats.added === 0 &&
      stats.removed === 0 &&
      linesBefore === input.linesAfter &&
      existing?.last_content_hash === hashAfter
    ) {
      return { recorded: false, reason: "unchanged" };
    }

    const editCount = (existing?.edit_count ?? 0) + 1;
    const ts = Date.now();

    const event: KagentEvent = {
      v: 2,
      ts,
      conversation_id: input.conversation_id ?? null,
      generation_id: input.generation_id ?? null,
      file: input.relativeFile,
      added: stats.added,
      removed: stats.removed,
      net: stats.net,
      lines_before: linesBefore,
      lines_after: input.linesAfter,
      lines_high,
      lines_low,
      is_ipo: isIpo,
      edit_index: editCount,
      source: input.source,
      actor: input.actor,
      editor: input.editor,
      save_reason: input.save_reason,
      content_hash_after: hashAfter,
    };

    appendNdjson(getEventsPath(kagentDir), event);

    symbolsDoc.symbols[input.relativeFile] = {
      ipo_ts: existing?.ipo_ts ?? ts,
      edit_count: editCount,
      last_lines: input.linesAfter,
      last_ts: ts,
      delisted: false,
      last_source: input.source,
      last_content_hash: hashAfter,
    };
    saveJson(symbolsPath, symbolsDoc);

    return { recorded: true, event };
  });
}

function readFileText(absPath: string): string {
  try {
    if (!fs.existsSync(absPath)) {
      return "";
    }
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

export function countFileLines(absPath: string): number {
  const text = readFileText(absPath);
  if (text.length === 0) {
    return 0;
  }
  return countLines(text);
}
