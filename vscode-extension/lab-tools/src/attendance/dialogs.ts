import * as vscode from 'vscode';

/**
 * 入室確認ダイアログを表示する。
 */
export async function confirmCheckIn(): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage('入室しますか？', { modal: true }, '入室');
	return choice === '入室';
}

/**
 * 退室確認ダイアログを表示する。
 */
export async function confirmCheckOut(): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage('退室しますか？', { modal: true }, '退室');
	return choice === '退室';
}
