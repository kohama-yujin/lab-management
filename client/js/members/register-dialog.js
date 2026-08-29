const RegisterDialog = {
  dialog: null,
  form: null,
  error: null,

  init() {
    this.dialog = document.getElementById("register-dialog");
    this.form = document.getElementById("register-form");
    this.error = document.getElementById("register-error");

    MemberFormUtils.wireCloseButtons(this.dialog);
    MemberFormUtils.wireBackdropClose(this.dialog);
    this.form.addEventListener("submit", (event) => this.handleSubmit(event));
  },

  open() {
    this.form.reset();
    this.fillSelects();
    MemberFormUtils.showError(this.error, null);
    MemberFormUtils.openDialog(this.dialog);
  },

  fillSelects() {
    MemberFormUtils.fillGradeSelect(this.form.elements.grade);
    MemberFormUtils.fillRoleSelect(this.form.elements.role);
  },

  handleSubmit(event) {
    event.preventDefault();
    const password = this.form.elements.password.value;
    const passwordConfirm = this.form.elements.password_confirm.value;
    const passwordError = MemberFormUtils.validatePasswordPair(password, passwordConfirm, true);

    if (passwordError) {
      MemberFormUtils.showError(this.error, passwordError);
      return;
    }

    MemberFormUtils.showError(this.error, null);
    void this.submitForm({
      name: this.form.elements.name.value,
      grade: this.form.elements.grade.value,
      role: this.form.elements.role.value,
      username: this.form.elements.username.value,
      password,
    });
  },

  async submitForm(payload) {
    const submitButton = this.form.querySelector('[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const res = await fetch("/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await ApiUtils.parseError(res);
        MemberFormUtils.showError(this.error, message);
        return;
      }

      MemberFormUtils.closeDialog(this.dialog);
      if (window.MemberPage?.reload) {
        await window.MemberPage.reload();
      }
    } catch (err) {
      MemberFormUtils.showError(this.error, err.message || "登録に失敗しました");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  },
};
