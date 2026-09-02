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
 * 在室・作業サマリーをステータスバー右に表示する。
 * 左から: 自分の在室 / 作業時間 / 在室人数
 */
export class AttendanceStatusBar {
	readonly disposables: vscode.Disposable[] = [];

	private readonly myItem: vscode.StatusBarItem;
	private readonly workItem: vscode.StatusBarItem;
	private readonly countItem: vscode.StatusBarItem;

	constructor(
		private readonly onMyStatusClick: () => void,
		private readonly onCountClick: () => void,
	) {
		this.myItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 3);
		this.myItem.command = `${COMMAND_PREFIX}.toggleAttendance`;
		this.myItem.show();

		this.workItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
		this.workItem.command = `${COMMAND_PREFIX}.focusStatusView`;
		this.workItem.show();

		this.countItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
		this.countItem.command = `${COMMAND_PREFIX}.focusStatusView`;
		this.countItem.show();

		this.disposables.push(this.myItem, this.workItem, this.countItem);
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

	private resetWorkItemStyle(): void {
		this.workItem.color = undefined;
		this.workItem.backgroundColor = undefined;
	}

	private setWorkItemWarningStyle(): void {
		this.workItem.color = WARNING_FG;
		this.workItem.backgroundColor = WARNING_BG;
	}

	private resetCountItemStyle(): void {
		this.countItem.color = undefined;
		this.countItem.backgroundColor = undefined;
	}

	private updateWorkItem(
		status: StatusPayload | null,
		memberId: number | null,
		viewError: LabError | null,
	): void {
		if (viewError) {
			const label = statusBarLabel(viewError);
			this.workItem.text = '$(error) 作業: ?';
			this.workItem.tooltip = errorTooltip(viewError);
			if (label.style === 'warning') {
				this.setWorkItemWarningStyle();
			} else {
				this.workItem.color = ERROR_FG;
				this.workItem.backgroundColor = ERROR_BG;
			}
			return;
		}

		if (!status) {
			this.workItem.text = '$(loading~spin) 作業 …';
			this.workItem.tooltip = '読み込み中';
			this.resetWorkItemStyle();
			return;
		}

		if (memberId === null) {
			this.workItem.text = '$(warning) 作業: 未登録';
			this.workItem.tooltip = 'メンバー情報を取得できません';
			this.setWorkItemWarningStyle();
			return;
		}

		const self = findMemberById(status, memberId);
		const working = self?.working ?? false;
		const duration = formatDurationChip(self?.total_work_seconds ?? 0);
		this.workItem.text = `$(history) 作業 ${duration}`;
		this.workItem.tooltip = working ? `作業中 · 総作業 ${duration}` : `総作業 ${duration}`;
		this.resetWorkItemStyle();
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
		this.updateWorkItem(status, memberId, viewError);

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
