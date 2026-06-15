# Развертывание

Основная инструкция по публикации в GitHub и запуску проекта на другом ноутбуке находится в [GIT_AND_DEPLOYMENT.md](./GIT_AND_DEPLOYMENT.md).

Коротко:

1. Проект публикуется как три отдельных репозитория: backend, frontend и microservices.
2. `.env` не публикуется, на новом устройстве создается вручную из `.env.example`.
3. Сначала запускаются микросервисы, затем backend API, затем worker, затем frontend.
4. После настройки базы нужно выполнить `npm run prisma:deploy` и `npm run seed`.
