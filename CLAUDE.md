# payments-platform

Plataforma de pagos P2P con motor de liquidación en tiempo real, construida como proyecto de portfolio para demostrar dominio de arquitectura fintech real.

## Qué es esto

Una mini versión de Wise/Venmo que implementa los problemas de ingeniería reales de un sistema de pagos:

- Contabilidad de doble entrada (double-entry ledger)
- Idempotencia en la API de transferencias
- Detección de fraude con reglas en tiempo real
- Notificaciones en tiempo real vía WebSockets
- Webhooks salientes firmados con HMAC
- Multi-moneda con tasas de cambio en vivo

## Stack

- **Backend**: NestJS + TypeScript
- **DB**: PostgreSQL 16 (vía TypeORM)
- **Cache / pub-sub**: Redis 7
- **Tiempo real**: WebSockets (Socket.io) + Redis adapter
- **Frontend** (fuera de este repo o en `/frontend`): React + TypeScript, TanStack Query, Recharts
- **Infra local**: Docker Compose

## Principios de arquitectura (no romper esto)

1. **El dinero nunca se guarda como float.** Todo monto se guarda como entero en la unidad mínima de la moneda (`amountMinorUnits`, centavos). Los floats pierden precisión y en un sistema de pagos eso es un bug crítico, no cosmético.

2. **Doble entrada siempre.** Ninguna transacción mueve plata "restando de una cuenta y sumando a otra" directo. Cada movimiento genera al menos dos `ledger_entries` (un débito y un crédito) dentro de la misma transacción de base de datos. El balance de una cuenta es la suma de sus entries, no un campo que se edita libremente.

3. **Idempotencia obligatoria en mutaciones de dinero.** Todo endpoint que mueve plata requiere un header `Idempotency-Key`. Si la clave ya se procesó, se devuelve la respuesta cacheada, nunca se re-ejecuta la operación.

4. **Transacciones atómicas con locks.** Las operaciones sobre cuentas usan `SELECT ... FOR UPDATE` dentro de una transacción de Postgres para evitar condiciones de carrera. Cualquier cambio a este código necesita un test de concurrencia (ver sección Testing).

5. **Los estados intermedios son ciudadanos de primera clase.** Una transacción puede quedar `pending`, `flagged` (retenida por el motor de fraude) o `completed`. El frontend y la API tienen que poder representar y comunicar estos estados, no asumir que todo es síncrono éxito/error.

## Estructura de carpetas

```
src/
  auth/          # JWT, refresh tokens, 2FA
  ledger/        # entidades core: accounts, transactions, ledger_entries
  fraud/         # motor de reglas de detección
  realtime/      # gateway de WebSockets
  webhooks/      # despacho de webhooks salientes firmados
  common/        # guards, interceptors, decorators compartidos
```

## Comandos

```bash
docker compose up -d          # levanta Postgres y Redis
npm run start:dev             # corre NestJS en modo watch
npm run test                  # unit tests
npm run test:e2e              # tests end-to-end
```

## Testing

- Todo cambio al motor de ledger necesita un test que dispare transferencias concurrentes sobre la misma cuenta y verifique que el balance final es correcto. Esto es más importante que cobertura de líneas.
- Los tests de idempotencia deben verificar que llamar dos veces al mismo endpoint con la misma `Idempotency-Key` no duplica el efecto.

## Estado actual / roadmap

- [x] Setup del proyecto, Docker Compose (Postgres + Redis)
- [x] Entidades del ledger (Account, Transaction, LedgerEntry)
- [x] Endpoint único end-to-end de transferencia (sin auth, sin fraude, sin realtime)
- [x] Test de concurrencia sobre el ledger
- [x] Auth (JWT + refresh tokens)
- [x] Idempotencia en el gateway
- [x] Motor de fraude (reglas)
- [x] WebSockets para notificaciones en vivo
- [x] Webhooks salientes con firma HMAC
- [x] Multi-moneda con tasas de cambio en vivo
- [x] 2FA, rate limiting, audit logs
- [ ] Deploy (Railway / Fly.io) + documentación pública de la API

## Notas para Claude Code

- Priorizá correctitud del modelo de ledger sobre velocidad de desarrollo. Este proyecto existe para demostrar criterio de ingeniería, no para shippear rápido.
- Cuando agregues un endpoint que mueve dinero, siempre preguntate: ¿esto es idempotente? ¿esto corre dentro de una transacción con lock? ¿qué pasa si se llama dos veces en simultáneo?
- El README del proyecto (separado de este archivo) debe explicar las decisiones de arquitectura para quien lo lea como parte de un portfolio — no solo el "qué" sino el "por qué".
