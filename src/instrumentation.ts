import { readServiceRole } from "@/service-role";

type RegisterOptions = {
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
  log?: (message: string) => void;
};

/**
 * Runs once when a new server instance starts, before it accepts requests
 * (Next's instrumentation.js docs). Reading `SERVICE_ROLE` here, not just in
 * `proxy.ts`, makes a missing or unknown value stop startup outright instead
 * of only failing closed on the first request.
 *
 * Next's own `next-server.js` catches a throw out of `register()` and keeps
 * the process serving 500s, so a throw alone does not stop anything in
 * production. `exit()` makes that explicit: on Node.js (`NEXT_RUNTIME ===
 * "nodejs"`, never the Edge runtime) it calls `process.exit(1)` before
 * re-throwing, so the container actually dies instead of limping along.
 *
 * The `NEXT_RUNTIME` check reads the literal `process.env.NEXT_RUNTIME`, not
 * the injectable `env` — this is the documented instrumentation pattern
 * (https://nextjs.org/docs/app/guides/instrumentation), and Next's bundler
 * inlines that exact expression per runtime bundle at build time, so it is
 * `true`/dead-code-eliminated in the compiled output rather than a real
 * environment variable read at request time. It does not depend on
 * `server.js` (or whoever else calls into this bundle) having set
 * `NEXT_RUNTIME` itself. `env` stays injectable for `readServiceRole` only.
 * `options` exist so tests can inject `env`/`exit`/`log` instead of a real
 * process exit; Next itself calls `register()` with no arguments.
 */
export function register(options: RegisterOptions = {}): void {
  const env = options.env ?? process.env;
  try {
    readServiceRole(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (options.log ?? console.error)(`[startup] ${message}. Refusing to start.`);
    const exit =
      options.exit ?? (process.env.NEXT_RUNTIME === "nodejs" ? (code: number) => process.exit(code) : undefined);
    exit?.(1);
    throw error;
  }
}
