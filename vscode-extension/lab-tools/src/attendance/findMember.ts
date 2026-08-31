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
