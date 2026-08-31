import { normalizeBaseUrl } from '../settings/connectionTest';
import type { StatusPayload } from './types';

type FetchOk = { ok: true; data: StatusPayload; baseUrl: string };
type FetchErr = { ok: false; message: string };

/**
 * serverIp を優先し、失敗時は publicUrl で GET /status を試す。
 */
export async function fetchStatus(serverIp: string, publicUrl: string): Promise<FetchOk | FetchErr> {
	const candidates: string[] = [];
	const ip = normalizeBaseUrl(serverIp);
	const pub = normalizeBaseUrl(publicUrl);
	if (ip) {
		candidates.push(ip);
	}
	if (pub && pub !== ip) {
		candidates.push(pub);
	}
	if (candidates.length === 0) {
		return { ok: false, message: 'serverIp または public-url を設定してください' };
	}

	const errors: string[] = [];
	for (const baseUrl of candidates) {
		try {
			const res = await fetch(`${baseUrl}/status`, {
				method: 'GET',
				cache: 'no-store',
				signal: AbortSignal.timeout(8000),
			});
			if (!res.ok) {
				errors.push(`${baseUrl}: HTTP ${res.status}`);
				continue;
			}
			const data = (await res.json()) as StatusPayload;
			return { ok: true, data, baseUrl };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${baseUrl}: ${msg}`);
		}
	}
	return { ok: false, message: errors.join(' / ') };
}
