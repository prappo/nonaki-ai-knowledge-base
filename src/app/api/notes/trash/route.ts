import { LOCAL_OWNER, emptyTrash } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

/** Empty the trash: delete every trashed note for good. */
export async function DELETE() {
  const removed = await emptyTrash((await currentUserEmail()) ?? LOCAL_OWNER);
  return Response.json({ removed: removed.length });
}
