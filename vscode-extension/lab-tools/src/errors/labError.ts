/**
 * 拡張機能全体で共通利用するエラー型。
 * userMessage が唯一のユーザー向け本文。detail は開発者向けの補足（NETWORK / SERVER_ERROR のみ）。
 */
export type LabErrorCode =
	| 'CONFIG_SERVER'
	| 'CONFIG_USERNAME'
	| 'CONFIG_PASSWORD'
	| 'CONFIG_API_KEY'
	| 'NETWORK'
	| 'AUTH_FAILED'
	| 'GRADUATED'
	| 'SERVER_ERROR'
	| 'SAVE_FAILED';

export type LabError = {
	code: LabErrorCode;
	userMessage: string;
	/** UI 本文には出さない技術補足（URL 等）。userMessage と重複させない */
	detail?: string;
};

/** Webview へ送るエラー（userMessage のみ） */
export type LabErrorView = {
	code: LabErrorCode;
	userMessage: string;
};

const USER_MESSAGES: Record<LabErrorCode, string> = {
	CONFIG_SERVER: 'サーバー IP または公開 URL を設定してください',
	CONFIG_USERNAME: 'ユーザー名を設定してください',
	CONFIG_PASSWORD: 'パスワードを設定してください',
	CONFIG_API_KEY: 'APIキーを設定してください',
	NETWORK: 'サーバーに接続できません',
	AUTH_FAILED: 'ユーザー名またはパスワードが正しくありません',
	GRADUATED: '卒業済みのため入退室できません',
	SERVER_ERROR: 'サーバーでエラーが発生しました',
	SAVE_FAILED: '設定の保存に失敗しました',
};

/**
 * 定義済み LabError を生成する。
 */
export const LabErrors = {
	configServer(): LabError {
		return { code: 'CONFIG_SERVER', userMessage: USER_MESSAGES.CONFIG_SERVER };
	},
	configUsername(): LabError {
		return { code: 'CONFIG_USERNAME', userMessage: USER_MESSAGES.CONFIG_USERNAME };
	},
	configPassword(): LabError {
		return { code: 'CONFIG_PASSWORD', userMessage: USER_MESSAGES.CONFIG_PASSWORD };
	},
	configApiKey(): LabError {
		return { code: 'CONFIG_API_KEY', userMessage: USER_MESSAGES.CONFIG_API_KEY };
	},
	configApiKeyInvalid(): LabError {
		return { code: 'CONFIG_API_KEY', userMessage: 'APIキーが正しくありません' };
	},
	network(detail?: string): LabError {
		return withOptionalDetail(
			{ code: 'NETWORK', userMessage: USER_MESSAGES.NETWORK },
			detail,
		);
	},
	authFailed(): LabError {
		return { code: 'AUTH_FAILED', userMessage: USER_MESSAGES.AUTH_FAILED };
	},
	graduated(): LabError {
		return { code: 'GRADUATED', userMessage: USER_MESSAGES.GRADUATED };
	},
	serverError(detail?: string): LabError {
		return withOptionalDetail(
			{ code: 'SERVER_ERROR', userMessage: USER_MESSAGES.SERVER_ERROR },
			detail,
		);
	},
	saveFailed(detail?: string): LabError {
		return withOptionalDetail(
			{ code: 'SAVE_FAILED', userMessage: USER_MESSAGES.SAVE_FAILED },
			detail,
		);
	},
};

/**
 * userMessage と異なる detail のみ付与する。
 */
function withOptionalDetail(error: LabError, detail?: string): LabError {
	const trimmed = detail?.trim();
	if (!trimmed || trimmed === error.userMessage) {
		return error;
	}
	return { ...error, detail: trimmed };
}

/**
 * サーバー API の message を LabError に変換する（StoreError / ApiError の message）。
 * 既知コードでは userMessage を統一し、サーバー原文は detail に入れない。
 */
