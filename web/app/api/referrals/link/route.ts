import { env } from "@/lib/env";
import { getVideo, listWatchSessions } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { sessionAddress } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const MIN_WATCHED_SECONDS = 30;

/**
 * POST { videoId } -> { url }. Requires a signed-in wallet that has paid to watch this video.
 * The contract enforces the same idea at settlement (the referrer must have paid the creator),
 * this just tells people up front instead of letting them share a link that earns nothing yet.
 */
export async function POST(req: Request) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet to get your referral link.", 401);
  const { videoId } = (await req.json()) as { videoId?: string };
  if (!videoId) return error("Missing videoId");
  const video = await getVideo(videoId);
  if (!video) return error("Video not found", 404);
  if (!video.referrals_enabled) return error("The creator hasn't turned on Share and earn for this video. You can still share the plain link.", 422);
  if (video.creator === me) return error("Creators can't earn referral rewards on their own videos. Share the plain link instead.", 422);

  const watched = (await listWatchSessions({ viewer: me, videoId: video.id })).reduce((a, s) => a + s.seconds, 0);
  if (watched < MIN_WATCHED_SECONDS) {
    return error("Watch a little of this video first. Referral links unlock once you've watched it yourself.", 422);
  }
  return json({ url: `${env.appUrl}/watch/${video.id}?ref=${me}` });
}
