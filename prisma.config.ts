import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations should use Supabase's DIRECT (session-mode) connection when
    // available — the transaction pooler (port 6543) can't run DDL reliably.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
