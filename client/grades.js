/**
 * grades テーブル（/get_grade 経由）から学年一覧を取得する。
 */
const GradeConfig = {
  order: [],
  loaded: false,
  loadPromise: null,

  async ensureLoaded() {
    if (this.loaded) {
      return this.order;
    }
    if (!this.loadPromise) {
      this.loadPromise = this._fetch();
    }
    return this.loadPromise;
  },

  async _fetch() {
    const res = await fetch("/get_grade", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    this.order = Array.isArray(data.grades) ? data.grades : [];
    this.loaded = true;
    return this.order;
  },

  label(grade) {
    return grade;
  },

  resolveOrder(status) {
    if (Array.isArray(status?.grades) && status.grades.length > 0) {
      return status.grades;
    }
    return this.order;
  },
};
