const RegisterDialog = {
  dialog: null,
  form: null,
  error: null,

  init() {
    this.dialog = document.getElementById("register-dialog");
    this.form = document.getElementById("register-form");
    this.error = document.getElementById("register-error");

    MemberFormUtils.wireCloseButtons(this.dialog);
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
    // API 未接続: 登録処理は後続タスクで実装
    MemberFormUtils.closeDialog(this.dialog);
  },
};
