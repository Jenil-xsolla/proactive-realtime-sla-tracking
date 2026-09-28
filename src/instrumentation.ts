import { readServiceRole } from "@/service-role";

/**
 * Runs once when a new server instance starts, before it accepts requests
 * (Next's instrumentation.js docs). Reading `SERVICE_ROLE` here, not just in
 * `proxy.ts`, makes a missing or unknown value stop startup outright instead
 * of only failing closed on the first request.
 */
export function register(): void {
  readServiceRole(process.env);
}
