# payments-platform

[![CI](https://github.com/vitorinoluca/payments-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/vitorinoluca/payments-platform/actions/workflows/ci.yml)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

🔗 **Demo (Swagger):** https://payments-platform-hrcm.onrender.com/api
> Plan free de Render: si nadie la usó en 15 min, el primer request tarda ~30s en despertar.

Mini plataforma de pagos P2P (estilo Wise/Venmo). Proyecto de portfolio enfocado en los problemas reales de un sistema de pagos: contabilidad de doble entrada, idempotencia, concurrencia, fraude y multi-moneda.

## Stack

NestJS, TypeScript, PostgreSQL (TypeORM), Redis, Socket.io, Docker Compose.

## Instalación

```bash
git clone https://github.com/vitorinoluca/payments-platform.git
cd payments-platform
cp .env.example .env
docker compose up -d
npm install
npm run start:dev   # http://localhost:3000
```

Docs interactivas (Swagger): `http://localhost:3000/api`

## Tests

```bash
npm run test        # unitarios
npm run test:e2e    # necesita Postgres y Redis levantados
```

## Características

- Ledger de doble entrada (sin floats)
- `POST /transfers` con lock pesimista + idempotencia (`Idempotency-Key`)
- Motor de fraude por reglas (monto, velocidad)
- Multi-moneda con tasas en vivo cacheadas en Redis
- Auth JWT (refresh rotation + detección de reuso) y 2FA (TOTP)
- Notificaciones por WebSocket y webhooks salientes firmados con HMAC
- Rate limiting y audit log

## Arquitectura

```
src/
  auth/       # login, JWT, 2FA
  ledger/     # entidades y endpoint de transferencias
  fraud/      # reglas de detección
  fx/         # tasas de cambio
  realtime/   # WebSockets
  webhooks/   # despacho de webhooks firmados
  audit/      # log de seguridad
```

<!-- TODO: agregar captura -->
