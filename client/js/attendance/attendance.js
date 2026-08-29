// 接続・切断・加算ループの revision 変化を検知する短い監視間隔
const WATCH_MS = 1000;
let watchTimer = null;
let lastRevision = null;
let rulesReady = false;

const els = {
  subtitle: document.getElementById("subtitle"),
  publicUrl: document.getElementById("public-url"),
  publicUrlLink: document.getElementById("public-url-link"),
  rules: document.getElementById("rules"),
  clockDate: document.getElementById("clock-date"),
  clockTime: document.getElementById("clock-time"),
  boards: document.getElementById("boards"),
};

const { dash, formatTime, formatDuration } = DisplayUtils;

function setSubtitle(status) {
  const updated = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  els.subtitle.textContent = `最終更新: ${updated}`;
}

function setPublicUrl(status) {
  if (!els.publicUrl || !els.publicUrlLink) return;
  const url = typeof status.public_url === "string" ? status.public_url.trim() : "";
  if (!url) {
    els.publicUrl.hidden = true;
    els.publicUrlLink.removeAttribute("href");
    els.publicUrlLink.textContent = "";
    return;
  }
  els.publicUrl.hidden = false;
  els.publicUrlLink.href = url;
  els.publicUrlLink.textContent = url;
}

function formatRules(_status) {
  return (
    ""
  );
}

function presenceView(t) {
  if (!t.present) {
    return { rowClass: "row-away", statusClass: "status-away", label: "不在" };
  }
  return { rowClass: "row-present", statusClass: "status-present", label: "在室" };
}

function renderBoards(status) {
  setSubtitle(status);
  setPublicUrl(status);
  if (els.rules) {
    els.rules.textContent = formatRules(status);
    rulesReady = true;
  }

  const grades = GradeConfig.resolveOrder(status);
  const byGrade = status.by_grade || {};

  els.boards.innerHTML = grades
    .map((grade) => {
      const rows = byGrade[grade] || [];
      const body =
        rows.length === 0
          ? `<p class="empty">今日はまだ来ていません</p>`
          : `<table>
              <thead>
                <tr>
                  <th>状態</th>
                  <th>名前</th>
                  <th class="col-arrived">到着</th>
                  <th class="col-left">帰宅</th>
                  <th>総在室</th>
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
                      <td>${formatDuration(t.total_present_seconds)}</td>
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
}

async function watch() {
  try {
    const res = await fetch("/status", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = await res.json();
    const revision = status.revision;

    // 公開 URL は revision と独立に変わる（トンネル起動後）ので毎回更新
    setPublicUrl(status);

    // 初回、または revision 変化（入退室・1分経過）のとき描画
    if (lastRevision === null || revision !== lastRevision) {
      lastRevision = revision;
      renderBoards(status);
    } else if (!rulesReady && els.rules) {
      els.rules.textContent = formatRules(status);
      rulesReady = true;
    }
  } catch (err) {
    els.subtitle.textContent = `最終更新: 失敗`;
    if (els.rules) els.rules.textContent = `更新失敗: ${err.message}`;
  }

  clearTimeout(watchTimer);
  watchTimer = setTimeout(watch, WATCH_MS);
}

async function boot() {
  DisplayUtils.startClock(els.clockDate, els.clockTime);
  try {
    await GradeConfig.ensureLoaded();
  } catch (err) {
    els.subtitle.textContent = "学年設定の取得に失敗しました";
    if (els.rules) els.rules.textContent = `更新失敗: ${err.message}`;
    return;
  }
  watch();
}

boot();
