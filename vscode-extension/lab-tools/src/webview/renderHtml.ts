import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Webview 用 HTML テンプレートを読み、URI / nonce を埋め込む。
 * @param webview 対象 Webview
 * @param extensionUri 拡張のルート URI
 * @param relativeDir media 配下の相対パス（例: ['media', 'webview', 'settings']）
 * @param htmlFile HTML ファイル名
 * @param styleFile CSS ファイル名
 * @param scriptFile JS ファイル名
 */
export function renderWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	relativeDir: string[],
	htmlFile: string,
	styleFile: string,
	scriptFile: string,
): string {
	const root = vscode.Uri.joinPath(extensionUri, ...relativeDir);
	const htmlPath = vscode.Uri.joinPath(root, htmlFile).fsPath;
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(root, styleFile));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(root, scriptFile));
	const nonce = createNonce();

	const template = fs.readFileSync(htmlPath, 'utf8');
	return template
		.replaceAll('{{cspSource}}', webview.cspSource)
		.replaceAll('{{nonce}}', nonce)
		.replaceAll('{{styleUri}}', styleUri.toString())
		.replaceAll('{{scriptUri}}', scriptUri.toString());
}

/**
 * CSP（Content Security Policy） 用の nonce を生成する。
 */
function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
