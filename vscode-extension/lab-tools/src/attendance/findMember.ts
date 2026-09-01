import type { DayMemberRow, StatusPayload } from '../api/types';

/**
 * member_id で在室ボードからメンバー行を探す。
 */
export function findMemberById(status: StatusPayload, memberId: number): DayMemberRow | undefined {
	for (const grade of status.grades) {
		const rows = status.by_grade[grade] ?? [];
		const found = rows.find((row) => row.member_id === memberId);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * 在室中（present=true）のメンバー名一覧を返す。
 */
export function listPresentMemberNames(status: StatusPayload): string[] {
	const names: string[] = [];
	for (const grade of status.grades) {
		for (const row of status.by_grade[grade] ?? []) {
			if (row.present) {
				names.push(row.name);
			}
		}
	}
	return names;
}

/**
 * 現在在室中のメンバー数を返す。API の present_count が無い場合は行データから数える。
 */
export function resolvePresentCount(status: StatusPayload): number {
	if (typeof status.present_count === 'number') {
		return status.present_count;
	}
	return listPresentMemberNames(status).length;
}
