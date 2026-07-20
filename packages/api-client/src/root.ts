import { capabilitiesRouter } from "./router/capabilities";
import { chatRouter } from "./router/chat";
import { documentsRouter } from "./router/documents";
import { emailsRouter } from "./router/emails";
import { entitiesRouter } from "./router/entities";
import { entityTypesRouter } from "./router/entity-types";
import { filesRouter } from "./router/files";
import { forwardingRouter } from "./router/forwarding";
import { genuiRouter } from "./router/genui";
import { knowledgeRouter } from "./router/knowledge";
import { referencesRouter } from "./router/references";
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
});

// export type definition of API
export type AppRouter = typeof appRouter;
