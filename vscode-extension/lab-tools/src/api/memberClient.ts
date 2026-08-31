import { LabErrors } from '../errors/labError';
import { fetchGetJson } from './http';
import type { MemberPayload } from './types';

/**
 * username / password で GET /member からメンバー情報を取得する。
 */
export async function fetchMemberByCredentials(
	username: string,
	password: string,
	serverIp: string,
	publicUrl: string,
	preferredBaseUrl?: string,
) {
	const key = username.trim();
	if (!key) {
		return { ok: false as const, error: LabErrors.configUsername() };
	}
	if (!password) {
		return { ok: false as const, error: LabErrors.configPassword() };
	}
	const query = `username=${encodeURIComponent(key)}&password=${encodeURIComponent(password)}`;
	return fetchGetJson<MemberPayload>(`/member?${query}`, serverIp, publicUrl, {
		preferredBaseUrl,
		preferredOnly: Boolean(preferredBaseUrl),
	});
}

