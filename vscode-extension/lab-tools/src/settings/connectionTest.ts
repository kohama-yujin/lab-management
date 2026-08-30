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

/**
 * serverIp を優先し、失敗したら publicUrl で /health を試す。
 */
export async function testConnection(
	serverIp: string,
	publicUrl: string,
): Promise<{ ok: true; used: 'serverIp' | 'publicUrl'; baseUrl: string } | { ok: false; message: string }> {
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
		return { ok: false, message: 'serverIp または public-url を入力してください' };
	}

	const errors: string[] = [];
	for (const candidate of candidates) {
		try {
			const res = await fetch(`${candidate.url}/health`, {
				method: 'GET',
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				return { ok: true, used: candidate.kind, baseUrl: candidate.url };
			}
			errors.push(`${candidate.kind}: HTTP ${res.status}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${candidate.kind}: ${msg}`);
		}
	}
	return { ok: false, message: errors.join(' / ') };
}
