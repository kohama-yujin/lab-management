import * as vscode from 'vscode';
import { endWork, startWork } from '../api/workClient';
import type { StatusPayload } from '../api/types';
import { findMemberById } from './findMember';
import type { SettingsStore } from '../config/settingsStore';
import { ConfigKeys } from '../config/keys';
import { displayMessage } from '../errors/labError';

/** エディタ操作のデバウンス（ミリ秒） */
const ACTIVITY_DEBOUNCE_MS = 400;

export type WorkSessionContext = {
	status: StatusPayload | null;
	memberId: number | null;
	lastBaseUrl: string | null;
};

/**
 * 在室中のエディタ操作で作業開始し、アイドル・退室で終了する。
 */
export class WorkSessionController implements vscode.Disposable {
	private activityTimer: ReturnType<typeof setTimeout> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private startInFlight = false;
	private idleEndInFlight = false;
	private lastActivityAt = Date.now();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly store: SettingsStore,
		private readonly getContext: () => WorkSessionContext,
		private readonly reload: (options?: { silent?: boolean }) => Promise<void>,
	) {
		this.disposables.push(
			vscode.window.onDidChangeWindowState((state) => {
				if (state.focused) {
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
		this.resetIdleTimer();
	}

	private async onActivity(): Promise<void> {
		this.lastActivityAt = Date.now();
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
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
