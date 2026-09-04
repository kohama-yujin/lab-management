import * as vscode from 'vscode';
import { endWork, startWork } from '../api/workClient';
import type { StatusPayload } from '../api/types';
import { findMemberById } from './findMember';
import type { SettingsStore } from '../config/settingsStore';
import { ConfigKeys } from '../config/keys';
import { displayMessage } from '../errors/labError';
import { ALIVE_HEARTBEAT_MS, type WorkActivityStore } from './workActivityStore';

/** エディタ操作のデバウンス（ミリ秒） */
const ACTIVITY_DEBOUNCE_MS = 400;

export type WorkSessionContext = {
	status: StatusPayload | null;
	memberId: number | null;
	lastBaseUrl: string | null;
};

/**
 * 在室中のエディタ操作で作業開始し、アイドル・退室で終了する。
 * 最終操作時刻は globalState 経由でウィンドウ間共有する。
 */
export class WorkSessionController implements vscode.Disposable {
	private activityTimer: ReturnType<typeof setTimeout> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private aliveTimer: ReturnType<typeof setInterval> | null = null;
	private startInFlight = false;
	private idleEndInFlight = false;
	/** 窓ローカルのキャッシュ。判定の真実は activityStore 側 */
	private lastActivityAt = Date.now();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly store: SettingsStore,
		private readonly activityStore: WorkActivityStore,
		private readonly getContext: () => WorkSessionContext,
		private readonly reload: (options?: { silent?: boolean }) => Promise<void>,
	) {
		this.disposables.push(
			vscode.window.onDidChangeWindowState((state) => {
				if (state.focused) {
					void this.syncSharedActivityAndReschedule();
					this.scheduleActivity();
				}
			}),
			vscode.workspace.onDidChangeTextDocument(() => {
				this.scheduleActivity();
			}),
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.scheduleActivity();
			}),
		);
		this.aliveTimer = setInterval(() => {
			void this.activityStore.touchAlive();
		}, ALIVE_HEARTBEAT_MS);
		void this.activityStore.touchAlive();
	}

	/**
	 * エディタ操作をまとめてから作業開始・アイドル監視を更新する。
	 */
	scheduleActivity(): void {
		if (this.activityTimer) {
			clearTimeout(this.activityTimer);
		}
		this.activityTimer = setTimeout(() => {
			this.activityTimer = null;
			void this.onActivity();
		}, ACTIVITY_DEBOUNCE_MS);
	}

	/**
	 * 自動入室直後など、同じ操作バーストで作業開始を試す。
	 */
	async onActivityAfterCheckIn(): Promise<void> {
		await this.onActivity();
	}

	/**
	 * 退室操作前にアイドル監視を止める。
	 */
	prepareForCheckout(): void {
		this.clearIdleTimer();
	}

	/**
	 * status 更新後にアイドル監視を再同期する。
	 */
	notifyStatusUpdated(): void {
		void this.syncSharedActivityAndReschedule();
	}

	/**
	 * 他窓の共有時刻を取り込み、アイドル監視を張り直す。
	 */
	private async syncSharedActivityAndReschedule(): Promise<void> {
		const settings = await this.store.get();
		const shared = this.activityStore.getSharedLastActivityMs(settings.username);
		if (shared !== null) {
			this.lastActivityAt = Math.max(this.lastActivityAt, shared);
		}
		this.resetIdleTimer();
	}

	private async onActivity(): Promise<void> {
		const now = Date.now();
		const settings = await this.store.get();
		this.lastActivityAt = await this.activityStore.touchActivity(settings.username, now);
		await this.activityStore.touchAlive();
		await this.tryStartWork();
		this.resetIdleTimer();
	}

	private getIdleTimeoutMs(): number {
		const minutes =
			vscode.workspace.getConfiguration().get<number>(ConfigKeys.idleTimeoutMinutes) ?? 30;
		return Math.max(1, minutes) * 60_000;
	}

	private async tryStartWork(): Promise<void> {
		if (this.startInFlight) {
			return;
		}
		if (!(await this.store.isConfigured())) {
			return;
		}

		const { status, memberId, lastBaseUrl } = this.getContext();
		if (!status || memberId === null) {
			return;
		}

		const self = findMemberById(status, memberId);
		if (!self?.present || self.working) {
			return;
		}

		this.startInFlight = true;
		try {
			const result = await startWork(this.store, {
				preferredBaseUrl: lastBaseUrl ?? undefined,
			});
			if (!result.ok) {
				void vscode.window.showErrorMessage(displayMessage(result.error));
				return;
			}
			await this.reload({ silent: true });
		} finally {
			this.startInFlight = false;
		}
	}

	private async tryIdleEndWork(): Promise<void> {
		if (this.idleEndInFlight) {
			return;
		}
		if (!(await this.store.isConfigured())) {
			return;
		}

		const { status, memberId, lastBaseUrl } = this.getContext();
		if (!status || memberId === null) {
			return;
		}

		const self = findMemberById(status, memberId);
		if (!self?.present || !self.working) {
			return;
		}

		const settings = await this.store.get();
		const shared = this.activityStore.getSharedLastActivityMs(settings.username);
		if (shared !== null) {
			this.lastActivityAt = Math.max(this.lastActivityAt, shared);
		}

		const idleMs = this.getIdleTimeoutMs();
		if (Date.now() - this.lastActivityAt < idleMs) {
			this.resetIdleTimer();
			return;
		}

		this.idleEndInFlight = true;
		try {
			const result = await endWork(this.store, {
				preferredBaseUrl: lastBaseUrl ?? undefined,
				endAt: new Date(this.lastActivityAt).toISOString(),
			});
			if (!result.ok) {
				void vscode.window.showErrorMessage(displayMessage(result.error));
				return;
			}
			await this.reload({ silent: true });
		} finally {
			this.idleEndInFlight = false;
		}
	}

	private resetIdleTimer(): void {
		this.clearIdleTimer();

		const { status, memberId } = this.getContext();
		if (!status || memberId === null) {
			return;
		}

		const self = findMemberById(status, memberId);
		if (!self?.present || !self.working) {
			return;
		}

		const idleMs = this.getIdleTimeoutMs();
		const elapsed = Date.now() - this.lastActivityAt;
		const remaining = idleMs - elapsed;

		if (remaining <= 0) {
			void this.tryIdleEndWork();
			return;
		}

		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			void this.tryIdleEndWork();
		}, remaining);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	dispose(): void {
		this.clearIdleTimer();
		if (this.activityTimer) {
			clearTimeout(this.activityTimer);
		}
		if (this.aliveTimer) {
			clearInterval(this.aliveTimer);
			this.aliveTimer = null;
		}
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
