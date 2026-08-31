import * as vscode from 'vscode';
import type { SettingsStore } from '../config/settingsStore';
import { CONFIG_SECTION } from '../config/keys';
import { renderWebviewHtml } from '../webview/renderHtml';
import { testConnection } from './connectionTest';

type WebviewToExt =
	| { type: 'ready' }
	| { type: 'save'; username: string; serverIp: string; publicUrl: string; autoCheckIn: boolean; password: string; apiKey: string }
	| { type: 'test'; username: string; serverIp: string; publicUrl: string; autoCheckIn: boolean; password: string; apiKey: string };

/**
 * 設定用 Webview パネルを開く・再利用する。
 */
export class SettingsPanel {
	public static readonly viewType = `${CONFIG_SECTION}.settings`;

	private static current: SettingsPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	private constructor(
		panel: vscode.WebviewPanel,
		private readonly store: SettingsStore,
		extensionUri: vscode.Uri,
	) {
		this.panel = panel;
		this.panel.webview.html = renderWebviewHtml(
			this.panel.webview,
			extensionUri,
			['media', 'webview'],
			'settings.html',
			'settings.css',
			'settings.js',
		);
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(msg: WebviewToExt) => {
				void this.onMessage(msg);
			},
			null,
			this.disposables,
		);
	}

	/**
	 * 設定パネルを表示する（既存があれば前面へ）。
	 */
	static show(context: vscode.ExtensionContext, store: SettingsStore): void {
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
		if (SettingsPanel.current) {
			SettingsPanel.current.panel.reveal(column);
			void SettingsPanel.current.pushSettings();
			return;
		}

		const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview');
		const panel = vscode.window.createWebviewPanel(
			SettingsPanel.viewType,
			'Lab Tools 設定',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [webviewRoot],
			},
		);
		SettingsPanel.current = new SettingsPanel(panel, store, context.extensionUri);
		context.subscriptions.push(
			new vscode.Disposable(() => {
				SettingsPanel.current?.dispose();
			}),
		);
		void SettingsPanel.current.pushSettings();
	}

	private async pushSettings(): Promise<void> {
		const settings = await this.store.get();
		await this.panel.webview.postMessage({ type: 'load', settings });
	}

	private async onMessage(msg: WebviewToExt): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.pushSettings();
				return;
			case 'save':
				await this.handleSave(msg);
				return;
			case 'test':
				await this.handleTest(msg);
				return;
		}
	}

	private async handleSave(msg: Extract<WebviewToExt, { type: 'save' }>): Promise<void> {
		try {
			await this.store.save({
				username: msg.username,
				serverIp: msg.serverIp,
				publicUrl: msg.publicUrl,
				autoCheckIn: msg.autoCheckIn,
				password: msg.password,
				apiKey: msg.apiKey,
			});
			await this.pushSettings();
			await this.panel.webview.postMessage({ type: 'status', kind: 'ok', text: '設定を保存しました' });
		} catch (err) {
			const text = err instanceof Error ? err.message : String(err);
			await this.panel.webview.postMessage({ type: 'status', kind: 'error', text: `保存に失敗しました: ${text}` });
		}
	}

	private async handleTest(msg: Extract<WebviewToExt, { type: 'test' }>): Promise<void> {
		const result = await testConnection(msg.serverIp, msg.publicUrl);
		if (result.ok) {
			const label = result.used === 'serverIp' ? 'serverIp' : 'public-url';
			let text = `接続成功（${label}: ${result.baseUrl}）`;

			if (result.used === 'serverIp' && result.publicUrl) {
				await this.store.save({
					username: msg.username,
					serverIp: msg.serverIp,
					publicUrl: result.publicUrl,
					autoCheckIn: msg.autoCheckIn,
					password: msg.password,
					apiKey: msg.apiKey,
				});
				await this.panel.webview.postMessage({ type: 'setPublicUrl', value: result.publicUrl });
				text += ` / 公開URLを自動設定: ${result.publicUrl}`;
			}

			await this.panel.webview.postMessage({ type: 'status', kind: 'ok', text });
			return;
		}
		await this.panel.webview.postMessage({ type: 'status', kind: 'error', text: `接続失敗: ${result.message}` });
	}

	private dispose(): void {
		SettingsPanel.current = undefined;
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}
