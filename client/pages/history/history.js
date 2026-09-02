const els = {
  viewDate: document.getElementById("view-date"),
  subtitle: document.getElementById("subtitle"),
  clockDate: document.getElementById("clock-date"),
  clockTime: document.getElementById("clock-time"),
  boards: document.getElementById("boards"),
  prevDay: document.getElementById("prev-day"),
  nextDay: document.getElementById("next-day"),
  dialogRoot: document.getElementById("history-dialogs"),
};

/** @type {string[]} ISO dates, newest first */
let dates = [];
/** @type {number} index into dates */
let dateIndex = 0;
/** @type {object | null} */
let lastStatus = null;

const { dash, formatTime, formatDuration, formatDayLabel } = DisplayUtils;

function presenceView(t) {
  if (!t.present) {
    return { rowClass: "row-away", statusClass: "status-away", label: "不在" };
  }
  return { rowClass: "row-present", statusClass: "status-present", label: "在室" };
}

function updateNavButtons() {
  els.prevDay.disabled = dateIndex >= dates.length - 1;
  els.nextDay.disabled = dateIndex <= 0;
}

function renderBoards(status) {
  const grades = GradeConfig.resolveOrder(status);
  const byGrade = status.by_grade || {};

  els.boards.innerHTML = grades
    .map((grade) => {
      const rows = byGrade[grade] || [];
      const body =
        rows.length === 0
          ? `<p class="empty">この日は来ていません</p>`
          : `<table>
              <thead>
                <tr>
                  <th>状態</th>
                  <th>氏名</th>
                  <th class="col-arrived">到着</th>
                  <th class="col-left">帰宅</th>
                  <th>総在室</th>
                  <th class="col-detail"></th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map((t) => {
                    const view = presenceView(t);
                    const arrived = formatTime(t.arrived_at);
                    const left = t.left_at_is_end_of_day
                      ? "24:00"
                      : formatTime(t.left_at);
                    return `<tr class="${view.rowClass}">
                      <td class="${view.statusClass}">${view.label}</td>
                      <td>${dash(t.name)}</td>
                      <td class="col-arrived">${arrived}</td>
                      <td class="col-left">${left}</td>
                      <td class="col-total">
                        <span class="total-duration">${formatDuration(t.total_present_seconds)}</span>
                      </td>
                      <td class="col-detail">
                        <button
                          type="button"
                          class="detail-btn"
                          data-member-id="${t.member_id}"
                        >詳細</button>
                      </td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>`;

      return `<section class="board" data-grade="${grade}">
        <h2 class="board-title">${GradeConfig.label(grade)}</h2>
        ${body}
      </section>`;
    })
    .join("");

  AttendanceSessionDetailDialog.refresh(status);
}

function renderEmpty(message) {
  lastStatus = null;
  AttendanceSessionDetailDialog.close();
  els.viewDate.textContent = "—";
  els.subtitle.textContent = message;
  els.boards.innerHTML = `<p class="history-empty">${message}</p>`;
  updateNavButtons();
}

async function loadDay() {
  if (!dates.length) {
    renderEmpty("過去の在室記録はまだありません");
    els.prevDay.disabled = true;
    els.nextDay.disabled = true;
    return;
  }

  const day = dates[dateIndex];
  els.viewDate.textContent = formatDayLabel(day);
  updateNavButtons();
  els.subtitle.textContent = "読み込み中…";
  AttendanceSessionDetailDialog.close();

  try {
    const res = await fetch(`/history/${day}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = await res.json();
    lastStatus = status;
    els.subtitle.textContent = `${status.count ?? 0}名の記録`;
    renderBoards(status);
  } catch (err) {
    lastStatus = null;
    els.subtitle.textContent = `読み込み失敗: ${err.message}`;
    els.boards.innerHTML = "";
  }
}

async function init() {
  try {
    await AttendanceSessionDetailDialog.loadPartial(els.dialogRoot);
    AttendanceSessionDetailDialog.init();
    AttendanceSessionDetailDialog.wireBoard(els.boards, (memberId) => {
      if (!lastStatus) return;
      AttendanceSessionDetailDialog.open(memberId, lastStatus);
    });
    await GradeConfig.ensureLoaded();
    const res = await fetch("/history/dates", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    dates = Array.isArray(data.dates) ? data.dates : [];
    dateIndex = 0;
    await loadDay();
  } catch (err) {
    renderEmpty(`日付一覧の取得に失敗しました: ${err.message}`);
    els.prevDay.disabled = true;
    els.nextDay.disabled = true;
  }
}

els.prevDay.addEventListener("click", () => {
  if (dateIndex >= dates.length - 1) return;
  dateIndex += 1;
  loadDay();
});

els.nextDay.addEventListener("click", () => {
  if (dateIndex <= 0) return;
  dateIndex -= 1;
  loadDay();
});

DisplayUtils.startClock(els.clockDate, els.clockTime);
init();
