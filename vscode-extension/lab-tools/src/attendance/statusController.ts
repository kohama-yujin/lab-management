import * as vscode from 'vscode';
import { endAttendance, startAttendance } from '../api/attendanceClient';
import { resolveBaseUrls } from '../api/http';
import { fetchMemberByCredentials } from '../api/memberClient';
import { fetchStatus } from '../api/statusClient';
import type { StatusPayload } from '../api/types';
import { buildViewState, resolveViewError } from '../attendance/buildViewState';
import { confirmCheckIn, confirmCheckOut } from '../attendance/dialogs';
import { findMemberById } from '../attendance/findMember';
import type { SettingsStore } from '../config/settingsStore';
import type { LabError } from '../errors/labError';
import { displayMessage } from '../errors/labError';
import { AttendanceStatusBar } from '../statusBar/attendanceStatusBar';
import { StatusWebviewProvider } from '../views/statusWebviewProvider';

/** 在室状況の自動更新間隔（ミリ秒） */
const AUTO_RELOAD_INTERVAL_MS = 60_000;

/**
 * GET /status の取得と UI（サイドバー・ステータスバー）の更新を担う。
 */
export class StatusController implements vscode.Disposable {
	readonly webviewProvider: StatusWebviewProvider;
	readonly statusBar: AttendanceStatusBar;

	private status: StatusPayload | null = null;
	private memberId: number | null = null;
	private viewError: LabError | null = null;
	private loading = false;
	private lastBaseUrl: string | null = null;
	private lastUpdatedAt: Date | null = null;
	private reloadInFlight: Promise<void> | null = null;
	private readonly autoReloadTimer: ReturnType<typeof setInterval>;

	constructor(
		private readonly store: SettingsStore,
		extensionUri: vscode.Uri,
	) {
		this.webviewProvider = new StatusWebviewProvider(extensionUri, (msg) => this.onWebviewMessage(msg));
		this.statusBar = new AttendanceStatusBar(
			() => {
				void this.handleToggleFromStatusBar();
			},
			() => {
				void this.webviewProvider.focus();
			},
		);
		this.autoReloadTimer = setInterval(() => {
			void this.reload({ silent: true });
		}, AUTO_RELOAD_INTERVAL_MS);
	}

	/**
	 * GET /status と GET /member で再取得し UI を更新する。
	 * @param options.silent true のとき読み込み中バナーを出さない（自動更新向け）
	 */
	async reload(options?: { silent?: boolean }): Promise<void> {
		if (this.reloadInFlight) {
			await this.reloadInFlight;
			return;
		}

		this.reloadInFlight = this.runReload(options?.silent === true);
		try {
			await this.reloadInFlight;
		} finally {
			this.reloadInFlight = null;
		}
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
	}

	private async handleCheckOut(): Promise<void> {
		const confirmed = await confirmCheckOut();
		if (!confirmed) {
			return;
		}
		await this.postAttendance(() =>
			endAttendance(this.store, { preferredBaseUrl: this.lastBaseUrl ?? undefined }),
		);
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
		msg: { type: 'ready' } | { type: 'checkIn' } | { type: 'checkOut' },
	): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.pushUi();
				if (!this.status && !this.viewError) {
					await this.reload();
				}
				return;
			case 'checkIn':
				await this.handleCheckIn();
				return;
			case 'checkOut':
				await this.handleCheckOut();
				return;
		}
	}

	private async pushUi(): Promise<void> {
		const settings = await this.store.get();
		const effectiveError = resolveViewError(this.status, this.viewError, settings.username);
		const state = buildViewState(this.status, {
			loading: this.loading,
			viewError: effectiveError,
			autoCheckIn: settings.autoCheckIn,
			username: settings.username,
			memberId: this.memberId,
			lastUpdatedAt: this.lastUpdatedAt,
		});
		this.statusBar.update(this.status, this.memberId, settings.username, effectiveError);
		await this.webviewProvider.postState(state);
	}

	dispose(): void {
		clearInterval(this.autoReloadTimer);
		this.statusBar.dispose();
	}
}

