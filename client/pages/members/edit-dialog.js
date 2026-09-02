const EditDialog = {
  dialog: null,
  form: null,
  error: null,

  init() {
    this.dialog = document.getElementById("edit-dialog");
    this.form = document.getElementById("edit-form");
    this.error = document.getElementById("edit-error");

    MemberFormUtils.wireCloseButtons(this.dialog);
    MemberFormUtils.wireBackdropClose(this.dialog);
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

    this.applyRoleFieldVisibility();
    MemberFormUtils.openDialog(this.dialog);
  },

  /**
   * 一般は役職を変更できないため、役職欄を非表示にする。
   */
  applyRoleFieldVisibility() {
    const roleField = this.form.elements.role?.closest(".form-field");
    if (!roleField) {
      return;
    }
    roleField.hidden = !AuthBar.isAdmin();
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
    const validationError = MemberFormUtils.validateMemberFields({
      name: this.form.elements.name.value,
      username: this.form.elements.username.value,
      password,
      passwordConfirm,
      passwordRequired: false,
    });

    if (validationError) {
      MemberFormUtils.showError(this.error, validationError);
      return;
    }

    let graduationYear = null;
    if (this.form.elements.graduated.checked) {
      const year = Number(this.form.elements.graduation_year.value);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        MemberFormUtils.showError(this.error, "卒業年度を正しく入力してください");
        return;
      }
      graduationYear = year;
    }

    MemberFormUtils.showError(this.error, null);
    void this.submitForm({
      memberId: Number(this.form.elements.member_id.value),
      name: this.form.elements.name.value,
      grade: this.form.elements.grade.value,
      role: this.form.elements.role.value,
      username: this.form.elements.username.value,
      password: password || null,
      graduation_year: graduationYear,
    });
  },

  async submitForm(payload) {
    const submitButton = this.form.querySelector('[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const body = {
        name: payload.name,
        grade: payload.grade,
        role: payload.role,
        username: payload.username,
        graduation_year: payload.graduation_year,
      };
      if (payload.password) {
        body.password = payload.password;
      }

      const res = await fetch(`/members/${payload.memberId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const message = await ApiUtils.parseError(res);
        MemberFormUtils.showError(this.error, message);
        return;
      }

      MemberFormUtils.closeDialog(this.dialog);
      window.location.reload();
    } catch (err) {
      MemberFormUtils.showError(this.error, err.message || "更新に失敗しました");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  },
};
