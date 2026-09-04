import * as vscode from 'vscode';
import { endAttendance, startAttendance } from '../api/attendanceClient';
import { resolveBaseUrls } from '../api/http';
import { fetchMemberByCredentials } from '../api/memberClient';
import { fetchStatus } from '../api/statusClient';
import type { StatusPayload } from '../api/types';
import { buildViewState, resolveViewError } from '../attendance/buildViewState';
import { confirmCheckIn, confirmCheckOut } from '../attendance/dialogs';
import { findMemberById } from '../attendance/findMember';
import { WorkSessionController } from '../attendance/workSessionController';
import { WorkActivityStore } from '../attendance/workActivityStore';
import type { SettingsStore } from '../config/settingsStore';
import { ConfigKeys } from '../config/keys';
import type { LabError } from '../errors/labError';
import { displayMessage } from '../errors/labError';
import { AttendanceStatusBar } from '../statusBar/attendanceStatusBar';
import { StatusWebviewProvider } from '../views/statusWebviewProvider';
import { endWork, startWork } from '../api/workClient';

/** 在室状況の自動更新間隔（ミリ秒） */
const AUTO_RELOAD_INTERVAL_MS = 60_000;

/** 手動退室後、自動入室を抑止する時間（ミリ秒） */
const MANUAL_CHECK_OUT_AUTO_CHECK_IN_SUPPRESS_MS = 60_000;

/**
 * GET /status の取得と UI（サイドバー・ステータスバー）の更新を担う。
 */
export class StatusController implements vscode.Disposable {
	readonly webviewProvider: StatusWebviewProvider;
	readonly statusBar: AttendanceStatusBar;
	readonly workSession: WorkSessionController;

	private status: StatusPayload | null = null;
	private memberId: number | null = null;
	private viewError: LabError | null = null;
	private loading = false;
	private lastBaseUrl: string | null = null;
	private lastUpdatedAt: Date | null = null;
	private reloadChain: Promise<void> = Promise.resolve();
	private readonly autoReloadTimer: ReturnType<typeof setInterval>;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly activityStore: WorkActivityStore;

	private autoCheckInInFlight = false;
	private autoCheckInTimer: ReturnType<typeof setTimeout> | null = null;
	/** 最後に手動退室した時刻（未退室なら 0） */
	private lastManualCheckOutAt = 0;
	private bootstrapDone = false;
	private bootstrapInFlight = false;

