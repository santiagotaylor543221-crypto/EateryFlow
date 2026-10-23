# Especificación de Arquitectura del Proyecto (Contexto para Antigravity)

## 1. Visión Arquitectónica
Este proyecto es un **SaaS Multitenant para Restaurantes** construido en **Next.js (App Router - Opción B)** con **PostgreSQL (Schema-per-Tenant)** y **Prisma ORM**[cite: 2, 3].
Aplicamos el principio de **Separación de Responsabilidades (SoC)** mediante una **Arquitectura Modular por Capas**[cite: 6].

---

## 2. Reglas Estrictas de Ingeniería (Inquebrantables)
1. **Cero lógica de base de datos en la capa HTTP:** Los archivos `route.ts` y `page.tsx` jamás importan `prisma` directamente. Solo llaman a los servicios de `src/modules/*/*.service.ts`.
2. **Aislamiento Multitenant Obligatorio:** Ninguna consulta a las tablas del restaurante (`tables`, `products`, `orders`, `order_items`, `surveys`, `ai_reports_cache`) puede ejecutarse fuera del wrapper `withTenant(schemaName, async (tx) => { ... })` ubicado en `src/core/db/tenant-context.ts`[cite: 3].
3. **Uso de `src/proxy.ts` (Next.js 16+):** No usar `middleware.ts`. Toda la protección de rutas de navegación y redirección por rol (`ADMIN`, `WAITER`, `CHEF`) se centraliza en `src/proxy.ts` verificando la cookie `httpOnly` con la librería `jose`[cite: 3, 5].
4. **Prohibido `localStorage` para sesión:** El JWT vive exclusivamente en una cookie `httpOnly`, `SameSite=Lax`, `Secure` (en producción)[cite: 3].
5. **Modelo de IA en Variable de Entorno:** El nombre del modelo de Gemini se lee siempre desde `process.env.GEMINI_MODEL`[cite: 5].

---

## 3. Estructura de Directorios Objetivo

```text
src/
├── proxy.ts                          # Guardia de borde (Next.js Proxy): valida JWT y redirige según rol
├── app/
│   ├── (public)/
│   │   ├── page.tsx                  # Landing comercial del SaaS [SSG]
│   │   ├── login/page.tsx            # Inicio de sesión [CSR]
│   │   ├── register/page.tsx         # Registro de nuevo restaurante (Onboarding) [CSR]
│   │   └── encuesta/[slug]/[qr]/     # Encuesta pública para el comensal [SSR]
│   ├── (protected)/
│   │   ├── admin/                    # Rutas exclusivas ADMIN (menú, mesas, empleados, encuestas, IA) [SSR/CSR]
│   │   ├── pos/                      # Ruta exclusiva WAITER (mapa de mesas, comandas, cobro y QR) [CSR]
│   │   └── cocina/                   # Ruta exclusiva CHEF (cola FIFO de comandas con alertas) [CSR]
│   └── api/
│       ├── auth/                     # POST register, login, logout | GET me
│       ├── users/                    # GET, POST, PATCH empleados (ADMIN)
│       ├── tables/                   # CRUD mesas + cobro unificado POST /api/tables/[id]/checkout
│       ├── products/                 # CRUD productos
│       ├── orders/                   # CRUD comandas + cambios de estado (send-to-kitchen, ready, deliver)
│       ├── surveys/                  # POST público (con QR) + GET, PATCH, DELETE (ADMIN)
│       └── ai-reports/               # POST generación de informe con Gemini (ADMIN)
├── core/
│   ├── config/
│   │   └── env.ts                    # Validación de variables de entorno con Zod
│   ├── db/
│   │   ├── prisma.ts                 # Instancia singleton de PrismaClient
│   │   └── tenant-context.ts         # Función `withTenant(schemaName, callback)` con SET LOCAL search_path
│   ├── auth/
│   │   ├── jwt.ts                    # signJwt() y verifyJwt() con `jose`
│   │   └── cookies.ts                # setAuthCookie(), clearAuthCookie(), getSessionFromCookie()
│   ├── http/
│   │   ├── api-handler.ts            # Wrapper central para Route Handlers (Auth + RateLimit + Idempotency + Error)
│   │   ├── rate-limiter.ts           # Algoritmo Sliding Window -> devuelve 429 + header Retry-After
│   │   ├── idempotency.ts            # Verificación y guardado de header `Idempotency-Key`
│   │   └── errors.ts                 # Clases de error de dominio (AppError, UnauthorizedError, ConflictError)
│   └── integrations/
│       ├── gemini.ts                 # Cliente `@google/genai` con manejo de timeout y error 429
│       └── n8n.ts                    # Webhook dispatcher asíncrono (fire-and-forget con try/catch)
├── modules/
│   ├── tenants/                      # Onboarding: crea registro en public.tenants y ejecuta create_tenant_schema()
│   ├── users/                        # Gestión de usuarios en public.users
│   ├── tables/                       # Lógica de mesas y cobro unificado (Opción A + Opción B)
│   ├── products/                     # Lógica de menú (borrado físico vs desactivación lógica)
│   ├── orders/                       # Máquina de estados de comandas y cola FIFO de cocina
│   ├── surveys/                      # Lógica de encuestas por lote de pago y disparo de alerta a n8n
│   └── reports/                      # Agregaciones SQL de ventas/encuestas, caché y armado de prompt IA
└── components/
    ├── ui/                           # Componentes base (shadcn/ui)
    ├── pos/                          # Componentes del mesero (TableGrid, OrderBuilder, CheckoutModalQR)
    ├── kitchen/                      # Componentes del cocinero (KitchenTicketCard, NotificationBell)
    └── admin/                        # Componentes del admin (MenuTable, SurveyList, AiReportViewer)