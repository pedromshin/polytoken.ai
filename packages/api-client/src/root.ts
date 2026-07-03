import { chatRouter } from "./router/chat";
import { emailsRouter } from "./router/emails";
import { entitiesRouter } from "./router/entities";
import { entityTypesRouter } from "./router/entity-types";
import { genuiRouter } from "./router/genui";
import { knowledgeRouter } from "./router/knowledge";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  emails: emailsRouter,
  entityTypes: entityTypesRouter,
  entities: entitiesRouter,
  knowledge: knowledgeRouter,
  genui: genuiRouter,
  chat: chatRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
