import { signStatusListCredential } from "@/server/crypto/vc";
import { handle } from "@/server/http";
import { getRepo } from "@/server/repo";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

/** W3C BitstringStatusListCredential (platform-signed vc+jwt) referenced by every passport's credentialStatus. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const jwt = await signStatusListCredential(getRepo(), (await params).id);
    return new Response(jwt, { headers: { "content-type": "application/vc+jwt" } });
  });
}
