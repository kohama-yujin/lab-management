import type { SettingsStore } from '../config/settingsStore';
import type { LabError } from '../errors/labError';
import { resolveAttendanceCredentials } from './attendanceClient';
import { fetchPostJson } from './http';
import type { AttendancePayload } from './types';

type WorkRequestOptions = {
	preferredBaseUrl?: string;
	endAt?: string;
};

async function postWork(
	path: '/start_work' | '/end_work',
	credentials: Exclude<Awaited<ReturnType<typeof resolveAttendanceCredentials>>, { error: LabError }>,
	options?: WorkRequestOptions,
) {
	const body: Record<string, string> = {
		username: credentials.username,
		password: credentials.password,
	};
	if (options?.endAt) {
		body.end_at = options.endAt;
	}

	return fetchPostJson<AttendancePayload>(
		path,
		credentials.serverIp,
		credentials.publicUrl,
		{
			apiKey: credentials.apiKey,
			body,
			preferredBaseUrl: options?.preferredBaseUrl,
			preferredOnly: Boolean(options?.preferredBaseUrl),
		},
	);
}

/**
 * POST /start_work で作業を開始する。
 */
export async function startWork(store: SettingsStore, options?: WorkRequestOptions) {
	const credentials = await resolveAttendanceCredentials(store);
	if ('error' in credentials) {
		return { ok: false as const, error: credentials.error };
	}
	return postWork('/start_work', credentials, options);
}

/**
 * POST /end_work で作業を終了する。
 */
export async function endWork(store: SettingsStore, options?: WorkRequestOptions) {
	const credentials = await resolveAttendanceCredentials(store);
	if ('error' in credentials) {
		return { ok: false as const, error: credentials.error };
	}
	return postWork('/end_work', credentials, options);
}
