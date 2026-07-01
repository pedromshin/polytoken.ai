/** fixtures/index.ts — barrel for code-island spike fixtures. */

export { CURVEBALL_SOUNDSCAPE_CODE, CURVEBALL_SOUNDSCAPE_DESCRIPTION } from "./curveball";
export {
  BROKEN_ISLAND_CODE,
  HEALED_ISLAND_CODE,
  UNREPAIRABLE_ISLAND_CODE,
  stubHealer,
  failingHealer,
  type IslandHealer,
} from "./repair";
export { ADVERSARIAL_FIXTURES, type AdversarialFixture } from "./adversarial";
