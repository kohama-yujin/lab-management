import type { LabError } from '../errors/labError';
import { LabErrors, toViewError } from '../errors/labError';
import type { StatusPayload, StatusViewState } from '../api/types';
import { findMemberById } from './findMember';
import { formatDurationChip, formatMemberTimeRange, formatUpdatedAt } from './format';

/**
 * GET /status の生データを Webview 表示用に変換する。
 */
export function buildViewState(
	status: StatusPayload | null,
	options: {
		loading: boolean;
		viewError: LabError | null;
		autoCheckIn: boolean;
		username: string;
		memberId: number | null;
		lastUpdatedAt: Date | null;
	},
): StatusViewState {
	const lastUpdatedLabel = options.lastUpdatedAt ? formatUpdatedAt(options.lastUpdatedAt) : '';

	if (!status) {
		return {
			loading: options.loading,
			viewError: toViewError(options.viewError),
			autoCheckIn: options.autoCheckIn,
			username: options.username,
			lastUpdatedLabel,
			self: null,
			grades: [],
		};
	}

	const selfRow = options.memberId !== null ? findMemberById(status, options.memberId) : undefined;
	const self =
		options.memberId !== null && !options.viewError
			? {
					present: selfRow?.present ?? false,
					durationLabel: formatDurationChip(selfRow?.total_present_seconds ?? 0),
					working: selfRow?.working ?? false,
					workDurationLabel: formatDurationChip(selfRow?.total_work_seconds ?? 0),
				}
			: null;

	const grades = status.grades.map((grade) => ({
		grade,
		members: (status.by_grade[grade] ?? []).map((row) => ({
			memberId: row.member_id,
			name: row.name,
			timeRange: formatMemberTimeRange(row),
			present: row.present,
			durationLabel: formatDurationChip(row.total_present_seconds),
			isSelf: options.memberId !== null && row.member_id === options.memberId,
		})),
	}));

	return {
		loading: options.loading,
		viewError: toViewError(options.viewError),
		autoCheckIn: options.autoCheckIn,
		username: options.username,
		lastUpdatedLabel,
		self,
		grades,
	};
}

/**
 * 表示用の effective エラーを決定する（username 未設定を含む）。
 */
export function resolveViewError(
	status: StatusPayload | null,
	viewError: LabError | null,
	username: string,
): LabError | null {
	if (viewError) {
		return viewError;
	}
	if (status && !username.trim()) {
		return LabErrors.configUsername();
	}
	return null;
}

