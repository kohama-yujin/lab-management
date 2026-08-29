/**
 * バックエンド API 呼び出しの共通ユーティリティ。
 */
const ApiUtils = {
  /**
   * 失敗した fetch Response からユーザー向けメッセージを取り出す。
   * @param {Response} res
   * @returns {Promise<string>}
   */
  async parseError(res) {
    try {
      const data = await res.json();
      if (data && typeof data.message === "string" && data.message) {
        return data.message;
      }
    } catch (_err) {
      // JSON でない応答は下で HTTP ステータスにフォールバック
    }
    return `HTTP ${res.status}`;
  },
};
