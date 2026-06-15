# Публикация в GitHub и запуск на другом ноутбуке

Проект разбит на три независимых репозитория:

- `incidents64-backend` — NestJS API, Prisma, worker, уведомления, отчеты;
- `incidents64-frontend` — React/Vite интерфейс;
- `incidents64-microservices` — локальный стенд микросервисов для демонстрации.

## 1. Что не должно попадать в Git

В репозитории не коммитятся:

- `.env` и любые локальные секреты;
- `node_modules`;
- `dist`;
- `uploads`;
- `logs`;
- `*.log`;
- `test-results`;
- `playwright-report`.

На GitHub должны попадать только `.env.example` и `.env.production.example`.

## 2. Инициализация трех репозиториев

Backend:

```powershell
cd C:\Users\denla\Documents\incidents64-backend
git init
git add .
git commit -m "Initial backend commit"
git branch -M main
git remote add origin https://github.com/YOUR_LOGIN/incidents64-backend.git
git push -u origin main
```

Frontend:

```powershell
cd C:\Users\denla\Documents\incidents64-frontend
git init
git add .
git commit -m "Initial frontend commit"
git branch -M main
git remote add origin https://github.com/YOUR_LOGIN/incidents64-frontend.git
git push -u origin main
```

Microservices:

```powershell
cd C:\Users\denla\Documents\incidents64-microservices
git init
git add .
git commit -m "Initial microservices commit"
git branch -M main
git remote add origin https://github.com/YOUR_LOGIN/incidents64-microservices.git
git push -u origin main
```

Перед `git remote add origin` нужно создать три пустых репозитория на GitHub.

## 3. Подготовка нового ноутбука

Установить:

- Git;
- Node.js 20+;
- PostgreSQL 14+;
- любой редактор, например VS Code.

Проверка:

```powershell
git --version
node -v
npm -v
psql --version
```

## 4. Клонирование

```powershell
cd C:\Users\denla\Documents
git clone https://github.com/YOUR_LOGIN/incidents64-backend.git
git clone https://github.com/YOUR_LOGIN/incidents64-frontend.git
git clone https://github.com/YOUR_LOGIN/incidents64-microservices.git
```

## 5. Настройка backend

```powershell
cd C:\Users\denla\Documents\incidents64-backend
npm install
Copy-Item .env.example .env
```

Заполнить `.env`. Минимум для локальной демонстрации:

```env
PORT=4000
FRONTEND_URL=http://localhost:5173
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/digital_observer?schema=public"
JWT_ACCESS_SECRET=replace_with_long_random_secret
JWT_REFRESH_SECRET=replace_with_long_random_secret
NOTIFICATIONS_REQUIRE_REDIS=false
STORAGE_REQUIRE_S3=false
RUN_WORKER_IN_API=false
```

Создать базу PostgreSQL:

```powershell
createdb -U postgres digital_observer
```

Применить миграции:

```powershell
npm run prisma:generate
npm run prisma:deploy
npm run seed
```

## 6. Настройка frontend

```powershell
cd C:\Users\denla\Documents\incidents64-frontend
npm install
Copy-Item .env.example .env
```

`.env`:

```env
VITE_API_URL=http://localhost:4000/api
```

## 7. Настройка микросервисов

```powershell
cd C:\Users\denla\Documents\incidents64-microservices
npm install
```

## 8. Правильный порядок запуска

Открыть 4 терминала.

Терминал 1 — микросервисы:

```powershell
cd C:\Users\denla\Documents\incidents64-microservices
npm run start:clean
```

Терминал 2 — backend API:

```powershell
cd C:\Users\denla\Documents\incidents64-backend
npm run start:dev:clean
```

Терминал 3 — worker:

```powershell
cd C:\Users\denla\Documents\incidents64-backend
npm run worker:dev
```

Терминал 4 — frontend:

```powershell
cd C:\Users\denla\Documents\incidents64-frontend
npm run dev
```

Открыть:

```text
http://localhost:5173
```

Swagger:

```text
http://localhost:4000/api/docs
```

## 9. Первый вход

После `npm run seed` доступен администратор:

```text
Email: admin@incidents64.fun
Password: Admin12345!
```

После входа можно:

1. Запустить локальные микросервисы.
2. Открыть раздел «Микросервисы».
3. Добавить сервисы по адресам `http://localhost:4101`, `http://localhost:4102` и так далее.
4. Запустить worker и дождаться появления метрик, инцидентов и SLA.

## 10. Проверка перед защитой

Backend:

```powershell
cd C:\Users\denla\Documents\incidents64-backend
npm run build
npm test
```

Frontend:

```powershell
cd C:\Users\denla\Documents\incidents64-frontend
npm run build
```

Microservices:

```powershell
cd C:\Users\denla\Documents\incidents64-microservices
npm run check
```

## 11. Если порт занят

Backend:

```powershell
npm run start:dev:clean
```

Microservices:

```powershell
npm run stop
npm start
```

Frontend:

```powershell
netstat -ano | findstr :5173
taskkill /PID PID_ИЗ_КОМАНДЫ /F
npm run dev
```

## 12. Секреты

Реальные ключи Telegram, Resend, Upstash, Yandex Object Storage и VAPID нельзя хранить в GitHub. Их нужно перенести на новый ноутбук вручную в `.env` или заново создать в сервисах.
