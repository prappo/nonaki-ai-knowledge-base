import { prisma } from "./prisma";

const DEFAULTS = {
  chunkSize: 1200,
  retrievalLimit: 8,
} as const;

export async function getNumberSetting(
  key: keyof typeof DEFAULTS
): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const n = row ? Number(row.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
}
