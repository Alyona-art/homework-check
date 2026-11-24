-- Демо-набор для отдельной локальной базы data/demo/homework.db.
-- Сначала запустите приложение с DATA_DIR=./data/demo, чтобы оно создало схему.
-- Повторный запуск этого файла не создаёт дубликаты.

BEGIN TRANSACTION;

INSERT INTO classes(name)
SELECT 'Демо 5А' WHERE NOT EXISTS (SELECT 1 FROM classes WHERE name = 'Демо 5А');
INSERT INTO classes(name)
SELECT 'Демо 5Б' WHERE NOT EXISTS (SELECT 1 FROM classes WHERE name = 'Демо 5Б');

WITH pupils(class_name, name) AS (
  VALUES
    ('Демо 5А', 'Иванова'),
    ('Демо 5А', 'Петрова'),
    ('Демо 5А', 'Соколова'),
    ('Демо 5Б', 'Смирнов'),
    ('Демо 5Б', 'Кузнецов'),
    ('Демо 5Б', 'Орлов')
)
INSERT OR IGNORE INTO children(class_id, name)
SELECT c.id, p.name FROM pupils p JOIN classes c ON c.name = p.class_name;

INSERT INTO works(title, date, task_count, variant_count, created_by)
SELECT 'Демо: проверка по математике', date('now'), 3, 2, 'Демо'
WHERE NOT EXISTS (
  SELECT 1 FROM works WHERE title = 'Демо: проверка по математике'
);

INSERT OR IGNORE INTO work_classes(work_id, class_id)
SELECT w.id, c.id
FROM works w JOIN classes c ON c.name IN ('Демо 5А', 'Демо 5Б')
WHERE w.id = (
  SELECT id FROM works WHERE title = 'Демо: проверка по математике' ORDER BY id LIMIT 1
);

WITH key_seed(variant, task_no, answer) AS (
  VALUES
    (1, 1, '5'), (1, 2, '12'), (1, 3, '3/4'),
    (2, 1, '6'), (2, 2, '10'), (2, 3, '1/2')
)
INSERT OR IGNORE INTO keys(work_id, variant, task_no, answer)
SELECT w.id, k.variant, k.task_no, k.answer
FROM works w CROSS JOIN key_seed k
WHERE w.id = (
  SELECT id FROM works WHERE title = 'Демо: проверка по математике' ORDER BY id LIMIT 1
);

WITH submission_seed(class_name, student_name, variant) AS (
  VALUES
    ('Демо 5А', 'Иванова', 1),
    ('Демо 5А', 'Петрова', 1),
    ('Демо 5Б', 'Смирнов', 2),
    ('Демо 5Б', 'Кузнецов', 2)
)
INSERT OR IGNORE INTO submissions(work_id, child_id, variant, submitted_at)
SELECT w.id, ch.id, s.variant, datetime('now')
FROM submission_seed s
JOIN classes c ON c.name = s.class_name
JOIN children ch ON ch.class_id = c.id AND ch.name = s.student_name
JOIN works w ON w.id = (
  SELECT id FROM works WHERE title = 'Демо: проверка по математике' ORDER BY id LIMIT 1
);

WITH answer_seed(class_name, student_name, task_no, answer) AS (
  VALUES
    ('Демо 5А', 'Иванова', 1, '5'),
    ('Демо 5А', 'Иванова', 2, '12'),
    ('Демо 5А', 'Иванова', 3, '3/4'),
    ('Демо 5А', 'Петрова', 1, '5'),
    ('Демо 5А', 'Петрова', 2, '11'),
    ('Демо 5Б', 'Смирнов', 1, '6'),
    ('Демо 5Б', 'Смирнов', 2, '10'),
    ('Демо 5Б', 'Смирнов', 3, '1/2'),
    ('Демо 5Б', 'Кузнецов', 1, '7'),
    ('Демо 5Б', 'Кузнецов', 2, '10'),
    ('Демо 5Б', 'Кузнецов', 3, '1/2')
)
INSERT OR IGNORE INTO answers(submission_id, task_no, answer)
SELECT s.id, a.task_no, a.answer
FROM answer_seed a
JOIN classes c ON c.name = a.class_name
JOIN children ch ON ch.class_id = c.id AND ch.name = a.student_name
JOIN submissions s ON s.child_id = ch.id AND s.work_id = (
  SELECT id FROM works WHERE title = 'Демо: проверка по математике' ORDER BY id LIMIT 1
);

COMMIT;
