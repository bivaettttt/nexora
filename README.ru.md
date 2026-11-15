# Nexora · Платформа интеграции корпоративных систем

[English](README.en.md)

Nexora — учебный кейс по обмену данными между независимыми приложениями. CRM владеет профилем клиента, ERP хранит контрагента, Billing ведёт договор и статус оплаты. Оператор видит, что доставлено, где произошёл отказ и какую операцию можно повторить.

## Запуск

```sh
docker compose up --build
```

Откройте [консоль](http://127.0.0.1:8090). Локальные ключи доступа: `nexora-local-viewer`, `nexora-local-operator`, `nexora-local-admin`. Compose применяет миграции, добавляет три синтетических CRM-профиля и доставляет их в целевые системы. Порт и ключи консоли можно задать в [.env.example](.env.example). Web публикуется только на loopback.

Для экспериментов поднимите отдельный Compose-проект:

```sh
scripts/lab up
```

Лаборатория доступна администратору на [8091](http://127.0.0.1:8091). Она использует отдельные контейнеры, сети и тома. `scripts/lab down` останавливает её. `scripts/lab reset` удаляет данные лаборатории. `docker compose down -v` удаляет данные основного локального стенда.

## Обмен и устойчивость

1. CRM фиксирует профиль и Outbox одной транзакцией. Relay публикует событие в RabbitMQ и отмечает отправку после publisher confirm.
2. Worker валидирует событие v1, регистрирует Inbox и создаёт по доставке на цель. RabbitMQ получает ack после commit.
3. Worker преобразует профиль в SOAP XML для ERP и JSON для Billing. Потоки целей независимы.
4. Получатели сравнивают версии. Повтор той же версии с теми же полями возвращает `SAME`, устаревшая версия — `STALE`. Billing публикует оплату только для CRM.
5. Временный отказ планирует до четырёх попыток с exponential backoff и jitter. Исчерпанные доставки и отклонённые события видны в PostgreSQL-карантине. Повтор доставки сохраняет старые попытки.
6. Сверка читает реальные REST/SOAP-проекции. Восстановление отстающего или отсутствующего профиля повторно публикует актуальную версию CRM. Версионные проверки действуют и при восстановлении.

Четыре приложения используют отдельные базы и роли PostgreSQL. Nexora API и Worker разделяют свою БД. Стек: Python, FastAPI, Pydantic, SQLAlchemy, Alembic, RabbitMQ, React, TypeScript, Vite и nginx. Код Python находится в `nexora/`, миграции в `migrations/`, консоль и браузерные тесты в `frontend/`, контракты и аналитика в `docs/`.

[Требования](docs/analysis/mvp.md) · [Архитектура и диаграммы](docs/architecture/design.md) · [REST, WSDL/XSD и AsyncAPI](docs/integrations/contracts.md) · [Матрица трассируемости](docs/testing/traceability.md)

## Как показать

Создайте клиента в разделе **Клиенты CRM**, откройте событие и сравните трансформации ERP и Billing. Запишите оплату и найдите доставку в CRM. В лаборатории отключите ответы ERP, создайте клиента и дождитесь четырёх попыток ERP. Billing завершит доставку независимо. Включите ERP, откройте доставку из DLQ и подтвердите повтор. Покажите две серии попыток с одним Delivery ID и запустите сверку. Если после команды оплаты ответ потерян, проверьте события клиента и сверку перед следующим действием.

[Описание редизайна](docs/ux-ui-redesign.md) · [Матрица приёмки](docs/testing/ux-acceptance.md)

[Workbench](assets/screenshots/workbench.png) · [Журнал сообщений](assets/screenshots/messages.png) · [Успешная доставка](assets/screenshots/successful-delivery.png) · [Частичная доставка](assets/screenshots/partial-delivery.png) · [Хронология](assets/screenshots/timeline.png) · [Повторы](assets/screenshots/retry-details.png) · [DLQ](assets/screenshots/dlq.png) · [Восстановление](assets/screenshots/recovery.png) · [Транспорт и бизнес](assets/screenshots/stale-result.png) · [Разбор ошибки](assets/screenshots/error-inspector.png) · [Архитектура](assets/screenshots/routes.png) · [SOAP и данные](assets/screenshots/payload-inspector.png) · [Сводка](assets/screenshots/dashboard.png) · [Мобильная версия](assets/screenshots/mobile-trace.png) · [Неопределённый результат оплаты](assets/screenshots/uncertain-payment.png) · [Лаборатория](assets/screenshots/lab.png) · [Сверка](assets/screenshots/reconciliation.png)

## Качество и границы

В [отчёте](docs/testing/results.md) приведены команды и результаты pytest, интеграционных испытаний, тестов восстановления и Playwright. Исполняемый процесс CI хранится в [Quality](.github/workflows/quality.yml). [Состояние проекта](docs/PROJECT_STATUS.md)

Гарантия обмена — at-least-once с устойчивой дедупликацией и версионными проекциями. DLQ реализована в PostgreSQL, RabbitMQ используется для транспорта. Сырой некорректный payload заменяется диагностическими метаданными. Ключи доступа локальные и общие для роли, данные учебные. При сетевом развёртывании понадобятся индивидуальные учётные записи, TLS и политика хранения. Дальнейшее развитие: потоковая сверка по набору клиентов, отдельные ключи сервисов, хранение истории по регламенту и нагрузочные испытания.
