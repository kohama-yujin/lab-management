import * as vscode from 'vscode';
import { fetchStatus } from '../api/statusClient';
import type { StatusPayload } from '../api/types';
import { buildViewState } from '../attendance/buildViewState';
import { confirmCheckIn, confirmCheckOut } from '../attendance/dialogs';
import { findSelfMember } from '../attendance/findMember';
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
	 * GET /status で再取得し UI を更新する。
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
		} else {
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

		const self = findSelfMember(this.status, settings.username);
		if (!self) {
			void vscode.window.showErrorMessage(
				settings.username
					? `メンバー「${settings.username}」が在室ボードに見つかりません`
					: 'ユーザー名を設定してください',
			);
			return;
		}

		if (self.present) {
			await this.handleCheckOut();
		} else {
			await this.handleCheckIn();
		}
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
		});
		this.statusBar.update(this.status, settings.username, this.error);
		await this.webviewProvider.postState(state);
	}

	dispose(): void {
		this.statusBar.dispose();
	}
}