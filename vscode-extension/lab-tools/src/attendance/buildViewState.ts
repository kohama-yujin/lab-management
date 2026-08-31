import type { StatusPayload, StatusViewState } from '../api/types';
import { findMemberById } from './findMember';
import { formatDurationChip, formatMemberTimeRange } from './format';

/**
 * GET /status の生データを Webview 表示用に変換する。
 */
export function buildViewState(
	status: StatusPayload | null,
	options: {
		loading: boolean;
		error: string | null;
		autoCheckIn: boolean;
		username: string;
		memberId: number | null;
		memberError: string | null;
	},
): StatusViewState {
	if (!status) {
		return {
			loading: options.loading,
			error: options.error,
			autoCheckIn: options.autoCheckIn,
			username: options.username,
			memberError: options.memberError,
			self: null,
			grades: [],
		};
	}

	const selfRow = options.memberId !== null ? findMemberById(status, options.memberId) : undefined;
	const self =
		options.memberId !== null && !options.memberError
			? {
					present: selfRow?.present ?? false,
					durationLabel: formatDurationChip(selfRow?.total_present_seconds ?? 0),
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
		error: options.error,
		autoCheckIn: options.autoCheckIn,
		username: options.username,
		memberError: options.memberError,
		self,
		grades,
	};
}
