import * as fs from "fs";
import * as path from "path";

const STALE_MS = 30_000;
const MAX_WAIT_MS = 8_000;
const RETRY_MS = 25;

function lockPath(kagentDir: string): string {
  return path.join(kagentDir, ".lock");
}

function tryAcquire(lockFile: string): boolean {
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      throw err;
    }
    try {
      const stat = fs.statSync(lockFile);
      if (Date.now() - stat.mtimeMs > STALE_MS) {
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
        return true;
      }
    } catch {
      /* retry */
    }
    return false;
  }
}

function release(lockFile: string): void {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

export function withKagentLockSync<T>(kagentDir: string, fn: () => T): T {
  fs.mkdirSync(kagentDir, { recursive: true });
  const lockFile = lockPath(kagentDir);
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (tryAcquire(lockFile)) {
      try {
        return fn();
      } finally {
        release(lockFile);
      }
    }
    sleep(RETRY_MS);
  }
  throw new Error("KAgent: 无法获取 .kagent 写入锁");
}
