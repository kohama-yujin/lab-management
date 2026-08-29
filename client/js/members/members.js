/** @typedef {{ id: number, name: string, grade: string, username: string, role: string, graduation_year: number | null }} Member */

const PARTIALS = {
  register: "/client/partials/members/register-dialog.html",
  edit: "/client/partials/members/edit-dialog.html",
};

const els = {
  subtitle: document.getElementById("subtitle"),
  clockDate: document.getElementById("clock-date"),
  clockTime: document.getElementById("clock-time"),
  boards: document.getElementById("boards"),
  openRegister: document.getElementById("open-register"),
  dialogRoot: document.getElementById("member-dialogs"),
};

/** 卒業済みメンバー1回あたりの取得件数（将来の API limit と揃える） */
const GRADUATED_PAGE_SIZE = 20;

const graduatedState = {
  items: [],
  total: 0,
  loading: false,
};

const { dash } = DisplayUtils;

/** @type {Member[]} */
let members = [];

async function fetchActiveMembers() {
  const res = await fetch("/members/list", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await ApiUtils.parseError(res));
  }
  const data = await res.json();
  members = Array.isArray(data.members) ? data.members : [];
}

async function reloadAllMembers() {
  await fetchActiveMembers();
  await fetchGraduatedMembers();
  renderBoards();
}

window.MemberPage = {
  reload: reloadAllMembers,
};

function isActive(member) {
  return member.graduation_year == null;
}

function gradeSortIndex(grade) {
  const index = GradeConfig.order.indexOf(grade);
  return index === -1 ? 999 : index;
}

function compareByName(a, b) {
  return a.name.localeCompare(b.name, "ja");
}

function compareGraduated(a, b) {
  if (b.graduation_year !== a.graduation_year) {
    return b.graduation_year - a.graduation_year;
  }
  const gradeDiff = gradeSortIndex(a.grade) - gradeSortIndex(b.grade);
  if (gradeDiff !== 0) {
    return gradeDiff;
  }
  return compareByName(a, b);
}

/**
 * 卒業済みメンバーをページ取得する。
 * @param {number} offset
 * @param {number} limit
 * @returns {Promise<{ items: Member[], total: number }>}
 */
