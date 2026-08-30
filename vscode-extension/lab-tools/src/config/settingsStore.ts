import * as vscode from 'vscode';
import { ConfigKeys, SecretKeys } from './keys';

/**
 * 画面・API で使う接続・資格情報のまとまり。
 */
export type LabSettings = {
	username: string;
	serverIp: string;
	publicUrl: string;
	/** シークレットが保存済みなら true（値自体は返さない） */
	hasPassword: boolean;
	hasApiKey: boolean;
};

/**
 * 保存時に渡すペイロード。秘密は空文字なら既存値を維持する。
 */
export type LabSettingsUpdate = {
	username: string;
	serverIp: string;
	publicUrl: string;
	password: string;
	apiKey: string;
};

/**
 * Configuration と SecretStorage から設定を読み書きする。
 */
export class SettingsStore {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	/**
	 * 現在の設定を取得する。秘密の平文は含めない。
	 */
	async get(): Promise<LabSettings> {
		const cfg = vscode.workspace.getConfiguration();
		const password = await this.secrets.get(SecretKeys.password);
		const apiKey = await this.secrets.get(SecretKeys.apiKey);
		return {
			username: (cfg.get<string>(ConfigKeys.username) ?? '').trim(),
			serverIp: (cfg.get<string>(ConfigKeys.serverIp) ?? '').trim(),
			publicUrl: (cfg.get<string>(ConfigKeys.publicUrl) ?? '').trim(),
			hasPassword: Boolean(password),
			hasApiKey: Boolean(apiKey),
		};
	}

	/**
	 * API 呼び出し用に秘密を含む値を取得する。
	 */
	async getSecrets(): Promise<{ password: string; apiKey: string }> {
		return {
			password: (await this.secrets.get(SecretKeys.password)) ?? '',
			apiKey: (await this.secrets.get(SecretKeys.apiKey)) ?? '',
		};
	}

	/**
	 * 設定を保存する。password / apiKey が空なら既存シークレットを維持する。
	 */
	async save(update: LabSettingsUpdate): Promise<void> {
		const cfg = vscode.workspace.getConfiguration();
		await cfg.update(ConfigKeys.username, update.username.trim(), vscode.ConfigurationTarget.Global);
		await cfg.update(ConfigKeys.serverIp, update.serverIp.trim(), vscode.ConfigurationTarget.Global);
		await cfg.update(ConfigKeys.publicUrl, update.publicUrl.trim(), vscode.ConfigurationTarget.Global);

		if (update.password !== '') {
			await this.secrets.store(SecretKeys.password, update.password);
		}
		if (update.apiKey !== '') {
			await this.secrets.store(SecretKeys.apiKey, update.apiKey);
		}
	}

	/**
	 * 必須項目が揃っているか判定する。
	 * serverIp と publicUrl は少なくとも一方が必要。
	 */
	async isConfigured(): Promise<boolean> {
		const s = await this.get();
		const hasEndpoint = Boolean(s.serverIp || s.publicUrl);
		return Boolean(s.username && s.hasPassword && s.hasApiKey && hasEndpoint);
	}
}
