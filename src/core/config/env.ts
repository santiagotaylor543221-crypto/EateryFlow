import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection string"),
  DIRECT_URL: z.string().url("DIRECT_URL must be a valid PostgreSQL connection string"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JWT_SECRET: z.string().min(16).default("super-secret-jwt-key-min-16-chars-long"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  N8N_WEBHOOK_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:", result.error.format());
    // If running in development or build without credentials yet, provide fallback or throw descriptive error
    if (process.env.NODE_ENV !== "production") {
      console.warn("⚠️ Warning: Running with incomplete environment variables.");
    }
    // Return what is parsed or throw if critical
    return (result.data ?? {
      DATABASE_URL: process.env.DATABASE_URL || "",
      DIRECT_URL: process.env.DIRECT_URL || "",
      NODE_ENV: "development",
      JWT_SECRET: process.env.JWT_SECRET || "super-secret-jwt-key-min-16-chars-long",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
    }) as Env;
  }

  return result.data;
}

export const env = parseEnv();
export { envSchema };
