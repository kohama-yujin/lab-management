import type { DayMemberRow } from '../api/types';

/**
 * チップ用の総在室時間を {h}h{mm} 形式で返す。
 */
export function formatDurationChip(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const mm = Math.floor((total % 3600) / 60);
	return `${h}h${String(mm).padStart(2, '0')}`;
}

/**
 * ISO 日時を HH:mm（JST 表示）に整形する。
 */
export function formatTime(iso: string | null | undefined): string {
	if (!iso) {
		return '-';
	}
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '-';
	}
	return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 最終更新表示用に Date を HH:mm:ss へ整形する。
 */
export function formatUpdatedAt(date: Date): string {
	return date.toLocaleTimeString('ja-JP', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

/**
 * メンバー行の「到着 - 帰宅」表示文字列を組み立てる。
 */
export function formatMemberTimeRange(row: DayMemberRow): string {
	const arrived = formatTime(row.arrived_at);
	const left = row.left_at_is_end_of_day ? '24:00' : row.left_at ? formatTime(row.left_at) : '';
	return `${arrived} - ${left}`;
}