async function fetchGraduatedPage(offset, limit) {
  const params = new URLSearchParams({
    graduated: "1",
    offset: String(offset),
    limit: String(limit),
  });
  const res = await fetch(`/members/list?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await ApiUtils.parseError(res));
  }
  const data = await res.json();
  return {
    items: Array.isArray(data.members) ? data.members : [],
    total: Number(data.total) || 0,
  };
}

async function fetchGraduatedMembers() {
  graduatedState.loading = true;
  try {
    const { items, total } = await fetchGraduatedPage(0, GRADUATED_PAGE_SIZE);
    graduatedState.items = items;
    graduatedState.total = total;
  } finally {
    graduatedState.loading = false;
  }
}

async function loadMoreGraduatedMembers() {
  if (graduatedState.loading || graduatedState.items.length >= graduatedState.total) {
    return;
  }
  graduatedState.loading = true;
  renderGraduatedBoard();
  try {
    const { items, total } = await fetchGraduatedPage(
      graduatedState.items.length,
      GRADUATED_PAGE_SIZE
    );
    graduatedState.items.push(...items);
    graduatedState.total = total;
  } finally {
    graduatedState.loading = false;
    renderGraduatedBoard();
  }
}

function renderMemberRows(rows, options = {}) {
  const { graduated = false } = options;

  return rows
    .map(
      (member) => `<tr>
            <td>${dash(member.name)}</td>
            <td class="col-username">${dash(member.username)}</td>
            <td class="col-role">${dash(RoleConfig.label(member.role))}</td>
            ${graduated ? `<td>${dash(GradeConfig.label(member.grade))}</td><td>${member.graduation_year}年卒</td>` : ""}
            <td class="member-actions">
              <button type="button" class="row-btn" data-edit-id="${member.id}">編集</button>
            </td>
          </tr>`
    )
    .join("");
}

function renderMemberTable(rows, options = {}) {
  const { graduated = false } = options;
  const headers = graduated
    ? `<th>名前</th><th class="col-username">ユーザー名</th><th class="col-role">役職</th><th>学年</th><th>卒業</th><th></th>`
    : `<th>名前</th><th class="col-username">ユーザー名</th><th>役職</th><th></th>`;

  if (rows.length === 0) {
    return `<p class="empty">メンバーがいません</p>`;
  }

  return `<table>
    <thead>
      <tr>${headers}</tr>
    </thead>
    <tbody>
      ${renderMemberRows(rows, options)}
    </tbody>
  </table>`;
}

function findMemberById(id) {
  const active = members.find((item) => item.id === id);
  if (active) {
    return active;
  }
  return graduatedState.items.find((item) => item.id === id);
}

function wireEditButtons(root) {
  root.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.getAttribute("data-edit-id"));
      const member = findMemberById(id);
      if (member) {
        EditDialog.open(member);
      }
    });
  });
}

function wireGraduatedLoadMore() {
  const button = els.boards.querySelector("#graduated-load-more");
  if (!button) return;
  button.addEventListener("click", () => {
    loadMoreGraduatedMembers();
  });
}

function renderGraduatedBoardHtml() {
  if (graduatedState.total === 0) {
    return "";
  }

  const remaining = graduatedState.total - graduatedState.items.length;
  const loadMore =
    remaining > 0
      ? `<div class="load-more-wrap">
          <button type="button" class="load-more-btn" id="graduated-load-more"${
            graduatedState.loading ? " disabled" : ""
          }>${graduatedState.loading ? "読み込み中…" : `もっと見る（あと ${remaining} 名）`}</button>
        </div>`
      : "";

  return `<section class="board" data-grade="graduated">
        <h2 class="board-title">卒業済み <span class="board-count">${graduatedState.total}名</span></h2>
        ${renderMemberTable(graduatedState.items, { graduated: true })}
        ${loadMore}
      </section>`;
}

function renderGraduatedBoard() {
  const html = renderGraduatedBoardHtml();
  const existing = els.boards.querySelector('[data-grade="graduated"]');

  if (!html) {
    existing?.remove();
    return;
  }

  if (existing) {
    existing.outerHTML = html;
  } else {
    els.boards.insertAdjacentHTML("beforeend", html);
  }

  wireEditButtons(els.boards.querySelector('[data-grade="graduated"]'));
  wireGraduatedLoadMore();
}

function renderBoards() {
  const activeMembers = members.filter((member) => isActive(member));
  els.subtitle.textContent = `在学：${activeMembers.length}名 / 卒業：${graduatedState.total}名`;

  if (!activeMembers.length && graduatedState.total === 0) {
    els.boards.innerHTML = `<p class="history-empty">メンバーが登録されていません</p>`;
    return;
  }

  const gradeBoards = GradeConfig.order
    .map((grade) => {
      const rows = activeMembers.filter((member) => member.grade === grade).sort(compareByName);
      return `<section class="board" data-grade="${grade}">
        <h2 class="board-title">${GradeConfig.label(grade)}</h2>
        ${renderMemberTable(rows)}
      </section>`;
    })
    .join("");

  els.boards.innerHTML = gradeBoards;
  renderGraduatedBoard();
  wireEditButtons(els.boards);
}

async function loadDialogPartials() {
  const responses = await Promise.all(
    Object.values(PARTIALS).map((url) => fetch(url, { cache: "no-store" }))
  );
  if (responses.some((res) => !res.ok)) {
    throw new Error("ダイアログの読み込みに失敗しました");
  }
  const html = (await Promise.all(responses.map((res) => res.text()))).join("\n");
  els.dialogRoot.innerHTML = html;
}

els.openRegister.addEventListener("click", () => {
  RegisterDialog.open();
});

async function boot() {
  DisplayUtils.startClock(els.clockDate, els.clockTime);

  try {
    await loadDialogPartials();
    RegisterDialog.init();
    EditDialog.init();

    await Promise.all([GradeConfig.ensureLoaded(), RoleConfig.ensureLoaded()]);
    RegisterDialog.fillSelects();
    EditDialog.fillSelects();
    await fetchActiveMembers();
    await fetchGraduatedMembers();
  } catch (err) {
    els.subtitle.textContent = err.message;
    return;
  }

  renderBoards();
}

boot();
