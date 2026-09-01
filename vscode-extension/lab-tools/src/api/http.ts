import { LabErrors, mapFetchFailures, mapHttpError } from '../errors/labError';
import type { LabError } from '../errors/labError';
import { normalizeBaseUrl } from '../settings/connectionTest';

type FetchOk<T> = { ok: true; data: T; baseUrl: string };
type FetchErr = { ok: false; error: LabError };

type FetchAttemptError = {
	baseUrl: string;
	status: number;
	message: string;
};

export type FetchGetJsonOptions = {
	preferredBaseUrl?: string;
	/** true なら preferredBaseUrl のみ試す（/status 成功後の /member 取得向け） */
	preferredOnly?: boolean;
};

/**
 * serverIp / publicUrl から接続候補 URL 一覧を作る。
 */
export function resolveBaseUrls(serverIp: string, publicUrl: string): string[] {
	const candidates: string[] = [];
	const ip = normalizeBaseUrl(serverIp);
	const pub = normalizeBaseUrl(publicUrl);
	if (ip) {
		candidates.push(ip);
	}
	if (pub && pub !== ip) {
		candidates.push(pub);
	}
	return candidates;
}

/**
 * 候補ベース URL を順に試して GET JSON を取得する。
 */
export async function fetchGetJson<T>(
	path: string,
	serverIp: string,
	publicUrl: string,
	options?: FetchGetJsonOptions,
): Promise<FetchOk<T> | FetchErr> {
	const candidates = resolveBaseUrls(serverIp, publicUrl);
	if (candidates.length === 0) {
		return { ok: false, error: LabErrors.configServer() };
	}

	const preferredBaseUrl = options?.preferredBaseUrl;
	const preferredOnly = options?.preferredOnly === true && Boolean(preferredBaseUrl);

	let ordered: string[];
	if (preferredOnly && preferredBaseUrl) {
		ordered = [preferredBaseUrl];
	} else if (preferredBaseUrl && candidates.includes(preferredBaseUrl)) {
		ordered = [preferredBaseUrl, ...candidates.filter((u) => u !== preferredBaseUrl)];
	} else {
		ordered = candidates;
	}

	const errors: FetchAttemptError[] = [];
	for (const baseUrl of ordered) {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				method: 'GET',
				cache: 'no-store',
				signal: AbortSignal.timeout(8000),
			});
			if (!res.ok) {
				let message = `HTTP ${res.status}`;
				try {
					const body = (await res.json()) as { message?: string };
					if (body.message) {
						message = body.message;
					}
				} catch {
					// JSON でないエラー応答は HTTP コードのみ
				}
				errors.push({ baseUrl, status: res.status, message });
				continue;
			}
			const data = (await res.json()) as T;
			return { ok: true, data, baseUrl };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push({ baseUrl, status: 0, message: msg });
		}
	}

	if (errors.length === 1) {
		const entry = errors[0];
		return { ok: false, error: mapHttpError(entry.status, entry.message) };
	}

	return {
		ok: false,
		error: mapFetchFailures(errors.map((e) => `${e.baseUrl}: ${e.message}`)),
	};
}

export type FetchPostJsonOptions = FetchGetJsonOptions & {
	body: Record<string, unknown>;
	apiKey: string;
};

/**
 * 候補ベース URL を順に試して POST JSON を送信する。
 */
export async function fetchPostJson<T>(
	path: string,
	serverIp: string,
	publicUrl: string,
	options: FetchPostJsonOptions,
): Promise<FetchOk<T> | FetchErr> {
	const candidates = resolveBaseUrls(serverIp, publicUrl);
	if (candidates.length === 0) {
		return { ok: false, error: LabErrors.configServer() };
	}

	const preferredBaseUrl = options.preferredBaseUrl;
	const preferredOnly = options.preferredOnly === true && Boolean(preferredBaseUrl);

	let ordered: string[];
	if (preferredOnly && preferredBaseUrl) {
		ordered = [preferredBaseUrl];
	} else if (preferredBaseUrl && candidates.includes(preferredBaseUrl)) {
		ordered = [preferredBaseUrl, ...candidates.filter((u) => u !== preferredBaseUrl)];
	} else {
		ordered = candidates;
	}

	const errors: FetchAttemptError[] = [];
	for (const baseUrl of ordered) {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				method: 'POST',
				cache: 'no-store',
				headers: {
					'Content-Type': 'application/json',
					'X-Api-Key': options.apiKey,
				},
				body: JSON.stringify(options.body),
				signal: AbortSignal.timeout(8000),
			});
			if (!res.ok) {
				let message = `HTTP ${res.status}`;
				try {
					const body = (await res.json()) as { message?: string };
					if (body.message) {
						message = body.message;
					}
				} catch {
					// JSON でないエラー応答は HTTP コードのみ
				}
				errors.push({ baseUrl, status: res.status, message });
				continue;
			}
			const data = (await res.json()) as T;
			return { ok: true, data, baseUrl };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push({ baseUrl, status: 0, message: msg });
		}
	}

	if (errors.length === 1) {
		const entry = errors[0];
		return { ok: false, error: mapHttpError(entry.status, entry.message) };
	}

	return {
		ok: false,
		error: mapFetchFailures(errors.map((e) => `${e.baseUrl}: ${e.message}`)),
	};
}
