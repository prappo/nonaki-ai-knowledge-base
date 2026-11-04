import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/audit";
import { newPairingCode } from "@/lib/releases";

/** A one-time code for `release-agent pair`, valid for 10 minutes. */
export async function POST() {
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.releasePairing.create({ data: { code, expiresAt, createdBy: await currentActor() } });
  // tidy up old codes
  await prisma.releasePairing.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } });
  return Response.json({ code, expiresAt: expiresAt.toISOString() });
}
