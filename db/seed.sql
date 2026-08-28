-- 初期マスタデータ（schema.sql 適用後に実行）
-- grades の code / sort_order が学年表示順の唯一の定義元になる。

INSERT INTO roles (code, name) VALUES
    ('member', '一般'),
    ('admin', '管理者');

INSERT INTO grades (code, sort_order) VALUES
    ('Teacher', 1),
    ('M2', 2),
    ('M1', 3),
    ('B4', 4),
    ('other', 5);
