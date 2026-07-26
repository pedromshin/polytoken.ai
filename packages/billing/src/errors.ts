/**
 * Billing error hierarchy — every billing failure carries a machine-readable
 * `code`. Consumers catch `BillingError` for all billing failures or a subclass
 * for targeted handling (mirrors the algomaxxing/billing pattern).
 */

/** Base billing error with a machine-readable code. */
export class BillingError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "BillingError";
    // Preserve the prototype chain for instanceof across the transpile boundary.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a user with an active paid subscription starts a new checkout
 * (they must change plans via the customer portal, not a second subscription). */
export class DuplicateSubscriptionError extends BillingError {
  constructor(message: string) {
    super(message, "DUPLICATE_SUBSCRIPTION");
    this.name = "DuplicateSubscriptionError";
  }
}

/** Thrown when webhook event processing fails (bad signature is handled at the
 * route boundary; this is for downstream handler failures). */
export class WebhookProcessingError extends BillingError {
  constructor(message: string) {
    super(message, "WEBHOOK_PROCESSING");
    this.name = "WebhookProcessingError";
  }
}

/** Thrown when billing is invoked without required configuration (keys/prices). */
export class BillingNotConfiguredError extends BillingError {
  constructor(message: string) {
    super(message, "BILLING_NOT_CONFIGURED");
    this.name = "BillingNotConfiguredError";
  }
}