	constructor(
		private readonly store: SettingsStore,
		private readonly extensionUri: vscode.Uri,
		globalState: vscode.Memento,
	) {
		this.activityStore = new WorkActivityStore(globalState);
		this.webviewProvider = new StatusWebviewProvider(extensionUri, (msg) => this.onWebviewMessage(msg));
		this.statusBar = new AttendanceStatusBar(
			() => {
				void this.handleToggleFromStatusBar();
			},
			() => {
				void this.webviewProvider.focus();
			},
		);
		this.workSession = new WorkSessionController(
			this.store,
			this.activityStore,
			() => ({
				status: this.status,
				memberId: this.memberId,
				lastBaseUrl: this.lastBaseUrl,
			}),
			(options) => this.reload(options),
		);
		this.autoReloadTimer = setInterval(() => {
			void this.reload({ silent: true });
		}, AUTO_RELOAD_INTERVAL_MS);

		this.disposables.push(
			this.workSession,
			vscode.window.onDidChangeWindowState((state) => {
				if (state.focused) {
					this.scheduleAutoCheckIn();
				}
			}),
			vscode.workspace.onDidChangeTextDocument(() => {
				this.scheduleAutoCheckIn();
			}),
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.scheduleAutoCheckIn();
			}),
		);

		void this.reload();
	}

	/**
	 * 連打をまとめてから自動入室を試す。
	 */
	private scheduleAutoCheckIn(): void {
		if (this.autoCheckInTimer) {
			clearTimeout(this.autoCheckInTimer);
		}
		this.autoCheckInTimer = setTimeout(() => {
			this.autoCheckInTimer = null;
			void this.tryAutoCheckIn();
		}, 400);
	}

	/**
	 * GET /status と GET /member で再取得し UI を更新する。
	 * @param options.silent true のとき読み込み中バナーを出さない（自動更新向け）
	 */
	async reload(options?: { silent?: boolean }): Promise<void> {
		const silent = options?.silent === true;
		// 先行 reload の完了後に必ず再取得する（自動入室直後の更新が捨てられないようにする）
		const run = this.reloadChain.then(() => this.runReload(silent));
		this.reloadChain = run.then(
			() => undefined,
			() => undefined,
		);
		await run;
	}

	private async runReload(silent: boolean): Promise<void> {
		if (!silent) {
			this.loading = true;
			await this.pushUi();
		}

		const settings = await this.store.get();
		const result = await fetchStatus(settings.serverIp, settings.publicUrl);

		this.loading = false;
		if (result.ok) {
			this.status = result.data;
			this.viewError = null;
			this.lastBaseUrl = result.baseUrl;
			this.lastUpdatedAt = new Date();
			await this.resolveMember(
				settings.username,
				settings.serverIp,
				settings.publicUrl,
				result.baseUrl,
			);
		} else {
			this.status = null;
			this.memberId = null;
			this.viewError = result.error;
		}
		await this.pushUi();
		this.workSession.notifyStatusUpdated();
		if (!this.bootstrapDone && !this.bootstrapInFlight) {
			void this.runStartupBootstrap();
		}
	}

	/**
	 * 不在時のエディタ操作による自動入室（確認ダイアログなし）。
	 */
	async tryAutoCheckIn(): Promise<void> {
		if (this.bootstrapInFlight) {
			return;
		}
		// 設定済みで起動ブートストラップ前なら、入室はブートストラップに任せる
		if (!this.bootstrapDone && (await this.store.isConfigured())) {
			return;
		}
		if (this.autoCheckInInFlight) {
			return;
		}
		if (Date.now() - this.lastManualCheckOutAt < MANUAL_CHECK_OUT_AUTO_CHECK_IN_SUPPRESS_MS) {
			return;
		}
		if (!(await this.store.isConfigured())) {
			return;
		}
		if (!this.status || this.memberId === null) {
			return;
		}

		const present = findMemberById(this.status, this.memberId)?.present ?? false;
		if (present) {
			return;
		}

		this.autoCheckInInFlight = true;
		try {
			const result = await startAttendance(this.store, {
				preferredBaseUrl: this.lastBaseUrl ?? undefined,
			});
			if (!result.ok) {
				void vscode.window.showErrorMessage(displayMessage(result.error));
				return;
			}

			if (result.baseUrl) {
				this.lastBaseUrl = result.baseUrl;
			}
			await this.reload({ silent: true });
			await this.workSession.onActivityAfterCheckIn();
		} finally {
			this.autoCheckInInFlight = false;
		}
	}

	/**
	 * 在室管理ページを外部ブラウザで開く。
	 */
	async openAttendancePage(): Promise<void> {
		const settings = await this.store.get();
		const baseUrl =
			this.lastBaseUrl ??
			resolveBaseUrls(settings.serverIp, settings.publicUrl)[0] ??
			null;
		if (!baseUrl) {
			void vscode.window.showErrorMessage(
				'接続先が未設定です。Lab Tools の接続設定で サーバーIP または 公開URL を入力してください。',
			);
			return;
		}

		await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
	}

	/**
	 * ステータスバー左クリック時の入退室切替。
	 */
	async handleToggleFromStatusBar(): Promise<void> {
		const settings = await this.store.get();
		const effectiveError = resolveViewError(this.status, this.viewError, settings.username);

		if (!this.status || effectiveError) {
			if (effectiveError) {
				void vscode.window.showErrorMessage(displayMessage(effectiveError));
			}
			return;
		}

		const self = findMemberById(this.status, this.memberId!);
		const present = self?.present ?? false;
		if (present) {
			await this.handleCheckOut();
		} else {
			await this.handleCheckIn();
		}
	}

	private async resolveMember(
		username: string,
		serverIp: string,
		publicUrl: string,
		preferredBaseUrl: string,
	): Promise<void> {
		const key = username.trim();
		if (!key) {
			this.memberId = null;
			return;
		}

		const { password } = await this.store.getSecrets();
		const result = await fetchMemberByCredentials(
			key,
			password,
			serverIp,
			publicUrl,
			preferredBaseUrl,
		);
		if (result.ok) {
			this.memberId = result.data.member.id;
			return;
		}

		this.memberId = null;
		this.viewError = result.error;
	}

	private async handleCheckIn(): Promise<void> {
		const confirmed = await confirmCheckIn();
		if (!confirmed) {
			return;
		}
		await this.postAttendance(() =>
			startAttendance(this.store, { preferredBaseUrl: this.lastBaseUrl ?? undefined }),
		);
		await this.workSession.onActivityAfterCheckIn();
	}

	private async handleCheckOut(): Promise<void> {
		const confirmed = await confirmCheckOut();
		if (!confirmed) {
			return;
		}
		// 退室直後の自動入室を防ぐ（確認ダイアログ閉鎖や直後の編集向け）
		this.lastManualCheckOutAt = Date.now();
		if (this.autoCheckInTimer) {
			clearTimeout(this.autoCheckInTimer);
			this.autoCheckInTimer = null;
		}
		this.workSession.prepareForCheckout();
		const result = await endAttendance(this.store, {
			preferredBaseUrl: this.lastBaseUrl ?? undefined,
		});
		if (!result.ok) {
			void vscode.window.showErrorMessage(displayMessage(result.error));
			return;
		}
		if (result.baseUrl) {
			this.lastBaseUrl = result.baseUrl;
		}
		await this.activityStore.clearCheckpoint();
		await this.reload();
	}

	/**
	 * 起動時に前回作業を締め、入室・作業開始する。
	 * 他窓が生存中ならスキップ（セッション分割を防ぐ）。
	 */
	private async runStartupBootstrap(): Promise<void> {
		if (this.bootstrapDone || this.bootstrapInFlight) {
			return;
		}
		if (!(await this.store.isConfigured())) {
			return;
		}
		if (this.activityStore.isPeerAlive()) {
			this.bootstrapDone = true;
			await this.activityStore.touchAlive();
			return;
		}
		if (!(await this.activityStore.tryAcquireBootstrapLock())) {
			this.bootstrapDone = true;
			return;
		}

		this.bootstrapInFlight = true;
		try {
			const settings = await this.store.get();
			const sharedMs = this.activityStore.getSharedLastActivityMs(settings.username);
			const endResult = await endWork(this.store, {
				preferredBaseUrl: this.lastBaseUrl ?? undefined,
				// チェックポイントが無いときは open のみ now で閉じ、閉じ済みの書き換えはしない
				endAt: sharedMs !== null ? new Date(sharedMs).toISOString() : undefined,
			});
			if (!endResult.ok) {
				void vscode.window.showErrorMessage(displayMessage(endResult.error));
			}

			const attendResult = await startAttendance(this.store, {
				preferredBaseUrl: this.lastBaseUrl ?? undefined,
			});
			if (!attendResult.ok) {
				void vscode.window.showErrorMessage(displayMessage(attendResult.error));
				return;
			}
			if (attendResult.baseUrl) {
				this.lastBaseUrl = attendResult.baseUrl;
			}

			const workResult = await startWork(this.store, {
				preferredBaseUrl: this.lastBaseUrl ?? undefined,
			});
			if (!workResult.ok) {
				void vscode.window.showErrorMessage(displayMessage(workResult.error));
				return;
			}

			const now = Date.now();
			await this.activityStore.touchActivity(settings.username, now);
			await this.activityStore.touchAlive();
			this.bootstrapDone = true;
			await this.reload({ silent: true });
		} finally {
			this.bootstrapInFlight = false;
		}
	}

	/**
	 * 入退室 POST を実行し、成功時は reload、失敗時はエラー通知する。
	 */
	private async postAttendance(
		request: () => Promise<
			| { ok: true; data: { ignored: boolean }; baseUrl: string }
			| { ok: false; error: LabError }
		>,
	): Promise<void> {
		const result = await request();
		if (!result.ok) {
			void vscode.window.showErrorMessage(displayMessage(result.error));
			return;
		}

		if (result.baseUrl) {
			this.lastBaseUrl = result.baseUrl;
		}
		await this.reload();
	}

	private async onWebviewMessage(
		msg: { type: 'ready' } | { type: 'checkOut' },
	): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.pushUi();
				if (!this.status && !this.viewError) {
					await this.reload();
				}
				return;
			case 'checkOut':
				await this.handleCheckOut();
				return;
		}
	}

	private async pushUi(): Promise<void> {
		const settings = await this.store.get();
		const effectiveError = resolveViewError(this.status, this.viewError, settings.username);
		const workIdleTimeoutMinutes =
			vscode.workspace.getConfiguration().get<number>(ConfigKeys.idleTimeoutMinutes) ?? 30;
		const state = buildViewState(this.status, {
			loading: this.loading,
			viewError: effectiveError,
			username: settings.username,
			memberId: this.memberId,
			lastUpdatedAt: this.lastUpdatedAt,
			workIdleTimeoutMinutes,
		});
		this.statusBar.update(this.status, this.memberId, settings.username, effectiveError);
		await this.webviewProvider.postState(state);
	}

	dispose(): void {
		clearInterval(this.autoReloadTimer);
		if (this.autoCheckInTimer) {
			clearTimeout(this.autoCheckInTimer);
		}
		for (const d of this.disposables) {
			d.dispose();
		}
		this.statusBar.dispose();
	}
}
