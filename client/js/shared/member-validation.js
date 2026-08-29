/**
 * メンバー登録・更新フォームの入力ルール（server/member_validation.py と揃える）。
 */
const MemberValidation = {
  USERNAME_MIN_LEN: 3,
  USERNAME_MAX_LEN: 16,
  USERNAME_PATTERN: /^[a-zA-Z0-9_]+$/,
  PASSWORD_MIN_LEN: 8,
  PASSWORD_MAX_LEN: 128,
  NAME_MAX_LEN: 10,

  usernameHint() {
    return `${this.USERNAME_MIN_LEN}〜${this.USERNAME_MAX_LEN}文字、英数字と _ のみ`;
  },

  passwordHint() {
    return `${this.PASSWORD_MIN_LEN}文字以上`;
  },

  nameHint() {
    return `${this.NAME_MAX_LEN} 文字以内`;
  },

  validateUsername(username) {
    const value = (username || "").trim();
    if (!value) {
      return "ユーザー名を入力してください";
    }
    if (value.length < this.USERNAME_MIN_LEN) {
      return `ユーザー名は ${this.USERNAME_MIN_LEN} 文字以上にしてください`;
    }
    if (value.length > this.USERNAME_MAX_LEN) {
      return `ユーザー名は ${this.USERNAME_MAX_LEN} 文字以内にしてください`;
    }
    if (!this.USERNAME_PATTERN.test(value)) {
      return "ユーザー名は英数字とアンダースコア（_）のみ使用できます";
    }
    return null;
  },

  validateName(name) {
    const value = (name || "").trim();
    if (!value) {
      return "名前を入力してください";
    }
    if (value.length > this.NAME_MAX_LEN) {
      return `名前は ${this.NAME_MAX_LEN} 文字以内にしてください`;
    }
    return null;
  },

  validatePassword(password, required) {
    if (!password) {
      return required ? "パスワードを入力してください" : null;
    }
    if (password.length < this.PASSWORD_MIN_LEN) {
      return `パスワードは ${this.PASSWORD_MIN_LEN} 文字以上にしてください`;
    }
    if (password.length > this.PASSWORD_MAX_LEN) {
      return `パスワードは ${this.PASSWORD_MAX_LEN} 文字以内にしてください`;
    }
    return null;
  },

  validatePasswordPair(password, confirmPassword, required) {
    const hasPassword = Boolean(password);
    const hasConfirm = Boolean(confirmPassword);

    if (required && !hasPassword) {
      return "パスワードを入力してください";
    }
    if (!required && !hasPassword && !hasConfirm) {
      return null;
    }
    if (hasPassword !== hasConfirm) {
      return "パスワードと確認用パスワードの両方を入力してください";
    }
    if (password !== confirmPassword) {
      return "パスワードが一致しません";
    }
    return this.validatePassword(password, required);
  },
};
