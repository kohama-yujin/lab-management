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

  validatePasswordPair(password, confirmPassword, required) {
    const hasPassword = Boolean(password);
    const hasConfirm = Boolean(confirmPassword);

    if (required && !hasPassword) {
      return "password を入力してください";
    }
    if (!required && !hasPassword && !hasConfirm) {
      return null;
    }
    if (hasPassword !== hasConfirm) {
      return "password と確認用 password の両方を入力してください";
    }
    if (password !== confirmPassword) {
      return "password が一致しません";
    }
    return null;
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
};
