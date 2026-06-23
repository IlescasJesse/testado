import { PrismaClient } from "@prisma/client";

// Singleton de PrismaClient para evitar múltiples instancias en desarrollo.
// En producción (NODE_ENV !== 'development') se crea una instancia nueva.
// En desarrollo, se reutiliza la instancia guardada en globalThis para sobrevivir
// los hot-reloads de Node.js/ts-node.

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
