import * as fs from "fs";
import * as path from "path";
import { primeSnapshot } from "./saveCapture";
import { readSymbols } from "./eventStore";

function readFileText(absPath: string): string {
  try {
    if (fs.existsSync(absPath)) {
      return fs.readFileSync(absPath, "utf8");
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** Hook / 外部写入 .kagent 后，对齐保存 diff 用的内容快照 */
export function syncSnapshotsFromSymbols(
  kagentDir: string,
  workspaceRoot: string
): void {
  const symbolsDoc = readSymbols(kagentDir);
  for (const relativeFile of Object.keys(symbolsDoc.symbols)) {
    const abs = path.join(workspaceRoot, relativeFile);
    primeSnapshot(relativeFile, readFileText(abs));
  }
}
