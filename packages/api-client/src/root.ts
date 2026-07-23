import { capabilitiesRouter } from "./router/capabilities";
import { chatRouter } from "./router/chat";
import { desktopRouter } from "./router/desktop";
import { documentsRouter } from "./router/documents";
import { emailsRouter } from "./router/emails";
import { entitiesRouter } from "./router/entities";
import { entityTypesRouter } from "./router/entity-types";
import { filesRouter } from "./router/files";
import { forwardingRouter } from "./router/forwarding";
import { genuiRouter } from "./router/genui";
import { knowledgeRouter } from "./router/knowledge";
import { referencesRouter } from "./router/references";
import { searchRouter } from "./router/search";
import { spreadsheetsRouter } from "./router/spreadsheets";
import { workspacesRouter } from "./router/workspaces";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  emails: emailsRouter,
  entityTypes: entityTypesRouter,
  entities: entitiesRouter,
  knowledge: knowledgeRouter,
  genui: genuiRouter,
  chat: chatRouter,
  forwarding: forwardingRouter,
  files: filesRouter,
  documents: documentsRouter,
  references: referencesRouter,
  capabilities: capabilitiesRouter,
  desktop: desktopRouter,
  search: searchRouter,
  spreadsheets: spreadsheetsRouter,
  workspaces: workspacesRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
