import * as vscode from 'vscode';
import type { StatusPayload } from '../api/types';
import { findMemberById, listPresentMemberNames, resolvePresentCount } from '../attendance/findMember';
import { formatDurationChip } from '../attendance/format';
import { COMMAND_PREFIX } from '../config/constants';
import type { LabError } from '../errors/labError';
import { errorTooltip, statusBarLabel } from '../errors/labError';

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
		_viewUsername: string,
		viewError: LabError | null,
	): void {
		if (viewError) {
			const label = statusBarLabel(viewError);
			this.myItem.text = label.text;
			this.myItem.tooltip = errorTooltip(viewError);
			if (label.style === 'warning') {
				this.setMyItemWarningStyle();
			} else {
				this.setMyItemErrorStyle();
			}
			if (!status) {
				this.countItem.text = '$(question) 在室 ?人';
				this.countItem.tooltip = errorTooltip(viewError);
				this.resetCountItemStyle();
			} else {
				const presentNames = listPresentMemberNames(status);
				this.countItem.text = `$(home) 在室 ${resolvePresentCount(status)}人`;
				this.countItem.tooltip =
					presentNames.length > 0 ? presentNames.join(', ') : '在室者なし';
				this.resetCountItemStyle();
			}
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

		if (memberId === null) {
			this.myItem.text = '$(warning) 在室: 未登録';
			this.myItem.tooltip = 'メンバー情報を取得できません';
			this.setMyItemWarningStyle();
		} else {
			const self = findMemberById(status, memberId);
			const present = self?.present ?? false;
			const label = present ? '在室' : '不在';
			const duration = formatDurationChip(self?.total_present_seconds ?? 0);
			const icon = present ? '$(check)' : '$(circle-slash)';
			this.myItem.text = `${icon} ${label} ${duration}`;
			this.myItem.tooltip = present ? '退室する' : '入室する';
			if (present) {
				this.resetMyItemStyle();
			} else {
				this.setMyItemErrorStyle();
			}
		}

		const presentNames = listPresentMemberNames(status);
		this.countItem.text = `$(home) 在室 ${resolvePresentCount(status)}人`;
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

