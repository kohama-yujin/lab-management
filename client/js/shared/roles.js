/**
 * roles テーブル（/get_role 経由）から役職一覧を取得する。
 */
const RoleConfig = {
  roles: [],
  loaded: false,
  loadPromise: null,

  defaultCode: "member",

  async ensureLoaded() {
    if (this.loaded) {
      return this.roles;
    }
    if (!this.loadPromise) {
      this.loadPromise = this._fetch();
    }
    return this.loadPromise;
  },

  async _fetch() {
    const res = await fetch("/get_role", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    this.roles = Array.isArray(data.roles) ? data.roles : [];
    this.loaded = true;
    return this.roles;
  },

  label(code) {
    const role = this.roles.find((item) => item.code === code);
    return role ? role.name : code;
  },
};
