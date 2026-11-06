import * as vscode from 'vscode';

import { FALLBACK_LOCALE } from '../core';

/** The `ss14editor.localization.*` settings. */
export const LOCALIZATION_SECTION = 'ss14editor.localization';
export const TOGGLE_LOC_ID_FOLDING_COMMAND = 'ss14editor.toggleLocIdFolding';

/** The locale LocId keys fold into and are listed first in (`ss14editor.localization.displayLocale`). */
export function displayLocale(): string {
  return (
    vscode.workspace.getConfiguration(LOCALIZATION_SECTION).get<string>('displayLocale', FALLBACK_LOCALE).trim() ||
    FALLBACK_LOCALE
  );
}

/** Whether LocId keys fold into their translation (`ss14editor.localization.foldKeys`). */
export function foldingEnabled(): boolean {
  return vscode.workspace.getConfiguration(LOCALIZATION_SECTION).get<boolean>('foldKeys', true);
}

/**
 * `SS14: Toggle LocId folding` — flips `foldKeys` where it is set: in the
 * workspace when the workspace sets it, in the user settings otherwise.
 */
export async function toggleLocIdFolding(): Promise<void> {
  const config = vscode.workspace.getConfiguration(LOCALIZATION_SECTION);
  const inspected = config.inspect<boolean>('foldKeys');
  const target =
    inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config.update('foldKeys', !foldingEnabled(), target);
}
