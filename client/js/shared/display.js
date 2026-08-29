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
