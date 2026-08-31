import * as vscode from 'vscode';
import type { StatusPayload } from '../api/types';
import { findMemberById, listPresentMemberNames } from '../attendance/findMember';
import { formatDurationChip } from '../attendance/format';
import { COMMAND_PREFIX } from '../config/constants';

const WARNING_FG = new vscode.ThemeColor('statusBarItem.warningForeground');
const ERROR_FG = new vscode.ThemeColor('statusBarItem.errorForeground');
const WARNING_BG = new vscode.ThemeColor('statusBarItem.warningBackground');
const ERROR_BG = new vscode.ThemeColor('statusBarItem.errorBackground');

/**
 * 在室サマリーをステータスバー左右に表示する。
 * 左: 自分の状態 / 右: 在室人数
 */
export class AttendanceStatusBar {
	readonly disposables: vscode.Disposable[] = [];

	private readonly myItem: vscode.StatusBarItem;
	private readonly countItem: vscode.StatusBarItem;

	constructor(
		private readonly onMyStatusClick: () => void,
		private readonly onCountClick: () => void,
	) {
		this.myItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
		this.myItem.command = `${COMMAND_PREFIX}.toggleAttendance`;
		this.myItem.show();

		this.countItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
		this.countItem.command = `${COMMAND_PREFIX}.focusStatusView`;
		this.countItem.show();

		this.disposables.push(this.myItem, this.countItem);
	}

	private resetMyItemStyle(): void {
		this.myItem.color = undefined;
		this.myItem.backgroundColor = undefined;
	}

	private setMyItemWarningStyle(): void {
		this.myItem.color = WARNING_FG;
		this.myItem.backgroundColor = WARNING_BG;
	}

	private setMyItemErrorStyle(): void {
		this.myItem.color = ERROR_FG;
		this.myItem.backgroundColor = ERROR_BG;
	}

	private resetCountItemStyle(): void {
		this.countItem.color = undefined;
		this.countItem.backgroundColor = undefined;
	}

	/**
	 * ステータスバー表示を更新する。
	 */
	update(
		status: StatusPayload | null,
		memberId: number | null,
		memberError: string | null,
		username: string,
		error: string | null,
	): void {
		if (error) {
			this.myItem.text = '$(error) 在室: 取得失敗';
			this.myItem.tooltip = error;
			this.setMyItemErrorStyle();
			this.countItem.text = '$(question) 在室 ?人';
			this.countItem.tooltip = error;
			this.resetCountItemStyle();
			return;
		}

		if (!status) {
			this.myItem.text = '$(loading~spin) 在室: …';
			this.myItem.tooltip = '読み込み中';
			this.resetMyItemStyle();
			this.countItem.text = '$(loading~spin) 在室 …人';
			this.countItem.tooltip = '読み込み中';
			this.resetCountItemStyle();
			return;
		}

		if (!username.trim()) {
			this.myItem.text = '$(warning) 在室: 未設定';
			this.myItem.tooltip = 'ユーザー名を設定してください';
			this.setMyItemWarningStyle();
		} else if (memberError || memberId === null) {
			this.myItem.text = '$(warning) 在室: 未登録';
			this.myItem.tooltip = memberError ?? `メンバー「${username}」が見つかりません`;
			this.setMyItemWarningStyle();
		} else {
			const self = findMemberById(status, memberId);
			const present = self?.present ?? false;
			const label = present ? '在室' : '不在';
			const duration = formatDurationChip(self?.total_present_seconds ?? 0);
			const icon = present ? '$(pass-filled)' : '$(circle-slash)';
			this.myItem.text = `${icon} ${label} ${duration}`;
			this.myItem.tooltip = present ? '退室する' : '入室する';
			if (present) {
				this.resetMyItemStyle();
			} else {
				this.setMyItemErrorStyle();
			}
		}

		const presentNames = listPresentMemberNames(status);
		this.countItem.text = `$(home) 在室 ${status.count}人`;
		this.countItem.tooltip =
			presentNames.length > 0 ? presentNames.join(', ') : '在室者なし';
		this.resetCountItemStyle();
	}

	dispose(): void {
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}
