# Цифровой Наблюдатель: backend

Backend-часть дипломного проекта «Разработка веб-приложения для мониторинга состояния микросервисной архитектуры с системой оповещений».

Стек: **NestJS**, **TypeScript**, **Prisma ORM**, **PostgreSQL**, **Redis/Upstash**, **JWT**, **Resend**, **Telegram Bot API**, **Web Push**, **S3/Yandex Object Storage**.

## Назначение

Backend отвечает за:

- регистрацию, вход, refresh tokens, роли и подтверждение email;
- изоляцию данных пользователей;
- CRUD микросервисов и зависимостей;
- health/liveness/readiness проверки;
- сбор метрик CPU, RAM, диска, ошибок, запросов и времени ответа;
- автоматическое создание инцидентов;
- правила уведомлений и отправку Email, Telegram, Web Push, Webhook и Max beta;
- SLA/SLO, отчеты PDF/XLSX/CSV и загрузку файлов в S3-хранилище;
- журнал аудита, диагностику интеграций и демо-сценарии;
- отдельный worker-процесс для фонового мониторинга.

## Требования

- Node.js 20+
- PostgreSQL 14+
- npm
- доступ к Redis/Upstash, Resend, Telegram и S3 нужен только для соответствующих интеграций

## Установка

```powershell
cd C:\Users\denla\Documents\incidents64-backend
npm install
Copy-Item .env.example .env
```

После этого заполните `.env`. Реальный `.env` не коммитится в Git.

Минимум для локального запуска:

```env
PORT=4000
FRONTEND_URL=http://localhost:5173
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/digital_observer?schema=public"
JWT_ACCESS_SECRET=replace_with_long_random_secret
JWT_REFRESH_SECRET=replace_with_long_random_secret
RUN_WORKER_IN_API=false
NOTIFICATIONS_REQUIRE_REDIS=false
STORAGE_REQUIRE_S3=false
```

## База данных

Создайте базу PostgreSQL `digital_observer`, затем выполните:

```powershell
npm run prisma:generate
npm run prisma:deploy
npm run seed
```

Seed создает администратора:

```text
Email: admin@incidents64.fun
Password: Admin12345!
```

После защиты пароль лучше сменить.

## Запуск

API:

```powershell
npm run start:dev:clean
```

Worker:

```powershell
npm run worker:dev
```

Swagger:

```text
http://localhost:4000/api/docs
```

## Полезные команды

```powershell
npm run build
npm test
npm run prisma:deploy
npm run seed
npm run microservices:register
npm run api:smoke
```

## Порядок запуска всего стенда

1. Запустить локальные микросервисы из репозитория `incidents64-microservices`.
2. Запустить backend API.
3. Запустить backend worker.
4. Запустить frontend из репозитория `incidents64-frontend`.
5. Войти в приложение и добавить/зарегистрировать микросервисы.

Подробная инструкция для GitHub и запуска на другом ноутбуке находится в [GIT_AND_DEPLOYMENT.md](./GIT_AND_DEPLOYMENT.md).

## Важно перед публикацией

- Не коммитить `.env`, логи, `uploads`, `dist`, `node_modules`.
- Реальные токены Telegram, Resend, Upstash и Yandex Object Storage хранить только в `.env` или переменных окружения хостинга.
- Если токены когда-либо показывались в чате, презентации или скриншоте, лучше перевыпустить их перед публичной публикацией.
