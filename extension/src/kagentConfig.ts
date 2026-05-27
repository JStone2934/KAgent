import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getKagentDir } from "./paths";

export interface KagentCaptureConfig {
  onSave?: boolean;
  agentHook?: boolean;
  coalesceWindowMs?: number;
}

export interface KagentConfigFile {
  ignoreGlobs?: string[];
  capture?: KagentCaptureConfig;
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.kagent/**",
  "**/dist/**",
  "**/out/**",
];

const DEFAULT_CAPTURE: Required<KagentCaptureConfig> = {
  onSave: true,
  agentHook: true,
  coalesceWindowMs: 1500,
};

export function defaultConfigFile(): KagentConfigFile {
  return {
    ignoreGlobs: [...DEFAULT_IGNORE],
    capture: { ...DEFAULT_CAPTURE },
  };
}

export function loadKagentConfig(kagentDir: string): KagentConfigFile {
  const filePath = path.join(kagentDir, "config.json");
  let disk: KagentConfigFile = {};
  if (fs.existsSync(filePath)) {
    try {
      disk = JSON.parse(fs.readFileSync(filePath, "utf8")) as KagentConfigFile;
    } catch {
      disk = {};
    }
  }
  return {
    ignoreGlobs: disk.ignoreGlobs ?? [...DEFAULT_IGNORE],
    capture: {
      ...DEFAULT_CAPTURE,
      ...disk.capture,
    },
  };
}

export function isCaptureOnSaveEnabled(kagentDir: string | undefined): boolean {
  if (!kagentDir) {
    return true;
  }
  const vscodeOverride = vscode.workspace
    .getConfiguration("kagent")
    .get<boolean>("capture.onSave");
  if (vscodeOverride !== undefined) {
    return vscodeOverride;
  }
  return loadKagentConfig(kagentDir).capture?.onSave !== false;
}

export function getCoalesceWindowMs(kagentDir: string): number {
  const fromFile = loadKagentConfig(kagentDir).capture?.coalesceWindowMs;
  return typeof fromFile === "number" && fromFile >= 0 ? fromFile : DEFAULT_CAPTURE.coalesceWindowMs;
}

export function ensureKagentConfig(kagentDir: string): void {
  const filePath = path.join(kagentDir, "config.json");
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.mkdirSync(kagentDir, { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(defaultConfigFile(), null, 2) + "\n",
    "utf8"
  );
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export function isIgnored(relativePath: string, config: KagentConfigFile): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  for (const glob of config.ignoreGlobs ?? []) {
    if (globToRegExp(glob).test(normalized)) {
      return true;
    }
  }
  return false;
}

export function getWorkspaceKagentDir(): string | undefined {
  return getKagentDir();
}
