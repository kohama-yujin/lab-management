/**
 * 設定キーと SecretStorage キーの定数。
 */

export const CONFIG_SECTION = 'labTools';

export const ConfigKeys = {
	username: `${CONFIG_SECTION}.username`,
	serverIp: `${CONFIG_SECTION}.serverIp`,
	publicUrl: `${CONFIG_SECTION}.publicUrl`,
	autoCheckIn: `${CONFIG_SECTION}.autoCheckIn`,
	soundOnCheckOut: `${CONFIG_SECTION}.soundOnCheckOut`,
} as const;

export const SecretKeys = {
	password: `${CONFIG_SECTION}.password`,
	apiKey: `${CONFIG_SECTION}.apiKey`,
} as const;

/** 初回未設定トーストを抑制するための globalState キー */
export const GlobalStateKeys = {
	setupToastDismissed: `${CONFIG_SECTION}.setupToastDismissed`,
} as const;
