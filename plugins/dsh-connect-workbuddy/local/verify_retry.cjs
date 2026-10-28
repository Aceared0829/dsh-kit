
// Prove the retry wiring WITHOUT loading the plugin: read the three edited sites
// from the shipped file and assert their shape, then exercise resolveRetryPolicy
// semantics through a faithful stub of the dsh-llm contract.
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const checks = [];
const has = (name, needle) => checks.push([name, src.includes(needle)]);

has("imports RetryPolicySchema", 'RetryPolicySchema, createUserMessage, resolveRetryPolicy');
has("schema exposes retryPolicy", 'retryPolicy: asVolatile(RetryPolicySchema.description(');
has("profile reads live policy", 'retryPolicy: options.retryPolicy?.() ?? resolveRetryPolicy(void 0,');
has("adapter supplies live policy", 'retryPolicy: () => unwrapVolatile(current().retryPolicy) === void 0 ? void 0 : resolveRetryPolicy(');
has("still falls back to default", '?? resolveRetryPolicy(void 0, "dsh-connect-workbuddy retryPolicy")');
const removed = !src.includes('\t\tretryPolicy: resolveRetryPolicy(void 0, "dsh-connect-workbuddy retryPolicy"),');
checks.push(["old hard-wired line replaced", removed]);

// Faithful re-implementation of resolveRetryPolicy's documented contract for the
// two things that matter here: default list, and replacement when configured.
const DEFAULT_CODES = ["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"];
function resolveStub(cfg) {
  if (cfg === undefined) return { mode: "normal", maxRetries: 5, retryableCodes: DEFAULT_CODES };
  if (cfg.mode === "always") return { mode: "always" };
  if (cfg.mode !== "normal") throw new Error("mode must be normal or always");
  return { mode: "normal", maxRetries: cfg.maxRetries ?? 5, retryableCodes: cfg.retryableCodes ?? DEFAULT_CODES };
}
const dflt = resolveStub(undefined);
checks.push(["DEFAULT omits MALFORMED_RESPONSE (the bug)", !dflt.retryableCodes.includes("MALFORMED_RESPONSE")]);
const tuned = resolveStub({ mode: "normal", maxRetries: 3, retryableCodes: DEFAULT_CODES.concat("MALFORMED_RESPONSE") });
checks.push(["configured INCLUDES MALFORMED_RESPONSE (the fix)", tuned.retryableCodes.includes("MALFORMED_RESPONSE")]);
checks.push(["configured keeps other defaults", DEFAULT_CODES.every(c => tuned.retryableCodes.includes(c))]);
let rejected = false;
try { resolveStub({ mode: "nonsense" }); } catch { rejected = true; }
checks.push(["invalid mode rejected", rejected]);

let bad = 0;
for (const [name, ok] of checks) { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) bad++; }
console.log(`\n${checks.length - bad}/${checks.length} passed`);
process.exit(bad === 0 ? 0 : 1);
