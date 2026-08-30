-- 初期マスタデータ（schema.sql 適用後に実行）
-- grades の code / sort_order が学年表示順の唯一の定義元になる。

INSERT INTO roles (code, name) VALUES
    ('member', '一般'),
    ('admin', '管理者')
ON CONFLICT (code) DO NOTHING;

INSERT INTO grades (code, sort_order) VALUES
    ('Teacher', 1),
    ('D3', 2),
    ('D2', 3),
    ('D1', 4),
    ('M2', 5),
    ('M1', 6),
    ('B4', 7),
    ('B3', 8),
    ('B2', 9),
    ('B1', 10),
    ('other', 11)
ON CONFLICT (code) DO NOTHING;
