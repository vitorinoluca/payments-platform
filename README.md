# payments-platform

Mini plataforma de pagos P2P (estilo Wise/Venmo). Proyecto de portfolio enfocado en los problemas reales de un sistema de pagos: contabilidad de doble entrada, idempotencia, concurrencia, fraude y multi-moneda.

## Stack

NestJS, TypeScript, PostgreSQL (TypeORM), Redis, Socket.io, Docker Compose.

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run start:dev   # http://localhost:3000
```

## Tests

```bash
npm run test        # unitarios
npm run test:e2e    # necesita Postgres y Redis levantados
```

## Features

- Ledger de doble entrada (sin floats)
- `POST /transfers` con lock pesimista + idempotencia (`Idempotency-Key`)
- Motor de fraude por reglas (monto, velocidad)
- Multi-moneda con tasas en vivo cacheadas en Redis
- Auth JWT (refresh rotation + detección de reuso) y 2FA (TOTP)
- Notificaciones por WebSocket y webhooks salientes firmados con HMAC
- Rate limiting y audit log

## Estructura

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
