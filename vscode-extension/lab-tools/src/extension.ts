import * as vscode from 'vscode';
import { SettingsStore } from './config/settingsStore';
import { CONFIG_SECTION } from './config/keys';
import { COMMAND_PREFIX } from './config/constants';
import { maybeShowSetupToast } from './settings/onboarding';
import { SettingsPanel } from './settings/settingsPanel';
import { StatusController } from './attendance/statusController';

/**
 * 拡張機能の有効化時に設定・在室 UI を登録する。
 */
export function activate(context: vscode.ExtensionContext): void {
	const store = new SettingsStore(context.secrets);
	const statusController = new StatusController(store, context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(`${CONFIG_SECTION}.statusView`, statusController.webviewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		...statusController.statusBar.disposables,
		statusController,
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.openSettings`, () => {
			SettingsPanel.show(context, store);
		}),
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.reloadStatus`, () => {
			void statusController.reload();
		}),
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.openAttendancePage`, () => {
			void statusController.openAttendancePage();
		}),
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.toggleAttendance`, () => {
			void statusController.handleToggleFromStatusBar();
		}),
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.focusStatusView`, () => {
			void statusController.webviewProvider.focus();
		}),
	);

	void maybeShowSetupToast(context, store);
}

export function deactivate(): void {}
