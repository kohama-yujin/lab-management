import * as vscode from 'vscode';
import { SettingsStore } from './config/settingsStore';
import { CONFIG_SECTION } from './config/keys';
import { COMMAND_PREFIX } from './config/constants';
import { maybeShowSetupToast } from './settings/onboarding';
import { SettingsPanel } from './settings/settingsPanel';
import { StatusController } from './attendance/statusController';

/** deactivate から作業終了を送るための参照 */
let activeStatusController: StatusController | undefined;

/**
 * 拡張機能の有効化時に設定・在室 UI を登録する。
 */
export function activate(context: vscode.ExtensionContext): void {
	const store = new SettingsStore(context.secrets);
	const statusController = new StatusController(store, context.extensionUri);
	activeStatusController = statusController;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(`${CONFIG_SECTION}.statusView`, statusController.webviewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		...statusController.statusBar.disposables,
		statusController,
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(`${COMMAND_PREFIX}.openSettings`, () => {
			SettingsPanel.show(context, store, () => statusController.reload());
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

	void maybeShowSetupToast(context, store, () => statusController.reload());
}

/**
 * 終了時に作業だけ end_work する（在室は維持）。強制終了では届かないことがある。
 */
export async function deactivate(): Promise<void> {
	const controller = activeStatusController;
	activeStatusController = undefined;
	if (!controller) {
		return;
	}
	try {
		await controller.endWorkOnDeactivate();
	} catch {
		// 終了処理中の失敗は握りつぶす（閉じる動作を妨げない）
	}
}
