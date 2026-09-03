-- lab-management PostgreSQL スキーマ
--
-- マスタ:
--   roles  … 権限（一般・管理者）。将来の管理機能用
--   grades … 学年マスタ（表示順の唯一の定義元。）
--
-- member_grade_changes / member_role_changes / member_graduation_changes:
--   登録・変更のたびに1行追記。履歴日の属性は「その日終わりまでの最新行」。
--   graduation_year_* が NULL なら在学。

CREATE TABLE roles (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(32)     NOT NULL,
    name            VARCHAR(64)     NOT NULL,
    sort_order      INT             NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT roles_code_unique UNIQUE (code)
);

CREATE TABLE grades (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(16)     NOT NULL,
    sort_order      INT             NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT grades_code_unique UNIQUE (code),
    CONSTRAINT grades_sort_order_unique UNIQUE (sort_order)
);

CREATE TABLE members (
    id              BIGSERIAL       PRIMARY KEY,
    username        VARCHAR(64)     NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    name            VARCHAR(100)    NOT NULL,
    role_id         SMALLINT        NOT NULL,
    grade_id        SMALLINT        NOT NULL,
    graduation_year SMALLINT,       -- NULL = 在学中。卒業年度（西暦）を入れる
    slack_user_id   VARCHAR(64),    -- Slack OpenID sub（ユーザー ID）
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT members_username_unique UNIQUE (username),
    CONSTRAINT members_slack_user_id_unique UNIQUE (slack_user_id),
    CONSTRAINT members_graduation_year_check CHECK (
        graduation_year IS NULL OR graduation_year BETWEEN 2000 AND 2100
    ),
    CONSTRAINT members_role_id_fkey
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT,
    CONSTRAINT members_grade_id_fkey
        FOREIGN KEY (grade_id) REFERENCES grades (id) ON DELETE RESTRICT
);

CREATE INDEX members_role_id_idx ON members (role_id);
CREATE INDEX members_grade_id_idx ON members (grade_id);


-- 学年・役職の変更イベント（追記のみ。from が NULL なら初回登録）
CREATE TABLE member_grade_changes (
    id              BIGSERIAL       PRIMARY KEY,
    member_id       BIGINT          NOT NULL,
    grade_id_from   SMALLINT,
    grade_id_to     SMALLINT        NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT member_grade_changes_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT,
    CONSTRAINT member_grade_changes_grade_id_from_fkey
        FOREIGN KEY (grade_id_from) REFERENCES grades (id) ON DELETE RESTRICT,
    CONSTRAINT member_grade_changes_grade_id_to_fkey
        FOREIGN KEY (grade_id_to) REFERENCES grades (id) ON DELETE RESTRICT
);

CREATE INDEX member_grade_changes_member_created_idx
    ON member_grade_changes (member_id, created_at DESC, id DESC);

CREATE TABLE member_role_changes (
    id              BIGSERIAL       PRIMARY KEY,
    member_id       BIGINT          NOT NULL,
    role_id_from    SMALLINT,
    role_id_to      SMALLINT        NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT member_role_changes_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT,
    CONSTRAINT member_role_changes_role_id_from_fkey
        FOREIGN KEY (role_id_from) REFERENCES roles (id) ON DELETE RESTRICT,
    CONSTRAINT member_role_changes_role_id_to_fkey
        FOREIGN KEY (role_id_to) REFERENCES roles (id) ON DELETE RESTRICT
);

CREATE INDEX member_role_changes_member_created_idx
    ON member_role_changes (member_id, created_at DESC, id DESC);

CREATE TABLE member_graduation_changes (
    id                      BIGSERIAL       PRIMARY KEY,
    member_id               BIGINT          NOT NULL,
    graduation_year_from    SMALLINT,
    graduation_year_to      SMALLINT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT member_graduation_changes_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT,
    CONSTRAINT member_graduation_changes_from_check CHECK (
        graduation_year_from IS NULL
        OR graduation_year_from BETWEEN 2000 AND 2100
    ),
    CONSTRAINT member_graduation_changes_to_check CHECK (
        graduation_year_to IS NULL
        OR graduation_year_to BETWEEN 2000 AND 2100
    )
);

CREATE INDEX member_graduation_changes_member_created_idx
    ON member_graduation_changes (member_id, created_at DESC, id DESC);


-- attendance_sessions:
--   出入りのたびに1行。end_at IS NULL は在室中。
--   日次集計の境界は JST 0:00（アプリ側）。
CREATE TABLE attendance_sessions (
    id              BIGSERIAL       PRIMARY KEY,
    member_id       BIGINT          NOT NULL,
    start_at        TIMESTAMPTZ     NOT NULL,
    end_at          TIMESTAMPTZ,    -- NULL = 在室中（未退室）

    CONSTRAINT attendance_sessions_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT,
    CONSTRAINT attendance_sessions_time_check CHECK (
        end_at IS NULL OR end_at >= start_at
    )
);

-- 在室中セッションはメンバーごとに最大1件
CREATE UNIQUE INDEX attendance_sessions_one_open_per_member_idx
    ON attendance_sessions (member_id)
    WHERE end_at IS NULL;

-- メンバーの履歴・当日集計用
CREATE INDEX attendance_sessions_member_start_idx
    ON attendance_sessions (member_id, start_at DESC);

-- 日付範囲検索用（JST 日付への変換はアプリ側）
CREATE INDEX attendance_sessions_start_at_idx
    ON attendance_sessions (start_at);


-- work_sessions:
--   作業のたびに1行。end_at IS NULL は作業中。
--   v1 では location は常に 'lab'。

CREATE TYPE work_location AS ENUM ('lab', 'outside_lab');

CREATE TABLE work_sessions (
    id              BIGSERIAL       PRIMARY KEY,
    member_id       BIGINT          NOT NULL,
    location        work_location   NOT NULL DEFAULT 'lab',
    start_at        TIMESTAMPTZ     NOT NULL,
    end_at          TIMESTAMPTZ,

    CONSTRAINT work_sessions_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT,
    CONSTRAINT work_sessions_time_check CHECK (
        end_at IS NULL OR end_at >= start_at
    )
);

-- 作業中セッションはメンバーごとに最大1件
CREATE UNIQUE INDEX work_sessions_one_open_per_member_idx
    ON work_sessions (member_id)
    WHERE end_at IS NULL;

CREATE INDEX work_sessions_member_start_idx
    ON work_sessions (member_id, start_at DESC);

CREATE INDEX work_sessions_start_at_idx
    ON work_sessions (start_at);
