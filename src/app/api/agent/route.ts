import { handleAgentPost } from "@/lib/agent-api";
import { runCareerAgent } from "@/lib/agent";
import { isAllowedOrigin, requireAgentUser } from "@/lib/firebase/security";
import { recordAgentUsage, reserveAgentRequest } from "@/lib/firebase/usage";
import { withRequestTelemetry } from "@/lib/request-telemetry";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request: Request): Promise<Response> {
  return withRequestTelemetry(request, "/api/agent", (requestId) =>
    handleAgentPost(
      request,
      {
        authenticate: requireAgentUser,
        isAllowedOrigin,
        reserve: reserveAgentRequest,
        record: recordAgentUsage,
        run: runCareerAgent,
      },
      requestId,
    ),
  );
}
