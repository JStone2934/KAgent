import * as vscode from "vscode";

/** cn=A股红涨绿跌，us=美股绿涨红跌 */
export type ColorScheme = "cn" | "us";

/** light=亮色色号，dark=暗色色号（与 A股/美股 组合） */
export type ColorTone = "light" | "dark";

const CONFIG_SCHEME = "kagent.colorScheme";
const CONFIG_TONE = "kagent.colorTone";

export function getColorScheme(): ColorScheme {
  const v = vscode.workspace.getConfiguration("kagent").get<string>("colorScheme");
  return v === "us" ? "us" : "cn";
}

export function getColorTone(): ColorTone {
  const v = vscode.workspace.getConfiguration("kagent").get<string>("colorTone");
  return v === "dark" ? "dark" : "light";
}

export async function setColorScheme(scheme: ColorScheme): Promise<void> {
  await vscode.workspace
    .getConfiguration("kagent")
    .update("colorScheme", scheme, vscode.ConfigurationTarget.Global);
}

export async function setColorTone(tone: ColorTone): Promise<void> {
  await vscode.workspace
    .getConfiguration("kagent")
    .update("colorTone", tone, vscode.ConfigurationTarget.Global);
}

export function colorSchemeLegend(scheme: ColorScheme, tone: ColorTone): string {
  const market = scheme === "us" ? "绿涨红跌" : "红涨绿跌";
  return tone === "dark" ? `${market} · 暗色` : market;
}

export function isMarketColorConfigChange(
  e: vscode.ConfigurationChangeEvent
): boolean {
  return (
    e.affectsConfiguration(CONFIG_SCHEME) ||
    e.affectsConfiguration(CONFIG_TONE)
  );
}

/** @deprecated 使用 isMarketColorConfigChange */
export function isColorSchemeConfigChange(
  e: vscode.ConfigurationChangeEvent
): boolean {
  return isMarketColorConfigChange(e);
}
