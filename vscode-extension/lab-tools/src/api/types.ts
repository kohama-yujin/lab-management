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
	count: number;
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
 * サイドバー Webview へ送る表示用データ。
 */
export type StatusViewState = {
	loading: boolean;
	error: string | null;
	autoCheckIn: boolean;
	username: string;
	/** GET /member に失敗したときのメッセージ */
	memberError: string | null;
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
