/**
 * 画面表示用の共通フォーマット処理。
 */
const DisplayUtils = {
  dash(value) {
    return value == null || value === "" ? "-" : String(value);
  },

  formatTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  },

  formatDuration(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (s >= 3600) return `${h}時間${m}分`;
    return `${m}分`;
  },

  /**
   * 総作業時間表示。0 秒のときは「-」。
   * @param {number | undefined | null} seconds
   */
  formatWorkTotal(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (s === 0) return "-";
    return this.formatDuration(s);
  },

  /**
   * ボードの総作業セル HTML。作業中は青いリッチドットを付ける。
   * @param {{ working?: boolean, total_work_seconds?: number }} member
   */
  formatWorkCell(member) {
    const total = member?.total_work_seconds ?? 0;
    const duration = this.formatWorkTotal(total);
    const prefix =
      member?.working && total > 0
        ? '<span class="work-active-dot" aria-hidden="true"></span>'
        : "";
    return `<span class="work-cell">${prefix}${duration}</span>`;
  },

  /**
   * 詳細 KPI 用の総作業表示。作業中はドット付きの HTML を返す。
   * @param {{ working?: boolean, total_work_seconds?: number }} member
   */
  formatWorkKpiValue(member) {
    const total = member?.total_work_seconds ?? 0;
    const duration = this.formatWorkTotal(total);
    if (total === 0) return "-";
    if (!member?.working) return duration;
    return `<span class="with-work-dot"><span class="work-active-dot" aria-hidden="true"></span>${duration}</span>`;
  },

  formatDayLabel(isoDay) {
    const d = new Date(`${isoDay}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDay;
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  },

  updateClock(clockDateEl, clockTimeEl) {
    const now = new Date();
    clockDateEl.textContent = now.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    clockTimeEl.textContent = now.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  },

  startClock(clockDateEl, clockTimeEl) {
    this.updateClock(clockDateEl, clockTimeEl);
    setInterval(() => this.updateClock(clockDateEl, clockTimeEl), 1000);
  },
};
