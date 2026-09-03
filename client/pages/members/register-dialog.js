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

  /**
   * 自己登録ダイアログを開く。
   * @param {string} [suggestedName]
   */
  open(suggestedName = "") {
    this.form.reset();
    this.fillSelects();
    this.form.elements.name.value = suggestedName || "";
    MemberFormUtils.showError(this.error, null);
    MemberFormUtils.openDialog(this.dialog);
    this.form.elements.name.focus();
  },

  fillSelects() {
    MemberFormUtils.fillGradeSelect(this.form.elements.grade);
  },

  handleSubmit(event) {
    event.preventDefault();
    const password = this.form.elements.password.value;
    const passwordConfirm = this.form.elements.password_confirm.value;
    const validationError = MemberFormUtils.validateMemberFields({
      name: this.form.elements.name.value,
      username: this.form.elements.username.value,
      password,
      passwordConfirm,
      passwordRequired: true,
    });

    if (validationError) {
      MemberFormUtils.showError(this.error, validationError);
      return;
    }

    MemberFormUtils.showError(this.error, null);
    void this.submitForm({
      name: this.form.elements.name.value,
      grade: this.form.elements.grade.value,
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
      const res = await fetch("/members/self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await ApiUtils.parseError(res);
        MemberFormUtils.showError(this.error, message);
        return;
      }

      MemberFormUtils.closeDialog(this.dialog);
      window.location.href = "/members";
    } catch (err) {
      MemberFormUtils.showError(this.error, err.message || "登録に失敗しました");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  },
};
