import { getShareConfig } from "@/lib/share";
import { setupMessengerProfile } from "@/lib/messenger";

/** Push the Get Started button + greeting to the connected Facebook page. */
export async function POST() {
  const config = await getShareConfig("bot");
  if (!config.pageToken) {
    return Response.json(
      { error: "Save a Page Access Token first" },
      { status: 400 }
    );
  }
  try {
    await setupMessengerProfile(config);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Profile setup failed" },
      { status: 502 }
    );
  }
}
