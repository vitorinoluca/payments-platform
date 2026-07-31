# payments-platform

Mini plataforma de pagos P2P (estilo Wise/Venmo) con motor de liquidación en tiempo real. Hecha como proyecto de portfolio, con foco en los problemas reales de un sistema de pagos: contabilidad de doble entrada, idempotencia, concurrencia, fraude y multi-moneda.

## Stack

- NestJS + TypeScript
- PostgreSQL 16 (TypeORM)
- Redis 7
- Socket.io para notificaciones en tiempo real
- Docker Compose para levantar Postgres y Redis en local

## Requisitos

- Node 20+
- Docker

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run start:dev
```

El server queda en `http://localhost:3000`.

## Tests

```bash
npm run test        # unitarios
npm run test:cov    # unitarios con coverage
npm run test:e2e    # e2e, necesita Postgres y Redis levantados
```

## Qué tiene

- Ledger de doble entrada (Account, Transaction, LedgerEntry), sin floats
- `POST /transfers` con lock (`SELECT ... FOR UPDATE`) e idempotencia obligatoria vía header `Idempotency-Key`
- Motor de fraude por reglas (monto alto, velocidad) que retiene la transferencia sin mover plata
- Multi-moneda con tasas de cambio en vivo (open.er-api.com, cacheadas en Redis)
- Auth con JWT + refresh tokens (con rotación y detección de reuso) y 2FA (TOTP)
- Notificaciones en tiempo real por WebSocket y webhooks salientes firmados con HMAC
- Rate limiting y audit log de eventos de seguridad

## Estructura

```
src/
  auth/       # login, JWT, refresh tokens, 2FA
  ledger/     # entidades del ledger y el endpoint de transferencias
  fraud/      # reglas de detección
  fx/         # tasas de cambio
  realtime/   # gateway de WebSockets
  webhooks/   # despacho de webhooks firmados
  audit/      # log de eventos de seguridad
```

Más detalle de las decisiones de arquitectura en `CLAUDE.md`.
