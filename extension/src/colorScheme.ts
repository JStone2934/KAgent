import * as vscode from "vscode";

/** cn=A股红涨绿跌，us=美股绿涨红跌 */
export type ColorScheme = "cn" | "us";

const CONFIG = "kagent.colorScheme";

export function getColorScheme(): ColorScheme {
  const v = vscode.workspace.getConfiguration("kagent").get<string>("colorScheme");
  return v === "us" ? "us" : "cn";
}

export async function setColorScheme(scheme: ColorScheme): Promise<void> {
  await vscode.workspace
    .getConfiguration("kagent")
    .update("colorScheme", scheme, vscode.ConfigurationTarget.Global);
}

export function colorSchemeLegend(scheme: ColorScheme): string {
  return scheme === "us" ? "绿涨红跌" : "红涨绿跌";
}

export function isColorSchemeConfigChange(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration(CONFIG);
}
