import type * as vscode from 'vscode';
import { GlobalStateKeys } from '../config/keys';

/** globalState に保存する最終操作チェックポイント */
export type WorkActivityCheckpoint = {
	lastActivityAt: string;
	username: string;
};

/** 他ウィンドウ生存ハートビート */
type AliveSignal = {
	at: number;
	windowId: string;
};

/** 他ウィンドウが生存しているとみなす上限（ミリ秒） */
export const PEER_ALIVE_TTL_MS = 90_000;

/** 起動ブートストラップの短時間ロック（ミリ秒） */
export const BOOTSTRAP_LOCK_MS = 15_000;

/** 生存ハートビート間隔（ミリ秒） */
export const ALIVE_HEARTBEAT_MS = 30_000;

/**
 * 作業の最終操作時刻とウィンドウ間生存信号を globalState で共有する。
 * Settings Sync 対象にはしない（マシンローカルのクラッシュ復帰用）。
 */
export class WorkActivityStore {
	/** この拡張ホスト（ウィンドウ）の識別子 */
	readonly windowId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

	constructor(private readonly globalState: vscode.Memento) {}

	/**
	 * 現在ユーザー向けの共有最終操作時刻（ms）を返す。無ければ null。
	 */
	getSharedLastActivityMs(username: string): number | null {
		const checkpoint = this.getCheckpoint();
		if (!checkpoint || checkpoint.username !== username.trim()) {
			return null;
		}
		const ms = Date.parse(checkpoint.lastActivityAt);
		return Number.isFinite(ms) ? ms : null;
	}

	/**
	 * 共有最終操作時刻を max 更新する。
	 */
	async touchActivity(username: string, atMs: number): Promise<number> {
		const key = username.trim();
		const existing = this.getSharedLastActivityMs(key);
		const nextMs = existing === null ? atMs : Math.max(existing, atMs);
		const checkpoint: WorkActivityCheckpoint = {
			lastActivityAt: new Date(nextMs).toISOString(),
			username: key,
		};
		await this.globalState.update(GlobalStateKeys.workActivityCheckpoint, checkpoint);
		return nextMs;
	}

	/**
	 * チェックポイントを削除する（退室成功時など）。
	 */
	async clearCheckpoint(): Promise<void> {
		await this.globalState.update(GlobalStateKeys.workActivityCheckpoint, undefined);
	}

	/**
	 * 生存ハートビートを更新する。
	 */
	async touchAlive(): Promise<void> {
		const signal: AliveSignal = { at: Date.now(), windowId: this.windowId };
		await this.globalState.update(GlobalStateKeys.extensionAliveAt, signal);
	}

	/**
	 * 他ウィンドウが最近生存しているか（自窓は除外）。
	 */
	isPeerAlive(nowMs = Date.now()): boolean {
		const signal = this.globalState.get<AliveSignal>(GlobalStateKeys.extensionAliveAt);
		if (!signal || typeof signal.at !== 'number' || typeof signal.windowId !== 'string') {
			return false;
		}
		if (signal.windowId === this.windowId) {
			return false;
		}
		return nowMs - signal.at < PEER_ALIVE_TTL_MS;
	}

	/**
	 * 起動ブートストラップ用の短時間ロックを取得する。
	 * @returns 取得できたら true
	 */
	async tryAcquireBootstrapLock(nowMs = Date.now()): Promise<boolean> {
		const lockAt = this.globalState.get<number>(GlobalStateKeys.bootstrapLockAt);
		if (typeof lockAt === 'number' && nowMs - lockAt < BOOTSTRAP_LOCK_MS) {
			return false;
		}
		await this.globalState.update(GlobalStateKeys.bootstrapLockAt, nowMs);
		return true;
	}

	private getCheckpoint(): WorkActivityCheckpoint | undefined {
		const raw = this.globalState.get<WorkActivityCheckpoint>(GlobalStateKeys.workActivityCheckpoint);
		if (!raw || typeof raw.lastActivityAt !== 'string' || typeof raw.username !== 'string') {
			return undefined;
		}
		return raw;
	}
}
