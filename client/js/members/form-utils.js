const MemberFormUtils = {
  fillGradeSelect(select) {
    select.innerHTML = GradeConfig.order
      .map((grade) => `<option value="${grade}">${GradeConfig.label(grade)}</option>`)
      .join("");
  },

  fillRoleSelect(select) {
    select.innerHTML = RoleConfig.roles
      .map(
        (role) =>
          `<option value="${role.code}"${role.code === RoleConfig.defaultCode ? " selected" : ""}>${role.name}</option>`
      )
      .join("");
  },

  showError(errorEl, message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  },

  /**
   * 登録・編集フォームの入力を検証する。最初のエラーメッセージを返す。
   * @param {{ name: string, username: string, password: string, passwordConfirm: string, passwordRequired: boolean }} fields
   * @returns {string | null}
   */
  validateMemberFields(fields) {
    const nameError = MemberValidation.validateName(fields.name);
    if (nameError) {
      return nameError;
    }

    const usernameError = MemberValidation.validateUsername(fields.username);
    if (usernameError) {
      return usernameError;
    }

    return MemberValidation.validatePasswordPair(
      fields.password,
      fields.passwordConfirm,
      fields.passwordRequired
    );
  },

  openDialog(dialog) {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    }
  },

  closeDialog(dialog) {
    dialog.close();
  },

  wireCloseButtons(root) {
    root.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => {
        const dialog = button.closest("dialog");
        if (dialog) {
          this.closeDialog(dialog);
        }
      });
    });
  },

  /** モーダル背景（::backdrop）クリックでダイアログを閉じる */
  wireBackdropClose(dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        this.closeDialog(dialog);
      }
    });
  },
};
