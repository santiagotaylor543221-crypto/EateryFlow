import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type TenantTransactionalClient = Prisma.TransactionClient;

/**
 * Executes a callback within a PostgreSQL transaction scoped to a specific tenant schema.
 *
 * It runs `SET LOCAL search_path TO "schemaName", public;` inside `prisma.$transaction`,
 * ensuring that all queries directed to tenant tables (`tables`, `products`, `orders`,
 * `order_items`, `surveys`, `ai_reports_cache`) resolve within the tenant's isolated schema,
 * while maintaining access to global tables in `public`.
 *
 * @param schemaName The isolated schema identifier (e.g. "tenant_restaurante_xyz")
 * @param callback The transactional callback receiving the scoped `tx` client
 * @returns The result of the callback
 */
export async function withTenant<T>(
  schemaName: string,
  callback: (tx: TenantTransactionalClient) => Promise<T>
): Promise<T> {
  const sanitizedSchema = schemaName.trim();

  // Validate identifier characters to avoid SQL injection
  if (!/^[a-zA-Z0-9_]+$/.test(sanitizedSchema)) {
    throw new Error(`Invalid tenant schema name format: "${schemaName}"`);
  }

  return await prisma.$transaction(async (tx) => {
    // Switch search_path for the duration of this transaction
    await tx.$executeRawUnsafe(
      `SET LOCAL search_path TO "${sanitizedSchema}", public;`
    );

    return await callback(tx);
  });
}
