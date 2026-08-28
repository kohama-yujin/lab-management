-- lab-management PostgreSQL スキーマ
--
-- マスタ:
--   roles  … 権限（一般・管理者）。将来の管理機能用
--   grades … 学年マスタ（表示順の唯一の定義元。）
--
-- attendance_sessions:
--   出入りのたびに1行。end_at IS NULL は在室中。
--   日次集計の境界は JST 0:00（アプリ側）。

CREATE TABLE roles (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(32)     NOT NULL,
    name            VARCHAR(64)     NOT NULL,
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
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT members_username_unique UNIQUE (username),
    CONSTRAINT members_role_id_fkey
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT,
    CONSTRAINT members_grade_id_fkey
        FOREIGN KEY (grade_id) REFERENCES grades (id) ON DELETE RESTRICT
);

CREATE INDEX members_role_id_idx ON members (role_id);
CREATE INDEX members_grade_id_idx ON members (grade_id);


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
