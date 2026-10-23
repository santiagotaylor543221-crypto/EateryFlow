# Informe de Lógica de Negocio: SaaS Multitenant para Restaurantes

## 1. Idea General y Arquitectura Multitenant
Plataforma SaaS multitenant donde múltiples restaurantes operan sobre una misma aplicación con aislamiento estricto de datos en PostgreSQL[cite: 1, 2].
* **Schema compartido (`public`):** Almacena la tabla global de restaurantes (`tenants`), usuarios (`users`) y control de claves de idempotencia globales[cite: 2, 3].
* **Schema por restaurante (`tenant_<slug>`):** Creado de forma 100% automática al registrarse un restaurante[cite: 2]. Contiene las tablas operativas del negocio[cite: 2].
* **Resolución del tenant:**
  * **Rutas privadas:** A través del JWT almacenado en una cookie `httpOnly` (nunca en `localStorage`), el cual contiene `user_id`, `role`, `tenant_id` y `schema_name`.
  * **Rutas públicas (Encuesta QR):** A través del `slug` único del restaurante en la URL (`/encuesta/[slug]/[qr_token]`), resolviendo el schema desde `public.tenants` antes de consultar el lote de pago.

---

## 2. Actores, Jerarquía y Permisos
El correo electrónico es único a nivel global en `public.users`. Los roles dentro de cada restaurante están estrictamente segregados según la jerarquía operativa real[cite: 5]:
* **Administrador (`ADMIN`):** Configura el local (mesas, menú, empleados) y audita el negocio (ventas, encuestas e informes con IA)[cite: 5]. No toma comandas ni opera la cocina.
* **Mesero (`WAITER`):** Opera el salón. Abre mesas, crea comandas por ronda, entrega platos listos y realiza el cobro unificado de la mesa.
* **Cocinero (`CHEF`):** Opera la pantalla de cocina (KDS). Recibe notificaciones de comandas entrantes ordenadas por prioridad de envío (FIFO) y marca los platos como listos.
* **Cliente (Sin cuenta):** Escanea el QR tras pagar y responde la encuesta pública de satisfacción.

| Acción | Admin (`ADMIN`) | Mesero (`WAITER`) | Cocinero (`CHEF`) | Cliente (Público) |
| :--- | :---: | :---: | :---: | :---: |
| Registrar el restaurante (Onboarding) | Sí | No | No | No |
| Crear, activar y desactivar empleados (`WAITER` / `CHEF`) | Sí | No | No | No |
| CRUD completo de Mesas (`tables`) | Sí | Solo lectura / cambio de estado | No | No |
| CRUD completo de Productos (`products`) | Sí | Solo lectura | Solo lectura | No |
| Crear comanda (`orders`), editar ítems y enviar a cocina | No | Sí | No | No |
| Ver cola de cocina (FIFO) y marcar comanda como `LISTO` | No | No | Sí | No |
| Marcar comanda como `ENTREGADO` en la mesa | No | Sí | No | No |
| Cobrar mesa (unificar comandas), registrar pago y generar QR | No | Sí | No | No |
| Ver historial global de pedidos y ventas | Sí (Auditoría) | Sí (Operativo) | No | No |
| Responder encuesta mediante enlace QR | No | No | No | Sí |
| Ver, marcar como revisadas o eliminar encuestas | Sí | No | No | No |
| Generar informes estratégicos con IA (Gemini) | Sí | No | No | No |

---

## 3. Entidades del Dominio por Tenant (Requisito 4.3)
Cada schema de restaurante cuenta con CRUD completo sobre sus entidades de negocio:
1. **Mesas (`tables`):** Número/nombre de mesa, capacidad y estado operativo (`LIBRE`, `OCUPADA`, `PIDIO_CUENTA`) y estado de activación (`is_active`)[cite: 1, 3].
2. **Productos (`products`):** Nombre, precio ($> 0$), categoría y disponibilidad (`is_active`). Si un producto ya tiene ventas históricas, se desactiva lógicamente en lugar de borrarse físicamente[cite: 1, 3].
3. **Pedidos / Comandas (`orders` + detalle `order_items`):** Vinculados a una `table_id`, un `waiter_id` y opcionalmente un `chef_id`[cite: 1, 3].
4. **Encuestas (`surveys`):** Vinculadas al lote de pago (`payment_batch_id` / `qr_token`). Incluyen calificaciones numéricas del 1 al 5 (`comida`, `ambiente`, `atencion`), comentario opcional, estado de revisión (`is_reviewed`) y nota interna del Admin para cumplir el ciclo CRUD administrativo.

---

## 4. Flujos Operativos y Máquinas de Estado

### 4.1 Estado de la Mesa (`tables.status`)
`LIBRE` ⇄ `OCUPADA` ⇄ `PIDIO_CUENTA` → `LIBRE`
* Una mesa pasa a `OCUPADA` cuando el mesero crea la primera comanda de la visita.
* Pasa a `PIDIO_CUENTA` cuando el cliente solicita pagar (bloqueando la creación de nuevas comandas salvo que el mesero la regrese a `OCUPADA`).
* Vuelve a `LIBRE` automáticamente al completarse el pago unificado o si se cancela la única comanda abierta.

