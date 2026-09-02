/**
 * 在室セッション詳細ダイアログ（partial 読み込み・描画・開閉）。
 */
const DetailDialog = {
  PARTIAL: "/client/pages/index/detail-dialog.html",
  HOUR_MARKS: [0, 6, 12, 18, 24],
  /** 到着・帰宅ラベルが重なるとみなす最小間隔（当日幅に対する %） */
  ENDPOINT_LABEL_MIN_GAP_PCT: 15,

  root: null,
  openMemberId: null,
  dialog: null,
  head: null,
  title: null,
  meta: null,
  notes: null,
  total: null,
  workTotal: null,
  endpoints: null,
  bar: null,
  workBar: null,
  axisBottom: null,
  workTbody: null,
  attendanceTbody: null,
  attendanceSection: null,
  toggleAttendanceBtn: null,
  showAttendanceSessions: false,
  closeBtn: null,

  /**
   * partial HTML を root に挿入し、要素参照を束ねる。
   * @param {HTMLElement} rootEl
   */
  async loadPartial(rootEl) {
    const res = await fetch(this.PARTIAL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`ダイアログの読み込みに失敗しました（HTTP ${res.status}）`);
    }
    this.root = rootEl;
    rootEl.innerHTML = await res.text();
    this.bindElements();
  },

  bindElements() {
    this.dialog = document.getElementById("detail-dialog");
    this.head = this.dialog?.querySelector(".detail-head") ?? null;
    this.title = document.getElementById("detail-title");
    this.meta = document.getElementById("detail-meta");
    this.notes = document.getElementById("detail-notes");
    this.total = document.getElementById("detail-total");
    this.workTotal = document.getElementById("detail-work-total");
    this.endpoints = document.getElementById("detail-endpoints");
    this.bar = document.getElementById("detail-bar");
    this.workBar = document.getElementById("detail-work-bar");
    this.axisBottom = document.getElementById("detail-axis-bottom");
    this.workTbody = document.getElementById("detail-work-tbody");
    this.attendanceTbody = document.getElementById("detail-attendance-tbody");
    this.attendanceSection = document.getElementById("detail-attendance-section");
    this.toggleAttendanceBtn = document.getElementById("detail-toggle-attendance");
    this.closeBtn = document.getElementById("detail-close");
  },

  init() {
    this.closeBtn?.addEventListener("click", () => this.close());
    this.dialog?.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.dialog?.addEventListener("close", () => {
      this.openMemberId = null;
      this.showAttendanceSessions = false;
      this.updateAttendanceVisibility();
    });
    this.toggleAttendanceBtn?.addEventListener("click", () => {
      this.showAttendanceSessions = !this.showAttendanceSessions;
      this.updateAttendanceVisibility();
    });
  },

  updateAttendanceVisibility() {
    if (!this.attendanceSection || !this.toggleAttendanceBtn) return;
    this.attendanceSection.hidden = !this.showAttendanceSessions;
    this.toggleAttendanceBtn.textContent = this.showAttendanceSessions
      ? "在室セッションを隠す"
      : "在室セッションを表示";
  },

  emptySessionRowHtml() {
    return `<tr>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    </tr>`;
  },

  /**
   * @param {Array<Record<string, unknown>>} sessions
   * @param {string} day
   * @param {"work" | "attendance"} kind
   */
  buildSessionRowsHtml(sessions, day, kind) {
    const { formatDuration } = DisplayUtils;
    const crossTagClass =
      kind === "attendance"
        ? "session-cross-tag session-cross-tag--attendance"
        : "session-cross-tag session-cross-tag--work";
    const numClass =
      kind === "attendance" ? "session-num session-num--attendance" : "session-num session-num--work";

    return sessions
      .map((session, index) => {
        const fromPrev = this.startsFromPreviousDay(session, day);
        const intoNext = this.endsIntoNextDay(session, day);
        const start = this.formatSessionStart(session, day);
        const end = this.formatSessionEnd(session, day);
        const startNote = fromPrev ? `<span class="${crossTagClass}">継続</span>` : "";
        const endNote = intoNext ? `<span class="${crossTagClass}">継続</span>` : "";
        return `<tr>
          <td class="${numClass}">${index + 1}</td>
          <td>${start}${startNote}</td>
          <td>${end}${endNote}</td>
          <td>${formatDuration(session.duration_seconds)}</td>
        </tr>`;
      })
      .join("");
  },

  /**
   * ボード上の「詳細」ボタンクリックを委譲する。
   * @param {HTMLElement} boardsEl
   * @param {(memberId: number) => void} onOpen
   */
  wireBoard(boardsEl, onOpen) {
    boardsEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".detail-btn");
      if (!btn) return;
      const memberId = Number(btn.getAttribute("data-member-id"));
      if (!Number.isFinite(memberId)) return;
      onOpen(memberId);
    });
  },

  /**
   * status.day（YYYY-MM-DD）の JST 0:00 を Date で返す。
   * @param {string} day
   */
  dayStartMs(day) {
    return new Date(`${day}T00:00:00+09:00`).getTime();
  },

  /**
   * 当日 0:00–24:00 に対する位置（%）を返す。
   * @param {string | null | undefined} iso
   * @param {string} day
   * @param {{ endOfDay?: boolean }} [opts]
   */
  dayPercent(iso, day, opts = {}) {
    if (opts.endOfDay) return 100;
    if (!iso) return null;
    const start = this.dayStartMs(day);
    const ms = new Date(iso).getTime() - start;
    const dayMs = 24 * 60 * 60 * 1000;
    return Math.min(100, Math.max(0, (ms / dayMs) * 100));
  },

  findMemberRow(status, memberId) {
    const byGrade = status?.by_grade || {};
    for (const rows of Object.values(byGrade)) {
      if (!Array.isArray(rows)) continue;
      const found = rows.find((t) => t.member_id === memberId);
      if (found) return found;
    }
    return null;
  },

  formatSessionEnd(session, day) {
    const { formatTime } = DisplayUtils;
    if (session.end_at_is_now) return "-";
    if (this.endsIntoNextDay(session, day)) return "24:00";
    return formatTime(session.end_at);
  },

  startsFromPreviousDay(session, day) {
    if (session.starts_from_previous_day === true) return true;
    const raw = session.raw_start_at || session.start_at;
    if (!raw || !day) return false;
    return new Date(raw).getTime() < this.dayStartMs(day);
  },

  endsIntoNextDay(session, day) {
    if (session.end_at_is_end_of_day === true) return true;
    if (!session.raw_end_at || !day) return false;
    const dayEnd = this.dayStartMs(day) + 24 * 60 * 60 * 1000;
    return new Date(session.raw_end_at).getTime() >= dayEnd;
  },

  memberArrivedFromPreviousDay(member, day) {
    if (member.arrived_from_previous_day === true) return true;
    return (member.attendance_sessions || []).some((s) => this.startsFromPreviousDay(s, day));
  },

  memberLeftIntoNextDay(member, day) {
    if (member.left_into_next_day === true || member.left_at_is_end_of_day === true) {
      return true;
    }
    return (member.attendance_sessions || []).some((s) => this.endsIntoNextDay(s, day));
  },

  formatSessionStart(session, day) {
    const { formatTime } = DisplayUtils;
    if (this.startsFromPreviousDay(session, day)) return "0:00";
    return formatTime(session.start_at);
  },

  renderNotes(member, day) {
    const notes = [];
    if (this.memberArrivedFromPreviousDay(member, day)) {
      notes.push("前日から在室");
    }
    if (this.memberLeftIntoNextDay(member, day)) {
      notes.push("翌日まで在室");
    }
    if (!this.notes) return;
    if (notes.length === 0) {
      this.notes.setAttribute("hidden", "");
      this.notes.innerHTML = "";
      return;
    }
    this.notes.removeAttribute("hidden");
    this.notes.innerHTML = notes
      .map((text) => `<p class="detail-note">${text}</p>`)
      .join("");
  },

  renderEndpointLabels(member, day) {
    const { formatTime } = DisplayUtils;
    const fromPrev = this.memberArrivedFromPreviousDay(member, day);
    const intoNext = this.memberLeftIntoNextDay(member, day);

    const arrivedPct = this.dayPercent(member.arrived_at, day);
    const leftPct = member.present
      ? null
      : this.dayPercent(member.left_at, day, {
          endOfDay: intoNext || member.left_at_is_end_of_day,
        });

    const arrivedText = fromPrev || arrivedPct === 0 ? "0:00" : formatTime(member.arrived_at);
    const leftText = intoNext ? "24:00" : formatTime(member.left_at);

    if (arrivedPct == null && leftPct == null) {
      this.endpoints.innerHTML = "";
      return;
    }

    if (
      arrivedPct != null &&
      leftPct != null &&
      Math.abs(leftPct - arrivedPct) < this.ENDPOINT_LABEL_MIN_GAP_PCT
    ) {
      const mid = (arrivedPct + leftPct) / 2;
      this.endpoints.innerHTML = `<span class="detail-endpoint detail-endpoint-combined" style="left:${mid}%">
        <span class="cap">到着 ${arrivedText}</span>
        <span class="cap">帰宅 ${leftText}</span>
      </span>`;
      return;
    }

    let top = "";
    if (arrivedPct != null) {
      top += `<span class="detail-endpoint" style="left:${arrivedPct}%">
        <span class="cap">到着</span><span class="detail-endpoint-time">${arrivedText}</span>
      </span>`;
    }
    if (leftPct != null) {
      top += `<span class="detail-endpoint" style="left:${leftPct}%">
        <span class="cap">帰宅</span><span class="detail-endpoint-time">${leftText}</span>
      </span>`;
    }
    this.endpoints.innerHTML = top;
  },

  renderSessionSegments(barEl, sessions, day, segmentClass) {
    if (!barEl) return;
    barEl.innerHTML = sessions
      .map((session) => {
        const left = this.dayPercent(session.start_at, day);
        const right = this.dayPercent(session.end_at, day, {
          endOfDay: session.end_at_is_end_of_day,
        });
        if (left == null || right == null || right <= left) return "";
        const width = right - left;
        return `<span class="${segmentClass}" style="left:${left}%;width:${width}%"></span>`;
      })
      .join("");
  },

  renderHourAxis(day) {
    this.axisBottom.innerHTML = this.HOUR_MARKS.map((hour) => {
      const left = (hour / 24) * 100;
      const label = hour === 24 ? "24:00" : `${hour}:00`;
      return `<span class="detail-hour" style="left:${left}%">
        <span class="detail-hour-tick"></span>
        <span class="detail-hour-label">${label}</span>
      </span>`;
    }).join("");
  },

  renderChart(member, day) {
    const attendanceSessions = Array.isArray(member.attendance_sessions)
      ? member.attendance_sessions
      : [];
    const workSessions = Array.isArray(member.work_sessions) ? member.work_sessions : [];

    this.renderEndpointLabels(member, day);
    this.renderSessionSegments(this.bar, attendanceSessions, day, "detail-seg");
    this.renderSessionSegments(this.workBar, workSessions, day, "detail-seg work");
    this.renderHourAxis(day);
  },

  renderSessionTables(member, day) {
    const workTotal = member.total_work_seconds ?? 0;
    const attendanceTotal = member.total_present_seconds ?? 0;
    const workSessions = Array.isArray(member.work_sessions) ? member.work_sessions : [];
    const attendanceSessions = Array.isArray(member.attendance_sessions)
      ? member.attendance_sessions
      : [];

    if (this.workTbody) {
      this.workTbody.innerHTML =
        workTotal === 0
          ? this.emptySessionRowHtml()
          : this.buildSessionRowsHtml(workSessions, day, "work");
    }

    if (this.attendanceTbody) {
      this.attendanceTbody.innerHTML =
        attendanceTotal === 0
          ? this.emptySessionRowHtml()
          : this.buildSessionRowsHtml(attendanceSessions, day, "attendance");
    }
  },

  /** section.board と同じ学年色をヘッダーに適用する。 */
  applyGradeTheme(member) {
    if (!this.head) return;
    this.head.dataset.grade = member.grade || "other";
  },

  fill(member, status) {
    const { dash, formatDuration, formatDayLabel } = DisplayUtils;
    const day = status.day || "";
    this.applyGradeTheme(member);
    this.title.textContent = `${dash(member.name)} (${GradeConfig.label(member.grade)})`;
    this.meta.textContent = day ? formatDayLabel(day) : "";
    this.total.textContent = formatDuration(member.total_present_seconds);
    if (this.workTotal) {
      this.workTotal.innerHTML = DisplayUtils.formatWorkKpiValue(member);
    }
    this.renderNotes(member, day);
    this.renderChart(member, day);
    this.renderSessionTables(member, day);
  },

  open(memberId, status) {
    if (!this.dialog) return;
    const member = this.findMemberRow(status, memberId);
    if (!member) return;
    this.openMemberId = memberId;
    this.showAttendanceSessions = false;
    this.updateAttendanceVisibility();
    this.fill(member, status);
    if (typeof this.dialog.showModal === "function" && !this.dialog.open) {
      this.dialog.showModal();
    }
  },

  close() {
    this.openMemberId = null;
    if (this.dialog?.open) this.dialog.close();
  },

  /** 開いている間に status が更新されたら再描画する。 */
  refresh(status) {
    if (this.openMemberId == null || !this.dialog?.open) return;
    const member = this.findMemberRow(status, this.openMemberId);
    if (!member) {
      this.close();
      return;
    }
    this.fill(member, status);
  },
};
