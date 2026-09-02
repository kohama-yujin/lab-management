//@ts-check
(function () {
  // @ts-ignore VS Code Webview が注入する API
  const vscode = acquireVsCodeApi();

  /** @type {import('../../../src/api/types').StatusViewState | null} */
  let state = null;
  /** @type {boolean | null} */
  let lastPresent = null;
  const els = {
    banner: /** @type {HTMLElement} */ (document.getElementById('banner')),
    selfArea: /** @type {HTMLElement} */ (document.getElementById('self-area')),
    boards: /** @type {HTMLElement} */ (document.getElementById('boards')),
    lastUpdated: /** @type {HTMLElement} */ (document.getElementById('last-updated')),
    checkinSound: /** @type {HTMLAudioElement} */ (document.getElementById('checkin-sound')),
    checkoutSound: /** @type {HTMLAudioElement} */ (document.getElementById('checkout-sound')),
  };

  /**
   * @param {HTMLAudioElement} audio
   */
  function playSound(audio) {
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // 再生失敗は無視（自動再生制限など）
    }
  }

  /**
   * reload 後の状態更新で、自分の在室状態の変化を検知して入退室音を鳴らす。
   * @param {import('../../../src/api/types').StatusViewState} s
   */
  function maybePlayAttendanceSounds(s) {
    if (s.loading) {
      return;
    }
    if (!s.self) {
      lastPresent = null;
      return;
    }

    const present = s.self.present;
    if (lastPresent === false && present === true) {
      playSound(els.checkinSound);
    } else if (lastPresent === true && present === false) {
      playSound(els.checkoutSound);
    }
    lastPresent = present;
  }

  /**
   * @param {boolean} present
   * @param {string} durationLabel
   * @returns {string}
   */
  function renderChip(present, durationLabel) {
    const kind = present ? 'present' : 'away';
    const label = present ? '在室' : '不在';
    return `<span class="chip ${kind}"><span class="dot"></span>${label}<span class="sep">·</span><span class="time">${durationLabel}</span></span>`;
  }

  /**
   * @param {boolean} working
   * @param {string} durationLabel
   * @returns {string}
   */
  function renderWorkChip(working, durationLabel) {
    const kind = working ? 'work' : 'work idle';
    return `<span class="chip ${kind}"><span class="dot"></span>作業<span class="sep">·</span><span class="time">${durationLabel}</span></span>`;
  }

  /**
   * @param {import('../../../src/api/types').StatusViewState} s
   */
  function render(s) {
    state = s;

    if (s.loading) {
      els.banner.hidden = false;
      els.banner.className = 'banner loading';
      els.banner.textContent = '読み込み中…';
    } else if (s.viewError) {
      els.banner.hidden = false;
      els.banner.className = 'banner error';
      els.banner.textContent = s.viewError.userMessage;
    } else {
      els.banner.hidden = true;
    }

    if (s.lastUpdatedLabel) {
      els.lastUpdated.hidden = false;
      els.lastUpdated.textContent = `最終更新 ${s.lastUpdatedLabel}`;
    } else {
      els.lastUpdated.hidden = true;
      els.lastUpdated.textContent = '';
    }

    renderSelf(s);
    renderBoards(s);
    maybePlayAttendanceSounds(s);
  }

  /**
   * @param {import('../../../src/api/types').StatusViewState} s
   */
  function renderSelf(s) {
    if (s.viewError) {
      els.selfArea.innerHTML = '';
      return;
    }

    if (!s.self) {
      els.selfArea.innerHTML = '';
      return;
    }

    let html = '<div class="self-chips">';
    html += renderChip(s.self.present, s.self.durationLabel);
    html += renderWorkChip(s.self.working, s.self.workDurationLabel);
    html += '</div>';

    if (s.self.present) {
      html += '<button type="button" class="btn" id="btn-checkout">退室</button>';
    } else if (!s.autoCheckIn) {
      html += '<button type="button" class="btn" id="btn-checkin">入室</button>';
    } else {
      html += '<p class="hint">エディタを操作すると自動入室します</p>';
      html += '<p class="hint">手動退室後は 1分後から有効です</p>';
    }

    els.selfArea.innerHTML = html;

    const checkIn = document.getElementById('btn-checkin');
    const checkOut = document.getElementById('btn-checkout');
    checkIn?.addEventListener('click', () => vscode.postMessage({ type: 'checkIn' }));
    checkOut?.addEventListener('click', () => vscode.postMessage({ type: 'checkOut' }));
  }

  /**
   * @param {import('../../../src/api/types').StatusViewState} s
   */
  function renderBoards(s) {
    if (s.grades.length === 0) {
      els.boards.innerHTML = '<p class="empty">データがありません</p>';
      return;
    }

    els.boards.innerHTML = s.grades
      .map((block) => {
        if (block.members.length === 0) {
          return `<div class="grade-block"><div class="grade-header">${escapeHtml(block.grade)}</div><p class="empty-grade">今日はまだ来ていません</p></div>`;
        }
        const rows = block.members
          .map(
            (m) => `<div class="member-row${m.isSelf ? ' self' : ''}">
              <div class="member-info">
                <div class="member-name">${escapeHtml(m.name)}</div>
                <div class="member-time">${escapeHtml(m.timeRange)}</div>
              </div>
              ${renderChip(m.present, m.durationLabel)}
            </div>`,
          )
          .join('');
        return `<div class="grade-block"><div class="grade-header">${escapeHtml(block.grade)}</div>${rows}</div>`;
      })
      .join('');
  }

  /**
   * @param {string} value
   */
  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      render(msg.state);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
