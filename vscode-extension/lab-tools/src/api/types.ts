import type { LabErrorView } from '../errors/labError';

/**
 * GET /status のメンバー1行。
 */
export type DayMemberRow = {
	member_id: number;
	name: string;
	grade: string;
	present: boolean;
	arrived_at: string | null;
	left_at: string | null;
	left_at_is_end_of_day: boolean;
	total_present_seconds: number;
};

/**
 * GET /status レスポンス。
 */
export type StatusPayload = {
	revision: number;
	grades: string[];
	by_grade: Record<string, DayMemberRow[]>;
	/** 本日記録のあるメンバー数 */
	count: number;
	/** 現在在室中のメンバー数 */
	present_count?: number;
	day: string;
	public_url?: string;
};

/**
 * GET /member レスポンスのメンバー。
 */
export type MemberItem = {
	id: number;
	name: string;
	grade: string;
	username: string;
	role: string;
	graduation_year: number | null;
};

export type MemberPayload = {
	ok?: boolean;
	member: MemberItem;
};

/**
 * POST /start_attendance / POST /end_attendance のレスポンス。
 */
export type AttendancePayload = {
	ok: boolean;
	ignored: boolean;
	message: string;
	public_url?: string;
};

/**
 * サイドバー Webview へ送る表示用データ。
 */
export type StatusViewState = {
	loading: boolean;
	/** 設定・接続・認証などの統一エラー（null なら正常） */
	viewError: LabErrorView | null;
	autoCheckIn: boolean;
	username: string;
	self: {
		present: boolean;
		durationLabel: string;
	} | null;
	grades: Array<{
		grade: string;
		members: Array<{
			memberId: number;
			name: string;
			timeRange: string;
			present: boolean;
			durationLabel: string;
			isSelf: boolean;
		}>;
	}>;
};