### 4.2 Estado de cada Comanda (`orders.status`) y Prioridad en Cocina
`ABIERTO` → `EN_COCINA` → `LISTO` → `ENTREGADO` → `PAGADO` (o `CANCELADO` desde `ABIERTO`)

1. **`ABIERTO` (En manos del mesero):** El mesero selecciona una mesa y agrega productos definiendo la cantidad absoluta deseada (mínimo 1; sin duplicar filas gracias a `UNIQUE(order_id, product_id)`). El cocinero aún no ve esta comanda. Puede eliminarse/cancelarse si se abrió por error.
2. **`EN_COCINA` (Cola FIFO del cocinero):** El mesero presiona "Enviar a cocina" (requiere al menos 1 producto). Se congela el `unit_price` de cada producto, se registra el timestamp `sent_to_kitchen_at = NOW()` y se notifica al cocinero. La pantalla del cocinero ordena estrictamente por `sent_to_kitchen_at ASC`.
3. **`LISTO` (Preparado por el cocinero):** El cocinero termina la preparación, registra `ready_at = NOW()` y el mesero recibe la alerta para recoger el pedido.
4. **`ENTREGADO` (En la mesa):** El mesero confirma que llevó los platos a la mesa.
5. **Rondas adicionales (ej. postres o bebidas extra):** Si la mesa pide algo más tarde, **no se reabre** la comanda ya cocinada; el mesero crea una **nueva comanda (`orders`)** asociada a la misma `table_id`, que entra al final de la cola del cocinero con su propio `sent_to_kitchen_at`.

### 4.3 Reglas de Cobro Unificado por Mesa (Combinación Opción A + Opción B)
Cuando el cliente solicita pagar la cuenta de una mesa (`table_id`):
* **Regla de validación previa (Opción B):** El backend rechaza el cobro si la mesa tiene cualquier comanda activa en estado `ABIERTO` (borrador sin enviar), `EN_COCINA` (preparándose) o `LISTO` (sin entregar a la mesa). Todas las comandas vigentes de la visita deben estar en estado `ENTREGADO`.
* **Regla de agrupación y lote de pago (Opción A):** El backend selecciona todas las comandas en estado `ENTREGADO` de esa `table_id`, suma sus totales, registra el método de pago (`EFECTIVO`, `TARJETA`, `TRANSFERENCIA`) y la fecha `paid_at` (en UTC `TIMESTAMPTZ`), y les estampa a todas un mismo `payment_batch_id` y un único `qr_token` (con expiración de 24 horas). Todas esas comandas pasan a estado `PAGADO` y la mesa vuelve a `LIBRE`. Así, el siguiente turno de clientes en esa misma mesa jamás mezclará sus cuentas con las anteriores.

---

## 5. Requisitos de Robustez, Renderizado y Puntos Adicionales

* **Idempotencia (`Idempotency-Key`):** Obligatoria en 1) Registro de restaurante, 2) Envío de comanda a cocina, 3) Cobro unificado de mesa y 4) Envío de encuesta pública. Si se repite la petición con la misma clave dentro de las 24h, devuelve la respuesta original sin duplicar registros.
* **Rate Limiting (`429` + `Retry-After`):** Implementado con algoritmo *Sliding Window* / *Token Bucket*[cite: 3]. Se aplica por **IP** en login, registro y encuesta pública, y por **`tenant_id` / `user_id`** en creación de comandas e informes de IA[cite: 3, 4, 5].
* **Estrategias de Renderizado en Next.js (Opción B):**
  * **SSG:** Landing page comercial del SaaS (`/`)[cite: 4].
  * **SSR:** Encuesta pública (`/encuesta/[slug]/[qr_token]`) y Dashboard de auditoría del Admin[cite: 4].
  * **CSR:** Interfaz POS del Mesero (`/pos`) y Pantalla de Cocina del Chef (`/cocina`) por su alta interactividad en tiempo real[cite: 4].
* **Informes con IA (Gemini):** Exclusivo del Admin[cite: 5]. Calcula métricas SQL sobre pedidos `PAGADO` y encuestas según el periodo (`hoy`, `semana`, `mes` en zona horaria del local), valida que existan datos antes de invocar el modelo (definido en variable de entorno), aplica caché y maneja errores `429` sin romper la aplicación[cite: 5].
* **Automatización con n8n:** Disparo asíncrono (*fire-and-forget*) vía Webhook en dos eventos: 1) Creación de un nuevo restaurante (correo de bienvenida) y 2) Encuesta recibida con calificación crítica ($\le 2$ en cualquier rubro, enviando alerta al Admin)[cite: 5]. Si n8n falla, el flujo principal continúa sin interrupción[cite: 5].