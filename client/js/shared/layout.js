/**
 * 全画面共通のヘッダーとナビを読み込み、ページ固有の設定を適用する。
 */
const SiteLayout = {
  HEADER_PARTIAL: "/client/partials/site-header.html",
  NAV_PARTIAL: "/client/partials/nav-actions.html",

  /**
   * body の data-page / data-title を使い、共通 UI をマウントする。
   * @returns {Promise<void>}
   */
  async mount() {
    const headerMount = document.getElementById("site-header-mount");
    const navMount = document.getElementById("nav-actions-mount");
    if (!headerMount || !navMount) {
      throw new Error("共通レイアウト用のマウント先が見つかりません");
    }

    const [headerRes, navRes] = await Promise.all([
      fetch(this.HEADER_PARTIAL, { cache: "no-store" }),
      fetch(this.NAV_PARTIAL, { cache: "no-store" }),
    ]);
    if (!headerRes.ok || !navRes.ok) {
      throw new Error("共通レイアウトの読み込みに失敗しました");
    }

    headerMount.innerHTML = await headerRes.text();
    navMount.innerHTML = await navRes.text();

    const title = document.body.dataset.title || "";
    const page = document.body.dataset.page || "";
    const titleEl = document.getElementById("site-title");
    if (titleEl) {
      titleEl.textContent = title;
    }

    this._markActiveNav(page);

    if (typeof AuthBar !== "undefined") {
      await AuthBar.init();
    }
  },

  /**
   * 現在ページのナビリンクを強調する。
   * @param {string} page
   */
  _markActiveNav(page) {
    document.querySelectorAll(".nav-actions [data-nav]").forEach((link) => {
      const active = link.getAttribute("data-nav") === page;
      link.classList.toggle("nav-btn-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  },
};
