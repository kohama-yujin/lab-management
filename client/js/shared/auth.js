/**
 * ヘッダーの Slack ログイン表示を更新する。
 */
const AuthBar = {
  errorMessages: {
    slack_not_configured: "Slack 認証が未設定です",
    slack_denied: "Slack 認証がキャンセルされました",
    invalid_state: "認証状態が無効です。もう一度お試しください",
    token_failed: "Slack トークン取得に失敗しました",
    userinfo_failed: "Slack ユーザー情報の取得に失敗しました",
    no_user_id: "Slack ユーザー ID を取得できませんでした",
    member_not_found: "Slack アカウントがメンバーに登録されていません",
  },

  _wired: false,
  /** @type {{ id: number, name: string, grade: string, role: string, graduation_year: number | null } | null} */
  _member: null,
  /** 自己登録待ち（pending Slack セッション）か */
  _pendingRegistration: false,
  /** 自己登録フォーム用の名前候補 */
  _suggestedName: "",

  /**
   * ログイン中メンバーを返す。未ログインなら null。
   * @returns {{ id: number, name: string, grade: string, role: string, graduation_year: number | null } | null}
   */
  getMember() {
    return this._member;
  },

  /**
   * ログイン済みなら true。
   * @returns {boolean}
   */
  isLoggedIn() {
    return this._member != null;
  },

  /**
   * Slack 自己登録待ちなら true。
   * @returns {boolean}
   */
  isPendingRegistration() {
    return this._pendingRegistration;
  },

  /**
   * 自己登録フォーム用の名前候補を返す。
   * @returns {string}
   */
  getSuggestedName() {
    return this._suggestedName;
  },

  /**
   * 管理者なら true。
   * @returns {boolean}
   */
  isAdmin() {
    return this._member?.role === "admin";
  },

  /**
   * 指定メンバーを編集できる見た目にするか。
   * 管理者は全員、一般は自分のみ、未ログインは不可。
   * @param {number} memberId
   * @returns {boolean}
   */
  canEditMember(memberId) {
    if (!this._member) {
      return false;
    }
    if (this._member.role === "admin") {
      return true;
    }
    return this._member.id === memberId;
  },

  async init() {
    const bar = document.getElementById("auth-bar");
    if (!bar) {
      return;
    }

    this._wireOnce();
    this.showAuthErrorFromQuery();
    await this.refresh();
  },

  /**
   * クリック・外側クリック・ログアウトのイベントを一度だけ登録する。
   */
  _wireOnce() {
    if (this._wired) {
      return;
    }
    this._wired = true;

    const userBtn = document.getElementById("auth-user-info");
    const logoutBtn = document.getElementById("auth-logout-btn");
    const pendingCancel = document.getElementById("auth-pending-cancel");
    const session = document.getElementById("auth-session");
    if (session) {
      session.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    }
    if (userBtn) {
      userBtn.addEventListener("click", () => {
        this.toggleMenu();
      });
    }
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        this.logout();
      });
    }
    if (pendingCancel) {
      pendingCancel.addEventListener("click", () => {
        this.logout();
      });
    }

    document.addEventListener("click", () => {
      this.closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeMenu();
      }
    });
  },

  showAuthErrorFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_error");
    if (!code) {
      return;
    }

    const message = this.errorMessages[code] || "ログインに失敗しました";
    window.alert(message);

    params.delete("auth_error");
    const nextQuery = params.toString();
    const nextUrl = nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  },

  async refresh() {
    const loginBtn = document.getElementById("auth-login-btn");
    const pending = document.getElementById("auth-pending");
    const session = document.getElementById("auth-session");
    const userBtn = document.getElementById("auth-user-info");
    const label = document.getElementById("auth-user-label");
    if (!loginBtn || !session || !userBtn || !label) {
      return;
    }

    this.closeMenu();

    try {
      const res = await fetch("/auth/me", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data.logged_in) {
        const graduated = data.graduation_year != null;
        this._member = {
          id: Number(data.id),
          name: data.name,
          grade: data.grade,
          role: data.role || "member",
          graduation_year: data.graduation_year ?? null,
        };
        this._pendingRegistration = false;
        this._suggestedName = "";
        loginBtn.hidden = true;
        if (pending) {
          pending.hidden = true;
        }
        session.hidden = false;
        label.textContent = graduated
          ? `${data.name} / ${data.graduation_year}年卒`
          : `${data.name} / ${data.grade}`;
        // ボードと同じ学年カラー（卒業済みは graduated）を data-grade で適用する
        userBtn.dataset.grade = graduated ? "graduated" : data.grade || "";
        return;
      }

      if (data.pending_registration) {
        this._member = null;
        this._pendingRegistration = true;
        this._suggestedName =
          typeof data.suggested_name === "string" ? data.suggested_name : "";
        loginBtn.hidden = true;
        if (pending) {
          pending.hidden = false;
        }
        session.hidden = true;
        label.textContent = "";
        delete userBtn.dataset.grade;
        return;
      }
    } catch (_err) {
      // 未ログイン扱いでログインボタンを表示する
    }

    this._member = null;
    this._pendingRegistration = false;
    this._suggestedName = "";
    loginBtn.hidden = false;
    if (pending) {
      pending.hidden = true;
    }
    session.hidden = true;
    label.textContent = "";
    delete userBtn.dataset.grade;
  },

  toggleMenu() {
    const menu = document.getElementById("auth-menu");
    if (!menu || menu.hidden) {
      this.openMenu();
      return;
    }
    this.closeMenu();
  },

  openMenu() {
    const menu = document.getElementById("auth-menu");
    const userBtn = document.getElementById("auth-user-info");
    if (!menu || !userBtn || document.getElementById("auth-session")?.hidden) {
      return;
    }
    menu.hidden = false;
    userBtn.setAttribute("aria-expanded", "true");
    userBtn.classList.add("is-open");
  },

  closeMenu() {
    const menu = document.getElementById("auth-menu");
    const userBtn = document.getElementById("auth-user-info");
    if (menu) {
      menu.hidden = true;
    }
    if (userBtn) {
      userBtn.setAttribute("aria-expanded", "false");
      userBtn.classList.remove("is-open");
    }
  },

  /**
   * セッションを破棄して未ログイン表示に戻す。
   */
  async logout() {
    this.closeMenu();
    try {
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (_err) {
      // 失敗しても画面上は未ログインに戻す
    }
    await this.refresh();
    window.location.reload();
  },
};
