import { $ as parseCreditMultiplier, $t as withFileLock, A as isEncryptedCredentialError, At as pickMediaModel, B as WorkBuddyCredentialRejectedError, Bt as deriveAtRestKeyId, C as WorkBuddyCredentialStore, Ct as IMAGE_TAG_TEXT_TO_IMAGE, D as defaultDesktopAuthDirs, Dt as imageMimeForPath, E as defaultDesktopAuthCandidates, Et as imageDataUrl, F as workbuddyAccountId, Ft as imageDefaultFor, G as forceNeutralHead, Gt as isWorkbuddyBundle, H as channelGateMemberOf, Ht as findWorkbuddyAppExecutable, I as workbuddyOwnAuthPath, It as nativeModalityOf, J as isCredentialRejectedError, Jt as openEncryptedField, K as isContextTooLongBody, Kt as macosBundleExecutable, L as CONTEXT_OVERFLOW_MARKER, Lt as WORKBUDDY_APP_EXECUTABLE_ENV, M as legacyWorkbuddyOwnAuthPath, Mt as parseQueueAnswer, N as parseWorkBuddyAuth, Nt as queueNoticeText, O as defaultDesktopAuthPath, Ot as isBareBase64Image, P as preferredAccountName, Pt as NATIVE_MODALITY_BY_MODEL_ID, Q as openingEvidenceOfBody, Qt as resolveDshHome, R as CREDENTIAL_REJECTED_CODE, Rt as clearAtRestKeyCache, S as WORKBUDDY_AUTH_FILE_ENV, St as IMAGE_TAG_IMAGE_TO_IMAGE, T as authFileName, Tt as WorkBuddyImageError, U as classifyUpstreamError, V as WorkBuddyUpstreamClient, Vt as fetchAtRestKeyPayload, W as declaredTools, Wt as isEncryptedFieldWrapper, X as knownRegionOf, Xt as workbuddyAppExecutableCandidates, Y as isFirstMessageGateBody, Yt as readAtRestKey, Z as modelIdOfBody, _ as deriveCatalog, _t as WorkBuddyVideoError, a as readHostHeartbeat, at as requestEvidenceOf, b as ENCRYPTED_CREDENTIAL_CODE, bt as resolveVideoParams, c as WORKBUDDY_CONNECT_VERSION, ct as REFUSES_OFF_MODEL_IDS, dt as offDefaultFor, en as writeFileAtomic, et as parseReasoning, f as piAiRuntimeInfo, ft as offRefused, g as applyContextBudgets, gt as VIDEO_TAG_TEXT_TO_VIDEO, h as WorkBuddyCatalog, ht as VIDEO_TAG_IMAGE_TO_VIDEO, i as processStartTimeMs, it as regionOf, j as isVaultAccountId, jt as sniffImageMime, k as hasEncryptedCredentialFields, kt as parseImageDataUrl, l as createFileRosterSeenStore, lt as defaultOffModelIds, m as FALLBACK_WORKBUDDY_MODELS_GLOBAL, mt as withEffectiveOff, n as clearHostHeartbeat, nt as perturbChannelFingerprints, o as workbuddyHostHeartbeatPath, ot as rewriteSessionTitleModel, p as FALLBACK_WORKBUDDY_MODELS, pt as recordRefusal, q as isConversationIdGateBody, qt as macosNestedAppBundles, r as isHeartbeatProcessAlive, rt as prepareChatBody, s as writeHostHeartbeat, st as attachBusyLevels, t as WORKBUDDY_HOST_HEARTBEAT_FILENAME, tt as parseUpstreamModel, ut as lastRefusalFor, v as fallbackModelsFor, vt as parseSupportedSecondsRange, w as WorkBuddyEncryptedCredentialError, wt as MAX_INPUT_IMAGE_BYTES, x as WORKBUDDY_AUTH_FILENAME, xt as DEFAULT_IMAGE_SIZE, y as withoutRouters, yt as pickVideoModel, z as WORKBUDDY_FALLBACK_SYSTEM_PROMPT, zt as deriveAtRestKey } from "./host-heartbeat-guET27pw.js";
import z from "@deepseek-ai/schemastery";
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { createAssistantMessageEventStream, createProvider, isContextOverflow } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { ReasoningEffortId, RetryPolicySchema, createUserMessage, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { isIP } from "node:net";
//#region src/catalog-sync.ts
/**
* The saved model directory (`lastCatalog`) and the LIVE upstream roster.
*
* ISSUES #114 AND #115. Both are the SAME defect seen from two sides: the
* saved directory won over the live roster, and the saved directory is
* allowed to go stale forever.
*
* WHAT THE SAVED DIRECTORY IS. `lastCatalog` is the user's saved selection of
* models — the list the card edits, and the only thing that survives a
* restart. It is NOT a capability cache and it is NOT the source of truth
* about what the upstream currently offers.
*
* WHAT WENT WRONG, IN TWO STEPS.
*
* 1. `configuredModels()` resolved its roster as "saved directory if it is
*    non-empty, else the live roster, else the static fallback". A saved
*    directory therefore SUPPRESSED the live roster permanently: a model the
*    upstream added (`deepseek-v4.1-flash` on the CN roster) could never reach
*    the user, and the only thing that changed the saved directory was the
*    card's explicit save. That is issue #115.
*
* 2. The saved directory was ALSO allowed to be seeded with the STATIC
*    fallback table — a table that carries ids, names and token limits but no
*    `reasoning` block. A model entry with no `reasoning` declares no thinking
*    tiers at all, so `workBuddyThinkingLevelMap()` answers `undefined`, the
*    model is published with `reasoning: false`, and the host offers exactly
*    `Default` and `Off`. That is issue #114.
*
*    Worse, the save was a LOOP: the card wrote back `visibleModels`, which
*    came from the saved directory, so a stale directory was re-saved as
*    itself and the upstream's real capabilities could never be learned.
*
* THE FIX HAS THREE PARTS, and the third is the reason this is a module
* rather than a one-line change.
*
* - The saved directory is a NAMES list; CAPABILITIES always come from the
*   live roster ({@link overlayLiveCapabilities}).
* - The live roster is merged OVER the saved one, not the other way round
*   ({@link mergeRoster}), so a model the upstream withdrew but the user is
*   still running stays offered (issue #32's rule), while a model the
*   upstream ADDED appears.
* - The saved directory is REPAIRED once the live roster lands
*   ({@link repairedCatalog}), and a saved directory that is byte-identical
*   to the static fallback table is recognised as "never really configured"
*   ({@link isUnconfiguredFallbackSnapshot}).
*
* WHY THE OVERLAY LIVES ON READ RATHER THAN IN THE SAVED DIRECTORY. The saved
* directory CAN carry the capability fields — the settings schema keeps every
* key the write carries, and `resolveConfig` returns them unchanged (both
* verified against the host's own `projectForm` / standard validate). But it
* did not help: what poisoned the directory was not a stripped field, it was
* the STATIC FALLBACK TABLE being written into it in the first place, and a
* table that declares no `reasoning` at all. Once that table is the saved
* directory, the card saves it back unchanged, and the upstream's real
* capabilities never enter it — the save loop closes on itself.
*
* So the capability fields are read from the live roster on EVERY read. That
* is also where the truth is: the upstream's answer changes over time, and a
* saved copy is a snapshot of one moment.
*
* @module dsh-connect-workbuddy/catalog-sync
*/
/**
* The capability fields a saved directory may carry but must never be trusted
* for, because the live roster is the authority on all of them.
*
* `reasoning` is the one issue #114 is about. `creditMultiplier` and
* `supportsImages` ride along for the same reason: the upstream publishes
* them, the saved copy is a snapshot of one moment, and a stale multiplier is
* a wrong PRICE shown to the user.
*
* `promos` is NOT in this list — see {@link overlayLiveCapabilities} for why it
* needs a different rule (it must be able to CLEAR a saved value, which this
* loop cannot express).
*/
const LIVE_OWNED_FIELDS = [
	"reasoning",
	"creditMultiplier",
	"supportsImages"
];
/**
* Overlay the live roster's capabilities onto a saved directory entry.
*
* The saved entry contributes IDENTITY (the id, the name the user saw, the
* context budget) and the live entry contributes CAPABILITY. When the live
* roster does not know the model at all, the saved entry is returned
* unchanged — it may be a model the upstream withdrew but the user is still
* running, and issue #32's rule says such a model must stay offered.
*
* `reasoning` is replaced rather than merged: a saved `reasoning` block
* describes one moment's upstream answer, and merging the two would leave
* `canDisableThinking` from the stale copy attached to a fresh set of
* efforts. The user's own `off` choice is NOT part of this — it is stamped
* later by `withEffectiveOff`, from the saved selection, not from here.
*
* The `canDisableThinking` in the LIVE block is the upstream's DECLARATION,
* and the user's effective choice is stamped over it by `withEffectiveOff`
* afterwards. So the overlay restores the declaration, and the user's tick
* still wins.
*
* `promos` IS LIVE-OWNED TOO, AND IS REPLACED UNCONDITIONALLY. It cannot use
* the loop above, because that loop only writes a field the live entry HAS —
* which would keep a saved promotion forever once the upstream withdrew it.
* Both directions were observed to be wrong before this rule existed:
*
*   - saved WITHOUT `promos`, live WITH them → the live promotions were
*     dropped entirely, so a model on a night discount drew no badge at all;
*   - saved WITH old `promos`, live with new ones → the saved ones won, so a
*     promotion whose hours the upstream had since changed kept advertising
*     the OLD hours.
*
* The card persists `promos` into `lastCatalog` (the settings schema keeps
* unknown keys), so a user who saved the directory once had their badges
* frozen at that moment — the exact opposite of what `src/promo.ts` promises
* ("a badge is a function of the clock, not of the fetch"). The upstream's
* current answer therefore REPLACES the saved one, including when that answer
* is "no promotions at all": a badge the upstream no longer publishes must
* stop being drawn, and a standing entry with no schedule has no absolute
* window to expire it on its own.
*
* The key is DELETED rather than set to `undefined` when the live entry has
* no promotions, for the same reason `resolveRoster` deletes `busyLevel`: an
* explicit `undefined` survives `structuredClone` and the settings write
* path's strict JSON codec rejects the whole save.
*/
function overlayLiveCapabilities(saved, live) {
	if (live === void 0) return saved;
	const overlay = {};
	for (const field of LIVE_OWNED_FIELDS) {
		const value = live[field];
		if (value !== void 0) overlay[field] = value;
	}
	const livePromos = live.promos;
	const savedPromos = saved.promos;
	const promosDiffer = livePromos !== savedPromos && (livePromos !== void 0 || savedPromos !== void 0);
	if (Object.keys(overlay).length === 0 && !promosDiffer) return saved;
	if (livePromos !== void 0) {
		overlay["promos"] = livePromos;
		return {
			...saved,
			...overlay
		};
	}
	const { promos: _stalePromos, ...rest } = saved;
	return {
		...rest,
		...overlay
	};
}
/**
* The roster the runtime and the card should serve: the live roster, with the
* saved directory's own models kept when the upstream no longer lists them.
*
* ORDER matters for the card (it lists the roster as given) and is
* preserved from the live roster, with the kept-but-withdrawn models
* appended. The live roster wins on every shared id.
*
* @param saved The saved directory (may be empty).
* @param live The live upstream roster (may be empty when the upstream is
*   unreachable — then this answers the saved directory alone).
*/
function mergeRoster(saved, live) {
	new Map(live.map((model) => [model.id, model]));
	const savedById = new Map(saved.map((model) => [model.id, model]));
	const merged = [];
	const seen = /* @__PURE__ */ new Set();
	for (const model of live) {
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		const savedEntry = savedById.get(model.id);
		merged.push(savedEntry === void 0 ? model : overlayLiveCapabilities(savedEntry, model));
	}
	for (const model of saved) {
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		merged.push(model);
	}
	return merged;
}
/**
* A fingerprint of a directory, used to decide whether a repair is worth
* writing.
*
* Only the fields that MATTER are included: the ids in order and the
* capability fields. A directory whose fingerprint matches the live roster's
* needs no write, which is what keeps the repair from writing on every
* refresh (a write per refresh would be a write storm on a profile the user
* opens often).
*
* `busyLevel` is excluded for the same reason it is never persisted: it is a
* fact about this minute.
*/
function catalogFingerprint(models) {
	return JSON.stringify(models.map((model) => ({
		id: model.id,
		...model.reasoning === void 0 ? {} : { reasoning: model.reasoning },
		...model.creditMultiplier === void 0 ? {} : { creditMultiplier: model.creditMultiplier },
		...model.supportsImages === void 0 ? {} : { supportsImages: model.supportsImages }
	})));
}
/**
* The saved directory REPAIRED against the live roster.
*
* This is what gets written back, so the next read starts from a directory
* that agrees with the upstream: the live roster's models (so a newly added
* model is present), plus the saved directory's own models that the upstream
* still lists or that the user is still running.
*
* `enabledModelIds` is NOT touched here — the selection lives in its own
* field, and the repair must not drop a tick whose model merely left the
* upstream roster.
*/
function repairedCatalog(saved, live) {
	return mergeRoster(saved, live);
}
/**
* Whether a saved directory is byte-for-byte the STATIC fallback table.
*
* That table is what a cold start used to seed `lastCatalog` with (issue
* #114's root cause). Such a directory is not a user's selection — it is the
* plugin's own placeholder that came back as if the user had chosen it. So
* it is recognised here and treated as "never configured", which lets the
* live roster take over and lets the directory heal.
*
* The comparison is by id list and capability content, not by object
* identity: the seeded copy is a plain copy of the fallback table.
*/
function isUnconfiguredFallbackSnapshot(saved, region) {
	const fallback = fallbackModelsFor(region);
	if (saved.length !== fallback.length) return false;
	const fallbackIds = fallback.map((model) => model.id);
	const savedIds = saved.map((model) => model.id);
	if (!fallbackIds.every((id, index) => id === savedIds[index])) return false;
	return saved.every((model) => model.reasoning === void 0);
}
/**
* The roster the runtime serves for a region.
*
* THE ORDER OF THE THREE SOURCES is the whole point of issues #114/#115:
*
* 1. the LIVE roster, when there is one — it is the truth about what the
*    upstream offers;
* 2. the saved directory, merged over it — the user's own models are kept
*    even when the upstream withdrew them;
* 3. the static fallback, only when the upstream is unreachable AND nothing
*    was ever saved.
*
* The saved directory is NEVER the primary source: that is what froze the
* roster at a stale snapshot forever.
*
* @param saved The region's saved directory.
* @param live The region's live roster (empty when the upstream is down).
* @param region The region, for the static fallback table.
* @param options.keepLoadLevel Whether a live entry's load level survives
*   the merge. It is ON for the runtime roster and OFF for the card's
*   directory — see the note below.
*/
function resolveRoster(saved, live, region, options = {}) {
	const savedRoster = withoutRouters(saved);
	const liveRoster = withoutRouters(live);
	const source = liveRoster.length > 0 ? liveRoster : savedRoster.length > 0 ? savedRoster : withoutRouters(fallbackModelsFor(region));
	const merged = liveRoster.length > 0 ? mergeRoster(savedRoster, liveRoster) : source;
	if (options.keepLoadLevel === true) return merged;
	return merged.map((model) => {
		if (model.busyLevel === void 0) return model;
		const { busyLevel: _dropped, ...rest } = model;
		return rest;
	});
}
//#endregion
//#region src/status-paths.ts
/** Plugin-owned usage endpoint consumed by its browser half. */
const WORKBUDDY_USAGE_PATH = "/plugins/dsh-connect-workbuddy/usage";
/**
* Per-account credit balances for one region, read ONLY while the composer
* panel is open.
*
* Separate from {@link WORKBUDDY_USAGE_PATH} because its cost is different in
* kind: the usage document is one upstream read for the selected account, while
* this is one read PER account in the region. Folding it into the usage route
* would make every 5-minute refresh pay for a table nobody is looking at, so it
* is fetched on demand instead — the same principle the pool applies to its
* per-account figures.
*/
const WORKBUDDY_ACCOUNT_CREDITS_PATH = "/plugins/dsh-connect-workbuddy/account-credits";
/**
* Plugin-owned benefit claim endpoint: POST + loopback, ONE account per call.
*
* A credit grant is a write on a real account, so it carries the same guards as
* check-in, plus `?accountId=` because the pool can hold accounts this plugin
* did not pick. There is deliberately no batch action here — see
* `claimBenefit` and the route handler.
*/
const WORKBUDDY_BENEFIT_CLAIM_PATH = "/plugins/dsh-connect-workbuddy/benefit/claim";
/** Plugin-owned live model refresh endpoint. */
const WORKBUDDY_MODELS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/models/refresh";
/**
* Plugin-owned MEDIA model list endpoint (image + video, read from the region's
* `/v3/config`).
*
* Separate from {@link WORKBUDDY_MODELS_REFRESH_PATH} because it answers a
* different question from a different document projection: the refresh route
* returns the CHAT roster, from which `selectCliModels` drops every media
* entry, while this one keeps the `text-to-image`/`image-to-image`/
* `text-to-video`/`image-to-video` rows the card lists. Read-only and free —
* it is the same GET the image tool already performs.
*/
const WORKBUDDY_MEDIA_MODELS_PATH = "/plugins/dsh-connect-workbuddy/media-models";
/** Plugin-owned local account rescan endpoint. */
const WORKBUDDY_ACCOUNTS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/accounts/refresh";
/** Plugin-owned daily check-in action endpoint. */
const WORKBUDDY_CHECKIN_PATH = "/plugins/dsh-connect-workbuddy/checkin";
/**
* Plugin-owned model probe endpoint.
*
* Sends one minimal chat request per named model so the card can answer "is
* this model usable right now, and if it is limited, when can it be used
* again?". Lives on the Host because the credential must never reach the
* browser half.
*/
const WORKBUDDY_PROBE_PATH = "/plugins/dsh-connect-workbuddy/probe";
/**
* Plugin-owned OUTPUT-SPEED measurement endpoint (issue #92).
*
* Separate from {@link WORKBUDDY_PROBE_PATH} because the two ask opposite
* questions and cost different amounts: the availability probe sends 25,000
* input tokens and caps output at one (measured `credit 0.72`), while this one
* sends ~35 input tokens and caps output at 256 (measured `credit 0.01`–`0.15`).
* Sharing the route would mean sharing its one-model-per-request cap and its
* cost wording, and the two would then be wrong for each other.
*/
const WORKBUDDY_TPS_PATH = "/plugins/dsh-connect-workbuddy/tps";
/**
* Plugin-owned account-pool endpoint: one batch action per call.
*
* `?action=checkin` claims the daily reward for every account of a region;
* `?action=test` probes every account against the region's target model. Both
* are POST and loopback-only because both cost something real — check-in writes
* to the user's account, a probe spends credits.
*
* Deliberately ONE endpoint rather than two: the two actions share every
* guard (method, origin, region, pool-enabled) and differ only in the work, so
* splitting them would duplicate the guards and invite them to drift apart.
*/
const WORKBUDDY_POOL_PATH = "/plugins/dsh-connect-workbuddy/pool";
/**
* Plugin-owned OAuth sign-in endpoint: one session step per call.
*
* `?action=start` asks the upstream for a login state and returns the URL to
* open; `?action=poll` (+ `loginId` in the body) reports whether the user
* finished, and on success persists the account into the vault. POST +
* loopback-only like the card's other mutations: the poll carries the login
* binding, and the Host-side session state must not be settable by another
* origin.
*/
const WORKBUDDY_OAUTH_PATH = "/plugins/dsh-connect-workbuddy/oauth";
/** Query parameter selecting which pool batch action a request means. */
const WORKBUDDY_POOL_ACTION_PARAM = "action";
/** Read the OAuth action off a request URL; unknown/absent means undefined. */
function oauthActionOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return void 0;
	const value = new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_POOL_ACTION_PARAM);
	return value === "start" || value === "poll" ? value : void 0;
}
/** Read the pool action off a request URL; unknown/absent means undefined. */
function poolActionOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return void 0;
	const value = new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_POOL_ACTION_PARAM);
	return value === "checkin" || value === "test" || value === "remove" ? value : void 0;
}
/** Query parameter naming ONE pool account a per-row request addresses. */
const WORKBUDDY_POOL_ACCOUNT_PARAM = "accountId";
/**
* Plugin-owned account transfer endpoint: the batch export / import of
* credentials between machines and between tools of the SAME format family.
*
* `?action=export` POSTs account ids, answers a JSON ARRAY of credential
* records; `?action=preview` POSTs file text, answers a token-free listing;
* `?action=import` POSTs file text plus selected indexes, merges into the
* vault. POST + loopback-only like every other mutation: the file content is
* arbitrary user data and export carries token material.
*/
const WORKBUDDY_TRANSFER_PATH = "/plugins/dsh-connect-workbuddy/transfer";
/**
* The CLI route's live turns, for the composer readout.
*
* A GET with no parameters and no region: a live turn is not scoped to a
* credential region (it is one spawned process), and the chip polls this on an
* interval, so it must stay cheap — the handler reads an in-memory board and
* serializes it, touching no upstream and no disk.
*
* The document is `{ turns: LiveTurnView[], serverTime: number }`. `serverTime`
* is the host's clock at serialization so the browser can derive an age from
* `startedAt` without trusting the two clocks to agree.
*/
const WORKBUDDY_CLI_LIVE_PATH = "/plugins/dsh-connect-workbuddy/cli-live";
/** Read the transfer action off a request URL; unknown/absent means undefined. */
function transferActionOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return void 0;
	const value = new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_POOL_ACTION_PARAM);
	return value === "export" || value === "preview" || value === "import" ? value : void 0;
}
/** Read the per-row account id off a request URL, when the action takes one. */
function poolAccountIdOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return void 0;
	const value = new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_POOL_ACCOUNT_PARAM);
	return value !== null && value !== "" ? value : void 0;
}
/** Query parameter naming the region a card request addresses. */
const WORKBUDDY_REGION_PARAM = "region";
/** Every region, in card tab order. */
const WORKBUDDY_REGIONS = ["cn", "global"];
/**
* Address one region's status route. The two regions are separate provider
* stacks; every card request carries the region whose tab the user is on.
*/
function withWorkBuddyRegion(path, region) {
	return `${path}?${WORKBUDDY_REGION_PARAM}=${region}`;
}
/**
* Query parameter selecting how much of a status document the Host assembles.
*
* The card's first paint only needs what local state already knows; live
* figures (credit, check-in, per-account readings) arrive through the SAME
* route once they have been measured. See {@link WORKBUDDY_DETAIL_FAST}.
*/
const WORKBUDDY_DETAIL_PARAM = "detail";
/**
* The `detail` value asking for the first-paint document.
*
* Absent means the full document, which is what every earlier caller asks for
* and what the route keeps answering — the parameter only ever ADDS a cheap
* mode, it never changes an existing one.
*/
const WORKBUDDY_DETAIL_FAST = "fast";
/**
* Whether a status-route URL asks for the first-paint document.
*
* Only the exact `fast` value is recognized: an unknown or misspelled value
* degrades to the full document, which is what every earlier caller already
* gets. A typo must never produce an emptier panel than no parameter at all.
*/
function fastDetailOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return false;
	return new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_DETAIL_PARAM) === WORKBUDDY_DETAIL_FAST;
}
/**
* Read the region parameter off a status-route URL. Absent means the domestic
* tab (`cn`); a present-but-unknown value returns undefined so the route can
* answer 400 instead of guessing.
*/
function regionOfStatusUrl(url) {
	const at = url.indexOf("?");
	const value = at === -1 ? null : new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_REGION_PARAM);
	if (value === null || value === "") return "cn";
	return WORKBUDDY_REGIONS.includes(value) ? value : void 0;
}
/**
* Narrow a settings value to the `regions` map. Accepts EITHER the whole
* settings section (the Host's resolved `Config`) OR the `regions` map itself,
* and unwraps the former. This tolerance is deliberate: passing the whole
* section where the map was expected was a real shipped bug in the sibling
* project — the lookup then read `section['cn']` (absent), so the card's
* checkbox reported `true` forever and clicking it appeared to do nothing even
* though the write succeeded.
*
* The resolved section delivers `regions` as a `{get(): T}` LIVE reference, and
* a live reference is `typeof === 'object'` and not an array — so it passes a
* naive object check and gets returned as if it were the map. Every lookup on
* it is then `undefined`: the enabled flag reads back as "on" forever (the very
* symptom described above), and a merge that spreads this map silently drops
* the region it was not editing. Unwrap before narrowing.
*
* THE HOP IS CONDITIONAL, and that is the whole point (a saved manual pool
* order "disappearing"). "Has a `regions` key" is NOT sufficient evidence that
* the caller passed the whole section: the `regions` MAP can legitimately carry
* a `regions` key of its own, because an earlier build could write a sibling
* field name into it — a live profile was found with `accounts`, `regions` and
* `cliBridge` sitting beside `cn` / `global`. Hopping there means reading a
* DIFFERENT, older copy of the same region: measured, the same document returned
* `['c','a','b']` when read as a section and `[]` when read as a map. So a value
* counts as the whole section only when it shows a key that is neither a region
* id nor a known sibling — i.e. it looks like a settings document. A plain (or
* dirty) `cn` / `global` map is returned as-is.
*
* THE RESULT IS HEALED, not merely narrowed — see {@link healedRegionsMap}.
* Returning the map "as-is" is what let a corrupted document keep reading as
* half-empty: the field held `cn` at level 0 and `global` only one level down,
* so every `global` question answered "never configured" even though the file
* still had the answer. Reads and writes both come through here, so healing
* here fixes both halves at once (the Host's `regionStateOf`, the card's
* `nextRegion*` write bases, and the catalog repair's write).
*/
function regionsMapOf(value) {
	const peeled = peelLiveReference(value);
	if (typeof peeled === "object" && peeled !== null && !Array.isArray(peeled)) {
		const candidate = peeled;
		if (!isRecord$1(candidate["regions"]) && !carriesForeignKey(candidate)) return candidate;
	}
	const unwrapped = unwrapVolatileDeep(value);
	if (typeof unwrapped !== "object" || unwrapped === null || Array.isArray(unwrapped)) return {};
	const record = unwrapped;
	const nested = record["regions"];
	if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return healedRegionsMap(record);
	return healedRegionsMap(hasRegionKey(record) ? record : nested);
}
/** `value` with ONE `{get(): T}` live reference peeled, exactly like a read. */
function peelLiveReference(value) {
	if (value === null || typeof value !== "object") return value;
	const get = value.get;
	return typeof get === "function" ? get() : value;
}
/** Whether the object carries a sibling-field name where a region id belongs. */
function carriesForeignKey(record) {
	return Object.keys(record).some((key) => REGION_MAP_FOREIGN_KEYS.has(key));
}
/**
* Names that belong to the settings SECTION (`Config` in `src/index.ts`) or to
* one region SLOT (`regionStateConfig`) — never to the `regions` map.
*
* They are the signature of a data-loss bug and the list that undoes it. From
* 5.4.0 to 5.5.0 `mergeRegionCatalog` was handed the WHOLE settings section but
* read it as the `regions` field, so every boot's directory repair wrote
* `{ accounts, regions, cliBridge }` INTO the field — replacing the region map
* and burying the real one under a `regions` key. A live profile ended up five
* levels deep (one per startup) and 258 KB of duplicated slots.
*
* Neither a region id (`cn` / `global`) nor any future one can collide with
* these names, so removing them from the map is safe, idempotent, and does not
* discard a region that a newer build might add.
*/
const REGION_MAP_FOREIGN_KEYS = /* @__PURE__ */ new Set([
	"authFile",
	"accountId",
	"accounts",
	"regions",
	"cliBridge",
	"enabled",
	"showCreditsInMainUi",
	"creditPosition",
	"lastCatalog",
	"enabledModelIds",
	"imageModelIds",
	"imageToolEnabled",
	"offModelIds",
	"contextBudgets",
	"pool"
]);
/** A non-null, non-array object: the only shape a slot or a level can have. */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Whether a map carries at least one real region id. */
function hasRegionKey(map) {
	return Object.keys(map).some((key) => WORKBUDDY_REGIONS.includes(key));
}
/**
* How much USER CONFIG one candidate slot actually carries.
*
* Used only when the map lost a region and the copies left at different depths
* disagree — and they do: the bug's own directory repair wrote a slot that held
* nothing but `lastCatalog` (it started from a map where the region was already
* missing), while the copy further down still holds the pool the user had
* checked in. "Shallowest wins" would therefore resurrect the EMPTY one and
* throw away the real configuration. Depth is not age in this wreckage; CONTENT
* is the only usable signal.
*
* Deliberately counts only non-default, user-authored values: resolved slots
* carry every schema default, so a slot's key count says nothing.
*/
function slotConfigWeight(slot) {
	let weight = 0;
	const pool = slot["pool"];
	if (isRecord$1(pool)) {
		if (pool["enabled"] === true) weight += 4;
		if (Array.isArray(pool["memberAccountIds"]) && pool["memberAccountIds"].length > 0) weight += 4;
		if (Array.isArray(pool["orderAccountIds"]) && pool["orderAccountIds"].length > 0) weight += 2;
		if (typeof pool["targetModelId"] === "string" && pool["targetModelId"] !== "") weight += 2;
		if (typeof pool["probeInputTokens"] === "number" && pool["probeInputTokens"] > 0) weight += 1;
	}
	for (const key of [
		"enabledModelIds",
		"imageModelIds",
		"offModelIds"
	]) {
		const list = slot[key];
		if (Array.isArray(list) && list.length > 0) weight += 1;
	}
	const budgets = slot["contextBudgets"];
	if (isRecord$1(budgets) && Object.keys(budgets).length > 0) weight += 1;
	if (slot["enabled"] === false) weight += 1;
	if (slot["showCreditsInMainUi"] === false) weight += 1;
	if (slot["imageToolEnabled"] === true) weight += 1;
	return weight;
}
/**
* The `regions` map with a corrupted document's wreckage removed.
*
* Two repairs, both keyed on the bug's signature (a foreign key or a nested
* `regions` copy) so a HEALTHY map passes through untouched:
*
*  1. DROP every key that names a section field or a slot field. Those are the
*     copies the bug wrote; keeping them means the next save carries them
*     forward forever.
*  2. RECOVER a region this level does not have from the copies buried beneath
*     it. A region that IS here is never replaced — the outer copy is the one
*     the surviving writers have been updating, and re-reading a stale inner
*     copy over it is exactly the defect the shape rule above was fixed for.
*
* Recovery exists because `global` in the measured profile lived ONLY one level
* down: without it, the host reads that region as "never configured" and the
* first write after the fix would delete the user's international pool outright.
*
* Among the buried copies of a MISSING region, the one carrying the most user
* configuration wins rather than the shallowest — see {@link slotConfigWeight}:
* the bug's own directory repair left `{ lastCatalog }` slots that look newer
* but hold nothing, one level above the copy with the pool still in it.
*/
function healedRegionsMap(map) {
	const healed = {};
	for (const [key, slot] of Object.entries(map)) {
		if (REGION_MAP_FOREIGN_KEYS.has(key)) continue;
		healed[key] = slot;
	}
	const recovered = {};
	let deeper = map;
	for (let depth = 0; depth < 8; depth += 1) {
		const nested = deeper["regions"];
		if (!isRecord$1(nested)) break;
		for (const region of WORKBUDDY_REGIONS) {
			if (region in map) continue;
			const candidate = nested[region];
			if (!isRecord$1(candidate)) continue;
			const weight = slotConfigWeight(candidate);
			const best = recovered[region];
			if (best === void 0 || weight > best.weight) recovered[region] = {
				slot: candidate,
				weight
			};
		}
		deeper = nested;
	}
	for (const [region, entry] of Object.entries(recovered)) healed[region] = entry.slot;
	return healed;
}
/**
* Whether the stored `regions` FIELD still carries the debris described at
* {@link REGION_MAP_FOREIGN_KEYS}.
*
* Pass the field itself (`Config['regions']`), not the whole section: the
* section legitimately has `accounts` / `cliBridge` beside `regions`, so asking
* that question of a section would always answer "corrupt".
*
* The catalog repair uses it to write even when the model directory already
* matches: without that, a profile whose directory is in agreement would never
* be cleaned — the very shape that made the pool look unsaved would outlive the
* fix that stops producing it.
*/
function regionsFieldIsCorrupt(value) {
	const unwrapped = unwrapVolatileDeep(value);
	if (!isRecord$1(unwrapped)) return false;
	return Object.keys(unwrapped).some((key) => REGION_MAP_FOREIGN_KEYS.has(key));
}
/** One region's stored slot as a plain object; any other shape reads as empty. */
function regionSlotOf(value, region) {
	const slot = regionsMapOf(value)[region];
	return typeof slot === "object" && slot !== null && !Array.isArray(slot) ? slot : {};
}
/**
* Whether one region's provider is switched on. Opt-out semantics: only an
* explicit `false` disables it, so a config written before this switch existed
* (and the pre-region-split flat fields, which never carry `enabled`) keep both
* providers running exactly as before. The Host reads the same rule through
* `regionStateOf`, so card and Host can never disagree about a region's state.
*
* `value` may be the whole settings section or the `regions` map (see
* {@link regionsMapOf}).
*/
function regionEnabledOf(value, region) {
	return regionSlotOf(value, region)["enabled"] !== false;
}
/** Build the next `regions` settings value for a signed-in tab's save. */
function nextRegionSlots(regions, region, slot) {
	return {
		...typeof regions === "object" && regions !== null && !Array.isArray(regions) ? regions : {},
		[region]: slot
	};
}
function nextRegionEnabled(value, region, enabled) {
	return nextRegionSlots(regionsMapOf(value), region, {
		...regionSlotOf(value, region),
		enabled
	});
}
/**
* The per-region account SELECTIONS map (`Config.accounts`), as plain data.
*
* `value` may be the whole settings SECTION or the `accounts` FIELD: `describe()`
* hands back the section with volatile fields as live references, and a blind
* spread of that leaks the `get()` function into a write payload — the settings
* service then refuses the whole save with `found a function at $.ops[0].value.get`
* (measured at the card's save endpoint, `src/web-status.ts`). Unwrapping first is
* what makes the merge carry data and not behaviour.
*
* The map is recognised by its KEYS, not by its shape: only region ids can appear
* in it, while a section always carries at least one non-region key (`authFile`,
* `regions`, `cliBridge`). Same direction as {@link regionsMapOf} chose for the
* reason documented there — a nested copy is a DIFFERENT, older value, so the
* outer object's own keys decide what it is.
*/
function accountsMapOf(value) {
	const unwrapped = unwrapVolatileDeep(value);
	if (!isRecord$1(unwrapped)) return {};
	if (hasRegionKey(unwrapped)) return unwrapped;
	const nested = unwrapVolatileDeep(unwrapped["accounts"]);
	return isRecord$1(nested) ? nested : {};
}
/**
* Build the next `accounts` FIELD for one region's selection.
*
* ONLY the target region's key changes; the sibling region is carried over
* verbatim. `accounts` is a flat two-key map that BOTH regions write, so a
* whole-field write that rebuilt it from one caller's view would drop the other
* region's pin — the failure mode every other `next*` helper in this file exists
* to prevent, in a field that is easier to clobber because it looks trivial.
*
* The value is written as given, including `''`. That distinction is load-bearing
* and not a detail: `''` is the Clear sentinel ("this region follows the app's
* current sign-in"), while an ABSENT key means "never configured" and still falls
* back to the legacy flat `accountId` — see `selectAccountFor`. A helper that
* deleted the key to "clear" a region would silently re-bind it to whichever
* account the legacy field names.
*/
function nextAccountsSelection(value, region, accountId) {
	return {
		...accountsMapOf(value),
		[region]: accountId
	};
}
/**
* Whether one region's selection is PERSISTENTLY bound to this account id.
*
* THE QUESTION {@link nextAccountsSelection} MUST ANSWER BEFORE WRITING. Two
* persisted sources can pin an account, and clearing only the obvious one leaves
* the other in place:
*
* 1. `accounts[region]` — the per-region slot, the current spelling.
* 2. the deprecated flat `accountId`, which `selectAccountFor` falls back to for
*    the ONE region the startup scan attributed it to (`legacyAccountRegion`) and
*    only when that region's slot is ABSENT. A pre-split profile therefore pins
*    its account through field 2 while field 1 holds nothing at all — and that
*    is precisely a profile whose user can remove an account and inherit an
*    orphaned pin.
*
* `accounts[region] === ''` answers `false` even when the id matches nothing: the
* sentinel means "this region follows the app's current sign-in", which already
* cannot point at a dead account, so there is nothing to clear and a write would
* be noise (and a needless settings round trip).
*
* @param value the resolved settings section, or the `accounts` field.
* @param region the region whose pin is being questioned.
* @param accountId the account about to be removed.
* @param legacyAccountId the deprecated flat `accountId`, read as persisted.
* @param legacyRegion which region the startup scan attributed that flat id to.
*/
function regionPinsAccount(value, region, accountId, legacyAccountId, legacyRegion) {
	const configured = accountsMapOf(value)[region];
	if (configured !== void 0) return configured === accountId;
	return legacyAccountId !== void 0 && legacyAccountId === accountId && legacyRegion === region;
}
/**
* Project one card row into its persisted `lastCatalog` shape: the native
* context window becomes the stored `contextWindow`, and the card-only
* presentation fields (`nativeContextWindow`, `multimodal`) are removed BY
* KEY. They must never be set to `undefined`: explicit `undefined` values
* survive `structuredClone` and are rejected by the settings write path's
* strict JSON codec (`client api: settings/mutate rejected "ops"`), which
* fails the whole save.
*/
function toPersistedWorkBuddyModel(model) {
	const { nativeContextWindow, multimodal: _cardOnly, ...rest } = model;
	return {
		...rest,
		contextWindow: nativeContextWindow
	};
}
/**
* Deep copy of a settings value with every `{get(): T}` live reference replaced
* by the value it resolves to.
*
* `regions` and `accounts` are declared `asVolatile(...)`, and schemastery
* resolves a volatile field to a live reference. That resolution happens in
* schemastery itself, driven by the schema's `meta.volatile`, so it is
* independent of the DSH line — the resolved section looks like this to the
* browser half on BOTH 0.1.5 and 0.1.7.
*
* A live reference is still `typeof === 'object'`, so `{ ...reference }` does
* NOT read the field: it produces `{ get: <function> }`. Any caller that
* spreads the resolved field to preserve its siblings — the card's
* "write one region, keep the other" merge — would otherwise DROP every
* sibling and leak a function into the document. Both halves therefore unwrap
* before touching a resolved field.
*
* Lives here, not in the Host entry, because the browser half needs it too and
* this module is the node-free bridge between the two.
*
* Non-reference values are recursed into so a nested volatile field is caught
* too — arrays and objects are rebuilt rather than mutated, so the caller's
* value is never touched.
*/
function unwrapVolatileDeep(value) {
	if (value === null || typeof value !== "object") return value;
	if (typeof value.get === "function") return unwrapVolatileDeep(value.get());
	if (Array.isArray(value)) return value.map((entry) => unwrapVolatileDeep(entry));
	const source = value;
	const out = {};
	for (const key of Object.keys(source)) out[key] = unwrapVolatileDeep(source[key]);
	return out;
}
/**
* The plugin's DECLARED settings namespace — the fallback name, not the value
* the host necessarily serves.
*
* On 0.1.7 the settings service keys every form by the plugin's Loader entry id
* (`describe()` returns `ns: entry.options.id`), and the harness resolves a
* provider's namespace by EXACT match. The entry id is chosen by the profile
* patch, so a plugin cannot know it in advance — the live Desktop host mounts
* this one as `include:dsh-connect-workbuddy`.
*
* Lives here, not in the Host entry, because the browser half needs the same
* fallback and must not import Node-only host code.
*/
const WORKBUDDY_SETTINGS_NS = "workbuddy";
//#endregion
//#region src/catalog-write.ts
/**
* Writing the model's saved directory back to the Host's settings document.
*
* THE HOST-SIDE HALF OF ISSUES #114/#115. The card's own save path lives in the
* browser half (`src/client/`), but the repair that heals a STALE saved
* directory has to happen where the LIVE roster lands — inside the Host
* process, right after the upstream answered. So this module writes through
* the Host's own settings service, using the same merge discipline the
* browser half uses (see `src/web-status.ts`).
*
* WHY NOT JUST WRITE THE WHOLE `regions` FIELD. Because the field holds
* BOTH regions plus each region's account-pool preferences, and a blind write
* would drop whatever the user changed in the other region (issue #32's
* lesson, in a new place). So the write is a MERGE: the region's slot is
* replaced, every other key of the slot is preserved, and the sibling region
* is untouched.
*
* THE VALUE THIS MODULE WRITES IS THE `regions` FIELD, NOT THE SETTINGS
* SECTION. That distinction is the whole of this bug — reported as
* "账号池状态重启就失效". `describe()` hands back the resolved SECTION
* (`{authFile, accounts, regions, cliBridge, …}`), and
* `mutate(ns, [{ op: 'set', path: ['regions'], … }])` stores whatever it is
* given AT that path. Handing it the section therefore wrote the section INTO
* the field: the real region map was pushed down under a nested `regions` key,
* its own siblings (`accounts`, `cliBridge`) became fake region slots, and the
* Host's `regionStateOf(config, 'cn')` — which reads exactly one level — then
* answered "no slot". Every account-pool preference, model selection and
* directory looked unsaved after the next restart, and each startup added
* another level (measured on a live profile: five levels, 258 KB).
*
* WHY THE HOST SERVICE RATHER THAN THE SCOPE. The plugin's browser half
* writes through the Host's settings endpoint because the browser-side
* `scope.set()` replaces the whole field with the browser's own (possibly
* stale) mirror — that is documented at `src/client/account-selection.ts`.
* The same reasoning applies here: there is no browser mirror in the Host
* process, so the Host's own merge is the only safe writer.
*
* @module dsh-connect-workbuddy/catalog-write
*/
/**
* Merge one region's repaired directory into the `regions` FIELD.
*
* `current` may be EITHER the resolved settings section (what `describe()`
* answers, and what {@link writeRegionCatalog} passes) OR the bare `regions`
* field; `regionsMapOf` narrows both and heals a document the bug above already
* corrupted. The RETURN value is always the field itself — the exact shape
* `path: ['regions']` expects — never the section around it.
*
* The merge is done on the AUTHORITATIVE value the settings service holds —
* not on a snapshot the caller brought — because a snapshot can be stale and
* a stale merge is how the other region disappears.
*/
function mergeRegionCatalog(current, region, catalog) {
	const regions = regionsMapOf(current);
	const stored = regions[region];
	const slot = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? stored : {};
	return {
		...regions,
		[region]: {
			...slot,
			lastCatalog: catalog
		}
	};
}
/**
* Write one region's repaired directory.
*
* @param service The Host's settings service.
* @param ns The namespace the Host serves this plugin under.
* @param region The region whose slot is repaired.
* @param catalog The repaired directory.
* @returns whether the write happened.
*/
async function writeRegionCatalog(service, ns, region, catalog) {
	if (service === void 0) return false;
	const row = service.describe().find((entry) => entry.ns === ns);
	if (row === void 0) return false;
	const next = mergeRegionCatalog(unwrapVolatileDeep(row.value ?? {}), region, catalog);
	await service.mutate(ns, [{
		op: "set",
		path: ["regions"],
		value: next
	}], void 0);
	return true;
}
/**
* Clean a `regions` field an older build corrupted, WITHOUT touching any
* region's content.
*
* WHY THIS IS SEPARATE FROM {@link writeRegionCatalog}. The catalog repair is
* the writer that produced the wreckage, so it is also a natural place to clean
* it — but it only runs when the live roster arrived (an enabled region, a
* reachable upstream, a non-empty answer). A profile would therefore stay dirty
* for as long as the network is down, and a region the user has switched OFF
* would never be cleaned at all. This write needs neither: it is one settings
* round-trip at boot, and it is a no-op for every healthy profile (a single key
* scan, no mutation).
*
* It is a pure shape fix, not a merge: `regionsMapOf` already answers the
* healed map, and the field is replaced with exactly that. Reads are correct
* without this write (they narrow through the same helper), so failing to write
* costs tidiness only — the caller logs and carries on.
*
* @returns whether the write happened.
*/
async function healRegionsField(service, ns) {
	if (service === void 0) return false;
	const row = service.describe().find((entry) => entry.ns === ns);
	if (row === void 0) return false;
	const section = row.value ?? {};
	if (!regionsFieldIsCorrupt(section["regions"])) return false;
	await service.mutate(ns, [{
		op: "set",
		path: ["regions"],
		value: regionsMapOf(section)
	}], void 0);
	return true;
}
/**
* Drop one region's PERSISTED account selection, and only if it pinned this
* account.
*
* THE HOST-SIDE HALF OF ISSUE #155'S SECOND REPORT. A user removed one account
* and the whole CN tab turned into「已保存的账号在本机已不存在」, with no way back:
* the card's advice points at a list it does not render in that state, so the
* reporter escaped by hand-posting `{"field":"accounts","value":{"cn":""}}` to
* the save endpoint. This is that write, made automatic.
*
* WHY A WRITE AT ALL — the store already forgets. `removeAccount` clears the
* in-memory selection, which is why the region keeps working for the rest of the
* session. But the settings document still names the dead id, so the next
* `applySelection` — a restart, or any settings save — re-reads it, re-pins it,
* and the region falls back into the same dead end. An in-memory forget that is
* never persisted is not a fix; it is a delay.
*
* THE DECISION LIVES HERE, WITH THE WRITE, because the two must never be
* separated by a caller's guess. Clearing a region that did NOT pin this account
* would move the user off the account they chose, and「换账号等于换人计费」is the
* rule every writer in this plugin obeys: this function writes for exactly the
* region whose persisted pin names the account being removed, and no others.
*
* WRITES `''`, NEVER A DELETED KEY. The sentinel means "follow the app's current
* sign-in" — the plugin's documented default, which is what a fresh install does,
* so this restores a state rather than inventing one. An absent key means "never
* configured" and falls through to the legacy flat `accountId` (`selectAccountFor`),
* which would resurrect whichever account that field names: a silent switch
* through another door. The sentinel also TERMINATES that lookup, which is why one
* write settles both spellings — a pre-split profile pinned through the flat
* field is cleared by this same write.
*
* FAIL-SOFT BY CONTRACT: a service that cannot answer, or a region that pinned
* nothing, costs no write. The caller logs a failed mutation rather than failing
* the removal, because the credential file is already gone by then and reporting
* "could not remove" would be the lie.
*
* @param service The Host's settings service, or `undefined` to no-op.
* @param ns The namespace this plugin's settings live under.
* @param region The region being checked; the sibling is preserved by the merge.
* @param accountId The account about to be removed.
* @param legacyAccountId The deprecated flat `accountId`, as persisted.
* @param legacyRegion Which region the startup scan attributed that field to.
* @returns whether a write happened.
*/
async function clearRegionAccountSelection(service, ns, region, accountId, legacyAccountId, legacyRegion) {
	if (service === void 0) return false;
	const row = service.describe().find((entry) => entry.ns === ns);
	if (row === void 0) return false;
	const section = row.value ?? {};
	if (!regionPinsAccount(section, region, accountId, legacyAccountId, legacyRegion)) return false;
	await service.mutate(ns, [{
		op: "set",
		path: ["accounts"],
		value: nextAccountsSelection(section, region, "")
	}], void 0);
	return true;
}
//#endregion
//#region src/credential-recovery.ts
/** How long a verdict stays fresh by default. */
const DEFAULT_PROBE_TTL_MS = 6e4;
/**
* Cached "is this account still accepted upstream?" probe.
*
* The cache key includes the credential's own `lastRefreshAtMs`, so a fresh
* sign-in (which rewrites the file's issuance time) invalidates a stale verdict
* automatically — a rejection recorded before the user signed in again cannot
* keep labelling the account unusable afterwards, and no explicit invalidation
* is needed.
*/
function createAccountUsabilityProbe(options) {
	const ttlMs = options.ttlMs ?? DEFAULT_PROBE_TTL_MS;
	const now = options.now ?? Date.now;
	const verdicts = /* @__PURE__ */ new Map();
	return async (region, account) => {
		let credential;
		try {
			credential = await options.store(region).credentialFor(account.id);
		} catch {
			return false;
		}
		if (credential === void 0) return false;
		const key = `${region}\0${account.id}\0${credential.lastRefreshAtMs ?? credential.expiresAtMs}`;
		const cached = verdicts.get(key);
		if (cached !== void 0 && now() - cached.at < ttlMs) return cached.usable;
		let usable = false;
		try {
			await options.client.fetchCheckinStatus(credential);
			usable = true;
		} catch {
			usable = false;
		}
		verdicts.set(key, {
			at: now(),
			usable
		});
		return usable;
	};
}
/**
* Decide what to tell the user after the upstream refused the selected
* credential: switch to a verified-usable account, or sign in again.
*
* The two answers are mutually exclusive by construction. `reloginRequired` is
* set ONLY when there is no other local account to switch to — never as a
* fallback for "the probe did not verify anything", because that would repeat
* the misdirection this module exists to remove. When other accounts exist but
* none was verified, both fields stay empty and the card says so honestly.
*/
async function resolveCredentialRecovery(options) {
	let accounts;
	try {
		accounts = await options.store.accounts();
	} catch {
		return { reloginRequired: false };
	}
	const others = accounts.filter((account) => account.id !== options.rejectedAccountId);
	if (others.length === 0) return { reloginRequired: true };
	for (const account of others) if (await options.probe(options.region, account)) return {
		usableAccount: {
			accountId: account.id,
			accountName: account.accountName
		},
		reloginRequired: false
	};
	return { reloginRequired: false };
}
/** How the display copy names each campaign. */
const WORKBUDDY_BENEFIT_TITLES = {
	compensation: "模型服务异常补偿",
	gift: "新人首月赠送"
};
/**
* Resolve one campaign against the clock.
*
* `active` is the gateway's own window verdict and is trusted as-is; the clock is
* consulted only for the countdown, never to override `active`. An account whose
* clock is skewed therefore still renders the upstream's answer rather than a
* locally-invented one.
*/
function benefitOf(benefit, nowMs) {
	const daysLeft = benefit.endsAtMs === void 0 ? void 0 : Math.max(0, Math.ceil((benefit.endsAtMs - nowMs) / 864e5));
	const state = benefit.claimed ? "claimed" : benefit.active ? "claimable" : "expired";
	return {
		kind: benefit.kind,
		state,
		creditNum: benefit.creditNum,
		...benefit.endsAtMs === void 0 ? {} : { endsAtMs: benefit.endsAtMs },
		...daysLeft === void 0 ? {} : { daysLeft },
		urgent: state === "claimable" && daysLeft !== void 0 && daysLeft <= 3
	};
}
/**
* The claimable campaigns of one account, urgent first.
*
* Ordered by `daysLeft` ascending so the soonest-expiring offer leads — the whole
* point of surfacing this is that a 3-day window otherwise lapses unnoticed. A
* campaign with no stated end sorts last, because "no deadline" is never more
* urgent than a deadline.
*
* `claimed` and `expired` campaigns are dropped here, not in the renderer: the
* user asked for them to be ABSENT, and encoding that in one tested place beats
* asking every caller to remember to filter.
*/
function claimableBenefits(benefits, nowMs) {
	return benefits.map((benefit) => benefitOf(benefit, nowMs)).filter((view) => view.state === "claimable").sort((left, right) => (left.daysLeft ?? 1e6) - (right.daysLeft ?? 1e6));
}
//#endregion
//#region src/adapter.ts
/**
* The WorkBuddy pi-ai providers: loopback-backed adapters registered
* into the Harness LLM seam, assembled from public `dsh-llm-pi-ai`
* extension points. One instance per region — `workbuddy` for the domestic
* gateway, `workbuddy-global` for the international one — each pointing at
* its own shim and catalog so the two regions serve simultaneously.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — pi-ai provider 的装配方式（createProvider + openAICompletionsApi +
*     inert auth plane + 用 shim 的进程内 secret 作为 apiKey）由该项目实现；
*   DSH 插件结构与 provider 注册的思路参照
*     franksong2702/dsh-codex-connect（Apache-2.0），经其转引。
* 改动：模型描述符补上 upstream 给出的多模态与推理档位信息（若有），
*   供 DSH 的能力判断使用；工厂参数化 provider id，支持双区域实例。
*
* @module dsh-connect-workbuddy/adapter
*/
/** Provider route this bundle owns for the domestic (CN) gateway. */
/**
* The tier a request gets when it names none — compaction summaries, above all
* (issue #83). See the `reasoning` field in `profileFor` for why an absent
* default is not "no opinion" but "whatever pi-ai's level map says", which is
* how `off` became the silent default for `/compact`.
*/
const WORKBUDDY_DEFAULT_EFFORT = "high";
const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider route this bundle owns for the international gateway. */
const WORKBUDDY_GLOBAL_PROVIDER = "workbuddy-global";
/** The provider id each region registers as. */
const WORKBUDDY_PROVIDERS = {
	cn: WORKBUDDY_PROVIDER,
	global: WORKBUDDY_GLOBAL_PROVIDER
};
/**
* Model identity BOTH regions stamp on their models — the fix for issue #59.
*
* pi-ai keeps a historical thinking block as `thinking` only when the message
* that carried it names the SAME provider, api and model id as the request in
* flight (`transform-messages.js:68`); every other block is downgraded to plain
* `text` (`:88–96`) — downgraded, not dropped, which is why no byte count ever
* explained the 1.94× regional jump. The two gateways are two provider STRINGS
* for ONE model, so a transcript recorded in one region was replayed as text in
* the other, and issue #59's reporter measured exactly that: 708K → 1.374M on
* byte-identical history, and a compression request that could then never fit
* the window it was computed for.
*
* The stamp is NOT inert, and reading it as inert is what broke issue #75.
* `provider` is the KEY pi-ai dispatches on: `requireProvider` resolves
* `this.providers.get(model.provider)` and throws
* `Unknown provider: ${model.provider}` when it is absent (`models.js:410–416`
* on the host's 1.1.0, `:351–357` on the 0.85.1 this repo resolves), and
* `getAuth` resolves the same key, answering `Provider is not configured`
* instead (`:334–341` and `:429`; `:275–280` and `:366` on 0.85.1). Both sit on
* the LIVE chat path: `dsh-llm-pi-ai` streams through
* `snapshot.models.streamSimple(model, …)` (`lib/index.js:1983`), which calls
* `requireProvider` before a byte is sent (`models.js:454–459`). Each region
* builds its OWN registry from its own adapter — `current()` registers
* `profile.piProvider` per profile (`lib/index.js:1852–1862`) — so the
* `workbuddy-global` region registered only `workbuddy-global` and could not
* dispatch a model stamped `workbuddy`: every request failed with
* `Unknown provider: workbuddy` before reaching the gateway.
* {@link modelIdentityKeysOf} is the correction: the identity has to be a
* registry key of its own in every region, or the stamp cannot be shared.
*
* Lookup by ROUTE is a separate question and stays intact: `getModel(provider,
* id)` is `getModels(provider).find(...)` (`models.js:116–118`), i.e. it goes
* through the map key, while the STAMPED field is whatever the provider put
* there. So the route stays `workbuddy`/`workbuddy-global` (each with its own
* shim, catalog and credential store) while every model it serves advertises
* THIS id. The openai-completions api reads `model.provider` only for
* provider-specific quirks (none of which match these ids) and as an
* error-message label.
*
* Deliberately NOT the same string as the global route: a message is only
* same-model when provider, api AND model id all match, so the shared id must
* not be reachable as a route a user could pick — it names one model, not one
* gateway. It IS reachable as a pi-ai registry key, which is the point: those
* are internal and never surface as a route, because `registerAdapter` takes
* the route list explicitly (`dsh-llm/lib/index.js:1842–1861`,
* `prepareRoutes` `:1867–1885`) and this plugin passes exactly the two region
* ids (`src/index.ts:2069–2086`).
*/
const WORKBUDDY_MODEL_IDENTITY = "workbuddy";
/**
* The api string `dsh-llm-pi-ai` stamps on a replayed message it could not
* rebuild natively (`foreignAssistant()`), i.e. a message that went through the
* host's fallback path rather than this plugin's own request builder.
*
* It is the ONLY api value {@link alignAssistantIdentities} repairs, because it
* is the only one that proves the field is a host marker instead of a shape this
* plugin really produced.
*/
const HOST_FOREIGN_API = "dsh-foreign";
/**
* Registry keys an adapter serving `providerId` must publish so that every
* stamp its models carry resolves inside its own region (issue #75).
*
* The route id first, then the model identity, de-duplicated — route-first so
* `profiles()` opens with the route the adapter actually serves. CN yields one
* key (`workbuddy` is both its route and the shared identity) and the global
* region yields two (`workbuddy-global`, `workbuddy`); the two regions
* therefore publish different key sets, and each must publish the shared one.
*
* `identity` is a parameter because {@link WorkBuddyAdapterOptions.modelIdentity}
* can override the stamp: the keys have to follow the stamp, or a test that
* stamps a per-region id would get the production keys back.
*/
function modelIdentityKeysOf(providerId, identity = WORKBUDDY_MODEL_IDENTITY) {
	return [...new Set([providerId, identity].filter((key) => key !== void 0))];
}
/** Region a provider route id belongs to. */
function regionOfProvider(provider) {
	for (const [region, id] of Object.entries(WORKBUDDY_PROVIDERS)) if (id === provider) return region;
}
/** Human-readable provider name, shown in the DSH model picker. */
const WORKBUDDY_PROVIDER_DISPLAY_NAMES = {
	cn: "WorkBuddy",
	global: "WorkBuddy Global"
};
/** Provider idle ceiling while one stream read is outstanding. */
const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Image-request budgets at the dsh-llm-pi-ai defaults; the profile type made
* them required in 0.1.1-rc.2.
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576
};
/**
* Inert pi-ai auth plane. The workbuddy route authenticates only through the
* shim shared secret resolved per request by `resolveApiKey`, so pi-ai's own
* credential lifecycle and ambient discovery must never manufacture a
* credential for it. `PiAiAdapterOptions.auth` is required since 0.1.1-rc.2;
* every ambient question here answers "nothing stored, nothing set".
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-connect-workbuddy: the workbuddy route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/** No per-token pricing is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
const THINKING_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** pi-ai input modalities: images only when WorkBuddy advertises them. */
function workBuddyModelInput(info) {
	return info.multimodal === true ? ["text", "image"] : ["text"];
}
/**
* DSH-facing display name: the model name plus the upstream credit multiplier,
* spelled the way WorkBuddy's own selector does (`GLM-5.3 · x0.79`).
*
* Display-only by construction: every DSH-side join keys on the model id —
* the selector's current choice (`provider` + `model`), the durable
* `model/selection` / `request/header` session events, the agent default-model
* settings, and the request wire (`model: <id>` reaching the shim). A model
* without a parsed multiplier keeps its bare name; a zero multiplier shows
* `x0.00`, matching WorkBuddy's rendering of free models.
*/
function workBuddyDisplayName(info) {
	return info.creditMultiplier === void 0 ? info.name : `${info.name} · x${info.creditMultiplier.toFixed(2)}`;
}
/**
* Map only levels advertised by WorkBuddy; undeclared DSH levels stay unavailable.
*
* `off` is offered EXACTLY when `canDisableThinking === true` and withheld
* (mapped to `null`) otherwise. `null` is pi-ai's "this level is not
* supported": `getSupportedThinkingLevels` filters on `mapped === null`, and
* `openai-completions` reads `thinkingLevelMap?.off !== null` to decide whether
* it may send a thinking-disabled request.
*
* This condition used to be inverted (`!== true` set the null), which locked
* `off` OFF for precisely the models that CAN disable thinking while leaving it
* ON for those that cannot. It stayed invisible because the only test probed
* the `canDisableThinking: false` half, which the inverted form also passes.
*
* The value read here is already the EFFECTIVE one: the runtime catalog is
* stamped by `withEffectiveOff()` before it reaches the adapter, so this is the
* user's `off` selection when they made one — except for the ids on
* `REFUSES_OFF_MODEL_IDS`, which the stamp forces to `false` no matter what the
* user asked for (issue #83: this level, once ticked, also became the IMPLICIT
* default for every request that carries no effort at all, which is how
* compaction went to 100% failure). The table is re-checked here as well so the
* wall does not depend on every caller remembering to stamp first.
*
* Absence is "unknown" and stays unoffered, matching how the rest of the plugin
* treats undeclared capability.
*/
function workBuddyThinkingLevelMap(info) {
	const supported = info.reasoning?.supportedEfforts?.filter((effort) => THINKING_LEVELS.includes(effort));
	if (supported === void 0 || supported.length === 0) return void 0;
	const map = Object.fromEntries(THINKING_LEVELS.map((level) => [level, supported.includes(level) ? level : null]));
	if (info.reasoning?.canDisableThinking === true && !offRefused(info.id)) map.off = "off";
	else map.off = null;
	return map;
}
/**
* Build one pi-ai model descriptor pointing at the loopback shim.
*
* `identity` — not the route id — is what `provider` carries; see
* {@link WORKBUDDY_MODEL_IDENTITY} for why the two must differ. The route the
* model is REACHED by is the registry key the adapter serves, while this
* stamped field is what pi-ai resolves the provider BY (issue #75) — so every
* key in {@link modelIdentityKeysOf} must be a key this route registers.
*/
function toPiModel(info, baseUrl, identity = WORKBUDDY_MODEL_IDENTITY) {
	const thinkingLevelMap = workBuddyThinkingLevelMap(info);
	return {
		id: info.id,
		name: workBuddyDisplayName(info),
		api: "openai-completions",
		provider: identity,
		baseUrl,
		input: workBuddyModelInput(info),
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		reasoning: thinkingLevelMap !== void 0,
		...thinkingLevelMap === void 0 ? {} : { thinkingLevelMap },
		compat: { supportsReasoningEffort: thinkingLevelMap !== void 0 }
	};
}
/**
* Rewrite a pi-ai 0.87-shaped transcript into the 0.85 shape this plugin's
* pi-ai understands — prompt AND tools.
*
* WHY THIS EXISTS (issue #24). pi-ai 0.87's `normalizeContext` moves the system
* prompt INTO `messages` as `{ role: 'system', content: '<string>' }`. pi-ai
* 0.85's own `Message` union has no `system` variant
* (`UserMessage | AssistantMessage | ToolResultMessage`), so its
* `estimateMessageTokens` has no branch for one: `for (const block of
* message.content)` iterates the CONTENT STRING character by character, `block`
* is a single character, and `block.name.length` throws
* `Cannot read properties of undefined (reading 'length')`.
*
* That crash happens inside the library, in `buildBaseOptions ->
* clampMaxTokensToContext -> estimateContextTokens`, i.e. BEFORE any request is
* built — so every model fails instantly and no upstream traffic is sent. A
* host running 0.87 hands us the normalized transcript while our own provider
* is 0.85, and the plugin cannot patch the library. What it CAN do is not hand
* a 0.87 transcript to a 0.85 API object.
*
* The 0.87 transcript carries MORE than the prompt on that leading system
* message: `toolsAdded` (and `toolsRemoved`) are the ONLY place the tool
* declarations live — `normalizeContext` deleted the top-level `tools` field,
* and 0.85's api reads tools ONLY from `context.tools`. So folding the text
* without promoting the tool state would trade issue #24's loud crash for
* issue #26's silent one: models that can never emit a `toolCall` because the
* request never declared any tools. The fold here promotes both, replaying
* every system message's `toolsRemoved`/`toolsAdded` in order — exactly the
* merge pi-ai 0.87's own `getCurrentTools` performs — and leaves an existing
* top-level `tools` array untouched.
*
* Deliberately SHAPE-based within the legacy branch, not version-based: it
* asks "does this context carry a system message inside `messages`?" rather
* than "which pi-ai version is loaded?". A version check would be wrong the
* moment either side moves. Which BRANCH runs at all IS generation-gated —
* see {@link withLegacyContext}: a modern (0.87+) api consumes this very
* transcript natively, and folding for it would destroy its only carrier of
* prompt and tools (issues #25/#26).
*
* Returns the SAME object when there is nothing to adapt — in particular when
* `systemPrompt` is already set (the native 0.85 shape), so the ordinary path
* is byte-for-byte untouched.
*
* Two guards beyond the 0.87 fold, both about a request reaching the upstream
* with NO system message — which the international gateway refuses outright
* (business code 11128) while the domestic one tolerates:
*
* - an EMPTY `systemPrompt` is treated as absent rather than "already set".
*   pi-ai emits the prompt under `if (context.systemPrompt)`, so an empty one
*   produces no system message at all and pi-ai demotes any `system` entry still
*   in `messages` to `user`. Falling through here lets a real system message
*   that IS present in `messages` be folded up and preserved.
* - when nothing supplies a prompt, {@link WORKBUDDY_FALLBACK_SYSTEM_PROMPT} is
*   used, because a placeholder beats a guaranteed 400. A system message whose
*   text is empty but which carries `toolsAdded` still folds its TOOLS up; the
*   placeholder for the missing prompt then comes from `ensureSystemHead` at
*   the wire (the last of the three layers).
*
* LEGACY-ONLY. This is the inverse direction from {@link foldModernContext}:
* it produces the FLAT `{systemPrompt, tools, messages}` shape that ONLY
* pi-ai 0.85 reads. Never hand its result to a 1.x api — 1.x reads tools from
* `messages[].toolsAdded` and would see none (issues #25/#26). Type note: the
* parameter is the 0.85 `Context`; pi-ai 1.1.0 types the api's second parameter
* as `TranscriptContext`, so this function cannot be called with 1.x typings —
* that is intentional, and it is why the modern branch below does not touch it.
*/
function adaptLegacyPiAiContext(context) {
	if (context === null || typeof context !== "object") return context;
	if (context.systemPrompt) return context;
	const messages = Array.isArray(context.messages) ? context.messages : void 0;
	if (messages === void 0) return context;
	const systemTexts = [];
	const rest = [];
	const toolState = /* @__PURE__ */ new Map();
	let sawSystemMessage = false;
	for (const message of messages) {
		if (message?.role !== "system") {
			rest.push(message);
			continue;
		}
		sawSystemMessage = true;
		const text = systemTextOf(message);
		if (text !== "") systemTexts.push(text);
		replayToolState(message, toolState);
	}
	const head = rest[0];
	const needsFallback = !sawSystemMessage && head !== void 0 && head.role !== "system";
	if (!sawSystemMessage && !needsFallback) return context;
	const systemPrompt = systemTexts.length > 0 ? systemTexts.join("\n\n") : sawSystemMessage ? void 0 : WORKBUDDY_FALLBACK_SYSTEM_PROMPT;
	const tools = Array.isArray(context.tools) ? void 0 : [...toolState.values()];
	return {
		...context,
		...systemPrompt === void 0 ? {} : { systemPrompt },
		...tools !== void 0 && tools.length > 0 ? { tools } : {},
		messages: rest
	};
}
/**
* Replay one 0.87 system message's tool deltas into `state`, the same merge
* pi-ai 0.87's `getCurrentTools` performs: removals first, then additions,
* keyed by name so a mid-conversation redeclaration replaces the original.
*/
function replayToolState(message, state) {
	const removed = message.toolsRemoved;
	if (Array.isArray(removed)) for (const tool of removed) {
		const name = tool?.name;
		if (typeof name === "string") state.delete(name);
	}
	const added = message.toolsAdded;
	if (Array.isArray(added)) for (const tool of added) {
		const name = tool?.name;
		if (typeof name === "string") state.set(name, tool);
	}
}
/** The text of one system message, whether it is a string or text blocks. */
function systemTextOf(message) {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const texts = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block;
		if (candidate.type === "text" && typeof candidate.text === "string") texts.push(candidate.text);
	}
	return texts.join("\n\n");
}
/**
* Fold a RAW context into the normalized transcript the modern generation
* consumes: a leading `system` message carrying the prompt AND the tool
* declarations in its `toolsAdded` field.
*
* WHY THIS IS NEEDED AT ALL (the 0.2.1-rc.1 regression). This used to be
* unnecessary: the modern branch returned pi-ai's api UNWRAPPED, on the belief
* that the modern generation normalized for itself. It does not.
* `dsh-llm-pi-ai` — both the 0.1.7 and the 0.2.1 lines — hands every provider a
* RAW envelope (`piContext()` builds `{systemPrompt, messages, tools}` and
* never calls `normalizeContext`), while:
*
*   - pi-ai 0.85.x READS that raw shape (its request builder consults
*     `context.systemPrompt` / `context.tools` directly), and
*   - pi-ai 1.x READS ONLY `context.messages` (it resolves the transcript and
*     collapses system messages; the top-level fields are consulted nowhere).
*
* On pi-ai 1.x a pass-through request therefore went upstream with NO system
* prompt and NO tool declarations, silently: the model stopped calling tools,
* and the domestic gateway tolerated the prompt-less body. Same failure class
* as issues #24/#25/#26, reached from the opposite side — 4.4.2 fixed "1.x
* misjudged as legacy and folded"; this fixes "1.x judged modern and NOT
* folded, though nothing had normalized".
*
* Built inline rather than by importing pi-ai's `normalizeContext`, which does
* not exist in 0.85.x: a static import would be `undefined` there, and this
* module deliberately never imports pi-ai statically (see `pi-ai-runtime.ts` —
* that doctrine is what lets the standalone `bin` run in a profile where the
* peer is never installed). The folded shape matches what `normalizeContext`
* produces for the same input: `{role:'system', content, toolsAdded, timestamp:0}`.
*
* The top-level `systemPrompt`/`tools` fields are DROPPED, exactly as
* `normalizeContext` drops them, so a raw transcript and an already-normalized
* one converge on the same object.
*/
function foldModernContext(context) {
	const prompt = context.systemPrompt;
	const tools = context.tools;
	const hasPrompt = prompt !== void 0 && prompt !== "";
	const hasTools = Array.isArray(tools) && tools.length > 0;
	if (!hasPrompt && !hasTools) return context;
	const system = {
		role: "system",
		content: prompt ?? "",
		...hasTools ? { toolsAdded: tools } : {},
		timestamp: 0
	};
	const { systemPrompt: _prompt, tools: _tools, ...rest } = context;
	return {
		...rest,
		messages: [system, ...context.messages]
	};
}
/**
* Wrap one pi-ai API module so both stream entry points receive a context this
* generation can actually consume.
*
* The gate is the plugin's own module, resolved via {@link piAiRuntimeInfo}
* (manifest version of the copy this plugin resolves — no pi-ai import):
*
* - `legacy` (0.85) wants the flat `{systemPrompt, tools, messages}` shape, so
*   a normalized transcript is UN-folded by {@link adaptLegacyPiAiContext}.
* - `modern` (0.87+, incl. 1.x) wants the normalized transcript, so a raw
*   envelope is FOLDED by {@link foldModernContext}. Passing it through
*   unnormalized is what silently deleted the prompt and the tools on pi-ai
*   1.x — the regression this branch now prevents.
*
* Both branches are idempotent, so a future seam that starts normalizing on its
* own side changes nothing here.
*
* The deferred-fetch entry points take no context and are passed through as-is
* in both branches.
*/
/**
* Present an adapted context as the type the api's parameter currently expects.
*
* pi-ai 1.x BRANDS its provider-facing context (`TranscriptContext`, a
* `unique symbol` field) precisely so a raw `Context` cannot reach provider
* code by accident; the brand's stated sole producer is `normalizeContext()`.
* On a 1.x typings surface BOTH branches below receive that branded type, so
* merely returning a plain `Context` fails `tsc` with TS2345 — an error that
* only appears when the peer TYPES are 1.x, which is why the 0.85 checkout
* never saw it.
*
* The cast is a deliberate, documented assertion of exactly what the brand
* protects, and it is true after the call site has done the work:
*
* - modern: {@link foldModernContext} has already performed
*   `normalizeContext`'s job — prompt and tools live on the leading system
*   message, top-level fields gone;
* - legacy: {@link adaptLegacyPiAiContext} produced the FLAT 0.85 shape, which
*   is only ever observed on a 0.85 checkout, where this type is a plain
*   `Context` and the cast is an upcast.
*
* Do NOT "fix" this by importing `normalizeContext`: it does not exist in
* 0.85, so that import would be `undefined` at runtime on the very hosts this
* code must keep working — the same reason `pi-ai-runtime.ts` documents why
* this module never imports pi-ai statically.
*/
function transcript(context) {
	return context;
}
/**
* Rewrite every historical assistant message to the identity this adapter stamps.
*
* ISSUE #102. pi-ai replays a thinking block as `thinking` only when the message
* that produced it names the same `provider` / `api` / `model` as the request in
* flight (`utils/transform-messages.js`, the `isSameModel` branch); everything
* else is flattened to `{type:'text', text: thinking}`.
*
* The durable transcript the HOST hands back does not carry the identity. The
* agent loop writes `source.provider = request.provider`, and `request.provider`
* is the ROUTE id (`workbuddy` / `workbuddy-global`), while this adapter stamps
* `provider: WORKBUDDY_MODEL_IDENTITY` on the model. So:
*
*   - CN sessions survive by COINCIDENCE: its route id happens to equal the
*     identity (`workbuddy` === `workbuddy`).
*   - GLOBAL sessions never match (`workbuddy-global` !== `workbuddy`), so every
*     historical thinking block is downgraded on EVERY turn — not only when the
*     user switches regions, which is what #59's write-up assumed.
*
* The model then sees a context in which all of its own past reasoning was
* plain assistant text, and writes its new reasoning into `text` to match. That
* is the reported symptom: reasoning collapses to a character or two while the
* answer channel fills with working notes.
*
* WHY REWRITING IS SAFE. Every message here was produced by THIS plugin, in THIS
* region — the transcript never contains another provider's assistant turns
* (`dsh-llm` splits history by provider before the API sees it). The identity is
* already the field this adapter stamps on the models it serves, and it resolves
* as a registry key in both regions (issue #75). Nothing about routing, billing
* or the destination changes: `baseUrl` comes from the model, not from the
* message.
*
* `provider` alone is NOT enough, because the HOST drops the message to
* `api: 'dsh-foreign'` first. `dsh-llm-pi-ai`'s `replayedAssistant` rejects a
* replay whose recorded provider differs from `source.provider` and falls back
* to `foreignAssistant()`, which stamps `api: 'dsh-foreign'` and takes
* `provider` from `source.provider` — the ROUTE id. That is why the provider
* mismatch is not merely cosmetic: it also costs the message its native api, and
* `isSameModel` then fails on the SECOND comparison even after `provider` is
* repaired. Measured on a real 0.2.1-rc.2 global session, aligning `provider`
* only still flattened a 1514-character thinking block into 1514 characters of
* text; aligning both restored `thinking`.
*
* So `api` is repaired too, but ONLY from the one value that proves it is a
* host fallback and not this plugin's own wire format: `dsh-foreign`. Any other
* api is left exactly as it is.
*
* WHY THAT IS NOT FORGING A SIGNATURE. A `foreignAssistant()` message carries
* thinking blocks with NO `thinkingSignature` (`dsh-llm-pi-ai` builds them as
* `{type:'thinking', thinking}`), and pi-ai's request builder only emits
* `reasoning_content` when a signature exists
* (`api/openai-completions.js`, the `if (signature && isOpenAICompletionsReasoningField(...))`
* branch). The block is therefore OMITTED from the request, never replayed as
* signed reasoning — the same thing that happens today, minus the visible text.
* The message's own `api` field is not read by the request builder at all
* (grep: only `model.api` is), so this changes no wire shape.
*
* A genuinely different model still degrades, because `isSameModel` requires the
* model id to match and this function deliberately does not rewrite it: the
* message really was produced by another model. {@link dropForeignThinking}
* covers that leg separately, through its `requestModelId` argument.
*
* Returns the same object when nothing changed, so the common case (an
* already-normalized transcript) allocates nothing.
*/
function alignAssistantIdentities(context, identity = WORKBUDDY_MODEL_IDENTITY, ownedRoutes = [WORKBUDDY_PROVIDER, WORKBUDDY_GLOBAL_PROVIDER]) {
	const messages = context.messages;
	if (!Array.isArray(messages) || messages.length === 0) return context;
	const owned = new Set(ownedRoutes);
	let changed = false;
	const next = messages.map((message) => {
		if (typeof message !== "object" || message === null) return message;
		const record = message;
		if (record["role"] !== "assistant") return message;
		const provider = record["provider"];
		if (typeof provider !== "string" || !owned.has(provider) && provider !== identity) return message;
		const providerAligned = provider === identity;
		const apiAligned = record["api"] !== HOST_FOREIGN_API;
		if (providerAligned && apiAligned) return message;
		changed = true;
		const aligned = { ...record };
		if (!providerAligned) aligned["provider"] = identity;
		if (!apiAligned) aligned["api"] = "openai-completions";
		return aligned;
	});
	return changed ? {
		...context,
		messages: next
	} : context;
}
/** Read `content` as a block array without assuming the shape. */
function blocksOf$1(message) {
	if (typeof message !== "object" || message === null) return [];
	const content = message["content"];
	return Array.isArray(content) ? content : [];
}
/**
* Whether this assistant message's identity proves a DIFFERENT model produced it.
*
* `requestModelId` closes the THIRD leg of pi-ai's own predicate. `isSameModel`
* is `provider === … && api === … && model === model.id`
* (`transform-messages.js:68–70`); this function used to compare only the first
* two. The consequence was a blind spot the size of one whole route: a session
* that switches MODELS inside one region — `hy3` → `deepseek-v4.1-flash`, both
* served by this bundle, both stamped `provider: workbuddy` — keeps the provider
* and api legs equal, so nothing here noticed, while pi-ai flattened every
* historical thinking block into the answer channel exactly as in issue #147.
* The user-visible symptom is #147's, with none of its diagnostics.
*
* Passing `undefined` keeps the provider/api-only behaviour, which is what the
* read-only surfaces and the older call sites expect. Production passes the id
* of the model the request is actually addressed to.
*/
function isForeignAssistant(message, identity, requestModelId) {
	if (typeof message !== "object" || message === null) return false;
	const record = message;
	if (record["role"] !== "assistant") return false;
	if (record["api"] === "dsh-foreign") return true;
	const provider = record["provider"];
	if (typeof provider !== "string" || provider !== identity && provider !== "workbuddy" && provider !== "workbuddy-global") return true;
	if (requestModelId === void 0) return false;
	const model = record["model"];
	return typeof model === "string" && model !== requestModelId;
}
/**
* Every foreign thinking block pi-ai would turn into visible prose (issue #147).
*
* THE DEFECT. pi-ai keeps a historical `thinking` block only while
* `isSameModel` holds — provider AND api AND model id all equal to the request
* (`transform-messages.js:68`). For everything else it does NOT drop the block:
* `:87–90` rewrites it to `{type:'text', text: thinking}`, which is the answer
* channel. A session that moved between providers therefore arrives with its
* other provider's working notes already spelled as prose, and the model reads
* that shape and copies it.
*
* Issue #147 measured the consequence on a real 80-step turn: 56 assistant
* messages carried an answer while their own `reasoning` was ≤ 1 character,
* 20 of them held English working notes totalling 58,960 characters, and CJK
* fell to 1.37% of the visible text where the preceding six turns had been
* entirely Chinese. That is not a formatting complaint — it also pushed the
* session from 696,966 to 758,005 total tokens against an 800,000 compression
* threshold.
*
* WHY THIS IS READ-ONLY. Nothing here rewrites the transcript:
* {@link dropForeignThinking} does, and the split keeps the DIAGNOSIS available
* to surfaces that must not change bytes (the card, the reply notice).
*
* @param context - a pi-ai context, before or after `alignAssistantIdentities`.
* @param identity - the identity this adapter stamps on its own models.
* @param requestModelId - model id the request is addressed to, so the model
*   leg of pi-ai's predicate is covered too (see {@link isForeignAssistant}).
*   Omitted, only the provider/api legs are judged.
* @returns one entry per affected block, in transcript order.
*/
function foreignThinkingOf(context, identity = WORKBUDDY_MODEL_IDENTITY, requestModelId) {
	const messages = context.messages;
	if (!Array.isArray(messages)) return [];
	const found = [];
	for (const [messageIndex, message] of messages.entries()) {
		if (!isForeignAssistant(message, identity, requestModelId)) continue;
		const stopReason = message["stopReason"];
		const variant = stopReason === "error" || stopReason === "aborted" ? "dropped" : "flattened";
		for (const [blockIndex, block] of blocksOf$1(message).entries()) {
			if (typeof block !== "object" || block === null) continue;
			const fields = block;
			if (fields["type"] !== "thinking") continue;
			if (fields["redacted"] === true) continue;
			const thinking = fields["thinking"];
			const characters = typeof thinking === "string" ? thinking.length : 0;
			if (characters === 0) continue;
			found.push({
				messageIndex,
				blockIndex,
				characters,
				variant
			});
		}
	}
	return found;
}
/**
* Remove the foreign thinking blocks {@link foreignThinkingOf} finds.
*
* WHY REMOVAL IS THE HONEST REPAIR. The alternatives are both worse:
*
*   - LEAVE IT: pi-ai publishes the other provider's private working notes as
*     this turn's answer (the #147 defect), so the user reads reasoning instead
*     of a reply and the model imitates that shape forever after.
*   - KEEP IT AS THINKING: impossible from here. `isSameModel` is pi-ai's own
*     predicate over fields this plugin does not control (`model.provider` /
*     `model.api` / `model.id` are compared against the MESSAGE's), and the
*     only way to satisfy it is to claim the foreign turn as this model's own
*     output — which is exactly the provenance lie issue #111 removed. These
*     blocks carry no `thinkingSignature` (the host builds them that way), so
*     they could not be replayed as signed reasoning even if claimed.
*
* Dropping is what the request builder already does with them in every other
* branch: an unsigned foreign thinking block is never sent as
* `reasoning_content`, so its only possible contribution to the wire was the
* flattened prose this function removes. Every other block — text, tool calls —
* is left exactly where it is, and so is every message's identity.
*
* Idempotent: a second pass finds nothing to remove. Returns the SAME context
* object when nothing changed, so the common case allocates nothing.
*
* @param context - a pi-ai context.
* @param identity - the identity this adapter stamps on its own models.
* @param requestModelId - model id the request is addressed to (see
*   {@link isForeignAssistant}); omitted, only the provider/api legs are judged.
* @returns the repaired context, or the input when no block qualified.
*/
function dropForeignThinking(context, identity = WORKBUDDY_MODEL_IDENTITY, requestModelId) {
	const affected = foreignThinkingOf(context, identity, requestModelId);
	if (affected.length === 0) return context;
	const messages = context.messages;
	const byMessage = /* @__PURE__ */ new Map();
	for (const block of affected) {
		const set = byMessage.get(block.messageIndex) ?? /* @__PURE__ */ new Set();
		set.add(block.blockIndex);
		byMessage.set(block.messageIndex, set);
	}
	const next = messages.map((message, index) => {
		const remove = byMessage.get(index);
		if (remove === void 0) return message;
		const record = message;
		const content = blocksOf$1(message).filter((_, blockIndex) => !remove.has(blockIndex));
		return {
			...record,
			content
		};
	});
	return {
		...context,
		messages: next
	};
}
function withLegacyContext(api, generation, identity = WORKBUDDY_MODEL_IDENTITY, ownedRoutes = [WORKBUDDY_PROVIDER, WORKBUDDY_GLOBAL_PROVIDER], repair) {
	/** One place so both branches and both entry points agree on the order. */
	const prepare = (context, requestModelId) => {
		const aligned = alignAssistantIdentities(generation === "modern" ? foldModernContext(context) : adaptLegacyPiAiContext(context), identity, ownedRoutes);
		if (repair?.dropForeignThinking !== true) return aligned;
		const affected = foreignThinkingOf(aligned, identity, requestModelId);
		if (affected.length === 0) return aligned;
		try {
			repair.onForeignThinking?.(affected);
		} catch {}
		return dropForeignThinking(aligned, identity, requestModelId);
	};
	if (generation === "modern") return {
		...api,
		stream: (model, context, options) => api.stream(model, transcript(prepare(context, model.id)), options),
		streamSimple: (model, context, options) => api.streamSimple(model, transcript(prepare(context, model.id)), options)
	};
	return {
		...api,
		stream: (model, context, options) => api.stream(model, transcript(prepare(context, model.id)), options),
		streamSimple: (model, context, options) => api.streamSimple(model, transcript(prepare(context, model.id)), options)
	};
}
/**
* Layer the host-side context-overflow rescue onto a provider's streams.
*
* pi-ai reports a provider failure as an `error` event rather than a throw, so
* the rescue runs while the failing assistant message is still in hand: history
* is folded before the event continues on its way, and the host's retry then
* rebuilds its request against a smaller surface. Nothing is swallowed — the
* error event is forwarded unchanged, because deciding whether to retry is the
* host's policy, not this transport's.
*
* Both gates are deliberate. Without `sessionId` there is no session to fold,
* and without a declared `contextWindow` there is no budget to fold against;
* either absence leaves the stream untouched.
*/
function withContextRescue(api, resolve) {
	if (resolve === void 0) return api;
	const wrap = (inner) => (model, context, options) => {
		const source = inner(model, context, options);
		const rescue = resolve();
		const sessionId = options?.sessionId;
		const window = model.contextWindow;
		if (rescue === void 0 || sessionId === void 0 || window === void 0) return source;
		const out = createAssistantMessageEventStream();
		let final;
		(async () => {
			try {
				for await (const event of source) {
					if (event.type === "done") final = event.message;
					if (event.type === "error") final = event.error;
					if (event.type === "error" && isContextOverflow(event.error)) await rescue.rescue(sessionId, window);
					out.push(event);
				}
				out.end(final);
			} catch {
				out.end(final);
			}
		})();
		return out;
	};
	return {
		...api,
		stream: wrap(api.stream),
		streamSimple: wrap(api.streamSimple)
	};
}
/**
* The tier {@link EffortNormalizingAdapter} pins a model to when the model
* carries no reasoning metadata of its own.
*
* `off` is the ONE tier pi-ai offers for such a model (`getSupportedThinkingLevels`
* returns `['off']` whenever `model.reasoning` is false), and the host's own
* translation of it is "send no reasoning field at all" (`profileOptions` turns
* `off` into `enabledReasoning = undefined`). So pinning it neither invents a
* capability nor changes one byte of the upstream request body.
*/
const NO_REASONING_EFFORT = ReasoningEffortId("off");
/** What the host is told a reasoning-less model supports: exactly that tier. */
const NO_REASONING_EFFORTS = { efforts: [{
	id: NO_REASONING_EFFORT,
	name: "Off"
}] };
/**
* pi-ai adapter that keeps a model WITHOUT reasoning metadata dispatchable
* (issue #90, the `UNSUPPORTED_REASONING_EFFORT` half).
*
* THE FAILURE. `profileFor` pins one default tier per ROUTE
* (`reasoning: WORKBUDDY_DEFAULT_EFFORT`, issue #83), and `dsh-llm-pi-ai`
* resolves every request as `options.reasoningEffort ?? profile.reasoning`. For
* a model whose catalog entry carries no `reasoning` block at all — the live CN
* catalog has six of them (`default`, `glm-5.0`, `glm-4.7`, `glm-4.6`,
* `hunyuan-chat`, `hunyuan-image-alpha`), the live global one two
* (`default-model`, `deep-model`), and EVERY entry of both static fallback lists
* — the inherited `high` is not a tier that model has. (`default-model` is the
* international `auto` router and is not offered as a row since 5.0.1; the
* measurement is kept verbatim because the defect it documents was observed
* against the full roster.) `resolveReasoningLevel`
* then throws `UNSUPPORTED_REASONING_EFFORT` before the request is even built,
* so the model is unusable locally: no wire call, no upstream error, nothing to
* retry. Introduced by v4.11.0, which made the profile default explicit; before
* it the default was absent and pi-ai clamped instead of throwing.
*
* TWO GATES, BOTH CLOSED. The host checks the adapter's own model metadata
* first: `resolveCallWithInfo` rejects ANY explicitly requested tier on a model
* whose `reasoning` is absent, and `reasoningInfo` omits the field exactly for
* models without metadata — so even `off` was refused. Then `PiAiAdapter.streamWithSnapshot`
* rejects the route default it inherited. A fix at either seam alone still
* fails at the other.
*
* THE FIX. Advertise the one tier pi-ai will actually accept for such a model
* (`off`) and normalize the request to it at the dispatch seam, so
* `resolveReasoningLevel` sees a supported tier and `profileOptions` sends no
* reasoning field. Nothing about the wire body changes — pi-ai never emits
* `reasoning_effort` for a model whose descriptor has `reasoning: false`.
*
* WHAT STAYS STRICT. A tier the caller EXPLICITLY asks for on a model that
* cannot do it is still rejected, by the host, with an accurate message. That
* is the pre-v4.11.0 contract too, and it is not this bug: the bug is a request
* that named no tier being killed by the route's own default.
*/
var EffortNormalizingAdapter = class extends PiAiAdapter {
	/**
	* Whether one exact model id currently carries reasoning metadata. Read live
	* on every call because the catalog is refreshed behind the adapter
	* (`invalidate`), and a model that gains metadata mid-session must stop being
	* normalized at once.
	*/
	effortCapable;
	constructor(config, effortCapable) {
		super(config);
		this.effortCapable = effortCapable;
	}
	async resolveModel(provider, model, signal) {
		return this.advertiseOffOnly(await super.resolveModel(provider, model, signal));
	}
	async prepareCall(provider, model, signal) {
		const call = await super.prepareCall(provider, model, signal);
		return {
			model: this.advertiseOffOnly(call.model),
			stream: (options) => call.stream(this.pinEffort(options))
		};
	}
	stream(options) {
		return super.stream(this.pinEffort(options));
	}
	/**
	* Give a reasoning-less model the one tier it can dispatch at. No
	* `defaultEffort` on purpose: the host materializes one into EVERY request
	* that names no tier, and that would turn the host's own prepared-call config
	* check (`callConfigEquals`) against callers that omit the field.
	*/
	advertiseOffOnly(info) {
		return info.reasoning === void 0 ? {
			...info,
			reasoning: NO_REASONING_EFFORTS
		} : info;
	}
	/** Replace an unusable tier with the one pi-ai accepts for this model. */
	pinEffort(options) {
		if (this.effortCapable(options.model)) return options;
		return options.reasoningEffort === NO_REASONING_EFFORT ? options : {
			...options,
			reasoningEffort: NO_REASONING_EFFORT
		};
	}
};
/**
* Assemble the adapter. The provider's `getModels` reads the live catalog,
* and every model's `baseUrl` is re-resolved per read so the shim's
* ephemeral port applies from the first snapshot after startup.
*/
function createWorkBuddyAdapter(options) {
	const { shim, store, catalog, resolveAttachments } = options;
	const providerId = options.provider ?? "workbuddy";
	const providerName = options.displayName ?? "WorkBuddy";
	const modelIdentity = options.modelIdentity ?? "workbuddy";
	const generation = options.piAiGeneration ?? piAiRuntimeInfo().generation;
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		return catalog.current().map((info) => toPiModel(info, baseUrl, modelIdentity));
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: providerName,
			auth: { apiKey: {
				name: "WorkBuddy OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "WorkBuddy"
					};
				}
			} },
			models: buildModels(),
			api: withContextRescue(withLegacyContext(openAICompletionsApi(), generation, modelIdentity, void 0, {
				get dropForeignThinking() {
					return options.dropForeignThinking?.() === true;
				},
				...options.onForeignThinking === void 0 ? {} : { onForeignThinking: options.onForeignThinking }
			}), options.resolveContextRescue)
		}),
		getModels: () => buildModels()
	};
	const profileFor = (key) => ({
		provider: key,
		displayName: providerName,
		streamIdleTimeoutMs: WORKBUDDY_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: options.retryPolicy?.() ?? resolveRetryPolicy(void 0, "dsh-connect-workbuddy retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		/**
		* The default tier, pinned to the SAME value pi-ai's level map would fill in
		* for an absent one (issue #83).
		*
		* `dsh-llm-pi-ai` resolves every request's tier as
		* `options.reasoningEffort ?? profile.reasoning`, so an absent default here
		* means "whatever pi-ai fills in" — and for a model whose map carried
		* `off → "off"`, that was `"off"`, i.e. every compaction summary asked a
		* model like `deepseek-v4.1-flash` to disable thinking, which it answers with
		* 400 / 11133. Nothing structurally prevents a level or a catalog snapshot
		* from disagreeing with the adapter's own map, so the default must never be
		* that. This is the same value the host asks for explicitly on normal turns.
		*/
		reasoning: WORKBUDDY_DEFAULT_EFFORT,
		...REQUEST_IMAGE_BUDGETS,
		piProvider: key === providerId ? provider : {
			...provider,
			id: key
		}
	});
	const buildProfiles = () => new Map(modelIdentityKeysOf(providerId, modelIdentity).map((key) => [key, profileFor(key)]));
	let profiles = buildProfiles();
	/**
	* Whether one exact model id currently advertises ANY thinking tier.
	*
	* Same predicate `toPiModel` derives the descriptor's `reasoning` flag from,
	* so the two can never disagree — and it reads the live catalog, so a refresh
	* that adds (or drops) metadata for a model takes effect on the next request
	* without an `invalidate` round trip.
	*/
	const effortCapable = (model) => catalog.current().some((info) => info.id === model && workBuddyThinkingLevelMap(info) !== void 0);
	return {
		adapter: new EffortNormalizingAdapter({
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async () => shim.token(),
			...resolveAttachments === void 0 ? {} : { resolveAttachments }
		}, effortCapable),
		invalidate: () => {
			profiles = buildProfiles();
		}
	};
}
//#endregion
//#region src/context-rescue.ts
/** Share of the window one fold chunk may consume, leaving room for the prompt. */
const CHUNK_FRACTION = .35;
/** Post-fold measurement target: comfortably below the window the route allows. */
const TARGET_FRACTION = .6;
/** A session is never folded more than this many times by one rescue. */
const MAX_ROUNDS = 8;
/** How many times one chunk may shrink its tail edge before giving up. */
const MAX_SHRINK = 24;
/** A single fold is abandoned after this long. */
const FOLD_TIMEOUT_MS = 18e4;
/**
* Create the rescue bound to a live host.
*
* @param resolve - resolves host services at call time.
* @returns the rescue handle the adapter calls on a provider overflow.
*/
function createContextRescue(resolve) {
	const inflight = /* @__PURE__ */ new Set();
	return { async rescue(sessionId, window) {
		if (inflight.has(sessionId)) return false;
		inflight.add(sessionId);
		try {
			return await foldUntilFits(resolve(), sessionId, window);
		} catch (error) {
			resolve().log?.("dsh-connect-workbuddy: context rescue failed", error);
			return false;
		} finally {
			inflight.delete(sessionId);
		}
	} };
}
async function foldUntilFits(deps, sessionId, window) {
	const { meter, compaction, agents } = deps;
	if (meter === void 0 || compaction === void 0 || agents === void 0) return false;
	const agent = agents.get(sessionId);
	if (agent === void 0) return false;
	const target = Math.max(1, Math.floor(window * TARGET_FRACTION));
	let foldedAny = false;
	let previous = Number.POSITIVE_INFINITY;
	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		const measurement = meter.measure(agent.session);
		if (measurement.totalTokens <= target) return foldedAny;
		if (measurement.totalTokens >= previous) return foldedAny;
		previous = measurement.totalTokens;
		if (!await foldOnce(deps, agent, measurement, window, target)) return foldedAny;
		foldedAny = true;
	}
	return foldedAny;
}
/**
* Fold the oldest chunk that fits, shrinking its tail edge when the host
* refuses the range.
*
* The host rejects a range whose edges split a tool call from its result, and
* it rejects an active or missing range before appending anything — so a
* refused attempt costs no durable state and the edge can simply move inward.
*
* @returns whether one chunk was folded.
*/
async function foldOnce(deps, agent, measurement, window, target) {
	const nodes = measurement.nodes;
	if (nodes.length < 2) return false;
	const budget = Math.floor(window * CHUNK_FRACTION);
	const excess = measurement.totalTokens - target;
	const chunk = Math.max(1, Math.min(budget, excess));
	const head = nodes[0];
	const compaction = deps.compaction;
	if (head === void 0 || compaction === void 0) return false;
	let end = -1;
	let accumulated = 0;
	for (let index = 0; index < nodes.length - 1; index += 1) {
		const node = nodes[index];
		if (node === void 0) break;
		accumulated += node.tokens;
		end = index;
		if (accumulated >= chunk) break;
	}
	if (end < 0) return false;
	const signal = AbortSignal.timeout(FOLD_TIMEOUT_MS);
	const floor = Math.max(0, end - MAX_SHRINK);
	for (; end >= floor; end -= 1) {
		const tail = nodes[end];
		if (tail === void 0) break;
		try {
			await compaction.compactRegion(head.seq, tail.seq, agent, signal);
			return true;
		} catch (error) {
			if (signal.aborted) {
				deps.log?.("dsh-connect-workbuddy: context rescue timed out", error);
				return false;
			}
		}
	}
	deps.log?.("dsh-connect-workbuddy: context rescue found no foldable range");
	return false;
}
//#endregion
//#region src/body-report.ts
/**
* Body-composition report: WHAT was sent upstream, in counts (issue #59).
*
* WHY THIS EXISTS. Issue #59's reporter measured the SAME conversation charged
* ~708K tokens by the CN gateway and ~1.374M by the international one (1.94×),
* which turns a region switch into an instant `code 11115 prompt is too long`.
* Two worlds explain that, and they have opposite owners:
*
*   - the gateways count identical bytes differently (upstream's business); or
*   - the two requests did not carry the same messages (ours to fix).
*
* Neither world, it turned out — the answer was a third one, and this report is
* what produced it. A paired capture in one session (4.6.7) measured
* `bodyBytes` 3,628,068 vs 3,626,374, a ratio of 0.9995: both requests carried
* the same bytes. What differed was the BUCKET each byte was counted in — CN
* text 741,687 vs GL 184,821, CN reasoning 72,270 vs GL 627,994, with a
* complementary residual of 0.3%. The gateways did not miscount; the same
* history was labelled differently on the two sides.
*
* The labelling is pi-ai's replay — which assistant messages it lets survive as
* thinking at all. `transform-messages.js:68` (1.1.0, the version the host
* bundles) computes
*
*     isSameModel = assistantMsg.provider === model.provider
*                && assistantMsg.api      === model.api
*                && assistantMsg.model    === model.id;
*
* and for a message that fails it, `:88–96` returns the surviving thinking as
* `{ type: "text", text: block.thinking }` — downgraded, not dropped — while
* `:76` drops redacted thinking and `:103` strips tool-call `thoughtSignature`.
* `buildParams` runs that transform at `openai-completions.js:896`, before
* anything is assembled, so a thinking block only stays a thinking block when
* its message was recorded under the same provider AND the same model id as the
* request now in flight. Survivors leave as the raw field: `:1002–1008` writes
* `assistantMsg[signature] = <thinking>`, `signature` being the field name the
* stream used, recorded per block at `:399–416` (`reasoning_content` for this
* vendor, uniformly — 790 replay records in one real session held that value
* and no other). Non-survivors are text by the time `:964–971` collects
* `assistantText`, so they land in `assistantMsg.content` instead. This plugin
* sets only `compat.supportsReasoningEffort` (`src/adapter.ts:200`), which
* leaves `requiresThinkingAsText` at its `false` default (`:1270`), so the raw
* field route is the live one rather than the fold-into-content route at `:983`.
*
* Two provider ids for one model is therefore two identities for one model, and
* a region switch flips the sign for the entire other side at once: everything
* that side ever thought is replayed as content instead of as a reasoning field,
* and the gateways count content. That is the 1.94× above; the same formula read
* in the other direction is the 0.696× the reverse switch produces (text
* 642,800 vs 447,306 across the same bytes). The model-id leg of `isSameModel`
* matters for the same reason — switching models inside ONE region has the same
* effect — which is why the symptom belongs in `README`'s 已知限制, where users
* meet it, and not only here.
*
* The retraction trail, because this header has misled twice. The first version
* claimed historical `reasoning` never reaches the wire, because
* `requiresThinkingAsText` is unset and the `reasoning_details` route needs a
* signature the parser never writes. Both halves are wrong: the unset flag is
* precisely what routes thinking out as a raw field. The second version — the
* one this paragraph replaces — claimed the difference was the field NAME,
* signature-driven, citing 0.85.1's `:428`/`:1006` and concluding that a gateway
* saying `reasoning` replays as `reasoning`. That cannot be right either: both
* gateways say `reasoning_content`, so a name-keyed story predicts NO difference
* between them, and the host ships 1.1.0, not 0.85.1. What differs is survival,
* not naming. The file keeps both dead ends on purpose — each one shaped what
* this report measures, and the third version only settled the question because
* the report could show bytes equal while buckets were not.
*
* This module exists to settle exactly that, and it can do it WITHOUT either
* region having credit: the body is assembled locally, before the upstream ever
* gets a chance to answer `14018 Credits exhausted`. Capture one composition per
* region in the same session and diff them.
*
* It records COUNTS ONLY — never a byte of message text, no account name, no
* token. That is a hard rule, not a default: the point is to compare shape
* (`messages.length`, per-block type, CJK vs non-CJK characters, total bytes),
* and every one of those is answerable arithmetically. `tests/issue59-body-report.spec.ts`
* asserts the report cannot leak a fixture's text.
*/
/**
* Environment variable that enables the report.
*
* Unset or blank means OFF — a diagnostic that writes files must be opt-in.
* `1`/`true` writes to `<DSH home>/body-reports/`; anything else is read as a
* directory path, so a user can point it at an existing folder (and, on
* Windows, one with spaces).
*/
const WORKBUDDY_BODY_REPORT_ENV = "WORKBUDDY_BODY_REPORT";
/**
* Character ranges that tokenize (and therefore bill) like CJK.
*
* Deliberately generous: the caller's question is "how much of this is the ~3×
* kind", and the measured spread is 0.669 vs 0.224 tokens/char, so a character
* class that is borderline costs far less than mis-attributing a whole bucket.
* Ranges follow Unicode blocks, plus the compatibility forms and the two
* extension planes where rare Han characters live.
*/
const CJK_RANGES = [
	[11904, 12031],
	[12288, 12351],
	[12352, 12543],
	[13312, 19903],
	[19968, 40959],
	[63744, 64255],
	[65072, 65103],
	[65280, 65519],
	[131072, 195103]
];
/** Whether one code point bills like CJK. */
function isCjkCodePoint(code) {
	return CJK_RANGES.some(([low, high]) => code >= low && code <= high);
}
/** Count characters (code points) and how many of them are CJK. */
function countChars(text) {
	let chars = 0;
	let cjkChars = 0;
	for (const character of text) {
		chars += 1;
		const code = character.codePointAt(0);
		if (code !== void 0 && isCjkCodePoint(code)) cjkChars += 1;
	}
	return {
		chars,
		cjkChars
	};
}
/** Build one block report from already-extracted text. */
function block(type, text) {
	return {
		type,
		...countChars(text)
	};
}
/** Whether a value is a plain object (not null, not an array). */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Describe one message's blocks.
*
* The role decides what a content string IS, and that is not cosmetic: a
* `tool` message's payload is a tool result, so counting it as `text` would hide
* the very bucket a long agentic session is mostly made of.
*/
function describeMessage(message) {
	const role = typeof message["role"] === "string" ? message["role"] : "unknown";
	const blocks = [];
	const content = message["content"];
	/**
	* The block type a plain string carries, by the ROLE carrying it.
	*
	* A `tool` message's string is a tool RESULT and a `system` one is the system
	* prompt; calling both `text` would fold the biggest bucket of a long agentic
	* session into the smallest one, which is the opposite of what a composition
	* report is for.
	*/
	const stringType = role === "tool" ? "tool-result" : role === "system" || role === "developer" ? "system" : "text";
	if (typeof content === "string") {
		if (content !== "") blocks.push(block(stringType, content));
	} else if (Array.isArray(content)) for (const part of content) {
		if (!isRecord(part)) continue;
		const type = typeof part["type"] === "string" ? part["type"] : "unknown";
		if (type === "text") {
			const text = part["text"];
			if (typeof text === "string" && text !== "") blocks.push(block(stringType, text));
			continue;
		}
		blocks.push({
			type: type === "image_url" ? "image" : type,
			chars: 0,
			cjkChars: 0
		});
	}
	const toolCalls = message["tool_calls"];
	if (Array.isArray(toolCalls)) for (const call of toolCalls) {
		if (!isRecord(call)) continue;
		const fn = call["function"];
		const name = isRecord(fn) && typeof fn["name"] === "string" ? fn["name"] : "";
		const args = isRecord(fn) && typeof fn["arguments"] === "string" ? fn["arguments"] : "";
		blocks.push(block("tool-call", `${name}${args}`));
	}
	for (const field of [
		"reasoning_content",
		"reasoning",
		"reasoning_text"
	]) {
		const value = message[field];
		if (typeof value === "string" && value !== "") blocks.push(block("reasoning", value));
	}
	return {
		role,
		chars: blocks.reduce((sum, entry) => sum + entry.chars, 0),
		cjkChars: blocks.reduce((sum, entry) => sum + entry.cjkChars, 0),
		blocks
	};
}
/**
* Describe one serialized request body.
*
* Returns `undefined` when the body is not a JSON object — a diagnostic must
* never be the reason a chat request fails, so every caller treats `undefined`
* as "nothing to report" rather than an error.
*/
function describeBody(bodyJson, region, nowMs) {
	let parsed;
	try {
		parsed = JSON.parse(bodyJson);
	} catch {
		return;
	}
	if (!isRecord(parsed)) return void 0;
	const rawMessages = parsed["messages"];
	const messages = Array.isArray(rawMessages) ? rawMessages.filter(isRecord).map(describeMessage) : [];
	const rawTools = parsed["tools"];
	const tools = Array.isArray(rawTools) ? block("tools", rawTools.map((tool) => isRecord(tool) ? JSON.stringify(tool) : "").join("")) : {
		type: "tools",
		chars: 0,
		cjkChars: 0
	};
	const chars = messages.reduce((sum, message) => sum + message.chars, 0) + tools.chars;
	const cjkChars = messages.reduce((sum, message) => sum + message.cjkChars, 0) + tools.cjkChars;
	return {
		at: new Date(nowMs).toISOString(),
		region,
		...typeof parsed["model"] === "string" ? { model: parsed["model"] } : {},
		bodyBytes: Buffer.byteLength(bodyJson, "utf8"),
		messageCount: messages.length,
		chars,
		cjkChars,
		tools,
		messages
	};
}
/** A finite, non-negative token count, or undefined for anything else. */
function tokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/**
* Read the token counts out of one already-parsed SSE chunk.
*
* Returns undefined when the chunk carries no `usage` — which is every chunk but
* the last one on a streamed answer, so this is called for each frame and must
* stay cheap and total. The cache-hit count is looked for under BOTH spellings
* observed on the two gateways (`prompt_tokens_details.cached_tokens`, OpenAI's,
* and `prompt_cache_hit_tokens`, which the domestic gateway also emits); taking
* the first one present keeps the report comparable across regions instead of
* showing 0 on whichever side uses the other name.
*/
function usageOfChunk(chunk) {
	const usage = chunk["usage"];
	if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return void 0;
	const record = usage;
	const promptTokens = tokenCount(record["prompt_tokens"]);
	const completionTokens = tokenCount(record["completion_tokens"]);
	const details = record["prompt_tokens_details"];
	const cachedTokens = (typeof details === "object" && details !== null && !Array.isArray(details) ? tokenCount(details["cached_tokens"]) : void 0) ?? tokenCount(record["prompt_cache_hit_tokens"]);
	if (promptTokens === void 0 && completionTokens === void 0 && cachedTokens === void 0) return void 0;
	return {
		...promptTokens === void 0 ? {} : { promptTokens },
		...completionTokens === void 0 ? {} : { completionTokens },
		...cachedTokens === void 0 ? {} : { cachedTokens }
	};
}
/**
* Resolve the directory the report writes to, or `undefined` when disabled.
*
* Exported for the same reason the other env-var resolvers in this plugin are:
* the behaviour is worth a unit test, and the test must not have to set a real
* process-wide variable to get one.
*/
function bodyReportDirectory(env = process.env) {
	const configured = env[WORKBUDDY_BODY_REPORT_ENV];
	if (configured === void 0) return void 0;
	const trimmed = configured.trim();
	if (trimmed === "") return void 0;
	if (trimmed === "1" || trimmed.toLowerCase() === "true") return join(resolveDshHome(), "body-reports");
	return trimmed;
}
/**
* How many bytes from the END of the file {@link attachUsage} reads when it
* looks for the line it wrote (issue #118).
*
* The old implementation read the WHOLE file, split it, rewrote the WHOLE file —
* so every streamed answer cost ~3× the file size in heap (the string, the line
* array, the re-joined string), which is what OOMed the host at ~500 MB. The
* usage callback fires seconds after its own append, so its line is always
* near the tail; a bounded tail read makes the cost O(window) instead of
* O(file). A line older than the window is simply left un-annotated — the
* annotation is best-effort by design (see the header of {@link attachUsage}).
*
* Exported because the boundary behaviour is exactly what a regression would
* break first, and a test that pins it must be able to size a file against it
* without reaching into the module.
*/
const USAGE_ATTACH_TAIL_BYTES = 1048576;
/**
* Append one composition to `<dir>/<region>.jsonl`.
*
* One file per region is the whole point: the reporter captures a session, then
* diffs `cn.jsonl`'s last line against `global.jsonl`'s. JSON Lines rather than
* one file per request because a single turn makes many upstream calls (one per
* tool step) and the LAST one is the interesting one.
*
* Read-modify-write is avoided on purpose — a long session would rewrite a
* growing file on every step. The lock keeps two concurrent requests from
* interleaving a line, and the size check inside the SAME lock keeps two
* concurrent appends from both deciding "no roll needed" and then writing past
* the cap together.
*/
async function appendBodyReport(directory, report) {
	const file = join(directory, `${report.region}.jsonl`);
	await mkdir(directory, { recursive: true });
	const line = `${JSON.stringify(report)}\n`;
	await withFileLock(file, async () => {
		const size = await stat(file).then((entry) => entry.size).catch(() => 0);
		if (size > 0 && size + Buffer.byteLength(line, "utf8") > 33554432) {
			const rolled = `${file}.1`;
			await rm(rolled, { force: true });
			await rename(file, rolled);
		}
		await appendFile(file, line, "utf8");
	});
}
/**
* Record one outgoing body, if the report is enabled, and return a handle that
* can carry the upstream's `usage` back onto the SAME line.
*
* NEVER THROWS and never awaits long: this is called on the request path, and a
* chat request must not fail (or stall) because a diagnostic could not write a
* file. A failure is reported through `onError` so the caller can log it.
*
* The returned function exists because the two halves of the #59 comparison are
* only available at different times: what we SENT is known before the request
* leaves, what the gateway CHARGED only after the stream ends. Writing a second
* line for the usage would be worse than useless — the reporter diffs "the last
* line of cn.jsonl against the last line of global.jsonl", and a trailing
* usage-only line would silently become the one being compared.
*/
async function recordBodyReport(region, bodyJson, options = {}) {
	const directory = bodyReportDirectory(options.env);
	if (directory === void 0) return () => {};
	try {
		const report = describeBody(bodyJson, region, options.nowMs ?? Date.now());
		if (report === void 0) return () => {};
		await appendBodyReport(directory, report);
		return attachUsage(directory, report, options.onError);
	} catch (error) {
		options.onError?.(error);
		return () => {};
	}
}
/**
* Return a callback that rewrites its own line with the upstream's counts.
*
* Matched by `at` + `region` + `bodyBytes` + `messageCount`, all four being
* stable for a finished request: `at` alone can collide when two requests are
* timestamped in the same millisecond, and `bodyBytes` tells apart the two
* different bodies a failover or a retry can produce. A line that is already
* annotated is left alone, so a second call cannot double-apply.
*
* The rewrite touches ONLY the tail window (issue #118): the file is opened
* `r+`, the last {@link USAGE_ATTACH_TAIL_BYTES} are read, the window is split
* into lines, the target line is replaced, and the new window is written back
* at the SAME offset with the file truncated to the new end. Nothing before the
* window is ever read or written, so a 500 MB file costs one megabyte of heap
* here instead of three copies of itself.
*
* Two consequences of the bounded window, both deliberate:
*
*   - a line pushed out of the window by later appends is left un-annotated.
*     The annotation is a convenience for the #59 diff, never a correctness
*     requirement — the sent side is already on disk;
*   - the window must start on a line boundary, so the read takes ONE byte of
*     lookback before it: when that byte is a newline the window already starts
*     on a boundary and its first line is complete (kept in search and rewrite);
*     otherwise the first partial line is dropped from the SEARCH and preserved
*     byte-for-byte by starting the write at the first complete line's offset.
*/
function attachUsage(directory, report, onError) {
	/**
	* Two independent idempotence guards, kept redundant on purpose.
	*
	* `done` avoids a second disk read within one handle's lifetime; the
	* "already annotated" check inside the loop catches the OTHER case — a second
	* handle for the same body, which is what a failover retry produces (it opens
	* its own stream, and therefore its own handle). Either alone is enough for
	* the common path, so removing just one is not observable behaviourally;
	* removing BOTH is, and `tests/issue59-body-report.spec.ts` pins that.
	*/
	let done = false;
	return (usage) => {
		if (usage === void 0 || done) return;
		done = true;
		const file = join(directory, `${report.region}.jsonl`);
		(async () => {
			try {
				await withFileLock(file, async () => {
					const handle = await open(file, "r+");
					try {
						const { size } = await handle.stat();
						if (size === 0) return;
						const windowStart = size - Math.min(size, USAGE_ATTACH_TAIL_BYTES);
						const readStart = windowStart === 0 ? 0 : windowStart - 1;
						const readLength = size - readStart;
						const buffer = Buffer.allocUnsafe(readLength);
						const { bytesRead } = await handle.read(buffer, 0, readLength, readStart);
						if (bytesRead === 0) return;
						const raw = buffer.toString("utf8", 0, bytesRead);
						let contentStart;
						let text;
						if (readStart === 0) {
							contentStart = 0;
							text = raw;
						} else if (raw.startsWith("\n")) {
							contentStart = readStart + 1;
							text = raw.slice(1);
						} else {
							const firstNewline = raw.indexOf("\n");
							if (firstNewline === -1) return;
							contentStart = readStart + firstNewline + 1;
							text = raw.slice(firstNewline + 1);
						}
						const lines = text.split("\n");
						for (let index = lines.length - 1; index >= 0; index -= 1) {
							const line = lines[index];
							if (line === void 0 || line === "") continue;
							let parsed;
							try {
								parsed = JSON.parse(line);
							} catch {
								continue;
							}
							if (!isRecord(parsed)) continue;
							if (parsed["at"] !== report.at) continue;
							if (parsed["region"] !== report.region) continue;
							if (parsed["bodyBytes"] !== report.bodyBytes) continue;
							if (parsed["messageCount"] !== report.messageCount) continue;
							if (parsed["promptTokens"] !== void 0) return;
							lines[index] = JSON.stringify({
								...parsed,
								...usage
							});
							const rewritten = lines.join("\n");
							await handle.write(rewritten, contentStart, "utf8");
							await handle.truncate(contentStart + Buffer.byteLength(rewritten, "utf8"));
							return;
						}
					} finally {
						await handle.close();
					}
				});
			} catch (error) {
				onError?.(error);
			}
		})();
	};
}
//#endregion
//#region src/loopback.ts
/**
* Who is allowed to talk to the plugin's own HTTP surfaces.
*
* There are two distinct questions and they stop two different attacks, so both
* live here rather than being re-derived per route. A previous version kept the
* Host check inside `shim.ts` and only the Origin check inside `web-status.ts`,
* which meant the shim's chat route had both guards while the settings card's
* thirteen routes (ten POST + three GET) had one — the asymmetry was invisible
* because each file looked internally consistent.
*
* - **Host** answers "is this request addressed to the interface it landed on?".
*   A DNS-rebinding page sends requests whose `Host` is the *attacker's* domain
*   (that is the whole trick: the browser resolves the attacker name to
*   127.0.0.1), so requiring the Host to match the arrival interface drops it.
*   This is the guard an Origin-only check does **not** provide.
* - **Origin** answers "did a page on a foreign origin cause this?". A
*   non-browser client sends no `Origin` at all and must pass, or the plugin's
*   own `fetch` calls would be refused.
*
* Neither is authentication: any local process can forge both headers. They are
* the minimum for these surfaces, not a substitute for a secret when a route
* spends credit.
*
* ## Two callers, two strictnesses (deliberate)
*
* - `src/web-status.ts` serves the settings card over the HOST's webserver, which
*   the harness may configure to bind a concrete non-loopback address. It uses
*   `hostMatchesListener` / `originIsLoopback(origin, localAddress)`, i.e. "is
*   this addressed to / coming from the interface the connection landed on".
* - `src/shim.ts` binds `listen(0, '127.0.0.1')` itself, so no LAN request can
*   ever reach it. It uses the stricter `hostIsLoopback`, which is not a
*   different notion of "local" but the same one narrowed to the only case that
*   can occur.
*
* Keep that in mind before "unifying" the two: the strict form is not a bug in
* the shim, and the loose form is not laxness in the card.
*
* @module dsh-connect-workbuddy/loopback
*/
/**
* Hostnames that count as this machine without comparing against a bind address.
*
* `localhost` is here because it names this machine by definition. The IPv4
* entries cover the loopback /8 rather than the single address 127.0.0.1: the
* host harness itself treats the whole 127/8 as loopback (its own
* `isLoopbackHostname` accepts it, and 127.0.0.2 is a usable second loopback
* address on Linux), so refusing 127.0.0.2 here would reject a request the
* host considers local.
*/
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "[::1]"]);
/**
* Whether a string is a bare IP literal (IPv4 dotted quad, or IPv6 with or
* without the brackets a Host header puts around it).
*
* Deliberately narrow: this decides whether a value is an ADDRESS that may be
* compared with a Host header, so it must reject hostnames and host:port forms.
* A loose "looks like hex" check would label `[deadbeef]` an address, and while
* that cannot open the gate on its own (both sides must still be equal), a
* predicate that answers "yes" to a non-address erodes the property the check is
* supposed to have. `node:net`'s own parser is the authority for IPv6.
*/
function isIpLiteral(value) {
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return value.split(".").every((part) => Number(part) <= 255 && !(part.length > 1 && part.startsWith("0")));
	const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
	return isIP(inner) === 6;
}
/** Whether a bare hostname is inside IPv4 loopback space (127.0.0.0/8). */
function isIpv4Loopback(hostname) {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
	if (match === null) return false;
	const octets = match.slice(1, 5).map((part) => Number(part));
	if (octets.some((octet) => octet > 255)) return false;
	if (match.slice(1, 5).some((part) => part.length > 1 && part.startsWith("0"))) return false;
	return octets[0] === 127;
}
/**
* Strip the optional `:port` from a Host header value, IPv6-bracket aware.
*
* The bracketed form is returned WITH brackets, because {@link LOOPBACK_HOSTS}
* stores it that way and the two must agree.
*
* A `]` that is not at the end of the value (or followed only by `:<digits>`)
* makes the whole thing unparseable, and unparseable returns the input
* unchanged so no caller can mistake it for a loopback name. That matters: a
* naive `slice(0, end + 1)` turns `[::1]evil.example` into `[::1]` and reads a
* foreign host as this machine. Browsers never send such a value, but this
* function is a security boundary, so "never" is the wrong bet.
*/
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		if (end === -1) return hostname;
		const after = hostname.slice(end + 1);
		if (after !== "" && !/^:\d+$/.test(after)) return hostname;
		return hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}
/**
* Whether a Host header names the loopback interface.
*
* An absent Host is treated as NOT loopback. HTTP/1.1 requires the header, so
* its absence is either a malformed request or an attempt to dodge the check —
* neither deserves the benefit of the doubt on a surface that can spend credit.
*/
function hostIsLoopback(host) {
	if (host === void 0 || host.trim() === "") return false;
	return isLocalHostname(hostnameOfHost(host));
}
/**
* Whether a parsed hostname names this machine.
*
* The single definition both predicates use, so the Host and Origin paths cannot
* disagree about what "local" means — they did before (`127.0.0.2` and a trailing
* dot were treated differently by each), which is exactly the kind of split this
* module exists to prevent.
*/
function isLocalHostname(hostname) {
	const name = hostname.endsWith(".") && !hostname.endsWith("..") ? hostname.slice(0, -1) : hostname;
	return LOOPBACK_HOSTS.has(name) || name === "::1" || isIpv4Loopback(name);
}
/**
* Whether a Host header names the address this connection actually arrived on.
*
* This is the guard the routes use, and "must be loopback" is the wrong question.
* The host harness does NOT allow wildcard binds in the version this plugin runs
* against (0.2.x rejects `0.0.0.0` outright: "bind one concrete IPv4 or IPv6
* address of a local interface instead"), but it DOES allow binding one concrete
* local address — including a LAN address. A user who binds their LAN IP and
* opens the GUI at `http://192.168.1.5:3000` sends exactly that in Host, and the
* harness itself considers such a request trusted (its own trust layer accepts
* "the listener's bind IP literal on any port"). A loopback-only check would 403
* that user's read routes while the rest of the harness works, which is a real
* regression for a supported configuration.
*
* So the question is "was this request addressed to the socket it landed on?".
* `localAddress` answers that: it is the interface the CONNECTION was accepted
* on, not the bind literal. Comparing the two drops a rebinding request — whose
* Host is the attacker's domain while the socket landed on 127.0.0.1 or a LAN
* address — while accepting every genuine one, loopback or LAN.
*
* The local branch is not merely an optimisation: a loopback-bound listener
* reports `127.0.0.1` from `localAddress`, so the comparison alone would accept
* `Host: 127.0.0.1` anyway. It is stated first so the answer does not depend on
* how the platform spells its own loopback, and so an undefined `localAddress`
* (a proxy, a test double) still admits genuine local traffic.
*/
function hostMatchesListener(host, localAddress) {
	if (host === void 0 || host.trim() === "") return false;
	const hostname = hostnameOfHost(host);
	if (isLocalHostname(hostname)) return true;
	if (hostname === "0.0.0.0" || hostname === "[::]") return false;
	if (localAddress === void 0 || localAddress.trim() === "") return false;
	const local = localAddress.trim().toLowerCase();
	if (!isIpLiteral(local) && !isIpLiteral(`[${local}]`)) return false;
	const bare = (value) => value.startsWith("[") && value.endsWith("]") && isIP(value.slice(1, -1)) === 6 ? value.slice(1, -1) : value;
	return bare(hostname) === bare(local);
}
/**
* Whether a browser-sent Origin may drive this route.
*
* An ABSENT Origin passes: that is the shape of a non-browser client (the
* plugin's own fetch, a curl, the tests), and refusing it would break the
* plugin's own calls.
*
* A PRESENT Origin must name this machine — judged by the SAME rule as the Host
* header, which is why this takes `localAddress` too. Leaving it loopback-only
* while Host accepted any local interface was a real split: a LAN browser's
* same-origin POST carries `Origin: http://192.168.1.5:3000`, so the Host gate
* admitted it and this one then refused all ten write routes. The two predicates
* use one definition now (see `isLocalHostname`), because a browser reaching the
* server on its LAN address is exactly as legitimate as one reaching it on
* loopback — the harness trusts the bind literal on any port either way.
*
* The comparison is over the HOSTNAME only. `localAddress` carries no port, and
* the route's own port is what a same-origin page must already be using, so a
* port comparison here would add nothing: a page on the same host but another
* port is not a threat this gate is meant to stop (it would need code already
* running on this machine), and treating it as one would break legitimate
* setups behind a proxy that terminates on a different port than it forwards to.
* That intentional limit is recorded rather than silently assumed.
*/
function originIsLoopback(origin, localAddress) {
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		if (isLocalHostname(hostname)) return true;
		return hostMatchesListener(hostname, localAddress);
	} catch {
		return false;
	}
}
/** One or two full-width bars — the count is a spelling variable. */
const BARS = `｜｜?`;
new RegExp(`${BARS}DSML${BARS}`, "g");
/**
* Spellings a tag may carry before its name, longest first so the doubled form
* is consumed before the single one can match its prefix.
*
* The ASCII spellings are accepted because the model mixes them: the marker is
* normalised to ASCII by {@link normalizedPrefixLength}, which is also the only
* way to catch a block that spells the two sides differently.
*/
const MARKUP_PREFIXES = [
	`｜｜DSML｜｜`,
	"||DSML||",
	"|DSML|"
];
/** What the full-width marker looks like after {@link normalizedPrefixLength}. */
const ASCII_PREFIXES = ["||DSML||", "|DSML|"];
/**
* Tag names that can OPEN a block worth recovering.
*
* Deliberately tiny. `parameter` and the model's ad-hoc tag names are NOT here:
* they only ever appear inside a block, so treating one as a block start would
* hold a response hostage waiting for a close that naming never promised.
*/
const BLOCK_TAGS = ["tool_calls", "invoke"];
/**
* Tag names whose content belongs to the markup rather than to the answer.
*
* Used by {@link stripMarkup} to decide whether removing a marker-bearing tag
* should also remove everything up to its matching close. An INVENTED name is
* not here on purpose: `<｜DSML｜ validate>` brackets nothing, so removing it
* means removing the tag and nothing else.
*/
const KEYWORD_TAGS = [
	"tool_calls",
	"tool-calls",
	"toolcalls",
	"invoke",
	"parameter",
	"calls",
	"tool"
];
/** Tag names normalised to their canonical spelling. */
const CANONICAL_TAG_NAMES = /* @__PURE__ */ new Map([
	["tool_calls", "tool_calls"],
	["tool-calls", "tool_calls"],
	["toolcalls", "tool_calls"],
	["invoke", "invoke"],
	["parameter", "parameter"]
]);
/**
* Canonical names accepted ONLY in a marker form.
*
* `<toolcalls>` without the marker is somebody's HTML, not the model's markup;
* the marker is what makes the misspelling meaningful.
*/
const MARKER_ONLY_TAG_NAMES = /* @__PURE__ */ new Set(["tool-calls", "toolcalls"]);
/** Fence markers at the start of a line. */
const FENCE_MARKERS = ["```", "~~~"];
/**
* Shortest tool name a near-miss repair may act on (issue #152).
*
* Below this, "one edit apart" stops being evidence: `dash` and `bash` are one
* edit apart, and so are any two four-letter names sharing a prefix. At 4 the
* reported `pwsh` → `pwdsh` still qualifies (both are 4+), which is the shape
* this exists for.
*/
const NEAR_NAME_MIN_LENGTH = 4;
/**
* Whether `a` and `b` are at most one edit apart (insertion, deletion, or
* substitution).
*
* Only ever asked for a ceiling of 1, where the general Levenshtein matrix is
* unnecessary: the lengths must differ by at most one, and after skipping the
* first position where they differ, the remaining tails must still agree.
*
* The equal-length case is a SUBSTITUTION, not an insertion, so it is checked
* separately — skipping the differing character on one side only would leave
* tails of different length and silently miss every one-character typo of the
* same length (`pwdsh`/`pwdss`, `bash`/`dash`), which is the whole point here.
*/
function withinOneEdit(a, b) {
	if (a === b) return true;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	if (long.length - short.length > 1) return false;
	let i = 0;
	while (i < short.length && short[i] === long[i]) i++;
	if (short.length === long.length) return short.slice(i + 1) === long.slice(i + 1);
	return long.slice(i + 1) === short.slice(i);
}
/**
* The one declared tool within a single edit of `written`, or `undefined`.
*
* Refuses when the name is already declared (nothing to repair), when either
* side is shorter than {@link NEAR_NAME_MIN_LENGTH}, and when more than one
* declared tool is in reach — ambiguity is exactly what gate 2 exists to stop.
*/
function nearMissNameFor(written, declaredNames) {
	if (declaredNames.has(written)) return void 0;
	if (written.length < NEAR_NAME_MIN_LENGTH) return void 0;
	let fit;
	for (const candidate of declaredNames) {
		if (candidate.length < NEAR_NAME_MIN_LENGTH) continue;
		if (!withinOneEdit(written, candidate)) continue;
		if (fit !== void 0) return void 0;
		fit = candidate;
	}
	return fit;
}
/**
* Find every span that must not be scanned for markup.
*
* One pass, not a predicate call per character: the reference asks
* `is_inside_markdown_fence(text, i)` inside a per-character loop, which is
* quadratic in the size of the buffer. The buffer holds a whole block, and a
* block can be large (a file's worth of arguments), so the port computes the
* spans once and walks them.
*
* Semantics match the reference: fences only count at the start of a line,
* code spans are runs of one or two backticks, and an unterminated span runs to
* the end of the text (the closer may still be in flight).
*/
function ignoredSpans(text) {
	const spans = [];
	let i = 0;
	let fence;
	let fenceStart = 0;
	while (i < text.length) {
		const atLineStart = i === 0 || text.charAt(i - 1) === "\n";
		if (fence !== void 0) {
			if (atLineStart && text.startsWith(fence, i)) {
				const lineEnd = text.indexOf("\n", i);
				const end = lineEnd === -1 ? text.length : lineEnd + 1;
				spans.push({
					start: fenceStart,
					end,
					open: false
				});
				fence = void 0;
				i = end;
				continue;
			}
			i += 1;
			continue;
		}
		if (atLineStart) {
			const marker = FENCE_MARKERS.find((candidate) => text.startsWith(candidate, i));
			if (marker !== void 0) {
				fence = marker;
				fenceStart = i;
				i += marker.length;
				continue;
			}
		}
		if (text.charAt(i) === "`") {
			const end = codeSpanEnd(text, i);
			if (end === -1) {
				spans.push({
					start: i,
					end: text.length,
					open: true
				});
				break;
			}
			spans.push({
				start: i,
				end,
				open: false
			});
			i = end;
			continue;
		}
		const xml = xmlIgnoredEnd(text, i);
		if (xml !== void 0) {
			spans.push(xml);
			if (xml.end >= text.length && xml.open) break;
			i = xml.end;
			continue;
		}
		i += 1;
	}
	if (fence !== void 0) spans.push({
		start: fenceStart,
		end: text.length,
		open: true
	});
	return spans;
}
/**
* End of the inline code span starting at `start`, or -1 when there is none.
*
* Three or more backticks are a fence, not a code span — {@link ignoredSpans}
* handles those, and conflating the two is how a fence's opening ticks get
* mistaken for an unclosed inline span.
*/
function codeSpanEnd(text, start) {
	let ticks = 0;
	let i = start;
	while (i < text.length && text.charAt(i) === "`") {
		ticks += 1;
		i += 1;
	}
	if (ticks === 0 || ticks >= 3) return -1;
	let end = i;
	while (end < text.length) {
		if (text.charAt(end) !== "`") {
			end += 1;
			continue;
		}
		let closingTicks = 0;
		let j = end;
		while (j < text.length && text.charAt(j) === "`") {
			closingTicks += 1;
			j += 1;
		}
		if (closingTicks === ticks) return j;
		end = j;
	}
	return -1;
}
/** CDATA / comment / processing instruction at `index`, if one starts there. */
function xmlIgnoredEnd(text, index) {
	for (const [open, close] of [
		["<![CDATA[", "]]>"],
		["<!--", "-->"],
		["<?", "?>"]
	]) {
		if (!text.startsWith(open, index)) continue;
		const found = text.indexOf(close, index + open.length);
		if (found === -1) return {
			start: index,
			end: text.length,
			open: true
		};
		return {
			start: index,
			end: found + close.length,
			open: false
		};
	}
}
/**
* Index just past the ignored span containing `index`, or `index` unchanged.
*
* `cursor` is a hint into the sorted span list; callers that walk positions in
* order get O(1) amortised lookup, which is why the parameter exists.
*/
function skipIgnored(spans, index, cursor) {
	while (cursor.at < spans.length) {
		const span = spans[cursor.at];
		if (span === void 0 || index < span.start) return index;
		if (index < span.end) return span.end;
		cursor.at += 1;
	}
	return index;
}
/**
* Length of the marker prefix at `index`, or 0 when none is there.
*
* Two passes on purpose. The literal spellings are tried first; then the text
* is normalised character by character, which is the only way to recognise a
* block that mixes the two bar styles — and mixing is normal: one captured
* emission spelled the opening tags with single bars and the closer with double.
*/
function prefixLengthAt(text, index) {
	for (const prefix of MARKUP_PREFIXES) if (text.startsWith(prefix, index)) return prefix.length;
	const normalized = normalizeFullwidth(text.slice(index, index + 8));
	for (const prefix of ASCII_PREFIXES) if (normalized.startsWith(prefix)) return prefix.length;
	return 0;
}
/** Is a single character usable inside a tag name? Mirrors Python's `isalnum()`. */
function isNameCharacter(text, index) {
	return /[\p{L}\p{N}_-]/u.test(text.charAt(index));
}
/** Read a tag name at `index` (after any marker prefix). */
function readName(text, index) {
	const prefixLength = prefixLengthAt(text, index);
	const marked = prefixLength > 0;
	let position = index + prefixLength;
	while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
	const start = position;
	while (position < text.length && isNameCharacter(text, position)) position += 1;
	if (position === start) return {
		name: "",
		end: index,
		marked
	};
	return {
		name: text.slice(start, position).toLowerCase(),
		end: position,
		marked
	};
}
/**
* Scan a tag at `index`, or nothing when there is not one.
*
* Any name is accepted (the model invents parameter tags freely); only the ones
* in {@link CANONICAL_TAG_NAMES} are normalised, and the misspellings are
* normalised only in a marker form — `<toolcalls>` alone is somebody's HTML.
*/
function scanTag(text, index) {
	if (text.charAt(index) !== "<") return void 0;
	let position = index + 1;
	let closing = false;
	if (text.charAt(position) === "/") {
		closing = true;
		position += 1;
	}
	while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
	const read = readName(text, position);
	if (read.name === "") return void 0;
	const canonical = CANONICAL_TAG_NAMES.get(read.name);
	const name = canonical !== void 0 && !(MARKER_ONLY_TAG_NAMES.has(read.name) && !read.marked) ? canonical : read.name;
	const attributesStart = read.end;
	let selfClosing = false;
	let cursor = read.end;
	while (cursor < text.length) {
		const character = text.charAt(cursor);
		if (character === ">") return {
			start: index,
			end: cursor,
			name,
			closing,
			selfClosing,
			marked: read.marked,
			attributes: text.slice(attributesStart, cursor).trim()
		};
		if (character === "/" && text.charAt(cursor + 1) === ">") {
			selfClosing = true;
			return {
				start: index,
				end: cursor + 1,
				name,
				closing,
				selfClosing,
				marked: read.marked,
				attributes: text.slice(attributesStart, cursor).trim()
			};
		}
		cursor += 1;
	}
}
/** The next markup tag outside every ignored span, at or after `from`. */
function findTag(text, spans, from) {
	const cursor = { at: 0 };
	let index = Math.max(from, 0);
	while (index < text.length) {
		const skipped = skipIgnored(spans, index, cursor);
		if (skipped !== index) {
			index = skipped;
			continue;
		}
		if (text.charAt(index) === "<") {
			const tag = scanTag(text, index);
			if (tag !== void 0) return tag;
		}
		index += 1;
	}
}
/**
* The close tag matching `open`, or nothing when it has not arrived yet.
*
* Depth counting so a nested block of the same name cannot terminate its parent
* early. This is gate 1's teeth: no close, no call.
*/
function findMatchingClose(text, spans, open) {
	let depth = 1;
	let index = open.end + 1;
	while (index < text.length) {
		const tag = findTag(text, spans, index);
		if (tag === void 0) return void 0;
		if (tag.name === open.name) {
			if (tag.closing) {
				depth -= 1;
				if (depth === 0) return tag;
			} else if (!tag.selfClosing) depth += 1;
		}
		index = tag.end + 1;
	}
}
/**
* The first block-opening tag in `text`, with its close when one has arrived.
*
* The close is OPTIONAL on purpose, and the two callers need it differently:
* the buffer holds from `open` while it is missing (gate 1 — the block may
* still complete), whereas parsing already-complete text stops rather than
* correcting a broken block and then trusting what follows it.
*/
function findFirstOpener(text, spans) {
	let index = 0;
	while (index < text.length) {
		const tag = findTag(text, spans, index);
		if (tag === void 0) return void 0;
		if (!tag.closing && BLOCK_TAGS.includes(tag.name)) {
			const close = findMatchingClose(text, spans, tag);
			return close === void 0 ? { open: tag } : {
				open: tag,
				close
			};
		}
		index = tag.end + 1;
	}
}
/** Decode the five predefined XML entities plus numeric references. */
function decodeEntities(text) {
	if (!text.includes("&")) return text;
	const named = /* @__PURE__ */ new Map([
		["amp", "&"],
		["lt", "<"],
		["gt", ">"],
		["quot", "\""],
		["apos", "'"]
	]);
	return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
		if (body.startsWith("#")) {
			const hex = body.charAt(1).toLowerCase() === "x";
			const digits = hex ? body.slice(2) : body.slice(1);
			const code = Number.parseInt(digits, hex ? 16 : 10);
			if (!Number.isFinite(code) || code <= 0 || code > 1114111) return whole;
			return String.fromCodePoint(code);
		}
		return named.get(body.toLowerCase()) ?? whole;
	});
}
/** `name="value"` / `name='value'` pairs, entities decoded. */
function parseAttributes(text) {
	const attributes = {};
	const pattern = /([a-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	let match = pattern.exec(text);
	while (match !== null) {
		const key = match[1];
		const value = match[2] ?? match[3];
		if (key !== void 0 && value !== void 0) attributes[key] = decodeEntities(value);
		match = pattern.exec(text);
	}
	return attributes;
}
/**
* Parse the parameters inside one block body.
*
* Two shapes, in the order the model prefers them:
*   - `<｜DSML｜parameter name="cmd">value</…parameter>` (the explicit form);
*   - `<cmd>value</cmd>` (the tag name IS the parameter name), used only when
*     the explicit form has not already claimed that name — otherwise a nested
*     tag echoing it would overwrite the real value.
*
* A `CDATA` body is taken verbatim; everything else is entity-decoded.
*
* Every scanner here computes its ignored spans from the string it is about to
* scan. Span offsets are only meaningful against the text they were measured
* on, and a body is a substring of its parent — reusing the parent's offsets
* would misplace every fence and silently turn "quoted markup" into "called
* markup", which is gate 4's worst failure. Each of these strings is small, so
* recomputing is cheaper than passing a coordinate system around.
*/
function parseParameters(body) {
	const parameters = {};
	const spans = ignoredSpans(body);
	let index = 0;
	while (index < body.length) {
		const tag = findTag(body, spans, index);
		if (tag === void 0) break;
		if (tag.closing || tag.selfClosing) {
			index = tag.end + 1;
			continue;
		}
		const close = findMatchingClose(body, spans, tag);
		if (close === void 0) {
			index = tag.end + 1;
			continue;
		}
		const value = body.slice(tag.end + 1, close.start).trim();
		const attributes = parseAttributes(tag.attributes);
		const explicitName = tag.name === "parameter" ? attributes["name"] : void 0;
		const name = explicitName ?? tag.name;
		if (name !== void 0 && name !== "" && (explicitName !== void 0 || parameters[name] === void 0)) parameters[name] = value.startsWith("<![CDATA[") && value.endsWith("]]>") ? value.slice(9, -3) : nestedOrText(value);
		index = close.end + 1;
	}
	return parameters;
}
/** A value that itself contains a complete tag pair is a nested object. */
function nestedOrText(value) {
	if (!value.includes("<") || !value.includes(">")) return decodeEntities(value);
	const nested = parseParameters(value);
	return Object.keys(nested).length > 0 ? nested : decodeEntities(value);
}
/**
* One block's worth of text → the calls it declares, or nothing.
*
* This is where gates 2 and 4 live. Returning nothing is the COMMON case for
* mistaken input and is not an error: callers must show the block verbatim.
*/
function parseBlock(block, gate, seen) {
	const calls = [];
	let withheld = false;
	const spans = ignoredSpans(block);
	let index = 0;
	while (index < block.length) {
		const tag = findTag(block, spans, index);
		if (tag === void 0) break;
		if (!tag.closing && tag.name === "invoke") {
			const close = findMatchingClose(block, spans, tag);
			if (close === void 0) break;
			const call = parseInvoke(tag, close, block, gate);
			if (call !== void 0) calls.push(call);
			else if (tag.attributes.trim() === "" && gate.onWithheld !== void 0) {
				seen.reason ??= "unnamed-invoke";
				withheld = true;
			}
			index = close.end + 1;
			continue;
		}
		index = tag.end + 1;
	}
	return {
		calls,
		withheld
	};
}
/** One `<invoke>` element → a call, or nothing when a gate refuses it. */
function parseInvoke(open, close, block, gate) {
	const declared = parseAttributes(open.attributes)["name"];
	const parameters = parseParameters(block.slice(open.end + 1, close.start));
	let name;
	if (declared !== void 0 && declared !== "") {
		if (!gate.declaredNames.has(declared)) {
			const repaired = gate.repairNearMissName === true ? nearMissNameFor(declared, gate.declaredNames) : void 0;
			if (repaired === void 0) return void 0;
			name = repaired;
		} else name = declared;
	} else if (open.attributes.trim() === "") {
		name = inferNameFromSchema(parameters, gate);
		if (name === void 0) return void 0;
	} else return;
	const pinned = gate.pinnedToolName;
	if (pinned !== void 0 && pinned !== "auto" && pinned !== "required" && pinned !== "none" && pinned !== name) return;
	const required = gate.requiredParameters?.get(name);
	if (required !== void 0 && required.some((parameter) => parameters[parameter] === void 0)) return void 0;
	return {
		id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
		name,
		arguments: JSON.stringify(parameters)
	};
}
/**
* Name a call from its ARGUMENTS when the opener names no tool — or refuse.
*
* The evidence is the model's own parameter tags; the constraint is the
* request's schemas. A tool qualifies only when every tag the block carries is
* accepted by its schema AND every required parameter is already present, and
* exactly ONE declared tool qualifies. Everything less certain refuses:
*
*   - a block with no parameter tags at all (no evidence to read);
*   - a tool whose schema is unknown here (it cannot be cleared — silence must
*     not let an unverified tool win or lose);
*   - a parameter no accepted set lists;
*   - two tools that both fit ("the only tool on offer" was the whole point).
*/
function inferNameFromSchema(parameters, gate) {
	const tags = Object.keys(parameters);
	if (tags.length === 0) return void 0;
	let fit;
	for (const tool of gate.declaredNames) {
		const accepted = gate.acceptedParameters?.get(tool);
		if (accepted === void 0) return void 0;
		if (tags.some((tag) => !accepted.has(tag))) continue;
		const required = gate.requiredParameters?.get(tool);
		if (required !== void 0 && required.some((parameter) => parameters[parameter] === void 0)) continue;
		if (fit !== void 0) return void 0;
		fit = tool;
	}
	return fit;
}
/**
* `text` with every markup block removed — the check behind {@link hasProse}.
*
* ANY marker-bearing tag counts as markup, whatever it is called. Keying on the
* known names alone was the first attempt and it got the one shape this project
* has actually captured wrong: `<｜DSML｜ validate>` carries an invented name
* (`validate` is the TOOL name, written where `invoke name="…"` belongs), so a
* keyword-only rule left it standing, the response was classified as prose, and
* the retry-when-the-turn-produced-nothing rule could never fire for the very
* leak it was written for — a check that never fires, which is the trap this
* project has already paid for twice.
*
* Removal reaches the matching close only for names that bracket content
* ({@link KEYWORD_TAGS}); an invented name removes just its own tag, because
* nothing says it opens anything.
*
* Ignored spans are KEPT: a fenced or back-ticked quotation of the marker is
* prose, and the rule is explicitly about a turn that produced nothing usable.
*/
function stripMarkup(text) {
	const spans = ignoredSpans(text);
	const cursor = { at: 0 };
	let result = "";
	let index = 0;
	while (index < text.length) {
		const skipped = skipIgnored(spans, index, cursor);
		if (skipped !== index) {
			result += text.slice(index, skipped);
			index = skipped;
			continue;
		}
		const tag = text.charAt(index) === "<" ? scanTag(text, index) : void 0;
		if (tag === void 0 || !tag.marked) {
			result += text.charAt(index);
			index += 1;
			continue;
		}
		const close = !tag.closing && !tag.selfClosing && KEYWORD_TAGS.includes(tag.name) ? findMatchingClose(text, spans, tag) : void 0;
		index = close === void 0 ? tag.end + 1 : close.end + 1;
	}
	return result;
}
/**
* Drop stray marker-bearing tags from otherwise-ordinary prose, and say so.
*
* This is the OTHER half of "the user must never see protocol debris": a block
* is handled by {@link parseBlock} (recovered, withheld, or shown verbatim by
* gate 4), but lone tags outside every block — `</｜DSML｜｜ calls>` closing a
* wrapper whose opener belonged to a withheld call, `<｜DSML｜ validate>` —
* arrive as plain text and used to be forwarded raw. They are markup, not the
* answer: {@link stripMarkup} already knows exactly which bytes those are
* (marker-bearing tags only, quoted ones inside fences and code spans kept),
* so this runs it and records the removal. The record makes it reportable —
* silence about removing content is the failure mode this whole module exists
* to avoid.
*
* Gate 4's "show it verbatim" applies to BLOCKS (which may be content); a lone
* marker tag has no content of its own to lose, only the name it wears.
*/
function stripStray(text, seen) {
	const cleaned = stripMarkup(text);
	if (cleaned !== text) seen.reason ??= "stray-markup";
	return cleaned;
}
/**
* Drop a marker-bearing tag fragment that the stream held and can never finish.
*
* {@link holdFrom} keeps back a tail that could still become a block opener, so
* at end of stream that held tail is by construction an unterminated `<…`. Two
* outcomes, and the difference is the marker:
*
*   - it carries the marker (`<｜DSM`, `</｜DSML｜ invo`): the marker is what
*     makes it protocol debris rather than prose. Its close is never coming, so
*     forwarding it hands the user half a tag — the `</｜DSML｜ invo` that
*     trailed a killed stream. It goes, and says so.
*   - it does not (`<`, `</`, `<tool`): a bare `<` is doubt, not evidence, and
*     is kept. A person may have meant the character, and half a word is a
*     worse lie than a stray bracket.
*
* Only the LAST `<` is examined. Everything before it was already cleared by
* `holdFrom`, and an earlier `<` inside ordinary prose must not be dragged out
* along with the fragment that happens to follow it.
*/
function dropUnfinishedMarkerTail(text, seen) {
	const lastLt = text.lastIndexOf("<");
	if (lastLt === -1) return text;
	if (!isLateMarkerFragment(text.slice(lastLt))) return text;
	seen.reason ??= "stray-markup";
	return text.slice(0, lastLt);
}
/**
* Is this unterminated tag fragment a marker-bearing one?
*
* Deliberately narrow, for the same reason {@link looksLikeTagStart} is: it must
* still be open (`>` never arrived, which is what "held at end of stream" means)
* and, once the `<` and an optional `/` are stripped, the rest must BE a partial
* marker or be a complete marker followed by a partial name. `<tool` fails the
* second test and survives; so does `<`, which is not evidence of anything.
*/
function isLateMarkerFragment(tail) {
	if (!tail.startsWith("<")) return false;
	if (tail.includes(">")) return false;
	let body = tail.slice(1);
	if (body.startsWith("/")) body = body.slice(1);
	if (body === "") return false;
	if (isPartialMarker(body)) return true;
	const prefixLength = prefixLengthAt(body, 0);
	if (prefixLength === 0) return false;
	return /^[A-Za-z_-]*$/.test(body.slice(prefixLength).trim());
}
/**
* Does `text` carry content outside markup blocks?
*
* This is what makes "the turn produced nothing usable" a checkable fact rather
* than a guess: a response whose only content is markup residue returns false,
* and the caller may then consider a single retry. Text inside a fence or code
* span counts as content — a documented quotation of the marker is prose.
*/
function hasProse(text) {
	return stripMarkup(text).trim() !== "";
}
/**
* Which of `text`'s tail must wait for more bytes.
*
* Two reasons to hold, and only these two:
*   - the tail starts a tag that is not closed yet, and could still turn out to
*     be a block opener (`…<｜DSML｜inv`), so committing it as text would make
*     the block unparseable;
*   - the tail opens a code span whose closer is still in flight, because
*     whether the following markup is *quoted* depends on that span.
*
* Anything else is emitted immediately. In particular a COMPLETE tag that is
* not a block opener — `<｜DSML｜ validate>`, the shape this project actually
* captured — is not held: it is prose as far as this layer is concerned, and
* holding it would delay every ordinary answer that mentions the markup.
*/
function holdFrom(text, spans) {
	let hold = text.length;
	const lastLt = text.lastIndexOf("<");
	if (lastLt !== -1 && looksLikeTagStart(text.slice(lastLt))) hold = Math.min(hold, lastLt);
	for (const span of spans) if (span.open) hold = Math.min(hold, span.start);
	return hold;
}
/**
* Could this fragment be the beginning of a block-opening tag?
*
* Conservative by construction: it requires an unterminated `<`, and after
* stripping an optional `/`, whitespace and marker, the remainder must be a
* prefix of (or extend) a known opener. That is what keeps `a < b`, `<50%` and
* `i < n` in ordinary prose from stalling a stream — each of them either
* contains a `>` or fails the opener test.
*
* A marker that is STILL ARRIVING also holds (`<｜`, `<｜DSML`, `||D`). Without
* that case the leading `<｜` is emitted as text the moment it arrives, and the
* block can never be recovered afterwards because its opening tag has already
* been split in two — a byte-by-byte feed is how this was found, and the
* reference implementation has the same hole.
*/
function looksLikeTagStart(tail) {
	if (!tail.startsWith("<")) return false;
	if (tail.includes(">")) return false;
	let body = tail.slice(1);
	if (body.startsWith("/")) body = body.slice(1);
	if (body === "" || isPartialMarker(body)) return true;
	const prefixLength = prefixLengthAt(body, 0);
	if (prefixLength > 0) return true;
	body = body.slice(prefixLength).trim().toLowerCase();
	if (body === "" || isPartialMarker(body)) return true;
	return [
		"tool",
		"invoke",
		"tool_calls",
		"tool-calls",
		"toolcalls",
		"tool_call",
		"tool-call"
	].some((opener) => opener.startsWith(body) || body.startsWith(opener));
}
/**
* Is this the start of a marker whose remainder has not arrived yet?
*
* Compared both literally and full-width-normalised, because the model mixes
* the two bar styles and a mixture splits at an unpredictable character.
*/
function isPartialMarker(body) {
	const trimmed = body.trimStart();
	if (trimmed === "") return true;
	const forms = [...MARKUP_PREFIXES, ...ASCII_PREFIXES];
	return [trimmed, normalizeFullwidth(trimmed.slice(0, 8))].some((candidate) => candidate !== "" && forms.some((form) => form.startsWith(candidate) && candidate.length < form.length));
}
/** Full-width ASCII (U+FF01..U+FF5E) mapped to its ASCII counterpart. */
function normalizeFullwidth(text) {
	let normalized = "";
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		normalized += code >= 65281 && code <= 65374 ? String.fromCodePoint(code - 65248) : character;
	}
	return normalized;
}
/**
* Buffers `delta.content` and commits a call only when the block that declares
* it is complete.
*
* Ported from the reference's `ToolCallStreamBuffer` with its hard-won
* behaviour intact:
*
*   - a block with no close tag yet holds the ENTIRE block (not a partial
*     guess), and only the tail that could still become a tag is held back
*     from otherwise-finished text;
*   - a block that fails the gates is emitted VERBATIM (gate 4), not dropped;
*   - {@link flush} hands back whatever is still held, so a truncated block
*     loses none of its text.
*
* The reference's own comment explains why the tail rule is not "hold
* everything from the first `<`": an architecture document that shows
* `<tool_calls><invoke>` as an EXAMPLE would otherwise starve the rest of the
* response until the stream ended, and then lose it.
*/
var DsmlStreamBuffer = class {
	pending = "";
	gate;
	/** The first withholding reason observed in this stream, reported once. */
	withHeld = {};
	/**
	* Set once anything has been withheld from this response.
	*
	* It gates the debris sweep, and that is the whole point: gate 4 promises a
	* REFUSED block is shown verbatim, so marker text must survive the stream
	* untouched in every response that withheld nothing. Only after a block has
	* been removed can the tags left around it be known to belong to markup the
	* reader is no longer seeing — the wrapper's own `calls` closer, the opener
	* the withheld call never got. Before that, a marker tag in the text may be
	* the answer itself.
	*/
	withheldOnce = false;
	/** Whether the one notice allowed per response has gone out. See `takeWithheld`. */
	noticeSent = false;
	constructor(gate) {
		this.gate = gate;
	}
	/** Feed one `delta.content` chunk; returns text and any call it completed. */
	add(chunk) {
		this.pending += chunk;
		const parts = [];
		const calls = [];
		if (this.gate.declaredNames.size === 0) {
			const text = this.pending;
			this.pending = "";
			return {
				text,
				prose: hasProse(text),
				withheld: false
			};
		}
		for (;;) {
			const found = findFirstOpener(this.pending, ignoredSpans(this.pending));
			if (found === void 0) break;
			const head = this.stripDebris(this.pending.slice(0, found.open.start));
			if (head !== "") parts.push(head);
			if (found.close === void 0) {
				this.pending = this.pending.slice(found.open.start);
				return finish(parts, calls, this.takeWithheld());
			}
			const body = this.pending.slice(found.open.start, found.close.end + 1);
			const parsed = parseBlock(body, this.gate, this.withHeld);
			if (parsed.calls.length > 0) calls.push(...parsed.calls);
			else if (!parsed.withheld) parts.push(body);
			this.pending = this.pending.slice(found.close.end + 1);
		}
		const hold = holdFrom(this.pending, ignoredSpans(this.pending));
		if (hold > 0) {
			const tail = this.stripDebris(this.pending.slice(0, hold));
			if (tail !== "") parts.push(tail);
		}
		this.pending = this.pending.slice(hold);
		return finish(parts, calls, this.takeWithheld());
	}
	/** End of stream: hand back everything still held — minus the debris. */
	flush() {
		let text = this.pending;
		this.pending = "";
		if (isUnnamedInvoke(text) && this.gate.onWithheld !== void 0) {
			this.withHeld.reason ??= "unnamed-invoke";
			text = "";
		}
		if (this.debris()) {
			text = dropUnfinishedMarkerTail(text, this.withHeld);
			text = stripStray(text, this.withHeld);
		}
		const state = this.takeWithheld();
		const outcome = {
			text,
			prose: hasProse(text),
			withheld: state.withheld
		};
		if (state.withheldReason !== void 0) outcome.withheldReason = state.withheldReason;
		return outcome;
	}
	/**
	* Apply the debris sweep, but only to a response that has withheld something.
	*
	* See {@link withheldOnce}: before the first withhold, marker text in the
	* prose is the caller's to show, not this layer's to delete.
	*/
	stripDebris(text) {
		return this.debris() ? stripStray(text, this.withHeld) : text;
	}
	/** Has anything been withheld from this response, yet or already? */
	debris() {
		return this.withheldOnce || this.withHeld.reason !== void 0;
	}
	/**
	* Hand the accumulated reason to exactly one outcome.
	*
	* Exactly one, because the notice it drives is emitted once per response. A
	* reason reported on two outcomes would print the same sentence twice.
	*/
	takeWithheld() {
		const reason = this.withHeld.reason;
		if (reason === void 0) return { withheld: false };
		this.withHeld = {};
		this.withheldOnce = true;
		if (this.noticeSent) return { withheld: true };
		this.noticeSent = true;
		this.gate.onWithheld?.(reason);
		return {
			withheld: true,
			withheldReason: reason
		};
	}
};
/**
* Is this block an invocation the model wrote without naming a tool?
*
* Deliberately narrow: no attribute at all on the opener. `<invoke name="">`
* is a REFUSED call with a name the gates can judge, and gate 4 shows it.
*/
function isUnnamedInvoke(body) {
	const open = scanTag(body, 0);
	return open !== void 0 && !open.closing && open.name === "invoke" && open.attributes.trim() === "";
}
/** Assemble one `add()` outcome without ever emitting a `calls: undefined` key. */
function finish(parts, calls, state) {
	const text = parts.join("");
	const outcome = {
		text,
		prose: hasProse(text),
		withheld: state.withheld
	};
	if (state.withheldReason !== void 0) outcome.withheldReason = state.withheldReason;
	if (calls.length > 0) outcome.calls = [...calls];
	return outcome;
}
//#endregion
//#region src/shim.ts
/**
* Loopback OpenAI-compatible endpoint. The pi-ai provider points here; the
* shim applies the WorkBuddy wire quirks (forced streaming, string
* `tool_choice`, CLI-shaped headers) and forwards to the real upstream.
* It binds 127.0.0.1 only and never serves another interface.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — 入站加固的四重校验（Host 必须回环、Origin 必须回环、chat POST 必须
*     JSON、bearer 必须匹配进程内随机 secret）、常量时间比对、
*     随机端口绑定、body 上限、上游错误分类到 HTTP 状态码的映射，
*     均由该项目设计并验证。
* 改动：随机端口绑定加了「先确认客户端能用」一步（`listenOnClientReachablePort`）。
*   绑定方式仍是 `listen(0)` + 仅回环，随机性不变；改的只是抽到 HTTP 客户端
*   禁用端口（fetch 规范的 block-bad-port 清单）时重抽，而不是带着一个自己
*   客户端连不上的端口启动。四重校验、常量时间比对、body 上限、
*   错误分类均未改动。
*
* @module dsh-connect-workbuddy/shim
*/
const REQUEST_BODY_LIMIT = 67108864;
/**
* Pause between failover attempts, after one account's request failed.
*
* The upstream's rate limit (6004) fires on request volume — firing retries at
* zero gap makes every candidate hit the same wall, and 4 accounts can all fail
* in under a second. The batch test already waits `POOL_BATCH_GAP_MS` (400ms)
* between accounts for exactly this reason; the failover loop used to wait
* nothing. 2 seconds is longer than the batch's 400 because a failover retry is
* a real request the user is waiting on, not a probe — it needs enough room for
* the upstream's window to breathe, not just enough to avoid self-inflicted
* rate-limiting.
*/
const FAILOVER_ACCOUNT_GAP_MS = 2e3;
/** Chat-completion POSTs must carry a JSON body type (simple-request CSRF drops here). */
function isJsonContentType(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
	hard_credit: 402,
	soft_rate: 429,
	model_busy: 429,
	session_dead: 401,
	policy_reject: 403,
	account_restricted: 403,
	channel_reject: 400,
	model_queue: 429,
	not_found: 502,
	server: 502,
	client: 400
};
/**
* The `code` spelling the HOST is expected to classify each upstream failure by.
*
* The host decides whether a failed request may be retried IN PLACE (5 attempts
* with backoff) or must be handed to cross-provider failover by reading English
* phrases out of `type + " " + code + " " + message` — see
* `isQuotaExceededError` in `@deepseek-ai/dsh-llm`. Only `RATE_LIMIT`, `SERVER`,
* `TIMEOUT`, `TRANSPORT` and `EMPTY_RESPONSE` are in its retry set, so the
* spelling decides which of two very different things happens next.
*
* `soft_rate` is the one kind that spelling got wrong. The upstream's 429 says
* "usage exceeds the frequency limit, and it resets at 13:37" — hours away, not
* two seconds. Sent as `soft_rate` it reads as an ordinary rate limit, enters
* the in-place retry set, and spends the whole retry budget on an endpoint that
* cannot recover within it; by the time cross-provider failover is offered, the
* turn has already failed. The upstream's own words are Chinese, so the
* phrase-based classifier cannot see the distinction either — the label is the
* only channel left to carry it.
*
* `quota_exceeded` is the minimal honest translation: it is the WORDS the host
* recognises, and it matches what the upstream is actually saying. The HTTP
* status stays 429 (that is what the upstream returned — relabelling it 402
* would misreport the upstream), and the upstream's own message is still passed
* through verbatim for a human to read.
*
* Every other kind already lands outside the retry set by its status alone
* (`hard_credit` 402 → quota, `session_dead` 401 → auth, 502/400 → other), so
* none of them is listed: a translation nobody needs is a lie waiting to drift.
*
* `policy_reject` is deliberately NOT listed either, for a sharper reason than
* the others: the obvious candidate translation would be the upstream's own
* numeric code (11140), but that is not a class the host knows, so it would take
* the host's generic path and add nothing over `policy_reject`. It needs no
* translation to stay outside the retry set (403), and it must NOT be translated
* INTO the set — a content-policy refusal is deterministic, so retrying it in
* place would spend the retry budget on a request the server will refuse again,
* and cross-provider failover cannot help a policy decision either. The code the
* host receives therefore names the class honestly.
*
* `model_busy` used to get the same `quota_exceeded` translation, for what
* looked like the same reason, and that was WRONG in a way users reported
* (issue #84). The reasoning above assumed `quota_exceeded` only influenced
* retryability. It does more than that: `isQuotaExceededError` is matched
* against `type + " " + code + " " + message`, the match yields host code
* `QUOTA`, and the chat client hard-codes its copy for `QUOTA`/`ACCOUNT_QUOTA`
* — substituting 「当前请求的额度已用尽」 and DISCARDING this plugin's message.
* So a loaded model was shown to the user as an exhausted balance: an
* actionable, transient condition rendered as a terminal, account-level one.
*
* Leaving `model_busy` untranslated is the correct spelling, and it was
* verified end to end rather than reasoned about: driving pi-ai against a
* server replaying this shim's real bodies, `code: 'model_busy'` classifies as
* `RATE_LIMIT` — which (a) is outside the substitution list, so the plugin's
* own honest sentence is what the user reads, and (b) IS in the host's
* in-place retry set, so `dsh-llm-retry` performs a bounded retry with the
* default 500 ms→10 s backoff instead of failing the turn on one 14003. That
* retry is what makes "the model is momentarily busy" recoverable, which is
* exactly what a 14003 is: measured against the same credential and second,
* five consecutive sends gave 200/200/200/200/429.
*
* `soft_rate` keeps the translation, and the contrast is the whole point: its
* reset is hours away, so the retry budget cannot produce an answer and must
* not be spent. One word, two opposite temporal claims — so the spelling
* follows the clock, not the status code both share.
*
* `channel_reject` is not listed, and the reason is the same rule applied to a
* third clock: the gate's verdict is DETERMINISTIC for a given prompt, so an
* in-place retry would spend the budget re-sending bytes it already refused, and
* cross-provider failover cannot help either (every account sends that same
* prompt). Its 400 already places it outside the host's retry set, so `type`
* alone, untranslated, is the honest spelling.
*/
const KIND_HOST_CODE = { soft_rate: "quota_exceeded" };
/**
* The `code` to write for an upstream failure, given its classified kind.
*
* `type` deliberately stays the plugin's own kind: it is what a human reads in
* a log or a bug report, and it keeps the two fields individually meaningful.
* Only `code` carries the host-facing translation.
*/
function hostErrorCode(kind) {
	return KIND_HOST_CODE[kind] ?? kind;
}
function writeJson(res, status, body, headers) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		...headers
	});
	res.end(payload);
}
/**
* Write a JSON error the way an OpenAI-compatible client expects.
*
* `code` defaults to `type`, which is right for every error THIS shim raises on
* its own (`unauthorized`, `not_found`, …): those are not upstream failures and
* must not be disguised as one. The upstream failure path passes an explicit
* `code` so the host classifies it correctly — see {@link KIND_HOST_CODE}.
*/
function writeOpenAIError(res, status, kind, message, code, headers) {
	writeJson(res, status, { error: {
		message,
		type: kind,
		code: code ?? kind
	} }, headers);
}
/**
* Tell every retrying client NOT to retry this failure (2026-10-22, at the
* maintainer's request: the queue's automatic retry is removed).
*
* `x-should-retry` is a non-standard header that both clients in this stack
* check BEFORE their status-based rules — the pinned OpenAI SDK's `shouldRetry`
* and pi-ai's `isRetryableProviderError` each return false on "false".
*
* WHY THE QUEUE MUST NOT BE RETRIED. Without this header a 429 is retried by
* construction: `@deepseek-ai/dsh-llm` maps status 429 to the `RATE_LIMIT` code
* and `RATE_LIMIT` is in `DEFAULT_RETRYABLE_CODES`, so the HOST runs five
* in-place attempts with 0.5s→8s backoff. Measured, that budget totals roughly
* 15 seconds — against a queue the upstream reports in thousands. Every one of
* those attempts is a real request spent to be told the same position again, and
* none of them can clear the queue.
*
* So the queue is now reported ONCE, with the position intact, and the reader
* decides whether to resend or switch models. That is exactly what
* {@link queueNoticeText} tells them to do — the two changes are one decision: a
* diagnostic that declares itself final must actually be final.
*/
const NO_RETRY_HEADERS = Object.freeze({
	"x-should-retry": "false",
	"retry-after": "0"
});
/** Read a request body with a size cap; over-limit bodies fail the request. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > REQUEST_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* Rewrites the upstream SSE stream, converting markup the model wrote into the
* text back into a real `delta.tool_calls` — and, when a whole turn produced
* nothing but markup, holding the bytes long enough to retry ONCE.
*
* ============================================================================
* Why this class exists rather than a `.pipe()`
* ============================================================================
*
* Recovering a call means inspecting `delta.content` before the client sees it,
* which the old `body.pipe(res)` could not do. The parsing rules live in
* `src/dsml-recovery.ts`; everything here is about the STREAM's obligations:
*
*   1. FRAME ORDER IS NEVER CHANGED. Frames are forwarded in arrival order.
*      The only frame this class invents is the trailing one that carries a
*      block still unfinished at end-of-stream.
*
*   2. HOLDS ARE TEMPORARY AND PAY FOR THEMSELVES. Nothing is held unless the
*      answer so far consists only of markup: the moment real prose or a real
*      call appears, everything held is flushed in order and the stream returns
*      to plain pass-through. An ordinary answer therefore pays no latency at
*      all, and no byte is ever discarded while a retry is still possible.
*
*   3. A RETRY MUST NOT SPLICE TWO ANSWERS TOGETHER. That constraint is why the
*      hold exists: because no content frame has been written yet, the caller
*      can discard this attempt and re-send the same body. The existing
*      failover loop makes the same promise for failures BEFORE the stream
*      starts (see its comment in `chatCompletions`); this extends it to the
*      one case that can only be recognised after the fact.
*
*   4. NOTHING IS INVENTED WHEN THE UPSTREAM ALREADY SPEAKS STRUCTURED CALLS.
*      Once a native `delta.tool_calls` appears, recovery switches off for the
*      rest of the response — two live call channels for one answer is worse
*      than either one alone.
*
*   5. EVERY FRAME LEAVES SELF-CONTAINED. An SSE event ends at a blank line,
*      and a frame written without its terminator merges into the NEXT event
*      the client decodes — whose `data:` lines are then joined and parsed as
*      one document (issue #53). Every write therefore goes through
*      {@link emitFrame}, which completes the terminator; `push()` cuts frames
*      that already carry it, and the one source of unterminated bytes — the
*      half-frame left in `carry` when the upstream dies — is normalized in
*      {@link consume}.
*/
var RecoveryStream = class {
	res;
	logger;
	onUsage;
	carry = "";
	decoder = new TextDecoder("utf-8");
	/** Frames received after the hold began, in arrival order. */
	held = [];
	/**
	* The hold window, as two separate facts.
	*
	* `windowOpened` becomes true at the FIRST content-bearing frame and stays
	* true: before it, frames carry no answer (a role delta, a keep-alive) and go
	* straight out; from it on, they are held until the answer is known to be
	* real. `windowClosed` means "an answer was delivered", after which every
	* frame passes through again — for the rest of the response, because a turn
	* that has already produced prose can no longer be replaced by a retry.
	*/
	windowOpened = false;
	windowClosed = false;
	wroteContent = false;
	sawResidue = false;
	sawDone = false;
	/**
	* Set once the upstream speaks structured calls.
	*
	* Sticky for the whole response on purpose: recovering markup into a second
	* call channel after the upstream already produced a real one would hand the
	* client two answers to the same question.
	*/
	nativeCallsSeen = false;
	buffer;
	/**
	* A notice to place at the head of the answer, once, before any prose.
	*
	* Set when the request reached this stream only after the pool failed over, so
	* the user learns WHY the answer came from a different account. Without it a
	* failover is invisible: the reply looks like it came from the account they
	* picked, and the only trace is a `logger.warn` they never see. The notice is
	* emitted ahead of the model's own text so it cannot be mistaken for part of
	* the answer, and only once — a retry that never delivers text must not leave
	* a stray line behind.
	*/
	notice;
	constructor(res, gate, logger, notice, onUsage) {
		this.res = res;
		this.logger = logger;
		this.onUsage = onUsage;
		this.buffer = gate === void 0 ? void 0 : new DsmlStreamBuffer(gate);
		this.notice = notice;
	}
	/**
	* Emit the pending failover notice, if any, and forget it.
	*
	* Called immediately before the first content reaches the client. Placed
	* here rather than in the constructor because a stream whose write fails, or
	* whose attempt is discarded in favour of a retry, must not have already told
	* the user about a switch it never completed.
	*/
	flushNotice() {
		const notice = this.notice;
		if (notice === void 0) return;
		this.notice = void 0;
		if (!this.res.writable) return;
		const chunk = { choices: [{
			index: 0,
			delta: {},
			finish_reason: ""
		}] };
		const choiceRecord = {
			index: 0,
			delta: {},
			finish_reason: ""
		};
		this.windowOpened = true;
		this.emitFrame(contentFrame(chunk, choiceRecord, notice));
	}
	/** True when a call or real prose has reached the client. */
	get delivered() {
		return this.wroteContent;
	}
	/** True when the held bytes contain markup the gates refused. */
	get residueSeen() {
		return this.sawResidue;
	}
	/**
	* The single exit every byte of a FRAME passes through.
	*
	* SSE dispatches one event per blank-line-terminated run of `data:` lines.
	* A frame written WITHOUT its terminator leaves the client's decoder
	* waiting for a blank line that never arrives, so the NEXT write is
	* appended to the SAME event — and a client that joins the several `data:`
	* lines of one event with `\n` and parses the result as one JSON document
	* (openai's `SSEDecoder` does exactly that) then reads two payloads as one
	* and fails. Issue #53 is that failure: the upstream died between a `data:`
	* line and its blank line, `consume()` forwarded the half-frame verbatim,
	* and `finish()` glued its synthetic `[DONE]` onto it, producing
	* `data: {...}\ndata: [DONE]\n\n` — parsed as one event whose data is
	* `"{...}\n[DONE]"`, which throws "Unexpected non-whitespace character
	* after JSON at position N". The whole turn is then classified as a
	* non-retryable error, so the user simply sees the answer stop.
	*
	* Completing the terminator here fixes both halves at once: the truncated
	* frame becomes a self-contained event, and the `[DONE]` that follows can no
	* longer be joined to it. It is idempotent for the frames `push()` cuts —
	* those always carry the terminator already, so they pass through
	* byte-for-byte, which keeps guarantee 1 (frame order is never changed)
	* intact.
	*
	* Note that a missing NEWLINE is also completed: `data: {…}` cut mid-line
	* needs the full `\n\n`, not a single `\n`, to close the event. Such a frame
	* is upstream-corrupted JSON that cannot be repaired here; closing it at
	* least keeps the corruption confined to its own event instead of taking
	* the terminator down with it.
	*/
	emitFrame(frame) {
		if (frame.endsWith("\n\n")) {
			this.res.write(frame);
			return;
		}
		this.res.write(frame.endsWith("\n") ? `${frame}\n` : `${frame}\n\n`);
	}
	/** Record that text the gates refused was seen (markup residue, not prose). */
	noteResidue(seen) {
		this.sawResidue ||= seen;
	}
	/** Drain one upstream body into the client. */
	async consume(body) {
		if (body === null) return;
		const source = Readable.fromWeb(body);
		try {
			for await (const chunk of source) this.push(this.decoder.decode(chunk, { stream: true }));
		} catch (error) {
			this.logger?.warn("dsh-connect-workbuddy: upstream stream failed mid-flight", error);
		}
		const tail = this.carry;
		this.carry = "";
		if (tail !== "") {
			const lineTerminated = tail.endsWith("\n");
			this.handleFrame(lineTerminated ? `${tail}\n` : `${tail}\n\n`);
		}
	}
	/**
	* Close the response: emit the block still unfinished at end-of-stream, then
	* everything held, then the terminator.
	*/
	finish() {
		const flushed = this.buffer?.flush();
		if (flushed !== void 0 && flushed.text !== "") {
			this.noteResidue(!flushed.prose);
			this.emitContent(flushed.text);
		}
		this.closeWindow();
		if (!this.sawDone && this.res.writable) this.emitFrame("data: [DONE]\n\n");
		if (this.res.writable) this.res.end();
	}
	/** Drop held bytes without writing them (used when a retry replaced them). */
	discard() {
		this.held = [];
		this.windowClosed = true;
	}
	/** Split incoming bytes into whole SSE frames, handling chunk boundaries. */
	push(text) {
		this.carry += text;
		let start = 0;
		for (;;) {
			const newline = this.carry.indexOf("\n", start);
			if (newline === -1) break;
			if (this.carry.slice(start, newline).trim() === "") {
				const frame = this.carry.slice(0, newline + 1);
				this.carry = this.carry.slice(newline + 1);
				start = 0;
				this.handleFrame(frame);
				continue;
			}
			start = newline + 1;
		}
	}
	/** Whether a usage measurement has already been reported for this stream. */
	usageReported = false;
	/**
	* Read the upstream's token counts out of one parsed chunk and report them.
	*
	* FIRES AT MOST ONCE per stream, and only when there is a real number to
	* report. Two reasons, both load-bearing:
	*
	*   - a streamed answer's `usage` arrives on its final frame, but a failover
	*     retry starts a NEW `RecoveryStream`, so a second call here would be a
	*     second measurement for the same line;
	*   - a chunk with no `usage` (which is every chunk but the last) must not be
	*     reported as zero — an absent measurement and a measurement of zero are
	*     different facts, and the #59 comparison turns entirely on that
	*     difference.
	*/
	noteUsage(chunk) {
		if (this.usageReported || this.onUsage === void 0) return;
		const usage = usageOfChunk(chunk);
		if (usage === void 0) return;
		this.usageReported = true;
		try {
			this.onUsage(usage);
		} catch (error) {
			this.logger?.warn("dsh-connect-workbuddy: usage report failed", error);
		}
	}
	/** Handle one complete frame, rewriting it only when recovery produced something. */
	handleFrame(frame) {
		const payload = dataPayload(frame);
		if (payload === void 0) {
			this.send(frame, false);
			return;
		}
		if (payload === "[DONE]") {
			this.sawDone = true;
			this.send(frame, false);
			return;
		}
		let chunk;
		try {
			chunk = JSON.parse(payload);
		} catch {
			this.send(frame, false);
			return;
		}
		const choices = chunk["choices"];
		this.noteUsage(chunk);
		const choice = Array.isArray(choices) ? choices[0] : void 0;
		if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
			this.send(frame, false);
			return;
		}
		const choiceRecord = choice;
		const deltaValue = choiceRecord["delta"];
		const delta = typeof deltaValue === "object" && deltaValue !== null && !Array.isArray(deltaValue) ? deltaValue : void 0;
		if (delta === void 0) {
			this.send(frame, false);
			return;
		}
		const nativeCalls = delta["tool_calls"];
		if (Array.isArray(nativeCalls) && nativeCalls.length > 0) {
			this.nativeCallsSeen = true;
			this.windowOpened = true;
			this.flushNotice();
			this.send(frame, false);
			this.wroteContent = true;
			this.closeWindow();
			return;
		}
		const content = delta["content"];
		if (typeof content !== "string" || content === "") {
			const reason = finishReasonOf(choiceRecord);
			if (reason !== "") this.drainBuffer();
			this.send(frame, reason !== "");
			return;
		}
		if (this.buffer === void 0 || this.nativeCallsSeen) {
			this.windowOpened = true;
			this.flushNotice();
			this.closeWindow();
			this.emitFrame(frame);
			this.wroteContent = true;
			return;
		}
		this.windowOpened = true;
		const outcome = this.buffer.add(content);
		if (outcome.calls !== void 0 && outcome.calls.length > 0) {
			this.flushNotice();
			this.send(callsFrame(chunk, choiceRecord, outcome.calls), false);
			this.wroteContent = true;
			this.closeWindow();
			if (outcome.text !== "") this.emitFrame(contentFrame(chunk, choiceRecord, outcome.text));
			return;
		}
		this.noteResidue(!outcome.prose && outcome.text !== "");
		if (outcome.text === "") {
			this.send(contentFrame(chunk, choiceRecord, ""), false);
			return;
		}
		if (outcome.prose) {
			this.flushNotice();
			this.send(contentFrame(chunk, choiceRecord, outcome.text), false);
			this.wroteContent = true;
			this.closeWindow();
			return;
		}
		this.send(contentFrame(chunk, choiceRecord, outcome.text), false);
	}
	/**
	* Hand back whatever the buffer is still holding, right now.
	*
	* Called before a terminator frame is forwarded. `flush()` ends the buffer's
	* attempt — if content somehow keeps arriving afterwards it starts a fresh
	* one, which is the correct reading of a stream that declared itself finished.
	*/
	drainBuffer() {
		const flushed = this.buffer?.flush();
		if (flushed === void 0 || flushed.text === "") return;
		this.noteResidue(!flushed.prose);
		this.emitContent(flushed.text);
	}
	/**
	* Emit text the buffer was still holding when the stream ended.
	*
	* It goes through `send` + `closeWindow` rather than straight to the socket on
	* purpose: a `finish_reason` frame may already be queued, and this text is
	* content that logically precedes it. Writing directly would put the answer
	* after its own terminator — a client that stops accumulating at
	* `finish_reason` would silently lose the tail.
	*/
	emitContent(text) {
		const chunk = { choices: [{
			index: 0,
			delta: {},
			finish_reason: ""
		}] };
		const choiceRecord = {
			index: 0,
			delta: {},
			finish_reason: ""
		};
		this.windowOpened = true;
		const frame = contentFrame(chunk, choiceRecord, text);
		if (text.trim() !== "") {
			this.flushNotice();
			this.send(frame, false);
			this.wroteContent = true;
			this.closeWindow();
			return;
		}
		this.send(frame, false);
	}
	/** Queue a frame while the window is open, or write it once it has closed. */
	send(frame, final) {
		if (this.windowClosed || !this.windowOpened) {
			this.emitFrame(frame);
			return;
		}
		const entry = {
			frame,
			final
		};
		if (!final) {
			const at = this.held.findIndex((item) => item.final);
			if (at !== -1) {
				this.held.splice(at, 0, entry);
				return;
			}
		}
		this.held.push(entry);
	}
	/**
	* An answer has been delivered: flush everything held, in order, and never
	* hold again for this response.
	*/
	closeWindow() {
		this.windowClosed = true;
		const pending = this.held;
		this.held = [];
		for (const entry of pending) this.emitFrame(entry.frame);
	}
};
/** The SSE `data:` payload of one frame, or nothing when it carries none. */
function dataPayload(frame) {
	for (const line of frame.split("\n")) {
		const trimmed = line.trimEnd();
		if (!trimmed.startsWith("data:")) continue;
		return trimmed.slice(5).trim();
	}
}
/** A frame's `finish_reason`, or '' when it carries none. */
function finishReasonOf(choice) {
	const reason = choice["finish_reason"];
	return typeof reason === "string" ? reason : "";
}
/**
* One frame carrying recovered calls.
*
* The shape is OpenAI's: `index` per call, `type: "function"`, arguments as a
* JSON STRING. `finish_reason` becomes `tool_calls` — without it a client that
* waits for the reason before executing an assembled call would never run it.
*/
function callsFrame(chunk, choice, calls) {
	const toolCalls = calls.map((call, index) => ({
		index,
		id: call.id,
		type: "function",
		function: {
			name: call.name,
			arguments: call.arguments
		}
	}));
	const next = {
		...chunk,
		choices: [{
			...choice,
			delta: { tool_calls: toolCalls },
			finish_reason: "tool_calls"
		}]
	};
	return `data: ${JSON.stringify(next)}\n\n`;
}
/**
* How to name a pool account in a sentence the USER reads.
*
* Prefers the phone number (`uin`) because that is what the pool table shows and
* what a person recognises; the nickname and the opaque account id are fallbacks
* so this can never render an empty name. Deliberately NOT the hashed account id
* on its own: a 24-character hex digest identifies an account to the plugin, but
* to the person reading the answer it identifies nothing.
*/
function describeAccount(credential) {
	if (credential.uin !== void 0 && credential.uin !== "") return credential.uin;
	if (credential.nickname !== void 0 && credential.nickname !== "") return credential.nickname;
	return workbuddyAccountId(credential);
}
/**
* One short phrase for why an account was abandoned, for the in-reply notice.
*
* Kept to the distinction the user can act on rather than the internal kind
* name: "账号被限流" says wait or add an account, "登录已失效" says the sign-in
* is the problem. The numeric kind would only send them to the log.
*
* The wording is what `failoverNoticeText` interpolates into a Chinese sentence,
* so these are Chinese phrases rather than English ones — the reader of a failed
* turn in this product reads Chinese, and an English clause inside Chinese prose
* was the previous build's most visible rough edge.
*/
/**
* Name the rejected PARAMETER when the upstream refused a reasoning tier, or
* `undefined` when it is any other failure (issue #83).
*
* The compaction path used to surface "Compaction could not produce a useful
* summary" and nothing else, so a 11133 caused by `reasoning_effort: "off"` was
* indistinguishable from a model that was simply unavailable — the reporter had
* to read the raw body to learn that one parameter was at fault. When the body
* names the offending parameter (`extError.param`) the reply says so; this is a
* refusal the plugin can explain without guessing, because it is the union of
* two facts the upstream stated in the response.
*/
/**
* Turn a failure into a refusal report for {@link WorkBuddyShimOptions.reportRefusal},
* or `undefined` when it is not a tier refusal worth recording.
*
* Only refusals the upstream attributed to a PARAMETER are reported: a plain
* 500 or a quota error says nothing about `off`, and recording it would pin a
* "refuses off" badge on a model that never refused anything.
*/
function refusedTierReport(failure, modelId) {
	if (failure.ok || failure.kind !== "client") return void 0;
	const param = failure.detail?.rejectedParam;
	if (param === void 0 || !param.includes("reasoning")) return void 0;
	const tier = failure.detail?.rejectedTier;
	return {
		param,
		...tier === void 0 ? {} : { tier },
		...failure.detail?.upstreamCode === void 0 ? {} : { code: failure.detail.upstreamCode },
		...modelId === void 0 ? {} : { modelId },
		at: Date.now()
	};
}
function reasoningTierRefusal(failure) {
	if (failure.ok || failure.kind !== "client") return void 0;
	const param = failure.detail?.rejectedParam;
	if (param === void 0 || !param.includes("reasoning")) return void 0;
	const tier = failure.detail?.rejectedTier;
	return tier === void 0 ? `上游拒绝了推理档位参数（${param}）` : `上游拒绝了推理档位「${tier}」（${param}）`;
}
function failoverReasonText(failure) {
	if (failure.ok) return "不可用";
	switch (failure.kind) {
		case "soft_rate": return "被限流";
		case "hard_credit": return "积分已耗尽";
		case "model_busy": return "该模型当前繁忙（不是账号问题）";
		case "session_dead": return "登录已失效";
		case "policy_reject": return "被服务端策略拒绝";
		case "account_restricted": return "账号被上游限制使用";
		case "channel_reject": return "被网关的渠道校验拦截（不是账号、额度或网络问题）";
		case "not_found": return "模型不可用";
		case "server": return "上游异常";
		case "client": return "请求被上游拒绝";
		default: return "不可用";
	}
}
/**
* One upstream sentence, made safe to paste into a single-line error message.
*
* `result.message` carries the WHOLE upstream body — for a classified failure
* that is a JSON envelope 637–777 characters long whose first 400 characters are
* the `code`/`requestId`/`extError` skeleton (`param: ""`, `Request: null`). A
* plain `slice(0, 400)` therefore cut the one actionable sentence in half: the
* reply ended mid-word at `Pleas` and the reader lost `displayTips` entirely
* (issue #78).
*
* Two rules keep that from happening again:
* - whitespace collapses to single spaces, because the body is JSON/HTML and its
*   newlines would otherwise render as a ragged block inside one paragraph;
* - the cut prefers a sentence boundary once one exists past the halfway point,
*   so a clipped sentence reads as "truncated" instead of as broken prose, and
*   the `…` always says the text continues.
*
* This is the LAST resort: a body that parsed into a `detail` with `displayMsg`
* or `tips` never reaches it, and those are short by construction.
*/
function clippedUpstreamText(text, limit) {
	const collapsed = text.replace(/\s+/gu, " ").trim();
	if (collapsed.length <= limit) return collapsed;
	const cut = collapsed.slice(0, limit);
	const stop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"), cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
	if (stop >= Math.floor(limit / 2)) return `${cut.slice(0, stop + 1).trimEnd()}…`;
	return `${cut.trimEnd()}…`;
}
/**
* The channel-gate reply's evidence sentence: what the gateway actually read.
*
* Read from the HOST's body, not from the prepared one, because the prepared
* body has the plugin's neutral head in front of every opening it recognises —
* so the first line it could report is the plugin's own placeholder, which is
* exactly the false lead issue #98's reporters were given. They were told the
* gateway had refused `You are a helpful assistant.`, a line that returns 200
* when sent alone.
*
* Each entry is labelled with its ROLE (`system` / `assistant`) because both are
* scanned and the difference is what tells the reader where to look: an
* `assistant` entry is a history message, i.e. the session is poisoned and every
* later turn will fail the same way until that line is changed.
*
* Each entry also says whether the plugin's own neutralisation already covers
* it. An entry marked "not in the plugin's list" is the actionable one: that
* opening goes on the wire verbatim, so either the host wrote it or the
* gateway's list grew.
*
* Capped at {@link CHANNEL_EVIDENCE_LIMIT} entries: a session can carry dozens
* of system/assistant messages, and a wall of them would bury the one that
* matters. The remainder is counted instead of listed.
*/
function channelEvidenceText(bodyJson) {
	const entries = openingEvidenceOfBody(bodyJson);
	if (entries.length === 0) return "（请求里没有可读的 system 或 assistant 消息开头。）";
	const shown = entries.slice(0, CHANNEL_EVIDENCE_LIMIT);
	const rendered = shown.map((entry) => {
		const label = entry.neutralized ? "（插件已加中性头）" : "（不在插件已知名单里，网关可能新增了词条）";
		const span = entry.closing === void 0 ? `，共 ${entry.textLength} 字` : `，首尾为「${entry.closing}」，共 ${entry.textLength} 字`;
		return `「${entry.role}：${entry.opening}${span}」${label}`;
	}).join("、");
	const hidden = entries.length - shown.length;
	return `请求里被网关扫描的消息开头：${rendered}${hidden > 0 ? `……另有 ${hidden} 条未列出。` : "。"}`;
}
/** How many message openings the channel-gate reply lists. */
const CHANNEL_EVIDENCE_LIMIT = 4;
/**
* The line prepended to an answer that came from a failover account.
*
* Block-quoted and bracketed so it reads as machinery rather than as the model's
* own words, and so a user skimming for the answer can skip it. It states the
* reason AND the account left behind, because those are the two facts that make
* an unexpected reply explicable.
*
* The wording avoids "switched TO <account>" on purpose: the account that took
* over is the one the user is about to keep talking to, and naming it invites
* the reading that they must now manage it. What they need is to know the one
* they chose did not answer, and why.
*
* Chinese, matching the rest of a failed turn's copy: the host renders its own
* quota sentence in Chinese, the pool rows are Chinese, and an English clause
* here was the one line of the reply a Chinese reader had to decode.
*/
function failoverNoticeText(from, reason) {
	return `\n\n> [dsh-connect-workbuddy] 「${from}」${reason}，已改用池中另一个账号回答\n\n`;
}
/** One frame carrying replacement text for a frame whose content was consumed. */
function contentFrame(chunk, choice, content) {
	const delta = {
		...choice["delta"],
		content
	};
	const next = {
		...chunk,
		choices: [{
			...choice,
			delta
		}]
	};
	return `data: ${JSON.stringify(next)}\n\n`;
}
/**
* Whether this runtime's `fetch` refuses `port` WITHOUT ever connecting.
*
* `server.listen(0)` lets the kernel pick the port, and the Fetch standard bans
* a list of ports that `fetch` must reject before opening a socket
* (`fetch.spec.whatwg.org#block-bad-port`, implemented as undici's `badPorts`).
* Every client of this shim goes through that same `fetch`: pi-ai drives the
* OpenAI SDK, whose `getDefaultFetch()` returns `globalThis.fetch`. So a shim
* that lands on a banned port is unreachable to its own client while being
* perfectly healthy on the wire — measured on port 6000: `fetch` refuses,
* while `node:http`, a raw TCP socket and `curl` all connect and get 200.
*
* That combination is what makes it worth preventing rather than diagnosing: it
* is silent (the SDK surfaces only `Connection error.`, with the `bad port`
* cause dropped), total (every request in the region fails), and it does not
* re-roll on its own.
*
* Whether it can happen at all depends on the machine's dynamic port range,
* because that is the set `listen(0)` draws from:
*
*   Windows default 49152-65535, Linux default 32768-60999, macOS 49152-65535
*     — every banned port is <= 10080 (the current list ends there), so the
*       intersection is EMPTY and these machines cannot be affected.
*   A range lowered to reach below 10080 — e.g. the legacy `MaxUserPort`
*     registry value pinned to 15000, which yields 1024-15000 — draws from a
*     set that CONTAINS banned ports. Measured there: 19 of 13977 ports are
*     banned, i.e. ~0.14% per bind and ~0.27% per plugin load (two regions,
*     one bind each).
*
* Probing with the client itself, rather than comparing against a copy of the
* banned list, is deliberate: a hard-coded list drifts the moment the standard
* gains a port, whereas the rule being satisfied here IS the client's own, so
* asking the client cannot disagree with it. `tests/shim.spec.ts` pins the
* error shape this relies on, so a Node change that renames it fails loudly
* instead of silently disabling the guard.
*/
async function clientRefusesPort(port) {
	try {
		await fetch(`http://127.0.0.1:${port}/healthz`);
		return false;
	} catch (error) {
		return isBadPortRefusal(error);
	}
}
/**
* Whether `error` is the client's PORT REFUSAL rather than a real transport
* failure.
*
* The two must never be conflated: a refused port is worth re-rolling, while
* `ECONNREFUSED`/`ECONNRESET` are ordinary transport errors that re-rolling
* would only paper over. Measured shapes on Node 24:
*
*   refused port : TypeError('fetch failed') -> cause Error('bad port')        (no `code`)
*   closed  port : TypeError('fetch failed') -> cause Error('connect ECONNREFUSED …') (code `ECONNREFUSED`)
*
* The cause chain is walked, with a bound, rather than read one level deep:
* the OpenAI SDK wraps this same refusal in its own `APIConnectionError`, and a
* caller should not have to know how deep the active client happens to nest it.
*/
function isBadPortRefusal(error) {
	let current = error;
	for (let depth = 0; depth < 4; depth++) {
		if (!(current instanceof Error)) return false;
		if (current.message === "bad port") return true;
		current = current.cause;
	}
	return false;
}
/**
* Listen on an ephemeral loopback port, rejecting on failure.
*
* Also settles on `close`, which is NOT redundant: measured on Node 24, a
* `close()` that lands while `listen()` is still pending fires neither
* `listening` nor `error` — only `close`. Without that third listener a dispose
* during startup would leave this promise (and therefore the shim's `ready`)
* pending forever, wedging plugin unload. Resolving there is deliberate:
* disposal is a satisfied end state, not a startup failure.
*/
function listenOnce(server) {
	return new Promise((resolve, reject) => {
		const settle = () => {
			server.off("listening", onListening);
			server.off("error", onError);
			server.off("close", onClose);
		};
		const onListening = () => {
			settle();
			resolve();
		};
		const onError = (error) => {
			settle();
			reject(error);
		};
		const onClose = () => {
			settle();
			resolve();
		};
		server.once("listening", onListening);
		server.once("error", onError);
		server.once("close", onClose);
		server.listen(0, "127.0.0.1");
	});
}
/** Stop listening, resolving once the listener is down. */
function closeOnce(server) {
	return new Promise((resolve) => server.close(() => resolve()));
}
/**
* Bind an ephemeral loopback port that the CLIENT can actually reach.
*
* `listen(0)` stays the right way to get a port — the kernel picks a free one
* instead of this plugin guessing a number — but the first pick is not always
* usable, so the roll repeats while the client refuses it. See
* {@link clientRefusesPort} for why the client's own answer is the criterion,
* and {@link PORT_ROLL_LIMIT} for why the loop is bounded.
*
* The probe is injected rather than imported so the re-roll path can be driven
* deterministically: no test can make `listen(0)` return a banned port on
* demand, so this seam is the only way to pin the behaviour that actually
* matters.
*
* `ready` (the returned promise) therefore resolves only once a port is
* settled, which is what lets every consumer keep reading `baseUrl()` as it
* always has.
*/
async function listenOnClientReachablePort(options) {
	const { server, clientRefuses, logger, cancelled } = options;
	for (let attempt = 1;; attempt++) {
		if (cancelled?.() === true) return;
		await listenOnce(server);
		const address = server.address();
		const port = address === null || typeof address === "string" ? void 0 : address.port;
		if (port === void 0 || !await clientRefuses(port)) return;
		if (attempt >= 5) {
			logger?.warn(`dsh-connect-workbuddy: port ${port} is on the HTTP client's refused list and 5 rolls did not avoid one; serving on it anyway`);
			return;
		}
		logger?.warn(`dsh-connect-workbuddy: port ${port} is refused by the HTTP client; re-rolling (attempt ${attempt})`);
		await closeOnce(server);
	}
}
/**
* Start the loopback endpoint. Requests must carry the shim's shared secret;
* the loopback bind alone is not a trust boundary.
*/
function createWorkBuddyShim(options) {
	const { store, client, catalog } = options;
	const logger = options.logger;
	const failoverAccount = options.failoverAccount;
	const failoverShortfall = options.failoverShortfall;
	const reportRefusedTier = options.reportRefusal ?? (() => {});
	const prepareAccount = options.prepareAccount;
	const onAccountFailure = options.onAccountFailure;
	const onRequestBody = options.onRequestBody;
	const onUpstreamUsage = options.onUpstreamUsage;
	const channelPerturbation = options.channelPerturbation ?? "failure";
	/**
	* Whether the harness's injected `user` blocks are moved above the real prompt.
	*
	* OFF by default (issue #132): the reorder changes the message ORDER the
	* upstream counts, so it must be the user's deliberate choice rather than a
	* silent difference after an upgrade.
	*/
	const keepPromptLastEnabled = options.keepPromptLast === true;
	const extraInjectedPrefixes = Array.isArray(options.extraInjectedPrefixes) ? options.extraInjectedPrefixes.filter((entry) => typeof entry === "string" && entry !== "") : [];
	const sessionTitleOptions = options.sessionTitle ?? {};
	const SHARED_SECRET = randomBytes(32).toString("base64url");
	/**
	* Whether this process's prompts have been PROVEN to need the invisible
	* perturbation before the gateway will accept them.
	*
	* WHY THIS EXISTS (measured 2026-10-22). The retry ladder below is
	* discover-by-failing: a request goes out unmodified, is refused with `11128`,
	* and the ladder re-sends a perturbed copy. That is correct the first time and
	* wasteful every time after — the prompt SHAPE that carries a fingerprinted
	* substring does not change between turns of a session, so the plugin was
	* paying one refused request (~209ms measured) on EVERY request, forever.
	*
	* So once the perturbation is what made a request succeed, the next request
	* starts from the perturbed form and skips the doomed first attempt. The
	* saving is one round trip plus one refused request per turn.
	*
	* WHY A PROCESS-LOCAL FLAG AND NOT A CONFIG. The gateway's fingerprint list is
	* a snapshot the upstream can change at any time, in either direction: a rule
	* can be withdrawn as easily as added. A persisted flag would therefore
	* outlive the condition that justified it and could keep perturbing prompts a
	* gateway no longer objects to. In memory it is forgotten at restart, which is
	* the natural expiry for "what this gateway refused recently".
	*
	* AND IT SELF-CORRECTS. If a perturbed body is EVER refused with the channel
	* gate, the flag is cleared and the request falls back to the plain ladder —
	* so a withdrawn rule, or a different model behind the same gateway, cannot
	* leave the plugin stuck sending a shape that no longer helps.
	*/
	let channelNeedsPerturbation = false;
	/** Constant-time bearer check; absent or mismatched bearers are rejected. */
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null) return false;
		const presented = match[1];
		const expected = SHARED_SECRET;
		const a = Buffer.from(presented);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
	const server = createServer((req, res) => {
		handle(req, res);
	});
	let disposed = false;
	server.on("error", (error) => {
		if (server.listening) logger?.error("dsh-connect-workbuddy: loopback listener error", error);
	});
	/**
	* Resolves once the listener is up on a port the client can actually reach.
	*
	* The port is settled HERE — `listenOnClientReachablePort` re-rolls while the
	* client refuses the assigned one — so every consumer can keep resolving
	* `baseUrl()` exactly as before, with no invalidation or rebuild step. A
	* genuine bind failure still rejects, the one behaviour the caller relies on.
	*/
	const ready = listenOnClientReachablePort({
		server,
		clientRefuses: clientRefusesPort,
		logger,
		cancelled: () => disposed
	}).catch((error) => {
		logger?.error("dsh-connect-workbuddy: loopback listener failed to start", error);
		throw error;
	});
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("workbuddy shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		try {
			if (!hostIsLoopback(req.headers.host)) {
				writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
				return;
			}
			if (!originIsLoopback(req.headers.origin)) {
				writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
				return;
			}
			if (!bearerOk(req)) {
				writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
				writeJson(res, 200, { ok: true });
				return;
			}
			if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
				writeJson(res, 200, {
					object: "list",
					data: catalog.current().map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: "workbuddy"
					}))
				});
				return;
			}
			if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
				await chatCompletions(req, res);
				return;
			}
			writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
		} catch (error) {
			if (!res.headersSent) writeOpenAIError(res, 500, "internal", String(error));
			else res.end();
		}
	}
	/**
	* Failure classes worth retrying against another account.
	*
	* `client` is deliberately NOT one of them: the upstream rejected the
	* REQUEST (malformed body, unsupported field), so every account answers the
	* same 400 and walking the rest of the pool only multiplies the wait before
	* the user sees an error they must act on anyway.
	*
	* `model_busy` is NOT one of them either, and the distinction is the whole of
	* issue #56. The 14003 throttle belongs to the MODEL — the upstream's own
	* message says so ("switch to a less busy model") and the reporter's
	* measurement confirms it: same credential, same second, other models answer.
	* So a second account does not answer better than the first; it answers the
	* same 14003, one round trip later, and each attempt writes a rate-limited
	* measurement onto an account that was never the problem. The measured outcome
	* was a pool in which every member had been taught a false fact, and a user
	* who could not talk to the model for half an hour.
	*
	* Everything else describes a PER-ACCOUNT condition — a volume limit,
	* exhausted credits, a dead session, a gateway that failed this one call —
	* which another account may well survive.
	*/
	function isFailoverWorthy(kind) {
		return kind !== "client" && kind !== "model_busy" && kind !== "channel_reject" && kind !== "model_queue";
	}
	async function chatCompletions(req, res) {
		if (!isJsonContentType(req)) {
			writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
			return;
		}
		await prepareAccount?.().catch((error) => {
			logger?.warn("dsh-connect-workbuddy: pool account selection failed", error);
		});
		let credential;
		try {
			credential = await store.resolve();
		} catch (error) {
			writeOpenAIError(res, 401, "not_signed_in", String(error));
			return;
		}
		const raw = (await readBody(req)).toString("utf8");
		const prepared = rewriteSessionTitleModel(prepareChatBody(raw, {
			keepPromptLast: keepPromptLastEnabled,
			extraInjectedPrefixes
		}), sessionTitleOptions);
		const requestModelId = modelIdOfBody(prepared);
		if (onRequestBody !== void 0) try {
			onRequestBody(prepared);
		} catch (error) {
			logger?.warn("dsh-connect-workbuddy: body report failed", error);
		}
		const controller = new AbortController();
		res.on("close", () => controller.abort());
		const preferred = channelPerturbation === "always" || channelNeedsPerturbation ? perturbChannelFingerprints(prepared, channelPerturbation === "always") ?? prepared : prepared;
		let result = await client.chatStream(credential, preferred, controller.signal);
		if (channelNeedsPerturbation && !result.ok && result.kind === "channel_reject") {
			channelNeedsPerturbation = false;
			logger?.warn("dsh-connect-workbuddy: a perturbed body was refused too; clearing the learned preference and retrying from the plain form");
			result = await client.chatStream(credential, prepared, controller.signal);
		}
		/**
		* The retry ladder that does not depend on knowing the fingerprint
		* (issue #98, both halves).
		*
		* The gateway refuses the request for data the plugin cannot see: a list of
		* refused `system`/`assistant` OPENINGS (the plugin holds a measured
		* SNAPSHOT, `UNAPPROVED_CHANNEL_OPENINGS`) and, since 2026-10-21, at least
		* one long substring INSIDE the prompt. Every account and every region
		* sends the same bytes, so without a rescue the only outcome is a dead end
		* the reader cannot get out of.
		*
		* Two rungs, both on the SAME credential (the gate reads the request, not
		* the account, which is why `channel_reject` is not failover-worthy):
		*
		*   1. `forceNeutralHead` — move every scanned opening behind the neutral
		*      head. Measured: whatever the banned opening is, moving it off the
		*      start of the content answers 200.
		*   2. `perturbChannelFingerprints` — insert zero-width spaces at the
		*      sentence boundaries of the scanned messages, which breaks an
		*      exact-substring fingerprint without changing a word the model reads.
		*      This is the rung that rescues the inside-the-prompt fingerprints,
		*      where rung 1 is a no-op.
		*
		* Both return `undefined` when they would change nothing; that is the
		* signal not to spend a request on a body that would be refused identically.
		*
		* Nothing has been written to the client at this point (`!ok` means the
		* upstream answered non-2xx before any stream started), so a retry cannot
		* splice two responses together. The first attempt's failure is NOT booked
		* as an account failure: it was the request that was refused, not the
		* credential.
		*/
		let retriedWithForcedHead = false;
		let retriedWithPerturbation = false;
		let retriedWithDensePerturbation = false;
		if (!result.ok && result.kind === "channel_reject" && !controller.signal.aborted) {
			const forced = forceNeutralHead(prepared);
			if (forced !== void 0) {
				logger?.warn("dsh-connect-workbuddy: the channel gate refused the body; retrying once with the neutral head forced in front of every opening");
				result = await client.chatStream(credential, forced, controller.signal);
				retriedWithForcedHead = true;
			}
			if (!result.ok && result.kind === "channel_reject" && !controller.signal.aborted) {
				const rescued = perturbChannelFingerprints(forced ?? prepared);
				if (rescued !== void 0) {
					logger?.warn("dsh-connect-workbuddy: the channel gate refused the body again; retrying once with an invisible perturbation of the scanned text");
					result = await client.chatStream(credential, rescued, controller.signal);
					retriedWithPerturbation = true;
					if (result.ok) channelNeedsPerturbation = true;
				}
			}
			if (!result.ok && result.kind === "channel_reject" && !controller.signal.aborted) {
				const dense = perturbChannelFingerprints(forced ?? prepared, true);
				if (dense !== void 0) {
					logger?.warn("dsh-connect-workbuddy: the channel gate refused the sparse perturbation too; retrying once with a dense word-boundary perturbation");
					result = await client.chatStream(credential, dense, controller.signal);
					retriedWithDensePerturbation = true;
					if (result.ok && channelPerturbation === "failure") channelNeedsPerturbation = true;
				}
			}
		}
		const triedAccountIds = [];
		/**
		* The account the request STARTED on, and the reason it was abandoned.
		*
		* `??=` on the first switch only: if three accounts fail in a row the user
		* cares that the answer did not come from the one they picked, not with a
		* blow-by-blow list of every candidate that was also rate limited.
		*/
		let switchedFrom;
		let switchedBecause;
		/**
		* Tell the plugin about a failed attempt so it can store the measurement.
		*
		* Every failed attempt is reported exactly once, INCLUDING the last one — an
		* account that failed with nobody left to try it is precisely the one the
		* next request must avoid, so reporting only the attempts that had a
		* successor would miss the case that matters most.
		*
		* Reported after the loop rather than inside it, so the account that broke
		* out of the loop is not also reported by the post-loop call. Not awaited: the
		* user is waiting on the retry, and the write only affects later requests.
		*/
		const failures = [];
		const recordAttempt = (credential, failure) => {
			if (failure.ok) return;
			failures.push({
				accountId: workbuddyAccountId(credential),
				failure
			});
		};
		const reportFailures = () => {
			const batch = failures.splice(0, failures.length);
			if (onAccountFailure === void 0) return;
			if (controller.signal.aborted) return;
			for (const entry of batch) {
				if (entry.failure.ok) continue;
				try {
					onAccountFailure(entry.accountId, {
						status: entry.failure.status,
						kind: entry.failure.kind,
						message: entry.failure.message,
						...requestModelId === void 0 ? {} : { modelId: requestModelId }
					});
				} catch (error) {
					logger?.warn("dsh-connect-workbuddy: recording an account failure failed", error);
				}
			}
		};
		while (!result.ok && isFailoverWorthy(result.kind) && failoverAccount !== void 0) {
			if (controller.signal.aborted) break;
			recordAttempt(credential, result);
			triedAccountIds.push(workbuddyAccountId(credential));
			const next = await failoverAccount(triedAccountIds).catch(() => void 0);
			if (next === void 0) break;
			if (triedAccountIds.includes(workbuddyAccountId(next))) break;
			if (controller.signal.aborted) break;
			await new Promise((resolve) => {
				if (controller.signal.aborted) return resolve();
				const timer = setTimeout(resolve, FAILOVER_ACCOUNT_GAP_MS);
				controller.signal.addEventListener("abort", () => {
					clearTimeout(timer);
					resolve();
				}, { once: true });
			});
			if (controller.signal.aborted) break;
			logger?.warn(`dsh-connect-workbuddy: retrying chat on another pool account after ${result.kind} (http ${result.status})`);
			switchedFrom ??= describeAccount(credential);
			switchedBecause ??= failoverReasonText(result);
			credential = next;
			result = await client.chatStream(credential, prepared, controller.signal);
		}
		if (failures.length === 0 || failures[failures.length - 1]?.accountId !== workbuddyAccountId(credential)) recordAttempt(credential, result);
		reportFailures();
		if (!result.ok) {
			const attempts = triedAccountIds.length;
			const note = attempts > 1 ? `（已尝试 ${attempts} 个账号）` : "";
			const shortfall = failoverShortfall !== void 0 && failoverAccount !== void 0 && isFailoverWorthy(result.kind) ? await failoverShortfall().catch(() => void 0) : void 0;
			const why = shortfall === void 0 ? "" : `：${shortfall}`;
			const refusedReport = refusedTierReport(result, requestModelId);
			if (refusedReport !== void 0) reportRefusedTier(refusedReport);
			const queue = result.kind === "model_queue" ? parseQueueAnswer(result.message) : void 0;
			if (queue !== void 0) {
				writeOpenAIError(res, 429, "model_queue", `${queueNoticeText(queue)}（上游 code ${queue.code}）${note}`, void 0, NO_RETRY_HEADERS);
				return;
			}
			if (result.kind === "account_restricted") {
				const detail = result.detail;
				const meta = ["账号被上游限制使用"];
				if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
				if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
				const message = `${detail?.displayMsg ?? clippedUpstreamText(result.message, 200)}（${meta.join("，")}）${note}${why}。该账号已被 WorkBuddy 上游按账号限制，与本次请求内容、网络和额度无关；插件会记录该测量并改用其他可用账号。该限制是上游对该账号的判定：重新登录不改变插件认的这个账号，需要 WorkBuddy 官方渠道解除后，在卡片上手动「测试」该账号才会回池`;
				writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
				return;
			}
			if (result.kind === "policy_reject") {
				const detail = result.detail;
				const lead = detail?.displayMsg ?? clippedUpstreamText(result.message, 200);
				const meta = ["服务端策略拒绝"];
				if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
				if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
				const message = `${lead}（${meta.join("，")}）${note}。该请求被 WorkBuddy 服务端策略拒绝；若上游的说明指向内容，重新登录不会解决，可在 WorkBuddy 桌面端用同一账号验证；若它指向账号本身，则需要走官方渠道处理，插件会在遇到该措辞时另行标明`;
				writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
				return;
			}
			if (result.kind === "model_busy") {
				const detail = result.detail;
				const lead = detail?.displayMsg ?? clippedUpstreamText(result.message, 200);
				const meta = ["模型当前负载较高"];
				if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
				if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
				const message = `${lead}（${meta.join("，")}）${note}。这不是账号被限流，也与积分、额度无关——同一凭据下换一个模型即可正常使用；插件不会为此切换账号，因为该限制跟随模型本身。这类失败会被自动重试几次；若仍然失败，请等待约 1 分钟后重试，或切换到负载较低的模型`;
				writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
				return;
			}
			if (result.kind === "channel_reject") {
				const detail = result.detail;
				const meta = [];
				if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
				if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
				const stamp = meta.length === 0 ? "" : `（${meta.join("，")}）`;
				const evidence = channelEvidenceText(raw);
				const retries = [];
				if (retriedWithForcedHead) retries.push("强制中性头");
				if (retriedWithPerturbation) retries.push("一次不可见扰动");
				if (retriedWithDensePerturbation) retries.push("一次密集不可见扰动");
				const retryNote = retries.length === 0 ? "" : `，并已用${retries.join("与")}重试过`;
				const member = channelGateMemberOf(result.message, requestEvidenceOf(prepared));
				const said = detail?.rawMsg ?? detail?.displayMsg;
				const echo = said === void 0 ? "" : `上游的 msg 是「${said}」，`;
				const memberNote = member === "headers" ? `${echo}但本次请求已经带上了会话 id 三件套（X-Conversation-ID / -Request-ID / -Message-ID），所以这条措辞是上游误报；` : member === "first_message" ? `${echo}但本次请求的首条消息就是 system；` : member === "prompt" ? isConversationIdGateBody(result.message) ? `${echo}但本次请求已经带上了会话 id 三件套（X-Conversation-ID / -Request-ID / -Message-ID），所以这条措辞是上游误报，实际被拒的是请求内容；` : isFirstMessageGateBody(result.message) ? `${echo}但本次请求的首条消息就是 system，所以这条措辞是上游误报，实际被拒的是请求内容；` : "" : `${echo}它属于 11128 这一族但没点名是哪一道门，插件按渠道校验统一处理；`;
				const message = `workbuddy 上游失败：${failoverReasonText(result)}（http ${result.status}）${note}${stamp}。${memberNote}${evidence}该请求被 WorkBuddy 网关的渠道校验拦截，上游把它描述成「不是官方客户端发出的」，但那是误导性文案：网关匹配的是每一条 system 与 assistant 消息的开头，与账号、积分、额度、网络都无关，换账号或换区域也不会改变结果。插件已对已知的第三方 agent 指纹做归一化` + retryNote + "；若上面标着「不在插件已知名单里」的开头来自宿主或其他插件，请修改该提示；新的指纹可反馈到 issue 里";
				writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
				return;
			}
			const detail = result.detail;
			const meta = [];
			if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
			if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
			const stamp = meta.length === 0 ? "" : `（${meta.join("，")}）`;
			const refusedTier = reasoningTierRefusal(result);
			const receipt = refusedTier ?? detail?.tips ?? detail?.displayMsg ?? clippedUpstreamText(result.message, 400);
			const advice = refusedTier !== void 0 ? "这不是账号或网络问题：该模型实测拒绝「off」推理档位，请到模型卡片里取消该行的「可关闭思考」勾选后重试" : result.kind === "client" ? "该请求被上游按参数拒绝：与网络、账号、额度都无关，换账号也不会改变结果，请按上面的提示调整后重试" : shortfall === void 0 ? "" : "建议换一个模型继续，或稍后等待该账号的额度恢复";
			const body = `${isContextTooLongBody(result.message) ? `${CONTEXT_OVERFLOW_MARKER}。` : ""}${advice === "" ? receipt : `${receipt.replace(/[。.]$/u, "")}。${advice}`}`;
			writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, `workbuddy 上游失败：${failoverReasonText(result)}（http ${result.status}）${note}${why}${stamp}。${body}`, hostErrorCode(result.kind));
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no"
		});
		const declared = declaredTools(prepared);
		const gate = declared === void 0 ? void 0 : {
			declaredNames: declared.names,
			requiredParameters: declared.requiredParameters,
			acceptedParameters: declared.acceptedParameters,
			inferFromSchema: true,
			repairNearMissName: true,
			...declared.pinnedToolName === void 0 ? {} : { pinnedToolName: declared.pinnedToolName }
		};
		const notice = switchedFrom === void 0 || switchedBecause === void 0 ? void 0 : failoverNoticeText(switchedFrom, switchedBecause);
		const writer = new RecoveryStream(res, gate, logger, notice, onUpstreamUsage);
		await writer.consume(result.response.body);
		if (gate !== void 0 && !writer.delivered && writer.residueSeen && !controller.signal.aborted) {
			logger?.warn("dsh-connect-workbuddy: the turn produced DSML markup only; retrying it once");
			const retryTried = [...triedAccountIds, workbuddyAccountId(credential)];
			let retryCredential = credential;
			for (;;) {
				const attempt = await client.chatStream(retryCredential, prepared, controller.signal);
				if (attempt.ok) {
					writer.discard();
					const retried = new RecoveryStream(res, gate, logger);
					await retried.consume(attempt.response.body);
					retried.finish();
					reportFailures();
					return;
				}
				recordAttempt(retryCredential, attempt);
				if (!isFailoverWorthy(attempt.kind) || failoverAccount === void 0) break;
				if (controller.signal.aborted) break;
				const next = await failoverAccount(retryTried).catch(() => void 0);
				if (next === void 0) break;
				if (retryTried.includes(workbuddyAccountId(next))) break;
				retryTried.push(workbuddyAccountId(next));
				retryCredential = next;
			}
			logger?.warn("dsh-connect-workbuddy: markup-only retry did not start; showing the original text");
		}
		writer.finish();
		reportFailures();
	}
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => new Promise((resolve) => {
			disposed = true;
			server.close(() => resolve());
			server.closeAllConnections();
		})
	};
}
//#endregion
//#region src/image-tool.ts
/**
* `workbuddy_draw_image`：把 WorkBuddy 的文生图能力（国内区与国际区各自的
* `text-to-image` 模型）暴露成一个 DSH agent 工具。
*
* 为什么手写 ToolDefinition 而不 import `@deepseek-ai/dsh-tools` 的 `defineTool`：
* 宿主 `Tools.register` 只校验两件事——`output.render` 是函数、`output.schema` 是
* 受支持的 JSON Schema；`schemaOf()` 把 `parameters` **原样**投影给模型。也就是说
* raw JSON Schema 完全够用，而 `defineTool` 额外提供的只有「按 spec 编译 schema +
* 代校验参数」这一层包装。手写换来的是：零新 peer 依赖、不需要动态 import 兜底、
* 不会碰到 tests/host-peers.spec.ts 对 `lib/bin.js` 可达图的断言（那里禁止除
* `node:` 外的任何裸说明符）。
*
* 代价是参数校验要自己做——见 {@link createImageTool} 的 execute。
*
* @module dsh-connect-workbuddy/image-tool
*/
/** 工具名。宿主禁止 `run_code`，这个名字与其它 connect 插件的命名习惯一致。 */
const WORKBUDDY_IMAGE_TOOL_NAME = "workbuddy_draw_image";
/** 工具单次执行的上限。实测一张图 17–39 秒，留足余量。 */
const IMAGE_TOOL_TIMEOUT_MS = 18e4;
/** 下载远程输入图的上限（只覆盖 http(s) 那一次 GET，不含生图本身）。 */
const IMAGE_INPUT_TIMEOUT_MS = 3e4;
/** 失败后的冷却：生图按张扣积分，连续重试会在几秒内烧掉几十积分。 */
const FAILURE_COOLDOWN_MS$1 = 3e4;
function asRecord$1(value) {
	return typeof value === "object" && value !== null ? value : {};
}
function asNonEmptyString$1(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/**
* 这些失败说明请求真的打到了上游、可能已经扣了积分，才值得进冷却。
* 参数写错 / 未登录 / 目录里没有模型都还没花钱。
*/
/**
* 这些失败码都发生在「请求已经发出去」之后——上游可能已经扣了积分或排了队，
* 连续重试只会把它们再花一遍，所以进冷却。
*/
const BILLABLE_FAILURE_CODES$1 = /* @__PURE__ */ new Set([
	"AUTH",
	"RATE_LIMIT",
	"NO_ROUTE",
	"UPSTREAM",
	"EMPTY_RESULT"
]);
/**
* 是否该进冷却——由「这一次到底有没有把生图请求发出去」决定，而不是由异常
* 的类型反推。
*
* 早先的写法是「不是 WorkBuddyImageError 就算花过钱」，方向正好错了两头：
* 读目录（`fetchMediaModels` 的那次只读 GET）失败抛的是 upstream.ts 的
* `envelopeError`/网络错误，一分钱没花却把工具冷却 30 秒；而参数写错这类真正
* 免费的失败又因为带着 `INVALID_ARGS` 才被放行——判据和事实不在一根轴上。
*
* 现在由调用点显式置位：请求发出去了才置 `sent`，冷却只看它。
*/
function isBillableFailure$1(error, sent) {
	if (!sent) return false;
	if (error instanceof WorkBuddyImageError) return BILLABLE_FAILURE_CODES$1.has(error.code);
	return true;
}
/** 把 b64 图片落成一个临时文件，返回绝对路径。 */
async function writeTempImage(b64, model) {
	const dir = join(tmpdir(), "workbuddy-image-gen");
	await mkdir(dir, { recursive: true });
	const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
	const safeModel = model.replace(/[^A-Za-z0-9._-]+/g, "_");
	const path = join(dir, `${safeModel}-${stamp}.png`);
	await writeFile(path, Buffer.from(b64, "base64"));
	return path;
}
/**
* 输入图的一切毛病都发生在「请求还没发出去」之前，所以统一用 INVALID_ARGS：
* 不进冷却、不花积分，错误信息直接说清是哪个环节。
*/
function inputImageError(message) {
	return new WorkBuddyImageError(message, "INVALID_ARGS");
}
const INLINE_BASE64_LABEL = "（内联 base64）";
const INLINE_DATA_URL_LABEL = "（内联 data URL）";
/**
* 体积与空文件闸门——四种输入形态都从这里过，所以「空文件」和「超过 8 MB」的
* 文案只有一份。
*
* `byteLength` 必须是**解码后**的字节数：base64 比原始字节长约 4/3，拿字符串长度
* 比上限度会把一个 6 MB 的图误判成超限（并在错误信息里报出一个虚高的 MB 数）。
*/
function assertInputImageBytes(byteLength, source) {
	if (byteLength === 0) throw inputImageError(`workbuddy image: 输入图是空文件：${source}`);
	if (byteLength > 8388608) {
		const limit = MAX_INPUT_IMAGE_BYTES / 1024 / 1024;
		throw inputImageError(`workbuddy image: 输入图 ${(byteLength / 1024 / 1024).toFixed(1)} MB，超过 ${limit} MB 上限：${source}`);
	}
}
/**
* 把任意形态的输入图规整成上游唯一接受的形态：`data:<mime>;base64,<b64>`。
*
* 官方 CLI 的 `processImageInput` 收 data URL、http(s)、裸 base64、本地路径四
* 种；这里只是把前三种归一，**不做**缩放、裁剪、格式转换——用户给什么就传什么，
* 免得悄悄改了输入图。
*/
async function resolveImageInput(value, signal) {
	const text = value.trim();
	if (text.startsWith("data:")) {
		const parsed = parseImageDataUrl(text);
		if (parsed === void 0) throw inputImageError("workbuddy image: image 看起来是 data URL，但格式不对（需要 data:image/*;base64,...）。");
		assertInputImageBytes(Buffer.from(parsed.base64, "base64").byteLength, INLINE_DATA_URL_LABEL);
		return text;
	}
	if (/^https?:\/\//i.test(text)) {
		let response;
		try {
			response = await fetch(text, { signal: signal ?? AbortSignal.timeout(IMAGE_INPUT_TIMEOUT_MS) });
		} catch (error) {
			throw inputImageError(`workbuddy image: 下载输入图失败（${text}）：` + (error instanceof Error ? error.message : String(error)));
		}
		if (!response.ok) throw inputImageError(`workbuddy image: 下载输入图失败（HTTP ${response.status}）：${text}`);
		return encodeInputImage(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type") ?? void 0, text);
	}
	if (isBareBase64Image(text)) return encodeInputImage(new Uint8Array(Buffer.from(text, "base64")), void 0, INLINE_BASE64_LABEL);
	const path = text.startsWith("file:") ? fileURLToPath(text) : text;
	let bytes;
	try {
		bytes = await readFile(path);
	} catch (error) {
		throw inputImageError(`workbuddy image: 读不到输入图「${path}」：` + (error instanceof Error ? error.message : String(error)));
	}
	return encodeInputImage(new Uint8Array(bytes), void 0, path);
}
/** 校验体积、定出 mime，再把字节编成 data URL。 */
function encodeInputImage(bytes, contentType, source) {
	assertInputImageBytes(bytes.byteLength, source);
	const declared = contentType?.split(";")[0]?.trim().toLowerCase();
	const mime = declared !== void 0 && declared.startsWith("image/") ? declared : imageMimeForPath(source) ?? sniffImageMime(bytes);
	return imageDataUrl(mime, Buffer.from(bytes).toString("base64"));
}
/**
* 造出工具定义。
*
* 每次 `apply()` 只造一个实例，所以冷却状态与目录缓存都挂在闭包里，
* 生命周期跟着插件走。
*/
function createImageTool(deps) {
	let mediaCache;
	let cooldownUntil = 0;
	const listModels = async (credential, signal) => {
		const now = Date.now();
		if (mediaCache !== void 0 && now - mediaCache.at < 3e5) return mediaCache.models;
		const models = await deps.listMediaModels(credential, signal);
		mediaCache = {
			at: now,
			models
		};
		return models;
	};
	return {
		name: WORKBUDDY_IMAGE_TOOL_NAME,
		description: "用当前账号的 WorkBuddy 生图能力画一张图。不填 image 是文生图（用该区带 text-to-image 标签的模型）；填了 image 是改图（用带 image-to-image 标签的模型）。国内区与国际区都可用，模型取自该区产品配置（国内区文生图 hunyuan-image-alpha、改图 hunyuan-image-alpha-edit；国际区 hy-image-3.5 同时带这两个标签，以该区目录为准）。每张图会真实消耗 WorkBuddy 积分，单价随区域与模型不同，以返回结果里的 credit 为准；不要在没必要时调用，也不要为了试错连续调用。返回的是 COS 签名 URL，约 24 小时后失效；需要展示给用户时，用 markdown 图片语法引用该 URL。",
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "画面描述（中文或英文都可以）。写清楚主体、风格、构图、光线。"
				},
				size: {
					type: "string",
					description: `图片尺寸，写成「宽x高」（像素）。比例由宽高决定，不限于方图。常用三档：方图 1024x1024、竖图 1024x1536、横图 1536x1024。要大图就按「总像素 419 万以内」放，出的是真实像素不是插值放大：2048x2048（4.19MP，方形上限）、2048x1536、2560x1440（16:9 桌面壁纸）、2560x1600。竖版同理，把长边放到 2048–2560 那一档。超过这个量级会被上游直接拒绝、不会悄悄降级（2560x2560、3072x3072、4096x4096 都失败），所以不要填 4K 尺寸，也不要指望传大数字能拿到更多细节。不填默认 ${DEFAULT_IMAGE_SIZE}（方图）。用户要竖版 / 横版 / 手机壁纸 / 封面 / 高清大图时，改这里的宽高，不要只在 prompt 里说。`
				},
				image: {
					type: "string",
					description: "输入图，可选。填了就是改图（image-to-image）；不填就是文生图。接受本地绝对路径、file:// URL、http(s) URL、data URL 或裸 base64。上限 8 MB，不做缩放或格式转换。"
				},
				model: {
					type: "string",
					description: "模型 id，可选。不填就用该区目录里第一个带当前模式标签的模型（文生图看 text-to-image，改图看 image-to-image）。填了但该 tag 组里没有会直接报错，不会盲发。"
				}
			},
			required: ["prompt"],
			additionalProperties: false
		},
		output: {
			schema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "图片地址（COS 签名 URL，或本地 file:// 地址）。"
					},
					mode: {
						type: "string",
						description: "'generate'（文生图）或 'edit'（改图）。"
					},
					model: {
						type: "string",
						description: "实际使用的模型 id。"
					},
					prompt: {
						type: "string",
						description: "实际提交的画面描述。"
					},
					hint: {
						type: "string",
						description: "给模型的后续提示（如何展示、链接时效）。"
					},
					credit: {
						type: "number",
						description: "本次实际消耗的 WorkBuddy 积分。"
					},
					path: {
						type: "string",
						description: "上游返回 base64 时，落盘的本地绝对路径。"
					}
				},
				required: [
					"url",
					"mode",
					"model",
					"prompt",
					"hint"
				],
				additionalProperties: false
			},
			render(_args, value) {
				const record = asRecord$1(value);
				const url = asNonEmptyString$1(record["url"]) ?? "";
				const model = asNonEmptyString$1(record["model"]) ?? "unknown";
				const mode = record["mode"] === "edit" ? "改图" : "文生图";
				const credit = typeof record["credit"] === "number" ? record["credit"] : void 0;
				const path = asNonEmptyString$1(record["path"]);
				const hint = asNonEmptyString$1(record["hint"]) ?? "";
				const lines = [
					`![WorkBuddy ${mode}](${url})`,
					"",
					`${mode} · 模型：\`${model}\`${credit === void 0 ? "" : ` · 消耗 ${credit} 积分`}`
				];
				if (path !== void 0) lines.push(`本地文件：${path}`);
				if (hint !== "") lines.push("", hint);
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		timeoutMs: IMAGE_TOOL_TIMEOUT_MS,
		async execute(args, exec) {
			const record = asRecord$1(args);
			const prompt = asNonEmptyString$1(record["prompt"]);
			if (prompt === void 0) throw new WorkBuddyImageError(`${WORKBUDDY_IMAGE_TOOL_NAME}: 参数 prompt 必填，且必须是非空字符串。`, "INVALID_ARGS");
			const size = asNonEmptyString$1(record["size"]) ?? "1024x1024";
			const requestedModel = asNonEmptyString$1(record["model"]);
			const image = asNonEmptyString$1(record["image"]);
			const now = Date.now();
			if (now < cooldownUntil) {
				const seconds = Math.ceil((cooldownUntil - now) / 1e3);
				throw new WorkBuddyImageError(`workbuddy image: 上一次生图刚失败过，请 ${seconds} 秒后再试（失败冷却是为了避免连续重试白白烧积分）。`, "COOLDOWN");
			}
			const credential = await deps.resolveCredential();
			if (credential === void 0) throw new WorkBuddyImageError("workbuddy image: 没有可用的 WorkBuddy 账号——要么两个区都没登录，要么已登录的那个区没有打开「允许模型自主生图」。请先在插件设置里登录该区账号，并打开那个开关。", "NOT_LOGGED_IN");
			const signal = exec.signal === void 0 ? AbortSignal.timeout(IMAGE_TOOL_TIMEOUT_MS) : AbortSignal.any([exec.signal, AbortSignal.timeout(IMAGE_TOOL_TIMEOUT_MS)]);
			let sent = false;
			try {
				const models = await listModels(credential, signal);
				const input = image === void 0 ? void 0 : await resolveImageInput(image, signal);
				const model = pickMediaModel(models, requestedModel, input === void 0 ? IMAGE_TAG_TEXT_TO_IMAGE : IMAGE_TAG_IMAGE_TO_IMAGE);
				sent = true;
				const outcome = input === void 0 ? await deps.generateImage(credential, {
					model: model.id,
					prompt,
					size
				}, signal) : await deps.editImage(credential, {
					model: model.id,
					prompt,
					size,
					image: [input]
				}, signal);
				const mode = input === void 0 ? "generate" : "edit";
				const value = {
					mode,
					model: model.id,
					prompt,
					hint: `这张图来自 WorkBuddy（模型 ${model.id}，${mode === "edit" ? "改图" : "文生图"}）。按张扣积分，单价随区域与模型不同` + (outcome.credit === void 0 ? "（本次响应没带扣费字段，以额度面板为准）。" : `；本次实际扣费 ${outcome.credit} 积分。`) + "COS 签名 URL 约 24 小时失效；要长期保留请及时下载。"
				};
				if (outcome.url !== void 0) value["url"] = outcome.url;
				else if (outcome.b64 !== void 0) {
					const path = await writeTempImage(outcome.b64, model.id);
					value["url"] = pathToFileURL(path).href;
					value["path"] = path;
					value["hint"] = `${value["hint"]} 上游返回的是内联 base64，已落盘到本地。`;
				} else throw new WorkBuddyImageError("workbuddy image: 上游既没有返回 url 也没有返回 b64_json。", "EMPTY_RESULT");
				if (outcome.credit !== void 0) value["credit"] = outcome.credit;
				return value;
			} catch (error) {
				if (isBillableFailure$1(error, sent)) cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS$1;
				throw error;
			}
		}
	};
}
/**
* 把工具注册进宿主。返回 disposer；调用方负责在插件卸载时调用它。
*
* 注册本身是同步的；`tools` 服务由宿主提供，拿不到就直接返回 undefined
* 并记一条警告——生图工具缺失不该让整个插件起不来。
*/
function registerWorkBuddyImageTool(tools, deps) {
	try {
		return tools.register(createImageTool(deps));
	} catch (error) {
		deps.logger.warn(`dsh-connect-workbuddy: 注册 ${WORKBUDDY_IMAGE_TOOL_NAME} 失败: ` + (error instanceof Error ? error.message : String(error)));
		return;
	}
}
//#endregion
//#region src/video-tool.ts
/**
* `workbuddy_draw_video`：把 WorkBuddy 的视频生成能力（国内区与国际区各自的
* `text-to-video` / `image-to-video` 模型）暴露成一个 DSH agent 工具。
*
* 与生图工具（一次同步请求就拿回图片）不同，视频是**异步任务**：
* 先 `submitVideo` 拿到 task id，再 `pollVideoTask` 轮询到 completed，
* 最后 `downloadVideo` 把每条视频 URL 落成本地 `.mp4`。这一整段都照搬
* 官方 CLI 的 `VideoService`（submitTask / pollTask / downloadVideos），
* 详见 docs/VIDEO_GEN.md。
*
* 参数 / 选模型层与生图工具几乎完全一致（共用 MEDIA_TAGS、video 标签常量、
* 媒体目录缓存），所以「接受参数」这部分本插件已经就绪；真正多写的是
* 上面那段异步执行流程。
*
* 为什么手写 ToolDefinition（不 import `@deepseek-ai/dsh-tools` 的 `defineTool`）：
* 同 image-tool.ts 的注释——宿主 `Tools.register` 只校验 `output.render` 是函数、
* `output.schema` 是受支持的 JSON Schema，`schemaOf()` 把 `parameters` 原样投影，
* 手写换来零新 peer 依赖、不会触发 tests/host-peers.spec.ts 对可达图的断言。
*
* @module dsh-connect-workbuddy/video-tool
*/
/** 工具名。宿主禁止 `run_code`，这个名字与其它 connect 插件的命名习惯一致。 */
const WORKBUDDY_VIDEO_TOOL_NAME = "workbuddy_draw_video";
/** 工具单次执行的上限：提交 + 轮询（最多 ~10 分钟）+ 下载，留足余量。 */
const VIDEO_TOOL_TIMEOUT_MS = 6e5;
/** 下载远程输入图（图生视频时）的上限，不含生视频本身。 */
const VIDEO_INPUT_TIMEOUT_MS = 3e4;
/** 失败后的冷却：视频按次扣积分且一次要几十秒，连续重试会烧掉大量积分。 */
const FAILURE_COOLDOWN_MS = 6e4;
function asRecord(value) {
	return typeof value === "object" && value !== null ? value : {};
}
function asNonEmptyString(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function asNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asBoolean(value) {
	return typeof value === "boolean" ? value : void 0;
}
/**
* 这些失败说明请求真的打到了上游、可能已经扣了积分，才值得进冷却。
* 参数写错 / 未登录 / 目录里没有模型都还没花钱，轮询也已先花过提交那次的钱。
*
* 注意 `REJECTED` **不在**这里：提交阶段被上游 4xx 退回时任务根本没创建、
* 积分没花，冷却只会让一次「参数写错了」变成白等一分钟。
*/
const BILLABLE_FAILURE_CODES = /* @__PURE__ */ new Set([
	"AUTH",
	"RATE_LIMIT",
	"NO_ROUTE",
	"UPSTREAM",
	"EMPTY_RESULT",
	"TASK_FAILED",
	"POLL_TIMEOUT"
]);
/**
* 是否该进冷却——由「这一次到底有没有把生视频请求发出去」决定。
* 读目录 / 选模型 / 参数校验全在「发请求」之前，失败了不花积分、不冷却。
* 一旦 `submitVideo` 被调用，提交那次就花钱了，后续轮询 / 下载失败一律进冷却。
*/
function isBillableFailure(error, sent) {
	if (!sent) return false;
	if (error instanceof WorkBuddyVideoError) return BILLABLE_FAILURE_CODES.has(error.code);
	return true;
}
/**
* 把任意形态的输入图规整成上游唯一接受的形态：data URL 或 http(s) URL。
*
* 图生视频的 `image_url` 字段只接受上游可访问的 URL。本地文件路径必须
* 读进来、编码成 data URL 再发，否则上游读到的是空响应，返回
* "Input ImageUrl data is invalid (too short)"。与 `image-tool.ts` 的
* `resolveImageInput` 同一套逻辑：data URL 校验后直传，http(s) 校验可达性
* 后直传，裸 base64 / 本地路径 / file:// 读文件编成 data URL。不做缩放
* 或格式转换——用户给什么就传什么。
*/
async function resolveVideoImageInput(value, signal) {
	const text = value.trim();
	if (text.startsWith("data:")) {
		const parsed = parseImageDataUrl(text);
		if (parsed === void 0) throw new WorkBuddyVideoError("workbuddy video: image 看起来是 data URL，但格式不对（需要 data:image/*;base64,...）。", "INVALID_ARGS");
		assertVideoInputImageBytes(Buffer.from(parsed.base64, "base64").byteLength, "（内联 data URL）");
		return text;
	}
	if (/^https?:\/\//i.test(text)) {
		try {
			const response = await fetch(text, {
				method: "HEAD",
				signal: signal ?? AbortSignal.timeout(VIDEO_INPUT_TIMEOUT_MS)
			});
			if (!response.ok) throw new WorkBuddyVideoError(`workbuddy video: 输入图 URL 不可达（HTTP ${response.status}）: ${text}`, "INVALID_ARGS");
		} catch (error) {
			if (error instanceof WorkBuddyVideoError) throw error;
			throw new WorkBuddyVideoError(`workbuddy video: 校验输入图 URL 失败（${text}）：` + (error instanceof Error ? error.message : String(error)), "INVALID_ARGS");
		}
		return text;
	}
	if (isBareBase64Image(text)) return encodeVideoInputImage(Buffer.from(text, "base64"), "（内联 base64）");
	const path = text.startsWith("file:") ? fileURLToPath(text) : text;
	let bytes;
	try {
		bytes = await readFile(path);
	} catch (error) {
		throw new WorkBuddyVideoError(`workbuddy video: 读不到输入图「${path}」：` + (error instanceof Error ? error.message : String(error)), "INVALID_ARGS");
	}
	return encodeVideoInputImage(bytes, path);
}
/**
* 体积与空文件闸门——所有输入图都从这里过，所以「空文件」和「超过 8 MB」
* 的文案只有一份。与 `image-tool.ts` 的 `assertInputImageBytes` 同逻辑。
*
* `byteLength` 必须是解码后的字节数：base64 比原始字节长约 4/3。
*/
function assertVideoInputImageBytes(byteLength, source) {
	if (byteLength === 0) throw new WorkBuddyVideoError(`workbuddy video: 输入图是空文件：${source}`, "INVALID_ARGS");
	if (byteLength > 8388608) {
		const limit = MAX_INPUT_IMAGE_BYTES / 1024 / 1024;
		const actual = (byteLength / 1024 / 1024).toFixed(1);
		throw new WorkBuddyVideoError(`workbuddy video: 输入图 ${actual} MB，超过 ${limit} MB 上限：${source}`, "INVALID_ARGS");
	}
}
/** 校验体积、定出 MIME，再把字节编成 data URL。 */
function encodeVideoInputImage(bytes, source) {
	assertVideoInputImageBytes(bytes.byteLength, source);
	const mime = imageMimeForPath(source) ?? sniffImageMime(bytes);
	return imageDataUrl(mime, Buffer.from(bytes).toString("base64"));
}
/**
* 造出工具定义。每次 `apply()` 只造一个实例，冷却状态与目录缓存都挂在闭包里，
* 生命周期跟着插件走。
*/
function createVideoTool(deps) {
	let mediaCache;
	let cooldownUntil = 0;
	/**
	* 上游在拒绝一次提交时顺带告诉我们的「这个模型支持几秒」。
	*
	* 目录里没有 `videoGeneration` 的账号（实测国内区部分账号的 `/v3/config`
	* 条目只有 `{id,name,tags}`）本地无从校验，只能让上游先拒一次。它拒的时候
	* 会把区间写在文案里，这里记下来：同一个进程里第二次给同样的越界值，就在本地
	* 被 `resolveVideoParams` 拦下——零请求、零冷却。键带上区域名，因为模型 id
	* 不跨区（同名 id 在两个区可能是不同模型）。
	*/
	const learnedSeconds = /* @__PURE__ */ new Map();
	const secondsKey = (domain, modelId) => `${domain}|${modelId}`;
	const listModels = async (credential, signal) => {
		const now = Date.now();
		if (mediaCache !== void 0 && now - mediaCache.at < 3e5) return mediaCache.models;
		const models = await deps.listMediaModels(credential, signal);
		mediaCache = {
			at: now,
			models
		};
		return models;
	};
	return {
		name: WORKBUDDY_VIDEO_TOOL_NAME,
		description: "用当前账号的 WorkBuddy 视频生成能力生成一段短视频。不填 image 是文生视频（用该区带 text-to-video 标签的模型）；填了 image 是图生视频（用带 image-to-video 标签的模型）。国内区与国际区都可用，模型取自该区产品配置（国内区 kling-video-v3、minimax-video-h3；国际区 kling-video-v3，两种 video tag 都有；以该区目录为准）。视频是异步任务：先提交、再轮询到完成、最后把视频下载到本地，单次可能要几十秒到几分钟。每次生成会真实消耗 WorkBuddy 积分，单价随区域与模型不同，以返回结果里的 credit 为准；不要在没必要时调用，也不要为了试错连续调用。返回的是本地 .mp4 文件路径（file:// URL），由宿主/客户端打开或下载。",
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "画面描述（中文或英文都可以），≤2500 字符。写清楚主体、动作、风格、镜头。"
				},
				image: {
					type: "string",
					description: "输入图，可选。填了就是图生视频（image-to-video）；不填就是文生视频。接受本地绝对路径、file:// URL、http(s) URL、data URL 或裸 base64。上限 8 MB，不做缩放或格式转换。"
				},
				model: {
					type: "string",
					description: "模型 id，可选。不填就用用户在设置卡片上按模式钉住的模型；卡片上没钉就用该区目录里第一个带当前模式标签的模型（文生视频看 text-to-video，图生视频看 image-to-video）。填了但该 tag 组里没有会直接报错，不会盲发。"
				},
				seconds: {
					type: "number",
					description: "视频时长（秒），可选。不填用模型默认（通常 5s）。该模型在目录里给了 videoGeneration.minSeconds..maxSeconds 时，越界直接报错、不会静默夹取；目录没给区间时交给上游判断，被拒的错误里会带上游支持的范围，改完可立刻重试（不计失败冷却）。"
				},
				resolution: {
					type: "string",
					description: "分辨率，可选，如 720P / 1080P（大小写不敏感，按模型目录里的拼写发）。不填用模型默认。该模型在目录里给了 videoGeneration.resolutions 时，不在列内会回落到默认分辨率并给出告警；目录没给这份清单时原样透传，交给上游判断（与 seconds 同一条判据）。"
				},
				aspect_ratio: {
					type: "string",
					description: "画面比例，仅文生视频有效，可选：16:9 / 9:16 / 1:1。不填默认 16:9。图生视频由输入图决定比例，传了会被忽略。"
				},
				negative_prompt: {
					type: "string",
					description: "不希望出现的元素，可选，≤2500 字符。"
				},
				enable_audio: {
					type: "boolean",
					description: "是否生成带声音的视频，可选，默认 true。"
				}
			},
			required: ["prompt"],
			additionalProperties: false
		},
		output: {
			schema: {
				type: "object",
				properties: {
					videos: {
						type: "array",
						items: { type: "string" },
						description: "生成的视频本地路径列表（file:// URL，.mp4）。"
					},
					mode: {
						type: "string",
						description: "'text-to-video' 或 'image-to-video'。"
					},
					model: {
						type: "string",
						description: "实际使用的模型 id。"
					},
					prompt: {
						type: "string",
						description: "实际提交的画面描述。"
					},
					seconds: {
						type: "number",
						description: "实际使用的时长（秒）。"
					},
					resolution: {
						type: "string",
						description: "实际使用的分辨率。"
					},
					hint: {
						type: "string",
						description: "给模型的后续提示（如何打开、扣费）。"
					},
					credit: {
						type: "number",
						description: "本次实际消耗的 WorkBuddy 积分。"
					}
				},
				required: [
					"videos",
					"mode",
					"model",
					"prompt",
					"seconds",
					"resolution",
					"hint"
				],
				additionalProperties: false
			},
			render(_args, value) {
				const record = asRecord(value);
				const videos = Array.isArray(record["videos"]) ? record["videos"].filter((v) => typeof v === "string") : [];
				const model = asNonEmptyString(record["model"]) ?? "unknown";
				const modeLabel = record["mode"] === "image-to-video" ? "图生视频" : "文生视频";
				const seconds = typeof record["seconds"] === "number" ? record["seconds"] : void 0;
				const resolution = asNonEmptyString(record["resolution"]);
				const credit = typeof record["credit"] === "number" ? record["credit"] : void 0;
				const hint = asNonEmptyString(record["hint"]) ?? "";
				const lines = [`${modeLabel} · 模型：${model}` + (seconds === void 0 ? "" : ` · ${seconds}s`) + (resolution === void 0 ? "" : ` · ${resolution}`) + (credit === void 0 ? "" : ` · 消耗 ${credit} 积分`), ""];
				if (videos.length === 0) lines.push("（没有返回任何视频文件）");
				else videos.forEach((v, i) => {
					lines.push(`视频 ${i + 1}: [${v}](${v})`);
				});
				if (hint !== "") lines.push("", hint);
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		timeoutMs: VIDEO_TOOL_TIMEOUT_MS,
		async execute(args, exec) {
			const record = asRecord(args);
			const prompt = asNonEmptyString(record["prompt"]);
			if (prompt === void 0) throw new WorkBuddyVideoError(`${WORKBUDDY_VIDEO_TOOL_NAME}: 参数 prompt 必填，且必须是非空字符串。`, "INVALID_ARGS");
			const requestedModel = asNonEmptyString(record["model"]);
			const requestedSeconds = asNumber(record["seconds"]);
			const requestedResolution = asNonEmptyString(record["resolution"]);
			const requestedAspectRatio = asNonEmptyString(record["aspect_ratio"]);
			const requestedNegativePrompt = asNonEmptyString(record["negative_prompt"]);
			const requestedEnableAudio = asBoolean(record["enable_audio"]);
			const image = asNonEmptyString(record["image"]);
			const now = Date.now();
			if (now < cooldownUntil) {
				const seconds = Math.ceil((cooldownUntil - now) / 1e3);
				throw new WorkBuddyVideoError(`workbuddy video: 上一次生视频刚失败过，请 ${seconds} 秒后再试（失败冷却是为了避免连续重试白白烧积分）。`, "COOLDOWN");
			}
			const credential = await deps.resolveCredential();
			if (credential === void 0) throw new WorkBuddyVideoError("workbuddy video: 没有可用的 WorkBuddy 账号——要么两个区都没登录，要么已登录的那个区没有打开「允许模型自主生图」。请先在插件设置里登录该区账号，并打开那个开关。", "NOT_LOGGED_IN");
			const signal = exec.signal === void 0 ? AbortSignal.timeout(VIDEO_TOOL_TIMEOUT_MS) : AbortSignal.any([exec.signal, AbortSignal.timeout(VIDEO_TOOL_TIMEOUT_MS)]);
			let sent = false;
			let chosen;
			try {
				const models = await listModels(credential, signal);
				const imageInput = image === void 0 ? void 0 : await resolveVideoImageInput(image, signal);
				const tag = imageInput === void 0 ? VIDEO_TAG_TEXT_TO_VIDEO : VIDEO_TAG_IMAGE_TO_VIDEO;
				const pinned = requestedModel === void 0 ? deps.preferredVideoModel?.(credential, tag) : void 0;
				let model;
				try {
					model = pickVideoModel(models, requestedModel ?? pinned, tag);
				} catch (error) {
					if (requestedModel !== void 0 || pinned === void 0) throw error;
					model = pickVideoModel(models, void 0, tag);
				}
				chosen = model;
				const learned = learnedSeconds.get(secondsKey(credential.domain, model.id));
				const modelConfig = learned === void 0 ? model.videoGeneration : {
					...model.videoGeneration,
					...learned
				};
				const resolved = resolveVideoParams({
					model: model.id,
					prompt,
					seconds: requestedSeconds,
					negativePrompt: requestedNegativePrompt,
					image: imageInput,
					resolution: requestedResolution,
					aspectRatio: requestedAspectRatio,
					enableAudio: requestedEnableAudio
				}, modelConfig);
				const request = {
					model: model.id,
					prompt,
					seconds: resolved.seconds,
					negativePrompt: requestedNegativePrompt,
					image: imageInput,
					resolution: resolved.resolution,
					aspectRatio: resolved.aspectRatio,
					enableAudio: requestedEnableAudio
				};
				sent = true;
				const submission = await deps.submitVideo(credential, request, signal);
				const outcome = await deps.pollVideoTask(credential, submission.taskId, signal);
				const paths = [];
				for (const url of outcome.videos) {
					const local = await deps.downloadVideo(credential, url, signal);
					paths.push(pathToFileURL(local).href);
				}
				const mode = imageInput === void 0 ? "text-to-video" : "image-to-video";
				const value = {
					videos: paths,
					mode,
					model: model.id,
					prompt,
					seconds: resolved.seconds,
					resolution: resolved.resolution ?? "",
					hint: `这段视频来自 WorkBuddy（模型 ${model.id}，${mode === "image-to-video" ? "图生视频" : "文生视频"}）。按次扣积分，单价随区域与模型不同` + (outcome.credit === void 0 ? "（本次响应没带扣费字段，以额度面板为准）。" : `；本次实际扣费 ${outcome.credit} 积分。`) + (resolved.warnings.length > 0 ? ` 提示：${resolved.warnings.join("；")}。` : "") + "视频已下载到本地，请用 file:// 链接打开或下载保存。"
				};
				if (outcome.credit !== void 0) value["credit"] = outcome.credit;
				return value;
			} catch (error) {
				if (error instanceof WorkBuddyVideoError && error.code === "REJECTED" && chosen !== void 0) {
					const range = parseSupportedSecondsRange(error.message);
					if (range !== void 0) learnedSeconds.set(secondsKey(credential.domain, chosen.id), range);
				}
				if (isBillableFailure(error, sent)) cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
				throw error;
			}
		}
	};
}
/**
* 把工具注册进宿主。返回 disposer；调用方负责在插件卸载时调用它。
* 注册本身是同步的；`tools` 服务由宿主提供，拿不到就直接返回 undefined 并记警告。
*/
function registerWorkBuddyVideoTool(tools, deps) {
	try {
		return tools.register(createVideoTool(deps));
	} catch (error) {
		deps.logger.warn(`dsh-connect-workbuddy: 注册 ${WORKBUDDY_VIDEO_TOOL_NAME} 失败: ` + (error instanceof Error ? error.message : String(error)));
		return;
	}
}
//#endregion
//#region src/cli-bridge/redact.ts
/**
* Scrubbing CLI output before it can reach a conversation.
*
* WHY THIS IS NOT `redactUpstreamText`. That helper lives in `src/probe.ts` and
* ends with `.slice(0, PROBE_MESSAGE_LIMIT)` — 300 characters, enough for a
* probe failure body and far too little for a CodeBuddy reply. Reusing it here
* would silently truncate every review to its first paragraph, so this module
* carries its own implementation of the same two patterns plus the one thing
* the probe route does not have: an explicit secret list.
*
* WHY THE SECRET LIST MATTERS MORE THAN THE PATTERNS. The bridge hands the CLI
* its credential through `CODEBUDDY_AUTH_TOKEN`, which means the token is in
* that child's environment and the child is capable of echoing it back (a stack
* trace, a debug line, an error body). No regex knows what a WorkBuddy token
* looks like from the outside; the only definition that cannot be wrong is
* "replace the exact string I put in the environment". The patterns stay as a
* second net for tokens this process never held (a nested service's token, an
* `Authorization` header copied into an error).
*
* @module dsh-connect-workbuddy/cli-bridge/redact
*/
/** Longest a redacted block may stay before it is treated as one blob. */
const MAX_SECRET_LENGTH = 4096;
const PATTERNS = [
	[/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/gu, "[redacted token]"],
	[/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, "Bearer [redacted]"],
	[/\b(?:sk|ak|pk)-[A-Za-z0-9_-]{12,}\b/gu, "[redacted key]"],
	[/(\b(?:access_token|refresh_token|api_key|apikey|auth_token|token|authorization)\b["']?\s*[=:]\s*["']?)[^"'\s,}&]{8,}/giu, "$1[redacted]"]
];
/**
* Remove token-shaped content from CLI text.
*
* `secrets` are exact strings to scrub first (case-sensitive, literal): the
* credential this turn handed the child. Empty strings are ignored because
* `String.prototype.split('')` would explode the text into characters.
*
* Never throws, never shortens the text. Length is the caller's business — a
* reply that is still too long is truncated by the caller with a marker, not
* here where the reason would be lost.
*/
function redactCliText(text, secrets = []) {
	let out = text;
	for (const secret of secrets) {
		if (typeof secret !== "string") continue;
		if (secret.length < 8 || secret.length > MAX_SECRET_LENGTH) continue;
		out = out.split(secret).join("[redacted credential]");
	}
	for (const [pattern, replacement] of PATTERNS) {
		pattern.lastIndex = 0;
		out = out.replace(pattern, replacement);
	}
	return out;
}
//#endregion
//#region src/cli-bridge/inject.ts
/**
* Handing a finished CLI turn back to the session's model.
*
* WHY THIS EXISTS. `/codebuddy` runs in the Host: the model never sees the line,
* never sees CodeBuddy's answer, and — worse — never learns that files in its own
* workspace may have just changed. A model that believes it is looking at an
* untouched tree will reason confidently about code that is no longer there. So
* after a successful turn the outcome is queued for the model as ONE message
* that names CodeBuddy and the directory it ran in (see `composeContinuation`).
*
* WHY `inject` AND WHY SOMETIMES `steer`. DSH's public `Agent.inject(message)`
* queues model-facing context for the next pre-step **without waking the
* driver** — which is exactly right when a turn is already running (the message
* lands at the next step boundary, no interruption) and exactly wrong when the
* session is idle (the message would sit in the inbox forever and the command
* would look like it silently did nothing). The phase split is therefore:
* running → `inject()`, idle → `steer()` (same call, one argument different:
* it wakes the driver and starts the single turn that reads this message).
*
* "Accepted by the driver" is NOT "the model has read it": a cancellation or a
* disposal can still discard pending context. The outcome says which of the two
* happened and never claims more.
*
* @module dsh-connect-workbuddy/cli-bridge/inject
*/
/**
* A second scrubbing pass on the way into the transcript.
*
* `runAgent` already scrubbed what it returned, so why twice? Because this is the
* last point before the text becomes a permanent message in the session history,
* and the path from the CLI to here goes through a result object that other code
* (now or later) can populate. Scrubbing at the boundary that matters is cheap;
* discovering a token in a saved transcript is not.
*/
function redactInjected(text) {
	return redactCliText(text);
}
/** Bound on one injected message. A reply can be long; a runaway one is a bug. */
const INJECT_TEXT_LIMIT = 2e5;
/**
* The `source.kind` stamped on every message this module writes.
*
* This used to be `'user'`, on the reading that `MessageSource` is a closed
* union and `'user'` is the only slot a plugin-written turn message can occupy.
* That reading was wrong. `MessageSourceMap` is MERGE-EXTENSIBLE — its own doc
* comment says "each producer declares its own `kind` in its own module; there
* is no shared catch-all `plugin` kind", and consumers fall through unknown
* kinds — so `'user'` was never the only option, it was the dishonest one: the
* transcript rendered the injected CodeBuddy result as a user bubble, and the
* UI had no way to label the row as a notification. `dsh-connect-atomcode`
* stamps `'atomcode-bridge'` for exactly this reason.
*
* The declaration that makes the union accept it lives in
* `src/dsh-llm-augment.d.ts`.
*
* `PROVENANCE_LINE` still opens the text: the kind is what the UI and later
* readers key on, but the text is what the MODEL reads, and a model cannot see
* `source`.
*/
const INJECT_SOURCE_KIND = "codebuddy-bridge";
/** The first line of every injected message. Not decoration: the model never
* sees `source.kind`, so this line is its only provenance signal. */
const PROVENANCE_LINE = "[dsh-connect-workbuddy · 由 /codebuddy 自动回注，不是用户输入]";
/**
* An instruction appended so a model does not turn the result into a loop.
*
* The first draft ended with 「据此继续」, which is an instruction to keep going —
* and the obvious way to "keep going" after a CodeBuddy review is to ask
* CodeBuddy again. Each lap spends another account quota. The wording below
* closes that door explicitly: read the result, use it, and do not re-run the
* same bridge to chase it.
*/
const NO_LOOP_NOTE = "这条结论已经完成，不要为了\"再确认一次\"而重复调用 codebuddy_ask 或 /codebuddy —— 每一次调用都会真实消耗一份 CodeBuddy 额度。只有出现新的、不重复的问题时才再发起一轮。";
/** Every refusal this module can produce, by name. */
const REFUSALS = {
	"agent-not-live": "拿不到这个会话的 agent，结论没有交给模型",
	"text-required": "这一轮没有可交给模型的输出",
	"text-too-large": `输出超过 ${String(INJECT_TEXT_LIMIT)} 字符，没有交给模型`,
	"inject-failed": "把结论交给模型时出错"
};
/** A named refusal — never a silent no-op (the failure has to be sayable). */
function refuse(code, detail) {
	const base = REFUSALS[code];
	return {
		ok: false,
		code,
		error: detail !== void 0 && detail !== "" ? `${base}：${detail}` : base
	};
}
/**
* The message handed to the model after a CodeBuddy turn.
*
* Two things it must carry and one it must not claim. It carries WHERE the turn
* ran and WHAT it was asked to do (without them the model reads a conclusion it
* cannot place), and it says the turn may have changed files — that is the whole
* reason a model needs to hear about it. It does NOT claim the human asked the
* model to do anything: the command was human-to-CodeBuddy, so "continue your
* original task" would be a fiction. The model is told to use the result if it
* bears on the work and to stay quiet otherwise.
*/
function composeContinuation(reply, meta = {}) {
	const dir = typeof meta.dir === "string" && meta.dir.trim() !== "" ? meta.dir.trim() : "";
	const scope = typeof meta.scope === "string" && meta.scope.trim() !== "" ? meta.scope.trim() : "";
	const tools = Array.isArray(meta.tools) ? meta.tools : [];
	const toolList = tools.length > 0 ? tools.map((tool) => tool.count > 1 ? `${tool.name}×${String(tool.count)}` : tool.name).join("、") : "无";
	const toolCalls = typeof meta.toolCalls === "number" ? meta.toolCalls : 0;
	return [
		PROVENANCE_LINE,
		"CodeBuddy（另一个独立的 AI 编程助手，跑在本机真实的 CodeBuddy CLI 上）刚完成一次任务。",
		dir === "" ? null : `工作目录：${dir}`,
		scope === "" ? null : `交给它的指令：${scope}`,
		"",
		"--- CodeBuddy 输出开始 ---",
		reply,
		"--- CodeBuddy 输出结束 ---",
		"",
		`这一轮它用了 ${String(toolCalls)} 次工具调用（${toolList}），可能已经改动了工作区里的文件。`,
		"如果这与当前任务有关，就用这些结论继续；如果无关，用一两句话向用户说明即可，不要重复它已经做过的事。",
		NO_LOOP_NOTE
	].filter((line) => line !== null).join("\n");
}
/**
* Deliver the "CodeBuddy finished, here is what it said" message to the agent.
*
* An ABSENT status is read as running — the conservative direction. A message
* that parks is recoverable (the next turn picks it up); an extra model turn
* costs money and cannot be taken back. Only a positive `'idle'` earns the wake.
*/
function injectOutcome(agent, input) {
	if (agent === void 0) return refuse("agent-not-live");
	if (typeof input.reply !== "string" || input.reply.trim() === "") return refuse("text-required");
	if (input.reply.length > 2e5) return refuse("text-too-large");
	const scope = typeof input.scope === "string" ? input.scope : "";
	const text = composeContinuation(redactInjected(input.reply.trim()), {
		...typeof input.dir === "string" ? { dir: input.dir } : {},
		...scope !== "" ? { scope: redactInjected(scope) } : {},
		...typeof input.toolCalls === "number" ? { toolCalls: input.toolCalls } : {},
		...Array.isArray(input.tools) ? { tools: input.tools } : {}
	});
	try {
		const message = createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: { kind: INJECT_SOURCE_KIND }
		});
		const idle = agent.status === "idle";
		if (idle) agent.steer(message);
		else agent.inject(message);
		return {
			ok: true,
			delivered: idle ? "new-turn" : "next-step",
			woke: idle,
			messageId: String(message.id ?? "")
		};
	} catch (error) {
		return refuse("inject-failed", error instanceof Error ? error.message : String(error));
	}
}
/**
* Render a delivery outcome as the one line a command result carries.
*
* The human pressed enter and must learn whether the model was told — "the
* command worked" and "the model knows" are different facts, and conflating
* them is how a silent failure goes unnoticed for a week.
*/
function formatInjection(outcome) {
	if (!outcome.ok) return `[未能通知模型继续：${outcome.code} — ${outcome.error}]`;
	return outcome.woke ? "[已唤醒会话模型：CodeBuddy 的结论已交给它继续]" : "[结论已排队交给模型，随这一轮的下一个步骤或下一轮生效]";
}
//#endregion
//#region src/cli-bridge/credentials.ts
/** Environment variable that short-circuits the vault entirely. */
const AUTH_TOKEN_ENV = "CODEBUDDY_AUTH_TOKEN";
/**
* Walk the vault in region order and return every usable token, best first.
*
* Expired tokens are kept, at the end of their region: `expiresAt` is a claim
* the upstream does not maintain, and a token that "expired" yesterday is
* routinely still accepted. Refusing it locally would turn a working sign-in
* into "not signed in".
*
* @throws when nothing at all is available — the caller reports that as a turn
*   that never started, not as a CLI failure.
*/
async function resolveCredentials(regions, regionOrder, log) {
	const fromEnv = process.env[AUTH_TOKEN_ENV];
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") return [{
		token: fromEnv.trim(),
		source: AUTH_TOKEN_ENV,
		region: "env",
		expired: false
	}];
	const out = [];
	const ordered = [...regions].sort((left, right) => rank(regionOrder, left.region) - rank(regionOrder, right.region));
	for (const { region, store } of ordered) {
		let accounts;
		try {
			accounts = await store.accounts();
		} catch (error) {
			log(`reading the ${region} vault failed: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const ranked = [...accounts].sort((left, right) => right.tokenExpiresAtMs - left.tokenExpiresAtMs);
		for (const account of ranked) {
			const credential = await store.credentialFor(account.id);
			if (credential === void 0 || credential.accessToken === "") continue;
			out.push({
				token: credential.accessToken,
				source: `${region} 账号 ${account.id.slice(0, 6)}`,
				region,
				expired: credential.expiresAtMs > 0 && credential.expiresAtMs <= Date.now()
			});
		}
	}
	if (out.length === 0) throw new Error(`没有可用的 WorkBuddy 登录凭据：插件配置里没读到你登录过的账号。先在 WorkBuddy / CodeBuddy 里登录，或设置环境变量 ${AUTH_TOKEN_ENV}。`);
	return out;
}
/** Position of a region in the preference list; unknown regions sort last. */
function rank(order, region) {
	const index = order.indexOf(region);
	return index === -1 ? order.length : index;
}
//#endregion
//#region src/cli-bridge/gate.ts
/** Hour in milliseconds. */
const WINDOW_MS = 36e5;
/**
* Tracks what has been spent in the last hour.
*
* Deliberately in-memory and per-process: a restart forgets the history, which
* is the right failure direction (a restart cannot lock anyone out of their own
* tool) and the honest scope for a plugin that cannot see other processes.
*/
var TurnGate = class {
	limits;
	now;
	/** Session key → arrival timestamps inside the window, oldest first. */
	perSession = /* @__PURE__ */ new Map();
	/** Every arrival in the window, oldest first. */
	global = [];
	/** Session keys with a turn currently running. */
	running = /* @__PURE__ */ new Set();
	constructor(limits, now = Date.now) {
		this.limits = limits;
		this.now = now;
	}
	/** Drop everything older than the window. Called before every decision. */
	prune(at) {
		const cutoff = at - WINDOW_MS;
		while (this.global.length > 0 && (this.global[0] ?? 0) <= cutoff) this.global.shift();
		for (const [key, arrivals] of this.perSession) {
			while (arrivals.length > 0 && (arrivals[0] ?? 0) <= cutoff) arrivals.shift();
			if (arrivals.length === 0) this.perSession.delete(key);
		}
	}
	/** Whether a turn is running in this session right now. */
	isBusy(sessionKey) {
		return this.running.has(sessionKey);
	}
	/** How many turns this session has started inside the window. */
	spentBySession(sessionKey) {
		this.prune(this.now());
		return this.perSession.get(sessionKey)?.length ?? 0;
	}
	/** How many turns this process has started inside the window. */
	spentTotal() {
		this.prune(this.now());
		return this.global.length;
	}
	/**
	* Ask to start a turn.
	*
	* On success the caller OWNS the slot until `release()` runs; on refusal
	* nothing was charged and nothing needs releasing.
	*/
	tryEnter(sessionKey, onRefused) {
		const at = this.now();
		this.prune(at);
		if (!this.limits.allowConcurrentPerSession && this.running.has(sessionKey)) return {
			ok: false,
			code: "busy",
			error: "这个会话已有一个 CodeBuddy 回合在跑，等它结束再发一次。"
		};
		const { perSessionPerHour, globalPerHour } = this.limits;
		if (perSessionPerHour > 0) {
			const spent = this.perSession.get(sessionKey)?.length ?? 0;
			if (spent >= perSessionPerHour) {
				const message = `本会话最近一小时已经跑了 ${String(spent)} 次 CodeBuddy（上限 ${String(perSessionPerHour)} 次/小时）。等窗口过去，或调高插件配置 cliBridge.maxTurnsPerSessionHour。`;
				onRefused(message);
				return {
					ok: false,
					code: "session-quota",
					error: message
				};
			}
		}
		if (globalPerHour > 0 && this.global.length >= globalPerHour) {
			const message = `最近一小时全场已经跑了 ${String(this.global.length)} 次 CodeBuddy（上限 ${String(globalPerHour)} 次/小时）。等窗口过去，或调高插件配置 cliBridge.maxTurnsPerHour。`;
			onRefused(message);
			return {
				ok: false,
				code: "global-quota",
				error: message
			};
		}
		const arrivals = this.perSession.get(sessionKey) ?? [];
		arrivals.push(at);
		this.perSession.set(sessionKey, arrivals);
		this.global.push(at);
		this.running.add(sessionKey);
		let released = false;
		return {
			ok: true,
			release: () => {
				if (released) return;
				released = true;
				this.running.delete(sessionKey);
			}
		};
	}
	/** Forget every counter. Used by the mount's disposer. */
	clear() {
		this.perSession.clear();
		this.global.length = 0;
		this.running.clear();
	}
};
//#endregion
//#region src/cli-bridge/runner.ts
/**
* One bridged CodeBuddy turn, and the credential walk around it.
*
* WHAT THIS ROUTE ACTUALLY ESCAPES — the honest version. The provider route has
* to look like a CodeBuddy client to get past the gateway's channel check (code
* 11128), which is an arms race the upstream fights with zero-width-space
* perturbation. This route does not impersonate a client at all: the process
* that talks to the gateway really is the CodeBuddy CLI. **That is a CLIENT
* FINGERPRINT win, not an account win.** The credential this module hands the
* CLI comes from the very same local vault the provider route uses, so an
* account that the upstream restricted (code 11140, 「账号存在异常行为」) is
* restricted on this route too. Do not describe it as a way around a ban.
*
* THE INPUT PROTOCOL, which is less obvious than it looks. `stream-json` is not
* a one-way pipe. The CLI asks the driver for permission over the SAME channel
* (`{"type":"control_request","request":{"subtype":"can_use_tool",…}}`) and
* waits for a reply; if stdin was closed after the prompt was written, nobody
* answers and in `plan` mode the process waits forever. So stdin stays OPEN
* until the turn ends, every permission request is denied, and stdin is only
* closed once a `result` frame arrives. The denial carries `interrupt: true`
* ONLY for `ExitPlanMode`: without it `plan` hangs even after a denial, and
* with it a denied Bash aborts the whole turn instead of letting the CLI pick a
* different tool. Both directions were measured. See `denyPermission`.
*
* Two more decisions are load-bearing and easy to undo by accident:
*
* 1. **The prompt travels on stdin, never on argv**, and neither does anything
*    else user-controlled: `--model` and `--append-system-prompt` come from the
*    plugin config, and going through `cmd.exe` would let `&` / `|` / `>` in
*    them become command separators.
*
* 2. **There is no shell, and no PATH fallback.** The CLI entry is always run as
*    `node <entry>`, so no `.cmd` shim and no `shell: true` exists anywhere in
*    this module. If the package cannot be located, the turn is refused and the
*    user is told to set `cliBridge.binary` — because the alternative is
*    spawning whatever `codebuddy` happens to be first on PATH, and that process
*    would inherit a WorkBuddy token.
*
* @module dsh-connect-workbuddy/cli-bridge/runner
*/
/** Package that owns the CLI, under a global `node_modules`. */
const CLI_PACKAGE_PATH = join("@tencent-ai", "codebuddy-code", "bin", "codebuddy");
/** A single NDJSON line bigger than this is a broken build, not a big answer. */
const MAX_FRAME_BYTES = 8388608;
/** How much assistant text is accumulated before the turn is failed. */
const MAX_ASSISTANT_CHARS = 2e6;
/** How long the CLI gets to exit on its own after a `result` frame. */
const EXIT_GRACE_MS = 3e3;
/**
* The reason sent with every denial.
*
* It must NOT start with one of `SYNTHETIC_DENY_PREFIXES`: the CLI treats those
* as a cancelled prompt rather than a decision and lets the tool proceed, which
* would turn "deny everything" into "allow everything" while looking correct.
*/
const DENY_REASON = "dsh-connect-workbuddy runs this turn unattended; no human is at the terminal to approve tool use";
/**
* Directories that ARE a `node_modules` root a global install can live in,
* most likely first.
*
* WHY THE LIST IS THIS LONG. The first draft knew only about `%APPDATA%\npm`
* and the two `/usr/*` prefixes, so every nvm, fnm, volta, pnpm, yarn, brew,
* `~/.local` and `/opt/homebrew` user got "CLI not found" even though it was
* installed. The version-manager roots cannot be listed statically (they carry
* a version or a hash in the path), so `versionedCliRoots` globs one level.
*
* WHY EVERY ENTRY SPELLS OUT ITS OWN LAYOUT. A global npm prefix is not shaped
* the same way on every platform. On POSIX a prefix holds
* `<prefix>/lib/node_modules`; on Windows the prefix `%APPDATA%\npm` holds
* `<prefix>\node_modules` directly and has no `lib` level at all. Appending
* `lib/node_modules` to every root — which an earlier revision of this list
* did — produced paths that exist on no Windows machine, so auto-detection
* failed for every Windows user while the POSIX roots kept working. The
* pnpm and yarn stores are their own `node_modules` root for the same reason.
*
* None of these are probed through PATH, and `cbc` is not a separate target: it
* is an alias of the same `bin/codebuddy` file inside the package.
*/
function cliModuleDirs() {
	const home = homedir();
	const dirs = [];
	const appData = process.env["APPDATA"];
	if (typeof appData === "string" && appData !== "") dirs.push(join(appData, "npm", "node_modules"));
	dirs.push(join(home, "AppData", "Roaming", "npm", "node_modules"));
	for (const prefix of [
		join(home, ".npm-global"),
		"/usr/local",
		"/opt/homebrew",
		join(home, ".local")
	]) dirs.push(join(prefix, "lib", "node_modules"));
	dirs.push(join(home, ".local", "share", "pnpm", "global", "5", "node_modules"));
	dirs.push(join(home, "Library", "pnpm", "global", "5", "node_modules"));
	const localAppData = process.env["LOCALAPPDATA"];
	if (typeof localAppData === "string" && localAppData !== "") {
		dirs.push(join(localAppData, "pnpm", "global", "5", "node_modules"));
		dirs.push(join(localAppData, "Yarn", "Data", "global", "node_modules"));
	}
	dirs.push(join(home, ".config", "yarn", "global", "node_modules"));
	return dirs;
}
/** Directories whose children are node version roots (`.../versions/node/<v>`). */
function versionedCliRoots() {
	const home = homedir();
	const roots = [
		join(home, ".nvm", "versions", "node"),
		join(home, "n", "versions", "node"),
		join(home, ".fnm", "node-versions"),
		join(home, ".local", "share", "fnm", "node-versions"),
		join(home, ".volta", "tools", "image", "node")
	];
	const appData = process.env["APPDATA"];
	if (typeof appData === "string" && appData !== "") roots.push(join(appData, "fnm", "node-versions"));
	return roots;
}
/** Expand one directory's children into CLI entries, ignoring unreadable ones. */
function childrenOf(dir, separator) {
	const out = [];
	try {
		for (const child of readdirSync(dir)) out.push(join(dir, child, ...separator));
	} catch {}
	return out;
}
/** Every path a global install of the CLI could live at, most likely first. */
function cliEntryCandidates() {
	const out = [...cliModuleDirs().map((dir) => join(dir, CLI_PACKAGE_PATH))];
	for (const versions of versionedCliRoots()) {
		out.push(...childrenOf(versions, [
			"lib",
			"node_modules",
			CLI_PACKAGE_PATH
		]));
		out.push(...childrenOf(versions, [
			"installation",
			"lib",
			"node_modules",
			CLI_PACKAGE_PATH
		]));
	}
	return [...new Set(out)];
}
/**
* Locate the CLI's JS entry.
*
* An explicit `binary` from config wins and is taken literally — never
* second-guessed with a fallback, because a typo answered by a different
* working executable is a bug nobody can reproduce. A `.cmd`/`.bat` path is
* REJECTED rather than executed, because running one means going through a
* shell, and that is the exact injection surface this module exists to avoid.
*/
function resolveCliEntry(binary) {
	if (binary !== "") {
		if (process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(binary)) return {
			ok: false,
			entry: "",
			configured: true,
			reason: `cliBridge.binary 指向了 ${binary}，那是一个批处理包装，运行它要经过 cmd.exe，会把配置里的 --model / --append-system-prompt 当成命令解释。请改成同一个包里的 JS 入口，例如 ${join(binary.replace(/\.(?:cmd|bat)$/iu, ""), "..", "node_modules", CLI_PACKAGE_PATH)}。`
		};
		if (!existsSync(binary)) return {
			ok: false,
			entry: "",
			configured: true,
			reason: `cliBridge.binary 指定的路径不存在：${binary}`
		};
		return {
			ok: true,
			entry: binary,
			configured: true,
			reason: ""
		};
	}
	for (const candidate of cliEntryCandidates()) if (existsSync(candidate)) return {
		ok: true,
		entry: candidate,
		configured: false,
		reason: ""
	};
	return {
		ok: false,
		entry: "",
		configured: false,
		reason: "没有找到本机安装的 CodeBuddy CLI（已查过 npm/pnpm/yarn/volta 全局目录与 nvm/fnm 的版本目录）。请先安装 @tencent-ai/codebuddy-code，或在插件配置里用 cliBridge.binary 指定它的绝对路径（要指向包内的 bin/codebuddy，不要指向 .cmd 包装）。不会回退到 PATH 上的 codebuddy —— 那样会把 WorkBuddy 凭据交给一个来源不明的程序。"
	};
}
/**
* Whether a finished-but-failed run failed specifically because the credential
* was refused.
*
* ONLY the CLI's own error channel is read. The first draft also scanned the
* assistant text, which meant a review that merely QUOTED `HTTP 401` looked like
* a rejected token: the bridge then discarded a perfectly good turn and re-ran
* the whole thing on the next account. `text` is deliberately not a parameter
* here so that cannot come back.
*/
function looksLikeAuthFailure(out) {
	if (!out.isError) return false;
	const channel = `${out.errors.join("\n")}\n${out.subtype ?? ""}`;
	return /\b401\b|Authentication required|\/login command|invalid[_-]?api[_-]?key/i.test(channel);
}
function blocksOf(frame) {
	const fromMessage = frame.message?.content;
	if (Array.isArray(fromMessage)) return fromMessage;
	const topLevel = frame.content;
	if (Array.isArray(topLevel)) return topLevel;
	return [];
}
/** Whether `pid` may be used as a process-GROUP id for `process.kill(-pid, …)`. */
function usableGroupPid(pid) {
	return typeof pid === "number" && Number.isInteger(pid) && pid > 1;
}
/** Kill a child AND everything it spawned (git, npm, a test runner). */
function killTree(child) {
	const pid = child.pid;
	if (!usableGroupPid(pid)) {
		try {
			child.kill();
		} catch {}
		return;
	}
	if (process.platform === "win32") {
		try {
			spawn("taskkill", [
				"/pid",
				String(pid),
				"/T",
				"/F"
			], {
				windowsHide: true,
				stdio: "ignore"
			}).on("error", () => {});
		} catch {}
		try {
			child.kill();
		} catch {}
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		try {
			child.kill("SIGTERM");
		} catch {
			return;
		}
	}
	setTimeout(() => {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {}
	}, 1e3).unref();
}
/** Run exactly one CLI turn with exactly one token. */
function runOneTurn(options, token) {
	const entryChoice = resolveCliEntry(options.binary);
	if (!entryChoice.ok) return Promise.reject(new Error(entryChoice.reason));
	const args = [
		entryChoice.entry,
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--max-turns",
		String(options.maxTurns),
		"--permission-mode",
		options.permissionMode
	];
	if (options.model !== "") args.push("--model", options.model);
	if (options.effort !== "") args.push("--effort", options.effort);
	if (options.appendSystemPrompt !== "") args.push("--append-system-prompt", options.appendSystemPrompt);
	if (options.sessionId !== void 0 && options.sessionId !== "") args.push("--session-id", options.sessionId);
	if (options.continueSession === true) args.push("--continue");
	const env = {
		...process.env,
		CODEBUDDY_AUTH_TOKEN: token,
		CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: "1"
	};
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			cwd: options.cwd,
			env,
			shell: false,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true,
			detached: process.platform !== "win32"
		});
		let settled = false;
		const assistantText = [];
		let assistantChars = 0;
		const toolCounts = /* @__PURE__ */ new Map();
		let liveToolCalls = 0;
		let lastToolName = "";
		const deniedTools = [];
		let stderr = "";
		let buffer = "";
		let timer;
		let graceTimer;
		const redact = (text) => redactCliText(text, [token]);
		const cleanup = () => {
			if (timer !== void 0) clearTimeout(timer);
			if (options.signal !== void 0) options.signal.removeEventListener("abort", onAbort);
		};
		const closeStdin = () => {
			try {
				child.stdin.end();
			} catch {}
		};
		/** After a settle, give the CLI a moment to exit; then take the tree down. */
		const scheduleReaper = () => {
			graceTimer = setTimeout(() => {
				killTree(child);
			}, EXIT_GRACE_MS);
			graceTimer.unref();
		};
		const fail = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			closeStdin();
			killTree(child);
			reject(error);
		};
		const onAbort = () => {
			fail(/* @__PURE__ */ new Error("cancelled by the host"));
		};
		const settle = (frame) => {
			if (settled) return;
			settled = true;
			cleanup();
			closeStdin();
			scheduleReaper();
			const errors = Array.isArray(frame.errors) ? frame.errors.filter((value) => typeof value === "string").map(redact) : [];
			resolve({
				text: redact(assistantText.join("\n").trim()),
				toolCounts,
				deniedTools,
				sessionId: typeof frame.session_id === "string" ? frame.session_id : void 0,
				usage: frame.usage,
				numTurns: typeof frame.num_turns === "number" ? frame.num_turns : void 0,
				isError: frame.is_error === true,
				errors,
				subtype: typeof frame.subtype === "string" ? frame.subtype : void 0,
				stderr: redact(stderr)
			});
		};
		/**
		* Answer one permission request. Always a denial; see `DENY_REASON`.
		*
		* `interrupt` IS PER-TOOL, NOT A BLANKET FLAG. Measured against the real CLI:
		*
		* - `plan` asks for approval of `ExitPlanMode`. A plain denial there is
		*   answered by waiting for yet another decision and the process never ends
		*   (>70s, until `timeoutSecs`). `interrupt: true` ends it immediately.
		* - Every other tool (Bash, Write, …) is fine to deny WITHOUT `interrupt`:
		*   the CLI records the denial and tries a different tool, so the turn still
		*   produces a normal reply. Adding `interrupt: true` there aborts the whole
		*   turn instead — measured: `acceptEdits` + Bash denial → `is_error: true`,
		*   empty reply, `Permission denied for tool(s): Bash`, 4.2s.
		*
		* So `interrupt` rides along only when the request is `ExitPlanMode`. That
		* keeps `plan` from hanging without turning every blocked Bash into a failed
		* turn.
		*/
		const denyPermission = (frame) => {
			const toolName = typeof frame.request?.tool_name === "string" ? frame.request.tool_name : "";
			if (toolName !== "") deniedTools.push(toolName);
			const requestId = typeof frame.request_id === "string" ? frame.request_id : "";
			if (requestId === "") return;
			const mustInterrupt = toolName === "ExitPlanMode";
			try {
				child.stdin.write(`${JSON.stringify({
					type: "control_response",
					response: {
						subtype: "success",
						request_id: requestId,
						response: {
							allowed: false,
							reason: DENY_REASON,
							...mustInterrupt ? { interrupt: true } : {}
						}
					}
				})}\n`);
			} catch {}
		};
		if (options.signal !== void 0) {
			if (options.signal.aborted) {
				fail(/* @__PURE__ */ new Error("cancelled by the host"));
				return;
			}
			options.signal.addEventListener("abort", onAbort, { once: true });
		}
		timer = setTimeout(() => {
			fail(/* @__PURE__ */ new Error(`codebuddy exceeded its ${Math.round(options.timeoutMs / 1e3)}s budget`));
		}, options.timeoutMs);
		child.stdin.on("error", () => {});
		child.stdin.write(`${JSON.stringify({
			type: "user",
			message: {
				role: "user",
				content: [{
					type: "text",
					text: options.prompt
				}]
			}
		})}\n`);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			if (settled) return;
			buffer += chunk;
			if (buffer.length > 8388608) {
				fail(/* @__PURE__ */ new Error(`codebuddy emitted a single line longer than ${String(MAX_FRAME_BYTES)} bytes; the CLI build is probably broken`));
				return;
			}
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed === "") continue;
				let frame;
				try {
					frame = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (frame.type === "control_request") {
					denyPermission(frame);
					continue;
				}
				if (frame.type === "assistant") {
					for (const block of blocksOf(frame)) if (block.type === "text" && typeof block.text === "string") {
						assistantChars += block.text.length;
						if (assistantChars > 2e6) {
							fail(/* @__PURE__ */ new Error(`codebuddy produced more than ${String(MAX_ASSISTANT_CHARS)} characters of assistant text in one turn`));
							return;
						}
						assistantText.push(block.text);
						options.onProgress?.({
							toolCalls: liveToolCalls,
							lastTool: lastToolName,
							chars: assistantChars
						});
					} else if (block.type === "tool_use" && typeof block.name === "string") {
						toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
						liveToolCalls += 1;
						lastToolName = block.name;
						options.onProgress?.({
							toolCalls: liveToolCalls,
							lastTool: lastToolName,
							chars: assistantChars
						});
					}
				}
				if (frame.type === "result") {
					settle(frame);
					return;
				}
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (stderr.length > 32768) stderr = stderr.slice(-16384);
		});
		child.on("error", (error) => fail(error));
		child.on("close", (code) => {
			if (settled) return;
			const tail = redact(stderr.trim().split("\n").slice(-6).join("\n"));
			fail(/* @__PURE__ */ new Error(`codebuddy exited with code ${String(code)} and emitted no result frame` + (tail !== "" ? `\n${tail}` : "")));
		});
	});
}
/**
* Run one bridged turn, walking the credential list until a turn completes or
* the list runs out.
*
* WHEN IT MOVES ON, AND WHEN IT STOPS. A wrong-region token 401s, and the only
* way to know which region this CLI build targets is to ask it — one wasted turn
* is cheaper than making the user choose a region they cannot know. But ONLY a
* recognised credential failure is worth another account. The first draft also
* continued after timeouts, crashes and ENOENT, which with ten vault accounts
* meant a single bad call could spend 10 × 900s; those errors are identical for
* every account, so they are raised on the first attempt.
*/
async function runAgent(options, credentials, log) {
	const startedAt = Date.now();
	let lastError;
	for (let index = 0; index < credentials.length; index += 1) {
		const candidate = credentials[index];
		if (candidate === void 0) continue;
		if (candidate.expired) log(`${candidate.source} is past its expiry; trying it anyway`);
		const out = await runOneTurn(options, candidate.token);
		const isLast = index === credentials.length - 1;
		if (looksLikeAuthFailure(out) && !isLast) {
			log(`${candidate.source} was refused (401); trying the next credential`);
			lastError = new Error(out.errors[0] ?? "401");
			continue;
		}
		return {
			ok: !out.isError,
			text: out.text,
			toolCounts: out.toolCounts,
			deniedTools: out.deniedTools,
			sessionId: out.sessionId,
			usage: out.usage,
			numTurns: out.numTurns,
			credential: candidate,
			elapsedMs: Date.now() - startedAt,
			error: out.isError ? out.errors.join("\n") || out.subtype || "the turn reported an error" : void 0
		};
	}
	throw lastError ?? /* @__PURE__ */ new Error("no credential worked");
}
//#endregion
//#region src/cli-bridge/tool.ts
/**
* `codebuddy_ask` — the model-side entrance to the CLI route.
*
* WHAT THIS ROUTE DOES AND DOES NOT ESCAPE. The provider route has to look like
* a CodeBuddy client to get past the gateway's channel check, which is a
* fingerprint arms race. Here the process that talks to the gateway really is
* the CodeBuddy CLI, so there is no client to impersonate. But the credential is
* the same local vault account, so this is a CLIENT-FINGERPRINT win only: an
* account restricted upstream (code 11140) is restricted here too. See the
* module comment in `./runner.ts` for the long version.
*
* THE PRICE, stated plainly: a bridged turn is a SEPARATE agent. It does not see
* this session's conversation, so it re-explores the workspace from scratch. That
* is fine for "review this module" and wrong for "continue what we were doing" —
* which is why the tool takes a self-contained `message`.
*
* THE DIRECTORY RULE IS THE IMPORTANT PART OF THIS FILE. A bridged turn spawns
* an agent that can edit files, and the directory it runs in is that agent's
* whole world. So the directory is never taken on faith: it must exist, be a
* directory, and resolve to somewhere this plugin is allowed to point a
* file-editing agent at. A model that asks for `C:\Users\...\.ssh` gets a
* refusal that says why, not a turn.
*
* @module dsh-connect-workbuddy/cli-bridge/tool
*/
/** Permission modes the CLI accepts for `--permission-mode`. */
const PERMISSION_MODES = [
	"default",
	"acceptEdits",
	"bypassPermissions",
	"plan",
	"dontAsk",
	"auto"
];
/** Reasoning levels the CLI accepts for `--effort`. */
const EFFORT_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** Hard ceiling on one turn's wall clock, in seconds. */
const TIMEOUT_SECS_CAP = 1800;
/** Hard ceiling on the reply length, in characters. */
const MAX_REPLY_CHARS_CAP = 4e5;
/**
* What `cliBridge.sessionContinuity` accepts.
*
* `auto` threads the previous CLI session into the next call; `off` leaves every
* call independent unless the caller passes `session_id` itself. There is no
* `on`-with-a-different-mechanism value: the one that was measured to work is
* `--session-id <existing>`, and offering `--continue` (whatever ran last in the
* cwd) next to it would make two concurrent sessions race for one conversation.
*/
const SESSION_CONTINUITY_MODES = ["auto", "off"];
/** Every field defaulted, so the Host's closed schema always validates. */
function result(partial) {
	return {
		ok: partial.ok === true,
		reply: partial.reply ?? "",
		session_id: partial.session_id ?? "",
		tools: partial.tools ?? [],
		denied_tools: partial.denied_tools ?? [],
		tool_calls: partial.tool_calls ?? 0,
		num_turns: partial.num_turns ?? 0,
		tokens_in: partial.tokens_in ?? 0,
		tokens_out: partial.tokens_out ?? 0,
		cache_read_tokens: partial.cache_read_tokens ?? 0,
		credential_region: partial.credential_region ?? "",
		working_dir: partial.working_dir ?? "",
		unattended: partial.unattended === true,
		elapsed_ms: partial.elapsed_ms ?? 0,
		truncated: partial.truncated === true,
		error: partial.error ?? ""
	};
}
/** Clamp an optional numeric argument to a config default and a hard ceiling. */
function clampInt$1(value, fallback, cap) {
	return Math.max(1, Math.min(cap, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback));
}
/**
* Last CLI session id per DSH session, for automatic continuation.
*
* WHY A MAP AND NOT JUST A TOOL ARGUMENT. `--session-id <existing>` really does
* resume the conversation — measured against the installed CLI: a number sent in
* turn 1 came back from turn 2, and the CLI echoed the same id both times. But
* that id only reaches the CLI when the CALLER passes it back as `session_id`,
* which asks the model to copy a uuid out of the previous result. Best effort,
* not a guarantee. Remembering the id here makes continuation the default rather
* than a habit.
*
* IN MEMORY ON PURPOSE. The value is a uuid owned by the CLI, and an unknown id
* is not an error there — the CLI silently starts a fresh session under it. So
* the failure mode of a lost or stale entry is one new conversation, never a
* mixed-up one, which is the right trade for a file the plugin would otherwise
* have to garbage-collect. Bounded (FIFO) so a long-lived process cannot grow it
* without limit.
*/
const CLI_SESSION_MEMORY = /* @__PURE__ */ new Map();
const CLI_SESSION_MEMORY_CAP = 256;
/** Remember the CLI session a DSH session should continue next time. */
function rememberCliSession(sessionKey, cliSessionId) {
	if (sessionKey === "" || cliSessionId === "") return;
	CLI_SESSION_MEMORY.delete(sessionKey);
	CLI_SESSION_MEMORY.set(sessionKey, cliSessionId);
	while (CLI_SESSION_MEMORY.size > CLI_SESSION_MEMORY_CAP) {
		const oldest = CLI_SESSION_MEMORY.keys().next();
		if (oldest.done === true) break;
		CLI_SESSION_MEMORY.delete(oldest.value);
	}
}
/** The CLI session to continue for this DSH session, or `''` for a fresh one. */
function recallCliSession(sessionKey) {
	return CLI_SESSION_MEMORY.get(sessionKey) ?? "";
}
/**
* A throwaway directory for ONE unattended turn.
*
* ONE DIRECTORY PER CALL, not a fixed `dsh-codebuddy-scratch`. A single shared
* path meant two concurrent unattended turns ran in the same writable space —
* each could read and overwrite the other's files, and anything a previous turn
* left behind was still there. `mkdtemp` guarantees a fresh, empty, uniquely
* named directory, which is what makes the "exempt by construction" argument in
* `resolveWorkingDir` actually true.
*/
function scratchDir() {
	return mkdtempSync(join(tmpdir(), "dsh-codebuddy-scratch-"));
}
/** Best-effort removal: a locked file must not turn a finished turn into an error. */
function removeScratch(dir) {
	try {
		rmSync(dir, {
			recursive: true,
			force: true
		});
	} catch {}
}
/** Case-fold a path on the platforms whose filesystems ignore case. */
function foldCase(path) {
	return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path;
}
/** Resolve symlinks when we can; fall back to the lexical path when we cannot. */
function canonical(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
/** True when `child` is `parent` itself or lives underneath it. */
function isInside(parent, child) {
	const outer = foldCase(canonical(parent));
	const inner = foldCase(canonical(child));
	if (inner === outer) return true;
	return inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
}
/** The session directory this call came from, when the Host supplies one.
*
* THE ORDER INSIDE THIS FUNCTION IS THE FIX. The session's live projection is
* read FIRST, because it is the directory the human and the model are actually
* in; the session header is the fallback, because it is where that projection
* starts from (`init: header => header.cwd ?? null`) and because a session that
* never committed a projection has nothing else.
*
* Both sources are re-validated here: the session service already rejects
* relative headers, but a hand-built agent in a test (or a Host with a looser
* contract) must not be able to smuggle a relative path through either one.
*/
function sessionDirOf(execution, directoryOf) {
	const dirs = sessionDirCandidates(execution, directoryOf);
	return dirs.projection !== "" ? dirs.projection : dirs.header;
}
/**
* Both session-directory sources, kept APART so the caller can tell them — and
* therefore fall back between them — by validity, not just by presence.
*
* {@link sessionDirOf} collapses these into one answer, which is right for "where
* are we" but loses the information "the projection said X, the header says Y".
* The ladder in {@link resolveWorkingDir} needs the pair: a projection can go
* STALE (the directory was deleted, moved, or is an offline mount) while the
* creation-time header still points at a perfectly good directory. Without the
* split, a stale projection is a hard refusal even though a usable directory is
* one field away.
*
* Both sources are re-validated the same way as in {@link sessionDirOf}: absolute
* and non-blank, so a hand-built session cannot smuggle a relative path through
* either field.
*/
function sessionDirCandidates(execution, directoryOf) {
	const session = execution?.agent?.session;
	let projection = "";
	if (session !== void 0 && directoryOf !== void 0) {
		const live = directoryOf(session);
		if (typeof live === "string") {
			const trimmed = live.trim();
			if (trimmed !== "" && isAbsolute(trimmed)) projection = trimmed;
		}
	}
	const cwd = session?.header?.cwd;
	let header = "";
	if (typeof cwd === "string") {
		const trimmed = cwd.trim();
		if (trimmed !== "" && isAbsolute(trimmed)) header = trimmed;
	}
	return {
		projection,
		header
	};
}
/**
* Why `path` cannot be a turn's working directory, or `''` when it can.
*
* The three checks the ladder has always applied (exists / is a directory /
* readable), stated once so the projection→header fallback in
* {@link resolveWorkingDir} re-runs exactly the same gate instead of a weaker
* private copy.
*/
function dirRejection(path) {
	if (!existsSync(path)) return `working_dir "${path}" 不存在。`;
	let isDir = false;
	try {
		isDir = statSync(path).isDirectory();
	} catch (error) {
		return `working_dir "${path}" 无法读取：${error instanceof Error ? error.message : String(error)}`;
	}
	if (!isDir) return `working_dir "${path}" 不是一个目录。`;
	return "";
}
/**
* Decide the directory one turn runs in.
*
* THE ORDER IS A LADDER, and the last rung is a refusal rather than a guess.
* Explicit argument → the calling agent's session cwd → the configured default →
* an explicitly allowed scratch dir → refuse.
*
* THE LADDER IS NOT THE SAFETY PROPERTY; the check after it is. Whatever rung
* wins, the directory must (a) already exist, (b) be a directory, and (c) resolve
* inside an allowed root — the session it was called from, the configured
* default, or one of `allowedDirs`. That third clause is what stops a model from
* asking for `/` or `~/.ssh`: those exist and are directories, so existence
* alone would happily accept them.
*
* A scratch turn is exempt by construction: it is a fresh empty temp directory
* the bridge just created, so there is nothing in it to leak.
*/
function resolveWorkingDir(args, options, execution, directoryOf) {
	const dirs = sessionDirCandidates(execution, directoryOf);
	const primarySessionDir = dirs.projection !== "" && dirs.projection !== dirs.header ? dirs.projection : dirs.header;
	const fallbackSessionDir = primarySessionDir !== dirs.header && dirs.header !== "" ? dirs.header : "";
	const explicit = typeof args["working_dir"] === "string" ? args["working_dir"].trim() : "";
	let chosen = "";
	let fromArgument = false;
	if (explicit !== "") {
		if (!isAbsolute(explicit)) return {
			ok: false,
			dir: "",
			unattended: false,
			reason: `working_dir "${explicit}" 不是绝对路径。请传一个绝对路径（宿主的工具调用不携带会话 cwd）。`
		};
		chosen = explicit;
		fromArgument = true;
	} else if (primarySessionDir !== "") chosen = primarySessionDir;
	else if (options.workingDir !== "") chosen = options.workingDir;
	else if (args["allow_unattended"] === true || options.allowUnattended) return {
		ok: true,
		dir: scratchDir(),
		unattended: true,
		reason: ""
	};
	else return {
		ok: false,
		dir: "",
		unattended: false,
		reason: "no working directory。宿主目前不把会话 cwd 传给插件工具，所以这个值必须由调用方给：① 传 working_dir 指定一个已存在的绝对路径目录；② 在插件配置里设 cliBridge.workingDir；③ 若本回合只是通用问答、不需要任何目录，传 allow_unattended: true（会在一个临时目录里跑，该目录是它的读写边界，不碰你的 home 或会话工作区）。"
	};
	const rejection = dirRejection(chosen);
	if (rejection !== "" && !fromArgument && chosen === primarySessionDir && fallbackSessionDir !== "" && dirRejection(fallbackSessionDir) === "") chosen = fallbackSessionDir;
	else if (rejection !== "") return {
		ok: false,
		dir: "",
		unattended: false,
		reason: !fromArgument && chosen === primarySessionDir && fallbackSessionDir !== "" && dirRejection(fallbackSessionDir) !== "" ? `${rejection}（回退的会话目录 "${fallbackSessionDir}" 同样不可用，工作目录投影与会话 header 都失效了。）` : rejection
	};
	const roots = [];
	if (primarySessionDir !== "") roots.push(primarySessionDir);
	if (fallbackSessionDir !== "") roots.push(fallbackSessionDir);
	if (options.workingDir !== "") roots.push(options.workingDir);
	roots.push(...options.allowedDirs);
	if (!roots.some((root) => root !== "" && isInside(root, chosen))) {
		const listed = roots.filter((root) => root !== "");
		return {
			ok: false,
			dir: "",
			unattended: false,
			reason: `working_dir "${chosen}" 不在本回合允许的范围内。` + (fromArgument ? "工具不能把可写文件的 agent 指向任意目录——请从下面这些根里选一个（或子目录），要放开别的目录得在插件配置 cliBridge.allowedDirs 里显式列出。" : "") + (listed.length > 0 ? `允许的根：${listed.join(" / ")}。` : "当前没有任何允许的根：本会话没有 cwd，配置里也没有 cliBridge.workingDir 或 cliBridge.allowedDirs。")
		};
	}
	return {
		ok: true,
		dir: canonical(chosen),
		unattended: false,
		reason: ""
	};
}
/** The closed output schema the Host validates every result against. */
const OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		ok: {
			type: "boolean",
			description: "本回合是否正常完成"
		},
		reply: {
			type: "string",
			description: "CodeBuddy 的最终回复文本"
		},
		session_id: {
			type: "string",
			description: "本回合的 CLI 会话 id；空字符串表示未报"
		},
		tools: {
			type: "array",
			description: `本回合用过的工具及次数，最多 ${String(12)} 条（超出见 tool_calls，它是真实总数）`,
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					count: { type: "number" }
				},
				required: ["name", "count"],
				additionalProperties: false
			}
		},
		denied_tools: {
			type: "array",
			description: "本回合 CLI 请求过、但被本插件拒绝的工具。非空说明它想动手但没被允许",
			items: { type: "string" }
		},
		tool_calls: {
			type: "number",
			description: "本回合工具调用总次数（tools 数组可能被截断，这个数是真实的）"
		},
		num_turns: {
			type: "number",
			description: "CLI 自报的 agent 轮数"
		},
		tokens_in: {
			type: "number",
			description: "本回合输入 token 数（含缓存命中部分）"
		},
		tokens_out: {
			type: "number",
			description: "本回合输出 token 数"
		},
		cache_read_tokens: {
			type: "number",
			description: "输入里命中提示缓存的部分。它通常占 tokens_in 的绝大部分——名义输入看着很大，新增计费其实很小"
		},
		credential_region: {
			type: "string",
			description: "本次实际用的凭据区域（cn / global / env）"
		},
		working_dir: {
			type: "string",
			description: "本回合实际使用的工作目录（它的读写边界）；空字符串表示本回合在拒绝前就结束了"
		},
		unattended: {
			type: "boolean",
			description: "本回合是否因为调用方传了 allow_unattended 而在临时目录里跑（工具可能在那里写文件）"
		},
		elapsed_ms: {
			type: "number",
			description: "本回合墙钟毫秒数"
		},
		truncated: {
			type: "boolean",
			description: "reply 超过上限被截断（截断处有标记）；长内容应让它落盘再读"
		},
		error: {
			type: "string",
			description: "失败原因；空字符串表示没有错误"
		}
	},
	required: [
		"ok",
		"reply",
		"session_id",
		"tools",
		"denied_tools",
		"tool_calls",
		"num_turns",
		"tokens_in",
		"tokens_out",
		"cache_read_tokens",
		"credential_region",
		"working_dir",
		"unattended",
		"elapsed_ms",
		"truncated",
		"error"
	],
	additionalProperties: false
};
/** The gate this call must pass, built once per normalized option set. */
function gateFor(options) {
	return new TurnGate({
		perSessionPerHour: options.maxTurnsPerSessionHour,
		globalPerHour: options.maxTurnsPerHour,
		allowConcurrentPerSession: false
	});
}
/** The session key a call is charged to, from whichever handle it arrived on. */
function sessionKeyOf(execution, fallback) {
	const id = execution?.agent?.id;
	return typeof id === "string" && id !== "" ? id : fallback;
}
/** The part of a turn that runs once the budget and the directory are settled. */
async function runAskTurn(args, execution, deps, context) {
	const { startedAt, dir, message, effort, modelArg, effectiveMode, liveTurn } = context;
	const { options, regions, log } = deps;
	let credentials;
	try {
		credentials = await resolveCredentials(regions, options.regionOrder, log);
	} catch (error) {
		return result({
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		});
	}
	const sessionIdArg = typeof args["session_id"] === "string" ? args["session_id"].trim() : "";
	const signal = execution?.signal;
	const sessionKey = sessionKeyOf(execution, "codebuddy_ask");
	const continuedSessionId = sessionIdArg !== "" ? sessionIdArg : options.sessionContinuity === "auto" ? recallCliSession(sessionKey) : "";
	if (liveTurn !== void 0) liveTurn.phase = "running";
	const outcome = await runAgent({
		prompt: message,
		cwd: dir.dir,
		binary: options.binary,
		model: modelArg !== "" ? modelArg : options.model,
		permissionMode: effectiveMode,
		effort: effort !== "" ? effort : options.effort,
		appendSystemPrompt: options.appendSystemPrompt,
		maxTurns: clampInt$1(args["max_turns"], options.maxTurns, 100),
		timeoutMs: clampInt$1(args["timeout_secs"], options.timeoutSecs, TIMEOUT_SECS_CAP) * 1e3,
		...continuedSessionId !== "" ? { sessionId: continuedSessionId } : {},
		...signal !== void 0 ? { signal } : {},
		...liveTurn === void 0 ? {} : { onProgress: (progress) => {
			liveTurn.toolCalls = progress.toolCalls;
			liveTurn.lastTool = progress.lastTool;
			liveTurn.chars = progress.chars;
		} }
	}, credentials, log);
	if (liveTurn !== void 0) liveTurn.phase = "finishing";
	let reply = outcome.text;
	let truncated = false;
	if (reply.length > options.maxReplyChars) {
		const omitted = reply.length - options.maxReplyChars;
		reply = `${reply.slice(0, options.maxReplyChars)}\n\n[truncated by dsh-connect-workbuddy: ${String(omitted)} more characters. Have CodeBuddy write the full text to a file and read it back.]`;
		truncated = true;
	}
	const tools = [...outcome.toolCounts.entries()].slice(0, 12).map(([name, count]) => ({
		name,
		count
	}));
	rememberCliSession(sessionKey, outcome.sessionId ?? "");
	return result({
		ok: outcome.ok,
		reply,
		session_id: outcome.sessionId ?? "",
		tools,
		denied_tools: [...outcome.deniedTools],
		tool_calls: [...outcome.toolCounts.values()].reduce((sum, count) => sum + count, 0),
		num_turns: outcome.numTurns ?? 0,
		tokens_in: outcome.usage?.input_tokens ?? 0,
		tokens_out: outcome.usage?.output_tokens ?? 0,
		cache_read_tokens: outcome.usage?.cache_read_input_tokens ?? 0,
		credential_region: outcome.credential.region,
		working_dir: dir.dir,
		unattended: dir.unattended,
		elapsed_ms: Date.now() - startedAt,
		truncated,
		error: outcome.error ?? ""
	});
}
async function runAsk(args, execution, deps, entrance = "tool") {
	const startedAt = Date.now();
	const { options, log } = deps;
	const mode = typeof args["permission_mode"] === "string" ? args["permission_mode"].trim() : "";
	if (mode !== "" && !PERMISSION_MODES.includes(mode)) return result({
		ok: false,
		error: `permission_mode "${mode}" 不是合法值；合法值：${PERMISSION_MODES.join(", ")}`
	});
	const effort = typeof args["effort"] === "string" ? args["effort"].trim() : "";
	if (effort !== "" && !EFFORT_LEVELS.includes(effort)) return result({
		ok: false,
		error: `effort "${effort}" 不是合法值；合法值：${EFFORT_LEVELS.join(", ")}`
	});
	const message = typeof args["message"] === "string" ? args["message"] : "";
	if (message.trim() === "") return result({
		ok: false,
		error: "message 不能为空：要说清楚这一轮让 CodeBuddy 做什么。"
	});
	const dir = resolveWorkingDir(args, options, execution, deps.directoryOf);
	if (!dir.ok) return result({
		ok: false,
		error: dir.reason
	});
	const entry = (deps.gate ?? gateFor(options)).tryEnter(sessionKeyOf(execution, "codebuddy_ask"), (message) => log(message));
	if (!entry.ok) {
		if (dir.unattended) removeScratch(dir.dir);
		return result({
			ok: false,
			error: entry.error
		});
	}
	try {
		const modelArg = typeof args["model"] === "string" ? args["model"].trim() : "";
		const effectiveMode = mode !== "" ? mode : options.permissionMode;
		const liveTurn = deps.live?.begin({
			entrance,
			workingDir: dir.dir,
			unattended: dir.unattended,
			permissionMode: effectiveMode,
			model: modelArg !== "" ? modelArg : options.model,
			...execution?.agent?.id !== void 0 ? { sessionId: execution.agent.id } : {}
		});
		try {
			return await runAskTurn(args, execution, deps, {
				startedAt,
				dir,
				message,
				effort,
				mode,
				modelArg,
				effectiveMode,
				entry,
				...liveTurn === void 0 ? {} : { liveTurn }
			});
		} catch (error) {
			return result({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				elapsed_ms: Date.now() - startedAt
			});
		} finally {
			if (liveTurn !== void 0) deps.live?.end(liveTurn);
		}
	} finally {
		entry.release();
		if (dir.unattended) removeScratch(dir.dir);
	}
}
/**
* Register `codebuddy_ask`, returning the disposer.
*
* `tools` is passed in rather than looked up so a Host without the service
* degrades to "no tool" instead of failing the mount.
*/
function mountAskTool(tools, deps) {
	if (tools === void 0 || typeof tools.register !== "function") return () => {};
	try {
		return tools.register({
			name: "codebuddy_ask",
			description: `把一个独立的任务交给本机的 CodeBuddy CLI 跑一轮完整 agent（它自己读文件、改文件、跑命令），返回它的结论。适合"独立审一块代码 / 跑一轮调查 / 让另一个 agent 复核"，不适合"接着我们刚才的思路改"——它看不到本会话的对话，会重新探索工作区。每次调用都会真实消耗一份 CodeBuddy 账号额度（一轮通常几万输入 token，多数命中缓存）；本会话每小时上限 ${String(deps.options.maxTurnsPerSessionHour === 0 ? "不限" : deps.options.maxTurnsPerSessionHour)} 次、全场每小时上限 ${String(deps.options.maxTurnsPerHour === 0 ? "不限" : deps.options.maxTurnsPerHour)} 次，超了会被具名拒绝。默认只能在本会话的工作区（或在配置里显式列出的目录）里跑；要指定别处的目录得先把它加进 cliBridge.allowedDirs。`,
			timeoutMs: (deps.options.timeoutSecs + 30) * 1e3,
			parameters: {
				type: "object",
				properties: {
					message: {
						type: "string",
						description: "交给 CodeBuddy 的完整任务描述。它看不到本会话，所以要自包含：目标、范围、验收标准。"
					},
					working_dir: {
						type: "string",
						description: "本回合的工作目录（它的读写边界），必须是已存在的绝对路径，且落在本会话工作区或配置的 allowedDirs 之内。不传则用本会话的工作区。"
					},
					model: {
						type: "string",
						description: `可选：本回合模型 id，默认取插件配置（当前 ${deps.options.model === "" ? "CLI 自己的设置" : deps.options.model}）。`
					},
					permission_mode: {
						type: "string",
						description: "可选：本回合权限模式。默认取插件配置（dontAsk = 只读工具放行、写工具被拒，且不会卡住等审批）；plan = 只读，纯审查可用（注意 plan 在 -p 下会请求 ExitPlanMode 审批，被拒才结束）；acceptEdits = 允许改文件；bypassPermissions = 全部放行。default / auto 也接受。传其它值会被拒绝并列出合法值。"
					},
					effort: {
						type: "string",
						description: `可选：本回合推理力度。合法值：${EFFORT_LEVELS.join(", ")}。不传取插件配置。`
					},
					max_turns: {
						type: "number",
						description: `可选：本回合 agent 轮数上限，默认取插件配置（当前 ${String(deps.options.maxTurns)}），上限 ${String(100)}。用尽会标记为截断，不当作成功。`
					},
					timeout_secs: {
						type: "number",
						description: `可选：本回合墙钟超时秒数，默认取插件配置（当前 ${String(deps.options.timeoutSecs)}），上限 ${String(TIMEOUT_SECS_CAP)}；超时会被杀掉并报错。`
					},
					session_id: {
						type: "string",
						description: "可选：要续接的 CLI 会话 id。留空 = 由插件自动续接本会话上一轮的 CodeBuddy 对话（cliBridge.sessionContinuity=auto 时；=off 时留空就是每次开新会话）。只有想故意开一条新对话、或切到另一条对话时才显式传。"
					},
					allow_unattended: {
						type: "boolean",
						description: "可选：本回合不需要任何目录时设为 true，会在一个临时目录里跑（该目录是它的读写边界）。默认 false：一个能改文件的 agent 不该被指向没人选过的目录。"
					}
				},
				required: ["message"]
			},
			output: {
				schema: OUTPUT_SCHEMA,
				render(_args, value) {
					const typed = value;
					if (!typed.ok) return [{
						type: "text",
						text: `CodeBuddy 调用失败: ${typed.error === "" ? "(未给出原因)" : typed.error}`
					}];
					const lines = [
						"CodeBuddy 回复:",
						typed.reply === "" ? "(空回复)" : typed.reply,
						""
					];
					if (typed.truncated) lines.push("[注意：reply 已截断。让 CodeBuddy 把完整内容写到文件里再读，别只靠这一份摘要]", "");
					if (typed.denied_tools.length > 0) lines.push(`[注意：本回合 CodeBuddy 请求过这些工具但被拒绝：${typed.denied_tools.join(", ")}。如果任务本来就要求它们动手，说明默认权限模式（dontAsk）挡住了——明确传 permission_mode 再试]`, "");
					if (typed.unattended) lines.push(`[注意：本回合未指定 working_dir，按调用方的 allow_unattended 在临时目录里执行（${typed.working_dir}）。它读不到你的仓库；要针对某个仓库请显式传 working_dir]`, "");
					const toolList = typed.tools.length > 0 ? typed.tools.map((tool) => tool.count > 1 ? `${tool.name}×${String(tool.count)}` : tool.name).join(", ") : "无";
					lines.push(`[session_id=${typed.session_id === "" ? "?" : typed.session_id} turns=${String(typed.num_turns)} tool_calls=${String(typed.tool_calls)} tools=${toolList} tokens=${String(typed.tokens_in)}in/${String(typed.tokens_out)}out (cache_read=${String(typed.cache_read_tokens)}) elapsed_ms=${String(typed.elapsed_ms)} cred=${typed.credential_region}` + (typed.working_dir !== "" ? ` dir=${typed.working_dir}` : "") + "]");
					return [{
						type: "text",
						text: lines.join("\n")
					}];
				}
			},
			async execute(args, execution) {
				return runAsk(typeof args === "object" && args !== null ? args : {}, execution, deps);
			}
		});
	} catch (error) {
		deps.log(`tool registration failed: ${error instanceof Error ? error.message : String(error)}`);
		return () => {};
	}
}
//#endregion
//#region src/cli-bridge/command.ts
/**
* `/codebuddy` — one CodeBuddy turn started from the composer.
*
* WHY A COMMAND AND NOT JUST THE TOOL. `codebuddy_ask` only runs when the model
* decides to call it, which costs a DSH turn and a decision. A slash command is
* the one host channel that executes against the receiving agent WITHOUT sending
* the line to the model, so the WORK costs no DSH turns.
*
* THE ONE THING IT DOES SPEND BY DEFAULT. On success the result is handed back to
* the session's model so the conversation knows what happened, and that wake-up
* is a real DSH turn with real tokens. The first draft's description claimed the
* command "does not consume DSH quota", which is false under the default
* `injectResult: true`; the description now says so. With `injectResult: false`
* the promise holds: nothing but the human sees the result.
*
* WHAT AN EMPTY LINE MEANS. `/codebuddy` alone is a review: the built-in brief
* asks CodeBuddy to read the uncommitted changes and report problems. Anything
* the human types is sent verbatim instead.
*
* @module dsh-connect-workbuddy/cli-bridge/command
*/
/** The command name as registered (no leading slash). */
const COMMAND_NAME = "codebuddy";
/**
* The mode a review runs in.
*
* NOT `plan`. `plan` under `-p` answers a write attempt by asking the driver to
* approve an `ExitPlanMode` hand-off, and the only answer an unattended bridge
* can give is a denial — so a "review" in plan mode tends to end as a failed
* turn with no findings, which is the least useful possible outcome. `dontAsk`
* gets the read half (Read/Glob/Grep/Bash) auto-approved and refuses the write
* half, which is exactly what a review needs. Measured both ways; see the module
* comment in `./runner.ts`.
*/
const REVIEW_PERMISSION_MODE = "dontAsk";
/**
* The brief an empty `/codebuddy` line expands to.
*
* It names the scope AND the failure mode it wants avoided ("只报你确实看见的
* 问题"): a review that guesses is worse than one that says less, because the
* human cannot tell the two apart in the output.
*/
const REVIEW_BRIEF = "评审当前工作区里未提交的改动（git 未提交改动；没有未提交改动时看最近一次提交）。自己运行 git 命令确认范围，必要时读相关文件理解上下文，然后给出评审结论：哪些地方有问题、为什么、怎么改。只报你确实看见的问题，不要猜。";
/** The mode `--edit` selects for the one turn it appears on. */
const EDIT_PERMISSION_MODE = "acceptEdits";
/**
* Read the composer line.
*
* Empty → the review brief. Non-empty → the text verbatim, because a human who
* typed something meant it, and silently prepending a review brief to "改一下
* 这个 bug" is how a command does something other than what it was asked.
*
* `--edit` is stripped and remembered rather than forwarded: CodeBuddy must not
* see a flag that only means something to this bridge.
*/
function parseCommandInput(raw) {
	const note = raw.trim();
	if (note === "") return {
		prompt: REVIEW_BRIEF,
		label: "（未提交改动）",
		review: true,
		permissionMode: REVIEW_PERMISSION_MODE
	};
	const edit = /^--edit(?:\s|$)/u.test(note);
	const body = edit ? note.replace(/^--edit\s*/u, "").trim() : note;
	if (body === "") return {
		prompt: REVIEW_BRIEF,
		label: "（未提交改动，可写）",
		review: true,
		permissionMode: EDIT_PERMISSION_MODE
	};
	return {
		prompt: body,
		label: edit ? `（可写：${body}）` : `（指令：${body}）`,
		review: false,
		permissionMode: edit ? EDIT_PERMISSION_MODE : ""
	};
}
/** A one-line label saying how the human's words were used. */
function commandScopeLabel(raw) {
	return parseCommandInput(raw).label;
}
/**
* Render one turn outcome as the plain text a command result carries.
*
* The footer is the same shape the tool renders, because a human reading a
* command result wants the same facts: which session, how many turns, what it
* cost, and where it ran. The one thing added here is the working directory —
* a command result is the only place the human learns WHICH tree was reviewed.
*
* `injection` is the delivery outcome of handing the result to the session's
* model. It is rendered on its own line because "the command ran" and "the model
* was told" are different facts and the human is entitled to both; omitting it
* means no delivery was attempted (failed turn, or disabled).
*/
function formatCommandOutcome(value, extra = {}) {
	const scope = commandScopeLabel(extra.raw ?? "");
	if (!value.ok) return `CodeBuddy 失败${scope}：${value.error === "" ? "未知错误" : value.error}`;
	const body = value.reply.trim();
	const head = body === "" ? `CodeBuddy 完成${scope}：没有输出任何结论。` : `CodeBuddy 完成${scope}：\n\n${body}`;
	const toolList = value.tools.length > 0 ? value.tools.map((tool) => tool.count > 1 ? `${tool.name}×${String(tool.count)}` : tool.name).join(", ") : "无";
	const denied = value.denied_tools.length > 0 ? `\n\n[注意：CodeBuddy 请求过这些工具但被拒绝：${value.denied_tools.join(", ")}。评审类任务读到这些就该够了；要它真动手，在指令前加 --edit（只影响这一轮），或在配置里设 cliBridge.permissionMode=acceptEdits（影响之后每一轮）]` : "";
	const footer = `\n\n[session_id=${value.session_id === "" ? "?" : value.session_id} turns=${String(value.num_turns)} tool_calls=${String(value.tool_calls)} tools=${toolList} tokens=${String(value.tokens_in)}in/${String(value.tokens_out)}out (cache_read=${String(value.cache_read_tokens)}) elapsed_ms=${String(value.elapsed_ms)} cred=${value.credential_region}` + (value.working_dir !== "" ? ` dir=${value.working_dir}` : "") + "]";
	const truncated = value.truncated ? "\n\n[注意：输出已截断。让 CodeBuddy 把完整内容写到文件里再读，别只靠这一份摘要]" : "";
	const delivery = extra.injection === void 0 ? "" : `\n\n${formatInjection(extra.injection)}`;
	return head + denied + footer + truncated + delivery;
}
/**
* The command's slice of the invocation the tool's resolver needs.
*
* The command's agent IS a live agent (the Host's command service passes the
* whole thing, not a narrowed subset), so it satisfies `BridgeToolExecution`
* structurally. The `signal` field is carried so the shared resolver sees the
* same object shape it sees from a tool call.
*/
function sessionDirOfCommand(invocation, directoryOf) {
	return sessionDirOf({
		...invocation.agent !== void 0 ? { agent: invocation.agent } : {},
		...invocation.signal !== void 0 ? { signal: invocation.signal } : {}
	}, directoryOf);
}
/**
* Register `/codebuddy`, returning the disposer.
*
* `commands` is passed in rather than looked up so a Host without the service
* degrades to "no command" instead of failing the mount — the command is an
* addition, not a load-bearing part of the plugin.
*
* CONCURRENCY IS NOT TRACKED HERE ANY MORE. The first draft kept its own
* `inFlight` set, which covered `/codebuddy` calls against each other and nothing
* else: a tool call and a command could run two agents in the same workspace at
* once, and neither counted against any budget. Both entrances now go through
* `runAsk`, so the shared `TurnGate` in `./gate.ts` is the single place that
* decides "one at a time per session" and "N per hour".
*/
function mountCodebuddyCommand(commands, deps) {
	if (commands === void 0 || typeof commands.register !== "function") return () => {};
	const { options, log } = deps;
	try {
		return commands.register({
			name: COMMAND_NAME,
			description: "用 CodeBuddy 在当前工作区跑一轮；留空 = 评审未提交改动；以 --edit 开头 = 这一轮允许改文件。注意：默认（cliBridge.injectResult=true）跑完会把结论回注给本会话的模型，那一次唤醒会真的消耗 DSH token；设 injectResult=false 才完全不碰模型。CodeBuddy 那一侧的账号额度每次都会消耗。",
			input: { hint: "留空 = 评审未提交改动；写要求 = 只读执行（如\"看一下这个函数为什么崩\"）；要以 --edit 开头 = 允许改文件（如\"--edit 修一下这个空指针\"）" },
			handler: async (invocation) => {
				const cwd = sessionDirOfCommand(invocation, deps.directoryOf);
				if (cwd === "") return {
					kind: "error",
					text: "这个会话没有工作区路径（会话的工作目录投影为空，回退的 session.header.cwd 也为空），无法确定 CodeBuddy 该在哪里跑。请在一个打开过目录的会话里再试。"
				};
				const raw = typeof invocation.rawInput === "string" ? invocation.rawInput : "";
				const parsed = parseCommandInput(raw);
				const startedAt = Date.now();
				try {
					const value = await runAsk({
						message: parsed.prompt,
						working_dir: cwd,
						...parsed.permissionMode !== "" ? { permission_mode: parsed.permissionMode } : {}
					}, {
						...invocation.agent !== void 0 ? { agent: invocation.agent } : {},
						...invocation.signal !== void 0 ? { signal: invocation.signal } : {}
					}, deps, "command");
					log(`command /${COMMAND_NAME} finished in ${String(Date.now() - startedAt)}ms (ok=${String(value.ok)})`);
					const injection = value.ok && options.injectResult ? injectOutcome(invocation.agent, {
						reply: value.reply,
						dir: cwd,
						scope: commandScopeLabel(raw),
						toolCalls: value.tool_calls,
						tools: value.tools
					}) : void 0;
					return {
						kind: value.ok ? "success" : "error",
						text: formatCommandOutcome(value, {
							raw,
							...injection !== void 0 ? { injection } : {}
						})
					};
				} catch (error) {
					const text = error instanceof Error ? error.message : String(error);
					log(`command /${COMMAND_NAME} threw: ${text}`);
					return {
						kind: "error",
						text: `CodeBuddy 异常终止：${text}`
					};
				}
			}
		});
	} catch (error) {
		log(`command registration failed: ${error instanceof Error ? error.message : String(error)}`);
		return () => {};
	}
}
//#endregion
//#region src/cli-bridge/live.ts
/**
* Build a board.
*
* Ordering is "oldest first", which is the order a human reads a queue in; the
* chip draws the newest as the headline because that is the one the last click
* started.
*/
function createLiveBoard() {
	const turns = [];
	let counter = 0;
	const begin = (input) => {
		counter += 1;
		const startedAt = Date.now();
		const turn = {
			id: `${startedAt.toString(36)}-${String(counter)}`,
			startedAt,
			entrance: input.entrance,
			workingDir: input.workingDir,
			unattended: input.unattended,
			permissionMode: input.permissionMode,
			model: input.model,
			sessionId: input.sessionId ?? "",
			phase: "starting",
			toolCalls: 0,
			lastTool: "",
			chars: 0
		};
		turns.push(turn);
		return turn;
	};
	const end = (turn) => {
		const at = turns.indexOf(turn);
		if (at >= 0) turns.splice(at, 1);
	};
	const snapshot = (now = Date.now()) => ({
		turns: turns.map((turn) => ({
			id: turn.id,
			startedAt: turn.startedAt,
			elapsedMs: Math.max(0, now - turn.startedAt),
			entrance: turn.entrance,
			workingDir: turn.workingDir,
			unattended: turn.unattended,
			permissionMode: turn.permissionMode,
			model: turn.model,
			sessionId: turn.sessionId,
			phase: turn.phase,
			toolCalls: turn.toolCalls,
			lastTool: turn.lastTool,
			chars: turn.chars
		})),
		serverTime: now
	});
	return {
		begin,
		end,
		snapshot,
		size: () => turns.length
	};
}
//#endregion
//#region src/cli-bridge/mount.ts
/**
* Wiring the CLI route into the plugin, and normalizing its settings.
*
* THE ROUTE IS OPT-IN AND NON-BREAKING. It is `enabled: false` by default, and
* its two host surfaces are mounted reactively by the caller (`ctx.inject`), not
* sampled once at apply time. That combination is deliberate: this plugin is
* installed by people whose only interest is the provider, and a new hard
* dependency would either fail their mount or silently remove their models.
*
* THE MOUNT IS TWO INDEPENDENT SURFACES ON PURPOSE. `codebuddy_ask` and
* `/codebuddy` come from two different host services that become available at
* different moments (and can come and go). So the settings are normalized ONCE
* into a `CliBridgeRuntime` — options plus the shared turn gate — and each
* surface mounts and disposes on its own. That is why the mid-sized fact "the
* tool and the command share one budget" survives a re-mount: the gate lives on
* the runtime, not on either surface.
*
* WHY THE ROUTE EXISTS AT ALL, stated honestly. The provider route has to look
* like a CodeBuddy client to get past the gateway's channel check, and that is an
* arms race the upstream fights with zero-width-space perturbation (see
* `perturbChannelFingerprints`). This route does not impersonate anything — but
* it uses the SAME vault account, so it is a client-fingerprint win, NOT a way
* around an account restriction (code 11140). The first draft's README claimed
* otherwise; do not let that claim come back.
*
* @module dsh-connect-workbuddy/cli-bridge/mount
*/
/**
* Defaults, mirroring the schema so a missing key behaves the same either way.
*
* `permissionMode` is `dontAsk`, NOT `acceptEdits` and not `plan`. Measured
* against the real CLI under `-p`: `acceptEdits` lets the agent edit files in a
* directory a model chose; `plan` asks the driver to approve an `ExitPlanMode`
* hand-off and a bridge can only deny it, so the turn dies without findings;
* `dontAsk` auto-approves the read half and refuses the write half without ever
* waiting for a human. That is the only one of the three that is both safe and
* useful when nobody is watching.
*/
const CLI_BRIDGE_DEFAULTS = {
	enabled: false,
	binary: "",
	model: "",
	permissionMode: "dontAsk",
	effort: "",
	maxTurns: 10,
	timeoutSecs: 900,
	regionOrder: "cn,global",
	workingDir: "",
	allowedDirs: "",
	appendSystemPrompt: "",
	allowUnattended: false,
	maxReplyChars: 6e4,
	injectResult: true,
	sessionContinuity: "auto",
	maxTurnsPerSessionHour: 6,
	maxTurnsPerHour: 20
};
/** Clamp an optional number to a default and a hard ceiling. */
function clampInt(value, fallback, cap) {
	return Math.max(1, Math.min(cap, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback));
}
/** Read a non-negative integer setting where 0 legitimately means "unbounded". */
function clampQuota(value, fallback) {
	if (value === 0) return 0;
	return Math.max(0, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback);
}
/** Read a string setting, trimmed, falling back when it is not a string. */
function text(value, fallback) {
	return typeof value === "string" ? value.trim() : fallback;
}
/** Split a comma-separated list, dropping empties. */
function list(value) {
	return value.split(",").map((part) => part.trim()).filter((part) => part !== "");
}
/**
* Turn raw settings into the normalized options one turn runs on.
*
* An out-of-range enum is REPORTED and then replaced by the default rather than
* rejected: a typo in `permissionMode` should not take the whole plugin down, but
* it must not silently run under a permission level the user did not pick
* either. `onRejected` is how the caller turns that into a log line.
*/
function normalizeCliBridgeOptions(settings, onRejected) {
	const raw = settings ?? {};
	const reject = onRejected ?? (() => {});
	const permissionMode = text(raw.permissionMode, CLI_BRIDGE_DEFAULTS.permissionMode);
	const safePermissionMode = PERMISSION_MODES.includes(permissionMode) ? permissionMode : CLI_BRIDGE_DEFAULTS.permissionMode;
	if (safePermissionMode !== permissionMode) reject(`permissionMode "${permissionMode}" 不是合法值，已回退到 ${safePermissionMode}；合法值：${PERMISSION_MODES.join(", ")}`);
	const effort = text(raw.effort, CLI_BRIDGE_DEFAULTS.effort);
	const safeEffort = effort === "" || EFFORT_LEVELS.includes(effort) ? effort : "";
	if (safeEffort !== effort) reject(`effort "${effort}" 不是合法值，已回退到 CLI 默认；合法值：${EFFORT_LEVELS.join(", ")}`);
	const regionOrder = text(raw.regionOrder, CLI_BRIDGE_DEFAULTS.regionOrder);
	const sessionContinuity = text(raw.sessionContinuity, CLI_BRIDGE_DEFAULTS.sessionContinuity);
	const safeSessionContinuity = SESSION_CONTINUITY_MODES.includes(sessionContinuity) ? sessionContinuity : CLI_BRIDGE_DEFAULTS.sessionContinuity;
	if (safeSessionContinuity !== sessionContinuity) reject(`sessionContinuity "${sessionContinuity}" 不是合法值，已回退到 ${CLI_BRIDGE_DEFAULTS.sessionContinuity}；合法值：${SESSION_CONTINUITY_MODES.join(", ")}`);
	return {
		enabled: raw.enabled === true,
		binary: text(raw.binary, CLI_BRIDGE_DEFAULTS.binary),
		model: text(raw.model, CLI_BRIDGE_DEFAULTS.model),
		permissionMode: safePermissionMode,
		effort: safeEffort,
		maxTurns: clampInt(raw.maxTurns, CLI_BRIDGE_DEFAULTS.maxTurns, 100),
		timeoutSecs: clampInt(raw.timeoutSecs, CLI_BRIDGE_DEFAULTS.timeoutSecs, TIMEOUT_SECS_CAP),
		regionOrder: list(regionOrder),
		workingDir: text(raw.workingDir, CLI_BRIDGE_DEFAULTS.workingDir),
		allowedDirs: list(text(raw.allowedDirs, CLI_BRIDGE_DEFAULTS.allowedDirs)),
		appendSystemPrompt: text(raw.appendSystemPrompt, CLI_BRIDGE_DEFAULTS.appendSystemPrompt),
		allowUnattended: raw.allowUnattended === true,
		maxReplyChars: clampInt(raw.maxReplyChars, CLI_BRIDGE_DEFAULTS.maxReplyChars, MAX_REPLY_CHARS_CAP),
		injectResult: raw.injectResult !== false,
		sessionContinuity: safeSessionContinuity,
		maxTurnsPerSessionHour: clampQuota(raw.maxTurnsPerSessionHour, CLI_BRIDGE_DEFAULTS.maxTurnsPerSessionHour),
		maxTurnsPerHour: clampQuota(raw.maxTurnsPerHour, CLI_BRIDGE_DEFAULTS.maxTurnsPerHour)
	};
}
/**
* Build the runtime, or `undefined` when the route is disabled.
*
* Returning `undefined` rather than an enabled flag keeps every caller honest:
* there is no "mounted but disabled" state to accidentally treat as live.
*/
function createCliBridgeRuntime(settings, regions, log, directoryOf) {
	const options = normalizeCliBridgeOptions(settings, (message) => log(message));
	if (!options.enabled) return void 0;
	const live = createLiveBoard();
	return {
		options,
		deps: {
			options,
			regions,
			log,
			gate: gateFor(options),
			live,
			...directoryOf !== void 0 ? { directoryOf } : {}
		},
		live
	};
}
/** Mount `codebuddy_ask` on a tools service, returning its disposer. */
function mountToolSurface(runtime, tools) {
	return mountAskTool(tools, runtime.deps);
}
/** Mount `/codebuddy` on a commands service, returning its disposer. */
function mountCommandSurface(runtime, commands) {
	return mountCodebuddyCommand(commands, runtime.deps);
}
//#endregion
//#region src/probe.ts
/**
* How long to bench a MODEL that answered 14003 with no stated time.
*
* One minute, because that is what the upstream itself says: the failure body
* carries `displayTips.zh` = "建议等待约 1 分钟后重试，或切换到负载较低的模型"
* (and its English twin "Wait about a minute before retrying, or switch to a
* less busy model"). A fallback coarser than the upstream's own advice is not
* conservatism, it is a different and worse claim: issue #56 reports 14003 being
* multiplied into 30 minutes per account, which turned a one-minute model
* hiccup into a half-hour outage across the whole pool.
*
* Two minutes rather than one, because a probe costs a full request and the
* point of the wait is to be past the burst, not to land exactly on its edge.
*/
const MODEL_BUSY_COOLDOWN_MS$1 = 12e4;
/**
* The system message every probe carries.
*
* Not decoration: the international gateway rejects a conversation that does not
* start with a system message (see the module note). A probe that omitted it
* would report every global model as broken.
*/
const PROBE_SYSTEM_PROMPT = "You are a connectivity check. Reply with a single word.";
/**
* Output cap for a probe. One token is enough to prove the model answers.
*
* The probe's cost comes from its INPUT, not its output (see
* {@link DEFAULT_PROBE_INPUT_TOKENS}), so paying for a long completion would add money
* without adding signal.
*/
const PROBE_MAX_TOKENS = 1;
/**
* How much input a probe sends, in tokens.
*
* This is the whole point of the probe, and it is NOT a free choice. The
* upstream's rate limit (business code 6004) fires on request SIZE, measured on
* 2026-09-29 by varying only the input against one account and one model:
*
*   | input     | prompt_tokens the upstream counted | result |
*   | ---       | ---                                | ---    |
*   | ~10       | 38                                 | ok     |
*   | ~1,000    | 1,138                              | ok     |
*   | ~10,000   | 11,138                             | ok     |
*   | ~18,000   | 20,018                             | ok     |
*   | ~25,000   | 25,023                             | ok     |
*   | ~30,000   | ~32k                               | **429 / 6004** |
*
* So the threshold sits between 20k and 30k, a SINGLE large request is enough to
* trip it (it is not a running total), and each account reports its own reset
* time (two accounts at the same moment: `22:20:33` and `00:32:51`).
*
* A probe that sent a handful of tokens answered "usable" while every real
* request in a long conversation was refused — the probe was asking too small a
* question. 25k is sized to be a realistic long-conversation payload.
*
* Renamed from `PROBE_INPUT_TOKENS` to say what it now IS: the DEFAULT, not the
* only possible size. The size is a property of the user's own traffic (see
* {@link probeRequestBody}), so it became a setting; this constant is what an
* unset setting, an older profile, and every existing test mean by "a probe".
*/
const DEFAULT_PROBE_INPUT_TOKENS = 25e3;
/**
* The probe sizes the card offers, in tokens.
*
* A closed set, each step a meaningful position relative to the measured 20k~30k
* threshold: below it (10k/20k) proves an account can serve SHORT requests and
* is the cheap choice; at it (30k) is the size that finally covers the whole
* measured window; above it (50k/100k) is for conversations that routinely run
* long, where a smaller probe would report "usable" for an account that refuses
* the very next message.
*
* Exported so the schema's description, the card's dropdown, and the coercion
* below cannot drift apart into three different menus.
*/
const PROBE_INPUT_TOKEN_CHOICES = [
	1e4,
	2e4,
	3e4,
	5e4,
	1e5
];
/**
* A requested probe size reduced to a size this build will actually send.
*
* Anything outside {@link PROBE_INPUT_TOKEN_CHOICES} — `undefined` from an older
* profile, `0` from an unset field, a hand-edited odd number — becomes the
* measured default. Coercing rather than rejecting keeps a hand-edited profile
* working instead of turning one odd value into a failed test batch.
*/
function resolveProbeInputTokens(requested) {
	return requested !== void 0 && PROBE_INPUT_TOKEN_CHOICES.includes(requested) ? requested : DEFAULT_PROBE_INPUT_TOKENS;
}
/**
* Characters per token for the filler text, measured.
*
* Filling with a fixed English sentence, the upstream counted about 4.5
* characters per token. An estimate rather than a bundled tokenizer: the body
* only needs to be the right SIZE CLASS, and the target has ample margin over
* the measured threshold, so estimate error cannot change the verdict.
*/
const CHARS_PER_TOKEN = 4.5;
/** Neutral filler; carries no user content, only volume. */
const FILLER_LINE = "The quick brown fox jumps over the lazy dog. ";
/**
* Build the request body for one probe.
*
* `stream` is forced because the upstream rejects non-streaming chat requests;
* `prepareChatBody` enforces that too, but sending it explicitly keeps this
* function's output valid on its own.
*
* Measured on the built artifact at the DEFAULT size: 112,713 bytes of body, and
* the upstream counted `prompt_tokens: 25023` at a cost of `credit: 0.72`. The
* body bytes and the credit both scale with the size asked for, which is why the
* size is a user setting: a larger probe answers more truthfully for someone
* whose conversations are long, and costs proportionally more to ask.
*/
function probeRequestBody(modelId, inputTokens = DEFAULT_PROBE_INPUT_TOKENS) {
	const targetChars = Math.ceil(resolveProbeInputTokens(inputTokens) * CHARS_PER_TOKEN);
	const filler = FILLER_LINE.repeat(Math.ceil(targetChars / 45));
	return JSON.stringify({
		model: modelId,
		messages: [{
			role: "system",
			content: PROBE_SYSTEM_PROMPT
		}, {
			role: "user",
			content: `${filler}Reply with a single word.`
		}],
		max_tokens: 1,
		stream: true
	});
}
/**
* Parse a `Retry-After` header value into an absolute time.
*
* Both RFC 9110 forms are accepted: delay-seconds (`120`) and an HTTP-date
* (`Wed, 21 Oct 2026 07:28:00 GMT`). Returns undefined for anything else,
* including the negative/zero delays some gateways emit — a "retry now" is not
* a cooldown and reporting it as one would be worse than saying nothing.
*
* `nowMs` is injected so the delay-seconds branch is testable without a clock.
*/
function parseRetryAfter(value, nowMs) {
	if (value === null) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	if (/^\d+$/u.test(trimmed)) {
		const seconds = Number(trimmed);
		if (!Number.isFinite(seconds) || seconds <= 0) return void 0;
		return nowMs + seconds * 1e3;
	}
	const parsed = Date.parse(trimmed);
	if (Number.isNaN(parsed)) return void 0;
	if (parsed <= nowMs) return void 0;
	return parsed;
}
/**
* The `<timestamp> UTC±N` core of the upstream's reset sentence.
*
* Shared by both spellings below so the two can never drift into accepting
* different timestamps: the offset handling and the calendar round-trip check in
* {@link parseUpstreamResetAt} are what make a parsed value trustworthy, and two
* copies of this shape would be two chances to loosen one of them.
*/
const RESET_STAMP = String.raw`(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?`;
/**
* The upstream's reset sentence, in BOTH spellings this service uses.
*
* Chinese gateway, measured on a live 429 (code 6004), verbatim:
*
*   `您的使用量已超出频率限制，将在 2026-09-30 02:30:30 UTC+8 重置，您也可以切换其他模型继续使用。`
*
* International gateway, measured on the same code over the same account pool,
* verbatim:
*
*   `usage exceeds frequency limit, but don't worry, your usage will reset at
*    2026-10-16 11:34:04 UTC+8, alternatively, you can switch to the other
*    models to continue using it.`
*
* WHY THERE ARE TWO. Each gateway states the time in its own language, and the
* marker sits on a DIFFERENT SIDE of the timestamp: 重置 follows it in Chinese,
* while `reset at` precedes it in English — so one pattern cannot cover both by
* loosening the surrounding prose alone. The original pattern demanded the
* Chinese keyword, so an English body parsed to nothing and the card said
* 「上游未给出何时恢复」 about a message that had just named the exact minute.
*
* That is the honest-absence contract broken in the OTHER direction — not a
* made-up time, but a real time discarded — and it is the worse of the two
* failures, because the account stays excluded on the 30-minute fallback instead
* of the ~18 hours upstream asked for. The pool then returns the account to
* candidacy early and spends a request rediscovering the same 6004.
*
* Both patterns stay deliberately loose about the surrounding prose and strict
* about the parts that must not be guessed: a keyword, the timestamp shape, and
* an explicit UTC offset. A message that merely mentions a reset without a
* parsable offset still yields no time, which remains the honest answer.
*/
const UPSTREAM_RESET_PATTERN_ZH = new RegExp(`将在?\\s*${RESET_STAMP}[\\s\\S]*?重置`, "u");
/**
* The English spelling, anchored on `reset at` / `refresh on` IMMEDIATELY before
* the timestamp — the same strictness as the Chinese pattern, which requires its
* marker immediately after it. A message that mentions a reset somewhere else
* entirely therefore still yields no time.
*/
const UPSTREAM_RESET_PATTERN_EN = new RegExp(`(?:reset|resets|refresh|refreshes)\\s+(?:at|on)\\s+${RESET_STAMP}`, "iu");
/**
* Parse the reset time out of an upstream failure message.
*
* Returns epoch ms, or undefined when the message names no parsable time — the
* caller must then say "the upstream gave no time", never invent one.
*
* THE OFFSET IS HONOURED, NOT ASSUMED. `2026-09-30 02:30:30 UTC+8` is 18:30:30
* UTC the previous day, and `Date.parse` on the bare string would read it as
* LOCAL time — on a machine set to UTC+8 that happens to be right, and on any
* other machine it is silently wrong by the offset. So the components are
* assembled with `Date.UTC` and the stated offset subtracted, which is correct
* on every host regardless of its own zone.
*
* A whole-second resolution is what the upstream prints; sub-second precision
* would be fiction in the other direction.
*/
function parseUpstreamResetAt(message) {
	const match = UPSTREAM_RESET_PATTERN_ZH.exec(message) ?? UPSTREAM_RESET_PATTERN_EN.exec(message);
	if (match === null) return void 0;
	const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
	const offsetTotalMinutes = (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes ?? "0"));
	const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
	const parsed = new Date(utcMs);
	if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day) || parsed.getUTCHours() !== Number(hour) || parsed.getUTCMinutes() !== Number(minute) || parsed.getUTCSeconds() !== Number(second)) return;
	if (Math.abs(offsetTotalMinutes) > 840) return void 0;
	return utcMs - offsetTotalMinutes * 6e4;
}
/**
* The cooldown the upstream stated, if it stated one.
*
* Three sources, in order of authority:
*
* 1. `Retry-After` on the failure response. This is the upstream naming a time
*    for THIS request, so it wins.
* 2. The reset time the upstream writes into its own failure body (see
*    {@link parseUpstreamResetAt}). This is the case that actually fires on
*    this service: a 429 from the Chinese gateway carries code 6004 and a
*    `将在 … 重置` sentence, with no `Retry-After` header at all.
* 3. The region's monthly quota refresh point, but ONLY for an out-of-credit
*    outcome. A quota that resets at a known time is the one case where "when
*    can I use this again" has a real answer even without a header — and it is
*    the answer for the most common real limit on this service.
*
* A limited outcome with none of the three returns `{}`, which the card renders
* as "the upstream did not say when". That remains the honest answer for a
* genuinely timeless failure; inventing a number here would be pure fiction.
*
* An `ok` outcome ALWAYS returns `{}`, whatever headers or body came with it.
* A successful probe has already answered "can this account serve right now?"
* with yes, so there is no wait to state; and on this gateway a 200 can carry a
* `Retry-After` whose value is the account's monthly quota reset, which must
* never be rendered as a lockout. See the guard at the top of the function.
*
* `model-busy` is the ONE exception, and it is not an invented countdown: the
* upstream states a magnitude in prose ("about a minute") rather than a
* timestamp, and the card's own vocabulary has no way to render "about". A
* per-account fallback of 30 minutes is what it used to get, which is both wrong
* about the magnitude and wrong about the scope (issue #56). The returned value
* is {@link MODEL_BUSY_COOLDOWN_MS}, and it is used only to bench the MODEL, never
* an account.
*/
function cooldownOf(input) {
	if (input.outcome === "ok") return {};
	const fromHeader = parseRetryAfter(input.retryAfter, input.nowMs);
	if (fromHeader !== void 0) return {
		retryAtMs: fromHeader,
		retrySource: "retry-after"
	};
	const fromBody = input.body === void 0 ? void 0 : parseUpstreamResetAt(input.body);
	if (fromBody !== void 0) return {
		retryAtMs: fromBody,
		retrySource: "upstream-message"
	};
	if (input.outcome === "out-of-credit" && input.quotaRefreshAtMs !== void 0) return {
		retryAtMs: input.quotaRefreshAtMs,
		retrySource: "quota-refresh"
	};
	if (input.outcome === "model-busy") return {
		retryAtMs: input.nowMs + MODEL_BUSY_COOLDOWN_MS$1,
		retrySource: "upstream-tips"
	};
	return {};
}
/**
* Classify one failed probe into the card's outcome vocabulary.
*
* Built on `classifyUpstreamError` rather than re-testing status codes, so a
* probe and a real chat request can never disagree about what the same upstream
* answer means. The extra splits here are `credential-rejected`, which the
* upstream signals with a non-JSON 401/403 edge page and which needs completely
* different advice (re-auth, not "wait"), `policy-rejected`, a JSON 403
* content-policy refusal where re-auth advice would be actively misleading,
* `model-busy`, the model-scoped 14003 throttle that must NOT be benched as an
* account failure (issue #56), and `channel-rejected`, the gateway's 11128 gate
* on the PROMPT's opening, which no account can change.
*/
function outcomeOfFailure(status, body) {
	if (status === 401 || status === 403) {
		const kind = classifyUpstreamError(status, body);
		if (kind === "policy_reject") return "policy-rejected";
		if (kind === "account_restricted") return "account-restricted";
		return "credential-rejected";
	}
	switch (classifyUpstreamError(status, body)) {
		case "soft_rate": return "rate-limited";
		case "model_busy": return "model-busy";
		case "hard_credit": return "out-of-credit";
		case "session_dead": return "credential-rejected";
		case "account_restricted": return "account-restricted";
		case "channel_reject": return "channel-rejected";
		case "not_found": return "not-found";
		default: return status === 0 || status >= 500 ? "unavailable" : "failed";
	}
}
/**
* Read the credit this probe consumed out of an SSE stream, when the upstream
* reports it.
*
* Purely informational — the card shows it so a user can see how little a probe
* actually costs rather than having to trust a claim. Absent when the stream
* carried no `usage` block.
*/
function creditOfStream(text) {
	const match = /"credit"\s*:\s*(-?[0-9]*\.?[0-9]+)/u.exec(text);
	if (match === null) return void 0;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : void 0;
}
/** Whether a probe outcome means the model answered. */
function probeSucceeded(outcome) {
	return outcome === "ok";
}
/** Max characters of upstream text kept for display, after redaction. */
const PROBE_MESSAGE_LIMIT = 300;
/**
* Redact token-shaped content out of upstream text before it is stored or sent.
*
* Lives here rather than in the route layer because this module is the one that
* reads raw failure bodies, so the redaction belongs at the point of capture. A
* probe failure body is the one place a raw upstream string from an arbitrary
* endpoint enters the plugin's data flow.
*
* EXPORTED because a failed CHAT request now persists its reason into the pool
* store too (`recordAccountFailure` in `src/index.ts`), and that text is a raw
* upstream body as well. One implementation, so the two writers cannot drift
* into redacting differently — the same "one definition" rule this codebase
* applies to `effectiveMembersOf`.
*/
function redactUpstreamText(text) {
	return text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, PROBE_MESSAGE_LIMIT);
}
/**
* Run one probe for one model and reduce it to the card's row.
*
* The successful path drains the SSE stream purely to read the `credit` figure
* the upstream reports, then discards the rest: the question is whether this
* model answers a real-sized request, and `max_tokens: 1` means there is nothing
* else in the stream worth keeping.
*
* Never throws. A probe is a diagnostic the user asked for, so every failure is
* a RESULT — one dead model must not abort the batch and hide the other rows.
*/
async function probeModel(input) {
	let answer;
	const startedAt = Date.now();
	try {
		answer = await input.client.probeChat(input.credential, probeRequestBody(input.modelId, input.inputTokens), input.signal);
	} catch (error) {
		return {
			modelId: input.modelId,
			outcome: "unavailable",
			message: redactUpstreamText(error instanceof Error ? error.message : String(error))
		};
	}
	const elapsedMs = Date.now() - startedAt;
	if (answer.ok) {
		let credit;
		if (answer.response !== void 0) try {
			credit = creditOfStream(await answer.response.text());
		} catch {}
		return {
			modelId: input.modelId,
			outcome: "ok",
			elapsedMs: Date.now() - startedAt,
			status: answer.status,
			...credit === void 0 ? {} : { message: `credit ${credit}` }
		};
	}
	const body = answer.body ?? "";
	const outcome = outcomeOfFailure(answer.status, body);
	return {
		modelId: input.modelId,
		outcome,
		elapsedMs,
		status: answer.status,
		...body === "" ? {} : { message: redactUpstreamText(body) },
		...cooldownOf({
			outcome,
			retryAfter: answer.retryAfter,
			nowMs: input.nowMs,
			body,
			...input.quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs: input.quotaRefreshAtMs }
		})
	};
}
/**
* Smallest spacing between content chunks, in milliseconds, that still counts
* as generation.
*
* Guards the divide-by-zero case where a fast model delivers every token in a
* single burst: `chunks === 1` means the stream told us nothing about the RATE,
* and the run reports no speed rather than an invented one. The same applies
* when the first and last content chunk land in the same millisecond.
*/
const MIN_GENERATION_MS = 1;
/** Build the request body for one speed run. */
function tpsProbeRequestBody(modelId) {
	return JSON.stringify({
		model: modelId,
		messages: [{
			role: "system",
			content: "You are a throughput benchmark. Output a long, uninterrupted sequence of short words separated by spaces. No preamble, no explanation, no code block."
		}, {
			role: "user",
			content: "List the numbers from 1 to 400 in words, separated by single spaces."
		}],
		max_tokens: 256,
		stream: true
	});
}
/**
* Read one SSE stream INCREMENTALLY, timing each content deltas arrival.
*
* The incremental read is the measurement. `response.text()` buffers the whole
* body and hands it over once, which erases the only signal a throughput number
* is made of: the interval between the first and last content chunk. A version of
* this file that parsed a buffered string reported the PARSING time, not the
* generation time, and looked entirely plausible — which is why the reader takes
* the response body and not a string.
*
* Only `choices[0].delta.content` is timed. A reasoning delta is not output:
* counting it would report a reasoning model as fast because it produced a lot of
* private thinking, and reasoning models are precisely the ones where the
* distinction matters.
*
* `startedAt` is the caller's clock reading taken BEFORE the request went out.
* Defaulting it to "now" would turn time-to-first-token into "time to start
* reading" — a plausible-looking number wrong by the whole connect+TTFB.
*
* Never throws on a malformed frame: the upstream is allowed to send comments,
* blank lines and `[DONE]`, and a stream that ends early still reports what it
* timed.
*/
async function readTimedStream(body, startedAt) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	let firstAt;
	let lastAt;
	let usage;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const arrival = Date.now();
			pending += decoder.decode(value, { stream: true });
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const reading = timingsOfLine(line, arrival);
				if (reading.usage !== void 0) usage = reading.usage;
				if (reading.content !== void 0) {
					if (firstAt === void 0) firstAt = arrival;
					lastAt = arrival;
				}
			}
		}
	} catch {} finally {
		reader.cancel().catch(() => {});
	}
	const outputTokens = typeof usage?.["completion_tokens"] === "number" ? usage["completion_tokens"] : void 0;
	const credit = typeof usage?.["credit"] === "number" ? usage["credit"] : void 0;
	return {
		...outputTokens === void 0 ? {} : { outputTokens },
		...firstAt === void 0 ? {} : { firstContentMs: firstAt - startedAt },
		...firstAt === void 0 || lastAt === void 0 ? {} : { generationMs: lastAt - firstAt },
		...credit === void 0 ? {} : { credit }
	};
}
/**
* What one SSE line says: whether it carried content, and any usage frame.
*
* Split out so the frame grammar is testable without a stream. The `arrival`
* timestamp is threaded in by the reader, because a parser that read the clock
* itself would be timing the parse, not the arrival.
*/
function timingsOfLine(line, _arrival) {
	if (!line.startsWith("data:")) return {};
	const payload = line.slice(5).trim();
	if (payload === "" || payload === "[DONE]") return {};
	let frame;
	try {
		frame = JSON.parse(payload);
	} catch {
		return {};
	}
	if (typeof frame !== "object" || frame === null || Array.isArray(frame)) return {};
	const record = frame;
	const usageField = record["usage"];
	const usage = typeof usageField === "object" && usageField !== null && !Array.isArray(usageField) ? usageField : void 0;
	const choices = record["choices"];
	const first = Array.isArray(choices) ? choices[0] : void 0;
	const delta = typeof first === "object" && first !== null ? first["delta"] : void 0;
	const content = typeof delta === "object" && delta !== null ? delta["content"] : void 0;
	return {
		...typeof content === "string" && content !== "" ? { content } : {},
		...usage === void 0 ? {} : { usage }
	};
}
/** The middle value; undefined for an empty list. */
function median(values) {
	if (values.length === 0) return void 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
/**
* Reduce several run readings to one sample.
*
* The median per quantity is taken SEPARATELY rather than picking one "winner"
* run: a run whose stream was truncated may still have timed its first chunk
* honestly, and throwing that away would lose information for no reason. A
* quantity with no usable reading is omitted, never filled in.
*/
function summarizeTps(modelId, runs, attempted) {
	const complete = runs.length === attempted && attempted > 0;
	const speeds = [];
	const firsts = [];
	let outputTokens;
	let credit;
	for (const run of runs) {
		if (run.firstContentMs !== void 0) firsts.push(run.firstContentMs);
		if (run.generationMs !== void 0 && run.generationMs >= MIN_GENERATION_MS && run.outputTokens !== void 0 && run.outputTokens > 0) speeds.push(run.outputTokens / (run.generationMs / 1e3));
		if (run.outputTokens !== void 0) outputTokens = run.outputTokens;
		if (run.credit !== void 0) credit = (credit ?? 0) + run.credit;
	}
	const tokensPerSecond = median(speeds.map((speed) => Math.round(speed)));
	const reason = tokensPerSecond !== void 0 ? void 0 : runs.length === 0 ? "all-failed" : outputTokens === void 0 ? "no-usage" : "few-chunks";
	return {
		modelId,
		...tokensPerSecond === void 0 ? {} : { tokensPerSecond },
		...outputTokens === void 0 ? {} : { outputTokens },
		...median(firsts) === void 0 ? {} : { timeToFirstTokenMs: median(firsts) },
		samples: runs.length,
		...credit === void 0 ? {} : { credit: Math.round(credit * 100) / 100 },
		complete,
		...reason === void 0 ? {} : { reason }
	};
}
/**
* Measure one model's output speed.
*
* Runs {@link TPS_PROBE_RUNS} times and takes per-quantity medians (see
* {@link summarizeTps} for why a median and not a mean). A failed run is dropped
* rather than counted as zero — a model that answered twice at 400 tok/s did not
* get slower because the third request timed out — but the sample count records
* the shortfall so the card can say "n/3".
*
* Never throws: this is a diagnostic the user asked for, and a dead model must
* produce a result row, not an exception.
*/
async function measureTps(input) {
	const runs = input.runs ?? 3;
	const readings = [];
	for (let index = 0; index < runs; index++) {
		if (input.signal?.aborted === true) break;
		const startedAt = Date.now();
		try {
			const answer = await input.client.probeChat(input.credential, tpsProbeRequestBody(input.modelId), input.signal);
			if (!answer.ok || answer.response === void 0) continue;
			readings.push(await readTimedStream(answer.response.body, startedAt));
		} catch {
			continue;
		}
	}
	return summarizeTps(input.modelId, readings, runs);
}
/**
* Check in every account, one at a time.
*
* Idempotent by design (see the module note): an account already checked in
* today is reported as `already` and NO write is attempted. A failure on one
* account is recorded on that row and the batch continues.
*
* Never throws: every problem becomes a row, because a batch that aborted on
* its first bad account would hide the state of all the others.
*/
async function checkinAllAccounts(targets, deps, nowMs = Date.now) {
	const rows = [];
	let issued = 0;
	for (const target of targets) {
		if (target.enterprise === true) {
			rows.push({
				accountId: target.accountId,
				accountName: target.accountName,
				status: "skipped",
				message: "enterprise accounts have no daily check-in"
			});
			continue;
		}
		if (issued > 0) await (deps.wait ?? defaultWait)(400);
		issued += 1;
		rows.push(await checkinOne(target, deps));
	}
	return rows;
}
/** One account's check-in, reduced to its row. */
async function checkinOne(target, deps) {
	const base = {
		accountId: target.accountId,
		accountName: target.accountName
	};
	let credential;
	try {
		credential = await deps.credentialFor(target.accountId);
	} catch (error) {
		return {
			...base,
			status: "failed",
			message: messageOf$1(error)
		};
	}
	if (credential === void 0) return {
		...base,
		status: "failed",
		message: "no stored credential for this account"
	};
	try {
		const status = await deps.fetchCheckinStatus(credential);
		if (!status.active) return {
			...base,
			status: "failed",
			message: "check-in activity is not active"
		};
		if (status.todayCheckedIn) return {
			...base,
			status: "already"
		};
		const claim = await deps.claimDailyCheckin(credential);
		return {
			...base,
			status: "claimed",
			credit: claim.credit,
			streakDays: claim.streakDays
		};
	} catch (error) {
		return {
			...base,
			status: "failed",
			message: messageOf$1(error)
		};
	}
}
/**
* Test every account against one model, one at a time.
*
* The model is resolved by the caller (see `resolveTargetModel`) so this
* function never has to decide "free or not" — an unresolvable target is the
* caller's problem to report, and testing against a model nobody chose would be
* exactly the silent spend the plan forbids.
*
* Never throws: a failed probe is a ROW, not an aborted batch.
*
* `onRow` fires the moment one account's row exists, which is what lets a caller
* report progress. The loop is SERIAL by design (one account at a time — hitting
* the whole pool at once is the fastest way to trip the upstream's volume limit),
* so without this a caller cannot say anything until the SLOWEST member answers:
* one stuck account made a working batch look like a dead button. The return
* value is unchanged, so every existing caller keeps all rows at the end.
*/
async function testAllAccounts(targets, modelId, deps, onRow) {
	const rows = [];
	for (const [index, target] of targets.entries()) {
		if (index > 0) await (deps.wait ?? defaultWait)(400);
		const row = await testOne(target, modelId, deps);
		rows.push(row);
		onRow?.(row);
	}
	return rows;
}
/** One account's probe, reduced to its row. */
async function testOne(target, modelId, deps) {
	const base = {
		accountId: target.accountId,
		accountName: target.accountName
	};
	let credential;
	try {
		credential = await deps.credentialFor(target.accountId);
	} catch (error) {
		return {
			...base,
			result: {
				modelId,
				outcome: "credential-rejected",
				message: messageOf$1(error)
			}
		};
	}
	if (credential === void 0) return {
		...base,
		result: {
			modelId,
			outcome: "credential-rejected",
			message: "no stored credential for this account"
		}
	};
	return {
		...base,
		result: await deps.probe(credential, modelId)
	};
}
/**
* Turn a test batch's rows into the per-account measurements to remember.
*
* A row is stored only when the probe actually measured the MODEL. A row that
* failed because the credential could not even be read says nothing about the
* model, and recording it would exclude a possibly-perfect account from the
* pool — so those accounts keep their previous measurement instead.
*
* `atMs` is stamped here, once for the batch, so the card's "tested N minutes
* ago" reflects when the batch finished rather than drifting per row.
*
* `message` is carried through as well. `probeModel` already redacted it before
* returning, so persisting it cannot leak a token, and without it the pool table
* could only repeat one generic sentence for a DNS failure, a gateway 502 and a
* cancelled request alike.
*/
function probeUpdatesOf(rows) {
	const atMs = Date.now();
	const updates = {};
	for (const row of rows) {
		if (isTransportFailure(row.result)) continue;
		updates[row.accountId] = {
			outcome: row.result.outcome,
			atMs,
			source: "test-batch",
			modelId: row.result.modelId,
			...row.accountName === "" ? {} : { accountName: row.accountName },
			...row.result.retryAtMs === void 0 ? {} : { retryAtMs: row.result.retryAtMs },
			...row.result.message === void 0 ? {} : { message: row.result.message }
		};
	}
	return updates;
}
/**
* Whether a probe result measures the transport rather than the model.
*
* `credential-rejected` with the pool's own "no stored credential" message is
* the one case we can attribute to ourselves rather than the upstream: the
* request never left. Every other rejection came from the upstream and IS a
* statement about this account, so it is kept.
*/
function isTransportFailure(result) {
	return result.outcome === "credential-rejected" && result.message?.startsWith("no stored credential") === true;
}
/** The default inter-account pause. */
function defaultWait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
/** A safe message from an unknown throwable, bounded in length. */
function messageOf$1(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
//#endregion
//#region src/account-pool.ts
/**
* How long an account stays out of the pool when the upstream stated no time.
*
* A conservative FALLBACK, not a measurement: it applies whenever a failed
* outcome carries no `retryAtMs`, which is every rate limit that came without a
* reset sentence AND every transient failure (a transport error, a 5xx). In both
* cases "when can I use this again" has no honest answer.
*
* The two failure directions it avoids: keeping the account in the pool would
* re-bill it immediately and re-trip the same limit; dropping it FOREVER would
* discard a working account over an event that said nothing about it. A short,
* stated cooldown is the least-wrong of the two — and it is what lets the pool
* heal itself, since nothing else re-probes an excluded member.
*/
const POOL_UNKNOWN_COOLDOWN_MS = 18e5;
/**
* Whether one account can be billed at `nowMs`.
*
* Returns the exclusion reason, or undefined when the account is a candidate.
* The order matters and is NOT arbitrary:
*
* - A `credential-rejected` account is excluded regardless of any cooldown: its
*   token is not accepted, so waiting cannot help and the user must re-auth.
* - A limited, unreachable or failed outcome is checked against its stated (or
*   fallback) cooldown, so an account whose limit has already reset — or whose
*   gateway blipped once — is back in the pool without needing another test
*   first.
* - An `ok` measurement, and no measurement at all, are both candidates. The
*   latter matters: a freshly discovered account has never been tested and must
*   not be invisible.
*
* WHY TRANSIENT OUTCOMES GET A COOLDOWN. They are not statements about the
* ACCOUNT. A transport failure can be a DNS blip, and — before the shim learned
* to skip reporting an aborted request — it was routinely the user closing the
* panel mid-flight. A 5xx is the gateway's afternoon, not this account's health.
* Excluding them permanently meant one transient event idled a perfectly good
* account until the user happened to press "test" again, and with every member
* so idled the pool had no candidate at all: failover then had nowhere to go and
* the raw upstream error was reported as-is. The cooldown is what makes the pool
* RECOVER instead of staying broken.
*
* `not-found` and `credential-rejected` deliberately get none: one describes a
* model the region no longer offers (a catalog fact, not a transient one) and
* the other needs the user to sign in again. Neither is fixed by waiting, and
* pretending otherwise would re-bill a token the upstream has already refused.
*
* Each unusable outcome keeps its OWN value rather than being folded into
* `credential-rejected`. The fold made one row state two contradictory things —
* the name column said "被拒绝" (sign in again) while the probe column, reading
* the same measurement, said "连不上上游——这是网络问题，不是模型问题" — and it
* told a user whose upstream had merely blipped that their sign-in was bad.
* (That label has since been made cause-NEUTRAL: it used to assert "not the
* model" for a bucket that also holds gateway 5xx and request timeouts, where
* the claim is simply unfounded. The recorded `message` now carries the cause.)
* The distinctions are already computed upstream in `outcomeOfFailure`
* (`src/probe.ts:290-299`); this only stops discarding them.
*/
function exclusionOf(probe, nowMs) {
	if (probe === void 0) return void 0;
	switch (probe.outcome) {
		case "ok": return;
		case "credential-rejected": return "credential-rejected";
		case "account-restricted": return "account-restricted";
		case "not-found": return "not-found";
		case "unavailable": return retryDue(probe, nowMs) ? void 0 : "unavailable";
		case "failed": return retryDue(probe, nowMs) ? void 0 : "failed";
		case "rate-limited": return retryDue(probe, nowMs) ? void 0 : "rate-limited";
		case "model-busy": return retryDue(probe, nowMs, 12e4) ? void 0 : "model-busy";
		case "out-of-credit": return retryDue(probe, nowMs) ? void 0 : "out-of-credit";
		case "policy-rejected": return;
		case "channel-rejected": return;
		default: return "unusable";
	}
}
/**
* Whether an account's cooldown has elapsed (or was never stated).
*
* The fallback is the ONLY thing a transient outcome relies on: `cooldownOf`
* attaches `retryAtMs` for a rate limit or a drained quota, never for a
* transport failure, so `atMs + POOL_UNKNOWN_COOLDOWN_MS` is what brings those
* back. That is deliberate — the alternative is a permanent exclusion decided by
* an event that said nothing about the account.
*
* `fallbackMs` lets one outcome carry a SHORTER clock than the generic one: the
* model-scoped throttle is upstream's own "about a minute", and applying the
* half-hour account fallback to it is issue #56. It is a parameter rather than a
* second function so every outcome keeps sharing one definition of "due".
*/
function retryDue(probe, nowMs, fallbackMs = POOL_UNKNOWN_COOLDOWN_MS) {
	return nowMs >= (probe.retryAtMs ?? probe.atMs + fallbackMs);
}
/**
* Rank a pool's members best-first.
*
* The rule, in priority order — this is the whole feature:
*
* 1. **Usability.** Only accounts that can be billed right now are candidates;
*    they always outrank every excluded one.
* 2. **Expiring credits first, soonest first.** Points about to expire are
*    worth exactly zero after they do, so spending them before they lapse is
*    strictly better than saving them.
* 3. **User's manual order.** When the user has hand-ordered the pool (see
*    `orderAccountIds`), that order breaks ties among accounts that are equal
*    on the keys above AND below. It is the one place the user's own preference
*    influences "who serves next": the manual picker on the card drags these
*    ids into place, and the ranking honors the result.
*    WHY EXPIRY STILL OUTRANKS THE MANUAL ORDER: this rule sits strictly BELOW
*    the at-risk flag (rule #2), so an account with ANY expiring credits always
*    beats the manual order even when the user dragged it to the bottom. That
*    is deliberate (issue #70): a manual order that is unsaved, stale, or
*    sloppily edited must never cause credits to lapse unspent — expiring
*    credits are real money about to vanish, while the manual order is just a
*    preference that might be wrong. This is not a bug, and a test pins it.
* 4. **Largest expiring amount.** Between two accounts that both have expiring
*    points, the one with more at risk goes first.
* 5. **Credits, highest first.** Among accounts with nothing expiring, spend the
*    one with the most, so a nearly-drained account is conserved.
* 6. **Freshest credential.** Tie-break so a stale token never wins a draw.
* 7. **Account id.** Final tie-break, making the order TOTAL: two accounts
*    equal on every ranking key would otherwise keep the caller's array order,
*    so the same pool could rotate differently between two runs.
*
* WHY EXPIRY OUTRANKS SIZE (issue #70). These used to be strict lexicographic
* keys: total, THEN expiry. Since totals are almost never exactly equal, the
* expiry rule was unreachable — a live report had an account with 196 points
* lapsing that day ranked LAST, behind two accounts that expire weeks later,
* simply because it held ~1,200 fewer points overall. It was never selected, so
* the 196 points always lapsed. A "use it or lose it" rule that another rule
* completely shadows is not a tie-break, it is dead code.
*
* WHY SPENDING THE SMALL EXPIRING ACCOUNT IS STILL RIGHT. Ordering by expiry
* does mean an account with 1 point lapsing outranks one holding 50,000. That
* looks wrong and is not: credits are fungible, so using the rich account
* instead does not preserve the 1 point — it spends the 1 point's chance and
* loses it. Using the expiring account spends a point that was going to be lost
* anyway, and the rich account is still there for the next request. The only
* real cost is a failover round-trip if the expiring account cannot cover a
* whole request, which the exclusion/failover path already absorbs. Ordering by
* total instead loses the expiring points with certainty.
*
* Excluded accounts are still RETURNED (sorted after the candidates) so the
* card can explain why each is out; they differ from candidates by
* `excludedBy` being set on them, never by being silently dropped.
*
* Pure and total: the same input always yields the same order, and it never
* throws on missing data (an account with no credits is ranked as 0, not
* crashed on).
*/
function rankPool(members, nowMs, orderAccountIds) {
	const order = /* @__PURE__ */ new Map();
	for (const [index, id] of (orderAccountIds ?? []).entries()) if (!order.has(id)) order.set(id, index);
	const rows = members.map((member) => {
		const excludedBy = exclusionOf(member.probe, nowMs);
		return {
			account: member.account,
			score: scoreOf(member),
			...excludedBy === void 0 ? {} : { excludedBy },
			_usable: excludedBy === void 0,
			_order: order.get(member.account.id) ?? Number.POSITIVE_INFINITY,
			_atRisk: (member.credits?.expiringSoon ?? 0) > 0,
			_expiringAmount: member.credits?.expiringSoon ?? 0,
			_expiring: member.credits?.nearestExpiryMs ?? Number.POSITIVE_INFINITY,
			_tokenExpiresAtMs: member.tokenExpiresAtMs ?? 0
		};
	});
	rows.sort((left, right) => {
		if (left._usable !== right._usable) return left._usable ? -1 : 1;
		if (left._atRisk !== right._atRisk) return left._atRisk ? -1 : 1;
		if (left._order !== right._order) return left._order - right._order;
		if (left._atRisk && right._atRisk && left._expiring !== right._expiring) return left._expiring - right._expiring;
		if (left._expiringAmount !== right._expiringAmount) return right._expiringAmount - left._expiringAmount;
		if (left.score !== right.score) return right.score - left.score;
		if (left._tokenExpiresAtMs !== right._tokenExpiresAtMs) return right._tokenExpiresAtMs - left._tokenExpiresAtMs;
		return left.account.id < right.account.id ? -1 : left.account.id > right.account.id ? 1 : 0;
	});
	return rows.map(({ account, score, excludedBy }) => ({
		account,
		score,
		...excludedBy === void 0 ? {} : { excludedBy }
	}));
}
/**
* The checked ids that still resolve to a local sign-in, in the caller's order.
*
* This is THE definition of "effective members", and it exists because the same
* predicate was written five separate times: the status document
* (`web-status.ts`), the batch route's empty-pool guard, the Host dependency the
* card reads, `poolMemberAccounts` and the browser helper. Five copies of one
* rule is this project's single most productive bug shape ("fixed one end,
* missed the other"), so the rule now has one home and every site delegates to
* it.
*
* ORDER IS THE CALLER'S, and comes from `orderedIds`: the answer preserves the
* order of THAT argument. Callers pass whichever list's order they want to show
* — the saved list for the user's own order, the store's roster for the account
* table's. Neither is silently reshuffled by the filter. (The first parameter was
* once named `saved`, which read as "this must be the saved list" even though
* `web-status.ts` legitimately passes the roster for store order; the name was
* the trap, so it now describes the ROLE instead of the source.)
*
* Pure, so it is unit-testable without a store, and it never mutates its input.
*/
function effectiveMembersOf(orderedIds, listedIds) {
	return orderedIds.filter((id) => listedIds.has(id));
}
/**
* The credit figure used for ordering.
*
* Absent credits rank as zero. Deliberately NOT "unknown ranks first": an
* account whose balance could not be read must never outrank one we positively
* know is full, or a failing credits route would capture all the traffic.
*/
function scoreOf(member) {
	return member.credits?.total ?? 0;
}
/**
* Pick the free model to test against, from one region's catalog.
*
* "Free" means `creditMultiplier === 0` EXACTLY. An absent multiplier is NOT
* free — see the module note: the CN static fallback carries no multiplier at
* all, so treating absence as zero would silently bill real credits.
*
* Among the free candidates the LARGEST context window wins, because the probe
* sends a real-sized payload (25k input) and a long-conversation probe is the
* point: a small-window model would either reject it or answer a question the
* user never asked.
*
* Returns undefined when the region has no free model, which the caller must
* render as "none available" — never as a fallback to a paid model.
*/
function pickFreeModel(catalog) {
	let best;
	for (const model of catalog) {
		if (model.creditMultiplier !== 0) continue;
		if (best === void 0 || model.contextWindow > best.contextWindow) best = model;
	}
	return best;
}
/**
* Resolve the model the pool should test against.
*
* A user-specified id always wins (it is a preference, not a computed default),
* and is returned even when it is a PAID model: the card says so explicitly
* rather than silently overriding the user's choice.
*
* But the choice is now VALIDATED against the region's catalog, because the
* catalog changes: the CN roster is empty until its first refresh, and models
* come and go. A saved id that is no longer offered used to be returned as
* `preferred`, which let the card enable its test button and the Host run a
* batch against a model nobody offers. It is reported as `stale` instead —
* never silently replaced by the free model (that would test something the
* user did not choose) and never run.
*
* A catalog that has not loaded yet therefore reads as `stale` for a saved id.
* That is the safe direction: no credits are spent while the roster is unknown,
* and the card offers to switch back to automatic.
*/
function resolveTargetModel(catalog, preferredId) {
	if (preferredId !== void 0 && preferredId !== "") return catalog.some((model) => model.id === preferredId) ? {
		modelId: preferredId,
		source: "preferred"
	} : {
		staleModelId: preferredId,
		source: "stale"
	};
	const free = pickFreeModel(catalog);
	return free === void 0 ? { source: "none" } : {
		modelId: free.id,
		source: "free"
	};
}
//#endregion
//#region src/oauth.ts
/**
* OAuth QR sign-in: add a WorkBuddy account by scanning a code, without the
* desktop app.
*
* 参考：WorkBuddy OAuth 采集的通行实现（对照官网 cockpit 的
*   `oauth_start` / `oauth_poll`）：
*   向 `{billing_base}{API_PREFIX}/auth/state?platform={platform}` 申请一个
*   state，用户在浏览器打开授权页完成登录，客户端轮询
*   `{billing_base}{API_PREFIX}/auth/token?state={state}` 换取凭据，再以
*   Bearer 调 `{API_PREFIX}/login/account` 拉取账号资料。三步的 URL 形态、
*   响应字段双拼写（camelCase/snake_case）容错、以及「区域必须绑定会话」的
*   约定均沿用该实现。
* 改动：端点按本插件 `upstream.ts` 的区域约定路由 —— CN 为
*   `https://www.codebuddy.cn`；国际版按凭据域分家（`workbuddy.ai` 与
*   `codebuddy.ai` 两把钥匙各自签发，混用会被网关拒绝），插件发起登录时
*   还没有凭据，因此由用户显式传基址，缺省 `https://www.workbuddy.ai`。
*   登录结果不落独立账号库，而是交给宿主写入统一凭据库（`src/auth.ts` 的
*   vault），与桌面端扫描到的账号共用一套发现/选择/刷新机制。
*
* 会话状态只在进程内（`LoginSession`）：PKCE 类 state 与登录进度不落盘，
* 拿到凭据即终结。刷新凭据仍走 `refreshToken`（上游 refresh 端点），此处
* 只负责首次取凭据。
*
* @module dsh-connect-workbuddy/oauth
*/
/** The CN billing base; matches `upstream.ts`'s CN_BILLING_BASE. */
const CN_BILLING_BASE = "https://www.codebuddy.cn";
/** Default international base; the desktop app's gateway. */
const GLOBAL_BILLING_BASE = "https://www.workbuddy.ai";
/** Upstream plugin API prefix shared by both regions. */
const API_PREFIX = "/v2/plugin";
/** In-process session map. Deliberately not persisted: a restart cancels. */
const sessions = /* @__PURE__ */ new Map();
/**
* The billing base a login for `region` should start from.
*
* CN is single-homed. The international product signs in through either of
* two brand domains (see `upstream.ts` `globalBase`); the caller may pin
* one with `explicitBase` — a token issued at one domain is refused by the
* other, so the choice must be made BEFORE the state is issued, not after.
*/
function oauthBillingBase(region, explicitBase) {
	if (region === "cn") return CN_BILLING_BASE;
	const trimmed = explicitBase?.trim();
	if (trimmed !== void 0 && trimmed !== "") return normalizeBase(trimmed);
	return GLOBAL_BILLING_BASE;
}
/** trim + strip one trailing slash; no scheme invented (see upstream.ts). */
function normalizeBase(base) {
	return base.trim().replace(/\/+$/, "");
}
/**
* Start one login: ask the upstream for a state and return the URL the user
* opens to scan/confirm. The session is bound to `region` AND `base`;
* both are checked on every poll.
*
* Never throws for an upstream refusal — the error becomes the returned
* `error` — because the card renders the reason inline rather than through
* an exception path.
*/
async function oauthStart(region, options) {
	const base = normalizeBase(oauthBillingBase(region, options?.base));
	const doFetch = options?.fetchImpl ?? fetch;
	let response;
	try {
		response = await doFetch(`${base}${API_PREFIX}/auth/state?platform=workbuddy`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json"
			},
			body: "{}",
			signal: AbortSignal.timeout(3e4)
		});
	} catch (error) {
		return { error: `could not reach ${base} to start the sign-in (${messageOf(error)})` };
	}
	const document = await readJson(response);
	if (document === void 0) return { error: `the sign-in service answered with a non-JSON body (http ${response.status})` };
	const data = envelopeData(document);
	const state = firstString(data, ["state", "State"]);
	if (state === "") return { error: `the sign-in service did not issue a state (http ${response.status})` };
	const authUrl = firstString(data, [
		"authUrl",
		"auth_url",
		"url",
		"Url"
	]) || `${base}/login?state=${encodeURIComponent(state)}`;
	const loginId = `wbo_${randomUUID().replaceAll("-", "")}`;
	sessions.set(loginId, {
		region,
		base,
		state,
		expiresAtMs: Date.now() + 6e5,
		done: false
	});
	return {
		loginId,
		verificationUri: authUrl,
		expiresIn: 600
	};
}
/**
* Poll once for a login's outcome.
*
* Ordering matters and mirrors the reference implementation: the session's
* region/base binding is checked BEFORE any I/O, so a poll that names the
* wrong tab never reaches the network, and an unknown id fails without a
* request too.
*/
async function oauthPoll(loginId, region, options) {
	const session = sessions.get(loginId);
	if (session === void 0) return {
		done: true,
		error: "sign-in session not found; start a new one"
	};
	if (session.region !== region) return {
		done: true,
		error: "sign-in session belongs to another region tab"
	};
	if (session.done) return terminalOf(session);
	if (Date.now() > session.expiresAtMs) {
		session.done = true;
		session.error = "the sign-in timed out; start again";
		sessions.delete(loginId);
		return {
			done: true,
			error: session.error
		};
	}
	const doFetch = options?.fetchImpl ?? fetch;
	let response;
	try {
		response = await doFetch(`${session.base}${API_PREFIX}/auth/token?state=${encodeURIComponent(session.state)}`, {
			method: "GET",
			headers: { "Accept": "application/json" },
			signal: AbortSignal.timeout(3e4)
		});
	} catch {
		return { done: false };
	}
	const document = await readJson(response);
	if (document === void 0) return { done: false };
	const code = typeof document["code"] === "number" ? document["code"] : -1;
	if (code !== 0 && code !== 200) return { done: false };
	const data = envelopeData(document);
	const accessToken = firstString(data, [
		"accessToken",
		"access_token",
		"AccessToken"
	]);
	if (accessToken === "") return { done: false };
	session.done = true;
	try {
		const account = await collectAccount(session, accessToken, data, doFetch);
		sessions.delete(loginId);
		return {
			done: true,
			account
		};
	} catch (error) {
		session.error = messageOf(error);
		sessions.delete(loginId);
		return {
			done: true,
			error: session.error
		};
	}
}
/** Terminal view of a session, for a poll that arrives after completion. */
function terminalOf(session) {
	if (session.result !== void 0) return {
		done: true,
		account: session.result
	};
	return {
		done: true,
		error: session.error ?? "the sign-in ended without a result"
	};
}
/** Fetch the account profile and assemble the success value. */
async function collectAccount(session, accessToken, tokenData, doFetch) {
	const headers = {
		"Authorization": `Bearer ${accessToken}`,
		"Accept": "application/json"
	};
	const domain = firstString(tokenData, ["domain", "Domain"]);
	if (domain !== "") headers["X-Domain"] = domain;
	let profile = {};
	try {
		const document = await readJson(await doFetch(`${session.base}${API_PREFIX}/login/account`, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(3e4)
		}));
		if (document !== void 0) profile = envelopeData(document);
	} catch {}
	const uid = firstString(profile, [
		"uid",
		"Uid",
		"userId",
		"UserID"
	]);
	const nickname = optionalString(profile, [
		"nickname",
		"NickName",
		"nickname",
		"ScreenName"
	]);
	const uin = optionalString(profile, ["uin", "Uin"]);
	const enterpriseId = optionalString(profile, ["enterpriseId", "EnterpriseId"]);
	const expiresAtMs = expiryMs(tokenData, ["expiresAt", "expires_at"], ["expiresIn", "expires_in"]) ?? 0;
	const refreshExpiresAtMs = expiryMs(tokenData, ["refreshExpiresAt", "refresh_expires_at"], ["refreshExpiresIn", "refresh_expires_in"]);
	return {
		accessToken,
		refreshToken: firstString(tokenData, [
			"refreshToken",
			"refresh_token",
			"RefreshToken"
		]),
		expiresAtMs,
		...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
		domain: domain !== "" ? domain : firstString(profile, ["domain", "Domain"]),
		uid,
		...nickname === void 0 ? {} : { nickname },
		...uin === void 0 ? {} : { uin },
		...enterpriseId === void 0 ? {} : { enterpriseId }
	};
}
/** Parse a JSON body; undefined for non-JSON (the caller decides severity). */
async function readJson(response) {
	try {
		const text = await response.text();
		const parsed = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
	} catch {}
}
/** The envelope's `data` object; a non-object data is an empty one. */
function envelopeData(document) {
	const data = document["data"];
	return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}
/** First non-empty string among `keys`, else ''. */
function firstString(source, keys) {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "string" && value.trim() !== "") return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	return "";
}
/** First non-empty string among `keys`, else undefined. */
function optionalString(source, keys) {
	const value = firstString(source, keys);
	return value === "" ? void 0 : value;
}
/**
* An expiry field that may arrive as an absolute timestamp (s or ms) or as a
* relative TTL in seconds — the same tolerance `auth.ts` `expiryToMs` and
* the reference implementation's `norm_ts` apply.
*/
function expiryMs(source, absoluteKeys, ttlKeys) {
	for (const key of absoluteKeys) {
		const value = source[key];
		if (typeof value === "number" && value > 0) return value > 0xe8d4a51000 ? value : value * 1e3;
		if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
			const parsed = Number(value);
			return parsed > 0xe8d4a51000 ? parsed : parsed * 1e3;
		}
	}
	for (const key of ttlKeys) {
		const value = source[key];
		if (typeof value === "number" && value > 0) return Date.now() + value * 1e3;
	}
}
/** Human message from a thrown error, for the card's inline display. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/transfer.ts
/**
* Account transfer: the export / import file format shared with sibling
* credential managers for the same upstream.
*
* 参考：通行实现 —— 文件是一个 JSON 数组，每项为一条凭据记录，顶层字段
*   snake_case（`access_token` / `refresh_token` / `uid` / `nickname` /
*   `email` / `domain` / `expiresAt`(ms) / `refreshExpiresAt` / `auth_raw`），
*   导入按 `uid` 去重（同 uid 覆盖），缺 `access_token` 的记录跳过；预览只
*   回脱敏字段（含 `hasToken` 布尔量），不回明文。解析函数不依赖文件系统，
*   便于无 UI 环境单测；落库由 Host 侧的 store 完成。
* 互通：`expiresAt` 一族按契约是**毫秒**（由 auth_raw 的原始认证文档携带）；
*   本插件的 vault 文档 `expiresAt` 是秒 —— 换算只发生在导出/导入边界。
*   导出时 `auth_raw` 直接携带本插件 vault 文档的 `{auth, account}` 双键块，
*   与桌面认证文件同构，供写入桌面认证文件的工具原样消费。
*
* @module dsh-connect-workbuddy/transfer
*/
/**
* Parse transfer-file text: a JSON array, every element an object.
*
* The error strings carry the position (1-based item number) because a file
* from another tool can be big, and "第 N 项" is what lets the user find the
* broken record in their editor.
*/
function parseTransferFile(text) {
	if (text.trim() === "") throw new Error("transfer file is empty");
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error("transfer file is not valid JSON: " + (error instanceof Error ? error.message : String(error)));
	}
	if (!Array.isArray(parsed)) throw new Error("transfer file must be a JSON array of account records");
	for (const [index, item] of parsed.entries()) if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("transfer file item " + (index + 1) + " is not an account object");
	return parsed;
}
/** One string field of a record, tolerating the sibling format's odd shapes. */
function displayString(value) {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}
/** Whether a record carries a usable token, envelope-shaped or plain. */
function hasToken(record) {
	const token = record["access_token"];
	return typeof token === "string" && token !== "";
}
/**
* The transfer file's desensitized preview: display fields only.
*
* Fields come from EXTERNAL files, so a display field may hold an object or an
* array (a sibling tool can store the desktop app's encrypted-wrapper nickname
* verbatim); every preview field is normalized to a string or emptied rather
* than letting a non-renderable value reach the card.
*/
function previewTransferFile(text) {
	const records = parseTransferFile(text);
	return {
		accounts: records.map((record, index) => ({
			index,
			uid: displayString(record["uid"]),
			nickname: displayString(record["nickname"]),
			email: displayString(record["email"]),
			hasToken: hasToken(record)
		})),
		total: records.length
	};
}
/**
* Project one vault credential into the shared transfer record shape.
*
* `expiresAt` is emitted in MILLISECONDS — the transfer contract's unit and
* the sibling tools' display field — while the vault document stores seconds.
* `auth_raw` carries the vault's nested `{auth, account}` document so a tool
* that writes desktop auth files can consume it verbatim.
*/
function transferRecordOf(credential, vaultDocument) {
	return {
		access_token: credential.accessToken,
		...credential.refreshToken !== "" ? { refresh_token: credential.refreshToken } : {},
		...credential.uid !== "" ? { uid: credential.uid } : {},
		...credential.nickname !== void 0 ? { nickname: credential.nickname } : {},
		...credential.domain !== "" ? { domain: credential.domain } : {},
		...credential.expiresAtMs > 0 ? { expiresAt: credential.expiresAtMs } : {},
		...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAt: credential.refreshExpiresAtMs },
		auth_raw: vaultDocument
	};
}
/**
* Recover `uin` from a record's `auth_raw` document.
*
* `uin` is the billing identity the account id derives from
* (`uin ?? uid ?? nickname`), but it is NOT one of the transfer format's
* contract fields — sibling exports carry it only inside `auth_raw`
* (the original auth document, whose `account` object holds it). Restoring it
* is what makes an exported-and-re-imported account converge on the SAME
* vault id instead of duplicating under a uid-derived id. Both document
* shapes are honored: the nested `{auth, account}` block this plugin
* exports, and a record whose `auth_raw.account` came straight from a
* desktop file.
*/
function uinOfRaw(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const root = raw;
	const uin = displayString((typeof root["account"] === "object" && root["account"] !== null ? root["account"] : root)["uin"]);
	return uin === "" ? void 0 : uin;
}
/**
* Project one transfer record into a vault credential, or undefined when the
* record carries no token (the importer's skip rule).
*
* `uid` empty is tolerated at THIS layer because a token-only record still
* describes a usable credential; the Host's region gate and the store's
* account id (`uin ?? uid ?? nickname`) decide whether it is representable.
* An unopenable `auth_raw` is ignored — the flat fields above are the
* contract, `auth_raw` is extra fidelity for the write-back path.
*/
function credentialOfTransferRecord(record) {
	const accessToken = record["access_token"];
	if (typeof accessToken !== "string" || accessToken === "") return void 0;
	const refreshToken = typeof record["refresh_token"] === "string" ? record["refresh_token"] : "";
	const expiresAtMs = typeof record["expiresAt"] === "number" && Number.isFinite(record["expiresAt"]) && record["expiresAt"] > 0 ? record["expiresAt"] : 0;
	const refreshExpiresAtMs = typeof record["refreshExpiresAt"] === "number" && Number.isFinite(record["refreshExpiresAt"]) && record["refreshExpiresAt"] > 0 ? record["refreshExpiresAt"] : void 0;
	const uin = uinOfRaw(record["auth_raw"]);
	return {
		accessToken,
		refreshToken,
		expiresAtMs,
		...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
		domain: typeof record["domain"] === "string" ? record["domain"] : "",
		uid: displayString(record["uid"]),
		...record["nickname"] !== void 0 ? { nickname: displayString(record["nickname"]) } : {},
		...uin === void 0 ? {} : { uin }
	};
}
/**
* Pure merge: fold selected records into a CHANGES map keyed by account id.
*
* Mirrors the sibling merger's contract: a record with the same account id
* OVERWRITES the stored entry (the imported tokens replace what is stored —
* re-importing a re-login must refresh it; the write layer stores the record
* atomically, so "overwrite" needs no knowledge of the incumbent), and a
* record without a token is skipped. The region gate lives HERE rather than
* in the route so it is testable without a Host: a record whose login domain
* maps to the other region's tab is skipped, because the two regions'
* providers are parallel stacks and a cross-region import would cross-bill.
*
* The caller writes one vault file per map entry, so a selection that is
* already stored rewrites those files with identical content — idempotent,
* and the steady state of importing the same file twice.
*/
function mergeTransferRecords(records, indexes, region, knownRegionOfDomain) {
	const changes = /* @__PURE__ */ new Map();
	let imported = 0;
	let skipped = 0;
	for (const index of indexes) {
		const record = records[index];
		if (record === void 0) {
			skipped += 1;
			continue;
		}
		const credential = credentialOfTransferRecord(record);
		if (credential === void 0) {
			skipped += 1;
			continue;
		}
		if (knownRegionOfDomain(credential.domain) !== region) {
			skipped += 1;
			continue;
		}
		const id = workbuddyAccountId(credential);
		changes.set(id, credential);
		imported += 1;
	}
	return {
		changes,
		imported,
		skipped
	};
}
//#endregion
//#region src/account-pool-store.ts
/**
* The account pool's RUNTIME store: measured facts, on disk, outside settings.
*
* 参考：本仓库 `src/auth.ts` 的插件自有文件约定（`$DSH_HOME` 下的
*   `.workbuddy-auth.<region>.json`，`withFileLock` + `writeFileAtomic`，
*   `mode: 0o600`）。本模块沿用同一套写入方式与同一份隐私标准。
* 改动：存的是**观测结果**而非凭据 —— 因此文件里不含任何 token，
*   并且它与用户设置**分开落盘**，原因见下。
*
* 为什么这些事实不放 settings（`regions[region].pool`）：
*
*   卡片对用户偏好用的是「草稿 → 保存 → 丢弃草稿」模式：保存成功会丢弃草稿。
*   如果探测结果也住在那个槽里，用户手工点一次「保存」就会用**几分钟前的草稿**
*   覆盖掉定时器刚写进去的结果 —— 那等于把测量结果回退，测试白做。
*   观测数据由插件高频写入、且不是用户偏好，所以它必须落在自己的文件里。
*
* 本模块的读写**从不抛异常给调用方**：池是增强功能，一个损坏的观测文件绝不能让
* 卡片或 host 启动失败 —— 最坏情况是「回到未测试」，而不是整个插件不可用。
*
* @module dsh-connect-workbuddy/account-pool-store
*/
/** On-disk format version; readers reject anything else. */
const STORE_FORMAT_VERSION = 1;
/** Filename prefix for one region's measured pool facts. */
const POOL_STORE_PREFIX = ".workbuddy-pool";
/** Whether a parsed value looks like a stored probe. */
function isProbe(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	return typeof candidate["outcome"] === "string" && typeof candidate["atMs"] === "number" && (candidate["retryAtMs"] === void 0 || typeof candidate["retryAtMs"] === "number") && (candidate["message"] === void 0 || typeof candidate["message"] === "string") && (candidate["accountName"] === void 0 || typeof candidate["accountName"] === "string") && (candidate["modelId"] === void 0 || typeof candidate["modelId"] === "string") && (candidate["source"] === void 0 || typeof candidate["source"] === "string");
}
/**
* One region's path for measured pool facts.
*
* Region-keyed for the same reason the credential copies are: the two regions
* are parallel stacks and must never overwrite each other's measurements.
*/
function workbuddyPoolStorePath(region) {
	return join(resolveDshHome(), `${POOL_STORE_PREFIX}.${region}.json`);
}
/**
* The recovery time a stored record implies — declared, or recoverable from its
* own body.
*
* The field itself wins when present: it is what the writer computed with the
* full input set (`Retry-After` header, quota-refresh point, body), and
* re-deriving it could only lose information.
*
* The fallback exists because a record can state a time in its `message` and
* still have no `retryAtMs`. That is not a hypothetical — it is what the English
* `6004` body produced, since the parser that ran at write time matched only the
* Chinese 「… 重置」 sentence:
*
*   `{"code":6004,"msg":"usage exceeds frequency limit, but don't worry, your
*     usage will reset at 2026-10-16 11:34:04 UTC+8, …"}`
*
* leaving a record that names the exact minute it will serve again while
* `retryDue` falls back to {@link POOL_UNKNOWN_COOLDOWN_MS}. The row then told the
* user 「上游未给出何时恢复」 about a body that had just said when, and the pool
* put the account back ~18 hours early to rediscover the same limit.
*
* Read-time healing is the only place this can be repaired for EXISTING records:
* every consumer receives probes through {@link readPoolProbes} —
* `accountExclusions` (the composer panel), `poolMembersOf` /
* `localPoolMembers` (the card AND failover routing), `memberNames` — so healing
* here fixes all of them at once. Re-deriving at each consumer instead would be
* three copies of one rule, and the next consumer added would silently miss it.
*
* Not a permanent second derivation: `writePoolProbes` reads through this
* function before it writes, so the very next write persists the healed value.
*
* Scoped to the two outcomes whose vocabulary HAS a stated time, matching
* {@link WorkBuddyPoolProbe.retryAtMs}. Widening it would let an incidental
* sentence in an `ok` body attach a countdown to a healthy account —
* `AccountPool.tsx` prints any present `retryAtMs` beside the outcome, so that
* would render a waiting time on an account that is not waiting for anything.
*/
function retryAtMsOf(probe) {
	if (probe.outcome === "ok") return void 0;
	if (probe.retryAtMs !== void 0) return probe.retryAtMs;
	if (probe.outcome !== "rate-limited" && probe.outcome !== "out-of-credit") return void 0;
	if (probe.message === void 0) return void 0;
	return parseUpstreamResetAt(probe.message);
}
/**
* Read one region's measured facts.
*
* Contains NO credentials. The one free-text field is `message`, and it is
* REDACTED BY THE WRITER before it ever reaches this file (`probe.ts`'s
* `redactUpstreamText`), so a token-shaped string cannot survive into storage.
* Because of that the file is not written with the credential store's stricter
* secrecy requirements, though it still uses the same atomic-write helpers.
*
* Returns an empty map for a missing, unreadable, malformed, or
* version-mismatched file: all four mean "nothing measured yet", which is a
* valid state the pool renders as "untested".
*/
async function readPoolProbes(region) {
	let raw;
	try {
		raw = await readFile(workbuddyPoolStorePath(region), "utf8");
	} catch {
		return {};
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null) return {};
	const document = parsed;
	if (document.version !== STORE_FORMAT_VERSION) return {};
	if (typeof document.probes !== "object" || document.probes === null) return {};
	const probes = {};
	for (const [accountId, probe] of Object.entries(document.probes)) {
		if (accountId === "" || !isProbe(probe)) continue;
		const retryAtMs = retryAtMsOf(probe);
		probes[accountId] = {
			outcome: probe.outcome,
			atMs: probe.atMs,
			...knownProbeSource(probe.source) === void 0 ? {} : { source: knownProbeSource(probe.source) },
			...retryAtMs === void 0 ? {} : { retryAtMs },
			...probe.message === void 0 ? {} : { message: probe.message },
			...probe.accountName === void 0 ? {} : { accountName: probe.accountName },
			...probe.modelId === void 0 ? {} : { modelId: probe.modelId }
		};
	}
	return probes;
}
/**
* A stored source string reduced to a source this build understands.
*
* `isProbe` accepts any string so a newer build's label cannot destroy the
* measurement it describes; this narrows it at the point of use. An unknown
* value becomes `undefined`, which the card renders as "unknown" — the honest
* answer, rather than mislabelling it as one of the two kinds we do know.
*/
function knownProbeSource(value) {
	return value === "test-batch" || value === "live-request" ? value : void 0;
}
/**
* Merge ONE new measurement over the record already stored for that account.
*
* A plain `{ ...existing, ...update }` is wrong here, and the damage is silent.
* The two writers describe the same account at different moments and carry
* different fields:
*
*   - `test-batch` measures the TARGET MODEL deliberately, so it is the only
*     writer that can produce a refresh point (`retryAtMs` with
*     `retrySource: 'quota-refresh'`) — a time the billing side states outright.
*   - `live-request` reports what a real chat request just hit. It often carries
*     no `retryAtMs` at all (a transport blip names no time), and a spread would
*     therefore DELETE the refresh point the probe had already resolved.
*
* Measured consequence of the spread, on a real `14018` account: the probe
* recorded "quota refreshes 2026-11-01", the next live failure rewrote the
* record without that field, and the pool then reported "retry in about 30
* minutes" — putting an exhausted account back into rotation to be refused
* again. The correct value was in the file one write earlier.
*
* So `retryAtMs` is INHERITED when the update does not state one, and every
* other field is the update's (the newer measurement owns `outcome`, `atMs`,
* `source` and `message`). Inheriting is only about the one field whose absence
* is not a statement: an update that DOES carry a time still overrides, which is
* what lets a fresh, shorter cooldown supersede a stale longer one.
*
* Pure and exported so the rule is unit-testable without a filesystem — this is
* exactly the kind of "two writers, one slot" rule that this project has been
* bitten by before.
*/
function mergePoolProbe(existing, update) {
	if (existing === void 0) return update;
	const merged = update.accountName === void 0 && existing.accountName !== void 0 ? {
		...update,
		accountName: existing.accountName
	} : update;
	if (update.outcome === "ok") {
		const { retryAtMs: _dropped, ...rest } = merged;
		return rest;
	}
	if (update.retryAtMs !== void 0) return merged;
	if (existing.retryAtMs === void 0 || existing.retryAtMs <= update.atMs) return merged;
	return {
		...merged,
		retryAtMs: existing.retryAtMs
	};
}
/**
* Merge measurements into one region's store and write it atomically.
*
* A MERGE rather than a replace, because batches measure one account at a time
* and a partial failure must not erase what earlier runs learned. An account
* absent from `updates` keeps its previous measurement, and an account present
* in both is combined by {@link mergePoolProbe} rather than overwritten.
*
* Never throws: a failed write loses only the newest measurements, and the
* caller's results are still returned to the user. Surfacing a disk error here
* would fail an operation that actually succeeded.
*/
async function writePoolProbes(region, updates) {
	if (Object.keys(updates).length === 0) return;
	const path = workbuddyPoolStorePath(region);
	try {
		await withFileLock(path, async () => {
			const existing = await readPoolProbes(region);
			const merged = { ...existing };
			for (const [accountId, update] of Object.entries(updates)) merged[accountId] = mergePoolProbe(existing[accountId], update);
			await writeFileAtomic(path, `${JSON.stringify({
				version: STORE_FORMAT_VERSION,
				probes: merged
			}, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
		});
	} catch {}
}
//#endregion
//#region src/web-status.ts
/** Redact token-like content before it crosses to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 500);
}
/**
* The upstream-identity switches the card may write through `__save`.
*
* These are TOP-LEVEL config fields (see the schema in `index.ts`), not a
* nested block, so each is set on its own path and no merge base is involved.
* The list is a constant here rather than derived from the schema because this
* endpoint must stay a closed allow-list: deriving it would let an unrelated
* schema addition quietly widen what the browser can write.
*
* Every entry is a switch the user can already set by hand in
* `cordis.patch.yml`; this list only adds a UI route to the same fields (issue
* #133 suggestions 2 and 3), so it can never expose anything the config file
* does not already expose.
*/
const UPSTREAM_SWITCH_FIELDS = /* @__PURE__ */ new Set([
	"usageIdentity",
	"keepPromptLast",
	"extraInjectedPrefixes",
	"sessionTitle",
	"dropForeignThinking"
]);
/** A non-null, non-array object: the only shape the slot merge applies to. */
function isPlainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Merge a `cliBridge` patch into the committed settings object.
*
* ONE level on purpose: every field in that block is a scalar (a boolean, a cap,
* a path), so the only thing a deeper merge could produce is a half-written entry.
* Sibling keys survive — flipping the switch must not drop the user's tuned caps.
*/
function nextCliBridgeSettings(current, patch) {
	const base = isPlainRecord(current) ? { ...current } : {};
	if (!isPlainRecord(patch)) return base;
	for (const [key, value] of Object.entries(patch)) base[key] = value;
	return base;
}
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* A JSON response that must never be cached.
*
* Used for every answer that carries live credentials — the transfer export
* hands the browser real access and refresh tokens. Without `no-store` such a
* response is eligible for the browser's HTTP cache, where a token can outlive
* the session on disk.
*/
function jsonPrivate(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store"
	});
	res.end(payload);
}
/** Request-body cap for the probe route: model ids only, never content. */
const PROBE_BODY_LIMIT = 65536;
/**
* Read a small JSON request body.
*
* Bounded, unlike the settings route's reader: this endpoint takes a list of
* model ids and has no legitimate use for a large payload, so an oversized body
* is refused rather than buffered.
*/
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > PROBE_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
					reject(/* @__PURE__ */ new Error("request body must be a JSON object"));
					return;
				}
				resolve(parsed);
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		req.on("error", reject);
	});
}
/**
* The full gate a state-changing route must clear: Host AND Origin.
*
* Origin alone is not enough. It answers "did a foreign page cause this?", but a
* DNS-rebinding attack arrives with the attacker's domain in `Host` and no
* useful Origin, so the Host check is what drops it — and until this function
* existed, all thirteen routes below (ten POST, three GET) had only the Origin
* half while the shim's chat route had both. The asymmetry was invisible per-file.
*
* Both halves are cheap and NEITHER IS AUTHENTICATION. A local process — or any
* peer that can reach the listener when it is bound to a LAN address — may send
* whatever Host and Origin it likes. What these two checks buy is narrow and
* worth stating precisely:
*
* - they stop a BROWSER on a foreign page from driving these routes (the browser
*   chooses Origin for us, and rebinding fails the Host comparison), which is
*   the CSRF / rebinding family;
* - they do NOT stop a program that can already open a socket to the port.
*
* There is no per-route secret here: `req.headers` is read for `host` and
* `origin` and nothing else. Every route that spends credit or returns token
* material is protected by the same two forgeable headers as the read routes, so
* binding this listener to a non-loopback address exposes those routes to the
* local network. That is a property of the whole surface, not of this function,
* and it must not be described as though a stronger guard existed.
*
* Absent Host is refused: HTTP/1.1 requires it, and its absence on a
* credit-spending surface is not worth the benefit of the doubt. Absent Origin
* passes, because that is the shape of the plugin's own fetch and of curl.
*/
function requireLoopback(req, res) {
	if (!hostMatchesListener(req.headers.host, req.socket?.localAddress)) {
		json(res, 403, { error: "host-not-trusted" });
		return false;
	}
	if (!originIsLoopback(req.headers.origin, req.socket?.localAddress)) {
		json(res, 403, { error: "origin-not-trusted" });
		return false;
	}
	return true;
}
/** Map the credit answer to the card's compact document. */
function toCredits(answer) {
	return {
		total: answer.total,
		packages: answer.packages.map((pack) => ({
			packageName: pack.packageName,
			remain: pack.remain,
			size: pack.size,
			monthly: pack.monthly,
			...pack.refreshAtMs === void 0 ? {} : { cycleRefreshMs: pack.refreshAtMs },
			...pack.expiresAtMs === void 0 ? {} : { expiresAtMs: pack.expiresAtMs }
		})),
		expiringSoon: answer.expiringSoon,
		...answer.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: answer.nearestExpiryMs }
	};
}
/** Project a model into the card's row, dropping empty optional fields. */
function toWebModel(model, budgets) {
	const budgeted = applyContextBudgets([model], budgets)[0] ?? model;
	return {
		id: model.id,
		name: model.name,
		contextWindow: budgeted.contextWindow,
		nativeContextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		...model.creditMultiplier === void 0 ? {} : { creditMultiplier: model.creditMultiplier },
		...model.busyLevel === void 0 ? {} : { busyLevel: model.busyLevel },
		...model.supportsImages === void 0 ? {} : { supportsImages: model.supportsImages },
		...model.multimodal === void 0 ? {} : { multimodal: model.multimodal },
		...model.reasoning === void 0 ? {} : { reasoning: {
			...model.reasoning.supportedEfforts === void 0 ? {} : { supportedEfforts: [...model.reasoning.supportedEfforts] },
			...model.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: model.reasoning.defaultEffort },
			...model.reasoning.canDisableThinking === void 0 ? {} : { canDisableThinking: model.reasoning.canDisableThinking },
			...offRefused(model.id) ? { offRefused: true } : {},
			...model.reasoning.refusesOff === true ? { refusesOff: true } : {}
		} },
		...model.promos === void 0 ? {} : { promos: model.promos }
	};
}
/**
* Project a store account into the card's token-free account row.
*
* `uin` is deliberately NOT forwarded: the card has never rendered it, so
* sending it was pure exposure of an account identifier for no feature. The
* name carries whatever the desktop app recorded, and `''` means the card
* should show its own placeholder rather than an identifier.
*/
function toWebAccount(account) {
	return {
		id: account.id,
		accountName: account.accountName,
		domain: account.domain,
		source: account.source,
		tokenExpiresAtMs: account.tokenExpiresAtMs,
		selected: account.selected,
		...account.enterprise === true ? { enterprise: true } : {}
	};
}
/**
* The probed-path list for a signed-out region, or nothing when the store
* cannot produce one.
*
* Diagnostics must never turn a page into an error: `diagnose()` re-reads the
* filesystem, and a store built without it (or one whose probe throws on an
* exotic filesystem) degrades to the plain "not signed in" hint the card showed
* before this existed. Failure reasons are `safeMessage`d because a raw
* filesystem error can embed an absolute path or a fragment of file content.
*/
async function searchedPaths(store) {
	if (typeof store.diagnose !== "function") return {};
	try {
		const { failures } = await store.diagnose();
		if (failures.length === 0) return {};
		return { searched: failures.map((failure) => ({
			path: failure.path,
			source: failure.source,
			reason: failure.reason,
			...failure.message === void 0 ? {} : { message: safeMessage(failure.message) }
		})) };
	} catch {
		return {};
	}
}
/** Reads schemastery's internal `meta.volatile` marker for one top-level field. */
function volatileFlagOf(field) {
	return Config.dict?.[field]?.meta?.volatile === true;
}
/**
* Per-account credit balances for one region, for the composer panel's table.
*
* ONE upstream read per account, which is exactly why this is its own route:
* the panel calls it only while it is open, so the 5-minute readout never
* multiplies its cost by the account count.
*
* Every account is listed even when its balance cannot be read — a credential
* that no longer resolves, or an upstream that refused — because the panel's
* job is to show which accounts exist and let the user switch. Such a row
* carries NO `credits` field rather than `0`, so the panel renders "—" instead
* of telling the user they are out of credits.
*
* Failures are contained per account: one dead credential must not blank the
* table for the accounts that are fine.
*/
async function workBuddyAccountCredits(deps, region) {
	const store = deps.store(region);
	const accounts = await store.accounts();
	const exclusions = await deps.accountExclusions?.(region).catch(() => void 0) ?? {};
	return Promise.all(accounts.map(async (account) => {
		const credential = await store.credentialFor(account.id).catch(() => void 0);
		const credits = credential === void 0 ? void 0 : await deps.client.fetchCredits(credential).then((answer) => answer.total).catch(() => void 0);
		const excludedBy = exclusions[account.id];
		return {
			id: account.id,
			accountName: account.accountName,
			selected: account.selected,
			...credits === void 0 ? {} : { credits },
			...excludedBy === void 0 ? {} : { excludedBy }
		};
	}));
}
/**
* Read the selected account's live figures, and classify a refusal.
*
* Extracted so the first-paint path can omit it as a unit: the two calls here
* are the ones that used to gate the account list (each up to the upstream
* client's 30-second ceiling, and the pool adds one pair per member on top).
*/
async function liveFigures(deps, region, credential, selected) {
	const [creditsResult, checkinResult] = await Promise.allSettled([deps.client.fetchCredits(credential), deps.client.fetchCheckinStatus(credential)]);
	const rejected = [creditsResult, checkinResult].some((result) => result.status === "rejected" && isCredentialRejectedError(result.reason));
	const recovery = !rejected ? void 0 : await resolveCredentialRecovery({
		region,
		store: deps.store(region),
		...selected === void 0 ? {} : { rejectedAccountId: selected.id },
		probe: deps.accountUsable ?? (async () => false)
	});
	return {
		...creditsResult.status === "fulfilled" ? { credits: toCredits(creditsResult.value) } : { creditsError: safeMessage(creditsResult.reason) },
		...checkinResult.status === "fulfilled" ? { checkin: checkinResult.value } : { checkinError: safeMessage(checkinResult.reason) },
		...!rejected ? {} : { credentialRejected: true },
		...recovery === void 0 ? {} : { recovery }
	};
}
/**
* Assemble one region's card document. `region` is the tab the card is on;
* the region-scoped store already answers with only that region's accounts,
* so the document's model slots and account list are that region's by
* construction. Sign-in state is read-only; credit is a live billing answer
* whose failure degrades to `creditsError` rather than failing the document.
*
* `options.detail` selects the first-paint variant: it uses the credential
* already known locally instead of resolving (resolving may refresh a token
* over the network) and skips {@link liveFigures} entirely, so nothing about
* the account list depends on how fast a billing endpoint answers.
*/
async function workBuddyWebStatus(deps, region, options = {}) {
	const fast = options.detail === "fast";
	const store = deps.store(region);
	const accounts = await store.accounts();
	deps.regionUsable?.(region, accounts.length > 0);
	const enabled = deps.regionEnabled(region);
	const showCreditsInMainUi = deps.showCreditsInMainUi?.(region) ?? true;
	const creditPosition = deps.creditPosition?.(region) ?? "composer";
	const imageToolEnabled = deps.imageToolEnabled?.(region) ?? false;
	const videoToolEnabled = deps.videoToolEnabled?.(region) ?? false;
	const preferredVideoModels = deps.preferredVideoModels?.(region) ?? {};
	const cliBridgeEnabled = deps.cliBridgeEnabled?.() === true;
	const cliBridgeModel = deps.cliBridgeModel?.() ?? "";
	const cliBridgeEffort = deps.cliBridgeEffort?.() ?? "";
	const cliBridgeRegionOrder = deps.cliBridgeRegionOrder?.() ?? "";
	const dropForeignThinking = deps.dropForeignThinking?.() === true;
	const lastForeignThinking = deps.latestForeignThinking?.();
	const busyLevels = deps.busyLevels?.(region) ?? {};
	const authStatus = await store.status();
	const selectionExplicit = store.hasExplicitSelection();
	if (authStatus.state !== "signed-out" && accounts.length === 0) return {
		status: "signed-out",
		accounts: [],
		selectionExplicit,
		enabled,
		showCreditsInMainUi,
		imageToolEnabled,
		videoToolEnabled,
		preferredVideoModels,
		cliBridgeEnabled,
		cliBridgeModel,
		cliBridgeEffort,
		cliBridgeRegionOrder,
		busyLevels
	};
	let credential;
	try {
		credential = fast ? await store.current() : await store.resolve();
		if (credential === void 0) credential = await store.resolve();
	} catch (error) {
		const webAccounts = accounts.map(toWebAccount);
		return {
			status: "signed-out",
			accounts: webAccounts,
			message: safeMessage(error),
			selectionExplicit,
			enabled,
			showCreditsInMainUi,
			creditPosition,
			imageToolEnabled,
			videoToolEnabled,
			preferredVideoModels,
			cliBridgeEnabled,
			cliBridgeModel,
			cliBridgeEffort,
			cliBridgeRegionOrder,
			dropForeignThinking,
			...lastForeignThinking === void 0 ? {} : { lastForeignThinking },
			busyLevels,
			...await store.selectionLost() ? { selectionLost: true } : {},
			...webAccounts.length === 0 ? await searchedPaths(store) : {}
		};
	}
	const selected = accounts.find((account) => account.selected);
	const account = {
		accountId: selected?.id ?? "",
		accountName: preferredAccountName(credential),
		...credential.domain === "" ? {} : { domain: credential.domain },
		region,
		source: credential.source,
		tokenExpiresAtMs: credential.expiresAtMs,
		selectionExplicit,
		enabled,
		showCreditsInMainUi,
		creditPosition,
		imageToolEnabled,
		videoToolEnabled,
		preferredVideoModels,
		cliBridgeEnabled,
		cliBridgeModel,
		cliBridgeEffort,
		cliBridgeRegionOrder,
		dropForeignThinking,
		...lastForeignThinking === void 0 ? {} : { lastForeignThinking },
		busyLevels,
		accounts: accounts.map(toWebAccount),
		models: deps.displayModels(region).map((model) => toWebModel(model, deps.contextBudgets(region))).map((model) => model.reasoning === void 0 || lastRefusalFor(model.id) === void 0 ? model : {
			...model,
			reasoning: {
				...model.reasoning,
				refusesOff: true
			}
		}),
		enabledModelIds: [...deps.enabledModelIds(region)],
		imageModelIds: [...deps.imageModelIds(region)],
		offModelIds: [...deps.offModelIds(region)]
	};
	const figures = fast ? {} : await liveFigures(deps, region, credential, selected);
	const rosterSeen = deps.rosterSeen === void 0 ? void 0 : await deps.rosterSeen(region);
	return {
		status: "signed-in",
		contextBudgets: Object.fromEntries(Object.entries(deps.contextBudgets(region)).filter(([, value]) => typeof value === "number")),
		diagVolatile: {
			regions: volatileFlagOf("regions"),
			accounts: volatileFlagOf("accounts"),
			authFile: volatileFlagOf("authFile")
		},
		...account,
		...rosterSeen === void 0 ? {} : {
			newModelIds: [...rosterSeen.newModelIds],
			...rosterSeen.versionNote === void 0 ? {} : { rosterSeenVersionNote: rosterSeen.versionNote }
		},
		...figures,
		...await poolSectionOf(deps, region, fast)
	};
}
/**
* The pool block for a status document, or nothing when it cannot be built.
*
* `fast` asks for the first-paint variant: local state only, no upstream call.
* A Host without a local member source then omits the block rather than paying
* the full read, so a first-paint document never regresses into the expensive
* path this mode exists to avoid.
*/
async function poolSectionOf(deps, region, fast) {
	if (deps.pool === void 0) return {};
	try {
		const pool = await workBuddyWebPool(deps, region, fast);
		return pool === void 0 ? {} : { pool };
	} catch {
		return {};
	}
}
/**
* Assemble one region's pool state for the card.
*
* The ranking is computed HERE, on the Host, and shipped as an ordered,
* annotated list. The card therefore never re-derives "who is eligible" — it
* renders the Host's answer, so the account the user sees marked as current is
* decided by the same rule that would actually bill.
*
* `current` is answered by the Host too (`currentAccountId`), not inferred from
* the ranking, because those are different questions: the ranking says who
* SHOULD serve, `current` says who IS serving. Marking the winner as current
* would make the card claim a switch that may not have been applied yet.
*/
async function workBuddyWebPool(deps, region, fast = false) {
	const pool = deps.pool;
	if (pool === void 0) return void 0;
	const preferences = pool.preferences(region);
	const members = fast ? await pool.localMembers?.(region) : await pool.members(region);
	if (members === void 0) return void 0;
	const ranked = rankPool(members, Date.now(), preferences.orderAccountIds);
	const catalog = pool.catalog?.(region) ?? [];
	const target = resolveTargetModel(catalog, preferences.targetModelId);
	const currentAccountId = await pool.currentAccountId?.(region);
	const byId = new Map(members.map((member) => [member.account.id, member]));
	const rankedIds = new Set(ranked.map((row) => row.account.id));
	const others = await pool.otherAccounts?.(region) ?? [];
	const checkedIn = fast ? pool.cachedCheckedInToday?.(region) ?? {} : await pool.checkedInToday?.(region).catch(() => ({})) ?? {};
	const claimable = fast ? pool.cachedBenefits?.(region) ?? {} : await pool.benefits?.(region).catch(() => ({})) ?? {};
	const rows = [...ranked.map((row) => ({
		account: row.account,
		member: true,
		ranked: row
	})), ...others.filter((account) => !rankedIds.has(account.id)).map((account) => ({
		account,
		member: false
	}))];
	/**
	* Names for saved members the roster above does NOT contain (issue #60).
	*
	* Read for the SAVED ids only, and only from the measurement record: those
	* are exactly the accounts the card cannot name from `accounts`, because
	* nothing about them is left on this machine except the fact that they were
	* once measured. Best-effort — a failed read names nothing, and the card
	* falls back to an id prefix rather than inventing a label.
	*/
	const memberNames = await pool.memberNames?.(region).catch(() => void 0) ?? void 0;
	const accounts = rows.map(({ account, member, ranked: row }) => {
		const measured = byId.get(account.id);
		return {
			accountId: account.id,
			accountName: account.accountName,
			...account.enterprise === true ? { enterprise: true } : {},
			...measured?.credits === void 0 ? {} : {
				credits: measured.credits.total,
				expiringSoon: measured.credits.expiringSoon,
				...measured.credits.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: measured.credits.nearestExpiryMs }
			},
			...measured?.probe === void 0 ? {} : { probe: {
				outcome: measured.probe.outcome,
				atMs: measured.probe.atMs,
				...measured.probe.source === void 0 ? {} : { source: measured.probe.source },
				...measured.probe.retryAtMs === void 0 ? {} : { retryAtMs: measured.probe.retryAtMs },
				...measured.probe.message === void 0 ? {} : { message: measured.probe.message },
				...measured.probe.modelId === void 0 ? {} : { modelId: measured.probe.modelId }
			} },
			...(() => {
				const perRow = resolveTargetModel(catalog, preferences.targetModelId);
				return {
					...perRow.modelId === void 0 ? {} : { testModelId: perRow.modelId },
					testModelSource: perRow.source,
					...perRow.staleModelId === void 0 ? {} : { staleTestModelId: perRow.staleModelId }
				};
			})(),
			...row?.excludedBy === void 0 ? {} : { excludedBy: row.excludedBy },
			current: account.id === currentAccountId,
			member,
			...checkedIn[account.id] === void 0 ? {} : { checkedInToday: checkedIn[account.id] },
			...(() => {
				const views = claimable[account.id];
				if (views === void 0 || views.length === 0) return {};
				return { benefits: views.map((view) => ({
					kind: view.kind,
					title: WORKBUDDY_BENEFIT_TITLES[view.kind],
					creditNum: view.creditNum,
					...view.daysLeft === void 0 ? {} : { daysLeft: view.daysLeft },
					urgent: view.urgent
				})) };
			})()
		};
	});
	return {
		enabled: preferences.enabled,
		checkinSupported: pool.checkinSupported?.(region) === true,
		...target.modelId === void 0 ? {} : { targetModelId: target.modelId },
		...target.staleModelId === void 0 ? {} : { staleTargetModelId: target.staleModelId },
		targetModelSource: target.source,
		memberAccountIds: preferences.memberAccountIds,
		...(() => {
			const listed = new Set(accounts.map((account) => account.accountId));
			const orderedIds = (preferences.orderAccountIds ?? []).filter((id) => listed.has(id));
			return orderedIds.length === 0 ? {} : { orderAccountIds: orderedIds };
		})(),
		...preferences.probeInputTokens === void 0 ? {} : { probeInputTokens: preferences.probeInputTokens },
		effectiveMemberAccountIds: effectiveMembersOf(accounts.map((account) => account.accountId), new Set(preferences.memberAccountIds)),
		...memberNames === void 0 ? {} : { memberNames },
		accounts,
		catalog: deps.displayModels(region).map((model) => ({
			id: model.id,
			name: model.name,
			...model.creditMultiplier === void 0 ? {} : { creditMultiplier: model.creditMultiplier },
			...model.busyLevel === void 0 ? {} : { busyLevel: model.busyLevel }
		}))
	};
}
/**
* The region a request addresses, or a 400 answer. Absent parameter means the
* domestic tab; an unknown value is refused rather than guessed.
*/
function requestRegion(req, res) {
	const region = regionOfStatusUrl(req.url ?? "/");
	if (region === void 0) {
		json(res, 400, { error: "unknown region" });
		return;
	}
	return region;
}
/**
* Mount the read-only routes on a context where `webServer` is available.
* The caller uses `ctx.inject(['webServer'], ...)`, so Desktop startup order
* cannot make this registration disappear.
*/
function registerWorkBuddyStatusRoute(ctx, deps) {
	ctx.effect(() => {
		const disposeUsage = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_USAGE_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET") {
					json(res, 405, { error: "method not allowed" });
					return;
				}
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				const detail = fastDetailOf(req.url ?? "") ? "fast" : "full";
				try {
					json(res, 200, await workBuddyWebStatus(deps, region, { detail }));
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeAccountCredits = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_ACCOUNT_CREDITS_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					json(res, 200, { accounts: await workBuddyAccountCredits(deps, region) });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeAccounts = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_ACCOUNTS_REFRESH_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const store = deps.store(region);
					const dismissalsCleared = await store.clearDismissals();
					const accounts = await store.accounts();
					deps.regionUsable?.(region, accounts.length > 0);
					json(res, 200, {
						accounts: accounts.map(toWebAccount),
						dismissalsCleared
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeCheckin = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_CHECKIN_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const credential = await deps.store(region).resolve();
					const current = await deps.client.fetchCheckinStatus(credential);
					if (!current.active) return json(res, 409, { error: "check-in activity is not active" });
					if (current.todayCheckedIn) return json(res, 200, {
						alreadyCheckedIn: true,
						checkin: current
					});
					json(res, 200, {
						alreadyCheckedIn: false,
						claim: await deps.client.claimDailyCheckin(credential),
						checkin: await deps.client.fetchCheckinStatus(credential)
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeBenefitClaim = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_BENEFIT_CLAIM_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				const accountId = url.searchParams.get(WORKBUDDY_POOL_ACCOUNT_PARAM);
				const kind = url.searchParams.get("kind");
				if (accountId === null || accountId === "") return json(res, 400, { error: "accountId is required" });
				if (kind !== "compensation" && kind !== "gift") return json(res, 400, { error: "kind must be compensation or gift" });
				try {
					const credential = await deps.store(region).credentialFor(accountId);
					if (credential === void 0) return json(res, 404, { error: "no credential for this account" });
					if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") return json(res, 409, { error: "enterprise-account-unsupported" });
					const target = (await deps.client.fetchBenefits(credential)).find((benefit) => benefit.kind === kind);
					if (target === void 0) return json(res, 404, { error: "benefit not available on this account" });
					if (target.claimed) return json(res, 409, {
						error: "benefit already claimed",
						benefit: target
					});
					if (!target.active) return json(res, 409, {
						error: "benefit activity is not active",
						benefit: target
					});
					await deps.client.claimBenefit(credential, kind);
					deps.pool?.invalidateBenefit?.(region, accountId);
					json(res, 200, {
						claimed: true,
						benefit: (await deps.client.fetchBenefits(credential)).find((benefit) => benefit.kind === kind) ?? target
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeRefresh = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_MODELS_REFRESH_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				if (deps.discoverModels === void 0) return json(res, 503, { error: "model refresh unavailable" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					json(res, 200, { models: (await deps.discoverModels(region)).map((model) => toWebModel(model, deps.contextBudgets(region))) });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeMediaModels = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_MEDIA_MODELS_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				if (deps.mediaModels === void 0) return json(res, 503, { error: "media model list unavailable" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const refresh = new URL(req.url ?? "/", "http://localhost").searchParams.get("refresh") === "1";
					json(res, 200, { models: (await deps.mediaModels(region, { refresh })).map((model) => ({
						id: model.id,
						name: model.name,
						tags: [...model.tags]
					})) });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeProbe = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_PROBE_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				if (deps.probeModels === void 0) return json(res, 503, { error: "model probe unavailable" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const body = await readJsonBody(req);
					const modelIds = Array.isArray(body.modelIds) ? body.modelIds.filter((id) => typeof id === "string" && id !== "") : [];
					if (modelIds.length === 0) return json(res, 400, { error: "modelIds must be a non-empty array of strings" });
					if (modelIds.length > 1) return json(res, 400, { error: "a probe accepts exactly one model" });
					const results = [];
					for (const modelId of modelIds) results.push(...await deps.probeModels(region, [modelId]));
					json(res, 200, { results });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeTps = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_TPS_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				if (deps.measureTps === void 0) return json(res, 503, { error: "tps measurement unavailable" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const body = await readJsonBody(req);
					const modelIds = Array.isArray(body.modelIds) ? body.modelIds.filter((id) => typeof id === "string" && id !== "") : [];
					if (modelIds.length === 0) return json(res, 400, { error: "modelIds must be a non-empty array of strings" });
					if (modelIds.length > 1) return json(res, 400, { error: "a tps measurement accepts exactly one model" });
					const results = [];
					for (const modelId of modelIds) results.push(...await deps.measureTps(region, [modelId]));
					json(res, 200, { results });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposePool = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_POOL_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				const action = poolActionOf(req.url ?? "/");
				if (action === void 0) return json(res, 400, { error: "action must be checkin, test, or remove" });
				const pool = deps.pool;
				if (pool === void 0) return json(res, 503, {
					reason: "pool-unavailable",
					error: "account pool unavailable"
				});
				const rowAccountId = poolAccountIdOf(req.url ?? "/");
				if (action === "remove") {
					if (pool.removeOne === void 0) return json(res, 503, {
						reason: "pool-unavailable",
						error: "per-account removal unavailable"
					});
					if (rowAccountId === void 0) return json(res, 400, { error: "accountId must name the account to remove" });
					if (!isVaultAccountId(rowAccountId)) return json(res, 400, { error: "accountId is not a well-formed account id" });
					try {
						json(res, 200, {
							action: "remove",
							accountId: rowAccountId,
							removed: await pool.removeOne(region, rowAccountId)
						});
					} catch (error) {
						json(res, 500, {
							reason: "pool-failed",
							error: safeMessage(error)
						});
					}
					return;
				}
				if (action === "test" && rowAccountId !== void 0) {
					if (pool.testOne === void 0) return json(res, 503, {
						reason: "pool-unavailable",
						error: "per-account test unavailable"
					});
					try {
						const row = await pool.testOne(region, rowAccountId);
						if (row === void 0) return json(res, 409, {
							action: "test",
							modelId: void 0,
							rows: [],
							reason: "no-free-model",
							error: "no zero-multiplier model in this region; refresh the catalog or set a target model"
						});
						json(res, 200, {
							action: "test",
							rows: [row]
						});
					} catch (error) {
						json(res, 500, {
							reason: "pool-failed",
							error: safeMessage(error)
						});
					}
					return;
				}
				try {
					const savedMembers = pool.preferences(region).memberAccountIds;
					if ((await pool.effectiveMemberAccountIds?.(region).catch(() => void 0) ?? savedMembers).length === 0) {
						const noneChecked = savedMembers.length === 0;
						return json(res, 409, {
							reason: noneChecked ? "no-members" : "no-live-members",
							error: noneChecked ? "no accounts are checked into this region's pool" : "no checked account still has a local sign-in"
						});
					}
					if (action === "checkin") {
						if (pool.checkinSupported?.(region) !== true) return json(res, 409, {
							reason: "checkin-unsupported",
							error: "this region does not offer a daily check-in"
						});
						if (pool.checkin === void 0) return json(res, 503, {
							reason: "pool-unavailable",
							error: "pool check-in unavailable"
						});
						return json(res, 200, {
							action: "checkin",
							rows: await pool.checkin(region)
						});
					}
					if (pool.test === void 0) return json(res, 503, {
						reason: "pool-unavailable",
						error: "pool test unavailable"
					});
					const preferences = pool.preferences(region);
					/**
					* The model ONE member is tested on (issue #61).
					*
					* ONE model for the whole batch, and it is also the gate: if the region
					* cannot name a target model the card is told to pick one before any
					* credits are spent. Every member is therefore measured on the SAME
					* model, which is what makes a green batch mean one thing. Resolution
					* runs through `resolveTargetModel`, so a stale target is reported,
					* never silently swapped for another model.
					*/
					const target = resolveTargetModel(pool.catalog?.(region) ?? [], preferences.targetModelId);
					if (target.modelId === void 0) return json(res, 409, {
						action: "test",
						modelId: void 0,
						rows: [],
						reason: target.source === "stale" ? "target-model-stale" : "no-free-model",
						error: target.source === "stale" ? "the saved target model is no longer offered by this region; pick another or switch back to automatic" : "no zero-multiplier model in this region; refresh the catalog or set a target model"
					});
					res.writeHead(200, {
						"Content-Type": "application/x-ndjson",
						"Cache-Control": "no-cache",
						"Connection": "keep-alive",
						"X-Accel-Buffering": "no"
					});
					const writeLine = (payload) => {
						res.write(`${JSON.stringify(payload)}\n`);
					};
					writeLine({
						action: "test",
						modelId: target.modelId
					});
					try {
						await pool.test(region, target.modelId, (row) => {
							writeLine({ row });
						});
						writeLine({ done: true });
					} catch (error) {
						writeLine({
							reason: "pool-failed",
							error: safeMessage(error)
						});
					}
					res.end();
					return;
				} catch (error) {
					json(res, 500, {
						reason: "pool-failed",
						error: safeMessage(error)
					});
				}
			}
		});
		const disposeDiagWrite = ctx.webServer.register({
			kind: "exact",
			path: "/plugins/dsh-connect-workbuddy/__save",
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const settings = ctx.get?.("settings");
				if (settings === void 0) return json(res, 503, { error: "settings service unavailable to this fiber" });
				try {
					const body = await new Promise((resolve, reject) => {
						const chunks = [];
						req.on("data", (chunk) => chunks.push(chunk));
						req.on("end", () => {
							try {
								resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
							} catch (e) {
								reject(e);
							}
						});
						req.on("error", reject);
					});
					const field = body.field;
					if (field !== "regions" && field !== "accounts" && field !== "cliBridge" && !(typeof field === "string" && UPSTREAM_SWITCH_FIELDS.has(field))) return json(res, 400, { error: "field must be regions, accounts, cliBridge, usageIdentity, keepPromptLast, extraInjectedPrefixes, sessionTitle or dropForeignThinking" });
					const row = settings.describe().find((r) => String(r.ns).includes("workbuddy"));
					if (row === void 0) return json(res, 503, { error: "workbuddy namespace missing from describe()" });
					const current = field === "regions" ? regionsMapOf(row.value?.[field]) : unwrapVolatileDeep(row.value?.[field] ?? {});
					const incoming = field === "regions" ? regionsMapOf(body.value) : body.value ?? {};
					if (field === "cliBridge") {
						if (!isPlainRecord(incoming)) return json(res, 400, { error: "cliBridge value must be an object" });
						const mergedBridge = nextCliBridgeSettings(current, incoming);
						await settings.mutate(row.ns, [{
							op: "set",
							path: [field],
							value: mergedBridge
						}], void 0);
						return json(res, 200, {
							ok: true,
							value: mergedBridge
						});
					}
					if (UPSTREAM_SWITCH_FIELDS.has(field)) {
						await settings.mutate(row.ns, [{
							op: "set",
							path: [field],
							value: body.value
						}], void 0);
						return json(res, 200, {
							ok: true,
							value: { [field]: body.value }
						});
					}
					const merged = { ...current };
					for (const [key, slot] of Object.entries(incoming)) {
						const prior = current[key];
						merged[key] = isPlainRecord(prior) && isPlainRecord(slot) ? {
							...prior,
							...slot
						} : slot;
					}
					if (field === "regions") for (const key of Object.keys(incoming)) {
						const slot = merged[key];
						if (!isPlainRecord(slot) || key !== "cn" && key !== "global") continue;
						if (Array.isArray(slot.lastCatalog) && slot.lastCatalog.length > 0) continue;
						const live = deps.displayModels(key);
						if (live.length === 0) continue;
						if (isUnconfiguredFallbackSnapshot(live, key)) continue;
						slot.lastCatalog = live;
					}
					await settings.mutate(row.ns, [{
						op: "set",
						path: [field],
						value: merged
					}], void 0);
					return json(res, 200, {
						ok: true,
						value: merged
					});
				} catch (error) {
					const err = error;
					return json(res, 500, {
						ok: false,
						errorName: err?.name ?? "unknown",
						error: err?.message ?? String(error)
					});
				}
			}
		});
		const disposeOAuth = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_OAUTH_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				const action = oauthActionOf(req.url ?? "/");
				if (action === void 0) return json(res, 400, { error: "action must be start or poll" });
				const oauth = deps.oauth;
				if (oauth === void 0) return json(res, 503, {
					reason: "oauth-unavailable",
					error: "OAuth sign-in is not available in this build"
				});
				try {
					if (action === "start") {
						json(res, 200, await oauth.start(region));
						return;
					}
					const body = await readJsonBody(req);
					if (typeof body.loginId !== "string" || body.loginId === "") return json(res, 400, { error: "loginId must be a non-empty string" });
					json(res, 200, await oauth.poll(region, body.loginId));
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeTransfer = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_TRANSFER_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				const region = requestRegion(req, res);
				if (region === void 0) return;
				const action = transferActionOf(req.url ?? "/");
				if (action === void 0) return json(res, 400, { error: "action must be export, preview, or import" });
				const transfer = deps.transfer;
				if (transfer === void 0) return json(res, 503, {
					reason: "transfer-unavailable",
					error: "account transfer is not available in this build"
				});
				try {
					if (action === "export") {
						const body = await readJsonBody(req);
						const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id) => typeof id === "string" && id !== "") : [];
						if (accountIds.length === 0) return json(res, 400, { error: "accountIds must be a non-empty array of strings" });
						const answer = await transfer.exportAccounts(region, accountIds);
						if (answer.accounts.length === 0) return json(res, 409, { error: "none of the named accounts was found in this region" });
						return jsonPrivate(res, 200, answer);
					}
					const body = await readJsonBody(req);
					if (typeof body.text !== "string" || body.text.trim() === "") return json(res, 400, { error: "text must be the transfer file's JSON content" });
					if (action === "preview") return json(res, 200, await transfer.previewImport(region, body.text));
					const indexes = Array.isArray(body.indexes) ? body.indexes.filter((value) => typeof value === "number" && Number.isInteger(value) && value >= 0) : [];
					if (indexes.length === 0) return json(res, 400, { error: "indexes must name at least one file entry to import" });
					return json(res, 200, await transfer.importAccounts(region, body.text, indexes));
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		/**
		* The CLI route's live turns.
		*
		* Registered even when the bridge is switched off, and answers an empty
		* document in that case: the composer chip polls this path unconditionally
		* (it cannot know the setting — the settings mirror is not readable from a
		* session component), so "off" has to be a 200 with nothing in it rather
		* than a 404 the chip would have to special-case.
		*
		* No region parameter: a live turn is not scoped to a credential region, and
		* `requestRegion` would 400 a perfectly valid read.
		*
		* A 404 is not an option here, and that is a second reason for the
		* unconditional registration: the chip keeps showing the last document it
		* read while a poll fails (it cannot tell "the route is gone" from "the
		* request dropped"), so a route that vanished on a settings change would
		* leave a ghost pill describing a turn that already ended. Answering an
		* empty document keeps "off" inside the same code path as "no turns".
		*/
		const disposeCliLive = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_CLI_LIVE_PATH,
			handler: (req, res) => {
				if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
				if (!requireLoopback(req, res)) return;
				try {
					json(res, 200, deps.cliLive?.() ?? {
						turns: [],
						serverTime: Date.now()
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		return () => {
			disposeBenefitClaim();
			disposeRefresh();
			disposeMediaModels();
			disposeCheckin();
			disposeAccounts();
			disposeUsage();
			disposeAccountCredits();
			disposeProbe();
			disposeTps();
			disposePool();
			disposeOAuth();
			disposeTransfer();
			disposeDiagWrite();
			disposeCliLive();
		};
	}, "dsh-connect-workbuddy: Web status route");
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "dsh-connect-workbuddy";
/** The model registry required before the provider can register. */
const inject = ["llm", "settings"];
/**
* Settings namespace for the plugin configuration card.
*
* (历史注记：0.1.5 线上插件自选命名空间并经 `installSection` 注册；自
* 2.1.0 起只支持 0.1.7 线，该路径已移除。) 0.1.7 的 settings 服务自行推导
* 命名空间 —— `describe()` 返回 `ns: entry.options.id`，即 Loader 条目 id
* —— 因此插件不再能自选。此常量仅作为「宿主不暴露条目 id」时的回落值；
* 实际生效值来自 {@link settingsNamespaceOf}。
*
* 这个区分不是装饰性的。宿主按**精确匹配**查表
* （模型设置页的 `namespaces.get(entry.settingsNs)`），所以宣告
* `workbuddy` 而宿主实际服务 `include:dsh-connect-workbuddy` 时，provider
* 会被判为「未配置」：配置入口与模型发现双双静默失效。
*/
/**
* The namespace the HOST actually serves this plugin under.
*
* `ctx.fiber.entry` is added by the Loader, not by Cordis itself, so it is not
* in Cordis's public types and is absent on hosts that mount a plugin without a
* Loader entry (a test harness, or `ctx.plugin()` called directly). Hence the
* probe plus the documented fallback, mirroring the first-party plugins:
* `const settingsNs = ctx.fiber.entry?.options.id ?? NS`.
*/
function settingsNamespaceOf(ctx) {
	const id = ctx?.fiber?.entry?.options?.id;
	return typeof id === "string" && id !== "" ? id : WORKBUDDY_SETTINGS_NS;
}
const modelConfig = z.object({
	id: z.string().required(),
	name: z.string().required(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1)
});
/**
* One region's account-pool PREFERENCES.
*
* Only user choices live here. The pool's MEASURED facts (probe outcomes,
* cooldowns, the account currently billed) are deliberately NOT part of this
* schema — see `src/account-pool-store.ts`. The card saves preferences with a
* draft-and-discard write, so storing measurements in the same slot would let
* one "Save" press overwrite results the timer had just written.
*/
const poolConfig = z.object({
	enabled: z.boolean().default(false).description("Whether this region's account pool is active (opt-in). While on, a failed chat request is retried against the other usable pool members before the error is reported."),
	targetModelId: z.string().default("").description("Model id to test; empty means pick a zero-multiplier model from this region's catalog"),
	/**
	* Sizing of the test probe, as a token count the user picks from a fixed set.
	*
	* A closed set rather than a free number: each step is a meaningful position
	* relative to the measured 20k~30k threshold, and an arbitrary value would
	* invite a size that is neither safely under nor clearly over it. `0` (and any
	* unknown value) falls back to the measured default, so a profile written by
	* an older build — and one hand-edited to something odd — behaves identically.
	*/
	probeInputTokens: z.number().step(1).default(0).description("Input tokens each test probe sends: 10000 / 20000 / 30000 / 50000 / 100000. Bigger probes catch a rate limit real conversations would hit, but cost more credit per test and may mark an account unusable for large requests only. 0 uses the measured default (25000)"),
	memberAccountIds: z.array(z.string()).default([]).description("Account ids checked into this pool (opt-in; empty means the pool covers nothing)"),
	orderAccountIds: z.array(z.string()).default([]).description("The user's hand-ordered pool order, as account ids. Independent of membership: an id need not be checked in (it only takes effect once the account is a member), and ids not listed sort last. Separate from memberAccountIds so reordering never conflicts with, or is destroyed by, a membership edit.")
});
const regionStateConfig = z.object({
	enabled: z.boolean().default(true).description("Whether this region's provider is offered to DSH (opt-out; false withdraws it entirely)"),
	/**
	* Whether this region's credit line shows at the DSH sidebar foot.
	*
	* Per-REGION rather than one global switch, because the two sides are
	* independent providers the user may hold only one account on: a CN-only user
	* has nothing to read from the international line and vice versa, and a
	* single shared switch would force them to either show a permanently empty
	* row or lose the one that works.
	*
	* ON by default (opt-out). The plugin card is not reachable in every host —
	* a market plugin can own the Plugins tab and never render
	* `plugins.bundle.config` — so a feature that is off until discovered would be
	* off forever for those users. The line carries its own `×` in the sidebar,
	* which is reachable exactly where the feature renders.
	*/
	showCreditsInMainUi: z.boolean().default(true).description("Show this region's remaining credits at the DSH sidebar foot (opt-out; the line carries its own hide button)"),
	creditPosition: z.union([z.const("composer"), z.const("stats")]).default("composer").description("Where the credit readout sits: \"composer\" = the composer tool row (default), \"stats\" = the ambient row below the composer card, next to the shell's own token pills. Choose \"stats\" if another plugin occupies the composer row."),
	lastCatalog: z.array(modelConfig).default([]),
	enabledModelIds: z.array(z.string()).default([]),
	imageModelIds: z.array(z.string()).default([]),
	/**
	* Whether the model may call the image-generation tool (opt-IN, default off).
	*
	* Per-REGION like the credit switches, and it now means the same thing on both
	* tabs: each region's catalog carries its own `text-to-image` model (CN
	* `hunyuan-image-alpha`, international `hy-image-3.5`; measured 2026-10-25,
	* see `docs/IMAGE_GEN.md`). Whichever region is switched on AND opted in owns
	* the tool; CN wins when both qualify (see `imageToolRegionOf`).
	*
	* Every other spending path in this plugin requires a human action: a chat
	* request is one the user sent, and the per-model "test" button is one the
	* user clicked. `workbuddy_draw_image` is the first capability where the
	* MODEL decides to spend — it calls the tool on its own, at about 5.71 credits
	* an image on CN and 0.03 on the international gateway (measured, not a price
	* list: the media catalog carries no cost, so the tool reports the
	* `usage.credit` the upstream actually settles), and there is no per-call
	* approval seam in the host to ask the user first (`needsApproval` /
	* `toolApproval` do not exist; verified against the shipped `app.asar`).
	*
	* So it is opt-in, the same way the account pool's credit-based rotation is
	* opt-in (3.0.0's reasoning): a feature that can move money on its own must be
	* one the user switched on, not one that arrives with an upgrade. Off also
	* means that region contributes nothing, and with no opted-in region at all
	* the tool is not REGISTERED, so the model never sees it and cannot attempt a
	* call that would be refused.
	*/
	imageToolEnabled: z.boolean().default(false).description("Let the model call workbuddy_draw_image on its own (opt-in; an image costs ~5.71 credits on the CN gateway and ~0.03 on the international one, and there is no per-call approval). Off by default, and off means no region registers the tool at all."),
	/**
	* Whether the model may call the video-generation tool (opt-IN, default off).
	* Per-REGION like `imageToolEnabled`, gated the same way: the region must be
	* switched on AND the user must opt in. CN wins when both qualify. A video
	* costs real credits per generation and the task runs tens of seconds to
	* minutes, so no per-call approval exists in the host — hence opt-in.
	*/
	videoToolEnabled: z.boolean().default(false).description("Let the model call workbuddy_draw_video on its own (opt-in; a video is an async task that costs WorkBuddy credits and runs tens of seconds to minutes). Off by default, and off means no region registers the tool at all."),
	/**
	* The video model pinned for one tag (`text-to-video` / `image-to-video`),
	* as a model id from THIS region's catalog.
	*
	* Written by the card's per-mode picker. The tool reads it only when the call
	* itself did not name a model, and falls back to the group's first model when
	* the pinned id is no longer in this region's directory — see
	* `preferredVideoModel` in `src/video-tool.ts`.
	*/
	preferredVideoModels: z.dict(z.string()).default({}).description("Video model pinned per tag (\"text-to-video\"/\"image-to-video\"), as a model id from this region catalog. Used only when a tool call names no model."),
	/**
	* Per-model override of whether thinking `off` is offered, keyed by model id
	* (issue #34). An ABSENT key means "use the built-in rule" — the upstream's
	* `canDisableThinking` declaration minus the ids known to refuse `off` (see
	* `src/off-thinking.ts`).
	*
	* Seeded from {@link defaultOffModelIds} on first read so the checkbox is
	* ticked correctly without the user having to save.
	*/
	offModelIds: z.array(z.string()).default([]).description("Model ids whose \"off\" thinking level is offered; seeded from the built-in rule when first read."),
	contextBudgets: z.dict(z.number().step(1).min(1)).default({}),
	pool: poolConfig.default({})
});
const accountSelectionConfig = z.object({
	cn: z.string().description("Selected domestic (CN) account id (never a token)"),
	global: z.string().description("Selected international account id (never a token)")
});
/**
* Mark a schema's field as volatile on the DSH lines that support it.
*
* `volatile()` exists from schemastery 3.18.3 (the DSH 0.1.7 line, which is the
* only line whose settings write gate reads the marker). Older pinning (3.18.2,
* the 0.1.5 line) has no such method, and the schema must stay byte-identical to
* the unmarked original there: hand-writing `meta.volatile = true` would bypass
* schemastery's own validateVolatileSchema checks and produce a schema no 0.1.5
* consumer understands — so on that line this degrades to an identity no-op.
*
* Exported so BOTH arms are testable on any machine. The capability is decided
* by whichever schemastery the dependency tree resolves, so without a seam the
* no-op arm would silently stop being exercised the moment the pinned version
* moved up — which is exactly how the volatile-path defect below went unseen.
*/
function asVolatile(schema) {
	if (typeof schema.volatile === "function") return schema.volatile();
	return schema;
}
function unwrapVolatile(value) {
	if (value !== null && typeof value === "object" && "get" in value && typeof value.get === "function") return value.get();
	return value;
}
/**
* Deep copy of a config value with every `{get(): T}` live reference replaced
* by the value it resolves to.
*
* {@link unwrapVolatile} only peels the ONE level a caller reads, which is all
* the ordinary read paths need. Handing a config object to a settings service
* is different: the service validates and `structuredClone`s the WHOLE object,
* so a reference surviving anywhere inside it fails schema validation with a
* message that names the field but not the cause —
* `$.authFile expected string but got [object Object]`.
*
* That is exactly what happened on the 0.1.5 line once volatile marking became
* active: `installSection` received the raw config, whose volatile fields were
* live references, and every field it validated threw. The namespace never
* registered, so the card's settings silently disappeared.
*
* The implementation now lives in the node-free host<->client bridge, because
* the browser half needs the SAME unwrap before it spreads a resolved field —
* spreading a live reference is `{get: <function>}`, which drops every sibling
* region. It is imported and re-exported from here so the Host entry keeps
* exposing it as part of its public API.
*/
const cliBridgeConfig = z.object({
	enabled: z.boolean().default(false).description("Mount the optional CodeBuddy CLI route (tool codebuddy_ask + /codebuddy). Off by default; the provider stacks are unaffected either way."),
	binary: z.string().default("").description("Absolute path to the CodeBuddy CLI JS entry (the package's bin/codebuddy, not its .cmd shim). Empty means auto-detect in the usual global npm/pnpm/yarn/volta/nvm/fnm locations. There is deliberately no fallback to whatever \"codebuddy\" is on PATH."),
	model: z.string().default("").description("Model id passed as --model. Empty means the CLI's own configured default."),
	permissionMode: z.string().default("dontAsk").description("Permission mode passed as --permission-mode: dontAsk (default: read tools allowed, writes refused, never blocks), plan / default / auto, acceptEdits (may edit files), or bypassPermissions (allows everything)."),
	effort: z.string().default("").description("Reasoning effort passed as --effort: minimal, low, medium, high, xhigh or max. Empty means unset."),
	maxTurns: z.number().step(1).min(1).default(10).description("Agent turn budget for one bridged call. Clamped to 100."),
	timeoutSecs: z.number().step(1).min(1).default(900).description("Wall-clock budget for one bridged call, in seconds. Clamped to 1800."),
	regionOrder: z.string().default("cn,global").description("Credential region preference for the CLI, comma separated. Domestic tokens are accepted by copilot.tencent.com; global tokens are refused there with 401."),
	workingDir: z.string().default("").description("Default working directory for a bridged call when the caller names none. Must exist and be a directory. Empty means a call has to name one (or come from a session that has one)."),
	allowedDirs: z.string().default("").description("Extra roots a bridged call may be pointed at, comma separated absolute paths. A call can always run inside its own session workspace; anything else has to be listed here. Empty means only the session workspace."),
	appendSystemPrompt: z.string().default("").description("Extra system prompt appended to every bridged call. Passed as --append-system-prompt, never through a shell."),
	allowUnattended: z.boolean().default(false).description("Allow a bridged call with no directory at all to run in a throwaway temp directory. Off by default: an agent that can edit files should not be aimed at a directory nobody chose."),
	maxReplyChars: z.number().step(1).min(1).default(6e4).description("Reply length cap handed back to the model, in characters. Clamped to 400000."),
	injectResult: z.boolean().default(true).description("Hand a successful /codebuddy result to the session model so the conversation knows about it. That wake-up costs a real DSH turn; set false to keep results purely local."),
	sessionContinuity: z.string().default("auto").description("Whether a second /codebuddy (or codebuddy_ask) in the same session continues the previous CodeBuddy conversation: auto (default) resumes it via --session-id, off starts a fresh one every time. An explicit session_id argument always wins over this setting."),
	maxTurnsPerSessionHour: z.number().step(1).min(0).default(6).description("Bridged calls allowed per hour in one session. 0 disables the limit."),
	maxTurnsPerHour: z.number().step(1).min(0).default(20).description("Bridged calls allowed per hour across the whole process. 0 disables the limit.")
});
const Config = z.object({
	authFile: asVolatile(z.string().description("WorkBuddy desktop auth file (defaults to the app's own location)")),
	accountId: z.string().description("Deprecated: pre-split account selector, attributed to its own region"),
	accounts: asVolatile(accountSelectionConfig.default({}).description("Per-region account selections, keyed cn | global")),
	regions: asVolatile(z.dict(regionStateConfig).default({}).description("Per-region model directory and selection, keyed cn | global")),
	lastCatalog: z.array(modelConfig).description("Deprecated: pre-region-split CN model directory"),
	enabledModelIds: z.array(z.string()).default([]).description("Deprecated: pre-region-split CN selection"),
	imageModelIds: z.array(z.string()).default([]).description("Deprecated: pre-region-split CN image opt-in"),
	contextBudgets: z.dict(z.number().step(1).min(1)).default({}).description("Deprecated: pre-region-split CN context budgets"),
	cliBridge: asVolatile(cliBridgeConfig.default({}).description("Optional CodeBuddy CLI route; off by default and independent of the providers")),
	channelPerturbation: asVolatile(z.union([
		z.const("off"),
		z.const("failure"),
		z.const("always")
	]).default("failure").description("When to perturb scanned messages with invisible characters: \"off\" only rescues after a channel-gate refusal, \"failure\" (default) learns from a successful rescue and starts later requests perturbed, \"always\" starts every request with the dense rescue for a gateway whose plain attempt is guaranteed to fail.")),
	usageIdentity: asVolatile(z.boolean().default(false).description("Make the upstream's usage page record these calls like the official client's: add the X-IDE-* identity headers (which fill the 使用端 column) and send the conversation ids as 32-hex UUIDv7. Off by default — it is a display alignment measured by a reporter, not by this plugin, and the chat channel identity (User-Agent) and request body never change.")),
	keepPromptLast: asVolatile(z.boolean().default(false).description("Move the harness-injected runtime context above the real prompt, so the WorkBuddy usage page records what you actually typed instead of the injected block. Message count and text are preserved; the one edit is the recorded prompt's own leading <acp> marker. Off by default because it changes the message order the upstream counts.")),
	extraInjectedPrefixes: asVolatile(z.array(z.string()).default([]).description("Extra literal prefixes (issue #133) treated like the harness-injected context markers when keepPromptLast is on — for blocks a companion plugin injects that the built-in list does not recognize. Each entry matches the start of a trailing user message; read only while keepPromptLast is enabled. Sampled when the plugin mounts: reload the plugin (or restart the host) after changing it.")),
	dropForeignThinking: asVolatile(z.boolean().default(false).description("Drop foreign thinking blocks that pi-ai would publish as prose (issue #147). After a provider switch the host rebuilds the other provider's assistant turns as dsh-foreign, and pi-ai then rewrites their thinking blocks into visible text, so the model's working notes become the answer and it copies that shape on later turns. On, those unsigned blocks are removed from the request (they could never be replayed as reasoning anyway); text and tool calls are untouched. Off by default because it changes bytes the upstream counts.")),
	retryPolicy: asVolatile(RetryPolicySchema.description("How this plugin's provider routes retry a failed model request. Unset keeps the DSH default, whose retryable-code list omits MALFORMED_RESPONSE — so one sampling flake that breaks a tool-call argument JSON kills the whole turn unretried. Set retryableCodes to add it (a set value REPLACES the default list, so restate every code you still want).")),
	sessionTitle: asVolatile(z.object({
		enabled: z.boolean().default(false),
		model: z.string().default("wb-lite")
	}).default({}).description("Move the host session-title request onto a hidden lightweight model (issues #132/#133). The host fires one real upstream request per new session either way; enabled re-points it at `model` (default wb-lite, measured 0 credits by the reporter) instead of billing the main paid model. Request volume still counts, and the lightweight model is reporter-measured, not reproduced here. Sampled when the plugin mounts: reload the plugin (or restart the host) after changing it."))
});
/**
* One region's saved model state. A config written before the region split has
* only the flat fields: those were always captured from the CN endpoint (the
* plugin had no international support), so they are read as the CN state and
* only when no explicit CN slot exists. The global region never inherits them —
* that inheritance is exactly the bug where a stale CN directory was
* intersected with the international catalog and silently dropped the user's
* picks.
*/
function regionStateOf(config, region) {
	const stored = regionsMapOf(config.regions)[region];
	if (stored !== void 0 && stored !== null) return stored;
	if (region !== "cn") return {};
	const lastCatalog = unwrapVolatile(config.lastCatalog);
	const enabledModelIds = unwrapVolatile(config.enabledModelIds);
	const imageModelIds = unwrapVolatile(config.imageModelIds);
	const contextBudgets = unwrapVolatile(config.contextBudgets);
	return {
		...lastCatalog === void 0 ? {} : { lastCatalog },
		...enabledModelIds === void 0 ? {} : { enabledModelIds },
		...imageModelIds === void 0 ? {} : { imageModelIds },
		...contextBudgets === void 0 ? {} : { contextBudgets }
	};
}
/**
* Whether one region's provider is switched on. Opt-out semantics: only an
* explicit `false` disables it, so every config written before this switch
* existed — including the pre-region-split flat fields, which never carry
* `enabled` — keeps both providers running exactly as before. The card reads the
* same rule through `regionEnabledOf`, so the two halves can never disagree
* about a region's state.
*/
function regionEnabled(config, region) {
	return regionStateOf(config, region).enabled !== false;
}
/** Every region, in card tab order. */
const REGION_KEYS = ["cn", "global"];
/**
* The region that owns the image tool right now, or `undefined` when no region
* has it switched on.
*
* BOTH gates are required, and both are read live: the region's provider switch
* must be ON (`regionEnabled`, opt-OUT) and the user must have opted IN to the
* model spending credits there (`imageToolEnabled`, opt-IN). Absence of
* `imageToolEnabled` is never consent.
*
* CN wins when both regions qualify, and that order is the only backward
* compatible one: before the international gateway carried a `text-to-image`
* model (measured 2026-10-25: `hy-image-3.5`) CN was the only region that could
* ever be opted in, so a profile that opted in there keeps using CN even after
* the global tab is switched on as well. That is exactly `REGION_KEYS`' order;
* it is not incidental.
*/
function imageToolRegionOf(config) {
	for (const region of REGION_KEYS) {
		if (!regionEnabled(config, region)) continue;
		if (regionStateOf(config, region).imageToolEnabled === true) return region;
	}
}
/**
* Region that owns the video tool right now, or `undefined` when no region has
* it switched on. Mirrors `imageToolRegionOf` but reads `videoToolEnabled`
* (the video-generation opt-in). Both gates required, read live: region provider
* switch ON (`regionEnabled`, opt-OUT) and the user opted IN (`videoToolEnabled`,
* opt-IN). CN wins when both qualify (see `REGION_KEYS`).
*/
function videoToolRegionOf(config) {
	for (const region of REGION_KEYS) {
		if (!regionEnabled(config, region)) continue;
		if (regionStateOf(config, region).videoToolEnabled === true) return region;
	}
}
/**
* The account id a region should select, or `undefined` for the documented
* default: follow whatever the WorkBuddy app is currently signed in as.
*
* Three inputs decide it, and the ORDER is the whole point:
*
* 1. `accounts[region] === ''` — the Clear sentinel. It means "the user
*    dropped this region's choice", which is the opposite of the key being
*    absent ("never configured"). It therefore terminates the lookup: falling
*    through to the legacy `accountId` here would re-bind the very account the
*    user just dropped, and would do it after clearing appeared to succeed.
* 2. `accounts[region]` set to a real id — an explicit per-region choice.
* 3. absent key, with the pre-split `accountId` belonging to this region —
*    the legacy migration, attributed once at startup from the local scan.
*
* `legacyAccountRegion` is resolved asynchronously after the first
* `applySelection` pass, so this is a pure function of it rather than a
* closure over the stores: the same call answers both the early pass (no
* attribution yet) and every later one.
*/
function selectAccountFor(region, value, legacyAccountRegion) {
	const configured = unwrapVolatile(value.accounts)?.[region];
	if (configured === "") return void 0;
	if (configured !== void 0) return configured;
	const accountId = unwrapVolatile(value.accountId);
	return legacyAccountRegion === region ? accountId : void 0;
}
/** Whether a region carries the Clear sentinel rather than a saved choice. */
function regionCleared(value, region) {
	return unwrapVolatile(value.accounts)?.[region] === "";
}
/**
* Which region owns the pre-split `accountId`, or `undefined` when it cannot
* be attributed (the field is absent, or the account is gone from every local
* sign-in list).
*
* Regions the user explicitly cleared are skipped, even when the saved account
* IS among their local sign-ins. `selectAccountFor` already refuses to fall
* back for a cleared region, so this cannot change what runs — but it keeps the
* attribution honest about its own decision: the region that owns this id is
* not the one the user just told the plugin to stop pinning, so the other
* region must get the chance to claim it.
*
* `accountsFor` is injected so the sequential, stop-at-first-match scan is
* testable without a filesystem.
*/
async function legacyAttributionRegion(value, accountsFor) {
	const id = value.accountId;
	if (id === void 0) return void 0;
	for (const region of REGION_KEYS) {
		if (regionCleared(value, region)) continue;
		if ((await accountsFor(region)).some((account) => account.id === id)) return region;
	}
}
/**
* Start both regions' loopback endpoints, register the `workbuddy` (CN) and
* `workbuddy-global` (international) providers, and refresh each region's
* model catalog from the upstream once that region's credentials allow it.
* The static fallback catalogs serve from the first moment, so an offline
* upstream never leaves a provider empty.
*/
function apply(ctx, config) {
	const client = new WorkBuddyUpstreamClient((message) => {
		ctx.logger.warn(`dsh-connect-workbuddy: ${message}`);
	}, { usageIdentity: unwrapVolatile(config.usageIdentity) === true });
	/**
	* How long a check-in reading is reused before asking the upstream again.
	*
	* The card polls the usage route every 60 seconds, but "did this account
	* check in today" changes only when a check-in runs or the day rolls over.
	* Without a cache, a 10-account pool cost ~14,400 upstream requests a day for
	* an answer that was almost always identical.
	*/
	const CHECKIN_CACHE_MS = 6e5;
	/**
	* Per-region, per-account check-in readings.
	*
	* Invalidated by this plugin's own check-in batch (the only writer that can
	* change the answer during a session), so the user sees their result
	* immediately instead of waiting out the TTL.
	*/
	const checkinStateCache = {};
	/**
	* Per-region, per-account benefit readings (issue #79).
	*
	* Same shape and same reasoning as `checkinStateCache`: claim state changes
	* when a human acts on the web page or in the desktop app, not spontaneously,
	* so a per-poll read of two endpoints per account would be thousands of
	* requests a day to learn nothing. Coarser than the check-in TTL because a
	* benefit window is measured in days, not hours.
	*/
	const benefitStateCache = {};
	const settingsNs = settingsNamespaceOf(ctx);
	const stacks = {};
	for (const region of REGION_KEYS) {
		const authFile = unwrapVolatile(config.authFile);
		const store = new WorkBuddyCredentialStore({
			region,
			...authFile === void 0 ? {} : { desktopPath: authFile },
			refresh: (credential) => client.refreshToken(credential)
		});
		const catalog = new WorkBuddyCatalog(region);
		const rosterSeen = createFileRosterSeenStore(region);
		/**
		* Where the next upstream `usage` should be written.
		*
		* The body report is two-phase (send, then charge), and the two phases are
		* wired through different callbacks, so the seam between them has to live
		* somewhere. `noop` rather than `undefined` keeps the usage path free of a
		* presence check on the hot request path — and a request whose report was
		* disabled resolves to the same noop, so nothing needs to know whether
		* reporting is on.
		*/
		let pendingUsage = () => {};
		stacks[region] = {
			store,
			catalog,
			shim: createWorkBuddyShim({
				store,
				client,
				catalog,
				logger: ctx.logger,
				channelPerturbation: unwrapVolatile(config.channelPerturbation) ?? "failure",
				keepPromptLast: unwrapVolatile(config.keepPromptLast) === true,
				extraInjectedPrefixes: unwrapVolatile(config.extraInjectedPrefixes) ?? [],
				sessionTitle: unwrapVolatile(config.sessionTitle) ?? {},
				/**
				* Pool routing, bound to THIS region.
				*
				* The region is captured in the closure rather than passed per call: each
				* region owns its own store, pool and shim, and routing that consulted the
				* other region's members would bill an account from a different account
				* pool than the one in play.
				*
				* `prepareAccount` runs before every request (so the ranking decides who
				* serves), `failoverAccount` runs after a failure (so the ranking decides
				* who to try next). Both are resolved lazily — they read pool plumbing
				* defined below — but never called before it exists: the shim only takes
				* traffic once the provider is registered, which happens after this whole
				* setup completes.
				*/
				onRequestBody: (body) => {
					recordBodyReport(region, body, { onError: (error) => ctx.logger.warn("dsh-connect-workbuddy: body report failed", error) }).then((attach) => {
						pendingUsage = attach;
					}).catch((error) => ctx.logger.warn("dsh-connect-workbuddy: body report failed", error));
				},
				onUpstreamUsage: (usage) => {
					pendingUsage?.(usage);
				},
				reportRefusal: (report) => {
					recordRefusal(report);
				},
				prepareAccount: () => applyPoolSelection(region),
				failoverAccount: (triedAccountIds) => failoverAccountFor(region, triedAccountIds),
				failoverShortfall: () => explainPoolShortfall(region),
				onAccountFailure: (accountId, failure) => {
					recordAccountFailure(region, accountId, failure);
				}
			}),
			rosterSeen
		};
	}
	const accountUsabilityProbe = createAccountUsabilityProbe({
		store: (region) => stacks[region].store,
		client
	});
	const withImageSelection = (models, images) => models.map((model) => ({
		...model,
		...images.has(model.id) ? { multimodal: true } : { multimodal: false }
	}));
	const configuredModels = (value, region, liveModels = []) => {
		const state = regionStateOf(value, region);
		const roster = resolveRoster(state.lastCatalog ?? [], liveModels, region, { keepLoadLevel: true });
		const declared = withImageSelection(deriveCatalog(roster, new Set(state.enabledModelIds ?? []), state.contextBudgets ?? {}), new Set(state.imageModelIds ?? []));
		return withEffectiveOff(declared, new Set(savedOffModelIds(state, declared))).map((model) => model.reasoning === void 0 || lastRefusalFor(model.id) === void 0 ? model : {
			...model,
			reasoning: {
				...model.reasoning,
				refusesOff: true
			}
		});
	};
	/**
	* The region's `off` selection as a Set (issue #34).
	*
	* `undefined` means "the user has never saved" — seed from the built-in rule
	* so the checkbox is ticked correctly on first read. An explicit `[]` means
	* the user UNticked everything and must stay empty: `regionStateOf` reads the
	* raw stored slot, so `undefined` and `[]` are distinguishable here, and
	* collapsing them would silently re-enable every model on the next load.
	*/
	const savedOffModelIds = (state, roster) => state.offModelIds ?? defaultOffModelIds(roster);
	const displayModels = (value, region) => {
		const state = regionStateOf(value, region);
		const live = stacks[region]?.catalog?.current() ?? [];
		return resolveRoster(state.lastCatalog ?? [], live, region);
	};
	/**
	* The load levels of the LIVE roster, keyed by model id.
	*
	* A SEPARATE read on purpose. `displayModels()` prefers the SAVED
	* `lastCatalog` (it is what the card edits), and a saved roster carries no
	* load level — load is not persisted, see `src/busy.ts`. So the card cannot
	* get the level from the model list it already has; it needs the live roster
	* beside it.
	*
	* Returning a MAP (not a merged roster) keeps the two apart: the card's list
	* stays the saved one the user edits, and the badge is a decoration that may
	* be absent for a model the probe did not answer for.
	*/
	const liveBusyLevels = (region) => {
		const live = stacks[region]?.catalog?.current() ?? [];
		const levels = {};
		for (const model of live) if (model.busyLevel !== void 0) levels[model.id] = model.busyLevel;
		return levels;
	};
	/**
	* The most recent request whose foreign thinking blocks were dropped
	* (issue #147).
	*
	* Process-local and last-wins, deliberately: this is DIAGNOSTIC state that
	* answers "why did my answer look like working notes", and it is only read by
	* the status endpoint. Persisting it would let a stale turn from yesterday
	* explain a session that has since been fixed — the whole point is that the
	* reader is looking at the turn that just happened. It forgets on restart,
	* which is the natural expiry for "what this process removed recently".
	*
	* Declared HERE rather than inside the adapter mount because the status route
	* is registered outside that callback and must be able to read it.
	*/
	let latestForeignThinking;
	let current = () => config;
	let invalidateCatalog = () => {};
	/**
	* REPAIR a region's saved directory against the live upstream roster.
	*
	* ISSUES #114 AND #115, THE PERSISTED HALF. The read side now serves the
	* live roster (see {@link resolveRoster}), but the SAVED directory would
	* still hold the stale snapshot — and the card's save writes the saved
	* directory back, so the stale snapshot would outlive the fix and could be
	* written back over the healed one. So the directory is repaired once, when
	* the live roster lands.
	*
	* WHAT IS WRITTEN: the live roster merged over the saved one, so a newly
	* added upstream model enters the directory and the user's own models stay.
	* `enabledModelIds` is NOT touched — the selection is its own field, and a
	* model leaving the upstream roster must not lose its tick.
	*
	* WHEN IT IS WRITTEN: only when the fingerprint actually differs, so a
	* profile that is already in agreement is never written to. Without that
	* guard every startup would write, and a write per startup is a write storm
	* on a profile the user opens often.
	*
	* THE FALLBACK-SNAPSHOT CASE. A directory that is byte-identical to the
	* static fallback table was never a user's selection — it is the plugin's
	* own placeholder that came back as if the user had chosen it (issue
	* #114's root cause). It is replaced by the live roster outright.
	*
	* FAIL-SOFT: a repair that cannot be written is not a reason to fail a
	* request. The read side is already correct without it, so the repair is
	* an optimisation that heals the profile, never a precondition.
	*/
	const repairRegionCatalog = async (region, live) => {
		if (live.length === 0) return;
		const saved = regionStateOf(current(), region).lastCatalog ?? [];
		const repaired = (isUnconfiguredFallbackSnapshot(saved, region) ? withoutRouters(live) : repairedCatalog(saved, live)).map((model) => {
			if (model.busyLevel === void 0) return model;
			const { busyLevel: _dropped, ...rest } = model;
			return rest;
		});
		if (repaired.length === 0) return;
		if (!(catalogFingerprint(repaired) !== catalogFingerprint(saved)) && !regionsFieldIsCorrupt(current().regions)) return;
		try {
			await writeRegionCatalog(hostSettings(), settingsNs, region, repaired);
		} catch (error) {
			ctx.logger.warn(`dsh-connect-workbuddy: could not repair the ${region} model directory against the live roster`, error);
		}
	};
	/**
	* The Host's settings service, or `undefined` when it is not available.
	*
	* Read through `ctx.get` at the moment of the write rather than sampled
	* once during `apply`: the service is optional on some hosts, and a
	* snapshot taken too early would be `undefined` forever.
	*/
	const hostSettings = () => ctx.get?.("settings");
	/**
	* Clean a `regions` field a previous version corrupted, once, at boot.
	*
	* The corruption itself is fixed at the source (`src/catalog-write.ts`) and the
	* read paths heal in memory, so a dirty profile is CORRECT long before this
	* runs — but it stays dirty in the file, and the next save would carry the
	* debris forward. The catalog repair writes the same clean shape, yet it only
	* runs when a live roster arrives: a disabled region, an unreachable upstream
	* or an empty answer would leave the wreckage in place for as long as those
	* conditions hold. This needs no upstream at all.
	*
	* FAIL-SOFT, exactly like the repair: the read side is already right, so a
	* write that cannot land costs tidiness and nothing else.
	*/
	const healRegionsFieldIfCorrupt = async () => {
		try {
			await healRegionsField(hostSettings(), settingsNs);
		} catch (error) {
			ctx.logger.warn("dsh-connect-workbuddy: could not clean the shape of the regions setting", error);
		}
	};
	/**
	* Legacy migration for the pre-split single `accountId`: its region is
	* resolved once from the local account scan and the selection is then
	* attributed to that region ONLY — the other region keeps its documented
	* default (follow the app's current sign-in) instead of silently inheriting
	* a selection that belongs to the other side of the split.
	*/
	let legacyAccountRegion;
	const effectiveAccountFor = (region, value) => selectAccountFor(region, value, legacyAccountRegion);
	const discoverModels = async (region, signal) => {
		const credential = await stacks[region].store.resolve();
		const keep = regionStateOf(current(), region).enabledModelIds ?? [];
		return client.fetchModels(credential, signal, keep);
	};
	/**
	* The region's MEDIA models, cached briefly for the card's read-only roster.
	*
	* Two callers ask the same question — the image tool (to validate a model
	* argument) and the card's roster block (to SHOW what exists) — and both get
	* the same answer from the same free GET. The cache exists because the card
	* re-reads it on every settings render, not because the answer is expensive.
	*
	* Region-keyed, and a failure is NOT cached: a gateway hiccup must not make
	* the roster read "no models" for five minutes.
	*/
	const mediaCaches = /* @__PURE__ */ new Map();
	const readMediaModels = async (region, options) => {
		const cached = mediaCaches.get(region);
		const now = Date.now();
		if (options?.refresh !== true && cached !== void 0 && now - cached.at < 3e5) return cached.models;
		const credential = await stacks[region].store.resolve();
		const models = await client.fetchMediaModels(credential, options?.signal);
		mediaCaches.set(region, {
			at: Date.now(),
			models
		});
		return models;
	};
	/**
	* Stamp each model's LIVE load level onto the runtime roster.
	*
	* Deliberately NOT part of {@link discoverModels}: that reader feeds the
	* settings card's "Refresh from WorkBuddy" draft, which is SAVED into
	* `lastCatalog` — and a saved load level is a lie the moment the settings page
	* is closed (`src/busy.ts`). So the level is stamped only on the path that
	* builds the RUNTIME catalog, and it dies with the process.
	*
	* Fail-soft on purpose: a refresh that cannot read the load probe still
	* delivers the roster. Losing a badge is nothing; losing the model list
	* because a 5-second probe timed out would be the same defect this plugin
	* spends most of its comments avoiding.
	*/
	const withBusyLevels = async (region, models, signal) => {
		if (models.length === 0) return models;
		try {
			const credential = await stacks[region].store.resolve();
			const levels = await client.fetchModelBusy(credential, models.map((model) => model.id), signal);
			return levels.size === 0 ? models : attachBusyLevels(models, levels);
		} catch (error) {
			ctx.logger.warn("dsh-connect-workbuddy: model load probe unavailable; refreshing the roster without load levels", error);
			return models;
		}
	};
	/**
	* Re-stamp the LIVE load levels onto a roster that was just recomputed.
	*
	* WHY A REPLAY NEEDS THIS. `configuredModels()` rebuilds the roster from the
	* SAVED `lastCatalog`, and a saved roster has no load level in it — load is
	* deliberately not persisted (`src/busy.ts`: a cached level is a lie the
	* moment the settings page closes). So every config change — switching
	* region, changing the model selection, toggling a level, moving an account —
	* used to wipe the badges that were on screen a second earlier, and the user
	* saw "极度拥堵" appear and then vanish without touching the upstream at all.
	*
	* The fix is to ask again rather than to remember: the probe is read-only,
	* free, and answers in ~190 ms for the whole roster. Keeping the level out
	* of disk is the point, so the honest place to get it back is the upstream.
	*
	* Fail-soft, like the other probe: a level that cannot be read is a missing
	* badge, never a missing model list.
	*/
	const restampBusyLevels = async (region, models) => {
		if (models.length === 0) return models;
		try {
			const credential = await stacks[region].store.resolve();
			const levels = await client.fetchModelBusy(credential, models.map((model) => model.id));
			return levels.size === 0 ? models : attachBusyLevels(models, levels);
		} catch (error) {
			ctx.logger.warn("dsh-connect-workbuddy: load probe unavailable while re-applying the selection; the roster keeps no load levels", error);
			return models;
		}
	};
	/** Push the current config into every region's store selection and catalog. */
	const applySelection = (value) => {
		const authFile = unwrapVolatile(value.authFile);
		for (const region of REGION_KEYS) {
			stacks[region].store.setDesktopPath(authFile);
			stacks[region].store.selectAccount(effectiveAccountFor(region, value));
			stacks[region].catalog.set(configuredModels(value, region, stacks[region].catalog.current()));
		}
		invalidateCatalog();
		for (const region of REGION_KEYS) (async () => {
			const live = await restampBusyLevels(region, stacks[region].catalog.current());
			if (live.length === 0) return;
			stacks[region].catalog.set(live);
			invalidateCatalog();
		})();
		syncRegionRegistration(value);
		syncImageTool(value);
		syncVideoTool(value);
		syncCliBridge(value);
		refreshRegionUsability();
	};
	/**
	* Tell each catalog whether its region has ANY local sign-in, so a region the
	* user has no account for advertises nothing instead of a roster that can
	* only 401 (issue #12).
	*
	* `accounts()` is the right source rather than the SELECTED credential: an
	* orphaned saved id must not blank a region that still has other sign-ins to
	* fall back on, and a region the user deliberately cleared must come back to
	* life the moment its first account appears.
	*
	* Deliberately fire-and-forget and idempotent — it runs on every settings
	* change, and `setRegionUsable` reports whether anything moved so a
	* no-change pass costs nothing beyond the scan. A failed scan leaves the
	* previous answer alone (the catalog starts permissive), so a transient
	* filesystem error never blanks a working region.
	*/
	const refreshRegionUsability = async () => {
		for (const region of REGION_KEYS) {
			let accounts;
			try {
				accounts = await stacks[region].store.accounts();
			} catch {
				continue;
			}
			if (stacks[region].catalog.setRegionUsable(accounts.length > 0)) invalidateCatalog();
		}
	};
	/**
	* Live registration handles per region, filled once the shim is listening.
	* A disabled region holds ZERO routes while staying registered: DSH allows
	* `replace([])` for exactly this case ("a settings section that emptied holds
	* zero routes while staying registered"), which is what makes the on/off
	* switch reversible without a restart. Withdrawing the adapter route is what
	* actually removes the region's models from DSH's model picker — hiding the
	* card tab alone would leave every model selectable.
	*/
	const registration = {
		cn: {},
		global: {}
	};
	/**
	* Publish each region's on/off state to the harness (issue #11-style region
	* switch). Both swaps are single synchronous sections, so no request can
	* observe a half-applied state, and `replace` announces itself through
	* `llm/adapters-updated`, which is what makes third-party consumers drop the
	* region too. No-op until the shim has registered; `applySelection` runs again
	* on every card write (and once more after registration completes), so a
	* toggle lands immediately.
	*/
	const syncRegionRegistration = (value) => {
		for (const region of REGION_KEYS) registration[region].adapter?.replace(regionEnabled(value, region) ? [WORKBUDDY_PROVIDERS[region]] : []);
		registration.cn.directory?.replace(REGION_KEYS.filter((region) => regionEnabled(value, region)).map((region) => ({
			provider: WORKBUDDY_PROVIDERS[region],
			displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES[region],
			settingsNs,
			settingsPath: [],
			declared: false
		})));
	};
	let imageTools;
	let disposeImageTool;
	const syncImageTool = (value) => {
		const wanted = imageToolRegionOf(value) !== void 0;
		if (wanted && disposeImageTool === void 0 && imageTools !== void 0) {
			disposeImageTool = registerWorkBuddyImageTool(imageTools, {
				resolveCredential: async () => {
					const live = current();
					for (const region of REGION_KEYS) {
						if (!regionEnabled(live, region)) continue;
						if (regionStateOf(live, region).imageToolEnabled !== true) continue;
						try {
							return await stacks[region].store.resolve();
						} catch {
							continue;
						}
					}
				},
				listMediaModels: (credential, signal) => client.fetchMediaModels(credential, signal),
				generateImage: (credential, request, signal) => client.generateImage(credential, request, signal),
				editImage: (credential, request, signal) => client.editImage(credential, request, signal),
				logger: ctx.logger
			});
			return;
		}
		if (!wanted && disposeImageTool !== void 0) {
			disposeImageTool();
			disposeImageTool = void 0;
		}
	};
	ctx.inject(["tools"], (toolsCtx) => {
		imageTools = toolsCtx.tools;
		if (imageTools === void 0) return;
		syncImageTool(current());
		toolsCtx.effect(() => () => {
			disposeImageTool?.();
			disposeImageTool = void 0;
			imageTools = void 0;
		});
	});
	let videoTools;
	let disposeVideoTool;
	const syncVideoTool = (value) => {
		const wanted = videoToolRegionOf(value) !== void 0;
		if (wanted && disposeVideoTool === void 0 && videoTools !== void 0) {
			disposeVideoTool = registerWorkBuddyVideoTool(videoTools, {
				resolveCredential: async () => {
					const live = current();
					for (const region of REGION_KEYS) {
						if (!regionEnabled(live, region)) continue;
						if (regionStateOf(live, region).videoToolEnabled !== true) continue;
						try {
							return await stacks[region].store.resolve();
						} catch {
							continue;
						}
					}
				},
				listMediaModels: (credential, signal) => client.fetchMediaModels(credential, signal),
				submitVideo: (credential, request, signal) => client.submitVideo(credential, request, signal),
				pollVideoTask: (credential, taskId, signal) => client.pollVideoTask(credential, taskId, signal),
				preferredVideoModel: (credential, tag) => regionStateOf(current(), regionOf(credential.domain)).preferredVideoModels?.[tag],
				downloadVideo: (credential, url, signal) => client.downloadVideo(credential, url, signal),
				logger: ctx.logger
			});
			return;
		}
		if (!wanted && disposeVideoTool !== void 0) {
			disposeVideoTool();
			disposeVideoTool = void 0;
		}
	};
	ctx.inject(["tools"], (toolsCtx) => {
		videoTools = toolsCtx.tools;
		if (videoTools === void 0) return;
		syncVideoTool(current());
		toolsCtx.effect(() => () => {
			disposeVideoTool?.();
			disposeVideoTool = void 0;
			videoTools = void 0;
		});
	});
	let cliTools;
	let cliCommands;
	let cliDirectoryOf;
	const cliDirectoryProbe = (session) => cliDirectoryOf?.(session) ?? null;
	let cliRuntime;
	let cliRuntimeKey = "";
	let disposeCliTool;
	let disposeCliCommand;
	const disposeCliSurfaces = () => {
		disposeCliTool?.();
		disposeCliTool = void 0;
		disposeCliCommand?.();
		disposeCliCommand = void 0;
	};
	const syncCliBridge = (value) => {
		const settings = unwrapVolatile(value.cliBridge);
		const key = JSON.stringify(settings ?? {});
		if (key !== cliRuntimeKey) {
			cliRuntimeKey = key;
			disposeCliSurfaces();
			cliRuntime?.deps.gate?.clear();
			cliRuntime = createCliBridgeRuntime(settings, REGION_KEYS.map((region) => ({
				region,
				store: stacks[region].store
			})), (message) => ctx.logger.warn(`dsh-connect-workbuddy: ${message}`), cliDirectoryProbe);
		}
		if (cliRuntime === void 0) {
			disposeCliSurfaces();
			return;
		}
		if (cliTools !== void 0 && disposeCliTool === void 0) disposeCliTool = mountToolSurface(cliRuntime, cliTools);
		if (cliCommands !== void 0 && disposeCliCommand === void 0) disposeCliCommand = mountCommandSurface(cliRuntime, cliCommands);
	};
	ctx.inject(["tools"], (toolsCtx) => {
		cliTools = toolsCtx.tools;
		if (cliTools === void 0) return;
		syncCliBridge(current());
		toolsCtx.effect(() => () => {
			disposeCliTool?.();
			disposeCliTool = void 0;
			cliTools = void 0;
		});
	});
	ctx.inject(["commands"], (commandsCtx) => {
		cliCommands = commandsCtx.commands;
		if (cliCommands === void 0) return;
		syncCliBridge(current());
		commandsCtx.effect(() => () => {
			disposeCliCommand?.();
			disposeCliCommand = void 0;
			cliCommands = void 0;
		});
	});
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		const reader = projectionCtx.sessionProjections;
		if (reader === void 0 || typeof reader.stateOf !== "function") return;
		/**
		* The one place the projection key is spelled out.
		*
		* It must match the Host's own registration — key
		* `"workingDirectory"`, stateVersion 1, in the Host's
		* @deepseek-ai/dsh-working-directory package. If the Host renames the key, this is
		* the line that has to follow, and the comment is what tells the next reader
		* where to look.
		*
		* Returns null for `"no committed directory"`, which is the same signal the header
		* path produces when it has nothing — so the ladder below it behaves identically.
		* NOTE what it deliberately does NOT do: fall back to the service's own default.
		* The Host's get() answers stateOf(...) ?? defaultDirectory, and that fallback is
		* the Host process's cwd, i.e. a directory nobody chose. Substituting it here would
		* quietly turn `"we do not know"` into `"use this one"`, which is the one change this
		* whole refactor must not make.
		*/
		const WORKING_DIRECTORY_PROJECTION_KEY = "workingDirectory";
		cliDirectoryOf = (session) => {
			let state;
			try {
				state = reader.stateOf(session, WORKING_DIRECTORY_PROJECTION_KEY);
			} catch {
				return null;
			}
			if (typeof state !== "string") return null;
			const trimmed = state.trim();
			return trimmed === "" ? null : trimmed;
		};
		projectionCtx.effect(() => () => {
			cliDirectoryOf = void 0;
		});
	});
	ctx.inject(["webServer"], (webCtx) => registerWorkBuddyStatusRoute(webCtx, {
		store: (region) => stacks[region].store,
		client,
		accountUsable: accountUsabilityProbe,
		/**
		* The CLI route's live turns, for the composer readout.
		*
		* Read through `cliRuntime` rather than captured once: the runtime is rebuilt
		* whenever `cliBridge` settings change, and the board belongs to the runtime.
		* A captured board would keep answering for a runtime nothing drives any
		* more. Switched off means `undefined`, which the route reports as an empty
		* document.
		*/
		cliLive: () => cliRuntime?.live.snapshot() ?? {
			turns: [],
			serverTime: Date.now()
		},
		/**
		* Why each of the region's accounts cannot serve right now, for the composer
		* panel's table.
		*
		* Runs the SAME `exclusionOf` the pool ranks by, against every account the
		* region knows — not only pool members. Deriving it any other way (a second
		* expiry comparison, or `probe.outcome` read raw) would let the panel call an
		* account rate-limited while the pool has already moved past its cooldown.
		*/
		accountExclusions: async (region) => {
			const probes = await readPoolProbes(region);
			const nowMs = Date.now();
			const out = {};
			for (const [accountId, probe] of Object.entries(probes)) {
				const excludedBy = exclusionOf(probe, nowMs);
				if (excludedBy !== void 0) out[accountId] = excludedBy;
			}
			return out;
		},
		displayModels: (region) => displayModels(current(), region),
		/**
		* The LIVE load levels, read beside the saved roster the card lists.
		*
		* The card's model list is the SAVED `lastCatalog`, which carries no load
		* level (load is not persisted — `src/busy.ts`), so the badge has to come
		* from the live roster instead.
		*/
		busyLevels: (region) => liveBusyLevels(region),
		enabledModelIds: (region) => regionStateOf(current(), region).enabledModelIds ?? [],
		imageModelIds: (region) => regionStateOf(current(), region).imageModelIds ?? [],
		offModelIds: (region) => savedOffModelIds(regionStateOf(current(), region), displayModels(current(), region)),
		contextBudgets: (region) => regionStateOf(current(), region).contextBudgets ?? {},
		discoverModels,
		/**
		* This region's first-sighting readout, the data behind the composer pill's
		* "· N 新模型" segment.
		*
		* READ-ONLY here: only the reconciler's `note` writes first-sighting
		* history, so no amount of polling by the pill or the card can change who
		* counts as new — the one property that keeps the marker honest.
		*/
		rosterSeen: (region) => stacks[region].rosterSeen.readout(),
		mediaModels: readMediaModels,
		regionEnabled: (region) => regionEnabled(current(), region),
		/**
		* The region's committed sidebar-credit flag, read from the same config the
		* card writes. Exposed on the Host's answer because the browser settings
		* mirror goes stale for this namespace on the affected 0.1.7 deployments,
		* which made the switch look unable to turn the line off ("关闭不了").
		*/
		showCreditsInMainUi: (region) => regionStateOf(current(), region).showCreditsInMainUi !== false,
		/**
		* Whether the model may call the image tool here. Read from the committed
		* value like the flag above, and deliberately `=== true`: an absent setting
		* is NOT consent to let the model spend.
		*/
		imageToolEnabled: (region) => regionStateOf(current(), region).imageToolEnabled === true,
		/** Whether the model may call the video tool here. Same opt-IN read as above. */
		videoToolEnabled: (region) => regionStateOf(current(), region).videoToolEnabled === true,
		/**
		* The video model pinned per tag in this region, for the card's per-mode
		* picker. Read from the committed value like the switches above: the picker
		* must render what the TOOL will actually use, not what the browser mirror
		* happens to hold.
		*/
		preferredVideoModels: (region) => regionStateOf(current(), region).preferredVideoModels ?? {},
		/**
		* Whether the optional CodeBuddy CLI route is mounted (`codebuddy_ask` tool
		* + `/codebuddy` command).
		*
		* GLOBAL, so it takes no region. `=== true` like `imageToolEnabled`, not
		* `!== false`: switching this on lets a child process edit files and spend
		* CodeBuddy quota, so an absent value must read as OFF rather than as
		* consent. `cliBridge` is a volatile field, hence the unwrap.
		*/
		cliBridgeEnabled: () => unwrapVolatile(current().cliBridge)?.enabled === true,
		/**
		* The model / reasoning effort the optional CodeBuddy CLI route runs on.
		*
		* `cliBridge` is volatile, hence the unwrap; absent keys read as `''` —
		* "the CLI's own default" — because an empty pin is a COMMITTED value the
		* card's pickers can render, not a missing one.
		*/
		cliBridgeModel: () => unwrapVolatile(current().cliBridge)?.model ?? "",
		cliBridgeEffort: () => unwrapVolatile(current().cliBridge)?.effort ?? "",
		cliBridgeRegionOrder: () => unwrapVolatile(current().cliBridge)?.regionOrder ?? "",
		/**
		* Whether the request path drops foreign thinking blocks (issue #147), read
		* live so the card's switch reflects the value the NEXT request will use
		* rather than the one captured at mount.
		*/
		dropForeignThinking: () => unwrapVolatile(current().dropForeignThinking) === true,
		/**
		* What the last request had to drop, so the card can explain a turn that
		* arrived looking like working notes instead of leaving the user to conclude
		* the model broke. `undefined` until a request actually removes something —
		* an empty report would render as a permanent warning.
		*/
		latestForeignThinking: () => latestForeignThinking,
		/**
		* WHERE the readout sits, resolved here rather than read from the browser
		* settings mirror, for the same measured reason as the flag above: on the
		* affected 0.1.7 deployments that mirror never picks up this plugin's
		* writes, and a control reading it would keep showing the old seat.
		*/
		creditPosition: (region) => creditPositionOf(current(), region),
		/**
		* One minimal request per named model, through the region's own credential.
		*
		* Resolved here rather than in the route so the browser half never touches a
		* token: the route passes only model ids and receives only outcomes.
		*
		* `quotaRefreshAtMs` is the region's nearest monthly refresh point, read from
		* the SAME credit answer the card displays. It is the only cooldown this
		* service ever states — an exhausted monthly resource that resets at a known
		* time — so it is what makes "when can I use this again" answerable for an
		* out-of-credit result. Every other limited outcome has no time anywhere, and
		* the probe reports exactly that instead of inventing one.
		*/
		async probeModels(region, modelIds, options) {
			let credential;
			try {
				credential = await stacks[region].store.resolve();
			} catch (error) {
				return modelIds.map((modelId) => ({
					modelId,
					outcome: "credential-rejected",
					message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
				}));
			}
			const quotaRefreshAtMs = await quotaRefreshOf(region, credential);
			const results = [];
			for (const modelId of modelIds) results.push(await probeModel({
				client,
				credential,
				modelId,
				nowMs: Date.now(),
				...quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs },
				...options?.signal === void 0 ? {} : { signal: options.signal }
			}));
			return results;
		},
		/**
		* Output-speed measurement (issue #92), region-scoped like every other
		* spending path.
		*
		* Deliberately NOT routed through the probe's failover machinery: a speed
		* number describes the MODEL, and having the pool silently serve the run
		* from a different account would attach one account's rate limit (6004) to
		* another's measurement. The selected credential runs all three samples, so
		* "it failed" means this account could not measure it, which is the honest
		* answer.
		*/
		async measureTps(region, modelIds, options) {
			let credential;
			try {
				credential = await stacks[region].store.resolve();
			} catch (error) {
				const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
				return modelIds.map((modelId) => ({
					modelId,
					outcome: "credential-rejected",
					samples: 0,
					message
				}));
			}
			const results = [];
			for (const modelId of modelIds) {
				const sample = await measureTps({
					client,
					credential,
					modelId,
					...options?.signal === void 0 ? {} : { signal: options.signal }
				});
				results.push({
					modelId: sample.modelId,
					outcome: sample.tokensPerSecond === void 0 ? "failed" : "ok",
					...sample.tokensPerSecond === void 0 ? {} : { tokensPerSecond: sample.tokensPerSecond },
					...sample.timeToFirstTokenMs === void 0 ? {} : { timeToFirstTokenMs: sample.timeToFirstTokenMs },
					...sample.outputTokens === void 0 ? {} : { outputTokens: sample.outputTokens },
					samples: sample.samples,
					...sample.reason === void 0 ? {} : { reason: sample.reason },
					...sample.credit === void 0 ? {} : { credit: sample.credit }
				});
			}
			return results;
		},
		regionUsable(region, usable) {
			if (stacks[region].catalog.setRegionUsable(usable)) invalidateCatalog();
		},
		/**
		* The account pool, resolved per region.
		*
		* Region-scoped throughout: the CN and international pools are separate
		* stacks of accounts, so one region's pool can never rank or bill the
		* other's accounts.
		*
		* The pool decides who serves a FAILED request (see `failoverAccountFor`),
		* and it does so without writing `config.accounts[region]`: a retry borrows
		* another member's credential for that one request, leaving the record of
		* what the user picked — and the account the next request starts from —
		* untouched.
		*/
		pool: {
			preferences: (region) => poolPreferencesOf(current(), region),
			members: (region) => poolMembersOf(region),
			/**
			* The first-paint member list (issue #77): local state only.
			*
			* This is `localPoolMembers`, i.e. the SAME list the request path already
			* consults — saved members, their last credit snapshot (if it is still
			* fresh), and their last probe result. No upstream call, so the card's
			* account table can paint before any billing endpoint answers; live
			* figures arrive with the full document a moment later.
			*
			* A member whose credit snapshot has expired simply carries no `credits`,
			* which the card renders as "—" rather than as zero.
			*/
			localMembers: (region) => localPoolMembers(region),
			/**
			* The checked accounts that resolve to a local sign-in.
			*
			* A local scan only — no upstream calls — so the route's empty-pool guard
			* can use it on every batch. {@link poolMembersOf} is the expensive one
			* (it fetches credits per account) and is not suitable there.
			*/
			effectiveMemberAccountIds: async (region) => {
				const saved = poolPreferencesOf(current(), region).memberAccountIds;
				if (saved.length === 0) return [];
				const accounts = await stacks[region].store.accounts();
				return effectiveMembersOf(saved, new Set(accounts.map((account) => account.id)));
			},
			/**
			* Last measured display name per saved member id (issue #60).
			*
			* Answers the one question the card cannot answer itself: a saved member
			* whose sign-in is gone has no row in the roster, so the name the pool
			* once saw is the only thing that can identify it. Read from the runtime
			* probe store — no upstream call, and no credential touched.
			*
			* Best-effort, and deliberately NOT filtered to ghosts here: the route
			* knows which ids are unlisted (it built the roster) and names only
			* those, so this stays a plain lookup with one meaning.
			*/
			memberNames: async (region) => {
				const probes = await readPoolProbes(region);
				const names = {};
				for (const [accountId, probe] of Object.entries(probes)) {
					if (probe.accountName === void 0 || probe.accountName === "") continue;
					names[accountId] = probe.accountName;
				}
				return names;
			},
			/**
			* Local sign-ins the pool does NOT cover.
			*
			* Sent so the card can offer them to check in. Membership is an explicit
			* opt-in, and a user cannot opt in to an account the card never shows.
			*/
			async otherAccounts(region) {
				const wanted = new Set(poolPreferencesOf(current(), region).memberAccountIds);
				return (await stacks[region].store.accounts()).filter((account) => !wanted.has(account.id)).map((account) => ({
					id: account.id,
					accountName: account.accountName,
					...account.enterprise === true ? { enterprise: true } : {}
				}));
			},
			/**
			* Today's check-in state per account, for the pool table.
			*
			* Read per account through `credentialFor` (never `resolve`), so asking
			* about an account cannot change which one is billing. A per-account
			* failure is simply omitted, which the card renders as unknown.
			*/
			async checkedInToday(region) {
				if (!poolPreferencesOf(current(), region).enabled) return {};
				const store = stacks[region].store;
				const accounts = await store.accounts();
				const now = Date.now();
				const entries = await Promise.all(accounts.map(async (account) => {
					const cached = checkinStateCache[region]?.[account.id];
					if (cached !== void 0 && now - cached.atMs < CHECKIN_CACHE_MS) return [account.id, cached.checkedIn];
					const credential = await store.credentialFor(account.id).catch(() => void 0);
					if (credential === void 0) return void 0;
					const status = await client.fetchCheckinStatus(credential).catch(() => void 0);
					if (status === void 0) return void 0;
					checkinStateCache[region] = {
						...checkinStateCache[region],
						[account.id]: {
							checkedIn: status.todayCheckedIn,
							atMs: now
						}
					};
					return [account.id, status.todayCheckedIn];
				}));
				return Object.fromEntries(entries.filter((entry) => entry !== void 0));
			},
			/**
			* Today's check-in state from the cells already measured this process.
			*
			* The first-paint counterpart (issue #77) of `checkedInToday`: it reads
			* `checkinStateCache` and nothing else, so painting the table never waits
			* on one request per account. An unmeasured account is absent, which the
			* card already renders as unknown rather than as "not checked in".
			*/
			cachedCheckedInToday(region) {
				if (!poolPreferencesOf(current(), region).enabled) return {};
				const now = Date.now();
				const state = checkinStateCache[region] ?? {};
				const cached = {};
				for (const [accountId, entry] of Object.entries(state)) {
					if (now - entry.atMs >= CHECKIN_CACHE_MS) continue;
					cached[accountId] = entry.checkedIn;
				}
				return cached;
			},
			/**
			* Claimable promotional benefits per account (issue #79).
			*
			* Only campaigns the account can STILL claim are returned — a claimed or
			* lapsed one is absent, which is what the issue asked for. Absent means
			* the card shows no benefit line at all.
			*
			* Two status reads per account, so it is cached for `BENEFIT_CACHE_MS` and
			* skipped entirely when the pool is off (same reasoning as
			* `checkedInToday`: no table, no request).
			*/
			async benefits(region) {
				if (!poolPreferencesOf(current(), region).enabled) return {};
				const store = stacks[region].store;
				const accounts = await store.accounts();
				const now = Date.now();
				const entries = await Promise.all(accounts.map(async (account) => {
					const cached = benefitStateCache[region]?.[account.id];
					if (cached !== void 0 && now - cached.atMs < 18e5) return [account.id, cached.views];
					const credential = await store.credentialFor(account.id).catch(() => void 0);
					if (credential === void 0) return void 0;
					if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") return [account.id, []];
					const read = await client.fetchBenefits(credential).catch(() => void 0);
					if (read === void 0) return void 0;
					const views = claimableBenefits(read, now);
					benefitStateCache[region] = {
						...benefitStateCache[region],
						[account.id]: {
							views,
							atMs: now
						}
					};
					return [account.id, views];
				}));
				return Object.fromEntries(entries.filter((entry) => entry !== void 0));
			},
			/**
			* Claimable benefits from the readings already taken this process.
			*
			* The first-paint counterpart of `benefits`, mirroring
			* `cachedCheckedInToday`: no request, so painting never blocks on two
			* calls per account. An unmeasured account is absent, not empty.
			*/
			cachedBenefits(region) {
				if (!poolPreferencesOf(current(), region).enabled) return {};
				const now = Date.now();
				const state = benefitStateCache[region] ?? {};
				const cached = {};
				for (const [accountId, entry] of Object.entries(state)) {
					if (now - entry.atMs >= 18e5) continue;
					cached[accountId] = entry.views;
				}
				return cached;
			},
			/**
			* Drop one account's cached benefit reading (issue #79).
			*
			* The claim route writes upstream itself, so this cache is the ONLY thing
			* that can keep answering "claimable" after a successful claim — and it was
			* never invalidated: the credits went up, the 领取 pill stayed for up to 30
			* minutes, and the claim looked like it had silently failed. That is the
			* exact symptom the user reported. `checkin` already deletes its entries
			* after a batch; this is the same rule for the claim.
			*
			* Deleting (rather than overwriting with the post-claim read) keeps the
			* ownership where it belongs: the route already made the authoritative
			* re-read, and the next `benefits()` refills this from live data.
			*/
			invalidateBenefit(region, accountId) {
				const cached = benefitStateCache[region];
				if (cached !== void 0) delete cached[accountId];
			},
			async currentAccountId(region) {
				await applyPoolSelection(region).catch(() => void 0);
				const credential = await stacks[region].store.current().catch(() => void 0);
				if (credential === void 0) return void 0;
				if (await servingAccountIsExcluded(region).catch(() => false)) return void 0;
				return workbuddyAccountId(credential);
			},
			/**
			* Only the CN app rewards a daily check-in; the international region has
			* no equivalent here, so its card must not offer the action.
			*/
			checkinSupported: (region) => region === "cn",
			checkin: async (region) => {
				const rows = await checkinAllAccounts(await poolTargets(region), poolRunnerDeps(region));
				for (const row of rows) {
					if (row.status === "failed") continue;
					const cached = checkinStateCache[region];
					if (cached !== void 0) delete cached[row.accountId];
				}
				return rows;
			},
			test: async (region, modelId, onRow) => {
				const rows = await testAllAccounts(await poolTargets(region), modelId, poolRunnerDeps(region), onRow);
				await writePoolProbes(region, probeUpdatesOf(rows));
				return rows;
			},
			catalog: (region) => displayModels(current(), region),
			/**
			* Test ONE account against the region's target model.
			*
			* The per-row button's Host half. Reuses the batch's probe dependency
			* (same client, same probe size, same quota-refresh input) so a row
			* result and a batch result are the SAME measurement — only the
			* persistence is scoped to one id instead of every member.
			*
			* Returns undefined when the region cannot name a target model (the
			* same refusal the batch route reports as 409) — the card says so
			* rather than pretending a test ran.
			*/
			testOne: async (region, accountId) => {
				const target = regionTargetModel(region);
				if (target === void 0) return void 0;
				const store = stacks[region].store;
				const credential = await store.credentialFor(accountId).catch(() => void 0);
				if (credential === void 0) return {
					accountId,
					accountName: "",
					result: {
						modelId: target,
						outcome: "credential-rejected",
						status: 0,
						message: "no stored credential for this account"
					}
				};
				const accountName = (await store.accounts().catch(() => [])).find((account) => account.id === accountId)?.accountName ?? "";
				const result = await poolRunnerDeps(region).probe(credential, target);
				await writePoolProbes(region, probeUpdatesOf([{
					accountId,
					accountName,
					result
				}]));
				return {
					accountId,
					accountName,
					result
				};
			},
			/**
			* Forget ONE account's plugin-stored credential (the vault entry; the
			* desktop app's files are never touched). The card rescans afterwards,
			* so the row disappears the moment the write lands.
			*
			* AND DROP THE REGION'S PERSISTED PIN, when this was the pinned account
			* (issue #155's second report). `removeAccount` forgets the selection in
			* memory only, so the next `applySelection` — a restart, or any settings
			* save — re-reads the dead id out of `accounts.<region>`, re-pins it, and
			* the tab returns to「已保存的账号在本机已不存在」with the card's advice
			* pointing at a list that state does not render. The clear is decided from
			* the settings document rather than from the store, and is scoped to the
			* one region that pinned this account: an unrelated removal must not move
			* anybody off the account they chose.
			*
			* FAIL-SOFT, like the field repair above: the credential is already gone by
			* the time this runs, so a settings write that cannot land must not be
			* reported as a failed removal — that would tell the user the account is
			* still there when it is not.
			*/
			removeOne: async (region, accountId) => {
				const removed = await stacks[region].store.removeAccount(accountId);
				try {
					await clearRegionAccountSelection(hostSettings(), settingsNs, region, accountId, unwrapVolatile(current().accountId), legacyAccountRegion);
				} catch (error) {
					ctx.logger.warn("dsh-connect-workbuddy: the account was removed, but the region could not be un-pinned from settings; the selection may reappear as orphaned after a restart", error);
				}
				return removed;
			}
		},
		/**
		* OAuth QR sign-in for this card. The session lives in `src/oauth.ts`
		* (in-process, keyed by loginId); the Host's only extra duty is
		* persisting the finished credential into the region's vault — the same
		* store the request path reads, so the account is selectable the moment
		* the poll answers.
		*/
		oauth: {
			async start(region) {
				return oauthStart(region);
			},
			async poll(region, loginId) {
				const answer = await oauthPoll(loginId, region);
				if (!answer.done) return answer;
				if ("error" in answer) return answer;
				const store = stacks[region].store;
				const accountId = await store.addOAuthAccount({
					accessToken: answer.account.accessToken,
					refreshToken: answer.account.refreshToken,
					expiresAtMs: answer.account.expiresAtMs,
					...answer.account.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: answer.account.refreshExpiresAtMs },
					domain: answer.account.domain,
					uid: answer.account.uid,
					...answer.account.nickname === void 0 ? {} : { nickname: answer.account.nickname },
					...answer.account.uin === void 0 ? {} : { uin: answer.account.uin },
					...answer.account.enterpriseId === void 0 ? {} : { enterpriseId: answer.account.enterpriseId }
				}).catch((error) => {
					throw new Error("the account was signed in but could not be saved: " + (error instanceof Error ? error.message : String(error)));
				});
				return {
					done: true,
					accountId,
					accountName: (await store.accounts().catch(() => [])).find((account) => account.id === accountId)?.accountName ?? answer.account.nickname ?? ""
				};
			}
		},
		/**
		* Batch credential export / import, in the transfer file format the
		* sibling credential managers share. The Host owns every byte of the
		* vault; the route only ferries parsed answers.
		*/
		transfer: {
			async exportAccounts(region, accountIds) {
				const store = stacks[region].store;
				const accounts = await store.accounts().catch(() => []);
				const wanted = new Set(accountIds);
				const records = [];
				for (const account of accounts) {
					if (!wanted.has(account.id)) continue;
					const credential = await store.credentialFor(account.id).catch(() => void 0);
					if (credential === void 0) continue;
					records.push(transferRecordOf(credential, {
						auth: {
							accessToken: credential.accessToken,
							refreshToken: credential.refreshToken,
							expiresAt: credential.expiresAtMs > 0 ? Math.floor(credential.expiresAtMs / 1e3) : 0,
							...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAt: Math.floor(credential.refreshExpiresAtMs / 1e3) },
							...credential.lastRefreshAtMs === void 0 ? {} : { lastRefreshTime: Math.floor(credential.lastRefreshAtMs / 1e3) },
							domain: credential.domain
						},
						account: {
							uid: credential.uid,
							...credential.enterpriseId === void 0 ? {} : { enterpriseId: credential.enterpriseId },
							...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
							...credential.uin === void 0 ? {} : { uin: credential.uin }
						}
					}));
				}
				return { accounts: records };
			},
			async previewImport(region, text) {
				return previewTransferFile(text);
			},
			async importAccounts(region, text, indexes) {
				const { changes, imported, skipped } = mergeTransferRecords(parseTransferFile(text), indexes, region, (domain) => knownRegionOf(domain));
				const store = stacks[region].store;
				for (const [id, credential] of changes) await store.addOAuthAccount(credential).catch((error) => {
					throw new Error("imported account " + id + " could not be stored: " + (error instanceof Error ? error.message : String(error)));
				});
				return {
					imported,
					skipped
				};
			}
		}
	}));
	/**
	* The region's nearest monthly quota refresh, or undefined when unknown.
	*
	* The monthly resource (`CapacityType 4`) is the one package that never
	* expires and resets on a cycle, so its `refreshAtMs` is a real answer to
	* "when can I use this again" after the quota runs out. The probe passes it
	* through; a failure to read it is not an error, because a probe without a
	* cooldown is still a useful probe.
	*/
	const quotaRefreshOf = async (region, credential) => {
		try {
			const refreshes = (await client.fetchCredits(credential)).packages.filter((pack) => pack.monthly && pack.refreshAtMs !== void 0).map((pack) => pack.refreshAtMs);
			return refreshes.length === 0 ? void 0 : Math.min(...refreshes);
		} catch {
			return;
		}
	};
	/**
	* The next account to try for a request whose current account just failed,
	* or `undefined` when this region's pool has nobody left.
	*
	* Reads the pool's EXISTING measurements instead of probing: a request that
	* just failed must not spend further requests deciding who serves next (and a
	* probe of the target model would itself be billed). Candidates are this
	* region's checked-in members in rank order, minus everyone this request has
	* already tried, minus anyone a measurement says cannot serve right now — a
	* limited account whose stated cooldown has not elapsed, or one whose
	* credential the upstream rejected.
	*
	* The pool switch gates this: off means the user's account serves every
	* request and a failure is reported as-is, exactly as before the pool existed.
	*
	* Reads the candidate through `credentialFor()`, never `resolve()`: the saved
	* selection and the store's runtime state stay untouched, so this is
	* per-request borrowing rather than a silent change of who pays.
	*
	* Uses `localPoolMembers`, NOT `poolMembersOf`. This runs on the failure path
	* of a request the user is already waiting on, and `poolMembersOf` fetches
	* credits per member — so the expensive version turned one failed request into
	* N extra upstream calls before the retry even left. The doc above always said
	* "must not spend further requests"; the code used to contradict it. Credits
	* still steer the ranking when a recent snapshot exists, because
	* `localPoolMembers` reads the one the card's poll already paid for.
	*/
	const failoverAccountFor = async (region, triedAccountIds) => {
		if (!poolPreferencesOf(current(), region).enabled) return void 0;
		const tried = new Set(triedAccountIds);
		const order = poolPreferencesOf(current(), region).orderAccountIds;
		for (const row of rankPool(await localPoolMembers(region), Date.now(), order)) {
			if (row.excludedBy !== void 0) continue;
			if (tried.has(row.account.id)) continue;
			const credential = await stacks[region].store.credentialFor(row.account.id);
			if (credential !== void 0) return credential;
		}
	};
	/**
	* Why the pool left a failed request with nowhere to go, in one short clause.
	*
	* Runs ONLY after a request has already failed, so it may afford work the hot
	* path cannot — but it still reads local state only (the probe store and the
	* member list), because spending a network call to explain a failure would add
	* a second delay to a request the user is already waiting on.
	*
	* It counts rather than lists. The reply is one line inside an error message,
	* and enumerating accounts there would bury the advice; the card is where a
	* per-account breakdown belongs, and it already shows one.
	*
	* Returns `undefined` when the pool is OFF or has no members — in which case
	* there is no pool story to tell, and the shim renders its own sentence
	* without one. That is a real state, not a failure: the plugin supports
	* running with no pool at all.
	*/
	const explainPoolShortfall = async (region) => {
		if (!poolPreferencesOf(current(), region).enabled) return void 0;
		const members = await localPoolMembers(region);
		if (members.length === 0) return void 0;
		const nowMs = Date.now();
		const excluded = members.map((member) => ({
			id: member.account.id,
			excludedBy: exclusionOf(member.probe, nowMs)
		})).filter((entry) => entry.excludedBy !== void 0);
		if (excluded.length === 0) return "池中其余账号本次请求都已尝试过";
		const counts = /* @__PURE__ */ new Map();
		for (const entry of excluded) counts.set(entry.excludedBy, (counts.get(entry.excludedBy) ?? 0) + 1);
		return `池中已无可用账号（${[...counts.entries()].map(([reason, count]) => `${String(count)} 个${poolExclusionClause(reason)}`).join("、")}）`;
	};
	/**
	* One exclusion reason as a short Chinese clause for
	* {@link explainPoolShortfall}.
	*
	* Separate from the card's own labels (`exclusion-text.ts` in the client half)
	* on purpose: those are standalone table cells ("被限流"), where these are
	* glued into a sentence and must read after a count ("1 个账号被限流"). Sharing
	* one string would force one of the two to read wrong.
	*/
	function poolExclusionClause(reason) {
		switch (reason) {
			case "rate-limited": return "账号被限流";
			case "out-of-credit": return "账号积分耗尽";
			case "model-busy": return "账号撞上模型繁忙";
			case "credential-rejected": return "账号登录已失效";
			case "account-restricted": return "账号被上游限制使用";
			case "not-found": return "账号已不存在";
			case "unusable": return "账号不可用";
			default: return "账号不可用";
		}
	}
	/**
	* The last CREDITS reading per region, so a request can rank by balance
	* without fetching one.
	*
	* Credits are the ranking's second key, and they cost an upstream call per
	* member. A chat request must never pay that: it happens on the hot path, and
	* `fetchCredits` per member would turn one page of conversation into N extra
	* requests. So the request path uses whatever the pool last read (the card's
	* 60-second poll, a batch test, or a save) and simply skips the key when the
	* snapshot is too old to speak for today's balances.
	*/
	const creditsSnapshot = {};
	/** How long a credits reading may steer routing. */
	const CREDITS_SNAPSHOT_MS = 6e5;
	/** When each region's snapshot was taken, for the freshness check above. */
	const creditsSnapshotAt = {};
	/**
	* One region's pool members from LOCAL sources only: the credential store and
	* the probe store, plus the credits snapshot when it is fresh.
	*
	* The request path calls this on every chat completion, so it must not touch
	* the network. `poolMembersOf` is the honest-but-expensive version (it fetches
	* credits per member) and stays on the card's route, which is where those
	* readings come from in the first place.
	*/
	async function localPoolMembers(region) {
		const accounts = await poolMemberAccounts(region);
		const probes = await readPoolProbes(region);
		const credits = Date.now() - (creditsSnapshotAt[region] ?? 0) <= CREDITS_SNAPSHOT_MS ? creditsSnapshot[region] : void 0;
		return accounts.map((account) => {
			const reading = credits?.get(account.id);
			return {
				account: {
					id: account.id,
					accountName: account.accountName,
					...account.enterprise === true ? { enterprise: true } : {}
				},
				...reading === void 0 ? {} : { credits: reading },
				...probes[account.id] === void 0 ? {} : { probe: probes[account.id] },
				tokenExpiresAtMs: account.tokenExpiresAtMs
			};
		});
	}
	/**
	* Record a failure a LIVE request hit, so the NEXT request starts from a
	* usable account.
	*
	* Without this the ranking only knew what the manual batch test had measured:
	* an account that had just answered 429 carried no measurement, so
	* `exclusionOf` returned "candidate" and the ranking kept picking it — every
	* request paid one failed round trip before failing over. Keeping traffic off
	* an account the upstream just refused is the pool's whole point
	* (`account-pool.ts` says exactly that about `rate-limited`), and it only
	* works if live failures count as measurements.
	*
	* Deliberately NOT recorded for `client` (HTTP 400): the upstream rejected the
	* REQUEST, which says nothing about the account, and recording it would
	* sideline a good account over a bad body.
	*
	* The reset time comes from the upstream's own words — the 429 body carries
	* 「将在 … 重置」 — which `cooldownOf` parses. When it states no time, the store's
	* own short window applies rather than a guess at a long one.
	*
	* THE QUOTA REFRESH POINT IS PASSED IN, and it is not decoration. This path
	* used to omit `quotaRefreshAtMs` while the PROBE path supplied it, so one
	* `out-of-credit` failure got two different answers depending on which door it
	* arrived through: the probe said "the quota refreshes on the 1st" (a time the
	* billing side states outright) while a live chat failure said "30 minutes
	* from now" — a window the account cannot possibly clear, so the pool put it
	* back and paid another refused round trip. Worse, the write below combines
	* with the stored record, and the stored refresh point was being LOST in the
	* process (see {@link mergePoolProbe}).
	*
	* Reading it costs one `fetchCredits`, affordable here but not on every
	* failure: it runs only for `out-of-credit`, where the refresh point is the one
	* honest answer and there is no cheaper source. Failing to read it is not an
	* error — the fallback still applies.
	*
	* The upstream's text is persisted alongside the outcome so the card can name
	* the reason. It is REDACTED first because this message is a raw upstream body:
	* without that, a failure containing a token-shaped string would write it into
	* a file on disk.
	*/
	const recordAccountFailure = async (region, accountId, failure) => {
		if (!poolPreferencesOf(current(), region).enabled) return;
		if (failure.kind === "client") return;
		const members = poolPreferencesOf(current(), region).memberAccountIds;
		if (members.length > 0 && !members.includes(accountId)) return;
		const outcome = outcomeOfFailure(failure.status, failure.message);
		const quotaRefreshAtMs = outcome === "out-of-credit" ? await stacks[region].store.credentialFor(accountId).then((credential) => credential === void 0 ? void 0 : quotaRefreshOf(region, credential)).catch(() => void 0) : void 0;
		const { retryAtMs } = cooldownOf({
			outcome,
			retryAfter: null,
			nowMs: Date.now(),
			body: failure.message,
			...quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs }
		});
		const message = failure.message === "" ? "" : redactUpstreamText(failure.message);
		await writePoolProbes(region, { [accountId]: {
			outcome,
			atMs: Date.now(),
			source: "live-request",
			...failure.modelId === void 0 ? {} : { modelId: failure.modelId },
			...retryAtMs === void 0 ? {} : { retryAtMs },
			...message === "" ? {} : { message }
		} });
	};
	/**
	* Point this region's store at whoever the pool's ranking says should serve.
	*
	* Called once per chat request. With the pool ON the ranking decides the
	* serving account — the whole point of the switch, and the reason the card can
	* show a "current account" that is not simply the saved selection. With the
	* pool OFF the override is CLEARED, which restores the user's own choice
	* immediately: leaving a stale override in place would keep billing under a
	* switch that reads as off.
	*
	* The override is runtime-only and never written to settings, so the user's
	* recorded choice survives untouched either way — turning the pool off gives
	* it back verbatim.
	*
	* Best-effort: a failure here leaves the previous state in effect, and the
	* request still goes out (to the user's account when the pool is off, which is
	* the safe default).
	*/
	const applyPoolSelection = async (region) => {
		const store = stacks[region].store;
		if (!poolPreferencesOf(current(), region).enabled) {
			store.setRotatedAccount(void 0);
			return;
		}
		const winner = rankPool(await localPoolMembers(region), Date.now(), poolPreferencesOf(current(), region).orderAccountIds).find((row) => row.excludedBy === void 0);
		store.setRotatedAccount(winner?.account.id);
	};
	/**
	* Whether the account the store would bill is one the pool has measured as
	* unusable.
	*
	* The two questions differ exactly when the pool runs out of usable members: a
	* REQUEST still has to go somewhere (the saved selection), but the CARD must
	* not label that account "in use" while the same table says it is rate-limited.
	* One screen contradicting itself is how a user learns to trust neither half —
	* and "the pool moved to an available account" is unverifiable if the display
	* keeps naming an account the table calls excluded.
	*/
	const servingAccountIsExcluded = async (region) => {
		if (!poolPreferencesOf(current(), region).enabled) return false;
		const credential = await stacks[region].store.current().catch(() => void 0);
		if (credential === void 0) return false;
		const servingId = workbuddyAccountId(credential);
		const row = rankPool(await localPoolMembers(region), Date.now(), poolPreferencesOf(current(), region).orderAccountIds).find((candidate) => candidate.account.id === servingId);
		return row !== void 0 && row.excludedBy !== void 0;
	};
	/**
	* One region's POOL members, each with its credits and last measurement.
	*
	* Only CHECKED accounts: an unchecked account is not a candidate to bill, so
	* it must not reach the ranking that decides who serves.
	*
	* Read through `credentialFor()` — never `resolve()` — so no account's
	* selection state is touched: a batch must measure every member without
	* changing which one is billing. Credits are fetched per account and a
	* failure degrades to "unknown" for that row only — one unreadable balance
	* must not blank the whole pool.
	*/
	async function poolMembersOf(region) {
		const store = stacks[region].store;
		const accounts = await poolMemberAccounts(region);
		const probes = await readPoolProbes(region);
		const rows = await Promise.all(accounts.map(async (account) => {
			const credential = await store.credentialFor(account.id).catch(() => void 0);
			const credits = credential === void 0 ? void 0 : await client.fetchCredits(credential).catch(() => void 0);
			return {
				account: {
					id: account.id,
					accountName: account.accountName,
					...account.enterprise === true ? { enterprise: true } : {}
				},
				...credits === void 0 ? {} : { credits: {
					total: credits.total,
					expiringSoon: credits.expiringSoon,
					...credits.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: credits.nearestExpiryMs }
				} },
				...probes[account.id] === void 0 ? {} : { probe: probes[account.id] },
				tokenExpiresAtMs: account.tokenExpiresAtMs
			};
		}));
		creditsSnapshot[region] = new Map(rows.filter((row) => row.credits !== void 0).map((row) => [row.account.id, row.credits]));
		creditsSnapshotAt[region] = Date.now();
		return rows;
	}
	/**
	* The model a per-row test would use right now: the SAME resolution the
	* batch route performs (`resolveTargetModel` over the region's displayed
	* catalog and the saved preference — including a per-account override,
	* issue #61), so a row test and a batch test never measure different models.
	* Undefined mirrors the route's 409 states.
	*/
	const regionTargetModel = (region) => {
		return resolveTargetModel(displayModels(current(), region), poolPreferencesOf(current(), region).targetModelId).modelId;
	};
	/** One region's pool preferences, with the schema's defaults applied. */
	/**
	* WHERE this region's credit readout sits (issue #62).
	*
	* A local reader rather than a schema default so a config written before the
	* setting existed reads as `composer` — the seat that was the only one, so an
	* upgrade moves nothing on screen.
	*/
	const creditPositionOf = (config, region) => regionStateOf(config, region).creditPosition === "stats" ? "stats" : "composer";
	const poolPreferencesOf = (config, region) => {
		const pool = regionStateOf(config, region).pool;
		const probeInputTokens = pool?.probeInputTokens;
		return {
			enabled: pool?.enabled === true,
			targetModelId: pool?.targetModelId ?? "",
			...probeInputTokens === void 0 ? {} : { probeInputTokens },
			memberAccountIds: pool?.memberAccountIds ?? [],
			orderAccountIds: pool?.orderAccountIds ?? []
		};
	};
	/**
	* The accounts the user has checked into this region's pool.
	*
	* Membership is an EXPLICIT opt-in list, not "every local sign-in": the two
	* batch actions spend real credits and claim real rewards, so which accounts
	* they touch has to be the user's decision rather than a side effect of
	* having signed in on this machine. An account that is not checked is
	* untouched by check-in, testing, and rotation alike.
	*/
	async function poolMemberAccounts(region) {
		const saved = poolPreferencesOf(current(), region).memberAccountIds;
		if (saved.length === 0) return [];
		const accounts = await stacks[region].store.accounts();
		const byId = new Map(accounts.map((account) => [account.id, account]));
		return effectiveMembersOf(accounts.map((account) => account.id), new Set(saved)).flatMap((id) => {
			const account = byId.get(id);
			return account === void 0 ? [] : [account];
		});
	}
	/** The batch runner's view of one region's pool members. */
	async function poolTargets(region) {
		return (await poolMemberAccounts(region)).map((account) => ({
			accountId: account.id,
			accountName: account.accountName,
			...account.enterprise === true ? { enterprise: true } : {}
		}));
	}
	/**
	* The two actions' shared dependency set.
	*
	* `credentialFor` — never `resolve()` — is what makes a batch possible at
	* all: it fetches any account's credential WITHOUT changing the region's
	* selection, so testing every account cannot switch the account that bills
	* the user's live traffic.
	*/
	function poolRunnerDeps(region) {
		const store = stacks[region].store;
		return {
			credentialFor: (accountId) => store.credentialFor(accountId),
			fetchCheckinStatus: (credential) => client.fetchCheckinStatus(credential),
			claimDailyCheckin: (credential) => client.claimDailyCheckin(credential),
			probe: async (credential, modelId) => {
				const quotaRefreshAtMs = await quotaRefreshOf(region, credential);
				const inputTokens = resolveProbeInputTokens(poolPreferencesOf(current(), region).probeInputTokens);
				return probeModel({
					client,
					credential,
					modelId,
					nowMs: Date.now(),
					inputTokens,
					...quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs }
				});
			}
		};
	}
	ctx.inject(["settings"], (sctx) => {
		const settings = sctx.settings;
		ctx.effect(() => settings.configure({ auto: true }, ctx.fiber));
	});
	ctx.on("loader/volatile-update", () => {
		applySelection(current());
	});
	applySelection(config);
	(async () => {
		try {
			const region = await legacyAttributionRegion(current(), async (candidate) => stacks[candidate].store.accounts());
			if (region === void 0) return;
			legacyAccountRegion = region;
			applySelection(current());
		} catch {}
	})();
	let stopped = false;
	ctx.effect(() => () => {
		stopped = true;
		for (const region of REGION_KEYS) stacks[region].shim.close();
		clearHostHeartbeat();
	});
	Promise.all(REGION_KEYS.map((region) => stacks[region].shim.ready)).then(async () => {
		if (stopped) return;
		const adapters = {};
		const hostService = (name) => ctx.get(name);
		const contextRescue = createContextRescue(() => ({
			meter: hostService("tokenMeter"),
			compaction: hostService("compaction"),
			agents: hostService("agents"),
			log: (message, error) => {
				ctx.logger.warn(message, error);
			}
		}));
		try {
			for (const region of REGION_KEYS) adapters[region] = createWorkBuddyAdapter({
				shim: stacks[region].shim,
				store: stacks[region].store,
				catalog: stacks[region].catalog,
				provider: WORKBUDDY_PROVIDERS[region],
				displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES[region],
				resolveAttachments: () => ctx.get("attachments"),
				resolveContextRescue: () => contextRescue,
				dropForeignThinking: () => unwrapVolatile(current().dropForeignThinking) === true,
				retryPolicy: () => unwrapVolatile(current().retryPolicy) === void 0 ? void 0 : resolveRetryPolicy(unwrapVolatile(current().retryPolicy), `dsh-connect-workbuddy retryPolicy`),
				onForeignThinking: (blocks) => {
					latestForeignThinking = {
						blocks,
						atMs: Date.now()
					};
				}
			});
			invalidateCatalog = () => {
				for (const region of REGION_KEYS) adapters[region].invalidate();
			};
			let releaseAdapterCn;
			let releaseAdapterGlobal;
			let releaseDirectory;
			try {
				releaseAdapterCn = registration.cn.adapter = ctx.llm.registerAdapter([WORKBUDDY_PROVIDER], adapters.cn.adapter);
				releaseAdapterGlobal = registration.global.adapter = ctx.llm.registerAdapter([WORKBUDDY_GLOBAL_PROVIDER], adapters.global.adapter);
				releaseDirectory = registration.cn.directory = ctx.llm.registerConfigurableProviders([{
					provider: WORKBUDDY_PROVIDER,
					displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES.cn,
					settingsNs,
					settingsPath: [],
					declared: false
				}, {
					provider: WORKBUDDY_GLOBAL_PROVIDER,
					displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES.global,
					settingsNs,
					settingsPath: [],
					declared: false
				}]);
			} finally {
				if (releaseAdapterCn === void 0 || releaseAdapterGlobal === void 0 || releaseDirectory === void 0) {
					releaseAdapterCn?.();
					releaseAdapterGlobal?.();
					releaseDirectory?.();
				}
			}
			try {
				ctx.effect(() => () => {
					releaseAdapterCn?.();
					releaseAdapterGlobal?.();
					releaseDirectory?.();
				});
			} catch {
				releaseAdapterCn?.();
				releaseAdapterGlobal?.();
				releaseDirectory?.();
			}
			syncRegionRegistration(current());
			ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
				const region = regionOfProvider(request.provider ?? "");
				if (region === void 0) return [];
				if (!regionEnabled(current(), region)) return [];
				const discovered = await discoverModels(region, signal);
				const live = await withBusyLevels(region, discovered, signal);
				const state = regionStateOf(current(), region);
				return withImageSelection(deriveCatalog(live, new Set(state.enabledModelIds ?? []), state.contextBudgets ?? {}), new Set(state.imageModelIds ?? [])).map((model) => ({
					id: model.id,
					name: workBuddyDisplayName(model),
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					inputModalities: workBuddyModelInput(model)
				}));
			});
			writeHostHeartbeat();
		} catch (error) {
			ctx.logger.error("dsh-connect-workbuddy: provider registration failed", error);
			return;
		}
		if (stopped) return;
		const regionsFieldHealed = healRegionsFieldIfCorrupt();
		for (const region of REGION_KEYS) {
			if (!regionEnabled(current(), region)) continue;
			(async () => {
				try {
					const credential = await stacks[region].store.resolve();
					if (stopped) return;
					const models = await withBusyLevels(region, await client.fetchModels(credential, void 0, regionStateOf(current(), region).enabledModelIds ?? []));
					if (stopped) return;
					const state = regionStateOf(current(), region);
					stacks[region].catalog.set(withEffectiveOff(withImageSelection(deriveCatalog(models, new Set(state.enabledModelIds ?? []), state.contextBudgets ?? {}), new Set(state.imageModelIds ?? [])), new Set(savedOffModelIds(state, models))));
					adapters[region].invalidate();
					try {
						await stacks[region].rosterSeen.note(models.map((model) => model.id));
					} catch (error) {
						ctx.logger.warn(`dsh-connect-workbuddy: ${region} first-sighting history not updated`, error);
					}
					await regionsFieldHealed;
					await repairRegionCatalog(region, models);
				} catch (error) {
					ctx.logger.warn(`dsh-connect-workbuddy: dynamic ${region} model catalog unavailable; serving the static fallback list`, error);
				}
			})();
		}
	}).catch((error) => {
		ctx.logger.error("dsh-connect-workbuddy: loopback endpoint failed to start; providers not registered", error);
	});
}
//#endregion
export { CREDENTIAL_REJECTED_CODE, Config, DEFAULT_PROBE_INPUT_TOKENS, ENCRYPTED_CREDENTIAL_CODE, FALLBACK_WORKBUDDY_MODELS, FALLBACK_WORKBUDDY_MODELS_GLOBAL, NATIVE_MODALITY_BY_MODEL_ID, PROBE_INPUT_TOKEN_CHOICES, PROBE_MAX_TOKENS, PROBE_SYSTEM_PROMPT, REFUSES_OFF_MODEL_IDS, WORKBUDDY_ACCOUNTS_REFRESH_PATH, WORKBUDDY_APP_EXECUTABLE_ENV, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CHECKIN_PATH, WORKBUDDY_CONNECT_VERSION, WORKBUDDY_GLOBAL_PROVIDER, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_MODELS_REFRESH_PATH, WORKBUDDY_PROBE_PATH, WORKBUDDY_PROVIDER, WORKBUDDY_PROVIDERS, WORKBUDDY_PROVIDER_DISPLAY_NAMES, WORKBUDDY_REGIONS, WORKBUDDY_REGION_PARAM, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_TPS_PATH, WORKBUDDY_USAGE_PATH, WorkBuddyCatalog, WorkBuddyCredentialRejectedError, WorkBuddyCredentialStore, WorkBuddyEncryptedCredentialError, WorkBuddyUpstreamClient, apply, asVolatile, authFileName, classifyUpstreamError, clearAtRestKeyCache, clearHostHeartbeat, cooldownOf, createAccountUsabilityProbe, createWorkBuddyAdapter, createWorkBuddyShim, creditOfStream, defaultDesktopAuthCandidates, defaultDesktopAuthDirs, defaultDesktopAuthPath, defaultOffModelIds, deriveAtRestKey, deriveAtRestKeyId, deriveCatalog, fallbackModelsFor, fetchAtRestKeyPayload, findWorkbuddyAppExecutable, hasEncryptedCredentialFields, imageDefaultFor, imageToolRegionOf, inject, isCredentialRejectedError, isEncryptedCredentialError, isEncryptedFieldWrapper, isHeartbeatProcessAlive, isWorkbuddyBundle, knownRegionOf, legacyAttributionRegion, legacyWorkbuddyOwnAuthPath, macosBundleExecutable, macosNestedAppBundles, modelIdOfBody, name, nativeModalityOf, nextRegionEnabled, nextRegionSlots, offDefaultFor, openEncryptedField, outcomeOfFailure, parseCreditMultiplier, parseReasoning, parseRetryAfter, parseUpstreamModel, parseWorkBuddyAuth, prepareChatBody, probeModel, probeRequestBody, probeSucceeded, processStartTimeMs, readAtRestKey, readHostHeartbeat, regionCleared, regionEnabled, regionEnabledOf, regionOf, regionOfProvider, regionOfStatusUrl, regionStateOf, regionsFieldIsCorrupt, regionsMapOf, registerWorkBuddyStatusRoute, resolveCredentialRecovery, selectAccountFor, settingsNamespaceOf, toPersistedWorkBuddyModel, unwrapVolatileDeep, videoToolRegionOf, withEffectiveOff, withWorkBuddyRegion, workBuddyDisplayName, workBuddyModelInput, workBuddyThinkingLevelMap, workBuddyWebStatus, workbuddyAccountId, workbuddyAppExecutableCandidates, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, writeHostHeartbeat };
