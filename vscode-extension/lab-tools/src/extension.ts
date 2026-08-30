import * as vscode from 'vscode';
import { SettingsStore } from './config/settingsStore';
import { CONFIG_SECTION } from './config/keys';
import { COMMAND_PREFIX } from './config/constants';
import { maybeShowSetupToast } from './settings/onboarding';
import { SettingsPanel } from './settings/settingsPanel';
import { LabToolsTreeProvider } from './views/labToolsView';

/**
 * 拡張機能の有効化時に設定まわりを登録する。
 */
export function activate(context: vscode.ExtensionContext): void {
	const store = new SettingsStore(context.secrets);

	const treeProvider = new LabToolsTreeProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(`${CONFIG_SECTION}.statusView`, treeProvider),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.openSettings`, () => {
			SettingsPanel.show(context, store);
		}),
	);

	void maybeShowSetupToast(context, store);
}

export function deactivate(): void {}
