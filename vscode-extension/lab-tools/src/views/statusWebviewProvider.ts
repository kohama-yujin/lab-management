import * as vscode from 'vscode';
import type { StatusViewState } from '../api/types';
import { CONFIG_SECTION } from '../config/keys';
import { renderWebviewHtml } from '../webview/renderHtml';

type WebviewToExt =
	| { type: 'ready' }
	| { type: 'checkIn' }
	| { type: 'checkOut' };

type MessageHandler = (msg: WebviewToExt) => void | Promise<void>;

/**
 * 在室状況サイドバー（WebviewView）。
 */
export class StatusWebviewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly onMessage: MessageHandler,
	) {}

	/**
	 * WebviewView を解決して HTML を設定する。
	 */
	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'status')],
		};
		webviewView.webview.html = renderWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			['media', 'webview', 'status'],
			'status.html',
			'status.css',
			'status.js',
		);
		webviewView.webview.onDidReceiveMessage((msg: WebviewToExt) => {
			void this.onMessage(msg);
		});
	}

	/**
	 * 表示状態を Webview に送る。
	 */
	async postState(state: StatusViewState): Promise<void> {
		await this.view?.webview.postMessage({ type: 'update', state });
	}

	/**
	 * サイドバービューを前面に出す。
	 */
	async focus(): Promise<void> {
		if (this.view) {
			this.view.show(true);
			return;
		}
		await vscode.commands.executeCommand(`${CONFIG_SECTION}.statusView.focus`);
	}
}
