# Plan de Tareas Atómicas: EateryFlow (SaaS Multitenant)

Este documento contiene el backlog ordenado de tareas para el desarrollo de EateryFlow en una semana. Está dividido entre el trabajo síncrono local (Antigravity) y el asíncrono en GitHub (Jules).

---

## Parte 1: Backlog de Antigravity (Trabajo Síncrono Local)

*Instrucción: Ejecutar una tarea a la vez. No avanzar hasta que `npm run build` pase sin errores.*

### Bloque 1: Infraestructura y Base de Datos (Día 1)
- [ ] **AG-01: Setup del Proyecto**
  - Inicializar Next.js (App Router, TS), instalar dependencias (`@prisma/client`, `zod`, `jose`, `bcryptjs`, `qrcode.react`, `@google/genai`, `lucide-react`, `sonner`, `react-markdown`, `vitest`).
  - Crear `src/core/config/env.ts` (Zod) y `.env`.
- [ ] **AG-02: Introspección Prisma**
  - Configurar `DIRECT_URL` en `.env`.
  - Correr `npx prisma db pull` y `npx prisma generate` sobre el schema `public` y `tenant_template`.
  - Crear el singleton en `src/core/db/prisma.ts`.
- [ ] **AG-03: Contexto Multitenant (`withTenant`)**
  - Implementar `src/core/db/tenant-context.ts` con `prisma.$transaction` y `SET LOCAL search_path`.

### Bloque 2: Capa Transversal - Seguridad y Robustez (Día 2)
- [ ] **AG-04: Módulo de Sesión y JWT**
  - Implementar `src/core/auth/jwt.ts` (usando `jose`) y gestión de cookie `httpOnly`.
- [ ] **AG-05: Proxy Borde (`proxy.ts`)**
  - Proteger `/admin` (solo ADMIN), `/pos` (solo WAITER) y `/cocina` (solo CHEF). Redirigir a `/login` si no hay sesión.
- [ ] **AG-06: Rate Limiting**
  - Implementar `src/core/http/rate-limiter.ts` (Sliding Window o Token Bucket). Devolver `429` y `Retry-After`.
- [ ] **AG-07: Idempotencia**
  - Implementar `src/core/http/idempotency.ts` leyendo/guardando en `public.idempotency_keys` (TTL 24h).
- [ ] **AG-08: Route Handler Central (`createApiHandler`)**
  - Unificar auth, limitador, idempotencia y validación Zod en `src/core/http/api-handler.ts`.

### Bloque 3: Onboarding y Autenticación (Día 3)
- [ ] **AG-09: Registro Multitenant**
  - `POST /api/auth/register` (Idempotente, Rate Limit IP). Inserta tenant, usuario, llama a `public.create_tenant_schema` y emite cookie.
- [ ] **AG-10: Login y Gestión de Staff**
  - `POST /api/auth/login` (Rate Limit IP) y `POST /api/auth/logout`.
  - Endpoints ADMIN para gestionar `public.users` (meseros y cocineros).

### Bloque 4: Operación del Restaurante (Días 4 y 5)
- [ ] **AG-11: Máquina de Estados de Comandas (`orders`)**
  - Crear comanda (`ABIERTO`), actualizar cantidades absolutas.
  - "Enviar a cocina": `POST /api/orders/[id]/send` (Idempotente, marca `sent_to_kitchen_at`).
  - Cambios de estado por Chef (`LISTO`) y Mesero (`ENTREGADO`).
- [ ] **AG-12: Cobro Unificado de Mesas (`tables`)**
  - `POST /api/tables/[id]/checkout` (Idempotente).
  - Validar que no haya comandas `ABIERTO` o `EN_COCINA`.
  - Unificar comandas `ENTREGADO`, marcar `PAGADO`, generar `qr_token` y lote de pago.
- [ ] **AG-13: Encuesta Pública con QR**
  - `GET` y `POST /api/surveys/public/[slug]/[qr]` (Sin sesión, Rate Limit IP). Valida y guarda respuestas.

### Bloque 5: IA e Interfaces (Día 6)
- [ ] **AG-14: Integración Gemini (Informes IA)**
  - `POST /api/ai-reports` (Rate Limit Tenant). Consulta métricas de pedidos `PAGADO` y encuestas. Retorna Markdown.
- [ ] **AG-15: Conexión de UI (Renderizado)**
  - Asegurar páginas CSR (POS, Cocina), SSR (Dashboard, Encuesta) y SSG (Landing).

---
