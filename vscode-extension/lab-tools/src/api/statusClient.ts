import { fetchGetJson } from './http';
import type { StatusPayload } from './types';

/**
 * serverIp を優先し、失敗時は publicUrl で GET /status を試す。
 */
export async function fetchStatus(serverIp: string, publicUrl: string) {
	return fetchGetJson<StatusPayload>('/status', serverIp, publicUrl);
}
