/**
 * knowledge/index.ts — compose the knowledge tRPC router.
 *
 * Spreads graph, list, detail, expand, and search procedure objects into one
 * knowledgeRouter, following the same pattern as entities/index.ts.
 */

import { createTRPCRouter } from "../../trpc";
import { knowledgeDetailProcedures } from "./detail";
import { knowledgeExpandProcedures } from "./expand";
import { knowledgeGraphProcedures } from "./graph";
import { knowledgeListProcedures } from "./list";
import { knowledgeSearchProcedures } from "./search";

export const knowledgeRouter = createTRPCRouter({
  ...knowledgeGraphProcedures,
  ...knowledgeListProcedures,
  ...knowledgeDetailProcedures,
  ...knowledgeExpandProcedures,
  ...knowledgeSearchProcedures,
});
