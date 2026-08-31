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
		return { ok: false as const, message: 'ユーザー名を設定してください' };
	}
	if (!password) {
		return { ok: false as const, message: 'パスワードを設定してください' };
	}
	const query = `username=${encodeURIComponent(key)}&password=${encodeURIComponent(password)}`;
	return fetchGetJson<MemberPayload>(`/member?${query}`, serverIp, publicUrl, {
		preferredBaseUrl,
		preferredOnly: Boolean(preferredBaseUrl),
	});
}
