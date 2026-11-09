import { currentUserEmail, listUsers } from "@/lib/users";

/** People tasks can be assigned to, and who is asking. */
export async function GET() {
  const [users, me] = await Promise.all([listUsers(), currentUserEmail()]);
  return Response.json({ users, me });
}
