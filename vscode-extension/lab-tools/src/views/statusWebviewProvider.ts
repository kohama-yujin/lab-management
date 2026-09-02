import * as vscode from 'vscode';
import type { StatusViewState } from '../api/types';
import { CONFIG_SECTION } from '../config/keys';
import { renderWebviewHtml } from '../webview/renderHtml';

type WebviewToExt =
	| { type: 'ready' }
	| { type: 'checkOut' };

type MessageHandler = (msg: WebviewToExt) => void | Promise<void>;

/**
 * 在室状況サイドバー（WebviewView）。
 */
export class StatusWebviewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	private lastState: StatusViewState | null = null;

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
		const statusRoot = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'status');
		const soundsRoot = vscode.Uri.joinPath(this.extensionUri, 'media', 'sounds');
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [statusRoot, soundsRoot],
		};

		const checkinSoundUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(soundsRoot, 'checkin.wav'),
		);
		const checkoutSoundUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(soundsRoot, 'checkout.wav'),
		);
		webviewView.webview.html = renderWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			['media', 'webview', 'status'],
			'status.html',
			'status.css',
			'status.js',
		)
			.replaceAll('{{checkinSoundUri}}', checkinSoundUri.toString())
			.replaceAll('{{checkoutSoundUri}}', checkoutSoundUri.toString());

		webviewView.webview.onDidReceiveMessage((msg: WebviewToExt) => {
			void this.onMessage(msg);
		});

		if (this.lastState) {
			void webviewView.webview.postMessage({ type: 'update', state: this.lastState });
		}
	}

	/**
	 * 表示状態を Webview に送る。
	 */
	async postState(state: StatusViewState): Promise<void> {
		this.lastState = state;
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
