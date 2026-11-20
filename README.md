# Проверка работ

Учитель создаёт классы и работы, заполняет эталонные ответы. Ученик входит по фамилии, выбирает вариант и сдаёт работу. Результаты: зелёный — совпало, красный — нет, жёлтый — не делал, белый — не сдавал. Есть итоги по ученику и по заданию, выгрузка в Excel.

## Ссылки (продакшен)

- Учителя: https://homework-check.shkola-krasnogorskaya.ru/teacher
- Ученики: https://homework-check.shkola-krasnogorskaya.ru/student

Локально без пути: `http://localhost:3001` (выбор роли) или `/teacher` / `/student`.

## Запуск локально

Нужен **Node.js 22.5+** (встроенный `node:sqlite`).

```bash
cp .env.example .env   # TEACHER_CODE, SECRET, PORT=3001
npm install
set -a && source .env && set +a
npm start              # http://localhost:3001
```

- **Учитель:** ФИО + `TEACHER_CODE` → классы, работы, ответы, результаты.
- **Ученик:** фамилия из списка (без кода) → свои работы → вариант → ответы. После сдачи менять нельзя.

## Деплой на VPS

Сервер: `root@195.133.199.57` (тот же, что у attendance).  
Прокси: **Caddy** (`/etc/caddy/Caddyfile`), приложение на порту **3001**.

### С Mac — отправить код

```bash
cd "/Users/alyonaartemeva/Frontend Projects/homework-check"
tar czf /tmp/homework-check.tgz --exclude node_modules --exclude data --exclude .env .
scp /tmp/homework-check.tgz root@195.133.199.57:/tmp/
```

### На сервере — первый раз

```bash
mkdir -p /opt/homework-check && cd /opt/homework-check
tar xzf /tmp/homework-check.tgz
npm install
cp .env.example .env
nano .env   # TEACHER_CODE, SECRET, PORT=3001

set -a && source .env && set +a
nohup node server.js > /tmp/homework-check.log 2>&1 &
```

В Caddyfile добавить (если ещё нет):

```caddy
homework-check.shkola-krasnogorskaya.ru {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

DNS: A-запись `homework-check` → `195.133.199.57` (не на IP Бегета).

### Обновление кода

```bash
# Mac
tar czf /tmp/homework-check.tgz --exclude node_modules --exclude data --exclude .env .
scp /tmp/homework-check.tgz root@195.133.199.57:/tmp/

# сервер
ssh root@195.133.199.57
cd /opt/homework-check
tar xzf /tmp/homework-check.tgz
# не трогать data/ и .env
kill $(lsof -t -i:3001) 2>/dev/null || true
set -a && source .env && set +a
nohup node server.js > /tmp/homework-check.log 2>&1 &
exit
```

## SSH с другого ноутбука

Да, можно — нужен доступ по SSH-ключу (или паролю) к `root@195.133.199.57`.

1. На новом Mac сгенерировать ключ (если нет): `ssh-keygen -t ed25519`
2. На **текущем** ноуте, где SSH уже работает, добавить публичный ключ нового ноута на сервер:

```bash
# скопировать содержимое ~/.ssh/id_ed25519.pub с нового ноута, затем на сервере:
ssh root@195.133.199.57
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ВСТАВИТЬ_СЮДА_ПУБЛИЧНЫЙ_КЛЮЧ' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Или одной командой с нового ноута (если знаете пароль root):  
`ssh-copy-id root@195.133.199.57`

После этого: `ssh root@195.133.199.57`.

Репозиторий с GitHub/другим remote к SSH не привязан — код на сервер кладётся через `scp`/`tar`, как выше.
