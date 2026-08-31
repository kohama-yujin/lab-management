import { LabErrors, mapFetchFailures, mapHttpError, parseFetchErrorMessage } from '../errors/labError';
import type { LabError } from '../errors/labError';

/**
 * ベース URL を正規化する（末尾スラッシュ除去、スキーム補完）。
 */
export function normalizeBaseUrl(raw: string): string {
	let value = raw.trim().replace(/\/+$/, '');
	if (!value) {
		return '';
	}
	if (!/^https?:\/\//i.test(value)) {
		value = `http://${value}`;
	}
	return value;
}

type HealthResponse = {
	ok?: boolean;
	message?: string;
	public_url?: string;
};

/**
 * serverIp を優先し、失敗したら publicUrl で /health を試す。
 */
export async function testConnection(
	serverIp: string,
	publicUrl: string,
): Promise<
	| { ok: true; used: 'serverIp' | 'publicUrl'; baseUrl: string; publicUrl: string }
	| { ok: false; error: LabError }
> {
	const candidates: Array<{ kind: 'serverIp' | 'publicUrl'; url: string }> = [];
	const ip = normalizeBaseUrl(serverIp);
	const pub = normalizeBaseUrl(publicUrl);
	if (ip) {
		candidates.push({ kind: 'serverIp', url: ip });
	}
	if (pub) {
		candidates.push({ kind: 'publicUrl', url: pub });
	}
	if (candidates.length === 0) {
		return { ok: false, error: LabErrors.configServer() };
	}

	const errors: string[] = [];
	for (const candidate of candidates) {
		try {
			const res = await fetch(`${candidate.url}/health`, {
				method: 'GET',
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) {
				errors.push(`${candidate.kind}: HTTP ${res.status}`);
				continue;
			}

			let body: HealthResponse;
			try {
				body = (await res.json()) as HealthResponse;
			} catch {
				errors.push(`${candidate.kind}: 無効な JSON レスポンス`);
				continue;
			}
			if (!body.ok) {
				const msg = body.message ?? 'ok が false';
				errors.push(`${candidate.kind}: ${msg}`);
				continue;
			}

			const discoveredPublicUrl = typeof body.public_url === 'string' ? body.public_url.trim() : '';
			return {
				ok: true,
				used: candidate.kind,
				baseUrl: candidate.url,
				publicUrl: discoveredPublicUrl,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${candidate.kind}: ${msg}`);
		}
	}

	if (errors.length === 1) {
		const detail = parseFetchErrorMessage(errors[0]);
		if (detail.startsWith('HTTP') || detail === '無効な JSON レスポンス') {
			return { ok: false, error: LabErrors.network(errors[0]) };
		}
		return { ok: false, error: mapHttpError(0, detail) };
	}

	return { ok: false, error: mapFetchFailures(errors) };
}
