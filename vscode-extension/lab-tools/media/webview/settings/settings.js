//@ts-check
(function () {
  // @ts-ignore VS Code Webview が注入する API
  const vscode = acquireVsCodeApi();

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function el(id) {
    const node = document.getElementById(id);
    if (!node) {
      throw new Error(`要素が見つかりません: ${id}`);
    }
    return node;
  }

  /**
   * @param {string} kind
   * @param {string} text
   */
  function setStatus(kind, text) {
    const node = el('status');
    node.className = kind;
    node.textContent = text;
  }

  function readForm() {
    return {
      username: /** @type {HTMLInputElement} */ (el('username')).value,
      serverIp: /** @type {HTMLInputElement} */ (el('serverIp')).value,
      publicUrl: /** @type {HTMLInputElement} */ (el('publicUrl')).value,
      autoCheckIn: /** @type {HTMLInputElement} */ (el('autoCheckIn')).checked,
      password: /** @type {HTMLInputElement} */ (el('password')).value,
      apiKey: /** @type {HTMLInputElement} */ (el('apiKey')).value,
    };
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'load') {
      const s = msg.settings;
      /** @type {HTMLInputElement} */ (el('username')).value = s.username || '';
      /** @type {HTMLInputElement} */ (el('serverIp')).value = s.serverIp || '';
      /** @type {HTMLInputElement} */ (el('publicUrl')).value = s.publicUrl || '';
      /** @type {HTMLInputElement} */ (el('autoCheckIn')).checked = Boolean(s.autoCheckIn);
      const password = /** @type {HTMLInputElement} */ (el('password'));
      const apiKey = /** @type {HTMLInputElement} */ (el('apiKey'));
      password.value = '';
      apiKey.value = '';
      password.placeholder = s.hasPassword ? '••••••••（変更時のみ入力）' : '';
      apiKey.placeholder = s.hasApiKey ? '••••••••（変更時のみ入力）' : '';
      el('passwordHint').textContent = s.hasPassword ? '保存済みのパスワードがあります' : '未設定';
      el('apiKeyHint').textContent = s.hasApiKey ? '保存済みのAPIキーがあります' : '未設定';
      el('publicUrlHint').textContent = "サーバーIPが有効な場合、接続テスト時に公開URLが自動的に設定されます。";
    }
    if (msg.type === 'status') {
      setStatus(msg.kind, msg.text);
    }
    if (msg.type === 'setPublicUrl') {
      /** @type {HTMLInputElement} */ (el('publicUrl')).value = msg.value || '';
    }
  });

  el('save').addEventListener('click', () => {
    vscode.postMessage({ type: 'save', ...readForm() });
  });
  el('test').addEventListener('click', () => {
    vscode.postMessage({ type: 'test', ...readForm() });
  });

  vscode.postMessage({ type: 'ready' });
})();
