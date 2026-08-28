const EditDialog = {
  dialog: null,
  form: null,
  error: null,

  init() {
    this.dialog = document.getElementById("edit-dialog");
    this.form = document.getElementById("edit-form");
    this.error = document.getElementById("edit-error");

    MemberFormUtils.wireCloseButtons(this.dialog);
    this.wireGraduationToggle();
    this.form.addEventListener("submit", (event) => this.handleSubmit(event));
  },

  open(member) {
    MemberFormUtils.showError(this.error, null);
    this.form.elements.member_id.value = String(member.id);
    this.form.elements.name.value = member.name;
    this.form.elements.grade.value = member.grade;
    this.form.elements.role.value = member.role || RoleConfig.defaultCode;
    this.form.elements.username.value = member.username;
    this.form.elements.password.value = "";
    this.form.elements.password_confirm.value = "";

    const graduated = member.graduation_year != null;
    this.form.elements.graduated.checked = graduated;
    this.form.elements.graduation_year.value = graduated ? String(member.graduation_year) : "";
    this.form.elements.graduation_year.disabled = !graduated;

    MemberFormUtils.openDialog(this.dialog);
  },

  fillSelects() {
    MemberFormUtils.fillGradeSelect(this.form.elements.grade);
    MemberFormUtils.fillRoleSelect(this.form.elements.role);
  },

  wireGraduationToggle() {
    const graduated = this.form.elements.graduated;
    const yearInput = this.form.elements.graduation_year;

    graduated.addEventListener("change", () => {
      yearInput.disabled = !graduated.checked;
      if (!graduated.checked) {
        yearInput.value = "";
      }
    });
  },

  handleSubmit(event) {
    event.preventDefault();
    const password = this.form.elements.password.value;
    const passwordConfirm = this.form.elements.password_confirm.value;
    const passwordError = MemberFormUtils.validatePasswordPair(password, passwordConfirm, false);

    if (passwordError) {
      MemberFormUtils.showError(this.error, passwordError);
      return;
    }

    if (this.form.elements.graduated.checked) {
      const year = Number(this.form.elements.graduation_year.value);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        MemberFormUtils.showError(this.error, "卒業年度を正しく入力してください");
        return;
      }
    }

    MemberFormUtils.showError(this.error, null);
    // API 未接続: 更新処理は後続タスクで実装
    MemberFormUtils.closeDialog(this.dialog);
  },
};
