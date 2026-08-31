import * as vscode from 'vscode';
import { fetchMemberByCredentials } from '../api/memberClient';
import { fetchStatus } from '../api/statusClient';
import type { StatusPayload } from '../api/types';
import { buildViewState } from '../attendance/buildViewState';
import { confirmCheckIn, confirmCheckOut } from '../attendance/dialogs';
import { findMemberById } from '../attendance/findMember';
import type { SettingsStore } from '../config/settingsStore';
import { AttendanceStatusBar } from '../statusBar/attendanceStatusBar';
import { StatusWebviewProvider } from '../views/statusWebviewProvider';

/**
 * GET /status の取得と UI（サイドバー・ステータスバー）の更新を担う。
 */
export class StatusController implements vscode.Disposable {
	readonly webviewProvider: StatusWebviewProvider;
	readonly statusBar: AttendanceStatusBar;

	private status: StatusPayload | null = null;
	private memberId: number | null = null;
	private memberError: string | null = null;
	private error: string | null = null;
	private loading = false;

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
	}

	/**
	 * GET /status と GET /member で再取得し UI を更新する。
	 */
	async reload(): Promise<void> {
		this.loading = true;
		await this.pushUi();

		const settings = await this.store.get();
		const result = await fetchStatus(settings.serverIp, settings.publicUrl);

		this.loading = false;
		if (result.ok) {
			this.status = result.data;
			this.error = null;
			await this.resolveMember(
				settings.username,
				settings.serverIp,
				settings.publicUrl,
				result.baseUrl,
			);
		} else {
			this.status = null;
			this.memberId = null;
			this.memberError = null;
			this.error = result.message;
		}
		await this.pushUi();
	}

	/**
	 * ステータスバー左クリック時の入退室切替（ダイアログのみ、POST は未実装）。
	 */
	async handleToggleFromStatusBar(): Promise<void> {
		const settings = await this.store.get();
		if (!this.status) {
			if (this.error) {
				void vscode.window.showErrorMessage(`在室状況の取得に失敗しています: ${this.error}`);
			}
			return;
		}

		if (!settings.username) {
			void vscode.window.showErrorMessage('ユーザー名を設定してください');
			return;
		}
		if (this.memberError || this.memberId === null) {
			void vscode.window.showErrorMessage(this.memberError ?? 'メンバー情報を取得できません');
			return;
		}

		const self = findMemberById(this.status, this.memberId);
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
			this.memberError = null;
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
			this.memberError = null;
			return;
		}

		this.memberId = null;
		this.memberError = result.message;
	}

	private async handleCheckIn(): Promise<void> {
		const confirmed = await confirmCheckIn();
		if (!confirmed) {
			return;
		}
		// POST /start_attendance は後続フェーズで実装
	}

	private async handleCheckOut(): Promise<void> {
		const confirmed = await confirmCheckOut();
		if (!confirmed) {
			return;
		}
		// POST /end_attendance は後続フェーズで実装
	}

	private async onWebviewMessage(
		msg: { type: 'ready' } | { type: 'checkIn' } | { type: 'checkOut' },
	): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.pushUi();
				if (!this.status && !this.error) {
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
		const state = buildViewState(this.status, {
			loading: this.loading,
			error: this.error,
			autoCheckIn: settings.autoCheckIn,
			username: settings.username,
			memberId: this.memberId,
			memberError: this.memberError,
		});
		this.statusBar.update(this.status, this.memberId, this.memberError, settings.username, this.error);
		await this.webviewProvider.postState(state);
	}

	dispose(): void {
		this.statusBar.dispose();
	}
}
