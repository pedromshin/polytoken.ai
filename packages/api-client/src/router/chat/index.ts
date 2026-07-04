/**
 * chat/index.ts — compose the chat tRPC router.
 *
 * Spreads the conversation CRUD procedures and the history read procedure
 * into one chatRouter, following the same barrel pattern as entities/index.ts.
 * Conversation lifecycle here is web-owned (tRPC/Drizzle, matches the
 * entities/emails router pattern of reads/CRUD bypassing FastAPI); the
 * streamed LLM turn writes (messages/runs/events) are Python-owned and land
 * in later plans.
 */

import { createTRPCRouter } from "../../trpc";
import { browserTurnProcedures } from "./browser-turn";
import { chatCanvasProcedures } from "./canvas";
import { chatConversationsProcedures } from "./conversations";
import { chatCostProcedures } from "./cost";
import { chatHistoryProcedures } from "./history";
import { modelsProcedure } from "./models";

export const chatRouter = createTRPCRouter({
  ...chatConversationsProcedures,
  ...chatHistoryProcedures,
  ...chatCostProcedures,
  ...browserTurnProcedures,
  ...chatCanvasProcedures,
  models: modelsProcedure,
});
