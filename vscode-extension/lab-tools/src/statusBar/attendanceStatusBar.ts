import * as vscode from 'vscode';
import type { StatusPayload } from '../api/types';
import { findSelfMember, listPresentMemberNames } from '../attendance/findMember';
import { formatDurationChip } from '../attendance/format';
import { COMMAND_PREFIX } from '../config/constants';

/**
 * 在室サマリーをステータスバー左右に表示する。
 */
export class AttendanceStatusBar {
	readonly disposables: vscode.Disposable[] = [];

	private readonly myItem: vscode.StatusBarItem;
	private readonly countItem: vscode.StatusBarItem;

	constructor(
		private readonly onMyStatusClick: () => void,
		private readonly onCountClick: () => void,
	) {
		this.myItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.myItem.command = `${COMMAND_PREFIX}.toggleAttendance`;
		this.myItem.show();

		this.countItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
		this.countItem.command = `${COMMAND_PREFIX}.focusStatusView`;
		this.countItem.show();

		this.disposables.push(this.myItem, this.countItem);
	}

	/**
	 * ステータスバー表示を更新する。
	 */
	update(status: StatusPayload | null, username: string, error: string | null): void {
		if (error) {
			this.myItem.text = '$(error) 在室: 取得失敗';
			this.myItem.tooltip = error;
			this.myItem.backgroundColor = undefined;
			this.countItem.text = '$(question) 在室 ?人';
			this.countItem.tooltip = error;
			return;
		}

		if (!status) {
			this.myItem.text = '$(loading~spin) 在室: …';
			this.myItem.tooltip = '読み込み中';
			this.myItem.backgroundColor = undefined;
			this.countItem.text = '$(loading~spin) 在室 …人';
			this.countItem.tooltip = '読み込み中';
			return;
		}

		const self = findSelfMember(status, username);
		if (!self) {
			this.myItem.text = '$(warning) 在室: 未登録';
			this.myItem.tooltip = username ? `メンバー「${username}」が見つかりません` : 'ユーザー名を設定してください';
			this.myItem.backgroundColor = undefined;
		} else {
			const label = self.present ? '在室' : '不在';
			const duration = formatDurationChip(self.total_present_seconds);
			this.myItem.text = `${label} ${duration}`;
			this.myItem.tooltip = self.present ? '退室する' : '入室する';
			this.myItem.backgroundColor = new vscode.ThemeColor(
				self.present ? 'labTools.statusPresent' : 'labTools.statusAway',
			);
		}

		const presentNames = listPresentMemberNames(status);
		this.countItem.text = `在室 ${status.count}人`;
		this.countItem.tooltip =
			presentNames.length > 0 ? presentNames.join(', ') : '在室者なし';
	}

	dispose(): void {
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}
