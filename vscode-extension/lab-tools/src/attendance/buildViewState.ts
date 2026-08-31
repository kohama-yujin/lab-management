import type { StatusPayload, StatusViewState } from '../api/types';
import { findSelfMember } from './findMember';
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
	},
): StatusViewState {
	if (!status) {
		return {
			loading: options.loading,
			error: options.error,
			autoCheckIn: options.autoCheckIn,
			username: options.username,
			self: null,
			grades: [],
		};
	}

	const selfRow = findSelfMember(status, options.username);
	const self = selfRow
		? {
				present: selfRow.present,
				durationLabel: formatDurationChip(selfRow.total_present_seconds),
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
			isSelf: options.username.trim() !== '' && row.name.trim() === options.username.trim(),
		})),
	}));

	return {
		loading: options.loading,
		error: options.error,
		autoCheckIn: options.autoCheckIn,
		username: options.username,
		self,
		grades,
	};
}
