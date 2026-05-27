import * as fs from "fs";
import * as path from "path";
import { withKagentLockSync } from "./fileLock";
import { readSymbols } from "./eventStore";
import { getSymbolsPath } from "./paths";
import { SymbolsFile } from "./types";

/** 标记退市后保留多久再从列表移除，避免一次删除触发多路刷新后瞬间消失 */
export const DELIST_PURGE_AFTER_MS = 30_000;
/** 旧版常量名保留给外部引用；当前清理策略已改为基于时间窗口 */
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
 * 工作区文件被手动删除后：首次标记 delisted，保留一段稳定展示窗口后从 symbols 移除。
 * 文件若重新出现则清除退市状态。
 */
export function syncDelistedSymbols(
  kagentDir: string,
  workspaceRoot: string
): SymbolsFile {
  return withKagentLockSync(kagentDir, () => {
    const symbolsPath = getSymbolsPath(kagentDir);
    const doc = readSymbols(kagentDir);
    const now = Date.now();
    let changed = false;
    const toRemove: string[] = [];

    for (const [relativeFile, info] of Object.entries(doc.symbols)) {
      if (!isWorkspaceFileMissing(workspaceRoot, relativeFile)) {
        if (
          info.delisted ||
          info.delisted_at !== undefined ||
          info.delist_rounds !== undefined
        ) {
          info.delisted = false;
          delete info.delisted_at;
          delete info.delist_rounds;
          changed = true;
        }
        continue;
      }

      if (!info.delisted) {
        info.delisted = true;
        info.delisted_at = now;
        info.delist_rounds = 0;
        changed = true;
        continue;
      }

      if (info.delisted_at === undefined) {
        info.delisted_at = now;
        changed = true;
      }
      if (now - info.delisted_at >= DELIST_PURGE_AFTER_MS) {
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
