# Viper Royale backend

Отдельный Node.js backend для демо-арены Viper Royale. Он поднимает HTTP API и WebSocket-соединение для игровой комнаты: движение, боты, еда, ставки, цель выхода и 30-секундный cashout.

## Запуск

```bash
cp settings.example.json settings.json
npm run check
node server.cjs
```

По умолчанию сервер слушает `127.0.0.1:8765`. Для доступа в локальной сети используй `node server.cjs --lan`. На VPS можно задать `VIPER_HOST=0.0.0.0` и `VIPER_PORT=8765`. За Nginx включи WebSocket upgrade и проксируй запросы на этот порт.

Для отдельного фронтенда разреши его origin: `VIPER_ALLOWED_ORIGINS=https://username.github.io,http://localhost:5173`.

## HTTP endpoints

- `GET /local/config` — конфигурация демо.
- `GET /local/stats` — число комнат и игроков.
- `GET /local/media/skins` и `GET /local/media/backgrounds` — каталог ресурсов.
- `POST /local/profile` — проверить профиль перед стартом комнаты.
- `GET /local/network` — адреса для локальной сети.

## WebSocket

Клиент отправляет JSON `hello` с полями `name`, `skin_code` и `config`. Затем сервер отправляет `welcome`, снимки змей и еды, `local_status`, `leaderboard`, `border_state` и события cashout.

Входящие сообщения:

- `{"type":"input","dx":0.5,"dy":-0.2,"boost":true}`
- `{"type":"cashout"}`
- `{"type":"ping","t":...}`
- `{"type":"request_food_snapshot"}`

Игровой баланс и ставки являются локальной демо-экономикой. Платёжных операций и реальных криптокошельков в backend нет.

## Безопасность

Рабочий `settings.json`, пользовательские загрузки, SSH-ключи и пароли не должны попадать в GitHub. Используй `settings.example.json` как шаблон.
