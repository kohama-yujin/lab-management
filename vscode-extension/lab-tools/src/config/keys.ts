/**
 * 設定キーと SecretStorage キーの定数。
 */

export const CONFIG_SECTION = 'labTools';

export const ConfigKeys = {
	username: `${CONFIG_SECTION}.username`,
	serverIp: `${CONFIG_SECTION}.serverIp`,
	publicUrl: `${CONFIG_SECTION}.publicUrl`,
	idleTimeoutMinutes: `${CONFIG_SECTION}.workTracking.idleTimeoutMinutes`,
} as const;

export const SecretKeys = {
	password: `${CONFIG_SECTION}.password`,
	apiKey: `${CONFIG_SECTION}.apiKey`,
} as const;

/** 初回未設定トーストを抑制するための globalState キー */
export const GlobalStateKeys = {
	setupToastDismissed: `${CONFIG_SECTION}.setupToastDismissed`,
	/** 最終操作時刻チェックポイント（Settings Sync しない） */
	workActivityCheckpoint: `${CONFIG_SECTION}.workActivityCheckpoint`,
	/** 他ウィンドウ生存のハートビート（Settings Sync しない） */
	extensionAliveAt: `${CONFIG_SECTION}.extensionAliveAt`,
	/** 起動ブートストラップの短時間ロック */
	bootstrapLockAt: `${CONFIG_SECTION}.bootstrapLockAt`,
} as const;
