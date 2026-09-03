-- 初期マスタデータ（schema.sql 適用後に実行）
-- grades の code / sort_order が学年表示順の唯一の定義元になる。

INSERT INTO roles (code, name, sort_order) VALUES
    ('admin', '管理者', 1),
    ('member', '一般', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO grades (code, sort_order) VALUES
    ('Teacher', 0),
    ('D3', 1),
    ('D2', 2),
    ('D1', 3),
    ('M2', 4),
    ('M1', 5),
    ('B4', 6),
    ('B3', 7),
    ('B2', 8),
    ('B1', 9),
    ('other', 10)
ON CONFLICT (code) DO NOTHING;