export function mapServerMessage(message: string): LabError {
	const trimmed = message.trim();
	if (trimmed.includes('APIキーが無効')) {
		return LabErrors.configApiKeyInvalid();
	}
	if (
		trimmed.includes('ユーザー名またはパスワード') ||
		trimmed.includes('パスワードが正しくありません') ||
		trimmed.includes('ユーザーが見つかりません') ||
		(trimmed.includes('ユーザー名は') && trimmed.includes('文字')) ||
		(trimmed.includes('パスワードは') && trimmed.includes('文字')) ||
		trimmed.includes('パスワードが間違')
	) {
		return LabErrors.authFailed();
	}
	if (
		trimmed.includes('ユーザー名は必須') ||
		trimmed.includes('ユーザー名を設定') ||
		trimmed.includes('username と password は必須')
	) {
		return LabErrors.configUsername();
	}

	if (
		trimmed.includes('パスワードは必須') ||
		trimmed.includes('パスワードを設定')
	) {
		return LabErrors.configPassword();
	}
	if (trimmed.includes('卒業')) {
		return LabErrors.graduated();
	}
	return LabErrors.serverError(trimmed);
}

/**
 * HTTP ステータスと message から LabError を決定する。
 */
export function mapHttpError(status: number, message: string): LabError {
	const mapped = mapServerMessage(message);
	if (status === 401) {
		if (mapped.code === 'CONFIG_API_KEY' || mapped.code === 'AUTH_FAILED') {
			return mapped;
		}
		return LabErrors.authFailed();
	}
	if (message.startsWith('HTTP ')) {
		return LabErrors.network(message);
	}
	return mapped;
}

/**
 * `${baseUrl}: ${message}` 形式の文字列から message 部分を取り出す。
 */
export function parseFetchErrorMessage(entry: string): string {
	const separator = entry.lastIndexOf(': ');
	if (separator >= 0) {
		return entry.slice(separator + 2);
	}
	return entry;
}

/**
 * fetch 失敗の詳細一覧を LabError に変換する。
 */
export function mapFetchFailures(details: string[]): LabError {
	const joined = details.join(' / ');
	for (const entry of details) {
		const msg = parseFetchErrorMessage(entry);
		if (msg && !msg.startsWith('HTTP')) {
			return mapServerMessage(msg);
		}
	}
	return LabErrors.network(joined);
}

/**
 * 不明な例外を LabError に変換する。
 */
export function mapUnknownError(err: unknown): LabError {
	const detail = err instanceof Error ? err.message : String(err);
	return LabErrors.saveFailed(detail);
}

/**
 * 全 UI チャネル共通の表示文言。
 */
export function displayMessage(error: LabError): string {
	return error.userMessage;
}

/**
 * Webview 送信用に detail を除いたエラーを返す。
 */
export function toViewError(error: LabError | null): LabErrorView | null {
	if (!error) {
		return null;
	}
	return { code: error.code, userMessage: error.userMessage };
}

/**
 * ステータスバー tooltip 用。ユーザー向けは userMessage のみ。
 * NETWORK / SERVER_ERROR のみ detail を追記する。
 */
export function errorTooltip(error: LabError): string {
	if (
		error.detail &&
		(error.code === 'NETWORK' || error.code === 'SERVER_ERROR') &&
		error.detail !== error.userMessage
	) {
		return `${error.userMessage}\n${error.detail}`;
	}
	return error.userMessage;
}

/**
 * ステータスバー左の短ラベルとスタイルを返す。
 */
export function statusBarLabel(error: LabError): { text: string; style: 'error' | 'warning' } {
	switch (error.code) {
		case 'CONFIG_SERVER':
		case 'CONFIG_USERNAME':
		case 'CONFIG_PASSWORD':
		case 'CONFIG_API_KEY':
			return { text: '$(warning) 在室: 未設定', style: 'warning' };
		case 'AUTH_FAILED':
			return { text: '$(warning) 在室: 認証失敗', style: 'warning' };
		case 'GRADUATED':
			return { text: '$(warning) 在室: 利用不可', style: 'warning' };
		case 'NETWORK':
			return { text: '$(error) 在室: 接続失敗', style: 'error' };
		case 'SERVER_ERROR':
			return { text: '$(error) 在室: 取得失敗', style: 'error' };
		case 'SAVE_FAILED':
			return { text: '$(error) 在室: 保存失敗', style: 'error' };
	}
}
