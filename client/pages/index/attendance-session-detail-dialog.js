/**
 * 在室セッション詳細ダイアログ（partial 読み込み・描画・開閉）。
 */
const AttendanceSessionDetailDialog = {
  PARTIAL: "/client/pages/index/attendance-session-detail-dialog.html",
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
  count: null,
  axisTop: null,
  bar: null,
  axisBottom: null,
  tbody: null,
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
    this.dialog = document.getElementById("attendance-session-detail-dialog");
    this.head = this.dialog?.querySelector(".attendance-session-detail-head") ?? null;
    this.title = document.getElementById("attendance-session-detail-title");
    this.meta = document.getElementById("attendance-session-detail-meta");
    this.notes = document.getElementById("attendance-session-detail-notes");
    this.total = document.getElementById("attendance-session-detail-total");
    this.count = document.getElementById("attendance-session-detail-count");
    this.axisTop = document.getElementById("attendance-session-detail-axis-top");
    this.bar = document.getElementById("attendance-session-detail-bar");
    this.axisBottom = document.getElementById("attendance-session-detail-axis-bottom");
    this.tbody = document.getElementById("attendance-session-detail-tbody");
    this.closeBtn = document.getElementById("attendance-session-detail-close");
  },

  init() {
    this.closeBtn?.addEventListener("click", () => this.close());
    this.dialog?.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.dialog?.addEventListener("close", () => {
      this.openMemberId = null;
    });
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

  formatAttendanceSessionEnd(attendanceSession, day) {
    const { formatTime } = DisplayUtils;
    if (attendanceSession.end_at_is_now) return "-";
    if (this.endsIntoNextDay(attendanceSession, day)) return "24:00";
    return formatTime(attendanceSession.end_at);
  },

  startsFromPreviousDay(attendanceSession, day) {
    if (attendanceSession.starts_from_previous_day === true) return true;
    const raw = attendanceSession.raw_start_at || attendanceSession.start_at;
    if (!raw || !day) return false;
    return new Date(raw).getTime() < this.dayStartMs(day);
  },

  endsIntoNextDay(attendanceSession, day) {
    if (attendanceSession.end_at_is_end_of_day === true) return true;
    if (!attendanceSession.raw_end_at || !day) return false;
    const dayEnd = this.dayStartMs(day) + 24 * 60 * 60 * 1000;
    return new Date(attendanceSession.raw_end_at).getTime() >= dayEnd;
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

  formatAttendanceSessionStart(attendanceSession, day) {
    const { formatTime } = DisplayUtils;
    if (this.startsFromPreviousDay(attendanceSession, day)) return "0:00";
    return formatTime(attendanceSession.start_at);
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
      .map((text) => `<p class="attendance-session-detail-note">${text}</p>`)
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
      this.axisBottom.innerHTML = "";
      return;
    }

    if (
      arrivedPct != null &&
      leftPct != null &&
      Math.abs(leftPct - arrivedPct) < this.ENDPOINT_LABEL_MIN_GAP_PCT
    ) {
      const mid = (arrivedPct + leftPct) / 2;
      this.axisBottom.innerHTML = `<span class="attendance-session-detail-endpoint attendance-session-detail-endpoint-combined" style="left:${mid}%">
        <span class="cap">到着 ${arrivedText}</span>
        <span class="cap">帰宅 ${leftText}</span>
      </span>`;
      return;
    }

    let bottom = "";
    if (arrivedPct != null) {
      bottom += `<span class="attendance-session-detail-endpoint" style="left:${arrivedPct}%">
        <span class="cap">到着</span>${arrivedText}
      </span>`;
    }
    if (leftPct != null) {
      bottom += `<span class="attendance-session-detail-endpoint" style="left:${leftPct}%">
        <span class="cap">帰宅</span>${leftText}
      </span>`;
    }
    this.axisBottom.innerHTML = bottom;
  },

  renderChart(member, day) {
    this.axisTop.innerHTML = this.HOUR_MARKS.map((hour) => {
      const left = (hour / 24) * 100;
      const label = hour === 24 ? "24:00" : `${hour}:00`;
      return `<span class="attendance-session-detail-hour" style="left:${left}%">
        <span class="attendance-session-detail-hour-label">${label}</span>
        <span class="attendance-session-detail-hour-tick"></span>
      </span>`;
    }).join("");

    const attendanceSessions = Array.isArray(member.attendance_sessions)
      ? member.attendance_sessions
      : [];
    this.bar.innerHTML = attendanceSessions
      .map((attendanceSession) => {
        const left = this.dayPercent(attendanceSession.start_at, day);
        const right = this.dayPercent(attendanceSession.end_at, day, {
          endOfDay: attendanceSession.end_at_is_end_of_day,
        });
        if (left == null || right == null || right <= left) return "";
        const width = right - left;
        return `<span class="attendance-session-detail-seg" style="left:${left}%;width:${width}%"></span>`;
      })
      .join("");

    this.renderEndpointLabels(member, day);
  },

  renderTable(member, day) {
    const { formatDuration } = DisplayUtils;
    const attendanceSessions = Array.isArray(member.attendance_sessions)
      ? member.attendance_sessions
      : [];
    this.tbody.innerHTML = attendanceSessions
      .map((attendanceSession, index) => {
        const fromPrev = this.startsFromPreviousDay(attendanceSession, day);
        const intoNext = this.endsIntoNextDay(attendanceSession, day);
        const enter = this.formatAttendanceSessionStart(attendanceSession, day);
        const leave = this.formatAttendanceSessionEnd(attendanceSession, day);
        const enterNote = fromPrev
          ? `<span class="attendance-session-cross-tag">継続</span>`
          : "";
        const leaveNote = intoNext
          ? `<span class="attendance-session-cross-tag">継続</span>`
          : "";
        return `<tr>
          <td class="attendance-session-num">${index + 1}</td>
          <td>${enter}${enterNote}</td>
          <td>${leave}${leaveNote}</td>
          <td>${formatDuration(attendanceSession.duration_seconds)}</td>
        </tr>`;
      })
      .join("");
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
    const sessionCount =
      member.attendance_session_count ?? (member.attendance_sessions || []).length;
    this.count.textContent = `${sessionCount}回`;
    this.renderNotes(member, day);
    this.renderChart(member, day);
    this.renderTable(member, day);
  },

  open(memberId, status) {
    if (!this.dialog) return;
    const member = this.findMemberRow(status, memberId);
    if (!member) return;
    this.openMemberId = memberId;
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
