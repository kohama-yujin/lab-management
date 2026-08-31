import type { DayMemberRow, StatusPayload } from '../api/types';

/**
 * 設定 username と一致するメンバー行を在室ボードから探す。
 */
export function findSelfMember(status: StatusPayload, username: string): DayMemberRow | undefined {
	const key = username.trim();
	if (!key) {
		return undefined;
	}
	for (const grade of status.grades) {
		const rows = status.by_grade[grade] ?? [];
		const found = rows.find((row) => row.name.trim() === key);
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
