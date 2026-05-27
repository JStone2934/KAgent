import * as fs from "fs";
import * as path from "path";
import { withKagentLockSync } from "./fileLock";
import { readSymbols } from "./eventStore";
import { getSymbolsPath } from "./paths";
import { SymbolsFile } from "./types";

/** 标记退市后再刷新多少次即从列表移除 */
export const DELIST_PURGE_AFTER_ROUNDS = 3;

export function isWorkspaceFileMissing(
  workspaceRoot: string,
  relativeFile: string
): boolean {
  try {
    return !fs.existsSync(path.join(workspaceRoot, relativeFile));
  } catch {
    return true;
  }
}

function saveSymbols(symbolsPath: string, doc: SymbolsFile): void {
  fs.mkdirSync(path.dirname(symbolsPath), { recursive: true });
  fs.writeFileSync(symbolsPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

/**
 * 工作区文件被手动删除后：首次标记 delisted，每次刷新递增轮次，满 N 轮后从 symbols 移除。
 * 文件若重新出现则清除退市状态。
 */
export function syncDelistedSymbols(
  kagentDir: string,
  workspaceRoot: string
): SymbolsFile {
  return withKagentLockSync(kagentDir, () => {
    const symbolsPath = getSymbolsPath(kagentDir);
    const doc = readSymbols(kagentDir);
    let changed = false;
    const toRemove: string[] = [];

    for (const [relativeFile, info] of Object.entries(doc.symbols)) {
      if (!isWorkspaceFileMissing(workspaceRoot, relativeFile)) {
        if (info.delisted || info.delist_rounds !== undefined) {
          info.delisted = false;
          delete info.delist_rounds;
          changed = true;
        }
        continue;
      }

      if (!info.delisted) {
        info.delisted = true;
        info.delist_rounds = 0;
        changed = true;
        continue;
      }

      const rounds = (info.delist_rounds ?? 0) + 1;
      info.delist_rounds = rounds;
      changed = true;
      if (rounds >= DELIST_PURGE_AFTER_ROUNDS) {
        toRemove.push(relativeFile);
      }
    }

    for (const f of toRemove) {
      delete doc.symbols[f];
      changed = true;
    }

    if (changed) {
      saveSymbols(symbolsPath, doc);
    }

    return doc;
  });
}
