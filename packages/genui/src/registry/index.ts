/**
 * registry/index.ts — Public re-exports for @nauta/genui/registry
 */

export {
  COMPONENT_REGISTRY,
  REGISTERED_TYPES,
  RegisteredTypeSchema,
  UnknownComponentPlaceholder,
} from "./component-registry";

export type { UnknownComponentPlaceholderProps } from "./component-registry";

export { computeRegistryHash, REGISTRY_VERSION } from "./registry-version";
