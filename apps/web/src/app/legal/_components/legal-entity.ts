/**
 * legal-entity.ts — the controller identity + contact used across /legal/*.
 *
 * ⚠️ REVIEW before launch: confirm the contact address ROUTES to a monitored
 * inbox (LGPD requires a working data-subject channel), and confirm the legal
 * name / CNPJ with the accountant. Sourced from the CNPJ card (2026-07-26).
 */

export const PRODUCT_NAME = "polytoken";

/** The controller (the Brazilian LTDA behind polytoken). */
export const COMPANY_LEGAL_NAME =
  "Pedro Kyun Maschio Shin Consultoria em Tecnologia LTDA";
export const COMPANY_TRADE_NAME = "Magnitude Tecnologia";
export const COMPANY_CNPJ = "65.152.447/0001-21";

/** Data-subject / privacy contact. ⚠️ ensure this routes before launch. */
export const CONTACT_EMAIL = "privacy@polytoken.ai";

/** Brazil — the LTDA's home jurisdiction (governing law for the ToS). */
export const GOVERNING_JURISDICTION = "the Federative Republic of Brazil";
