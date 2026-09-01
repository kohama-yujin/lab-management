import type { SettingsStore } from '../config/settingsStore';
import { LabErrors } from '../errors/labError';
import type { LabError } from '../errors/labError';
import { fetchPostJson } from './http';
import type { AttendancePayload } from './types';

type AttendanceCredentials =
	| {
			username: string;
			password: string;
			apiKey: string;
			serverIp: string;
			publicUrl: string;
	  }
	| { error: LabError };

/**
 * 入退室 POST に必要な設定・資格情報を検証して返す。
 */
export async function resolveAttendanceCredentials(store: SettingsStore): Promise<AttendanceCredentials> {
	const settings = await store.get();
	const { password, apiKey } = await store.getSecrets();

	if (!settings.serverIp && !settings.publicUrl) {
		return { error: LabErrors.configServer() };
	}
	const username = settings.username.trim();
	if (!username) {
		return { error: LabErrors.configUsername() };
	}
	if (!password) {
		return { error: LabErrors.configPassword() };
	}
	if (!apiKey) {
		return { error: LabErrors.configApiKey() };
	}

	return {
		username,
		password,
		apiKey,
		serverIp: settings.serverIp,
		publicUrl: settings.publicUrl,
	};
}

type AttendanceRequestOptions = {
	preferredBaseUrl?: string;
};

async function postAttendance(
	path: '/start_attendance' | '/end_attendance',
	credentials: Exclude<AttendanceCredentials, { error: LabError }>,
	options?: AttendanceRequestOptions,
) {
	return fetchPostJson<AttendancePayload>(
		path,
		credentials.serverIp,
		credentials.publicUrl,
		{
			apiKey: credentials.apiKey,
			body: {
				username: credentials.username,
				password: credentials.password,
			},
			preferredBaseUrl: options?.preferredBaseUrl,
			preferredOnly: Boolean(options?.preferredBaseUrl),
		},
	);
}

/**
 * POST /start_attendance で入室する。
 */
export async function startAttendance(
	store: SettingsStore,
	options?: AttendanceRequestOptions,
) {
	const credentials = await resolveAttendanceCredentials(store);
	if ('error' in credentials) {
		return { ok: false as const, error: credentials.error };
	}
	return postAttendance('/start_attendance', credentials, options);
}

/**
 * POST /end_attendance で退室する。
 */
export async function endAttendance(
	store: SettingsStore,
	options?: AttendanceRequestOptions,
) {
	const credentials = await resolveAttendanceCredentials(store);
	if ('error' in credentials) {
		return { ok: false as const, error: credentials.error };
	}
	return postAttendance('/end_attendance', credentials, options);
}
