import * as vscode from 'vscode';
import { GlobalStateKeys } from '../config/keys';
import type { SettingsStore } from '../config/settingsStore';
import { SettingsPanel } from './settingsPanel';

/**
 * 未設定時に初回だけ設定ページへ誘導するトーストを出す。
 */
export async function maybeShowSetupToast(
	context: vscode.ExtensionContext,
	store: SettingsStore,
	onSaved?: () => void | Promise<void>,
): Promise<void> {
	if (context.globalState.get<boolean>(GlobalStateKeys.setupToastDismissed)) {
		return;
	}
	if (await store.isConfigured()) {
		return;
	}

	const open = '設定を開く';
	const later = '後で';
	const choice = await vscode.window.showInformationMessage(
		'Lab Tools の設定が未完了です。資格情報 / サーバーIP 等を設定してください。',
		open,
		later,
	);

	if (choice === open) {
		SettingsPanel.show(context, store, onSaved);
		return;
	}
	if (choice === later) {
		await context.globalState.update(GlobalStateKeys.setupToastDismissed, true);
	}
}
