window.__ModuleLoader__.load({
	id: "dsh-connect-workbuddy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
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
		* The project's public repository.
		*
		* Lives here rather than beside one component because TWO sections link to it
		* now — the model section and the account pool — and a second copy of a URL is
		* a second thing to forget when it moves. Node-free and side-effect free, so it
		* costs nothing on the Host side either.
		*/
		const WORKBUDDY_GITHUB_URL = "https://github.com/dingminhua/dsh-connect-workbuddy";
		/**
		* The page where a human claims a benefit: 「套餐与积分」.
		*
		* Named here rather than inline in the card because it is the page the benefit
		* line points at when the plugin itself declines to claim (an unknown campaign
		* kind). One constant keeps that pointer honest if the page moves.
		*/
		const WORKBUDDY_PLAN_URL = "https://www.workbuddy.cn/profile/plans-usage";
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
		/**
		* 设备头设置（「虚拟值 / 真实值」+ 每账号的覆盖参数）。
		*
		* 一条路由两种方法，因为读和写描述的是同一份文档：
		*   - `GET`  → `{ mode, accounts }`，卡片渲染切换项与每行的齿轮状态；
		*   - `POST` → 立即生效（不像账号池那样有草稿）：`{ kind: 'mode', mode }` 或
		*     `{ kind: 'account', accountId, machineId?, sessionId? }`。
		*
		* POST + loopback-only：写的是"这台机器对外声称自己是谁"，和凭据写入同级。
		* 之所以不挂在账号池的 `/pool` 下面：那份草稿是"点保存才生效"的偏好，而这里的
		* 两个动作都是即时生效，混在一条路由里会让"保存"按钮的语义变得说不清。
		*/
		const WORKBUDDY_DEVICE_PROFILE_PATH = "/plugins/dsh-connect-workbuddy/device-profile";
		/**
		* 真实设备参数（本机安装的桌面端 Turing Shield SDK）的状态与取值。
		*
		* - `GET` → `{ tier, sdk, token }`，`token` 只有掩码与长度；另带 `sdkEnabled`
		*   （总开关的当前值），供卡片画出那个勾选框。
		* - `POST ?action=refresh` → 强制重取一次，再返回同一形状。
		* - `POST ?action=reveal` → `{ token }`，完整值，**只在用户显式点击时**。
		* - `POST ?action=enable|disable` → 写总开关。
		*
		* 为什么把"完整值"单独做成一个动作：这是一枚能代表这台机器的凭据，卡片是
		* 一个会被截图、被贴进 issue 的界面。默认只给掩码，复制/查看各要一次显式动作。
		*/
		const WORKBUDDY_DEVICE_SDK_PATH = "/plugins/dsh-connect-workbuddy/device-sdk";
		/** How long the card waits between polls while the user is scanning. */
		const OAUTH_POLL_INTERVAL_MS = 2e3;
		/**
		* The refresh intervals the card offers, in milliseconds.
		*
		* SHARED between the Host (which validates the saved value) and the browser
		* (which renders the dropdown), so the control and its validation cannot drift:
		* a value the dropdown can produce is always a value the Host accepts, and the
		* Host's fallback is always a value the dropdown can show.
		*
		* A CLOSED SET rather than a free number because this interval decides the
		* plugin's upstream request volume — one credits read plus one check-in read per
		* pooled account, per refresh.
		*/
		const WORKBUDDY_POLL_INTERVALS_MS = [
			6e4,
			3e5,
			6e5,
			18e5,
			36e5
		];
		/**
		* The default refresh interval: 5 minutes.
		*
		* Moved off the old hard-coded 60 s. A 4-account pool at 60 s costs ~11,520
		* requests a day for figures that move slowly; 5 minutes is a fifth of that and
		* still five times finer than the 30-minute auto check-in heartbeat.
		*/
		const WORKBUDDY_DEFAULT_POLL_INTERVAL_MS = 3e5;
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
		/** Address one region's pool endpoint with an action. */
		function withWorkBuddyRegionAndAction(path, region, action) {
			return `${withWorkBuddyRegion(path, region)}&${WORKBUDDY_POOL_ACTION_PARAM}=${action}`;
		}
		/**
		* Address one region's endpoint for ANY route that dispatches on `action`.
		*
		* The OAuth and transfer routes reject a request with no action (400), so
		* their callers must build the URL here rather than with
		* {@link withWorkBuddyRegion} — a request missing the parameter fails the same
		* way whether the omission was a mistake or not.
		*/
		function withWorkBuddyRouteAction(path, region, action) {
			return `${withWorkBuddyRegion(path, region)}&${WORKBUDDY_POOL_ACTION_PARAM}=${action}`;
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
		* Address one region's status route for its first-paint document.
		*
		* The Host answers this from local state only (no upstream read, no token
		* refresh), so a slow billing endpoint cannot decide when the account list
		* appears. The card paints it first and then upgrades the same snapshot from
		* the full document.
		*/
		function withWorkBuddyRegionFastDetail(path, region) {
			return `${withWorkBuddyRegion(path, region)}&${WORKBUDDY_DETAIL_PARAM}=${WORKBUDDY_DETAIL_FAST}`;
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
				if (!isRecord(candidate["regions"]) && !carriesForeignKey(candidate)) return candidate;
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
			"defaultThinkingEfforts",
			"pool"
		]);
		/** A non-null, non-array object: the only shape a slot or a level can have. */
		function isRecord(value) {
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
			if (isRecord(pool)) {
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
			if (isRecord(budgets) && Object.keys(budgets).length > 0) weight += 1;
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
				if (!isRecord(nested)) break;
				for (const region of WORKBUDDY_REGIONS) {
					if (region in map) continue;
					const candidate = nested[region];
					if (!isRecord(candidate)) continue;
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
		/**
		* Build the next `regions` settings value for a provider on/off toggle. ONLY
		* the target region's `enabled` flag changes: every other field of that slot
		* (its directory, selection, image opt-ins, context budgets) and every other
		* region's slot are carried over verbatim, so switching a provider off never
		* discards the user's model picks and switching it back on restores them.
		*
		* This is deliberately separate from {@link nextRegionSlots}: that helper
		* writes a whole slot from a signed-in tab's draft, while this one must work
		* for a region that is signed OUT — which is precisely the region a user wants
		* to switch off (no international install, no international account).
		*
		* `value` may be the whole settings section or the `regions` map; the RETURN
		* value is always the `regions` map, i.e. exactly what `settingsScope.set(
		* 'regions', ...)` needs.
		*/
		/**
		* Build the next `regions` settings value for a MODEL-LIST save.
		*
		* The model save replaces a region slot wholesale, so the merge has to start
		* from the EXISTING slot rather than from a fresh object: the pool's
		* preferences live in that same slot, and a save that omitted them would delete
		* settings the user configured elsewhere in the card. Every writer that owns
		* only part of a slot goes through a helper like this one.
		*/
		function nextRegionModels(value, region, models) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				...models
			});
		}
		/**
		* Build the next `regions` settings value for a POOL-PREFERENCES save.
		*
		* Same reasoning as {@link nextRegionModels}: the pool is one field of a slot
		* that also holds the model list, so the merge starts from the existing slot.
		*/
		function nextRegionPool(value, region, pool) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				pool
			});
		}
		function nextRegionEnabled(value, region, enabled) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				enabled
			});
		}
		/**
		* Build the next `regions` FIELD carrying one region's CN gateway override
		* (issue #220).
		*
		* Same whole-slot merge as every other helper here: only `cnBase` changes, so
		* setting a host cannot drop the model directory, the pool preferences or the
		* switches that share this slot. An empty string is written as-is rather than
		* deleting the key — it means "back to the built-in gateway", which must survive
		* a read-back, and `resolveCnGateway('')` already reads both the same way.
		*/
		function nextRegionCnBase(value, region, cnBase) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				cnBase
			});
		}
		/**
		* Read one region's saved CN gateway override, or `''` when it has none.
		*
		* Deliberately tolerant of a non-string: the settings mirror can hold whatever a
		* previous version wrote, and throwing here would take out the whole capabilities
		* panel over one malformed field. A value that is not a string is treated as
		* "not configured", which is exactly how `resolveCnGateway` treats it.
		*/
		function regionCnBaseOf(value, region) {
			const raw = regionSlotOf(value, region)["cnBase"];
			return typeof raw === "string" ? raw : "";
		}
		/**
		* Whether one region's sidebar credit line is shown. Opt-out: only an explicit
		* `false` hides it, so a config written before this switch existed keeps the
		* line visible exactly as a fresh install does.
		*
		* Per-REGION by construction (it reads one region's slot), which is the point:
		* WB CN and WB AI are separate accounts on separate gateways, so "show credits"
		* is not one decision. `value` may be the whole settings section or the
		* `regions` map itself.
		*/
		function regionCreditsShownOf(value, region) {
			return regionSlotOf(value, region)["showCreditsInMainUi"] !== false;
		}
		/**
		* Whether the model may call the image-generation tool in one region.
		*
		* OPT-IN, unlike every other switch in this file: absent reads as `false`. The
		* asymmetry is deliberate. The credit line and the provider switch are things
		* whose absence should behave like a fresh install (on), because a hidden line
		* or a withdrawn provider is recoverable by clicking. This one authorizes the
		* MODEL to spend credits on its own — about 5.71 per image, with no per-call
		* approval available in the host — so an upgrade or an unreadable setting must
		* leave it OFF rather than silently grant it.
		*/
		function regionImageToolEnabledOf(value, region) {
			return regionSlotOf(value, region)["imageToolEnabled"] === true;
		}
		function regionVideoToolEnabledOf(value, region) {
			return regionSlotOf(value, region)["videoToolEnabled"] === true;
		}
		/**
		* The video model pinned per tag in one region, or an empty record.
		*
		* A PIN, not an authorisation: reading it grants nothing, and an absent entry
		* merely means the tool takes that tag group's first model. Values are model ids
		* from the same region's catalog. A stale id is tolerated on purpose — a catalog
		* can drop a model the user had pinned, and that must not turn into a failed
		* generation (the tool falls back to the group's first model).
		*/
		function regionPreferredVideoModelsOf(value, region) {
			const raw = regionSlotOf(value, region)["preferredVideoModels"];
			if (typeof raw !== "object" || raw === null) return {};
			const out = {};
			for (const [tag, id] of Object.entries(raw)) if (typeof id === "string" && id !== "") out[tag] = id;
			return out;
		}
		/**
		* Build the next `regions` settings value for one pinned video model.
		*
		* `modelId` of `undefined` or `''` CLEARS that tag's pin, which is why this is
		* a three-state write rather than a boolean: the card's picker has a "no pin"
		* row, and deleting the key is what makes the absence mean "nothing pinned"
		* again (an empty string would be a value the tool would have to special-case).
		*
		* Same merge rule as the switches above: only this region's field changes.
		*/
		function nextRegionPreferredVideoModels(value, region, tag, modelId) {
			const pinned = { ...regionPreferredVideoModelsOf(value, region) };
			if (modelId === void 0 || modelId === "") delete pinned[tag];
			else pinned[tag] = modelId;
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				preferredVideoModels: pinned
			});
		}
		/** The seat a region's readout uses, defaulting to the composer row. */
		function regionCreditPositionOf(value, region) {
			return regionSlotOf(value, region)["creditPosition"] === "stats" ? "stats" : "composer";
		}
		/**
		* Build the next `regions` settings value for one region's credit seat.
		*
		* Same merge rule as {@link nextRegionCreditsShown}: only the target region's
		* field changes, so every other field of that slot and every other region's slot
		* survive the write.
		*/
		function nextRegionCreditPosition(value, region, position) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				creditPosition: position
			});
		}
		/**
		* Build the next `regions` settings value for the sidebar-credit on/off toggle.
		*
		* Same merge rule as {@link nextRegionEnabled}: ONLY the target region's flag
		* changes, so every other field of that slot (directory, selection, pool
		* preferences) and every other region's slot survive the write.
		*/
		function nextRegionCreditsShown(value, region, shown) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				showCreditsInMainUi: shown
			});
		}
		/**
		* Build the next `regions` settings value for the new-model-segment opt-in.
		*
		* Same merge rule as everything else here: ONLY the target region's flag
		* changes, so the directory, the model selection, the credit switches and the
		* sibling region all survive the write.
		*/
		function nextRegionNewModelsShown(value, region, shown) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				showNewModelsInMainUi: shown
			});
		}
		/**
		* Read the new-model-segment opt-in: ON only when explicitly `true`.
		*
		* The mirror image of {@link regionCreditsShownOf}, and deliberately so. That
		* one is opt-OUT (`!== false`), this one is opt-IN (`=== true`), because
		* announcing "N new models" on a fresh install announces the entire roster.
		*/
		function regionNewModelsShownOf(value, region) {
			return regionSlotOf(value, region)["showNewModelsInMainUi"] === true;
		}
		/**
		* Build the next `regions` settings value for the image-tool opt-in.
		*
		* Same merge rule: ONLY the target region's flag changes, so the directory,
		* the model selection and the sibling region survive the write.
		*/
		function nextRegionImageToolEnabled(value, region, enabled) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				imageToolEnabled: enabled
			});
		}
		function nextRegionVideoToolEnabled(value, region, enabled) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				videoToolEnabled: enabled
			});
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
		/**
		* Every namespace spelling the browser half follows when looking for the
		* settings form the Host actually serves, in preference order.
		*
		* `describe()` keys a form by its Loader entry id, and the profile patch picks
		* that id — so the plugin must ASK rather than assume. The observed spellings
		* are the bare package name, the `include:`-wrapped id the live Desktop host
		* uses, and the declared name as the last resort. `configForms.whileServed`
		* follows all of them and re-runs when the mirror arrives, which is what keeps
		* the binding correct on a host whose mirror populates after `apply` (the
		* 4.3.0 readout defect, issue #46).
		*/
		const WORKBUDDY_SETTINGS_NAMESPACE_CANDIDATES = [
			"dsh-connect-workbuddy",
			"include:dsh-connect-workbuddy",
			WORKBUDDY_SETTINGS_NS
		];
		/**
		* The `id` of this plugin's page in the Settings panel's left-hand navigation.
		*
		* ## Why the configuration moved here (5.19.0)
		*
		* It used to live ONLY in the Plugins page's `plugins.bundle.config` /
		* `plugins.row.config` keyed slots, looked up by `<package name>`. That is a
		* KEYED slot: the page renders it with `entryKey: pkg.name` and gates the whole
		* section on `ledger.bundles.has(pkg.name)`, an EXACT string comparison against
		* the plugin-manager inventory's package name while a deployment is free to
		* mount the same code under a different Loader entry id. Two spellings had to
		* be registered to cover it (issue #55), and a spelling nobody predicted
		* rendered nothing at all — no section, no placeholder, no error.
		*
		* `settings.section` is a LIST slot keyed by an id **this plugin owns**. There
		* is no inventory name to match, so the whole class of mismatch disappears,
		* and the user finds the configuration where every other preference lives.
		*
		* ## The id is also the icon's address
		*
		* The shell renders `settings.section.icon` with `{ only: row.id }`, so the
		* glyph must register under this same string. Both registrations come from one
		* `inject` callback so the pairing is structural rather than a convention.
		*
		* Deliberately the bare, unnamespaced plugin name and NOT one of
		* {@link WORKBUDDY_SETTINGS_NAMESPACE_CANDIDATES}: those are Loader entry ids
		* the Host happens to serve, while this id is ours and must be stable across
		* deployments.
		*/
		const WORKBUDDY_SETTINGS_SECTION_ID = "dsh-connect-workbuddy";
		//#endregion
		//#region src/client/account-selection.ts
		/**
		* Verified writes of the per-region account slot.
		*
		* 参考：DSH 自带插件卡片（`@deepseek-ai/dsh-client-ui-settings-plugins`
		*   的 `CardForm.store()`）— 「写入后回读用户层并与写入值比对」这一校验形态，
		*   是本模块 `writeAccountSlot()` 的出发点。
		* 改动：针对账号槽位重写而非照搬 —— 回读的是**解析后的 section**而非 user 层
		*   （Host 的 legacy 归属也读它，两者必须同源），并用精确比较区分 `''`（哨兵清除）
		*   与 `undefined`（键缺失），因为后者会让区域重新回退到旧版 `accountId`。
		*
		* Kept out of `WorkBuddyCard.tsx` — and free of any browser-only import — so
		* the write contract can be unit-tested directly. The card is a `.tsx`
		* component whose module graph pulls DSH's browser packages, which cannot load
		* in the Node test environment; the check below is exactly the part that must
		* not go untested.
		*
		* @module dsh-connect-workbuddy/client/account-selection
		*/
		/**
		* A settings write that did not take effect.
		*
		* Distinct from a rejected `set()`: this is thrown when the write reported
		* success and the value is nonetheless absent from the document.
		*/
		var WorkBuddySettingsWriteError = class extends Error {
			/** The settings field that did not land. */
			field;
			constructor(field, reason) {
				super(`workbuddy: settings field "${field}" was not persisted by the settings write${reason === void 0 ? "" : `: ${reason}`}`);
				this.name = "WorkBuddySettingsWriteError";
				this.field = field;
			}
		};
		/**
		* Whether a save failure is a FILE-CONTENTION refusal.
		*
		* On Windows, replacing a file that another process holds open fails with
		* `EPERM` / `EBUSY` / `EACCES` — an antivirus scanner, a sync client (OneDrive),
		* or an editor with the profile's patch file open. POSIX `rename` replaces
		* outright regardless of open handles, so this branch effectively never fires
		* on macOS/Linux: the diagnosis is Windows-shaped because the failure is.
		*
		* It exists so a save failure can say WHAT TO DO. Without it the card pasted the
		* raw error at the user — `EPERM: operation not permitted, rename
		* 'C:\…\cordis.patch.yml.79498ff8fb27.tmp' -> '…\cordis.patch.yml'` — which
		* names a temp path and no remedy. Measured live against the 3.0.0 host with the
		* file held open: both the `regions` and `accounts` writes came back HTTP 500
		* with exactly that text.
		*
		* Deliberately matched on the message rather than on `WorkBuddySettingsWriteError`
		* alone: a validation refusal is also that class but has nothing to do with file
		* contention, and telling such a user to close their editor would send them
		* chasing a cause that is not there.
		*/
		function isFileContentionWriteError(error) {
			const message = error instanceof Error ? error.message : String(error);
			return /\b(?:EPERM|EBUSY|EACCES)\b/u.test(message);
		}
		/**
		* Read one settings field's current object value from the scope snapshot.
		*
		* The snapshot holds the RESOLVED section, where a volatile field
		* (`regions` / `accounts`) is a `{get(): T}` LIVE reference rather than the
		* plain object it resembles. Unwrapping first is not cosmetic: a live reference
		* is still `typeof === 'object'`, so without this the caller spreads it into
		* `{ get: <function> }` — which DROPS every sibling key (the other region) and
		* leaks a reference function into the document.
		*
		* That was the "saving the international region loses the domestic one" report:
		* every write here preserves the region it is not touching by spreading this
		* value, so reading it wrong silently deleted the untouched region.
		*/
		function fieldSnapshotOf(scope, field) {
			const stored = scope.getSnapshot().value?.[field];
			if (field === "regions") return regionsMapOf(stored);
			const value = unwrapVolatileDeep(stored);
			return typeof value === "object" && value !== null ? value : {};
		}
		/**
		* Fallback write: POST the field to the plugin's own Host endpoint.
		*
		* The endpoint handler runs the settings mutate inside the Host process and
		* reports the raw refusal exception, so a failure here names its cause instead
		* of arriving as a swallowed `ok:false`. It merges the posted region key into
		* the field's live value, preserving the other region.
		*/
		async function saveViaHostEndpoint(field, region, value) {
			let response;
			try {
				response = await fetch("/plugins/dsh-connect-workbuddy/__save", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						field,
						value: region === void 0 ? value : { [region]: value }
					})
				});
			} catch (error) {
				throw new WorkBuddySettingsWriteError(field, `Host save endpoint unreachable: ${String(error)}`);
			}
			if (!response.ok) {
				const detail = await response.json().catch(() => ({ error: `HTTP ${String(response.status)}` }));
				const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
				throw new WorkBuddySettingsWriteError(field, `Host save refused: ${reason === "" ? String(detail.error) : reason}`);
			}
			return (await response.json().catch(() => void 0))?.value;
		}
		/**
		* Read the committed CodeBuddy-CLI switch out of a settings snapshot.
		*
		* Only an explicit `true` is ON, matching the schema's `default(false)`: this
		* switch authorizes a child process that edits files and spends CodeBuddy
		* quota, so an absent value must never read as consent.
		*/
		function cliBridgeEnabledOf(configured) {
			const bridge = configured?.cliBridge;
			return typeof bridge === "object" && bridge !== null && bridge.enabled === true;
		}
		/**
		* Read one upstream-identity boolean switch out of a settings snapshot.
		*
		* Only an explicit `true` is ON, exactly like {@link cliBridgeEnabledOf} and for
		* the same reason: these switches change what gets billed or what bytes go
		* upstream, so a missing or malformed value must read as OFF, never as consent.
		*
		* @param configured - the whole settings snapshot.
		* @param field - which switch to read.
		* @returns whether the switch is on.
		*/
		function upstreamSwitchOf(configured, field) {
			const value = configured?.[field];
			return unwrapVolatileDeep(value) === true;
		}
		/**
		* Read the `sessionTitle` switch's two values out of a settings snapshot.
		*
		* Returns the schema's own defaults (`enabled: false`, `model: 'wb-lite'`) for
		* anything missing or malformed, so the card shows what the plugin will actually
		* do rather than an empty control.
		*
		* @param configured - the whole settings snapshot.
		* @returns the switch state and target model.
		*/
		function sessionTitleOf(configured) {
			const raw = unwrapVolatileDeep(configured?.["sessionTitle"]);
			const block = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
			const model = block["model"];
			return {
				enabled: block["enabled"] === true,
				model: typeof model === "string" && model.trim() !== "" ? model.trim() : "wb-lite"
			};
		}
		/**
		* Read the extra injected-prefix list out of a settings snapshot.
		*
		* A non-array or a list containing non-strings reads as empty: a malformed entry
		* must not silently start matching messages it was never meant to match.
		*
		* @param configured - the whole settings snapshot.
		* @returns the literal prefixes, trimmed, without blanks or duplicates.
		*/
		function extraInjectedPrefixesOf(configured) {
			const raw = unwrapVolatileDeep(configured?.["extraInjectedPrefixes"]);
			if (!Array.isArray(raw)) return [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of raw) {
				if (typeof entry !== "string") continue;
				const trimmed = entry.trim();
				if (trimmed !== "") seen.add(trimmed);
			}
			return [...seen];
		}
		/**
		* The `channelRejectContinue` block's defaults, mirroring the Host schema.
		*
		* Duplicated here rather than imported from the Host entry on purpose: this
		* module is the browser half's node-free boundary (`src/index.ts` pulls in the
		* whole provider stack), and the two values must agree, which a test pins.
		*/
		const CHANNEL_CONTINUE_DEFAULTS = {
			enabled: false,
			maxConsecutive: 1,
			text: "继续"
		};
		/**
		* Read the `channelRejectContinue` block out of a settings snapshot.
		*
		* Same defensive shape as {@link sessionTitleOf}: anything missing or malformed
		* resolves to the schema's own defaults, so the card shows what the plugin will
		* actually do instead of an empty control — and an absent block reads as OFF,
		* because enabling this spends real requests without the user typing anything.
		*
		* @param configured - the whole settings snapshot.
		* @returns the three values the switch renders.
		*/
		function channelRejectContinueOf(configured) {
			const raw = unwrapVolatileDeep(configured?.["channelRejectContinue"]);
			const block = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
			const max = block["maxConsecutive"];
			const capped = typeof max === "number" && Number.isFinite(max) ? Math.min(10, Math.max(1, Math.trunc(max))) : CHANNEL_CONTINUE_DEFAULTS.maxConsecutive;
			const text = block["text"];
			return {
				enabled: block["enabled"] === true,
				maxConsecutive: capped,
				text: typeof text === "string" && text.trim() !== "" ? text.trim() : CHANNEL_CONTINUE_DEFAULTS.text
			};
		}
		/**
		* Write one upstream-identity switch, verifying it landed.
		*
		* Same two writers as {@link writeCliBridgeEnabled} and for the same measured
		* reason (the browser mirror of this namespace is documented as stale on the
		* affected 0.1.7 deployments, so a switch that merely *looks* flipped is the
		* "关闭不了" class of report): the Host endpoint first, the settings scope as a
		* fallback. The Host writes only this field's own path, so siblings survive.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param field - which switch to write.
		* @param value - the desired value.
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeUpstreamSwitch(scope, field, value) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint(field, void 0, value);
				if (authoritative !== void 0) try {
					await scope.set(field, authoritative[field]);
				} catch {}
				return;
			} catch (error) {
				hostError = error;
			}
			let delivered = false;
			try {
				delivered = await scope.set(field, value) !== false;
			} catch {
				delivered = false;
			}
			if (delivered) {
				const after = scope.getSnapshot().value;
				if (field === "usageIdentity" || field === "keepPromptLast" || field === "dropAllThinking" ? upstreamSwitchOf(after, field) === value : field === "sessionTitle" ? JSON.stringify(sessionTitleOf(after)) === JSON.stringify(value) : field === "channelRejectContinue" ? JSON.stringify(channelRejectContinueOf(after)) === JSON.stringify(value) : JSON.stringify(extraInjectedPrefixesOf(after)) === JSON.stringify([...value])) return;
			}
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Write the GLOBAL CodeBuddy-CLI switch, verifying it landed.
		*
		* Deliberately NOT a region field: one route, one budget, one switch. The two
		* writers are the same as everywhere else — the plugin's Host endpoint first
		* (authoritative merge, so the tuned caps beside `enabled` survive), the
		* settings scope second — because this namespace's browser mirror is documented
		* as stale on the affected 0.1.7 deployments, and a switch that merely *looks*
		* flipped is exactly the "关闭不了" class of report.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param enabled - the desired state.
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeCliBridgeEnabled(scope, enabled) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint("cliBridge", void 0, { enabled });
				if (authoritative !== void 0) try {
					await scope.set("cliBridge", authoritative);
				} catch {}
				return;
			} catch (error) {
				hostError = error;
			}
			const stored = unwrapVolatileDeep(scope.getSnapshot().value?.cliBridge);
			const next = {
				...typeof stored === "object" && stored !== null ? stored : {},
				enabled
			};
			let delivered = false;
			try {
				delivered = await scope.set("cliBridge", next) !== false;
			} catch {
				delivered = false;
			}
			if (delivered && cliBridgeEnabledOf(scope.getSnapshot().value)) return;
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError("cliBridge", "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Read the opt-in DSH sidebar panel switch out of a settings snapshot.
		*
		* Only an explicit `true` is ON, matching the schema's `default(false)` and
		* every other switch in this file: the row claims a GLOBAL sidebar seat shared
		* by every installed bundle, so an absent or malformed value must read as
		* "did not ask for this", never as consent.
		*
		* @param configured - the whole settings snapshot.
		* @returns whether the panel row should exist.
		*/
		function sidebarPanelEnabledOf(configured) {
			const value = configured?.["sidebarPanel"];
			return unwrapVolatileDeep(value) === true;
		}
		/**
		* Write the opt-in DSH sidebar panel switch, verifying it landed.
		*
		* Same two writers and same reasoning as {@link writeCliBridgeEnabled}: the
		* Host endpoint first (it is the authoritative merge and reports its own
		* refusal), the settings scope second, because this namespace's browser mirror
		* is documented as stale on the affected 0.1.7 deployments — and a sidebar row
		* that merely *looks* present while the Host disagrees is worse than no row.
		*
		* A plain top-level boolean, so it is set on its own path; there is no sibling
		* state inside the field to preserve.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param enabled - the desired state.
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeSidebarPanelEnabled(scope, enabled) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint("sidebarPanel", void 0, enabled);
				if (authoritative !== void 0) try {
					await scope.set("sidebarPanel", authoritative["sidebarPanel"]);
				} catch {}
				return;
			} catch (error) {
				hostError = error;
			}
			let delivered = false;
			try {
				delivered = await scope.set("sidebarPanel", enabled) !== false;
			} catch {
				delivered = false;
			}
			if (delivered && sidebarPanelEnabledOf(scope.getSnapshot().value)) return;
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError("sidebarPanel", "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Read the card's refresh interval out of a settings snapshot.
		*
		* Coerced against the offered set, and an unrecognized value reads as the
		* default. The direction matters: this number drives `setInterval`, so a typo in
		* the settings file must not become a sub-second poll. Coercing on READ as well
		* as on the Host means a stale browser mirror cannot arm a cadence the Host
		* would have refused.
		*/
		function pollIntervalMsOf(value) {
			const raw = value?.pollIntervalMs;
			return typeof raw === "number" && WORKBUDDY_POLL_INTERVALS_MS.includes(raw) ? raw : WORKBUDDY_DEFAULT_POLL_INTERVAL_MS;
		}
		/**
		* Persist the card's refresh interval.
		*
		* Same two-writer shape as {@link writeSidebarPanelEnabled}: the Host endpoint is
		* authoritative, the settings scope is the fallback for an older Host. A plain
		* top-level number, so there is no sibling state to preserve.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param intervalMs - one of {@link WORKBUDDY_POLL_INTERVALS_MS}.
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writePollIntervalMs(scope, intervalMs) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint("pollIntervalMs", void 0, intervalMs);
				if (authoritative !== void 0) try {
					await scope.set("pollIntervalMs", authoritative["pollIntervalMs"]);
				} catch {}
				return;
			} catch (error) {
				hostError = error;
			}
			let delivered = false;
			try {
				delivered = await scope.set("pollIntervalMs", intervalMs) !== false;
			} catch {
				delivered = false;
			}
			if (delivered && pollIntervalMsOf(scope.getSnapshot().value) === intervalMs) return;
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError("pollIntervalMs", "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Read the CodeBuddy-CLI route's PINNED model out of a settings snapshot.
		*
		* `''` is a real answer here, not a missing one: it means "nothing is pinned,
		* the CLI runs on its own default". A non-string is a settings-file typo, and
		* it reads as `''` for the same reason `cliBridgeEnabledOf` reads consent only
		* out of an explicit `true` — garbage must never masquerade as a pinned model.
		*/
		function cliBridgeModelOf(configured) {
			const bridge = configured?.cliBridge;
			const model = typeof bridge === "object" && bridge !== null ? bridge.model : void 0;
			return typeof model === "string" ? model : "";
		}
		/**
		* Read the CodeBuddy-CLI route's PINNED reasoning effort out of a settings
		* snapshot, with the same `''`-means-CLI-default rule as
		* {@link cliBridgeModelOf}.
		*/
		function cliBridgeEffortOf(configured) {
			const bridge = configured?.cliBridge;
			const effort = typeof bridge === "object" && bridge !== null ? bridge.effort : void 0;
			return typeof effort === "string" ? effort : "";
		}
		/**
		* Write ONE key of the GLOBAL CodeBuddy-CLI block, then confirm it landed.
		*
		* Same two-writer order as {@link writeCliBridgeEnabled}: the plugin's Host
		* endpoint first (its merge is authoritative, so the tuned caps sitting next
		* to the key survive a one-key patch), the settings scope second as fallback
		* plus verification.
		*
		* The Host-side merge is one level deep, so a one-key patch can never drop the
		* block's sibling keys. The empty string must still be a delivered VALUE, not
		* "absent": it is the picker's "back to the CLI's own default" answer, and
		* posting `{ model: '' }` is what makes that answer COMMITTED rather than
		* merely forgotten.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param patch - the one key to write, e.g. `{ model: 'glm-5.3' }`.
		* @param verify - confirms the patch landed on the committed value.
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeCliBridgePatch(scope, patch, verify) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint("cliBridge", void 0, patch);
				if (authoritative !== void 0) {
					try {
						await scope.set("cliBridge", authoritative);
					} catch {}
					return;
				}
			} catch (error) {
				hostError = error;
			}
			const stored = unwrapVolatileDeep(scope.getSnapshot().value?.cliBridge);
			const next = {
				...typeof stored === "object" && stored !== null ? stored : {},
				...patch
			};
			let delivered = false;
			try {
				delivered = await scope.set("cliBridge", next) !== false;
			} catch {
				delivered = false;
			}
			if (delivered && verify(scope.getSnapshot().value)) return;
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError("cliBridge", "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Pin the model the local CodeBuddy CLI runs on — or `''` for "keep the CLI's
		* own default" — through {@link writeCliBridgePatch}.
		*
		* The picker offers the active tab's live catalog, but any string is a legal
		* write: a model the card's catalog does not list may still be valid for the
		* CLI, and hand-configured values must not be refused by this writer.
		*/
		async function writeCliBridgeModel(scope, model) {
			await writeCliBridgePatch(scope, { model }, (configured) => cliBridgeModelOf(configured) === model);
		}
		/**
		* Pin the reasoning effort the local CodeBuddy CLI runs on — or `''` for
		* "keep the CLI's own default" — through {@link writeCliBridgePatch}.
		*/
		async function writeCliBridgeEffort(scope, effort) {
			await writeCliBridgePatch(scope, { effort }, (configured) => cliBridgeEffortOf(configured) === effort);
		}
		/**
		* Read the credential-region order the CodeBuddy-CLI route walks out of a
		* settings snapshot.
		*
		* `''` means "nothing is pinned": the route then falls back to the CLI default
		* order (CN first, `cn,global`), so the picker must show that default rather
		* than an empty answer. A non-string reads as `''` — the same garbage rule as
		* {@link cliBridgeModelOf}.
		*/
		function cliBridgeRegionOrderOf(configured) {
			const bridge = configured?.cliBridge;
			const regionOrder = typeof bridge === "object" && bridge !== null ? bridge.regionOrder : void 0;
			return typeof regionOrder === "string" ? regionOrder : "";
		}
		/**
		* Pin the credential-region order the local CodeBuddy CLI walks — a
		* comma-separated region list such as `'cn,global'` — through
		* {@link writeCliBridgePatch}.
		*
		* Any string is a legal write: the order is matched against the regions the
		* Host actually built, and an unknown region name simply never matches, so a
		* hand-configured typo degrades to the CLI default order instead of breaking
		* the route.
		*/
		async function writeCliBridgeRegionOrder(scope, regionOrder) {
			await writeCliBridgePatch(scope, { regionOrder }, (configured) => cliBridgeRegionOrderOf(configured) === regionOrder);
		}
		/**
		* Write one volatile field, then confirm the value actually landed.
		*
		* ORDER MATTERS, and getting it wrong DELETES DATA. The two writers do not have
		* the same semantics:
		*
		* - The Host save endpoint merges the posted region into the field's
		*   AUTHORITATIVE value inside the Host process, preserving every other region.
		* - `scope.set(field, next)` hands the settings service the WHOLE field, merged
		*   on the CLIENT out of the browser mirror. The Host performs no server-side
		*   merge on this path, so whatever the client built REPLACES the field.
		*
		* The mirror is not a reliable merge base: a write made through the Host
		* endpoint does not update it (that lag is documented on `contextBudgets`
		* below), and on the affected 0.1.7 deployment the mirror for this namespace
		* stays stale outright. Building the merge from it therefore produced
		* `{ [region]: slot }` with every SIBLING region missing — and `scope.set`
		* stores that verbatim, deleting them. That was the report "I saved the
		* domestic region and the international one was gone": `accounts` survived
		* (written while the mirror happened to be fresh) while `regions` lost a slot.
		*
		* So the Host endpoint goes FIRST — it is the only writer that cannot delete a
		* sibling. `scope.set` is then attempted purely as a mirror refresh, and only
		* when it delivers is the write considered done without the endpoint.
		*
		* `landed` decides whether a value read back from the scope is the value that
		* was written; it is per-field because `''` (a cleared account slot) and an
		* absent key are different states, and a truncated model catalog must not pass
		* a shallow "is anything there?" check.
		*
		* @throws {WorkBuddySettingsWriteError} when neither path persists the value.
		*/
		async function writeField(scope, field, region, value, landed) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint(field, region, value);
				if (authoritative !== void 0) try {
					await scope.set(field, authoritative);
				} catch {}
				return;
			} catch (error) {
				hostError = error;
			}
			let scopeDelivered = false;
			try {
				scopeDelivered = await scope.set(field, {
					...fieldSnapshotOf(scope, field),
					[region]: value
				}) !== false;
			} catch {
				scopeDelivered = false;
			}
			if (scopeDelivered && landed(fieldSnapshotOf(scope, field)[region])) return;
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Write one region's account slot, then confirm the value actually landed.
		*
		* `settingsScope.set()` resolving is NOT proof that anything was stored. The
		* Host's document is the active profile's patch file (`cordis.patch.yml`, the
		* `config-editor`'s `documentPath`; volatile fields land there too, through
		* the same `edit()`. `settings.yaml` is NOT it on the 0.1.7 line — that file
		* is imported once from earlier releases and renamed to
		* `settings.yaml.imported`), replaced by writing a temp file and
		* renaming it over the target; on Windows an antivirus scanner, a sync client
		* (OneDrive, Dropbox), or an open editor can hold the file briefly.
		* `@deepseek-ai/dsh-atomic-write` retries `EPERM` / `EBUSY` / `EACCES` a
		* bounded number of times and those retries exist only for `win32` — and once
		* they are exhausted the failure reaches the client as an unsuccessful
		* response, which the settings scope handles by reloading Host state and
		* merely RETURNING. The caller's `await` therefore succeeds while the document
		* is unchanged.
		*
		* Reading the field back is the only reliable check, and it is what the
		* official plugin cards do (`CardForm.store()` compares the user layer against
		* the value it wrote). Failing loudly matters most on Clear: a false success
		* would flip the card to "following the app's sign-in" while the old selection
		* keeps running — the exact confusion that state line exists to remove.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose slot is written; the other is preserved.
		* @param value - the account id to save, or `''` to clear the region.
		* @throws {WorkBuddySettingsWriteError} when the value is readable back as
		*   something else — i.e. the write silently did not persist.
		*/
		async function writeAccountSlot(scope, region, value) {
			await writeField(scope, "accounts", region, value, (readBack) => readBack === value);
		}
		/**
		* Write one region's saved model state, then confirm it actually landed.
		*
		* The same silent-failure mode as {@link writeAccountSlot} applies to EVERY
		* settings write, not just the account slot. It matters here for a different
		* reason: a successful save discards the user's draft, so a write that did not
		* persist makes the card throw away unsaved edits while claiming they were
		* saved — unrecoverable, since the drafts are the only copy.
		*
		* Verification compares the round-tripped `lastCatalog` ids, which is the part
		* of the payload that is both user-visible and cheap to compare; the selection
		* fields ride along in the same object and cannot land separately.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose model slot is written.
		* @param payload - the complete next state for that region's slot.
		* @throws {WorkBuddySettingsWriteError} when the catalog does not read back.
		*/
		async function writeRegionModels(scope, region, payload) {
			const next = nextRegionModels(scope.getSnapshot().value, region, payload)[region];
			const written = payload.lastCatalog.map((model) => model.id);
			await writeField(scope, "regions", region, next, (readBack) => {
				const stored = readBack?.lastCatalog?.map((model) => model.id);
				return stored !== void 0 && stored.length === written.length && stored.every((id, index) => id === written[index]);
			});
		}
		/**
		* Switch one region's provider off or on, with the same landed-check as every
		* other settings write.
		*
		* This exists because the toggle was the ONE write that still called
		* `scope.set()` directly. On the affected 0.1.7 deployments that scope settles
		* without storing anything, so flipping a provider off appeared to work and
		* then silently reverted — the exact silent-failure mode
		* {@link writeAccountSlot} and {@link writeRegionModels} were written to
		* prevent for their own fields. Routing it through {@link writeField} gives it
		* the same scope-first-then-Host-endpoint path, so the switch either lands or
		* reports why it did not.
		*
		* The write carries the region's whole slot through untouched — only `enabled`
		* changes — so the user's directory, model picks, image opt-ins and budgets
		* survive the round trip. The Host withdraws or restores the provider route on
		* the next `onChange`, which is what actually removes it from DSH's model
		* picker.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region being switched.
		* @param enabled - the desired state.
		* @param slot - the region's COMPLETE next slot (the caller owns the snapshot
		*   read and the whole-slot merge, so this stays a pure write).
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeRegionEnabled(scope, region, enabled, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["enabled"] === enabled;
			});
		}
		/**
		* Write the CN gateway override (issue #220), with the same landed-check as
		* every other settings write.
		*
		* Carries the region's whole slot through untouched — only `cnBase` changes —
		* so writing a host cannot drop the model directory, the pool preferences or
		* the switches that live beside it in the same slot.
		*
		* Validation is deliberately NOT here: the caller runs `resolveCnGateway` before
		* calling, because the rejection reason has to be worded for the user ("not a
		* known CN brand" vs "must be https"), and a bare `WorkBuddySettingsWriteError`
		* cannot say that. This function's only job is landing the value.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region being written (always `cn` today: the international
		*   gateways follow the credential's brand domain and have no counterpart).
		* @param cnBase - the validated base URL, or `''` to restore the built-in gateway.
		* @param slot - the region's COMPLETE next slot (caller owns the merge).
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeRegionCnBase(scope, region, cnBase, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["cnBase"] === cnBase;
			});
		}
		/**
		* Show or hide one region's sidebar credit line, with the same landed-check as
		* every other settings write.
		*
		* Routed through {@link writeField} for exactly the reason
		* {@link writeRegionEnabled} is: on the affected 0.1.7 deployments a direct
		* `scope.set()` settles without storing anything, so the switch would appear to
		* work and then silently revert — which for this control means the line
		* reappears on the next render with no explanation.
		*
		* The caller passes the region's COMPLETE next slot (the same whole-slot merge
		* rule as the other region writes), so hiding a line cannot drop the model
		* directory, selection, image opt-ins, budgets or pool preferences that live
		* alongside this flag in the same slot.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose line is being shown or hidden.
		* @param shown - the desired state.
		* @param slot - the region's COMPLETE next slot (caller owns the merge).
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeRegionImageToolEnabled(scope, region, enabled, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["imageToolEnabled"] === enabled;
			});
		}
		async function writeRegionVideoToolEnabled(scope, region, enabled, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["videoToolEnabled"] === enabled;
			});
		}
		/**
		* Pin (or clear) one region's video model for ONE mode tag, verifying it landed.
		*
		* `modelId` of `undefined`/`''` clears the pin, so the landed check accepts an
		* ABSENT key as success for that case — writing an empty string instead would
		* leave a value the tool has to keep special-casing forever.
		*
		* Routed through `writeField` like every other settings write (Host endpoint
		* first, then the landed read-back): on the affected 0.1.7 deployments a direct
		* `scope.set()` settles without storing anything, and a picker that silently
		* reverted would be worse than no picker at all.
		*/
		async function writeRegionPreferredVideoModels(scope, region, tag, modelId, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				if (stored === null || stored === void 0) return false;
				const pinned = stored["preferredVideoModels"];
				const current = typeof pinned === "object" && pinned !== null ? pinned[tag] : void 0;
				return modelId === void 0 || modelId === "" ? current === void 0 || current === "" : current === modelId;
			});
		}
		async function writeRegionCreditsShown(scope, region, shown, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["showCreditsInMainUi"] === shown;
			});
		}
		/**
		* Write one region's new-model-segment opt-in, verifying it landed.
		*
		* Sibling of {@link writeRegionCreditsShown}: same whole-slot merge, same
		* landed check. The landed check reads `=== shown`, so an explicit `false`
		* (the default) verifies just as strictly as a `true`.
		*/
		async function writeRegionNewModelsShown(scope, region, shown, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["showNewModelsInMainUi"] === shown;
			});
		}
		/**
		* Write one region's credit SEAT (issue #62), verifying it landed.
		*
		* Sibling of {@link writeRegionCreditsShown}: same whole-slot merge, same
		* landed check, same reason for both. The seat decides only WHERE the readout
		* renders, so a lost write would leave the user looking at the old position
		* while the control claimed the new one.
		*/
		async function writeRegionCreditPosition(scope, region, position, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["creditPosition"] === position;
			});
		}
		/**
		* Write one region's account-pool PREFERENCES, verifying they landed.
		*
		* Routed through {@link writeField} like every other settings write, so it gets
		* the same Host-endpoint-first path and the same landed check. The card treats
		* a resolved write as "the draft is now safe to discard", so a write that
		* silently did nothing would throw away the user's edits while reporting
		* success — unrecoverable, since the draft is the only copy.
		*
		* The COMPLETE region slot is passed in by the caller for the same reason
		* {@link writeRegionEnabled} does it: the pool lives INSIDE the region slot
		* alongside `lastCatalog`/`enabledModelIds`, so writing only the pool field
		* would drop the model list.
		*
		* Deliberately does NOT carry the pool's measured facts. Those are written by
		* the Host to its own file; keeping them out of settings is what stops a save
		* from rolling back a test result the timer had just recorded.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose pool preferences are written.
		* @param preferences - the preference fields, as the user set them.
		* @param slot - the region's COMPLETE next slot (caller owns the merge).
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writePoolPreferences(scope, region, preferences) {
			const slot = {
				enabled: preferences.enabled,
				targetModelId: preferences.targetModelId,
				memberAccountIds: preferences.memberAccountIds,
				orderAccountIds: preferences.orderAccountIds
			};
			if (preferences.probeInputTokens !== void 0) slot["probeInputTokens"] = preferences.probeInputTokens;
			if (preferences.autoCheckin !== void 0) slot["autoCheckin"] = preferences.autoCheckin;
			const next = nextRegionPool(scope.getSnapshot().value, region, slot)[region];
			await writeField(scope, "regions", region, next, (readBack) => {
				const pool = readBack?.pool;
				if (pool === void 0 || pool === null) return false;
				if (pool["enabled"] !== preferences.enabled || pool["targetModelId"] !== preferences.targetModelId) return false;
				const wantedTokens = preferences.probeInputTokens ?? 0;
				if ((pool["probeInputTokens"] ?? 0) !== wantedTokens) return false;
				const stored = pool["memberAccountIds"];
				if (!Array.isArray(stored) || stored.length !== preferences.memberAccountIds.length) return false;
				const wanted = new Set(preferences.memberAccountIds);
				if (!stored.every((id) => typeof id === "string" && wanted.has(id))) return false;
				const storedOrder = pool["orderAccountIds"];
				if (!Array.isArray(storedOrder) || storedOrder.length !== preferences.orderAccountIds.length) return false;
				if (!storedOrder.every((id, index) => id === preferences.orderAccountIds[index])) return false;
				return true;
			});
		}
		//#endregion
		//#region src/cn-gateway.ts
		/**
		* The CN region's gateway host, and the ONE place an override is validated.
		*
		* ## Why this exists (issue #220)
		*
		* The CN chat gateway was the single hard-coded constant
		* `https://copilot.tencent.com`. In a corporate network that filters on the TLS
		* ClientHello's SNI, that name is reset before the handshake completes — while
		* the SAME network lets the WorkBuddy desktop app work, because the app reads a
		* failover list from its own config and uses `wb.tencentbuddy.com` as well.
		*
		* The reporter measured (2026-11-06): `copilot.tencent.com` answers
		* `ECONNRESET` in <100ms while `wb.tencentbuddy.com` answers a normal
		* `401 Authorization Required`. This module is what lets such a user point the
		* plugin at a host their network actually permits.
		*
		* ## Why an allowlist, and not "any URL you like"
		*
		* The value feeds `Authorization: Bearer <token>` on every CN request, plus the
		* refresh-token exchange. A free-form base is therefore a **credential
		* exfiltration primitive**: whoever can edit the settings (a synced profile, a
		* shared dotfile, a pasted "fix" from a forum post) could redirect a live
		* WorkBuddy token to a host they run. That is a strictly worse failure than the
		* timeout it fixes, and it is invisible — the requests would keep succeeding.
		*
		* So the override names a HOST from a closed set, never a URL from the open
		* internet. The set is the CN product's own brand registrable domains, measured
		* 2026-11-06 to answer the chat, billing, catalog and busy routes identically
		* (see `docs/CN_GATEWAY_FALLBACK.md`):
		*
		*   copilot.tencent.com     the shipping default
		*   wb.tencentbuddy.com     what the desktop app's failover.json lists
		*   www.workbuddy.cn        the brand host
		*   www.codebuddy.cn        the sibling brand host, also the billing base
		*
		* Each is admitted by REGISTRABLE domain, so any subdomain of those brands
		* qualifies and a lookalike (`wb.tencentbuddy.com.evil.example`) cannot —
		* the same rule `knownRegionOf` already applies to credential domains.
		*
		* ## What an override does NOT change
		*
		* `Origin` / `Referer` stay on the billing base (see `originReferer`): they
		* describe which web app the request comes from, not which socket it reaches.
		* Rewriting them from the override would make the identity claim disagree with
		* itself for no benefit — the gateway reads them as "this is the CN web app".
		*
		* @module dsh-connect-workbuddy/cn-gateway
		*/
		/** The CN chat gateway the plugin has always used. */
		const CN_GATEWAY_DEFAULT = "https://copilot.tencent.com";
		/**
		* Hosts an override may name, as registrable domains.
		*
		* A closed set is the security boundary described in this module's header. Adding
		* a host here is a deliberate act that must come with a measurement showing it
		* answers the CN routes, not with a guess about the brand.
		*/
		const ALLOWED_CN_DOMAINS = [
			"copilot.tencent.com",
			"tencentbuddy.com",
			"workbuddy.cn",
			"codebuddy.cn"
		];
		/**
		* Whether `hostname` belongs to one of the CN brands above.
		*
		* Matched on the registrable domain (`host === domain` or `host.endsWith('.' +
		* domain)`), so `wb.tencentbuddy.com` and `copilot.internal.tencentbuddy.com`
		* both qualify while `tencentbuddy.com.evil.example` does not.
		*/
		function isKnownCnHost(hostname) {
			const lowered = hostname.trim().toLowerCase();
			if (lowered === "") return false;
			return ALLOWED_CN_DOMAINS.some((domain) => lowered === domain || lowered.endsWith(`.${domain}`));
		}
		/**
		* Resolve the CN gateway base from an optional user-supplied value.
		*
		* An ABSENT or blank value is the normal case and yields the default with
		* `overridden: false`. A non-blank value must pass every check or the caller
		* gets `ok: false` and is expected to say so rather than silently falling back:
		* a user who typed a host and got the default anyway has no way to tell the
		* setting was ignored, and would keep debugging a network they already fixed.
		*/
		function resolveCnGateway(value) {
			const raw = typeof value === "string" ? value.trim() : "";
			if (raw === "") return {
				ok: true,
				base: CN_GATEWAY_DEFAULT,
				host: "copilot.tencent.com",
				overridden: false
			};
			let parsed;
			try {
				parsed = new URL(raw);
			} catch {
				return {
					ok: false,
					reason: "malformed",
					value: raw
				};
			}
			if (parsed.protocol !== "https:") return {
				ok: false,
				reason: "insecure",
				value: raw
			};
			if (!isKnownCnHost(parsed.hostname)) return {
				ok: false,
				reason: "unknown-host",
				value: raw
			};
			return {
				ok: true,
				base: `https://${parsed.hostname.toLowerCase()}`,
				host: parsed.hostname.toLowerCase(),
				overridden: true
			};
		}
		//#endregion
		//#region src/client/panel-switch.ts
		/**
		* Whether the OPTIONAL sidebar panel is switched on, as the browser half sees
		* it, plus the tiny subscription the registration controller needs.
		*
		* ## Why this is a module-level store and not component state
		*
		* The `sidebar.panellist` row is built from ENTRY METADATA, not from the
		* component: `ui-sidebar`'s `SidebarRoot` maps `usePanels(...)` (the slot's
		* entries) into a `PanelRow` button whose label comes from `options.label` and
		* whose glyph is `renderSlot(...)`. A component that returns `null` therefore
		* does not hide the row — it renders a BLANK, still-clickable nav button. That
		* is why the panel cannot use the `ComposerCreditsGate` trick the composer
		* readout uses (that seat renders a list of components, so `null` means
		* absent). The row has to be registered only while the switch is on, and
		* unregistered when it goes off.
		*
		* Registering conditionally in turn means something must OWN the re-register on
		* a settings change, and that something lives in the entry (`apply`), not in a
		* component. This module is the seam between the two: the card writes a value
		* here after it has verified a write landed, and the entry subscribes to
		* register or dispose.
		*
		* ## Why the Host is the seed
		*
		* The value is DELIVERED by the Host on the status document
		* (`sidebarPanelEnabled`), for the reason every other switch in this plugin is
		* Host-carried: this namespace's browser mirror is documented as stale on the
		* affected 0.1.7 deployments. Reading only the settings scope at startup would
		* let a stale `false` hide a row the Host believes it is serving — with nothing
		* to re-evaluate it afterwards, the panel would then be gone for the session.
		*
		* Turning the panel OFF while the page is open needs no special handling here:
		* `ui-layout`'s `retainMainPanels` drops an `activePanelId` whose `main` key no
		* longer exists, so the centre column returns to the conversation by itself.
		*/
		/** Listeners waiting for a change to the opt-in state. */
		const listeners = /* @__PURE__ */ new Set();
		/**
		* The current answer, defaulting to OFF.
		*
		* OFF is the whole point of this switch: an absent or unreadable value must
		* never turn the row on. See `Config.sidebarPanel` in `src/index.ts`.
		*/
		let wanted = false;
		/** Whether the sidebar panel should currently be registered. */
		function sidebarPanelWanted() {
			return wanted;
		}
		/**
		* Set the opt-in state and notify the registration controller.
		*
		* Idempotent: the controller re-registers on every call, and a settings
		* subscription can legitimately report the same value twice. Callers that
		* cannot tell whether the value changed need not check first.
		*
		* @param next - the desired state.
		*/
		function setSidebarPanelWanted(next) {
			if (wanted === next) return;
			wanted = next;
			for (const listener of [...listeners]) try {
				listener();
			} catch {}
		}
		/**
		* Observe changes to the opt-in state.
		*
		* @param listener - invoked after each change.
		* @returns the disposer removing this listener.
		*/
		function subscribeSidebarPanelWanted(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		//#endregion
		//#region src/client/manual-order.ts
		/**
		* Manual priority order, shared by every surface that lists member accounts.
		*
		* The defect this exists to prevent: the pool card sorts its rows by
		* `orderAccountIds` while the composer credits panel listed the same accounts
		* in whatever order the Host returned. Two views of one pool, disagreeing — the
		* user sorts the pool, opens the credit panel, and sees a different order, so
		* neither list looks authoritative. A user cannot tell which one is "the" order,
		* and the manual sorting feature looks broken even though it saved correctly.
		*
		* So the order lives here, once, and both lists call it. The alternative —
		* each component sorting however it likes — is exactly what drifted.
		*/
		/**
		* The saved manual order out of a settings snapshot, or an empty array.
		*
		* Reads defensively: the snapshot is Host-supplied JSON, so `regions` may be
		* absent (a profile that never used this feature), `pool` may be absent, and
		* `orderAccountIds` may be anything at all. Every shape that is not a list of
		* strings means "no manual order", which is also an older profile's spelling —
		* never a crash.
		*
		* The map comes from `regionsMapOf` rather than a bare `value.regions` lookup:
		* it accepts the section OR the field and heals a field an older build
		* corrupted (the "restart reset" report). That is not cosmetic here — on the
		* measured profile the INTERNATIONAL slot survived only one level down, so a
		* direct lookup reported "no manual order" for the region whose order the user
		* had actually saved, and the credit panel listed those accounts in the Host's
		* order instead.
		*/
		function readOrderAccountIds(value, region) {
			if (region === void 0) return [];
			const slot = regionsMapOf(value)[region];
			if (typeof slot !== "object" || slot === null) return [];
			const order = slot.pool;
			if (typeof order !== "object" || order === null) return [];
			const ids = order.orderAccountIds;
			if (!Array.isArray(ids)) return [];
			return ids.filter((id) => typeof id === "string");
		}
		/**
		* Reorder `accounts` to follow `orderIds`, leaving unordered accounts in place
		* AFTER the ordered ones, and preserving their original relative order.
		*
		* Returns a new array; never mutates the input, because the caller's array is
		* usually a state value that must not change identity behind React's back.
		*
		* Ids in `orderIds` that no longer name an account are simply ignored: the pool
		* can drop a member while an order still mentions it, and that must degrade to
		* "that position is empty" rather than hide a real account.
		*/
		function applyManualOrder(accounts, orderIds) {
			if (orderIds.length === 0) return [...accounts];
			const rank = /* @__PURE__ */ new Map();
			orderIds.forEach((id, index) => {
				if (!rank.has(id)) rank.set(id, index);
			});
			const ordered = [];
			const rest = [];
			for (const account of accounts) if (rank.has(account.id)) ordered.push(account);
			else rest.push(account);
			ordered.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
			return [...ordered, ...rest];
		}
		//#endregion
		//#region src/client/exclusion-text.ts
		/** The exclusion label for one account, or undefined when it is usable. */
		function exclusionText(t, excludedBy) {
			switch (excludedBy) {
				case "rate-limited": return t("row.poolExcludedRateLimited");
				case "model-busy": return t("row.poolExcludedModelBusy");
				case "out-of-credit": return t("row.poolExcludedOutOfCredit");
				case "credential-rejected": return t("row.poolExcludedRejected");
				case "account-restricted": return t("row.poolExcludedAccountRestricted");
				case "not-found": return t("row.probeNotFound");
				case "unavailable": return t("row.probeUnavailable");
				case "failed": return t("row.probeFailed");
				case "unusable": return t("row.poolExcludedUnusable");
				default: return;
			}
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
		* A latest-wins guard for one region's asynchronous work.
		*
		* Exists because `applyRotation` awaits (it fetches credits per member), so two
		* overlapping calls can interleave: a slow call that read "rotation is ON" can
		* resume AFTER a newer call cleared the override for "rotation is OFF" and write
		* the stale account back — leaving the card showing the pool switched off while
		* a rotated account is still billed.
		*
		* `begin()` claims a new generation and returns a probe; the caller must check
		* it after EVERY await and bail when it reports stale. Extracted as a pure
		* factory rather than inlined so the rule is unit-testable: an inlined token is
		* only observable by reproducing a real interleaving, which is slow and easy to
		* get subtly wrong (a harness that never actually overlaps passes either way).
		*/
		function createLatestWins() {
			const generations = {};
			return { begin(key) {
				const generation = (generations[key] ?? 0) + 1;
				generations[key] = generation;
				return () => generations[key] !== generation;
			} };
		}
		//#endregion
		//#region src/client/remaining.ts
		const MINUTE_MS$1 = 6e4;
		const HOUR_MS$1 = 60 * MINUTE_MS$1;
		const DAY_MS$1 = 24 * HOUR_MS$1;
		/**
		* How far out hours stop being the useful unit.
		*
		* Below this, hours; at or above it, days. The cut is at TWO days rather than
		* one so that 30 hours reads as "约 30 小时后" instead of rounding to "约 1 天后",
		* which would understate it by six hours.
		*/
		const DAYS_AT_MS = 2 * DAY_MS$1;
		/**
		* The recovery form of the same duration: "约 2 小时后恢复".
		*
		* The bare duration answers "how long?", but beside a red dot on an account row
		* it left the most important half unsaid: what happens when it elapses. "约 2
		* 小时后" reads equally well as "the limit lifts" and as "it expires into
		* something else", and on a row whose whole job is to say whether the account
		* can serve, that ambiguity is the question the reader came with.
		*
		* Same numbers, same rounding, same empty-string contract as
		* {@link remainingText} — this only appends the verb. Kept as a separate
		* function rather than a parameter so the two callers that must stay verbless
		* (the card's "之后可再用" sentence, which already contains its own verb) cannot
		* accidentally grow a second one.
		*/
		function recoversInText(t, untilMs, nowMs) {
			const left = untilMs - nowMs;
			if (left <= 0) return "";
			if (left < MINUTE_MS$1) return t("row.recoversImminent");
			if (left < HOUR_MS$1) return t("row.recoversMinutes", { count: Math.round(left / MINUTE_MS$1) });
			if (left < DAYS_AT_MS) return t("row.recoversHours", { count: Math.round(left / HOUR_MS$1) });
			return t("row.recoversDays", { count: Math.round(left / DAY_MS$1) });
		}
		/**
		* A short "约 N 分钟后 / 约 N 小时后 / 约 N 天后", or `''` once the moment passed.
		*
		* The empty string is the contract callers depend on: an elapsed cooldown means
		* the account is already back, so appending "in 0 minutes" would assert the
		* opposite of the state the card is showing. Callers append this only when it is
		* non-empty.
		*
		* Rounding is deliberately coarse — "约 1 小时后" for 69 minutes is what a reader
		* wants, and a precision that changes every minute would be noise rather than
		* information. The absolute instant sits right beside it for anyone who needs it.
		*/
		function remainingText(t, untilMs, nowMs) {
			const left = untilMs - nowMs;
			if (left <= 0) return "";
			if (left < MINUTE_MS$1) return t("row.remainingImminent");
			if (left < HOUR_MS$1) return t("row.remainingMinutes", { count: Math.round(left / MINUTE_MS$1) });
			if (left < DAYS_AT_MS) return t("row.remainingHours", { count: Math.round(left / HOUR_MS$1) });
			return t("row.remainingDays", { count: Math.round(left / DAY_MS$1) });
		}
		//#endregion
		//#region src/client/account-state.ts
		/** Whether a probe outcome means the model answered. */
		function outcomeOk(outcome) {
			return outcome === "ok";
		}
		/**
		* The MARK form of one probe outcome: the verdict alone, for a slot that cannot
		* hold an explanation (issue #108).
		*
		* `outcomeText` is the right function wherever the reader has room — the pool
		* card's probe column, the test log — and there the extra sentence earns its
		* width. The composer panel is a different slot: one line, beside an account
		* name, in a column about 180 px wide. `row.probeChannelRejected` is 88
		* characters in Chinese and 179 in English, so it could never fit; with
		* `nowrap` + `overflow:hidden` on the row it was cut mid-sentence, which the
		* reporter read as broken rendering.
		*
		* So this function returns the SHORT label where one is declared and falls back
		* to {@link outcomeText} otherwise. The full sentence is never lost: the row's
		* `title` carries `availabilityLine`, which keeps every word and the absolute
		* instant, and the pool card still prints it in full.
		*/
		function outcomeMarkText(t, outcome) {
			switch (outcome) {
				case "channel-rejected": return t("row.probeChannelRejectedShort");
				default: return outcomeText(t, outcome);
			}
		}
		/** A short, localizable label for one probe outcome. */
		function outcomeText(t, outcome) {
			switch (outcome) {
				case "ok": return t("row.probeOk");
				case "rate-limited": return t("row.poolExcludedRateLimited");
				case "model-busy": return t("row.poolExcludedModelBusy");
				case "out-of-credit": return t("row.poolExcludedOutOfCredit");
				case "credential-rejected": return t("row.probeCredentialRejected");
				case "account-restricted": return t("row.probeAccountRestricted");
				case "channel-rejected": return t("row.probeChannelRejected");
				case "not-found": return t("row.probeNotFound");
				case "unavailable": return t("row.probeUnavailable");
				default: return t("row.probeFailed");
			}
		}
		/**
		* `MM/DD, HH:mm` on a 24-hour clock.
		*
		* `hourCycle: 'h23'` is REQUIRED, not decorative: without it `Intl` follows the
		* browser locale's preference, and en-US renders `09/30, 01:23 PM`. A wall-clock
		* glued to "AM/PM" reads as 12-hour no matter what the surrounding UI assumes,
		* and it is the one thing a Chinese user cannot scan past — the card otherwise
		* speaks 24-hour everywhere (see `formatClock`).
		*
		* `h23` rather than `hour12: false`, because the latter maps to `h24` in some
		* engines and would print midnight as `24:00`. `h23` pins 00–23 exactly, which
		* is also the cycle DSH's own timestamps use.
		*/
		function formatShortClock(value) {
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23"
			}).format(new Date(value));
		}
		/**
		* The "why can't this serve, and until when" sentence for one account.
		*
		* Returns `undefined` when there is nothing to say — an account with no
		* measurement and no exclusion is simply unknown, and inventing "可用" for it
		* would be a claim nobody made.
		*
		* The retry wording has four states, matching the card's four:
		*  - a stated instant still ahead → "被限流 · 10/19 01:32 之后可再用 · 约 6 小时后"
		*  - a stated instant ALREADY past, on a WAIT-AND-SEE cooldown (rate-limited,
		*    model-busy) → NOTHING at all: no verdict (it has expired), no instant (it is
		*    behind us), and no chore for the reader. The dot already answers the
		*    question, and the card re-tests that one account by itself. Other outcomes
		*    that happen to carry a past instant keep their verdict and drop the instant
		*  - no instant but a timed       → "被限流 · 未提供恢复时间"
		*    exclusion
		*  - any other outcome            → the bare outcome ("连不上上游")
		*
		* That last case is deliberate: "未提供恢复时间" beside a credential rejection
		* would imply waiting helps, when the only fix is signing in again.
		*/
		function availabilityLine(t, account, nowMs = Date.now()) {
			const probe = account.probe;
			if (probe !== void 0) {
				if (probe.outcome === "ok") return outcomeText(t, probe.outcome);
				if (probe.retryAtMs !== void 0) {
					const left = remainingText(t, probe.retryAtMs, nowMs);
					if (left === "") return probe.outcome === "rate-limited" || probe.outcome === "model-busy" ? void 0 : outcomeText(t, probe.outcome);
					const at = t("row.poolRetryAt", { at: formatShortClock(probe.retryAtMs) });
					return `${outcomeText(t, probe.outcome)} · ${at} · ${left}`;
				}
				if (probe.outcome === "rate-limited" || probe.outcome === "model-busy" || probe.outcome === "out-of-credit") return `${outcomeText(t, probe.outcome)} · ${t("row.poolRetryUnknown")}`;
				return outcomeText(t, probe.outcome);
			}
			if (account.excludedBy !== void 0) return exclusionLabel(t, account.excludedBy);
		}
		/**
		* The SHORT form of the same fact: why the account cannot serve, and how long
		* until it can — without the absolute instant.
		*
		* This exists because the composer's balance panel prints one line per account
		* and the absolute date made every limited row read like a log entry
		* ("被限流 · 10/19, 01:32 之后可再用 · 约 6 小时后") beside a number the row is
		* actually about. The panel keeps the reason and the wait; the pool card keeps
		* the full sentence from {@link availabilityLine}, which is the one place a
		* reader can afford the exact instant.
		*
		* It is a sibling rather than a parameter so the two surfaces cannot half-adopt
		* a flag: the card has no way to reach this function, and the panel has no way
		* to lose the wait.
		*/
		function availabilityMark(t, account, nowMs = Date.now()) {
			const probe = account.probe;
			if (probe !== void 0) {
				if (probe.outcome === "ok") return outcomeMarkText(t, probe.outcome);
				if (probe.retryAtMs !== void 0) {
					const left = recoversInText(t, probe.retryAtMs, nowMs);
					if (left !== "") return `${outcomeMarkText(t, probe.outcome)} · ${left}`;
					return probe.outcome === "rate-limited" || probe.outcome === "model-busy" ? void 0 : outcomeMarkText(t, probe.outcome);
				}
				if (probe.outcome === "rate-limited" || probe.outcome === "model-busy" || probe.outcome === "out-of-credit") return `${outcomeMarkText(t, probe.outcome)} · ${t("row.poolRetryUnknown")}`;
				return outcomeMarkText(t, probe.outcome);
			}
			if (account.excludedBy !== void 0) return exclusionLabel(t, account.excludedBy);
		}
		/**
		* The exclusion's own label, for the case where no probe backs it.
		*
		* Kept private: callers that have a probe must go through `availabilityLine` or
		* `availabilityMark`, so neither surface can invent its own vocabulary for the
		* same measurement.
		*/
		function exclusionLabel(t, excludedBy) {
			switch (excludedBy) {
				case "rate-limited": return t("row.poolExcludedRateLimited");
				case "model-busy": return t("row.poolExcludedModelBusy");
				case "out-of-credit": return t("row.poolExcludedOutOfCredit");
				case "credential-rejected": return t("row.poolExcludedRejected");
				case "account-restricted": return t("row.poolExcludedAccountRestricted");
				case "not-found": return t("row.probeNotFound");
				case "unavailable": return t("row.probeUnavailable");
				case "failed": return t("row.probeFailed");
				case "unusable": return t("row.poolExcludedUnusable");
				default: return t("row.poolExcludedUnusable");
			}
		}
		/**
		* The dot's state as a class suffix, so CSS can colour it without inline styles.
		*
		* `error` is separate from `warn` because the advice differs: one means "wait",
		* the other means "do something".
		*/
		function stateTone(account, nowMs = Date.now()) {
			const probe = account.probe;
			if (probe !== void 0 && probe.retryAtMs !== void 0 && probe.retryAtMs <= nowMs && (probe.outcome === "rate-limited" || probe.outcome === "model-busy")) return account.excludedBy === void 0 ? "unknown" : "warn";
			if (account.excludedBy !== void 0) return account.excludedBy === "rate-limited" || account.excludedBy === "model-busy" || account.excludedBy === "unavailable" ? "warn" : "error";
			if (account.probe === void 0) return "unknown";
			return outcomeOk(account.probe.outcome) ? "ok" : "warn";
		}
		/**
		* The tone as a CSS colour variable.
		*
		* Derived from `stateTone` rather than repeating its branches: an inlined copy
		* would be a second definition of the rule, free to drift the first time one is
		* edited. The pool table draws a dot from a computed colour, so it needs a value
		* rather than a class name.
		*/
		function stateColor(account, nowMs = Date.now()) {
			switch (stateTone(account, nowMs)) {
				case "ok": return "var(--dsw-alias-state-success-primary, #22a06b)";
				case "warn": return "var(--dsw-alias-state-warn-primary, #f59e0b)";
				case "error": return "var(--dsw-alias-state-error-primary, #ef4444)";
				default: return "var(--dsw-alias-label-dimmed, #9aa0a6)";
			}
		}
		/**
		* Read one line of the test batch's stream as a test row.
		*
		* The stream is `{ action, modelId }`, then one `{ row }` per account, then
		* `{ done: true }` — or `{ reason, error }` when the batch itself broke. Only the
		* row shape is recognized here; the rest is the caller's business.
		*
		* Every field is validated rather than trusted. This parses a wire the panel did
		* not write, and a half-shaped row reaching the component's state would render
		* as a measurement nobody took — worse than ignoring the line, because the
		* subsequent re-read is what would have quietly corrected it.
		*/
		function testRowOf(line) {
			const raw = line["row"];
			if (typeof raw !== "object" || raw === null) return void 0;
			const row = raw;
			const accountId = row["accountId"];
			const name = row["accountName"];
			const rawResult = row["result"];
			if (typeof accountId !== "string" || accountId === "") return void 0;
			if (typeof rawResult !== "object" || rawResult === null) return void 0;
			const result = probeResultOf(rawResult);
			if (result === void 0) return void 0;
			return {
				accountId,
				accountName: typeof name === "string" && name !== "" ? name : accountId,
				result
			};
		}
		/** The probe result inside a test row, when it is complete enough to render. */
		function probeResultOf(raw) {
			const outcome = raw["outcome"];
			const modelId = raw["modelId"];
			if (typeof outcome !== "string" || !isProbeOutcome(outcome)) return void 0;
			if (typeof modelId !== "string") return void 0;
			const elapsedMs = raw["elapsedMs"];
			const status = raw["status"];
			const message = raw["message"];
			const retryAtMs = raw["retryAtMs"];
			const retrySource = raw["retrySource"];
			return {
				modelId,
				outcome,
				...typeof elapsedMs === "number" ? { elapsedMs } : {},
				...typeof status === "number" ? { status } : {},
				...typeof message === "string" ? { message } : {},
				...typeof retryAtMs === "number" ? { retryAtMs } : {},
				...isRetrySource(retrySource) ? { retrySource } : {}
			};
		}
		/** The outcome vocabulary, as a value — the type alone cannot be tested against a wire. */
		const PROBE_OUTCOMES = [
			"ok",
			"rate-limited",
			"model-busy",
			"out-of-credit",
			"credential-rejected",
			"policy-rejected",
			"account-restricted",
			"channel-rejected",
			"unavailable",
			"not-found",
			"failed"
		];
		function isProbeOutcome(value) {
			return PROBE_OUTCOMES.includes(value);
		}
		function isRetrySource(value) {
			return value === "retry-after" || value === "upstream-message" || value === "quota-refresh" || value === "upstream-tips";
		}
		/**
		* Fold ONE streamed test row into the usage document the panel is rendering.
		*
		* Why fold at all, when the batch is followed by a re-read: the batch is SERIAL
		* and a stuck member can take seconds, so a panel that changes nothing until the
		* LAST account answers is exactly the dead-looking button the streamed batch was
		* built to avoid. Folding each row as it lands makes the row change the moment
		* its measurement exists; the re-read afterwards then replaces the fold with the
		* same facts, this time from the Host's own store.
		*
		* The exclusion is RE-DERIVED here rather than left as it was: it is derived
		* state (`exclusionOf`), so copying the previous one forward would keep a
		* just-measured-good account red until the re-read — and would keep a
		* just-measured-limited one green, which is the more expensive error.
		*/
		function withTestRow(usage, row, nowMs) {
			if (!("pool" in usage) || usage.pool === void 0) return usage;
			const pool = usage.pool;
			const index = indexOfTestedAccount(pool.accounts, row);
			if (index === void 0) return usage;
			const measured = pool.accounts[index];
			if (measured === void 0) return usage;
			const { excludedBy: _previous, ...account } = measured;
			const probe = {
				outcome: row.result.outcome,
				atMs: nowMs,
				source: "test-batch",
				modelId: row.result.modelId,
				...row.result.retryAtMs === void 0 ? {} : { retryAtMs: row.result.retryAtMs },
				...row.result.message === void 0 ? {} : { message: row.result.message }
			};
			const excludedBy = exclusionOf(probe, nowMs);
			const folded = {
				...account,
				probe,
				...excludedBy === void 0 ? {} : { excludedBy }
			};
			const accounts = pool.accounts.map((candidate, at) => at === index ? folded : candidate);
			return {
				...usage,
				pool: {
					...pool,
					accounts
				}
			};
		}
		/**
		* Which listed account a test row measured, or `undefined` when it measured none
		* of them.
		*
		* Matched by ID first. The NAME is only a fallback for a row whose id this
		* document no longer lists, and only when exactly one listed account carries it:
		* two accounts sharing a name must never have one measurement written onto both.
		*/
		function indexOfTestedAccount(accounts, row) {
			const byId = accounts.findIndex((account) => account.accountId === row.accountId);
			if (byId >= 0) return byId;
			const matches = accounts.flatMap((account, at) => account.accountName === row.accountName ? [at] : []);
			return matches.length === 1 ? matches[0] : void 0;
		}
		//#endregion
		//#region src/client/credit-format.ts
		/**
		* How a credit balance is written on screen.
		*
		* `4.4.5` made the balance exact: it now comes from the upstream's `*Precise`
		* family, so the number carries a fraction (`2,196.61`) where it used to be a
		* whole integer. The card does not show that fraction — a narrow row reads
		* better, and the product's own breakdown (套餐基础 / 平台奖励 / 购买) is the
		* place to look for detail.
		*
		* Taking the FLOOR rather than rounding is the one decision here, and it is not
		* cosmetic:
		*
		* - a balance is a quantity you either have or do not. `0.61` rounded UP prints
		*   `1`, which tells the reader they can spend a credit they do not have;
		* - the official client shows `2,196.61`, so its integer part is `2,196` — the
		*   floor. Rounding would print `2,197` and make a card that had JUST been
		*   reconciled against the client look one credit off, which is the exact
		*   complaint (issue #58) this display rule is downstream of.
		*
		* Grouping is kept because a four-figure balance is otherwise hard to read at a
		* glance, and it is the only reason this is not `Math.floor(value).toString()`.
		*
		* @module dsh-connect-workbuddy/client/credit-format
		*/
		/**
		* Format a credit balance for display: whole credits, grouped, floored.
		*
		* `Math.floor` before `toLocaleString` (rather than a `maximumFractionDigits`
		* option) is deliberate: the option ROUNDS, so it would print `2,197` for
		* `2,196.61`.
		*/
		function formatCredits(value) {
			return Math.floor(value).toLocaleString("en-US");
		}
		//#endregion
		//#region src/client/BusyOverlay.tsx
		/**
		* The shared busy veil's spinner: an arc that breathes while it turns.
		*
		* Deliberately the host's own state-spinner shape (dsh's `_dsh-state-dot-spin`)
		* rather than a border-ring: a two-tone CSS ring at .7s read as a loading
		* indicator from another decade and was out of step with every spinner in the
		* shell. The motion lives in CSS (`dsm-workbuddy-veil-spin` /
		* `-dash`), so this element only describes the geometry; `currentColor` lets it
		* inherit whatever tier it sits in.
		*
		* `aria-hidden` because the veil's `role="status"` already announces the
		* message — a second announcement from a decorative arc is noise.
		*/
		function VeilSpinner() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "dsm-workbuddy-veil-spinner",
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				focusable: "false",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					className: "dsm-workbuddy-veil-spinner-track",
					cx: "10",
					cy: "10",
					r: "8",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					className: "dsm-workbuddy-veil-spinner-arc",
					cx: "10",
					cy: "10",
					r: "8",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round"
				})]
			});
		}
		/**
		* The veil. Deliberately NOT a modal dialog: it carries no focusable control
		* and no dismissal — there is nothing for the user to decide, only a step to
		* wait through. `aria-busy` plus a polite live region state that to screen
		* readers, which is the whole accessibility contract a wait screen needs.
		*/
		function BusyOverlay({ message, hint, visible }) {
			if (!visible) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-veil",
				role: "status",
				"aria-busy": "true",
				"aria-live": "polite",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-veil-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(VeilSpinner, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-veil-text",
							children: message
						}),
						hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-veil-hint",
							children: hint
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/device-profile.ts
		/** 与 Host 侧同一条规则：36 个小写十六进制字符。 */
		const DEVICE_ID_PATTERN = /^[0-9a-f]{36}$/u;
		/** Whether `value` is a well-formed device id (as the Host will accept it). */
		function isDeviceId(value) {
			return DEVICE_ID_PATTERN.test(value);
		}
		/**
		* 造一个 36 字符的小写十六进制 id（「一键随机」用的就是它）。
		*
		* 用 `crypto.getRandomValues` 而不是 `Math.random`：随机值会被当成设备身份发出去，
		* 一个可预测的序列不是"随机"，而是"两台机器撞在一起"。18 字节与派生值的熵一致。
		*/
		function randomDeviceId() {
			const bytes = /* @__PURE__ */ new Uint8Array(18);
			crypto.getRandomValues(bytes);
			return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
		}
		/**
		* Normalize one Host answer. Shared by the GET and the POST: two copies of this
		* coercion is how the two answers start disagreeing.
		*
		* 派生值逐条校验形状：它是画在输入框正下方的 36 位串，混进一个 undefined 会
		* 直接渲染成 "undefined"，比不显示更糟。Host 与本页面同源，这里不做安全意义上的
		* 校验，只是不让半截数据变成可见的胡说。
		*/
		function normalizeSettings(body) {
			const accounts = typeof body.accounts === "object" && body.accounts !== null ? body.accounts : {};
			const derived = {};
			if (typeof body.derived === "object" && body.derived !== null) for (const [accountId, entry] of Object.entries(body.derived)) {
				const machineId = entry?.machineId;
				const sessionId = entry?.sessionId;
				if (typeof machineId !== "string" || typeof sessionId !== "string") continue;
				if (!isDeviceId(machineId) || !isDeviceId(sessionId)) continue;
				derived[accountId] = {
					machineId,
					sessionId
				};
			}
			const realTier = normalizeRealTier(body.realTier);
			return {
				mode: body.mode === "real" ? "real" : "virtual",
				accounts,
				...body.derived === void 0 ? {} : { derived },
				sdkDir: typeof body.sdkDir === "string" ? body.sdkDir : "",
				sdkFallbackToVirtual: body.sdkFallbackToVirtual !== false,
				...realTier === void 0 ? {} : { realTier }
			};
		}
		/** 只接受三种已知状态；其它一律当"没这一项"，不去猜。 */
		function normalizeRealTier(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const record = value;
			const state = record["state"];
			if (state !== "available" && state !== "broken" && state !== "unavailable") return void 0;
			return {
				state,
				platform: typeof record["platform"] === "string" ? record["platform"] : ""
			};
		}
		/**
		* GET the current settings.
		*
		* `undefined` means "this Host has no such route" (404/503) — a different answer
		* from "the Host has one and it says virtual/empty". The card uses that to HIDE
		* the toggle and the row gears instead of rendering controls that cannot work;
		* `EMPTY_DEVICE_SETTINGS` is only the initial value before the first read.
		*/
		async function fetchDeviceSettings(path) {
			const response = await fetch(path, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			if (response.status === 404 || response.status === 503) return void 0;
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return normalizeSettings(await response.json());
		}
		/** POST one mutation and return the settings the Host now holds. */
		async function post$1(path, body) {
			const response = await fetch(path, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json"
				},
				credentials: "same-origin",
				body: JSON.stringify(body)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return normalizeSettings(await response.json());
		}
		/** Switch the tier. 「真实值」is remembered but changes no outbound byte until P3. */
		function putDeviceMode(path, mode) {
			return post$1(path, {
				kind: "mode",
				mode
			});
		}
		/**
		* Save one account's overrides.
		*
		* `''` clears a field (back to the derived value) and `undefined` leaves it alone —
		* that distinction is why the dialog sends only the fields the user touched.
		*/
		function putDeviceProfile(path, accountId, values) {
			return post$1(path, {
				kind: "account",
				accountId,
				...values
			});
		}
		/**
		* Save the SDK directory and/or the fallback switch (作者意见 #1 / #2).
		*
		* `undefined` leaves a field alone, exactly like {@link putDeviceProfile}: the
		* panel has two independent controls, and saving one must not write the other
		* back to a stale value. `sdkDir: ''` clears the override and returns to
		* automatic discovery — a different intent from "leave it alone".
		*/
		function putDeviceSdk(path, values) {
			return post$1(path, {
				kind: "sdk",
				...values
			});
		}
		//#endregion
		//#region src/client/DeviceProfileDialog.tsx
		/**
		* 一个账号的"虚拟设备参数"弹窗（设置里齿轮点开的那个）。
		*
		* ## 为什么是弹窗，而不是行内展开
		*
		* 每行已经有「测试 / 移除」两个按钮和一段探针文本，再展开两块输入框会把表格
		* 挤成表单。这里改的是"这台机器对外声称自己是谁"，属于低频但高影响的编辑，
		* 适合一个能一眼看完、且必须显式确认的面板。
		*
		* ## 为什么字段是"可清空"的
		*
		* 留空 = 按本机盐自动派生。清空某一项就恢复自动，而不是要求用户先记住原来的
		* 派生值——派生值本来就是不可逆推的 36 位十六进制，让人"填回去"是不可能的。
		*
		* ## P3 的那一行为什么现在就出现
		*
		* 真实设备 Token 的取值链（Turing Shield SDK / 文件）与档位互斥规则都还没实现，
		* 但入口要预留：用户在看到「真实值（P3）」这个选项时，需要在这个弹窗里看到
		* "它将来的位置在哪"。禁用 + 一句说明，比一个将来突然冒出来的输入框诚实。
		*
		* @module dsh-connect-workbuddy/client/DeviceProfileDialog
		*/
		function DeviceProfileDialog(props) {
			const { t, accountName, saved, derived, derivedNote, saving, error, onCancel, onSave } = props;
			const [machineId, setMachineId] = (0, react.useState)(saved.machineId);
			const [sessionId, setSessionId] = (0, react.useState)(saved.sessionId);
			const firstField = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") onCancel();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [onCancel]);
			(0, react.useEffect)(() => {
				firstField.current?.focus();
			}, []);
			const machineInvalid = machineId !== "" && !isDeviceId(machineId);
			const sessionInvalid = sessionId !== "" && !isDeviceId(sessionId);
			const canSave = !saving && !machineInvalid && !sessionInvalid;
			const field = (labelKey, value, onChange, invalid, derivedValue, ref) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "dsm-workbuddy-device-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-device-field-label",
						children: t(labelKey)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref,
						type: "text",
						className: `dsm-workbuddy-device-input${invalid ? " dsm-workbuddy-device-input-bad" : ""}`,
						value,
						spellCheck: false,
						autoComplete: "off",
						placeholder: t("row.deviceFieldPlaceholder"),
						"aria-invalid": invalid ? true : void 0,
						onChange: (event) => onChange(event.target.value.trim().toLowerCase())
					}),
					value !== "" || derivedValue === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-device-derived",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.deviceDerivedNow") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: derivedValue })]
					}),
					invalid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-device-error",
						children: t("row.deviceInvalid")
					}) : null
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-device-backdrop",
				role: "presentation",
				onClick: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-device-dialog",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("row.deviceDialogTitle", { accountName }),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsm-workbuddy-device-title",
							children: t("row.deviceDialogTitle", { accountName })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-hint",
							children: t("row.deviceDialogIntro")
						}),
						field("row.deviceMachineLabel", machineId, setMachineId, machineInvalid, derived?.machineId, firstField),
						field("row.deviceSessionLabel", sessionId, setSessionId, sessionInvalid, derived?.sessionId),
						derived !== void 0 || derivedNote === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-device-derived-missing",
							children: t(derivedNote)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-device-random-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								onClick: () => {
									setMachineId(randomDeviceId());
									setSessionId(randomDeviceId());
								},
								children: t("row.deviceRandom")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-hint",
								children: t("row.deviceRandomHint")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-device-p3",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-device-p3-label",
								children: t("row.deviceDialogP3")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-hint",
								children: t("row.deviceDialogP3Hint")
							})]
						}),
						error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-device-error",
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-device-dialog-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								onClick: onCancel,
								disabled: saving,
								children: t("row.deviceDialogCancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								disabled: !canSave,
								onClick: () => onSave({
									machineId,
									sessionId
								}),
								children: saving ? t("row.deviceDialogSaving") : t("row.deviceDialogSave")
							})]
						})
					]
				})
			});
		}
		/**
		* 「真实值」档下点齿轮时看到的那一句话。
		*
		* 为什么齿轮仍然可点：一个真正 `disabled` 的按钮点不动，用户只会以为是界面坏了；
		* 这里要回答的是"为什么不让我改"——那必须有一次点击才能说出口。视觉上置灰
		* （`dsm-workbuddy-device-gear-off`）表达"现在用不了"，点击表达"原因是什么"。
		*/
		function DeviceModeBlockedDialog(props) {
			const { t, onClose } = props;
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [onClose]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-device-backdrop",
				role: "presentation",
				onClick: (event) => {
					if (event.target === event.currentTarget) onClose();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-device-dialog",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("row.deviceModeRealBlockedTitle"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsm-workbuddy-device-title",
							children: t("row.deviceModeRealBlockedTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-hint",
							children: t("row.deviceModeRealBlocked")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-device-dialog-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								onClick: onClose,
								children: t("row.deviceDialogCancel")
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/ndjson.ts
		/**
		* Read a newline-delimited JSON body, one object at a time.
		*
		* NDJSON rather than SSE or a hand-rolled frame format because the pool's batch
		* is a list of INDEPENDENT results: one line per result needs no state machine,
		* survives a partially-delivered batch, and lets the reader act on account N
		* while account N+1 is still being tested.
		*
		* A malformed line is SKIPPED, not fatal. The stream carries live progress, so
		* discarding the rest of a batch because one frame did not parse would throw away
		* rows the user already watched arrive — and a truncated final line is a normal
		* way for a stream to end when something upstream misbehaves.
		*
		* @module dsh-connect-workbuddy/client/ndjson
		*/
		/** Hand each parsed object to `onLine`, in order, as it arrives. */
		async function readNdjson(body, onLine) {
			const reader = body?.getReader();
			if (reader === void 0) return;
			const decoder = new TextDecoder();
			const emit = (line) => {
				const trimmed = line.trim();
				if (trimmed === "") return;
				try {
					const parsed = JSON.parse(trimmed);
					if (typeof parsed === "object" && parsed !== null) onLine(parsed);
				} catch {}
			};
			let buffer = "";
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) emit(line);
				}
				buffer += decoder.decode();
				emit(buffer);
			} finally {
				reader.releaseLock();
			}
		}
		//#endregion
		//#region src/client/probe-reason.ts
		/**
		* Outcomes whose label + stated recovery time ARE the whole story.
		*
		* `rate-limited` and `out-of-credit` both carry a reset instant, which the row
		* prints right beside them; their bodies restate that instant and add a
		* `code`/`requestId` pair nobody reads.
		*
		* `model-busy` belongs here for the opposite reason: its label states the whole
		* finding INCLUDING the remedy ("this model is loaded right now · not your
		* account — wait about a minute or switch models"). The recorded body is the
		* upstream's `14003` envelope, and appending it in a 72-character cell would
		* bury the remedy under the JSON the label was written to translate.
		*
		* `credential-rejected` and `not-found` are deliberately NOT here: their labels
		* state a conclusion ("sign in again", "no such model"), and the upstream's own
		* words are what make that conclusion checkable rather than asserted.
		*/
		const SELF_EXPLANATORY = /* @__PURE__ */ new Set([
			"rate-limited",
			"model-busy",
			"out-of-credit",
			"account-restricted"
		]);
		/**
		* Longest inline reason kept.
		*
		* A cap rather than a wrapper: one pathological body must not push the rest of
		* the table off screen. 72 characters holds a full transport error and a full
		* upstream sentence, while stopping well short of a raw JSON document.
		*/
		const REASON_LIMIT = 72;
		/** The inline reason for one measurement, or `undefined` when it adds nothing. */
		function inlineProbeReason(outcome, message) {
			if (message === void 0 || message === "") return void 0;
			if (SELF_EXPLANATORY.has(outcome)) return void 0;
			const text = (humanSentenceOf(message) ?? stripTransportPrefix(message)).trim();
			return text === "" ? void 0 : truncate(text);
		}
		function truncate(text) {
			return text.length <= REASON_LIMIT ? text : `${text.slice(0, 71)}…`;
		}
		/** `{"code":6004,"msg":"…","requestId":"…"}` → the `msg` sentence, if it has one. */
		function humanSentenceOf(message) {
			if (!message.startsWith("{")) return void 0;
			let parsed;
			try {
				parsed = JSON.parse(message);
			} catch {
				return;
			}
			if (typeof parsed !== "object" || parsed === null) return void 0;
			const msg = parsed["msg"];
			return typeof msg === "string" && msg !== "" ? msg : void 0;
		}
		/** `transport error: TimeoutError: …` → `TimeoutError: …`. */
		function stripTransportPrefix(message) {
			return message.replace(/^transport error:\s*/u, "");
		}
		//#endregion
		//#region src/client/probe-age.ts
		const MINUTE_MS = 6e4;
		const HOUR_MS = 60 * MINUTE_MS;
		const DAY_MS = 24 * HOUR_MS;
		/**
		* How long ago a measurement was taken, coarsely: "刚刚", "N 分钟前",
		* "N 小时前", "N 天前".
		*
		* Coarse on purpose, for the same reason `remainingText` rounds: a figure that
		* changes every second reads as live telemetry rather than as "how stale is
		* this", which is the only question being asked here.
		*
		* A clock skew that puts the measurement in the FUTURE (a stored `atMs` ahead
		* of `nowMs`, from a machine whose clock moved backwards) is reported as
		* "刚刚" rather than as a negative age: the record is real, and the card must
		* not print "-3 分钟前".
		*/
		function probeAgeText(t, atMs, nowMs) {
			const age = nowMs - atMs;
			if (age < MINUTE_MS) return t("row.poolProbeJustNow");
			if (age < HOUR_MS) return t("row.poolProbeMinutesAgo", { count: Math.round(age / MINUTE_MS) });
			if (age < 2 * DAY_MS) return t("row.poolProbeHoursAgo", { count: Math.round(age / HOUR_MS) });
			return t("row.poolProbeDaysAgo", { count: Math.round(age / DAY_MS) });
		}
		//#endregion
		//#region src/native-modality.ts
		/**
		* Reviewed vendor classifications, keyed by EXACT model id (never a prefix).
		* Ids absent from this record are `unknown` — see {@link nativeModalityOf}.
		*/
		const NATIVE_MODALITY_BY_MODEL_ID = {
			"deepseek-v4-pro": "text",
			"glm-5.1": "text",
			"glm-5.2": "text",
			"glm-5.3": "text",
			"hy3": "text",
			"hy4-preview": "text",
			"deepseek-v4.1-flash": "multimodal",
			"glm-5.3-flash": "multimodal",
			"glm-5v-turbo": "multimodal",
			"kimi-k2.6": "multimodal",
			"kimi-k2.7": "multimodal",
			"kimi-k3-1": "multimodal",
			"minimax-m3": "multimodal",
			"minimax-m3.1-flash": "multimodal",
			"space-bunny": "multimodal"
		};
		/**
		* Ids the upstream lists in the model roster that are ROUTERS, not models.
		*
		* Two of them are known, one per region, and they are the SAME concept under
		* two ids:
		*
		* - `auto` (CN gateway) — the gateway resolves it to whichever model it
		*   considers the best fit (measured: CN `auto` → `hy4-preview`), and its own
		*   description says so outright: 「平衡效果与速度。自动为每个任务匹配最优模型，
		*   积分倍率随之浮动」 ("picks the best model per task; the credit multiplier
		*   floats accordingly").
		* - `default-model` (international gateway) — identical role (name "Auto",
		*   `isDefault: true`, the region's default pick), also the ONLY entry in that
		*   roster that declares no `credits` at all.
		*
		* The evidence for treating both as routers is the shared, self-describing
		* shape, not the name: measured 2026-10-22 against both live gateways, these
		* two entries are the ONLY ones whose `credits` field is absent/empty (CN 19
		* of 20 priced, global 27 of 28), and the ones carrying `isDefault: true`.
		* A row the plugin cannot price is a row whose cost it cannot state, and the
		* router duplicates a real row already in the same roster.
		*
		* Kept as an explicit table rather than a heuristic: a router is an upstream
		* concept with no declared flag, and guessing from the name would eventually
		* hide a real model. Add an id here only after the same kind of evidence.
		*/
		const ROUTER_MODEL_IDS = /* @__PURE__ */ new Set(["auto", "default-model"]);
		/** Whether this id is an upstream router rather than a model. */
		function isRouterModelId(modelId) {
			return ROUTER_MODEL_IDS.has(modelId);
		}
		/**
		* Native modality of one model id. Exact match only: a new model never
		* inherits a classification from its family, its display name, or the
		* platform's image flag.
		*/
		function nativeModalityOf(modelId) {
			if (isRouterModelId(modelId)) return "router";
			return NATIVE_MODALITY_BY_MODEL_ID[modelId] ?? "unknown";
		}
		/**
		* Whether a model refresh should PRE-CHECK this model's image box.
		*
		* Only a documented `multimodal` is pre-checked. `text` is documented as
		* unable to read images, and `unknown` is deliberately left unchecked rather
		* than guessed — the whole reason this table exists is that the platform flag
		* guessed wrong. A platform `supportsImages: false` still vetoes, so a
		* documented-multimodal id can never be pre-checked against the platform's
		* explicit "no".
		*
		* The user can always tick a box by hand; this decides a DEFAULT only, and the
		* effective runtime flag remains the saved `imageModelIds`.
		*/
		function imageDefaultFor(info) {
			if (info.supportsImages === false) return false;
			return NATIVE_MODALITY_BY_MODEL_ID[info.id] === "multimodal";
		}
		//#endregion
		//#region src/promo.ts
		/**
		* `'HH:mm'` → minutes since midnight, or undefined for anything else.
		*
		* `24:00` is accepted and means exactly 1440 — the END of a day. The upstream
		* writes "all day" as `0:00`–`23:59` today, which leaves a one-minute hole
		* between 23:59 and midnight where a standing campaign reads as not running.
		* Accepting `24:00` lets such a window be expressed (and lets a future upstream
		* fix it) without that hole; as a START it is rejected, because a day that
		* begins at 24:00 is the next day and that is a different statement.
		*
		* Any other malformed value is left to the caller to drop — a wrong window
		* would hide a live promotion, and guessing is not this parser's job.
		*
		* THE TYPE GUARD IS LOAD-BEARING, NOT DEFENSIVE DECORATION (issue #139). The
		* upstream feeds a string, and `parseDaily`'s own `text()` would already have
		* dropped a number — but the SAVED `lastCatalog` is a second, independent
		* entrance to this function, and nothing on that path type-checks. A promotion
		* object rides through `toPersistedWorkBuddyModel` untouched (the settings
		* schema keeps unknown keys), survives `resolveRoster`, and reaches the
		* renderer's `selectPromoBadge`. A numeric `start` there used to throw
		* `value.trim is not a function` DURING RENDER, which the host's slot error
		* boundary turned into a blank configuration section — the page looked as if
		* the plugin had never installed.
		*
		* Refusing a non-string is the same answer the parser already gives every
		* other unreadable shape: drop the window rather than guess. Interpreting a
		* number as "minutes since midnight" was considered and rejected — `1380`
		* happens to mean 23:00, but no upstream has ever published that shape, and
		* inventing hours for a promotion the upstream never described is exactly the
		* overstatement this module exists to prevent.
		*/
		function minutesOfClock(value) {
			if (typeof value !== "string") return void 0;
			const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
			if (match === null) return void 0;
			const hours = Number(match[1]);
			const minutes = Number(match[2]);
			if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return void 0;
			if (minutes > 59) return void 0;
			if (hours > 24) return void 0;
			if (hours === 24) return minutes === 0 ? 1440 : void 0;
			return hours * 60 + minutes;
		}
		/**
		* Minutes since local midnight in `timeZone` at `nowMs`.
		*
		* `Intl` does the zone maths, because the upstream's windows are written in
		* the zone IT names (Asia/Shanghai for the CN feed) and the user's own clock
		* is not necessarily in that zone. An unusable zone falls back to UTC rather
		* than throwing: a badge that cannot be placed is a missing badge, not a
		* broken card.
		*/
		function zonedMinutes(nowMs, timeZone) {
			const zone = timeZone ?? "UTC";
			try {
				const parts = new Intl.DateTimeFormat("en-US", {
					timeZone: zone,
					hour: "2-digit",
					minute: "2-digit",
					hourCycle: "h23"
				}).formatToParts(new Date(nowMs));
				const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
				const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
				if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
				return hour * 60 + minute;
			} catch {
				return 0;
			}
		}
		/** Whether `nowMinutes` falls inside one of the daily windows. */
		function withinDailyWindows(windows, nowMinutes) {
			return windows.some((window) => {
				const start = minutesOfClock(window.start);
				const end = minutesOfClock(window.end);
				if (start === void 0 || end === void 0) return false;
				if (start === end) return true;
				if (end > start) return nowMinutes >= start && nowMinutes < end;
				return nowMinutes >= start || nowMinutes < end;
			});
		}
		/**
		* Whether the promotion's ABSOLUTE window holds now.
		*
		* The absolute window (`validFrom` / `validUntil`) is the promotion's own
		* lifetime. It gates the badge on its own: a promotion whose lifetime has
		* ended must not keep advertising itself, whatever its daily hours say.
		*/
		function promoWithinAbsoluteWindow(promo, nowMs) {
			const schedule = promo.schedule;
			if (schedule === void 0) return true;
			if (schedule.validFrom !== void 0 && nowMs < schedule.validFrom) return false;
			if (schedule.validUntil !== void 0 && nowMs >= schedule.validUntil) return false;
			return true;
		}
		/**
		* Whether the promotion's DAILY window holds now.
		*
		* The daily window is the discount's own hours — it is what makes a
		* promotion a "night discount" — and a promotion without one is running
		* whenever its absolute window holds.
		*
		* A schedule whose `daily` was published but could not be evaluated
		* ({@link WorkBuddyPromoSchedule.dailyUnusable}) is NOT running: the upstream
		* did say the campaign has hours, we just cannot read them, and assuming
		* "always" is the one guess that overstates the offer.
		*/
		function promoWithinDailyWindow(promo, nowMs) {
			const schedule = promo.schedule;
			if (schedule === void 0) return true;
			if (schedule.dailyUnusable === true) return false;
			if (schedule.daily === void 0 || schedule.daily.length === 0) return true;
			return withinDailyWindows(schedule.daily, zonedMinutes(nowMs, schedule.timezone));
		}
		/**
		* Whether the promotion is running right now: its absolute window AND its
		* daily hours both hold.
		*/
		function promoActiveAt(promo, nowMs) {
			return promoWithinAbsoluteWindow(promo, nowMs) && promoWithinDailyWindow(promo, nowMs);
		}
		/**
		* Whether the promotion carries ANY temporal statement of its own.
		*
		* A tier badge ("Pro Only") has no `schedule` at all: it describes the model
		* unconditionally, so `promoActiveAt` is trivially true for it. That is
		* correct on its own, but it made such a badge eligible for step 1, where it
		* could shadow a lower-priority campaign whose window really is open.
		* "Running" should mean "this entry says it runs now", and an entry with no
		* schedule never does — it only ever "stands". Entries WITH a schedule (a
		* lifetime, hours, or both) are the ones that can be running.
		*/
		function hasSchedule(promo) {
			return promo.schedule !== void 0;
		}
		/**
		* The badge to draw for a model right now, or undefined when there is none.
		*
		* The order of the two answers is the whole point:
		*
		* 1. A promotion RUNNING NOW wins — highest `priority` first. "Running" means
		*    its absolute window AND its daily hours both hold.
		* 2. Otherwise a STANDING badge (one the upstream did not mark `activeOnly`)
		*    describes the model for as long as the promotion itself lasts. It is
		*    offered only inside the promotion's absolute window, so an expired
		*    promotion stops advertising itself even though its badge was standing.
		*
		* TWO RULES KEEP STEP 2 FROM STATING SOMETHING THE UPSTREAM DID NOT:
		*
		* a. An entry that publishes daily hours may stand outside them (that is what
		*    "the hours govern the discount, not the badge" means), but an entry whose
		*    hours could not be parsed cannot stand at all — see `dailyUnusable`.
		* b. A standing entry with NO schedule at all must not outrank a promotion
		*    that is genuinely running. `promoActiveAt` returns true for a
		*    schedule-less tier, which is correct on its own, but it made a
		*    high-priority tier shadow a lower-priority campaign whose window really
		*    is open. Step 1 is therefore restricted to entries that carry a
		*    `schedule`; the schedule-less badges compete only in step 2, where they
		*    belong.
		*
		* The upstream's own `priority` orders entries. Ties are broken toward the
		* promotion: a price badge ("Free now") is more actionable than an access-tier
		* badge ("Pro Only"), and the upstream numbers them equally.
		*
		* Only ONE badge is drawn per model: a model row is one line wide, and two
		* badges would push the model name and the image/think checkboxes out of it.
		*/
		/**
		* The multiplier to DRAW for a model right now: the promotion's discounted
		* price when a discount is running, otherwise the catalog's own figure.
		*
		* WHY THIS IS SEPARATE FROM THE BADGE. The badge answers "is this model on
		* offer"; this answers "at what price". They usually agree, but not always —
		* and when they disagreed the user saw a "night discount" badge next to the
		* full price (issue #120). The discount lives in the SAME entry that carries
		* the badge, so the two can be answered from one document and one clock.
		*
		* TWO RULES, both about not overstating an offer:
		*
		*   1. Only a promotion that is RUNNING at `nowMs` discounts the price. A
		*      standing badge (the daytime half of a night-discount pair) is drawn
		*      outside the discount hours, and it must NOT discount them — that is
		*      exactly the bug this function exists to prevent. The badge admits
		*      standing entries through `selectPromoBadge`; the price does not.
		*   2. `displayMode` must say `'replace'`, and the value must parse. An entry
		*      with a badge but no readable discount changes nothing, so the catalog's
		*      figure stands.
		*
		* The result is `undefined` when the catalog figure should be used unchanged —
		* the caller then keeps whatever it already draws. Returning the base value
		* from here would make a caller that has no base figure (a model whose
		* `credits` was absent) invent one.
		*/
		function selectPromoMultiplier(promos, nowMs) {
			if (promos === void 0 || promos.length === 0) return void 0;
			const sorted = [...promos].sort((a, b) => b.priority - a.priority || (a.source === b.source ? 0 : a.source === "promotion" ? -1 : 1));
			for (const promo of sorted) {
				const discount = promo.discount;
				if (discount === void 0 || discount.multiplier === void 0) continue;
				if (discount.displayMode !== "replace" && discount.displayMode !== "strikethrough") continue;
				if (!promoActiveAt(promo, nowMs)) continue;
				return discount.multiplier;
			}
		}
		function selectPromoBadge(promos, nowMs) {
			if (promos === void 0 || promos.length === 0) return void 0;
			const sorted = [...promos].sort((a, b) => b.priority - a.priority || (a.source === b.source ? 0 : a.source === "promotion" ? -1 : 1));
			const running = sorted.find((promo) => hasSchedule(promo) && promoActiveAt(promo, nowMs));
			if (running !== void 0) return running;
			return sorted.find((promo) => promo.badge.display !== "activeOnly" && promoWithinAbsoluteWindow(promo, nowMs) && promo.schedule?.dailyUnusable !== true);
		}
		/**
		* The chip's colour, when the upstream published a usable one.
		*
		* Only a hex colour is accepted: the value reaches an inline style, and the
		* upstream's feed publishes hex (`#009273`, `#FF0000`). Anything else is
		* refused rather than passed through, and the card falls back to its own
		* brand colour.
		*/
		function promoBadgeColor(promo) {
			const color = promo.badge.color;
			if (color === void 0) return void 0;
			return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : void 0;
		}
		"WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0".match(/WorkBuddy\/([^\s]+)/u)?.[1];
		new RegExp(`^(?:<acp\\b[^>]*>m\\d{1,8}<\\/acp>[ \\t]*\\r?\\n?)*(?:Time sampled while preparing turn \\d+, step \\d+:|Current runtime context\\.|<system-reminder>|\\[Compressed conversation section\\]|This is an efficiency nudge)`, "u");
		//#endregion
		//#region src/probe.ts
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
		* The `<timestamp> UTC±N` core of the upstream's reset sentence.
		*
		* Shared by both spellings below so the two can never drift into accepting
		* different timestamps: the offset handling and the calendar round-trip check in
		* {@link parseUpstreamResetAt} are what make a parsed value trustworthy, and two
		* copies of this shape would be two chances to loosen one of them.
		*/
		const RESET_STAMP = String.raw`(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?`;
		new RegExp(`将在?\\s*${RESET_STAMP}[\\s\\S]*?重置`, "u");
		new RegExp(`(?:reset|resets|refresh|refreshes)\\s+(?:at|on)\\s+${RESET_STAMP}`, "iu");
		//#endregion
		//#region src/client/pool-state.ts
		/**
		* Pure decision helpers for the account pool's card section.
		*
		* 参考：`src/account-pool.ts` 的做法——把「判定规则」从组件里抽出来，让规则本身
		*   可被单测直接钉住，而不是只能通过渲染整棵组件树间接观察。
		* 改动：新增本模块，收纳三组此前内联在 `AccountPool.tsx` 里的判定。抽出它们的
		*   直接原因是**独立验证发现 H-1/H-2 两个最高危修复没有任何自动化回归测试**：
		*   内联在组件里就只能靠真实渲染验证，而渲染测试既慢又容易被隔离问题骗过。
		*
		* 本模块不 import React、不碰网络，纯函数、全函数。
		*
		* @module dsh-connect-workbuddy/client/pool-state
		*/
		/**
		* The base a draft edit starts from.
		*
		* Resolved at EDIT time rather than captured when the callback was built. The
		* defect this fixes: the callback's dependency list named individual scalar
		* fields, so a field added later (`memberAccountIds`) was missing from it and
		* the callback kept a STALE base — checking one account then silently dropped
		* another that had been saved in between.
		*
		* `previous` is the draft already in state; it only applies to the region it
		* was made on, because the two pools are independent and one region's unsaved
		* edits must never seed the other's.
		*/
		function draftBaseFor(previous, previousRegion, region, saved) {
			return previous !== null && previousRegion === region ? previous : saved;
		}
		/**
		* Membership that resolves to a real local sign-in — what a batch runs on.
		*
		* The HOST computes this and sends it; this helper only chooses which answer to
		* trust. Counting the raw saved list is what let the UI claim "已选 1 / 共 1"
		* and enable both buttons while the batch ran on ZERO accounts and reported
		* success, so:
		*
		*   - while the draft is CLEAN, the Host's answer is authoritative (it reflects
		*     what would actually run, including sign-ins that have since disappeared);
		*   - while the draft is DIRTY, it must be derived from the edited list, since
		*     the Host's answer describes the SAVED state and would ignore the edit the
		*     user is looking at.
		*/
		function effectiveMemberIds(input) {
			if (!input.dirty) return [...input.savedEffective];
			return effectiveMembersOf(input.draftMembers, input.listedIds);
		}
		/**
		* Saved member ids with no matching sign-in.
		*
		* Surfaced rather than silently ignored: the ids remain in the user's saved
		* list (a login can come back), so the card has to explain why the pool behaves
		* as though they were absent.
		*/
		function ghostMemberIds(draftMembers, listedIds) {
			return draftMembers.filter((id) => !listedIds.has(id));
		}
		/** How many characters of an id are shown when no name was ever measured. */
		const GHOST_ID_PREFIX = 8;
		/**
		* Label saved member ids that resolve to no local sign-in (issue #60).
		*
		* The old warning was a bare count, which named no account and had no
		* corresponding row — the user could neither identify the member nor act on it,
		* even though the collected name was in hand at write time. This turns the same
		* set into something renderable and specific.
		*
		* `names` is the Host's last-measured map; a missing entry means no measurement
		* ever recorded a name, not that the account has none. Ids keep the order the
		* saved list has, so the rendered list does not reshuffle between polls.
		*/
		function ghostMembers(draftMembers, listedIds, names = {}) {
			return ghostMemberIds(draftMembers, listedIds).map((id) => {
				const measured = names[id];
				const named = typeof measured === "string" && measured !== "";
				return {
					id,
					label: named ? measured : `${id.slice(0, GHOST_ID_PREFIX)}…`,
					named
				};
			});
		}
		/**
		* The names to show in one sentence, capped so the warning stays readable.
		*
		* Beyond three the sentence would wrap into a paragraph, so it ends with an
		* ellipsis — the removable list rendered underneath carries the full set, which
		* is why truncating here cannot hide a member.
		*/
		function ghostNameList(ghosts, limit = 3) {
			const shown = ghosts.slice(0, limit).map((ghost) => ghost.label).join("、");
			return ghosts.length <= limit ? shown : `${shown}…`;
		}
		/**
		* How many accounts a batch will really touch, as the log announces it.
		*
		* Mirrors the HOST's own resolution exactly — `effective ?? saved` in the pool
		* route — because the number in the activity log must describe what the Host
		* runs, not what the card happens to display. Two wrong answers are possible and
		* both were live at different times:
		*
		*   - counting the raw SAVED list overstates it, so a ghost-only pool logged
		*     "checking in 1 account(s)" and was then refused with 409 having touched
		*     nothing;
		*   - counting the DRAFT-derived set announces unsaved edits the Host will not
		*     run (it reads the committed config).
		*
		* `savedEffective` is `undefined` only for a Host too old to send it, where the
		* saved list is the best available answer — the same fallback the route uses.
		*/
		function announcedBatchCount(input) {
			return (input.savedEffective ?? input.savedMembers).length;
		}
		/**
		* Localize a pool route failure from its structured cause.
		*
		* Lives here, not in `AccountPool.tsx`, because the card's module graph pulls
		* DSH's browser packages and there is no jsdom in this project — a rule left
		* inside the component cannot be tested at all. That is not hypothetical: the
		* independent verification deleted this function's `no-live-members` branch AND
		* both locale copies of its copy, and the whole 618-test suite still passed.
		* Extracting it is what lets `tests/pool-state.spec.ts` pin every branch.
		*
		* Returns undefined for an unknown cause so the caller can fall back to the
		* Host's own words — a new cause added upstream must still be visible rather
		* than swallowed into a generic message.
		*
		* `detail` is the Host's raw `error` text, used only where the sentence has a
		* slot for it (`pool-failed`). It is NOT the primary path: echoing English
		* developer prose into a Chinese UI was the defect this function exists to
		* prevent, and only the cases with no structured cause fall back to it.
		*/
		function poolErrorText(t, reason, detail) {
			switch (reason) {
				case "no-members": return t("row.poolErrNoMembers");
				case "no-live-members": return t("row.poolErrNoLiveMembers");
				case "no-free-model": return t("row.poolErrNoFreeModel");
				case "target-model-stale": return t("row.poolErrStaleModel");
				case "checkin-unsupported": return t("row.poolErrNoCheckin");
				case "pool-unavailable": return t("row.poolErrUnavailable");
				case "pool-failed": return t("row.poolErrFailed", { message: detail ?? "" });
				default: return;
			}
		}
		function poolFailureText(t, input) {
			return poolErrorText(t, input.reason, input.error) ?? input.error ?? (input.bodyUnreadable === true && input.status === 405 ? t("row.poolErrRouteMissing") : t("row.poolErrHttp", { status: String(input.status) }));
		}
		/**
		* Pool MEMBERS that can serve right now.
		*
		* Judged over members only. Using the whole account table made the "no usable
		* account" warning unreachable: unchecked rows are listed for the user to opt
		* into and never carry `excludedBy`, so any unchecked sign-in kept the count
		* above zero — exactly when every member was limited and the explanation was
		* most needed.
		*/
		function usableMemberIds(accounts, effectiveMembers, draftMembers) {
			const wanted = /* @__PURE__ */ new Set([...effectiveMembers, ...draftMembers]);
			return accounts.filter((account) => wanted.has(account.accountId) && account.excludedBy === void 0).map((account) => account.accountId);
		}
		/**
		* Whether EVERY member is blocked by the same MODEL — issue #64's pool-level
		* verdict.
		*
		* The reporter's case: four members, all measured `model-busy`, and the card
		* only showed four rows each saying "模型繁忙". Summed up by the reader that
		* reads as "my pool is broken", and the natural next move — switch accounts —
		* is the one action that cannot help, because the limit follows the model. The
		* per-row labels are each true and the aggregate conclusion is false, which is
		* why this needs its own decision rather than another row label.
		*
		* The conditions, and where each is enforced — NOT just "some member is
		* model-busy":
		*
		*   - **at least one member.** Enforced by the length check: an empty pool has
		*     no model-wide story to tell, and the plain "no usable account" sentence is
		*     the honest one there (nothing is checked).
		*   - **no member usable, and every blocked member's reason IS `model-busy`.**
		*     Both fall out of the single `every` predicate, because a usable member has
		*     `excludedBy === undefined`. See the note at the return statement: they are
		*     genuinely one condition in code, and writing them as two produced an
		*     unreachable branch that no test could hold.
		*
		* A pool where one account is rate-limited and the rest are model-busy is NOT a
		* model verdict: the rate limit really is about that account, and saying "it is
		* the model, not your accounts" would be the same class of false comfort this
		* helper exists to remove.
		*
		* Returned as a boolean rather than a prebuilt sentence so the caller keeps
		* every user-visible string in the locale table.
		*/
		function allMembersBlockedByModel(accounts, effectiveMembers, draftMembers) {
			const wanted = /* @__PURE__ */ new Set([...effectiveMembers, ...draftMembers]);
			const members = accounts.filter((account) => wanted.has(account.accountId));
			if (members.length === 0) return false;
			return members.every((member) => member.excludedBy === "model-busy");
		}
		//#endregion
		//#region src/client/AccountPool.tsx
		/**
		* The account pool's card section.
		*
		* 参考：`WorkBuddyCard.tsx` 的既有写法 —— 草稿态 + dirty 标记 + 「保存/放弃」、
		*   60 秒轮询、`writeField` 验证写入，全部沿用；样式类名继续用
		*   `dsm-workbuddy-*` 前缀，好让这一块与卡片其余部分共用同一套外观语言。
		* 改动：把「账号池」这一整块独立成模块。原因是它有三条别的区块没有的规则，
		*   放在卡片里会被淹没：
		*
		*   1. **一种状态、两套写入。** 偏好（启用、目标模型、成员）走草稿 + 保存
		*      （保存成功才丢弃草稿）；**测试结果**是运行时事实，由 Host 在批量测试后
		*      自动落盘，绝不经这个保存按钮。把它们混在一起，一次「保存」就会用旧草稿
		*      覆盖刚测出的结果。
		*   2. **免费模型可能不存在。** 国内版静态目录不带倍率，所以「自动挑免费模型」
		*      在国内版首次刷新前会挑到空。此时**不回退到收费模型**，而是如实说明并
		*      停用测试按钮。
		*   3. **签到只在有它的区域出现。** 海外区域没有签到，按钮与那一列都不渲染；
		*      Host 侧同样拒绝该动作，免得留下一个界面看不见、接口却还能打的死角。
		*
		* @module dsh-connect-workbuddy/client/AccountPool
		*/
		/** How many activity lines are kept; the oldest are dropped. */
		const LOG_LIMIT = 60;
		/**
		* Activity logs, kept per region OUTSIDE the component.
		*
		* The card unmounts its whole body when collapsed (`WorkBuddyCard.tsx:832`
		* renders it only while `open`), and again whenever a poll briefly leaves the
		* region unsigned-in. Component state therefore lost the entire log on every
		* collapse. Holding it here keeps the history across remounts and across tab
		* switches.
		*/
		const logStore = /* @__PURE__ */ new Map();
		/**
		* Whether two id sets are equal, ignoring order.
		*
		* The membership compare must not depend on click order: re-selecting the same
		* accounts in a different sequence is not an edit, and treating it as one would
		* light up "unsaved changes" for a no-op.
		*/
		function sameIds(left, right) {
			if (left.length !== right.length) return false;
			const wanted = new Set(right);
			return left.every((id) => wanted.has(id));
		}
		/**
		* Whether two id lists are equal IN ORDER.
		*
		* Unlike `sameIds`, position matters: manual priority is order-sensitive, so a
		* swapped pair is a real change and must light up "unsaved changes". A set
		* comparison here would treat reordering as a no-op and drop the user's sort.
		*/
		function sameOrder(left, right) {
			if (left.length !== right.length) return false;
			return left.every((id, index) => id === right[index]);
		}
		function formatNumber$1(value) {
			return formatCredits(value);
		}
		function formatClock$1(value) {
			return new Intl.DateTimeFormat(void 0, {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hourCycle: "h23"
			}).format(new Date(value));
		}
		/**
		* The pool section.
		*
		* Renders nothing when the Host reports no pool state at all: an older Host
		* built without this feature should show an unmodified card, not an empty
		* section implying the feature exists.
		*/
		function AccountPool(props) {
			const { t, region, pool, settingsScope, siblingBusy, onBusyChange, onSaved, onRefresh, onRescan, rescanning, onSelectAccount, selectingAccount, accountTools } = props;
			const { deviceMode, deviceProfiles, deviceDerived, onDeviceModeChange, onSaveDeviceProfile, realTier } = props;
			/**
			* 「真实值」能不能用。`undefined`（老 Host 没这一项）必须落到 `true`——读不到就
			* 禁用等于替用户取消一个可能可用的功能。
			*/
			const realTierUsable = realTier === void 0 ? true : realTier.state === "available";
			/** 当前正停在「真实值」但它已经不可用：把说明换成"用不了"，而不是宣传语。 */
			const modeHintBlocked = realTierUsable === false && deviceMode === "real";
			const [draft, setDraft] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(void 0);
			const [staleNotice, setStaleNotice] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(void 0);
			const [actionError, setActionError] = (0, react.useState)(void 0);
			const [log, setLog] = (0, react.useState)(() => logStore.get(region) ?? []);
			(0, react.useEffect)(() => {
				setLog(logStore.get(region) ?? []);
			}, [region]);
			const [draftRegion, setDraftRegion] = (0, react.useState)(void 0);
			const [orderRulesOpen, setOrderRulesOpen] = (0, react.useState)(false);
			/**
			* 设备头编辑器：哪个账号、是否在保存、上一次失败的原因。
			*
			* `undefined` = 弹窗关着。分开存 `saving`/`error` 而不是塞进同一个对象，是因为
			* 保存失败时弹窗必须**保持打开**并保留用户填的值——关掉再重开一次，填写内容
			* 就全没了。
			*/
			const [deviceEditing, setDeviceEditing] = (0, react.useState)(void 0);
			const [deviceSaving, setDeviceSaving] = (0, react.useState)(false);
			const [deviceError, setDeviceError] = (0, react.useState)(void 0);
			const [deviceBlockedOpen, setDeviceBlockedOpen] = (0, react.useState)(false);
			const [deviceModeBusy, setDeviceModeBusy] = (0, react.useState)(false);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const saved = {
				enabled: pool?.enabled ?? false,
				targetModelId: pool?.targetModelId || pool?.staleTargetModelId || "",
				probeInputTokens: pool?.probeInputTokens ?? 0,
				memberAccountIds: pool?.memberAccountIds ?? [],
				orderAccountIds: pool?.orderAccountIds ?? [],
				autoCheckin: pool?.autoCheckin === true
			};
			const active = draftRegion === region && draft !== null ? draft : saved;
			/**
			* Whether the pool is RUNNING right now, which is the SAVED value.
			*
			* `active` is the user's draft and only becomes reality at Save. Using it for
			* the parts that DESCRIBE the running pool made the card state a mode that had
			* not taken effect yet: flipping the switch off (unsaved) revealed the manual
			* picker while the pool was still ranking every request, so the picker showed
			* the rotated account as "in use" and a selection made there was overridden by
			* the very pool the user was looking at — the "shows A, bills B" trap this
			* section keeps guarding against. The mirror case was milder but the same
			* class of wrong: turning the pool ON (unsaved) hid the picker while the manual
			* account was still the one being billed.
			*
			* Everything that reports pool state reads this; only the switch itself (its
			* controlled value) and `dirty` read the draft, because those two ARE about
			* the pending edit.
			*/
			const poolRunning = saved.enabled;
			const dirty = draftRegion === region && draft !== null && (draft.enabled !== saved.enabled || draft.targetModelId !== saved.targetModelId || draft.probeInputTokens !== saved.probeInputTokens || !sameIds(draft.memberAccountIds, saved.memberAccountIds) || !sameOrder(draft.orderAccountIds, saved.orderAccountIds) || draft.autoCheckin !== saved.autoCheckin);
			/**
			* The automatic check-in's progress line, or nothing.
			*
			* Read from the SAVED switch, not the draft: this describes what the runner is
			* doing, and a draft that says "on" has not started anything yet. Showing
			* progress for a switch that is not saved would claim a job was running.
			*/
			const autoCheckinStatus = (() => {
				if (!saved.autoCheckin) return null;
				const today = pool?.autoCheckinToday;
				if (today === void 0) return null;
				const headline = today.pending === 0 && today.done === today.total ? t("row.poolAutoCheckinDone", { total: String(today.total) }) : t("row.poolAutoCheckinToday", {
					done: String(today.done),
					total: String(today.total)
				});
				return (0, react.createElement)("div", { className: "dsm-workbuddy-pool-auto-checkin-status" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-auto-checkin-line" }, headline), today.pending === 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-auto-checkin-pending" }, t("row.poolAutoCheckinPending", { count: String(today.pending) })), today.lastError === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-auto-checkin-error" }, t("row.poolAutoCheckinFailed", { message: today.lastError })));
			})();
			/**
			* Membership that actually resolves to a local sign-in — what a batch runs on.
			*
			* The HOST computes this and sends it, so the card cannot drift from the
			* batch's real behaviour. Counting the raw saved list is what let the UI
			* claim "已选 1 / 共 1" and enable both buttons while the batch ran on ZERO
			* accounts and reported success.
			*
			* Derived locally as a FALLBACK for the case where the user has edited the
			* draft (the Host's answer describes the SAVED state) or an older Host omits
			* the field.
			*/
			const listedIds = new Set((pool?.accounts ?? []).map((account) => account.accountId));
			const orderIds = (() => {
				const members = active.memberAccountIds.filter((id) => listedIds.has(id));
				const explicit = active.orderAccountIds.filter((id) => members.includes(id));
				const rest = members.filter((id) => !explicit.includes(id));
				return [...explicit, ...rest];
			})();
			const orderIsManual = active.orderAccountIds.some((id) => active.memberAccountIds.includes(id));
			const effectiveMembers = effectiveMemberIds({
				savedEffective: pool?.effectiveMemberAccountIds ?? [],
				draftMembers: active.memberAccountIds,
				listedIds,
				dirty
			});
			/**
			* Saved ids with no matching sign-in; surfaced rather than silently ignored.
			*
			* Named from the Host's last-measured map (issue #60): the id alone told the
			* user nothing, because nothing on screen shows ids. `pool.memberNames` can
			* only be absent for an older Host or an account never measured, and the
			* helper then falls back to an id prefix instead of a blank.
			*/
			const ghostMembers$1 = ghostMembers(active.memberAccountIds, listedIds, pool?.memberNames ?? {});
			/**
			* Pool MEMBERS that can serve right now.
			*
			* Judged over members only. Using the whole account table made the "no usable
			* account" warning unreachable: unchecked rows are listed for the user to opt
			* into and never carry `excludedBy`, so any unchecked sign-in kept the count
			* above zero — exactly when every member was limited and the explanation was
			* most needed.
			*/
			const usableMemberSet = new Set(usableMemberIds(pool?.accounts ?? [], effectiveMembers, active.memberAccountIds));
			const usable = (pool?.accounts ?? []).filter((account) => usableMemberSet.has(account.accountId));
			const canEditPool = settingsScope !== void 0;
			(0, react.useEffect)(() => {
				onBusyChange?.(saving);
				return () => {
					onBusyChange?.(false);
				};
			}, [onBusyChange, saving]);
			const appendLog = (0, react.useCallback)((text, tone) => {
				setLog((previous) => {
					const next = [{
						atMs: Date.now(),
						text,
						tone
					}, ...previous].slice(0, LOG_LIMIT);
					logStore.set(region, next);
					return next;
				});
			}, [region]);
			/**
			* The latest saved preferences, for callbacks that must not capture a stale
			* copy.
			*
			* `saved` is rebuilt on every render, so putting it in a `useCallback` dep
			* list would rebuild the callback every render (making the memo pointless),
			* while listing individual fields by hand is exactly what caused the
			* data-loss defect this ref fixes: a field added later
			* (`memberAccountIds`) was missing from the list, so the callback kept a
			* stale base and checking one account silently dropped another.
			*
			* A ref gives both properties at once — a STABLE callback identity and a
			* base read at call time. It is synced in a LAYOUT effect, which flushes
			* synchronously after commit and BEFORE the browser paints: a user event
			* cannot be processed before a frame is painted, so by the time any click
			* reaches `editDraft` the ref is current. (A plain `useEffect` would leave a
			* window between paint and its flush; a render-phase write would be unsafe
			* under concurrent rendering, where a discarded pass could leave the ref
			* holding values from a tree that never committed.)
			*
			* Seeded with the initial value so the very first interaction, before any
			* effect has run, still reads real preferences.
			*/
			const savedRef = (0, react.useRef)(saved);
			(0, react.useLayoutEffect)(() => {
				savedRef.current = saved;
			});
			/** Read by `editDraft` so it can refuse edits mid-save without rebuilding. */
			const savingRef = (0, react.useRef)(saving);
			(0, react.useLayoutEffect)(() => {
				savingRef.current = saving;
			});
			const editDraft = (0, react.useCallback)((edit) => {
				if (savingRef.current) return;
				setDraftRegion(region);
				setDraft((previous) => {
					return edit(draftBaseFor(previous, draftRegion, region, savedRef.current));
				});
			}, [draftRegion, region]);
			const discard = (0, react.useCallback)(() => {
				setDraft(null);
				setDraftRegion(void 0);
				setSaveError(void 0);
				setStaleNotice(void 0);
			}, []);
			/** Save the pool preferences through the plugin's VERIFIED write path. */
			const save = (0, react.useCallback)(async () => {
				if (settingsScope === void 0 || !dirty || draft === null) return;
				setSaving(true);
				setSaveError(void 0);
				setStaleNotice(void 0);
				try {
					await writePoolPreferences(settingsScope, region, draft);
					if (mounted.current) setSaving(false);
					discard();
					if (await onSaved?.() === false && mounted.current) setStaleNotice(t("row.poolSavedStaleRefresh"));
				} catch (error) {
					if (mounted.current) {
						const reason = error instanceof Error ? error.message : t("row.requestFailed");
						setSaveError(isFileContentionWriteError(error) ? `${reason}${t("row.saveContentionHint")}` : reason);
						setSaving(false);
					}
				}
			}, [
				dirty,
				discard,
				draft,
				onSaved,
				region,
				settingsScope,
				t
			]);
			/**
			* Drop one ghost member from the draft.
			*
			* A DRAFT edit, not a write: membership is one of the preferences the Save
			* button commits, and a control that wrote straight through would leave the
			* panel claiming "unsaved changes" for an edit it had already persisted. The
			* ghost rows therefore behave exactly like unchecking a listed account, which
			* is the behaviour the old copy ("save again to drop them") described but
			* gave the user no way to perform — the ids had no rows to uncheck.
			*/
			const removeGhost = (0, react.useCallback)((accountId) => {
				editDraft((current) => ({
					...current,
					memberAccountIds: current.memberAccountIds.filter((id) => id !== accountId)
				}));
			}, [editDraft]);
			/** Check or uncheck one account in this pool. */
			const toggleMember = (0, react.useCallback)((accountId, next) => {
				editDraft((current) => {
					const set = new Set(current.memberAccountIds);
					if (next) set.add(accountId);
					else set.delete(accountId);
					return {
						...current,
						memberAccountIds: [...set]
					};
				});
			}, [editDraft]);
			/**
			* Move one member one step up (`-1`) or down (`+1`) in the manual priority.
			*
			* The FIRST click is "the user starts sorting manually": it persists the WHOLE
			* currently-visible order into the draft, not just the one swapped pair. A
			* click that wrote only the moved id would leave the other rows unsorted (and
			* `orderIsManual` false), so the draft and the tables they power stay in sync.
			* `delta` is restricted to ±1 — a single swap per click — which is what makes
			* the first/last rows' extra buttons (rather than fields) correct.
			*/
			const moveMember = (0, react.useCallback)((accountId, delta) => {
				editDraft((current) => {
					const listed = new Set((pool?.accounts ?? []).map((account) => account.accountId));
					const members = current.memberAccountIds.filter((id) => listed.has(id));
					const explicit = current.orderAccountIds.filter((id) => members.includes(id));
					const rest = members.filter((id) => !explicit.includes(id));
					const visible = [...explicit, ...rest];
					const index = visible.indexOf(accountId);
					if (index < 0) return current;
					const to = index + delta;
					if (to < 0 || to >= visible.length) return current;
					const next = [...visible];
					next.splice(index, 1);
					next.splice(to, 0, accountId);
					return {
						...current,
						orderAccountIds: next
					};
				});
			}, [editDraft, pool]);
			/** Check every listed account, or none of them. */
			const selectAll = (0, react.useCallback)((next) => {
				editDraft((current) => ({
					...current,
					memberAccountIds: next ? (pool?.accounts ?? []).map((account) => account.accountId) : []
				}));
			}, [editDraft, pool]);
			/** Run one batch action against the Host. */
			const runAction = (0, react.useCallback)(async (action) => {
				setBusy(action);
				setActionError(void 0);
				const memberCount = announcedBatchCount({
					savedEffective: pool?.effectiveMemberAccountIds,
					savedMembers: pool?.memberAccountIds ?? []
				});
				appendLog(action === "checkin" ? t("row.poolLogCheckinStart", { count: memberCount }) : t("row.poolLogTestStart", {
					count: memberCount,
					model: pool?.targetModelId ?? ""
				}), "info");
				/**
				* One test row into the activity log.
				*
				* Shared by the STREAMED shape (a line per account) and the whole-batch
				* shape (an older Host's single document), so the two can never report the
				* same measurement differently — the failure mode this file's history is
				* mostly made of.
				*/
				const logTestRow = (row) => {
					const outcome = row?.result?.outcome;
					if (outcome === void 0) {
						appendLog(t("row.poolLogTestRowMalformed", { accountName: row?.accountName === "" || row?.accountName === void 0 ? t("row.accountUnnamed") : row.accountName }), "warn");
						return;
					}
					appendLog(t("row.poolLogTestRow", {
						accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
						outcome: outcomeText(t, outcome)
					}), outcomeOk(outcome) ? "ok" : "warn");
				};
				try {
					const response = await fetch(withWorkBuddyRegionAndAction(WORKBUDDY_POOL_PATH, region, action), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					let failed = false;
					if ((response.headers.get("content-type") ?? "").includes("ndjson")) {
						if (!response.ok) throw new Error(poolFailureText(t, { status: response.status }));
						let sawRow = false;
						await readNdjson(response.body, (line) => {
							const row = line["row"];
							if (row !== void 0) {
								sawRow = true;
								if (mounted.current) logTestRow(row);
								return;
							}
							const reason = line["reason"];
							if (typeof reason === "string") {
								failed = true;
								const message = poolFailureText(t, {
									status: 200,
									reason,
									error: typeof line["error"] === "string" ? line["error"] : void 0
								});
								if (mounted.current) {
									setActionError(message);
									appendLog(t("row.poolLogBatchFailed", { message }), "error");
								}
							}
						});
						if (!mounted.current) return;
						if (!failed && sawRow) appendLog(t("row.poolLogTestDone"), "ok");
					} else {
						const body = await response.json().catch(() => void 0);
						if (!response.ok) throw new Error(poolFailureText(t, {
							status: response.status,
							reason: body?.reason,
							error: body?.error,
							bodyUnreadable: body === void 0
						}));
						if (!mounted.current) return;
						if (action === "checkin") {
							for (const row of body?.rows ?? []) if (row.status === "claimed") appendLog(t("row.poolLogCheckinClaimed", {
								accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
								credit: String(row.credit ?? 0)
							}), "ok");
							else if (row.status === "already") appendLog(t("row.poolLogCheckinAlready", { accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName }), "info");
							else if (row.status === "skipped") appendLog(t("row.poolLogCheckinSkipped", { accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName }), "info");
							else appendLog(t("row.poolLogCheckinFailed", {
								accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
								message: row.message ?? t("row.requestFailed")
							}), "error");
							appendLog(t("row.poolLogCheckinDone"), "ok");
						} else {
							for (const row of body?.rows ?? []) logTestRow(row);
							appendLog(t("row.poolLogTestDone"), "ok");
						}
					}
					if (failed) return;
					onRefresh?.();
				} catch (error) {
					const message = error instanceof Error ? error.message : t("row.requestFailed");
					if (mounted.current) {
						setActionError(message);
						appendLog(t("row.poolLogBatchFailed", { message }), "error");
					}
				} finally {
					if (mounted.current) setBusy(void 0);
				}
			}, [
				appendLog,
				onRefresh,
				pool,
				region,
				t
			]);
			/** The account whose per-row action is in flight; gates every row's buttons. */
			const [rowBusyAccountId, setRowBusyAccountId] = (0, react.useState)(void 0);
			/**
			* Which per-row action is running, for the veil's scenario line.
			*
			* A removal and a test both set `rowBusyAccountId`, but they mean different
			* things to the person watching ("this account is going away" versus "this
			* account is being measured") — and the veil exists precisely to say which.
			*/
			const [rowBusyAction, setRowBusyAction] = (0, react.useState)(void 0);
			/**
			* Test ONE account from its row.
			*
			* Same Host rule as the batch (testOne reuses the batch's probe), the same
			* log vocabulary, and the same refresh-after — a row result must read exactly
			* like the batch result it replaces.
			*/
			const runRowTest = (0, react.useCallback)(async (accountId) => {
				setRowBusyAccountId(accountId);
				setRowBusyAction("test");
				setActionError(void 0);
				const url = withWorkBuddyRegionAndAction(WORKBUDDY_POOL_PATH, region, "test") + "&accountId=" + encodeURIComponent(accountId);
				try {
					const response = await fetch(url, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(poolFailureText(t, {
						status: response.status,
						reason: body?.reason,
						error: body?.error,
						bodyUnreadable: body === void 0
					}));
					if (!mounted.current) return;
					const row = body?.rows?.[0];
					if (row === void 0) {
						setActionError(t("row.poolLogTestRowMalformed", { accountName: t("row.accountUnnamed") }));
						return;
					}
					const outcome = row.result?.outcome;
					if (outcome === void 0) appendLog(t("row.poolLogTestRowMalformed", { accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName }), "warn");
					else appendLog(t("row.poolLogTestRow", {
						accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
						outcome: outcomeText(t, outcome)
					}), outcomeOk(outcome) ? "ok" : "warn");
					onRefresh?.();
				} catch (error) {
					const message = error instanceof Error ? error.message : t("row.requestFailed");
					if (mounted.current) {
						setActionError(message);
						appendLog(t("row.poolLogBatchFailed", { message }), "error");
					}
				} finally {
					if (mounted.current) {
						setRowBusyAccountId(void 0);
						setRowBusyAction(void 0);
					}
				}
			}, [
				appendLog,
				onRefresh,
				region,
				t
			]);
			/**
			* RE-TEST THE ONE ACCOUNT WHOSE STATED COOLDOWN HAS RUN OUT — by itself, once.
			*
			* The row used to print 「被限流 · 限流时段已过 · 重新测试以确认」: a verdict, a
			* note that the verdict had expired, and a chore for the reader, in one line
			* that contradicted itself. The owner's answer was that the plugin should
			* simply measure that single account rather than write such a sentence, so
			* this does exactly that: one account, one request, no click.
			*
			* WHY AN EFFECT rather than a decision taken while rendering: `runRowTest` is
			* async and writes state, and a render must never start requests. Running after
			* the snapshot has been painted means the row first shows the honest
			* 「恢复时间已到 · 待复核」, which the new measurement then replaces.
			*
			* ONCE PER ACCOUNT PER MOUNT. The old record keeps being rendered until the new
			* one lands, so without `autoRetested` every re-render in that window would
			* fire another test, and a pool of limited accounts would hammer the upstream.
			* A FAILED re-test is final too: the row keeps its stale record instead of
			* looping on a route that is refusing.
			*
			* ONE AT A TIME. Any write in flight — a batch, a removal, another row's test —
			* returns early; the next candidate is picked on the render after the previous
			* one has flipped its own probe. Firing them together would race the refresh
			* each of them triggers (the same reason the batch is serialized).
			*/
			const autoRetested = (0, react.useRef)(/* @__PURE__ */ new Set());
			(0, react.useEffect)(() => {
				if (!mounted.current || pool === void 0 || !active.enabled) return;
				if (rowBusyAccountId !== void 0 || busy !== void 0) return;
				if (pool.targetModelSource === "none" || pool.targetModelSource === "stale") return;
				const now = Date.now();
				for (const account of pool.accounts) {
					if (!active.memberAccountIds.includes(account.accountId)) continue;
					const probe = account.probe;
					if (probe === void 0 || probe.retryAtMs === void 0) continue;
					if (probe.outcome !== "rate-limited" && probe.outcome !== "model-busy") continue;
					if (probe.retryAtMs > now) continue;
					if (autoRetested.current.has(account.accountId)) continue;
					autoRetested.current.add(account.accountId);
					runRowTest(account.accountId);
					return;
				}
			}, [
				active.enabled,
				active.memberAccountIds,
				busy,
				pool,
				rowBusyAccountId,
				runRowTest
			]);
			/**
			* Claim ONE benefit on ONE account, from its row (issue #79).
			*
			* Always a single account and a single campaign: there is no batch entry
			* point, because a claim spends a real entitlement that cannot be undone. The
			* row is the unit of consent, so the row is the only way to ask for it.
			*
			* The Host re-reads the campaign before AND after the write, so the message
			* here reports what the gateway says now rather than what was requested. The
			* refresh afterwards is what actually removes the 待领取 line: the card has no
			* optimistic update, so a claim that silently did nothing cannot leave a stale
			* line claiming credits were taken.
			*/
			const runRowClaim = (0, react.useCallback)(async (accountId, accountName, kind, title, creditNum) => {
				const name = accountName === "" ? t("row.accountUnnamed") : accountName;
				setRowBusyAccountId(accountId);
				setRowBusyAction("claim");
				setActionError(void 0);
				const url = withWorkBuddyRegion(WORKBUDDY_BENEFIT_CLAIM_PATH, region) + "&accountId=" + encodeURIComponent(accountId) + "&kind=" + encodeURIComponent(kind);
				try {
					const response = await fetch(url, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(poolFailureText(t, {
						status: response.status,
						reason: body?.reason,
						error: body?.error,
						bodyUnreadable: body === void 0
					}));
					if (!mounted.current) return;
					appendLog(t("row.poolLogBenefitClaimed", {
						accountName: name,
						title,
						count: formatNumber$1(creditNum)
					}), "ok");
					await onRefresh?.();
				} catch (error) {
					const message = error instanceof Error ? error.message : t("row.requestFailed");
					if (mounted.current) {
						setActionError(message);
						appendLog(t("row.poolLogBenefitFailed", {
							accountName: name,
							message
						}), "error");
					}
				} finally {
					if (mounted.current) {
						setRowBusyAccountId(void 0);
						setRowBusyAction(void 0);
					}
				}
			}, [
				appendLog,
				onRefresh,
				region,
				t
			]);
			/**
			* Remove ONE account from its row, via the Host.
			*
			* The Host dismisses the account (and deletes its vault entry when it has
			* one), so the row stays gone across rescans. The desktop app is not signed
			* out. The message below still distinguishes the two cases, because "there
			* was no plugin-stored copy" is worth saying: it tells the user the account
			* comes from the app itself rather than from an OAuth sign-in or an import.
			*/
			const runRowRemove = (0, react.useCallback)(async (accountId, accountName) => {
				setRowBusyAccountId(accountId);
				setRowBusyAction("remove");
				setActionError(void 0);
				const url = withWorkBuddyRegionAndAction(WORKBUDDY_POOL_PATH, region, "remove") + "&accountId=" + encodeURIComponent(accountId);
				try {
					const response = await fetch(url, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(poolFailureText(t, {
						status: response.status,
						reason: body?.reason,
						error: body?.error,
						bodyUnreadable: body === void 0
					}));
					if (!mounted.current) return;
					appendLog(body?.removed === true ? t("row.poolRowRemoved", { accountName: accountName === "" ? t("row.accountUnnamed") : accountName }) : t("row.poolRowRemoveDesktopOnly", { accountName: accountName === "" ? t("row.accountUnnamed") : accountName }), body?.removed === true ? "ok" : "info");
					await onRefresh?.();
				} catch (error) {
					const message = error instanceof Error ? error.message : t("row.requestFailed");
					if (mounted.current) {
						setActionError(message);
						appendLog(t("row.poolLogBatchFailed", { message }), "error");
					}
				} finally {
					if (mounted.current) {
						setRowBusyAccountId(void 0);
						setRowBusyAction(void 0);
					}
				}
			}, [
				appendLog,
				onRefresh,
				region,
				t
			]);
			if (pool === void 0) return null;
			/**
			* Where the target model came from, and which model it is.
			*
			* Shown INSIDE the 「目标 test model」 setting row (as its description line)
			* rather than as a note under the buttons, which is where it used to be — one
			* of two places that stated the target model, the other being the header
			* subtitle. Both are gone from the header, so this is now the single place the
			* provenance is stated, right beside the control it describes.
			*
			* Returns null when there is nothing to say, so the caller can fall back to the
			* static explanation instead of rendering an empty "current:" prefix.
			*/
			const targetProvenance = pool.targetModelSource === "free" ? t("row.poolTargetCurrentFree", { model: pool.targetModelId ?? "" }) : null;
			/**
			* The account the next request will start from.
			*
			* Read from the Host's `current` flag rather than re-derived here: the Host
			* owns the selection, and a browser-side guess is how the card would start
			* disagreeing with the account actually billed.
			*/
			const currentAccount = pool.accounts.find((account) => account.current);
			const currentName = currentAccount === void 0 ? void 0 : currentAccount.accountName === "" ? t("row.accountUnnamed") : currentAccount.accountName;
			/**
			* The manual-mode picker: shown ONLY with the pool off, and it is the whole of
			* "manual mode" — with the pool off nothing else chooses who is billed.
			*
			* It lives in the HEAD line, sharing one slot with the 「current: X」 badge,
			* instead of in a row of its own further down. That row said the same account
			* name for the third time on one screen (badge, picker, member row), and the
			* repetition is what made the page read as generated rather than designed.
			* The two states are the two halves of one question — "who serves?" — so they
			* get one place to answer it: a picker when the answer is yours, a badge when
			* the pool decides.
			*/
			const manualPicker = !poolRunning && onSelectAccount !== void 0 && pool.accounts.length > 0 ? (0, react.createElement)("label", { className: "dsm-workbuddy-pool-head-pick" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-head-pick-label" }, t("row.poolManualAccountLabel")), (0, react.createElement)("select", {
				className: "dsm-workbuddy-pool-select dsm-workbuddy-pool-account-select",
				value: currentAccount?.accountId ?? "",
				disabled: selectingAccount === true,
				onChange: (event) => {
					onSelectAccount(event.currentTarget.value);
				}
			}, pool.accounts.some((account) => account.current) ? null : (0, react.createElement)("option", {
				value: "",
				disabled: true
			}, t("row.poolManualAccountNone")), ...pool.accounts.map((account) => (0, react.createElement)("option", {
				key: account.accountId,
				value: account.accountId
			}, account.accountName === "" ? t("row.accountUnnamed") : account.accountName)))) : null;
			/**
			* The full ordering rule, collapsed — pure reference text.
			*
			* It used to sit between 「本池包含的账号」 and the first account row, which put
			* a paragraph of explanation ahead of the accounts it explains and pushed the
			* table down. Reference text belongs BELOW the data it describes; here it is,
			* at the top of 「更多设置」, next to the controls it explains.
			*
			* A <details>/<summary> pair rather than a stateful button: it is
			* keyboard-operable and screen-reader-expanded natively, and cannot fall out
			* of sync with what is on screen. `open` is controlled so a background refresh
			* cannot collapse a section the user just opened.
			*/
			const orderRules = (0, react.createElement)("details", {
				className: "dsm-workbuddy-pool-order-rules",
				open: orderRulesOpen,
				onToggle: (event) => setOrderRulesOpen(event.currentTarget.open)
			}, (0, react.createElement)("summary", { className: "dsm-workbuddy-pool-order-rules-summary" }, t("row.poolOrderRulesTitle")), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-order-rules-body" }, (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolOrderRulesIntro")), (0, react.createElement)("ol", { className: "dsm-workbuddy-pool-order-rules-list" }, ...ORDER_RULE_KEYS.map((key) => (0, react.createElement)("li", { key }, t(key)))), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-order-rules-why" }, t("row.poolOrderWhy")), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolOrderBadgeNote"))));
			/**
			* 切换设备头档位。**即时生效**，不走草稿：这个开关决定每一行那个齿轮是否可用，
			* 如果它要等一次「保存」才生效，用户会先看到齿轮没反应、再去找保存按钮。
			*/
			const changeDeviceMode = async (mode) => {
				if (onDeviceModeChange === void 0 || deviceModeBusy || mode === deviceMode) return;
				setDeviceModeBusy(true);
				setActionError(void 0);
				try {
					await onDeviceModeChange(mode);
				} catch (error) {
					if (mounted.current) setActionError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setDeviceModeBusy(false);
				}
			};
			/** 保存一个账号的覆盖值；失败时让弹窗留着、把原因放在里面。 */
			const saveDeviceProfileFor = async (accountId, values) => {
				if (onSaveDeviceProfile === void 0) return;
				setDeviceSaving(true);
				setDeviceError(void 0);
				try {
					await onSaveDeviceProfile(accountId, values);
					if (mounted.current) setDeviceEditing(void 0);
				} catch (error) {
					if (mounted.current) setDeviceError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setDeviceSaving(false);
				}
			};
			/**
			* 弹窗的派生值那一块。
			*
			* 三种情况必须分开，因为它们对用户的含义完全不同：
			* - 有值 → 直接显示"留空会发这个"；
			* - 整块缺席 → Host 没算（旧版本、或本机没有设备盐），这时一个头都不发；
			* - 有这块但这行没有 → 这个账号没有 uid，算不出来，同样不发设备头。
			* 合成一句"暂无"会把"本机不可用"和"这个账号不可用"混成同一件事。
			*/
			const derivedPropsFor = (accountId) => {
				if (deviceDerived === void 0) return { derivedNote: "row.deviceDerivedUnavailable" };
				const entry = deviceDerived[accountId];
				return entry === void 0 ? { derivedNote: "row.deviceDerivedNoUid" } : { derived: entry };
			};
			return (0, react.createElement)("section", { className: "dsm-workbuddy-pool" }, rowBusyAction === "remove" ? (0, react.createElement)(BusyOverlay, {
				visible: true,
				message: t("row.poolRowRemoving"),
				hint: t("row.veilHintList")
			}) : null, saving ? (0, react.createElement)(BusyOverlay, {
				visible: true,
				message: t("row.poolSaving"),
				hint: t("row.veilHintList")
			}) : null, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-head" }, (0, react.createElement)("h3", { className: "dsm-workbuddy-pool-title" }, t("row.poolTitle")), (0, react.createElement)("p", { className: "dsm-workbuddy-free-quota-warn" }, t("row.tabFreeQuotaWarn")), manualPicker !== null ? manualPicker : currentName === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-current-badge" }, t("row.poolCurrentHeader", { account: currentName }))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-settings dsm-workbuddy-pool-modebar" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-modebar-row" }, (0, react.createElement)("label", { className: "sw" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: active.enabled,
				disabled: !canEditPool,
				onChange: (event) => {
					const next = event.currentTarget.checked;
					editDraft((current) => ({
						...current,
						enabled: next
					}));
				}
			}), (0, react.createElement)("span", { className: "sw-track" })), (0, react.createElement)("b", { className: "dsm-workbuddy-pool-modebar-label" }, t("row.poolEnabled")), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-modebar-state" }, poolRunning ? t("row.poolModeAuto") : t("row.poolModeManual")), dirty ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-dirty" }, t("row.poolDirty")) : null), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolEnabledHint")), pool.checkinSupported ? (0, react.createElement)("div", { className: "dsm-workbuddy-pool-auto-checkin" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-switchrow" }, (0, react.createElement)("label", { className: "sw" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: active.autoCheckin,
				disabled: !canEditPool,
				onChange: (event) => {
					const next = event.currentTarget.checked;
					editDraft((current) => ({
						...current,
						autoCheckin: next
					}));
				}
			}), (0, react.createElement)("span", { className: "sw-track" })), (0, react.createElement)("b", { className: "dsm-workbuddy-pool-modebar-label" }, t("row.poolAutoCheckin"))), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolAutoCheckinHint")), autoCheckinStatus) : null), poolRunning && currentAccount !== void 0 && !effectiveMembers.includes(currentAccount.accountId) ? (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note dsm-workbuddy-pool-serving-note" }, t("row.poolServingOutside", { account: currentName ?? "" })) : null, poolRunning && effectiveMembers.length > 0 && usable.length === 0 ? allMembersBlockedByModel(pool?.accounts ?? [], effectiveMembers, active.memberAccountIds) ? (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, `${t("row.poolModelWideBusy")} ${t("row.poolModelWideBusyHint")}`) : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, `${t("row.poolNoCandidate")} ${t("row.poolNoCandidateHint")}`) : null, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-members" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-members-head" }, (0, react.createElement)("div", null, (0, react.createElement)("h4", { className: "dsm-workbuddy-pool-members-title" }, t("row.poolMembersTitle")), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolMembersHint"))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-members-actions" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-hint" }, t("row.poolSelectedCount", {
				count: effectiveMembers.length,
				total: pool.accounts.length
			})), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn",
				disabled: pool.accounts.length === 0 || !canEditPool,
				onClick: () => selectAll(true)
			}, t("row.poolSelectAll")), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn",
				disabled: effectiveMembers.length === 0 || !canEditPool,
				onClick: () => selectAll(false)
			}, t("row.poolSelectNone")))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-actions" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-actions-group" }, pool.checkinSupported ? (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-primary",
				disabled: busy !== void 0 || effectiveMembers.length === 0,
				onClick: () => {
					runAction("checkin");
				}
			}, busy === "checkin" ? t("row.poolCheckingIn") : t("row.poolCheckinAll")) : null, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: busy !== void 0 || effectiveMembers.length === 0 || pool.targetModelSource === "none" || pool.targetModelSource === "stale",
				title: pool.targetModelSource === "none" ? t("row.poolTargetNone") : pool.targetModelSource === "stale" ? t("row.poolTargetStale", { model: pool.staleTargetModelId ?? "" }) : void 0,
				onClick: () => {
					runAction("test");
				}
			}, busy === "test" ? t("row.poolTesting") : t("row.poolTestAll")), busy !== void 0 ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-hint" }, t("row.poolBusyHint")) : effectiveMembers.length === 0 ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-hint" }, t("row.poolNoneSelectedHint")) : null), onRescan === void 0 ? null : (0, react.createElement)("div", { className: "dsm-workbuddy-pool-actions-group" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: rescanning === true,
				onClick: onRescan
			}, rescanning === true ? t("row.accountsScanning") : t("row.accountsRescan")))), deviceMode === void 0 || onDeviceModeChange === void 0 ? null : (0, react.createElement)("div", { className: "dsm-workbuddy-device-mode" }, (0, react.createElement)("span", { className: "dsm-workbuddy-device-mode-title" }, t("row.deviceModeTitle")), (0, react.createElement)("span", {
				className: "dsm-workbuddy-device-mode-seg",
				role: "group",
				"aria-label": t("row.deviceModeTitle")
			}, ...["virtual", "real"].map((mode) => {
				const blocked = mode === "real" && realTierUsable === false;
				return (0, react.createElement)("button", {
					key: mode,
					type: "button",
					className: `dsm-workbuddy-device-seg-btn${deviceMode === mode ? " dsm-workbuddy-device-seg-on" : ""}`,
					"aria-pressed": deviceMode === mode,
					disabled: deviceModeBusy || blocked,
					title: blocked ? t("row.deviceModeRealUnsupported") : void 0,
					onClick: () => {
						changeDeviceMode(mode);
					}
				}, t(mode === "virtual" ? "row.deviceModeVirtual" : "row.deviceModeReal"));
			})), (0, react.createElement)("span", { className: "dsm-workbuddy-hint" }, modeHintBlocked ? t("row.deviceModeRealUnsupported") : deviceMode === "real" ? t("row.deviceModeHintReal") : t("row.deviceModeHintVirtual"))), (0, react.createElement)("div", { className: `dsm-workbuddy-pool-table${pool.checkinSupported ? " dsm-workbuddy-pool-table-checkin" : ""}` }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-row dsm-workbuddy-pool-row-head" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-col-account" }, t("row.poolColumnAccount")), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-col-credits" }, t("row.poolColumnCredits")), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-col-probe" }, t("row.poolColumnProbe")), pool.checkinSupported ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-col-checkin" }, t("row.poolColumnCheckin")) : null, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-col-actions" })), ...(() => {
				const ordered = sortAccountsByOrder(pool.accounts, orderIds);
				let memberSeen = 0;
				let memberTotal = 0;
				for (const account of ordered) if (active.memberAccountIds.includes(account.accountId)) memberTotal += 1;
				return ordered.map((account) => {
					const isMember = active.memberAccountIds.includes(account.accountId);
					const left = isMember ? memberSeen : -1;
					const right = isMember ? memberTotal - 1 - memberSeen : -1;
					if (isMember) memberSeen += 1;
					return renderAccountRow({
						t,
						account,
						checked: isMember,
						canEdit: canEditPool,
						checkinSupported: pool.checkinSupported,
						onToggle: (next) => toggleMember(account.accountId, next),
						busy: rowBusyAccountId === account.accountId,
						rowBusy: rowBusyAccountId !== void 0,
						rowBusyAction,
						/** The pill also needs to know WHICH row is busy, not just that one is. */
						claimBusy: rowBusyAccountId === account.accountId,
						testDisabled: pool.targetModelSource === "none" || pool.targetModelSource === "stale",
						targetHint: pool.targetModelSource === "none" ? t("row.poolTargetNone") : pool.targetModelSource === "stale" ? t("row.poolTargetStale", { model: pool.staleTargetModelId ?? "" }) : void 0,
						poolModelId: pool.targetModelId ?? "",
						onTest: () => {
							runRowTest(account.accountId);
						},
						onRemove: () => {
							runRowRemove(account.accountId, account.accountName);
						},
						...onSaveDeviceProfile === void 0 ? {} : { onEditDevice: () => {
							if (deviceMode === "real") {
								setDeviceBlockedOpen(true);
								return;
							}
							setDeviceError(void 0);
							setDeviceEditing({
								accountId: account.accountId,
								name: account.accountName
							});
						} },
						deviceGearBlocked: deviceMode === "real",
						onClaim: (kind, title, creditNum) => {
							runRowClaim(account.accountId, account.accountName, kind, title, creditNum);
						},
						orderIndex: isMember && orderIsManual ? left + 1 : void 0,
						orderIsManual,
						moveEnabled: active.enabled && isMember && canEditPool,
						onMoveUp: () => {
							moveMember(account.accountId, -1);
						},
						onMoveDown: () => {
							moveMember(account.accountId, 1);
						},
						moveUpDisabled: left <= 0,
						moveDownDisabled: right <= 0
					});
				});
			})()), ghostMembers$1.length === 0 ? null : (0, react.createElement)("div", { className: "dsm-workbuddy-pool-ghosts" }, (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, t("row.poolGhostMembers", {
				count: ghostMembers$1.length,
				names: ghostNameList(ghostMembers$1)
			})), (0, react.createElement)("ul", { className: "dsm-workbuddy-pool-ghost-list" }, ghostMembers$1.map((ghost) => (0, react.createElement)("li", {
				key: ghost.id,
				className: "dsm-workbuddy-pool-ghost"
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-ghost-name" }, ghost.label), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-workbuddy-pool-ghost-remove",
				title: t(ghost.named ? "row.poolGhostRemoveNamed" : "row.poolGhostRemoveUnnamed", { account: ghost.label }),
				"aria-label": t("row.poolGhostRemove", { account: ghost.label }),
				disabled: saving,
				onClick: () => {
					removeGhost(ghost.id);
				}
			}, "✕"))))), dirty && !sameIds(active.memberAccountIds, saved.memberAccountIds) ? (0, react.createElement)("p", { className: "dsm-workbuddy-pool-dirty" }, t("row.poolUnsavedMembers")) : null), pool.targetModelSource === "none" ? (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, `${t("row.poolTargetNone")} ${t("row.poolTargetNoneHint")}`) : null, pool.targetModelSource === "stale" ? (0, react.createElement)("div", { className: "dsm-workbuddy-pool-conflict" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-conflict-main" }, (0, react.createElement)("b", null, t("row.poolTargetStale", { model: pool.staleTargetModelId ?? "" })), (0, react.createElement)("span", null, t("row.poolTargetStaleHint"))), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: !canEditPool,
				onClick: () => {
					editDraft((current) => ({
						...current,
						targetModelId: ""
					}));
				}
			}, t("row.poolTargetStaleClear"))) : null, actionError === void 0 ? null : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-error",
				role: "alert"
			}, actionError), renderSettings({
				t,
				pool,
				active,
				dirty,
				saving,
				siblingBusy: siblingBusy === true,
				saveError,
				staleNotice,
				settingsScope,
				onEdit: editDraft,
				onSave: () => {
					save();
				},
				onDiscard: discard,
				appendLog,
				targetProvenance,
				orderRules,
				...accountTools === void 0 ? {} : { accountTools }
			}), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolRegionNote")), renderLog({
				t,
				log,
				busy: busy !== void 0,
				onClear: () => {
					logStore.set(region, []);
					setLog([]);
				}
			}), deviceEditing === void 0 ? null : (0, react.createElement)(DeviceProfileDialog, {
				t,
				accountName: deviceEditing.name,
				saved: {
					machineId: deviceProfiles?.[deviceEditing.accountId]?.machineId ?? "",
					sessionId: deviceProfiles?.[deviceEditing.accountId]?.sessionId ?? ""
				},
				...derivedPropsFor(deviceEditing.accountId),
				saving: deviceSaving,
				...deviceError === void 0 ? {} : { error: deviceError },
				onCancel: () => {
					setDeviceEditing(void 0);
					setDeviceError(void 0);
				},
				onSave: (values) => {
					saveDeviceProfileFor(deviceEditing.accountId, values);
				}
			}), deviceBlockedOpen ? (0, react.createElement)(DeviceModeBlockedDialog, {
				t,
				onClose: () => setDeviceBlockedOpen(false)
			}) : null);
		}
		/** One account's row. */
		function renderAccountRow(input) {
			const { t, account, checked, canEdit, checkinSupported, onToggle, busy, rowBusy, testDisabled, targetHint, onTest, onRemove, onClaim, rowBusyAction, claimBusy, orderIndex, orderIsManual, moveEnabled, onMoveUp, onMoveDown, moveUpDisabled, moveDownDisabled, poolModelId, onEditDevice, deviceGearBlocked } = input;
			const name = account.accountName === "" ? t("row.accountUnnamed") : account.accountName;
			const excluded = exclusionText(t, account.excludedBy);
			const probe = account.probe;
			/**
			* Would the exclusion label say what line two already says?
			*
			* Both facts come from the SAME measurement: `excludedBy` is derived from the
			* probe, so for every outcome that doubles as an exclusion reason (rate-limited,
			* model-busy, out-of-credit, credential-rejected, account-restricted,
			* unavailable, not-found, failed) the label is a second copy of the verdict a
			* few pixels away. Comparing the REASON CODE, not the translated string: the
			* string comparison this replaces covered only `rate-limited`, so 「模型繁忙 ·
			* … · 模型繁忙」 and 「积分用尽 · … · 积分用尽」 still printed the verdict twice —
			* and it would have silently un-fixed itself on the next wording change.
			*
			* With no probe at all the label is not duplicated but REUSED: `availabilityLine`
			* falls back to exactly this text.
			*/
			const excludedRepeatsVerdict = excluded === void 0 || probe === void 0 || probe.outcome === account.excludedBy;
			const measuredButSilent = probe !== void 0 && availabilityLine(t, account) === void 0;
			const outcomeLine = availabilityLine(t, account) ?? (probe === void 0 ? t("row.poolNeverTested") : void 0);
			const reason = probe === void 0 ? void 0 : inlineProbeReason(probe.outcome, probe.message);
			const age = probe === void 0 ? void 0 : probeAgeText(t, probe.atMs, Date.now());
			const probeLabel = probe === void 0 ? void 0 : probe.source === void 0 ? {
				text: t("row.poolProbeSourceUnknown"),
				className: "dsm-workbuddy-pool-prov-tag dsm-workbuddy-pool-prov-unknown"
			} : probe.source === "live-request" ? {
				text: t("row.poolProbeSourceLive"),
				className: "dsm-workbuddy-pool-prov-tag dsm-workbuddy-pool-prov-live"
			} : {
				text: t("row.poolProbeSourceTest"),
				className: "dsm-workbuddy-pool-prov-tag"
			};
			const probeLine = [outcomeLine, reason].filter((part) => part !== void 0 && part !== "").join(" · ");
			return (0, react.createElement)("div", {
				className: `dsm-workbuddy-pool-row${account.current ? " dsm-workbuddy-pool-row-current" : ""}`,
				key: account.accountId
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-account" }, (0, react.createElement)("label", { className: "dsm-workbuddy-pool-check" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked,
				disabled: !canEdit,
				"aria-label": t("row.poolSelectAria", { accountName: name }),
				onChange: (event) => onToggle(event.currentTarget.checked)
			})), (0, react.createElement)("span", {
				className: "dsm-workbuddy-usage-dot",
				style: { background: stateColor(account) }
			}), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-account-name" }, (0, react.createElement)("b", null, name), checked ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-order" }, orderIsManual ? (0, react.createElement)("span", {
				className: "dsm-workbuddy-pool-rank",
				title: t("row.poolRankManualTitle")
			}, t("row.poolRankLabel", { rank: orderIndex ?? 0 })) : (0, react.createElement)("span", {
				className: "dsm-workbuddy-pool-rank dsm-workbuddy-pool-rank-auto",
				title: t("row.poolRankAutoTitle")
			}, t("row.poolRankAuto")), moveEnabled ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-move" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-workbuddy-pool-move-btn",
				title: t("row.poolMoveUpTitle"),
				"aria-label": t("row.poolMoveUpAria", { accountName: name }),
				disabled: moveUpDisabled,
				onClick: onMoveUp
			}, "↑"), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-workbuddy-pool-move-btn",
				title: t("row.poolMoveDownTitle"),
				"aria-label": t("row.poolMoveDownAria", { accountName: name }),
				disabled: moveDownDisabled,
				onClick: onMoveDown
			}, "↓")) : null) : null, account.current ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-current-tag" }, t("row.poolCurrentBadge")) : null, checked ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-not-member" }, t("row.poolNotMember")))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-credits" }, account.credits === void 0 ? (0, react.createElement)("span", null, "—") : (0, react.createElement)("b", null, formatNumber$1(account.credits)), account.expiringSoon !== void 0 && account.expiringSoon > 0 ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-soon" }, t("row.poolCreditSoon", { count: formatNumber$1(account.expiringSoon) })) : null, account.enterprise === true || account.benefits === void 0 || account.benefits.length === 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-benefits" }, account.benefits.map((benefit, index) => (0, react.createElement)("span", {
				key: benefit.kind,
				className: benefit.urgent ? "dsm-workbuddy-pool-benefit dsm-workbuddy-pool-benefit-urgent" : "dsm-workbuddy-pool-benefit"
			}, index === 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-prov-sep" }, "·"), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-benefit-tag" }, benefit.urgent ? benefit.daysLeft === void 0 || benefit.daysLeft === 0 ? t("row.poolBenefitDueToday", {
				title: benefit.title,
				count: formatNumber$1(benefit.creditNum)
			}) : t("row.poolBenefitUrgent", {
				title: benefit.title,
				count: formatNumber$1(benefit.creditNum),
				days: formatNumber$1(benefit.daysLeft)
			}) : t("row.poolBenefitClaimable", {
				title: benefit.title,
				count: formatNumber$1(benefit.creditNum)
			})), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn dsm-workbuddy-pool-benefit-btn",
				disabled: rowBusy,
				title: t("row.poolBenefitHint", { url: WORKBUDDY_PLAN_URL }),
				"aria-label": t("row.poolBenefitClaimAria", {
					title: benefit.title,
					count: formatNumber$1(benefit.creditNum)
				}),
				onClick: () => onClaim(benefit.kind, benefit.title, benefit.creditNum)
			}, (0, react.createElement)("span", null, claimBusy && rowBusyAction === "claim" ? t("row.poolBenefitClaiming") : t("row.poolBenefitClaim"))))))), (0, react.createElement)("span", {
				className: "dsm-workbuddy-pool-probe",
				...probe?.message === void 0 ? {} : { title: probe.message }
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-line" }, measuredButSilent ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-main" }, probeLine), excludedRepeatsVerdict || excluded === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-sep" }, "·"), excludedRepeatsVerdict ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-excluded" }, excluded), probe === void 0 || measuredButSilent && excludedRepeatsVerdict ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-sep" }, "·"), probe === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-tested-at" }, t("row.poolTestedAt", { at: formatShortClock(probe.atMs) }))), probeLabel === void 0 && age === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-prov" }, probeLabel === void 0 ? null : (0, react.createElement)("span", { className: probeLabel.className }, probeLabel.text), probeLabel === void 0 || age === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-prov-sep" }, "·"), age === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-prov-age" }, age), probe !== void 0 && probe.modelId !== poolModelId ? [(0, react.createElement)("span", {
				key: "sep",
				className: "dsm-workbuddy-pool-prov-sep"
			}, "·"), (0, react.createElement)("span", {
				key: "model",
				className: "dsm-workbuddy-pool-prov-model"
			}, probe.modelId === void 0 ? t("row.poolProbeModelUnknown") : t("row.poolProbeModel", { model: probe.modelId }))] : null)), checkinSupported ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-checkin" }, account.enterprise === true ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-unknown" }, t("row.poolCheckinEnterprise")) : account.checkedInToday === void 0 ? (0, react.createElement)("span", {
				className: "dsm-workbuddy-pool-unknown",
				title: t("row.poolNeverTested")
			}, t("row.poolCheckinUnknown")) : account.checkedInToday ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-checked" }, t("row.poolCheckedIn")) : t("row.poolNotCheckedIn")) : null, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-row-actions" }, onEditDevice === void 0 ? null : (0, react.createElement)("button", {
				type: "button",
				className: `dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn dsm-workbuddy-device-gear${deviceGearBlocked ? " dsm-workbuddy-device-gear-off" : ""}`,
				"aria-disabled": deviceGearBlocked ? true : void 0,
				title: deviceGearBlocked ? t("row.deviceGearBlockedHint") : t("row.deviceGearHint"),
				"aria-label": t("row.deviceGearAria", { accountName: name }),
				onClick: onEditDevice
			}, "⚙"), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn",
				disabled: rowBusy || testDisabled,
				title: testDisabled ? targetHint : void 0,
				onClick: onTest
			}, t("row.poolRowTest")), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn",
				disabled: rowBusy,
				title: t("row.poolRowRemoveHint"),
				"aria-label": t("row.poolRowRemoveAria", { accountName: name }),
				onClick: onRemove
			}, t("row.poolRowRemove"))));
		}
		/** The preference editor plus its save/discard actions. */
		function renderSettings(input) {
			const { t, pool, active, dirty, saving, siblingBusy, saveError, staleNotice, settingsScope, onEdit, onSave, onDiscard, targetProvenance, accountTools, orderRules } = input;
			const canEdit = settingsScope !== void 0;
			return (0, react.createElement)("div", { className: "dsm-workbuddy-pool-settings-wrap" }, accountTools === void 0 ? null : (0, react.createElement)("div", { className: "dsm-workbuddy-pool-tools" }, accountTools), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-card-head" }, (0, react.createElement)("h4", { className: "dsm-workbuddy-pool-card-title" }, t("row.poolSettingsTitle"))), orderRules, (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolSettingsHint")), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-settings" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-set" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-copy" }, (0, react.createElement)("b", null, t("row.poolTargetLabel")), (0, react.createElement)("span", null, targetProvenance === null ? null : `${targetProvenance} `, t("row.poolTargetHint"))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-ctl" }, (0, react.createElement)("select", {
				className: "dsm-workbuddy-pool-select",
				value: active.targetModelId,
				disabled: !canEdit,
				onChange: (event) => {
					const value = event.currentTarget.value;
					onEdit((current) => ({
						...current,
						targetModelId: value
					}));
				}
			}, (0, react.createElement)("option", { value: "" }, t("row.poolTargetAutoOption")), active.targetModelId !== "" && !(pool.catalog ?? []).some((m) => m.id === active.targetModelId) ? (0, react.createElement)("option", {
				value: active.targetModelId,
				disabled: true
			}, t("row.poolTargetStaleOption", { model: active.targetModelId })) : null, ...(pool.catalog ?? []).map((model) => (0, react.createElement)("option", {
				value: model.id,
				key: model.id
			}, model.creditMultiplier === void 0 ? model.name : `${model.name} (x${model.creditMultiplier.toFixed(2)})`))))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-set" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-copy" }, (0, react.createElement)("b", null, t("row.poolProbeSizeLabel")), (0, react.createElement)("span", null, t("row.poolProbeSizeHint"))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-ctl" }, (0, react.createElement)("select", {
				className: "dsm-workbuddy-pool-select",
				value: String(active.probeInputTokens),
				disabled: !canEdit,
				onChange: (event) => {
					const parsed = Number.parseInt(event.currentTarget.value, 10);
					const next = Number.isFinite(parsed) ? parsed : 0;
					onEdit((current) => ({
						...current,
						probeInputTokens: next
					}));
				}
			}, (0, react.createElement)("option", { value: "0" }, t("row.poolProbeSizeDefault")), ...PROBE_INPUT_TOKEN_CHOICES.map((tokens) => (0, react.createElement)("option", {
				value: String(tokens),
				key: String(tokens)
			}, t("row.poolProbeSizeOption", { tokens: String(tokens / 1e3) }))))))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-save-bar" }, (0, react.createElement)("a", {
				className: "dsm-workbuddy-usage-cheer",
				href: WORKBUDDY_GITHUB_URL,
				target: "_blank",
				rel: "noopener noreferrer"
			}, t("row.cheer"), (0, react.createElement)("span", {
				className: "dsm-workbuddy-usage-cheer-star",
				"aria-hidden": "true"
			}, "★")), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-save-buttons" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: !dirty || saving || siblingBusy,
				onClick: onDiscard
			}, t("row.poolDiscard")), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-primary",
				disabled: !dirty || saving || siblingBusy || !canEdit,
				onClick: onSave
			}, saving ? t("row.poolSaving") : t("row.poolSaved")))), saveError === void 0 ? null : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-error",
				role: "alert"
			}, t("row.poolSaveFailed", { message: saveError })), staleNotice === void 0 ? null : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, staleNotice));
		}
		/** The activity log. */
		function renderLog(input) {
			const { t, log, busy, onClear } = input;
			return (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log-head" }, (0, react.createElement)("span", null, t("row.poolLogTitle")), log.length === 0 ? null : (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-log-clear",
				disabled: busy === true,
				onClick: onClear
			}, t("row.poolLogClear"))), log.length === 0 ? (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log-empty" }, t("row.poolLogEmpty")) : (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log-body" }, ...log.map((entry, index) => (0, react.createElement)("div", {
				className: "dsm-workbuddy-pool-log-row",
				key: `${entry.atMs}-${index}`
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-log-time" }, formatClock$1(entry.atMs)), (0, react.createElement)("span", { className: `dsm-workbuddy-pool-log-text dsm-workbuddy-pool-log-${entry.tone}` }, entry.text)))));
		}
		/**
		* Sort accounts by the manual priority order, without losing stability.
		*
		* Helpers/rows are rendered in this order so a click on ↑/↓ reorders the row
		* immediately (client-side), before any save + host round-trip. Ids in `orderIds`
		* that are not actually members are skipped; members not listed fall back to the
		* END in their original relative order.
		*
		* The sort is STABLE: two ids with the same priority rank keep their original
		* array order. A `rank` lookup returns `orderIds.length` as the sentinel for
		* "not ordered", which is larger than any real rank, so unlisted members sort
		* after every listed one. An EMPTY `orderIds` short-circuits: the input order is
		* already the answer, and we avoid building the rank map / comparator for the
		* common (never-sorted) case.
		*
		* TWO subtleties that a naive rank comparator gets wrong, both of which would
		* make the table visibly wrong:
		*
		* - DUPLICATE ids keep the FIRST occurrence's rank (`if (!rank.has(id))`).
		*   Overwriting instead would let a stray duplicate silently push the account
		*   it names to the duplicate's later position, so the row would drift away
		*   from the badge that claims to describe it.
		* - The sort key is the PAIR (rank, original index), not rank alone. Ranks are
		*   unique per id, but the `Infinity` fallback is shared by every unlisted
		*   account, and `Array.prototype.sort` is NOT guaranteed stable across engines
		*   for arbitrary inputs; relying on it would let the unlisted tail reshuffle
		*   between renders. Breaking the tie on the original index makes the result a
		*   pure function of the input, which is what stops the table from jittering
		*   when the same snapshot arrives twice.
		*/
		/**
		* The ordering rules, in EXACTLY the comparator's priority order.
		*
		* Kept as one table rather than inline literals so the order is a single thing
		* a reader can compare against `src/account-pool.ts` — the rule text and the
		* code must never drift, and a flat list makes that diff trivial. Typed as
		* `WorkBuddySettingsKey` so a renamed or removed locale key is a compile error
		* instead of a raw key rendered to the user.
		*/
		const ORDER_RULE_KEYS = [
			"row.poolOrderRuleUsable",
			"row.poolOrderRuleExpiring",
			"row.poolOrderRuleManual",
			"row.poolOrderRuleNearestExpiry",
			"row.poolOrderRuleExpiringAmount",
			"row.poolOrderRuleTotal",
			"row.poolOrderRuleFreshness",
			"row.poolOrderRuleId"
		];
		function sortAccountsByOrder(accounts, orderIds) {
			return applyManualOrder(accounts.map((account) => ({
				id: account.accountId,
				account
			})), orderIds).map((entry) => entry.account);
		}
		//#endregion
		//#region src/client/device-sdk.ts
		/** 校验并折成 Host 的类型；形状不认识时返回 `undefined`，面板据此显示"不可用"。 */
		function normalize(body) {
			if (typeof body !== "object" || body === null) return void 0;
			const record = body;
			const sdk = record["sdk"];
			const token = record["token"];
			if (typeof sdk !== "object" || sdk === null || typeof token !== "object" || token === null) return void 0;
			const sdkRecord = sdk;
			const tokenRecord = token;
			const sdkState = sdkRecord["state"];
			const tokenState = tokenRecord["state"];
			const info = {
				state: sdkState === "ready" || sdkState === "unsupported" || sdkState === "missing" || sdkState === "error" || sdkState === "disabled" ? sdkState : "error",
				bundle: typeof sdkRecord["bundle"] === "string" ? sdkRecord["bundle"] : "",
				path: typeof sdkRecord["path"] === "string" ? sdkRecord["path"] : "",
				platform: typeof sdkRecord["platform"] === "string" ? sdkRecord["platform"] : "",
				arch: typeof sdkRecord["arch"] === "string" ? sdkRecord["arch"] : "",
				runtime: typeof sdkRecord["runtime"] === "string" ? sdkRecord["runtime"] : "",
				...typeof sdkRecord["reason"] === "string" ? { reason: sdkRecord["reason"] } : {}
			};
			const readout = {
				state: tokenState === "ok" || tokenState === "stale" || tokenState === "unavailable" || tokenState === "idle" ? tokenState : "unavailable",
				masked: typeof tokenRecord["masked"] === "string" ? tokenRecord["masked"] : "",
				length: typeof tokenRecord["length"] === "number" ? tokenRecord["length"] : 0,
				...typeof tokenRecord["fetchedAtMs"] === "number" ? { fetchedAtMs: tokenRecord["fetchedAtMs"] } : {},
				...typeof tokenRecord["lastAttemptMs"] === "number" ? { lastAttemptMs: tokenRecord["lastAttemptMs"] } : {},
				...typeof tokenRecord["reason"] === "string" ? { reason: tokenRecord["reason"] } : {}
			};
			return {
				tier: record["tier"] === "real" ? "real" : "virtual",
				sdk: info,
				token: readout,
				...typeof record["sdkEnabled"] === "boolean" ? { sdkEnabled: record["sdkEnabled"] } : {}
			};
		}
		/** 读状态。`undefined` = 这个 Host 没有这条路由（404/503），面板该整块隐藏。 */
		async function fetchDeviceSdk(path) {
			const response = await fetch(path, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			if (response.status === 404 || response.status === 503) return void 0;
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return normalize(await response.json());
		}
		async function post(path, action) {
			const response = await fetch(`${path}?action=${action}`, {
				method: "POST",
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			if (response.status === 409) return void 0;
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}
		/** 强制重取一次（会真的跑一次 SDK）。 */
		async function refreshDeviceSdk(path) {
			return normalize(await post(path, "refresh"));
		}
		/**
		* 写 SDK 总开关（`Config.deviceSdkEnabled`）。
		*
		* 501 = 这个宿主没有 settings 写入路径。抛出去而不是静默吞掉：卡片要把开关置灰，
		* 而那需要知道"做不到"，不是"做失败了"。
		*/
		async function setDeviceSdkEnabled(path, enabled) {
			const response = await fetch(`${path}?action=${enabled ? "enable" : "disable"}`, {
				method: "POST",
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			if (response.status === 501) throw new Error("this host has no settings write path");
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
		}
		/** 取完整值。只在用户点「显示」或「复制」时调用。 */
		async function revealDeviceSdk(path) {
			const body = await post(path, "reveal");
			if (typeof body !== "object" || body === null) return void 0;
			const token = body["token"];
			return typeof token === "string" && token !== "" ? token : void 0;
		}
		//#endregion
		//#region src/client/DeviceSdkPanel.tsx
		/**
		* 卡片「SDK」分区：这台机器能不能取到真实设备参数，以及取到的是什么。
		*
		* ## 为什么它单独一页，而不是塞进「诊断」
		*
		* 诊断页是"出问题时贴给开发看的一屏事实"，只读、不含操作。这一页有操作（重取、
		* 显示、复制），而且用户会在**没出问题**的时候来看它——切到「真实值」之后第一件
		* 事就是确认"真的连上了吗、值是什么"。把这两种意图混在一页，诊断页就再也没法
		* 保持"只读"这条约定。
		*
		* ## 为什么默认是星号
		*
		* 完整 token 能代表这台机器。这一页会被截图、会被贴进 issue，所以默认只给掩码；
		* 「显示」与「复制」各要一次点击，Host 也只为这两次点击返回完整值
		* （`POST ?action=reveal`，见 `src/status-paths.ts`）。
		*
		* @module dsh-connect-workbuddy/client/DeviceSdkPanel
		*/
		/** How one row reads: the label on the left, the value on the right. */
		function Row(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-diag-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-diag-label",
					children: props.label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: `dsm-workbuddy-diag-value${props.mono === true ? " dsm-workbuddy-diag-mono" : ""}`,
					children: props.children
				})]
			});
		}
		/** `12m ago` / `just now`, in the card's existing style. */
		function describeAge(t, ageMs) {
			if (ageMs < 6e4) return t("sdk.ageJustNow");
			const minutes = Math.floor(ageMs / 6e4);
			if (minutes < 60) return t("sdk.ageMinutes", { count: minutes });
			return t("sdk.ageHours", {
				count: Math.floor(minutes / 60),
				rest: minutes % 60
			});
		}
		function DeviceSdkPanel(props) {
			const { t, path, settingsPath } = props;
			const [report, setReport] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(true);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			/** 完整值：只在用户点过「显示」或「复制」之后才在内存里存在。 */
			const [value, setValue] = (0, react.useState)(void 0);
			const [copied, setCopied] = (0, react.useState)(false);
			/**
			* 设置里的 SDK 目录与回退开关（作者意见 #1 / #2）。
			*
			* `undefined` = 还没读回来（或这个 Host 没有设置路由）。两种情况都按"不渲染编辑
			* 控件"处理：一个初值为空串的输入框看起来像"用户清空过目录"，而那与实际状态
			* （走自动发现）相反。
			*/
			const [sdkDir, setSdkDir] = (0, react.useState)(void 0);
			const [fallback, setFallback] = (0, react.useState)(void 0);
			const [draftDir, setDraftDir] = (0, react.useState)("");
			const [savingDir, setSavingDir] = (0, react.useState)(false);
			const [savingFallback, setSavingFallback] = (0, react.useState)(false);
			const [savedNote, setSavedNote] = (0, react.useState)(false);
			/**
			* SDK 总开关（`Config.deviceSdkEnabled`）。
			*
			* 与上面那几项**不是同一份文档**：这个落在插件配置（`cordis.patch.yml`），
			* 而目录/回退落在设备设置文件。分两次读的理由与 `settingsPath` 分开一样——
			* 两者可以各自缺席。`undefined` = 这个 Host 还不认识这一项（或没有 settings
			* 服务），此时开关置灰并显示「不可用」，而不是假装它是关的。
			*/
			const [sdkMasterEnabled, setSdkMasterEnabled] = (0, react.useState)(void 0);
			const [savingMaster, setSavingMaster] = (0, react.useState)(false);
			/** 七处 `catch` 原本各写一遍同样的展平；收成一个。 */
			const fail = (cause) => setError(cause instanceof Error ? cause.message : String(cause));
			const load = (0, react.useCallback)(async (refresh) => {
				if (path === "") return;
				setBusy(true);
				setError(void 0);
				try {
					const next = refresh ? await refreshDeviceSdk(path) : await fetchDeviceSdk(path);
					setReport(next);
					if (next?.sdkEnabled !== void 0) setSdkMasterEnabled(next.sdkEnabled);
					if (refresh) {
						setValue(void 0);
						setCopied(false);
					}
				} catch (cause) {
					fail(cause);
				} finally {
					setBusy(false);
					setLoading(false);
				}
			}, [path]);
			/**
			* 读设置。与 SDK 状态**分两次**取，理由与 `settingsPath` 分开一样：两者可以
			* 各自缺席，而合成一次请求会让"设置路由没有"顺带把 SDK 状态也变成错误。
			*/
			const loadSettings = (0, react.useCallback)(async () => {
				if (settingsPath === "") return;
				try {
					const settings = await fetchDeviceSettings(settingsPath);
					if (settings === void 0) return;
					setSdkDir(settings.sdkDir);
					setFallback(settings.sdkFallbackToVirtual);
					setDraftDir(settings.sdkDir);
				} catch {}
			}, [settingsPath]);
			(0, react.useEffect)(() => {
				load(false);
			}, [load]);
			(0, react.useEffect)(() => {
				loadSettings();
			}, [loadSettings]);
			/**
			* 「已加载、没取过」不该停在屏幕上。
			*
			* 启动时的后台预热要起一个子进程再等一次网络（约几百毫秒），而这一页是在用户
			* 点开标签时挂载的——两者偶尔会撞在一起，那一瞬间读到的就是 idle。这里做有限次
			* 复查（最多 5 次、每次 1.2 秒）：预热一落地，这一行自己变成"可用"，而不是要用户
			* 手动点一次「重新获取」。上限是必须的——预热真的失败时，无限轮询只是一台一直
			* 发 GET 的机器。
			*/
			const idlePolls = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (path === "") return;
				if (report?.sdk.state !== "ready" || report.token.state !== "idle") return;
				if (idlePolls.current >= 5) return;
				idlePolls.current += 1;
				const timer = window.setTimeout(() => {
					fetchDeviceSdk(path).then((next) => {
						if (next !== void 0) setReport(next);
					}).catch(() => {});
				}, 1200);
				return () => window.clearTimeout(timer);
			}, [path, report]);
			if (path === "") return null;
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-workbuddy-panel-note",
				children: t("sdk.loading")
			});
			if (report === void 0 && error === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-workbuddy-panel-note",
				children: t("sdk.unavailable")
			});
			const toggle = async () => {
				if (value !== void 0) {
					setValue(void 0);
					return;
				}
				setError(void 0);
				try {
					const full = await revealDeviceSdk(path);
					if (full === void 0) setError(t("sdk.noValue"));
					else setValue(full);
				} catch (cause) {
					fail(cause);
				}
			};
			const copy = async () => {
				setError(void 0);
				try {
					const full = value ?? await revealDeviceSdk(path);
					if (full === void 0) {
						setError(t("sdk.noValue"));
						return;
					}
					await navigator.clipboard.writeText(full);
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 2e3);
				} catch (cause) {
					fail(cause);
				}
			};
			/**
			* 保存目录：写盘之后**立刻重探一次**。清空按钮复用同一条路径（原来内联重写了
			* 整个 try/catch/finally，是这份面板里最明显的一处复制粘贴）。
			*/
			const saveDir = async (dir = draftDir.trim()) => {
				if (settingsPath === "") return;
				setSavingDir(true);
				setError(void 0);
				setSavedNote(false);
				try {
					const next = await putDeviceSdk(settingsPath, { sdkDir: dir });
					setSdkDir(next.sdkDir);
					setDraftDir(next.sdkDir);
					setSavedNote(true);
					await load(true);
				} catch (cause) {
					fail(cause);
				} finally {
					setSavingDir(false);
				}
			};
			const saveFallback = async (nextValue) => {
				if (settingsPath === "") return;
				setSavingFallback(true);
				setError(void 0);
				try {
					const next = await putDeviceSdk(settingsPath, { sdkFallbackToVirtual: nextValue });
					setFallback(next.sdkFallbackToVirtual);
				} catch (cause) {
					fail(cause);
				} finally {
					setSavingFallback(false);
				}
			};
			/**
			* 切换 SDK 总开关。写完重读一次快照：状态行是从 `GET /device-sdk` 算的，
			* 只改本地 state 会让"已关"与下面那行"正常"并存。
			*/
			const saveMaster = async (nextValue) => {
				if (path === "") return;
				setSavingMaster(true);
				setError(void 0);
				try {
					await setDeviceSdkEnabled(path, nextValue);
					setSdkMasterEnabled(nextValue);
					await load(false);
				} catch (cause) {
					fail(cause);
				} finally {
					setSavingMaster(false);
				}
			};
			const sdk = report?.sdk;
			const token = report?.token;
			const stateKey = sdk?.state === "disabled" ? "sdk.statusDisabled" : sdk?.state === "ready" ? token?.state === "ok" ? "sdk.statusReady" : token?.state === "stale" ? "sdk.statusStale" : "sdk.statusNoToken" : sdk?.state === "missing" ? "sdk.statusMissing" : sdk?.state === "unsupported" ? "sdk.statusUnsupported" : "sdk.statusError";
			const stateOk = sdk?.state === "ready" && token?.state === "ok";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-sdk-master",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsm-workbuddy-sdk-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: sdkMasterEnabled ?? true,
							disabled: savingMaster || sdkMasterEnabled === void 0,
							onChange: (event) => {
								saveMaster(event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sdk.masterLabel") })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-hint",
						children: t("sdk.masterHint")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-workbuddy-panel-note",
					children: t("sdk.hint")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-diag",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Row, {
							label: t("sdk.state"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `dsm-workbuddy-sdk-dot${stateOk ? " dsm-workbuddy-sdk-dot-ok" : ""}`,
								"aria-hidden": "true"
							}), t(stateKey)]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("sdk.bundle"),
							mono: true,
							children: sdk === void 0 || sdk.bundle === "" ? t("sdk.unknown") : `${sdk.bundle} · ${sdk.path}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("sdk.runtime"),
							mono: true,
							children: sdk === void 0 || sdk.runtime === "" ? t("sdk.unknown") : sdk.runtime
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("sdk.fetched"),
							children: token?.fetchedAtMs === void 0 ? t("sdk.never") : `${new Date(token.fetchedAtMs).toLocaleTimeString()} (${describeAge(t, Date.now() - token.fetchedAtMs)})`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("sdk.tier"),
							children: report?.tier === "real" ? t("sdk.tierReal") : t("sdk.tierVirtual")
						})
					]
				}),
				sdk !== void 0 && sdk.reason !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-workbuddy-device-error",
					children: sdk.reason
				}) : null,
				token !== void 0 && token.reason !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-workbuddy-device-error",
					children: token.reason
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-device-field",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-device-field-label",
						children: t("sdk.valueLabel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						className: "dsm-workbuddy-sdk-value",
						"aria-label": t("sdk.valueLabel"),
						children: token === void 0 || token.length === 0 ? t("sdk.noValue") : value ?? `${token.masked}${token.length === 0 ? "" : ` (${t("sdk.length", { count: token.length })})`}`
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-device-random-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: busy || token === void 0 || token.length === 0,
							onClick: () => {
								toggle();
							},
							children: value === void 0 ? t("sdk.reveal") : t("sdk.hide")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: busy || token === void 0 || token.length === 0,
							onClick: () => {
								copy();
							},
							children: copied ? t("sdk.copied") : t("sdk.copy")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: busy,
							onClick: () => {
								load(true);
							},
							children: busy ? t("sdk.refreshing") : t("sdk.refresh")
						})
					]
				}),
				settingsPath === "" || sdkDir === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-device-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-device-field-label",
							children: t("sdk.dirLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-sdk-dir-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									className: "dsm-workbuddy-device-input dsm-workbuddy-sdk-dir-input",
									value: draftDir,
									placeholder: t("sdk.dirPlaceholder"),
									spellCheck: false,
									autoComplete: "off",
									"aria-label": t("sdk.dirLabel"),
									onChange: (event) => {
										setDraftDir(event.target.value);
										setSavedNote(false);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									disabled: savingDir || draftDir.trim() === sdkDir,
									onClick: () => {
										saveDir();
									},
									children: savingDir ? t("sdk.dirSaving") : t("sdk.dirSave")
								}),
								sdkDir === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									disabled: savingDir,
									onClick: () => {
										saveDir("");
									},
									children: t("sdk.dirClear")
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-workbuddy-hint",
						children: [savedNote ? `${t("sdk.dirSaved")} ` : "", t("sdk.dirHint")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-workbuddy-device-random-row",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsm-workbuddy-sdk-switch",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: fallback ?? true,
								disabled: savingFallback || fallback === void 0,
								onChange: (event) => {
									saveFallback(event.target.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sdk.fallbackLabel") })]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-hint",
						children: t("sdk.fallbackHint")
					})
				] }),
				error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-workbuddy-device-error",
					children: error
				})
			] });
		}
		//#endregion
		//#region src/client/OAuthSignIn.tsx
		/**
		* The card's OAuth QR sign-in section: one resting bar row plus a dialog
		* opened by the sign-in button.
		*
		* 参考：workbuddy2api-panel 的「添加账号」弹窗交互形态 —— 静态入口一行，
		*   点开后弹窗内分步走：获取授权链接 → 自动打开浏览器 → 弹窗内显示链接
		*   与等待状态 → 完成/失败回填结果。本实现沿用该步骤划分；弹窗样式直接
		*   用本项目导出/导入弹框的类（dsm-workbuddy-transfer-dialog），不引入
		*   第二套视觉。
		* 改动：自动打开浏览器。弹窗拦截的规避方式是「用户手势内同步 window.open
		*   占位，拿到授权 URL 后再导航」——点击「获取授权链接」的那一刻浏览器
		*   仍认定这是用户激活的手势链，占位窗口不会被拦；若 Host 环境连占位都
		*   拦（返回 null），降级为弹窗内手动「打开登录页」链接，功能不损失。
		*
		* 轮询循环压成一个组件内 effect：按 `OAUTH_POLL_INTERVAL_MS` 节奏问 Host
		*   「完成了吗」，完成即停。所有状态就地管理，零跨组件往返；Host 重启
		*   导致 loginId 失效会得到 done+error，与超时同一条文案路径。
		*
		* @module dsh-connect-workbuddy/client/OAuthSignIn
		*/
		/** Seconds since the login started, for the waiting line. */
		function elapsedSeconds(sinceMs, nowMs) {
			return Math.max(0, Math.floor((nowMs - sinceMs) / 1e3));
		}
		/**
		* How long the `syncing` phase may hold the veil before it lets go (issue #51).
		*
		* Shorter than a poll interval would be pointless; a few seconds is far longer
		* than a healthy loopback re-read takes, and anything past that is
		* indistinguishable from "never".
		*
		* What sits below this decision is an asymmetry worth spelling out. The
		* `waiting` phase has its own local deadline (see the waiting-clock effect), so
		* a login whose `loginId` died still ends. The `syncing` phase reached the veil
		* and awaited the card's re-read with NEITHER a deadline NOR a `catch` — and the
		* veil's visibility is `phase.kind === 'syncing'` and nothing else. So a re-read
		* that never settled held the veil up forever, while the credential was already
		* in the vault: reopening the card (or force-quitting DSH) showed the account,
		* which is exactly the "half usable" report — sign-in succeeded, the screen
		* never said so.
		*/
		const SYNC_SETTLE_TIMEOUT_MS = 5e3;
		/**
		* Await `work` but give up after `timeoutMs`; resolves `false` on timeout.
		*
		* The timer is cleared in a `finally`, so the common case (the re-read settles
		* first) leaves no pending timer holding the event loop — the reason this is a
		* race with an explicit cleanup rather than `Promise.race` alone.
		*
		* The timeout arm never rejects: a re-read that FAILS is not a failed sign-in,
		* and the caller must not be able to confuse the two. Rejection and timeout
		* stand for the same thing here — "the list did not prove it refreshed" — so
		* they take the same path.
		*
		* EXPORTED because `AccountTransfer`'s veil awaits the same card re-read and had
		* the same unbounded wait; sharing one implementation is what stops the two
		* veils from drifting apart again.
		*/
		async function settlesWithin(work, timeoutMs) {
			let timer;
			try {
				return await Promise.race([Promise.resolve(work).then(() => true, () => false), new Promise((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				})]);
			} finally {
				if (timer !== void 0) clearTimeout(timer);
			}
		}
		/**
		* Copy the sign-in URL to the clipboard; true on success.
		*/
		async function copyUrl(url) {
			try {
				await navigator.clipboard.writeText(url);
				return true;
			} catch {
				return false;
			}
		}
		/**
		* The section. Rendered on BOTH sign-in states: a signed-out machine gains
		* its first account here; a signed-in one can add another without leaving
		* the card.
		*/
		function OAuthSignIn({ t, region, onAdded }) {
			const [phase, setPhase] = (0, react.useState)({ kind: "idle" });
			const [dialogOpen, setDialogOpen] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const [pollTick, setPollTick] = (0, react.useState)(0);
			const [nowMs, setNowMs] = (0, react.useState)(() => Date.now());
			/**
			* The account the Host just added, held for the sync effect.
			*
			* The poll that answers `done` names the account; the effect that ends the
			* `syncing` phase needs that name to write the success line, and it cannot
			* read it off the phase because the phase is what it is about to replace.
			* State rather than a ref: the effect is keyed on it, so a second sign-in
			* (adding a second account) re-arms the deadline properly instead of reusing
			* a stale closure value.
			*/
			const [addedAccountName, setAddedAccountName] = (0, react.useState)("");
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const waiting = phase.kind === "waiting";
			(0, react.useEffect)(() => {
				if (!waiting || phase.kind !== "waiting") return;
				const expiresAtMs = phase.expiresAtMs;
				const timer = setInterval(() => {
					if (!mounted.current) return;
					const now = Date.now();
					setNowMs(now);
					if (now > expiresAtMs) setPhase({
						kind: "finished",
						message: "error",
						error: t("row.oauthTimedOut")
					});
				}, 1e3);
				return () => {
					clearInterval(timer);
				};
			}, [
				waiting,
				phase,
				t
			]);
			(0, react.useEffect)(() => {
				if (phase.kind !== "waiting") return;
				const { loginId } = phase;
				let cancelled = false;
				const timer = setTimeout(() => {
					(async () => {
						try {
							const response = await fetch(withWorkBuddyRouteAction(WORKBUDDY_OAUTH_PATH, region, "poll"), {
								method: "POST",
								headers: {
									"content-type": "application/json",
									accept: "application/json"
								},
								credentials: "same-origin",
								body: JSON.stringify({ loginId })
							});
							const body = await response.json();
							if (cancelled || !mounted.current) return;
							if (!response.ok || !body || typeof body !== "object") {
								setPhase({
									kind: "finished",
									message: "error",
									error: `HTTP ${response.status}`
								});
								return;
							}
							if (!body.done) {
								setPollTick((tick) => tick + 1);
								return;
							}
							if (typeof body.error === "string" && body.error !== "") setPhase({
								kind: "finished",
								message: "error",
								error: body.error
							});
							else {
								const accountName = body.accountName ?? "";
								setPhase({
									kind: "syncing",
									accountName
								});
								setAddedAccountName(accountName);
							}
						} catch {
							setPollTick((tick) => tick + 1);
						}
					})();
				}, OAUTH_POLL_INTERVAL_MS);
				return () => {
					cancelled = true;
					clearTimeout(timer);
				};
			}, [
				onAdded,
				phase,
				pollTick,
				region
			]);
			/**
			* End the `syncing` phase — on the re-read, or on the deadline, whichever
			* comes first (issue #51).
			*
			* ## Why this is a separate effect and not an `await` in the poll
			*
			* The first attempt at this fix put the race inside the poll's `done` branch:
			*
			*     setPhase({ kind: 'syncing', accountName })
			*     await settlesWithin(onAdded?.(), SYNC_SETTLE_TIMEOUT_MS)
			*     if (cancelled || !mounted.current) return
			*     setPhase({ kind: 'finished', … })
			*
			* and it did not work — measured, not assumed. `phase` is a dependency of the
			* poll effect, so `setPhase({kind:'syncing'})` re-runs that effect, and React
			* runs the PREVIOUS cleanup first. That cleanup sets the old closure's
			* `cancelled = true`. React commits the cleanup before the `await` it is
			* inside ever resumes, so the resume always sees `cancelled === true` and
			* returns: the veil stayed up exactly as it had before.
			*
			* This also explains why the defect was invisible in review. A FAST re-read
			* resolves inside the same microtask batch, before React commits the cleanup,
			* so it passes the guard and the success line appears. Only a re-read slow
			* enough to cross a React commit — i.e. the reported case — loses the race
			* against its own cleanup. The bug hid behind its own common path.
			*
			* Running the wait in an effect keyed on the phase sidesteps the whole
			* interaction: this effect's own cleanup runs when the phase LEAVES
			* `syncing`, which is after it has already done its job, so there is no
			* self-cancellation to lose.
			*
			* ## The two outcomes
			*
			* Both end in `finished`/`added` and the difference is deliberately not shown
			* to the user. The account IS added — the Host stored the credential before it
			* answered the poll — so the honest report is success either way; the deadline
			* only stops the screen from claiming otherwise indefinitely. (`refreshUsage`
			* already surfaces a failed re-read as `refreshError` on the card itself, so
			* a genuinely broken usage route is still reported, by the component that
			* owns that data.)
			*/
			(0, react.useEffect)(() => {
				if (phase.kind !== "syncing") return;
				let cancelled = false;
				const finish = () => {
					if (cancelled || !mounted.current) return;
					setPhase({
						kind: "finished",
						message: "added",
						accountName: addedAccountName
					});
				};
				settlesWithin(Promise.resolve(onAdded?.()), SYNC_SETTLE_TIMEOUT_MS).then(finish);
				const timer = setTimeout(finish, SYNC_SETTLE_TIMEOUT_MS);
				return () => {
					cancelled = true;
					clearTimeout(timer);
				};
			}, [
				addedAccountName,
				onAdded,
				phase
			]);
			/**
			* Open a placeholder window WITHOUT `noopener`, and deliberately so.
			*
			* `noopener` is the correct feature for a link whose destination never needs
			* a handle — and that is exactly why it is wrong here. Per the spec, a
			* `window.open` call carrying `noopener` opens the tab but returns `null`
			* (MDN: "the new window will not have access to the originating window via
			* `Window.opener` and returns `null`"). The placeholder exists ONLY to be
			* navigated once the Host answers, so the handle IS the point: passing
			* `noopener` made `placeholder` null, the navigation was skipped, and every
			* sign-in left an empty `about:blank` tab behind instead of the sign-in page.
			*
			* The security property is kept, just established on the handle instead of
			* through the feature: `opener = null` is applied to the placeholder before
			* anything is loaded into it, so the destination still cannot reach back
			* through `window.opener`. `noreferrer` is dropped for the same reason —
			* the spec makes it imply `noopener`, so it would reintroduce the null.
			* Nothing is lost: the placeholder is same-origin and empty until navigated,
			* and the referrer would only ever have been the settings page.
			*/
			function openPlaceholder() {
				const placeholder = window.open("", "_blank");
				if (placeholder !== null) placeholder.opener = null;
				return placeholder;
			}
			/**
			* Fetch the authorization URL AND open the browser in one gesture chain.
			* The placeholder window is opened synchronously — inside the click's user
			* activation, before any await — so popup blocking cannot intervene; the
			* URL is navigated once the Host answers. A blocked placeholder (null)
			* degrades to the manual link inside the dialog, losing nothing but the
			* convenience.
			*/
			const start = async (placeholder) => {
				setPhase({ kind: "opening" });
				setCopied(false);
				try {
					const response = await fetch(withWorkBuddyRouteAction(WORKBUDDY_OAUTH_PATH, region, "start"), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!mounted.current) {
						placeholder?.close();
						return;
					}
					if (!response.ok || typeof body.loginId !== "string" || typeof body.verificationUri !== "string") {
						placeholder?.close();
						setPhase({
							kind: "finished",
							message: "error",
							error: body.error ?? `HTTP ${response.status}`
						});
						return;
					}
					if (placeholder !== null) placeholder.location.href = body.verificationUri;
					setPhase({
						kind: "waiting",
						loginId: body.loginId,
						verificationUri: body.verificationUri,
						startedAtMs: Date.now(),
						expiresAtMs: Date.now() + (typeof body.expiresIn === "number" && body.expiresIn > 0 ? body.expiresIn : 600) * 1e3
					});
					setNowMs(Date.now());
				} catch (error) {
					placeholder?.close();
					if (mounted.current) setPhase({
						kind: "finished",
						message: "error",
						error: error instanceof Error ? error.message : String(error)
					});
				}
			};
			/** Open the dialog and begin the login in the same click: the placeholder
			* window must be created synchronously to count as a user gesture. */
			const beginSignIn = () => {
				setDialogOpen(true);
				start(openPlaceholder());
			};
			/** Re-open the sign-in page from the waiting dialog (no new session).
			*
			* Here `noopener,noreferrer` IS right: this is a one-way navigation to a
			* third-party page and nothing needs a handle on it — the contrast with
			* {@link openPlaceholder} is the whole distinction. */
			const reopen = () => {
				if (phase.kind !== "waiting") return;
				window.open(phase.verificationUri, "_blank", "noopener,noreferrer");
			};
			/**
			* The three strings that NAME the sign-in method, per region.
			*
			* CN signs in by scanning a QR code with the WorkBuddy app; the international
			* build signs in on a web page. Every other line in this section (waiting,
			* cancel, done, copy) is about the flow, not the method, so it stays shared —
			* splitting it too would let the two regions drift apart for no gain.
			*/
			const titleKey = region === "cn" ? "row.oauthTitle" : "row.oauthTitleGlobal";
			const startKey = region === "cn" ? "row.oauthStart" : "row.oauthStartGlobal";
			const finishText = phase.kind === "finished" ? phase.message === "added" ? t("row.oauthDone", { accountName: phase.accountName === "" || phase.accountName === void 0 ? t("row.accountUnnamed") : phase.accountName }) : phase.message === "cancelled" ? t("row.oauthCancelled") : t("row.oauthError", { message: phase.error ?? "" }) : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsm-workbuddy-bar",
				"aria-label": t(titleKey),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BusyOverlay, {
						visible: phase.kind === "syncing",
						message: t("row.oauthSyncing"),
						hint: t("row.veilHintList")
					}),
					phase.kind === "finished" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `dsm-workbuddy-bar-status ${phase.message === "added" ? "dsm-workbuddy-bar-ok" : "dsm-workbuddy-bar-error"}`,
						children: finishText
					}) : phase.kind === "waiting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-bar-status",
						children: t("row.oauthOpened")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-workbuddy-bar-actions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: phase.kind === "opening",
							onClick: beginSignIn,
							children: phase.kind === "opening" ? t("row.oauthStarting") : t(startKey)
						})
					}),
					dialogOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-workbuddy-transfer-dialog",
						role: "dialog",
						"aria-label": t(titleKey),
						children: phase.kind === "opening" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.oauthStarting") }) : phase.kind === "waiting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.oauthOpenHint") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-oauth-url",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: phase.verificationUri,
									target: "_blank",
									rel: "noopener noreferrer",
									children: phase.verificationUri
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dsm-workbuddy-hint",
								children: [
									t("row.oauthWaiting", { seconds: elapsedSeconds(phase.startedAtMs, nowMs) }),
									" ",
									t("row.oauthExpires", { minutes: Math.max(1, Math.round((phase.expiresAtMs - nowMs) / 6e4)) })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-transfer-dialog-actions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										onClick: () => {
											copyUrl(phase.verificationUri).then((ok) => {
												if (mounted.current) setCopied(ok);
											});
										},
										children: copied ? t("row.oauthCopied") : t("row.oauthCopy")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										onClick: reopen,
										children: t("row.oauthReopen")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										onClick: () => {
											setPhase({
												kind: "finished",
												message: "cancelled"
											});
										},
										children: t("row.oauthCancel")
									})
								]
							})
						] }) : phase.kind === "finished" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: `${phase.message === "added" ? "dsm-workbuddy-bar-ok" : phase.message === "error" ? "dsm-workbuddy-bar-error" : ""}`,
							children: finishText
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-transfer-dialog-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								onClick: () => {
									setDialogOpen(false);
								},
								children: t("row.oauthDialogClose")
							})
						})] }) : null
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/AccountTransfer.tsx
		/**
		* The card's account-transfer section: batch export / import of the region's
		* stored credentials, in the file format shared with sibling credential
		* managers for the same upstream.
		*
		* 参考：扫码登录小节（OAuthSignIn）的组件形态 —— 单个 section、就地管理
		*   全部状态（busy / 结果行 / 错误）、零跨组件往返。导出弹框的交互（多选
		*   账号 → 下载 JSON）与导入弹框（选文件 → 脱敏预览 → 勾选 → 导入）沿用
		*   通行实现的步骤划分；预览只含展示字段与 hasToken 布尔量，token 明文
		*   永不进入浏览器。
		*
		* 导出用 <a download> Blob：卡片运行在设置页 iframe 里，无宿主保存对话框
		*   可用；a[download] 同源下载是沙箱内最可靠的方式。
		*
		* @module dsh-connect-workbuddy/client/AccountTransfer
		*/
		/**
		* How long the veil may wait on the card's re-read before it comes down.
		*
		* Same ceiling and same reasoning as the sign-in path's
		* `SYNC_SETTLE_TIMEOUT_MS` (issue #51): the veil is the only feedback this
		* operation gives, so its exit condition must not be a promise that can stay
		* pending. The `refreshing` phase has no other way out — no deadline, no
		* failure branch — so an unsettled re-read left the operator staring at
		* 「正在导入…」 over an import that had already succeeded.
		*/
		const REFRESH_SETTLE_TIMEOUT_MS = 5e3;
		/** Build the default export file name: workbuddy-accounts-YYYY-MM-DD.json. */
		function exportFileName() {
			const pad = (value) => String(value).padStart(2, "0");
			const d = /* @__PURE__ */ new Date();
			return `workbuddy-accounts-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
		}
		/** Download a JSON array as a local file (no host save dialog inside the iframe). */
		function downloadJson(fileName, data) {
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
		}
		/** The section. Rendered on both sign-in states — a signed-out machine can
		* still import a file exported elsewhere; export without accounts answers
		* the error line. */
		function AccountTransfer({ t, region, accounts, onChanged }) {
			const [phase, setPhase] = (0, react.useState)({ kind: "idle" });
			const [dialog, setDialog] = (0, react.useState)(void 0);
			const [selected, setSelected] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [preview, setPreview] = (0, react.useState)(void 0);
			const [importSelected, setImportSelected] = (0, react.useState)(/* @__PURE__ */ new Set());
			const fileInput = (0, react.useRef)(null);
			/**
			* The text of the file the user just picked.
			*
			* Held here rather than re-read from the input at import time: the picker
			* is a bare system dialog that closes immediately (see the import button),
			* so between preview and confirm there is no dialog on screen holding the
			* File. Re-reading `fileInput.current.files` would also break the moment
			* anything clears the input — and it must be cleared after every pick, or
			* choosing the SAME file twice fires no change event.
			*/
			const importText = (0, react.useRef)("");
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const closeDialog = () => {
				setDialog(void 0);
				setSelected(/* @__PURE__ */ new Set());
				setPreview(void 0);
				setImportSelected(/* @__PURE__ */ new Set());
			};
			const runExport = async () => {
				if (selected.size === 0) return;
				setPhase({ kind: "exporting" });
				try {
					const response = await fetch(withWorkBuddyRouteAction(WORKBUDDY_TRANSFER_PATH, region, "export"), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ accountIds: [...selected] })
					});
					const body = await response.json();
					if (!mounted.current) return;
					if (!response.ok || !Array.isArray(body.accounts)) {
						setPhase({
							kind: "error",
							message: body.error ?? `HTTP ${response.status}`
						});
						return;
					}
					downloadJson(exportFileName(), body.accounts);
					closeDialog();
					setPhase({
						kind: "done",
						message: t("row.transferExported", {
							count: body.accounts.length,
							fileName: exportFileName()
						})
					});
				} catch (error) {
					if (mounted.current) setPhase({
						kind: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				}
			};
			/**
			* Turn a transport-level failure into something a person can act on.
			*
			* `fetch()` rejects with a bare `TypeError: Failed to fetch` whenever no HTTP
			* response arrives at all — the connection was reset, or the text could not be
			* posted. Rendered verbatim that reads like a bug in the plugin (issue #229:
			* the user saw "传输失败：Failed to fetch" and had nothing to go on). The two
			* causes worth naming are a file too large to upload and a local service that
			* is not answering; anything else keeps its own message, which is more
			* informative than a generic one.
			*
			* Note this is the CLIENT's guess: the server now answers 413 for an oversized
			* body, so a size problem usually arrives as a normal error response and never
			* reaches here. This path is what is left when the request dies before an
			* answer — which is also what a half-open local port looks like.
			*/
			const transportMessage = (error, text) => {
				if (!(error instanceof TypeError)) return error instanceof Error ? error.message : String(error);
				const kilobytes = Math.round(new Blob([text]).size / 1024);
				return t("row.transferNoService", { size: String(kilobytes) });
			};
			const readImportFile = async (file) => {
				setPhase({ kind: "importing" });
				try {
					const text = await file.text();
					importText.current = text;
					const response = await fetch(withWorkBuddyRouteAction(WORKBUDDY_TRANSFER_PATH, region, "preview"), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ text })
					});
					const body = await response.json();
					if (!mounted.current) return;
					if (!response.ok || !Array.isArray(body.accounts)) {
						setPhase({
							kind: "error",
							message: body.error ?? `HTTP ${response.status}`
						});
						return;
					}
					setPreview(body);
					setImportSelected(new Set(body.accounts.filter((entry) => entry.hasToken).map((entry) => entry.index)));
					setPhase({ kind: "idle" });
				} catch (error) {
					if (mounted.current) setPhase({
						kind: "error",
						message: transportMessage(error, importText.current)
					});
				}
			};
			const runImport = async () => {
				if (preview === void 0 || importSelected.size === 0 || importText.current === "") return;
				setPhase({ kind: "importing" });
				try {
					const text = importText.current;
					const response = await fetch(withWorkBuddyRouteAction(WORKBUDDY_TRANSFER_PATH, region, "import"), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({
							text,
							indexes: [...importSelected]
						})
					});
					const body = await response.json();
					if (!mounted.current) return;
					if (!response.ok || typeof body.imported !== "number") {
						setPhase({
							kind: "error",
							message: body.error ?? `HTTP ${response.status}`
						});
						return;
					}
					closeDialog();
					const message = t("row.transferImported", {
						imported: body.imported,
						skipped: body.skipped ?? 0
					});
					setPhase({
						kind: "refreshing",
						message
					});
					await settlesWithin(Promise.resolve(onChanged?.()), REFRESH_SETTLE_TIMEOUT_MS);
					if (!mounted.current) return;
					setPhase({
						kind: "done",
						message
					});
				} catch (error) {
					if (mounted.current) setPhase({
						kind: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				}
			};
			const busy = phase.kind === "exporting" || phase.kind === "importing" || phase.kind === "refreshing";
			/** The veil's scenario line: what is happening, in the user's terms. */
			const veilMessage = phase.kind === "exporting" ? t("row.transferExporting") : phase.kind === "importing" || phase.kind === "refreshing" ? t("row.transferImporting") : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsm-workbuddy-bar",
				"aria-label": t("row.transferTitle"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BusyOverlay, {
						visible: busy,
						message: veilMessage,
						...busy ? { hint: t("row.veilHintList") } : {}
					}),
					phase.kind === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-bar-status dsm-workbuddy-bar-ok",
						children: phase.message
					}) : phase.kind === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-bar-status dsm-workbuddy-bar-error",
						children: t("row.transferError", { message: phase.message })
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-bar-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: busy || accounts.length === 0,
							onClick: () => {
								setSelected(/* @__PURE__ */ new Set());
								setDialog("export");
							},
							children: t("row.transferExport")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: busy,
							onClick: () => {
								fileInput.current?.click();
							},
							children: t("row.transferImport")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: fileInput,
						type: "file",
						accept: "application/json,.json",
						className: "dsm-workbuddy-transfer-file",
						onChange: (event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file !== void 0) {
								setPreview(void 0);
								setImportSelected(/* @__PURE__ */ new Set());
								setDialog("import");
								readImportFile(file);
							}
						}
					}),
					dialog === "export" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-transfer-dialog",
						role: "dialog",
						"aria-label": t("row.transferExport"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.transferExportPick", { total: accounts.length }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-hint",
								children: t("row.transferHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsm-workbuddy-transfer-list",
								children: accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: selected.has(account.id),
										onChange: (event) => {
											const next = new Set(selected);
											if (event.target.checked) next.add(account.id);
											else next.delete(account.id);
											setSelected(next);
										}
									}),
									" ",
									account.accountName === "" ? t("row.accountUnnamed") : account.accountName
								] }) }, account.id))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-transfer-dialog-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									onClick: closeDialog,
									children: t("row.transferCancel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									disabled: selected.size === 0 || phase.kind === "exporting",
									onClick: () => {
										runExport();
									},
									children: phase.kind === "exporting" ? t("row.transferExporting") : t("row.transferExportConfirm", { count: selected.size })
								})]
							})
						]
					}) : null,
					dialog === "import" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-workbuddy-transfer-dialog",
						role: "dialog",
						"aria-label": t("row.transferImport"),
						children: preview === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.transferPreviewing") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.transferPreviewTotal", { total: preview.total }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsm-workbuddy-transfer-list",
								children: preview.accounts.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										disabled: !entry.hasToken,
										checked: importSelected.has(entry.index),
										onChange: (event) => {
											const next = new Set(importSelected);
											if (event.target.checked) next.add(entry.index);
											else next.delete(entry.index);
											setImportSelected(next);
										}
									}),
									" ",
									entry.nickname !== "" ? entry.nickname : entry.email !== "" ? entry.email : entry.uid !== "" ? entry.uid : t("row.transferEntryUnknown"),
									entry.hasToken ? "" : ` — ${t("row.transferNoToken")}`
								] }) }, entry.index))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-transfer-dialog-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									onClick: closeDialog,
									children: t("row.transferCancel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									disabled: importSelected.size === 0 || phase.kind === "importing",
									onClick: () => {
										runImport();
									},
									children: phase.kind === "importing" ? t("row.transferImporting") : t("row.transferImportConfirm", { count: importSelected.size })
								})]
							})
						] })
					}) : null
				]
			});
		}
		//#endregion
		//#region src/catalog.ts
		/**
		* The tier one model currently RESOLVES TO, given the saved budgets.
		*
		* This is the rule the card's radio group has to agree with, so it lives next
		* to {@link applyContextBudgets} rather than being re-derived in the browser —
		* ONE definition, so the UI cannot drift from the backend again (issue #215).
		*
		* `undefined` means "no explicit budget" and answers the NATIVE window, which
		* is exactly what {@link applyContextBudgets} does with an absent entry. The
		* card used to default the 200K radio with `?? 200_000` instead, so a model
		* with no stored budget showed "200K" selected while DSH was told 1,000,000 —
		* the reporter's case. The radio was right there in the UI and wrong in the
		* only place that matters.
		*
		* A budget ABOVE the native window answers the native window, because
		* {@link applyContextBudgets} clamps with `Math.min`: a stored 1048576 for a 1M
		* model genuinely resolves to the native tier, and that radio is the one that
		* should be lit.
		*/
		function effectiveContextBudget(nativeContextWindow, savedBudget) {
			return savedBudget === void 0 ? nativeContextWindow : Math.min(nativeContextWindow, savedBudget);
		}
		//#endregion
		//#region src/default-effort.ts
		/** The tiers DSH/pi-ai speak. Mirrors `THINKING_LEVELS` in `./adapter.ts`. */
		const THINKING_LEVELS = [
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max"
		];
		/**
		* The tiers a model actually declares, in DSH's order, without `off`.
		*
		* `off` is excluded deliberately: it is a DIFFERENT question with its own owner
		* (`offModelIds` / `src/off-thinking.ts`, issue #34), and a "default thinking
		* effort" of `off` would silently re-open the #83 defect for every caller that
		* names no tier.
		*/
		function declaredEfforts(reasoning) {
			const supported = reasoning?.supportedEfforts ?? [];
			return THINKING_LEVELS.filter((level) => supported.includes(level));
		}
		/**
		* The one tier a model should dispatch at when a caller names none.
		*
		* @param model - the catalog entry, carrying the upstream's own declaration.
		* @param saved - the user's per-model choice, keyed by model id; an absent (or
		*   unsupported, or stale) entry falls through to the upstream default, then to
		*   this model's own MIDDLE tier (never its weakest one).
		* @returns a tier the model declares, or `undefined` when it declares none — in
		*   which case the adapter's existing `off` normalization (issue #90) is still
		*   the right answer and this module must not invent one.
		*/
		function defaultEffortFor(model, saved = {}) {
			const declared = declaredEfforts(model.reasoning);
			if (declared.length === 0) return void 0;
			const asked = saved[model.id];
			if (typeof asked === "string" && declared.includes(asked)) return asked;
			const upstreamDefault = model.reasoning?.defaultEffort;
			if (typeof upstreamDefault === "string" && declared.includes(upstreamDefault)) return upstreamDefault;
			return declared[Math.floor(declared.length / 2)];
		}
		/**
		* The tier list the card offers for one model.
		*
		* Exactly the model's own declared tiers — no localising, no cross-model
		* unification. The vocabularies genuinely differ (`low/high/max` on deepseek,
		* `high/xhigh` on glm-5.2), so a synthesized ladder would offer rows that fail,
		* and the upstream's names are what the user sees in every other client.
		*/
		function selectableEfforts(reasoning) {
			return declaredEfforts(reasoning);
		}
		//#endregion
		//#region src/client/busy-icon.tsx
		/** The word for a level, in the card's language, for the tooltip. */
		const TITLES_ZH = {
			idle: "空闲",
			normal: "正常",
			busy: "轻微拥堵",
			congested: "极度拥堵",
			unavailable: "不可用"
		};
		const TITLES_EN = {
			idle: "Idle",
			normal: "Normal",
			busy: "Slightly congested",
			congested: "Extremely congested",
			unavailable: "Unavailable"
		};
		/**
		* The CLOTHES colour per level, as a CSS custom property.
		*
		* These are the ramp: green → yellow → orange → red. The hair and the skin
		* keep their own colours in every level, so a row is recognisably the same
		* person in a different outfit — which is what makes the COUNT readable as
		* "more people, not different people".
		*/
		const COLORS = {
			idle: "var(--dsm-workbuddy-busy-idle, #3aa76d)",
			normal: "var(--dsm-workbuddy-busy-normal, #d9b300)",
			busy: "var(--dsm-workbuddy-busy-busy, #e08a1e)",
			congested: "var(--dsm-workbuddy-busy-congested, #d93a2b)",
			unavailable: "var(--dsm-workbuddy-busy-unavailable, #8a8f98)"
		};
		/** How many people each level draws. */
		const PEOPLE = {
			normal: 1,
			busy: 2,
			congested: 3
		};
		/**
		* The icon for a level, or `undefined` when the level is not drawn.
		*
		* Only `unknown` is left out: it is the plugin's own "the probe did not
		* answer", and a badge that guesses is worse than no badge. Every level the
		* upstream DID report is drawn — `idle` included, in green, because "the model
		* is free right now" is useful information.
		*/
		function busyIconOf(level) {
			if (level === void 0) return void 0;
			if (level === "unknown") return void 0;
			return level;
		}
		/**
		* One person, on the icon's own grid: 7.9 units wide, 19.3 units tall.
		*
		* The five parts are the emoji's own — hair, face, shirt, trousers, shoes —
		* because a stick figure would not read as the same mark as the `🧍` the
		* picker shows.
		*
		* NO FACE FEATURES. At the 12px the model row actually uses, an eye is 0.2px
		* wide: drawing it produces a smudge, not a face. So the face is a plain
		* skin-toned shape and the character is carried by the silhouette.
		*/
		function person(x, key, shirt, shirtEdge, trousers) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
				transform: `translate(${x} 0)`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.7 3.1c0-1.6 1-2.6 2.5-2.6s2.5 1 2.5 2.6c0 .8-.2 1.4-.6 1.9-.2-1-.7-1.5-1.3-1.7-.5.6-1.3.8-2 .7-.7-.1-1.2-.6-1.3-1.4-.5.1-.8.2-.8.2z",
						fill: "#f0c04a"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M3 3.4h3.4v2.1c0 1.15-.76 2-1.7 2s-1.7-.85-1.7-2z",
						fill: "#ffd9a0"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4.4 6.6h.6v.9h-.6z",
						fill: "#f3c493"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M1.75 8.9c-.45.45-.65 1.25-.65 2.15v2.9c0 .4.3.7.7.7s.7-.3.7-.7v-2.8c0-.6.1-1 .25-1.35zM7.55 8.9c.45.45.65 1.25.65 2.15v2.9c0 .4-.3.7-.7.7s-.7-.3-.7-.7v-2.8c0-.6-.1-1-.25-1.35z",
						fill: "#ffd9a0"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.8 7.7h3.7c.75 0 1.3.55 1.3 1.3v5.1H1.5V9c0-.75.55-1.3 1.3-1.3z",
						fill: shirt
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M3.9 7.7l.75 1 .75-1",
						stroke: shirtEdge,
						strokeWidth: ".45",
						fill: "none",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M1.9 14.1h2.05l-.3 4.3H1.6zM5.85 14.1h2.05l.3 4.3H5.5z",
						fill: trousers
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.15 18.4h1.4v.9H1.7c-.3 0-.45-.3-.3-.6zM5.85 18.4h1.4l.55.55c.2.2 0 .35-.3.35H5.85z",
						fill: "#2f3136"
					})
				]
			}, key);
		}
		/**
		* A ROCKET, for the `idle` level: nobody is queuing, so the model is free to
		* run at full speed.
		*
		* A different SHAPE, not a different colour, and that is the point: the level
		* has to be readable at 12px without reading a word, and a rocket next to one,
		* two or three people separates "nobody is waiting" from "one person is
		* waiting" instantly. The people count the queue; the rocket says there is
		* none.
		*
		* SOLID, not outlined: a stroked rocket at this size turns into a smudge. The
		* body is filled in the level's colour, the window is white so it reads at
		* 12px, and the flame is a fixed orange (a flame is a flame).
		*/
		function rocket(color) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.1 15.6c.2 1.6.8 2.8 1.9 3.7 1.1-.9 1.7-2.1 1.9-3.7z",
					fill: "#f5a623"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.4 11.8 2 16.1h2.5zM11.6 11.8l2.4 4.3h-2.5z",
					fill: shadeOf(color)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 .9c2.7 2.9 4.2 6.6 4.2 10.4 0 1.7-.4 3.2-1 4.5H4.8c-.6-1.3-1-2.8-1-4.5 0-3.8 1.5-7.5 4.2-10.4z",
					fill: color
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "8",
					cy: "6.6",
					r: "2.1",
					fill: "#ffffff"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.4 3.6c-.7 1.2-1.2 2.6-1.4 4.1",
					stroke: "#ffffff",
					strokeOpacity: ".35",
					strokeWidth: ".7",
					fill: "none",
					strokeLinecap: "round"
				})
			] });
		}
		/** The shaded edge of the clothes, one step darker than the clothes. */
		function shadeOf(color) {
			return `color-mix(in srgb, ${color} 78%, #000)`;
		}
		/**
		* The load-level icon for one model row.
		*
		* Returns `null` for a level that is not drawn — including `undefined`, which
		* means "not measured", and `unknown`, which must never be turned into a
		* claim the upstream did not make.
		*/
		function busyIcon(level, language = "zh") {
			const icon = busyIconOf(level);
			if (icon === void 0) return null;
			const color = COLORS[icon];
			const title = (language.toLowerCase().startsWith("en") ? TITLES_EN : TITLES_ZH)[icon];
			if (icon === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsm-workbuddy-busy dsm-workbuddy-busy-unavailable",
				title,
				style: { "--dsm-workbuddy-busy-color": color },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					viewBox: "0 0 19.3 19.3",
					width: 12,
					height: 12,
					"aria-hidden": "true",
					focusable: "false",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("g", {
						opacity: ".5",
						children: person(0, "p", "#8a8f98", "#6f747c", "#6f747c")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M0.6 19.4 19.4 0.6",
						stroke: "currentColor",
						strokeWidth: "1.8",
						strokeLinecap: "round",
						fill: "none"
					})]
				})
			});
			if (icon === "idle") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsm-workbuddy-busy dsm-workbuddy-busy-idle",
				title,
				style: { "--dsm-workbuddy-busy-color": color },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					viewBox: "0 0 16 19.3",
					width: 12,
					height: 12,
					"aria-hidden": "true",
					focusable: "false",
					children: rocket(color)
				})
			});
			const count = PEOPLE[icon] ?? 1;
			const width = (count - 1) * 9.6 + 7.9;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `dsm-workbuddy-busy dsm-workbuddy-busy-${icon}`,
				title,
				style: { "--dsm-workbuddy-busy-color": color },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					viewBox: `0 0 ${width} 19.3`,
					width: 12,
					height: 12,
					"aria-hidden": "true",
					focusable: "false",
					children: Array.from({ length: count }, (_, index) => person(index * 9.6, `p${index}`, color, shadeOf(color), shadeOf(color)))
				})
			});
		}
		//#endregion
		//#region src/client/promo-badge.ts
		/**
		* The UI's language, as the browser reports it.
		*
		* The card already formats dates and numbers with the browser's locale
		* (`formatDate`), so reading the same signal for the upstream's copy is
		* consistent: the badge says what the upstream says, in the language the
		* user reads.
		*
		* `navigator` is read defensively — this module is imported by unit tests
		* that run in a plain Node environment, where it does not exist.
		*/
		function uiLanguage() {
			if (typeof navigator === "undefined") return "";
			return navigator.language ?? "";
		}
		/** Whether the given language is an English one. */
		function isEnglish(language) {
			return (language ?? "").toLowerCase().startsWith("en");
		}
		/**
		* The badge's own wording.
		*
		* The upstream's label is the region's own wording, so it is the default for
		* every UI. An English UI prefers the English label when the upstream
		* published one; the global feed publishes none, and there its label is
		* already English.
		*/
		function promoBadgeLabel(promo, language) {
			const badge = promo.badge;
			if (isEnglish(language)) return badge.labelEn ?? badge.label;
			return badge.label;
		}
		/**
		* The badge's wording where the chip has to fit a narrow row.
		*
		* The model picker's rows are one line wide and already carry the model name,
		* the credit rate and the load icon, so a four-character label ("夜间折扣") can
		* push the check mark out of the row. The upstream publishes a compact wording
		* for exactly this case (`shortLabel`), and when it does not, the full label is
		* still better than a cropped one: an ellipsis in a menu row reads as a
		* truncated word, while the full label is at worst tight.
		*/
		function promoBadgeShortLabel(promo, language) {
			const badge = promo.badge;
			return (isEnglish(language) ? badge.shortLabelEn ?? badge.shortLabel : badge.shortLabel) ?? promoBadgeLabel(promo, language);
		}
		/**
		* The chip's colour, when the upstream published a usable one.
		*
		* Only a hex colour is accepted: the value reaches an inline style, and the
		* upstream's feed publishes hex (`#009273`, `#FF0000`). Anything else is
		* refused rather than passed through, and the card falls back to its own
		* brand colour.
		*/
		/**
		* A calendar day, in the user's own locale — read in the ZONE the upstream
		* wrote the instant in.
		*
		* The zone is part of the statement, exactly as it is for the daily hours. The
		* upstream publishes `validFrom: "2026-07-06T00:00:00+08:00"` and describes the
		* same campaign as "7月6日–10月31日". Formatting that instant in the reader's
		* own zone shows 7月5日 to anyone west of UTC, contradicting the upstream's own
		* copy in the same tooltip. Keeping the upstream's zone makes the tooltip
		* self-consistent wherever it is read.
		*
		* `medium` rather than the card's numeric `MM/DD` form: this is a promotion's
		* lifetime, and "Jul 6, 2026" reads as a date while "07/06" reads as a number
		* the user has to decode.
		*/
		function formatDay(ms, language, timeZone) {
			try {
				return new Intl.DateTimeFormat(language === void 0 || language === "" ? void 0 : language, {
					year: "numeric",
					month: "short",
					day: "numeric",
					...timeZone === void 0 ? {} : { timeZone }
				}).format(new Date(ms));
			} catch {
				return new Date(ms).toISOString().slice(0, 10);
			}
		}
		/**
		* The promotion's lifetime, as the upstream's own two ends.
		*
		* `validUntil` is EXCLUSIVE — see `promoWithinAbsoluteWindow`: the promotion is
		* over AT that instant. The upstream writes it as the midnight that opens the
		* day after the campaign, and says "– Oct 31" in its own copy for a
		* `validUntil` of `2026-11-01T00:00:00+08:00`. Printing the raw instant would
		* put "Nov 1, 2026" in the same tooltip and read as if the campaign ran a day
		* longer than it does. One millisecond before the boundary is the last instant
		* that still belongs to it, so that is what gets rendered.
		*/
		function promoRangeText(promo, language) {
			const schedule = promo.schedule;
			if (schedule === void 0) return void 0;
			const zone = schedule.timezone;
			const from = schedule.validFrom === void 0 ? void 0 : formatDay(schedule.validFrom, language, zone);
			const to = schedule.validUntil === void 0 ? void 0 : formatDay(schedule.validUntil - 1, language, zone);
			if (from === void 0 && to === void 0) return void 0;
			if (from === void 0) return `– ${to ?? ""}`;
			if (to === void 0) return `${from} –`;
			return `${from} – ${to}`;
		}
		/**
		* The hours the discount runs, in the zone the upstream named.
		*
		* The zone is part of the statement: "23:00–7:50" means nothing to a reader
		* in another zone, and the upstream's windows are written in ITS zone
		* (Asia/Shanghai for the CN feed), not the user's.
		*/
		function promoHoursText(promo) {
			const schedule = promo.schedule;
			const daily = schedule?.daily;
			if (daily === void 0 || daily.length === 0) return void 0;
			const windows = daily.map((window) => `${window.start}–${window.end}`).join(", ");
			const zone = schedule?.timezone;
			return zone === void 0 ? windows : `${windows} (${zone})`;
		}
		/**
		* The chip's tooltip: the upstream's own copy, its lifetime, and the hours
		* the discount runs.
		*
		* Empty pieces are left out rather than rendered as blanks, so a promotion
		* that publishes nothing but a label gets a chip with a label and no hover
		* text at all.
		*/
		function promoBadgeTooltip(promo, language) {
			const parts = [];
			const hover = promo.hover;
			if (hover !== void 0) {
				const copy = isEnglish(language) ? hover.textEn ?? hover.textZh : hover.textZh ?? hover.textEn;
				if (copy !== void 0) parts.push(copy);
			}
			const range = promoRangeText(promo, language);
			if (range !== void 0) parts.push(range);
			const hours = promoHoursText(promo);
			if (hours !== void 0) parts.push(hours);
			return parts.join(" · ");
		}
		//#endregion
		//#region src/client/icon.ts
		/**
		* Plugin icon (LD brand logo, 64px) shared across the LaoDing plugin family.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 同一 data URI，其注释说明来自
		*     dingminhua/dsh-subagent-default-model（MIT），用于让插件家族的
		*     外观保持一致。本项目沿用同一图标以达到同样目的。
		* 改动：无。
		*
		* @module dsh-connect-workbuddy/client/icon
		*/
		const WORKBUDDY_PLUGIN_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAXGUlEQVR4nH1bC7BdVXn+1tr7nHPvzb3JvUloSAQp0JHWoAMttKOCFrWU8irQSbCTQYG21IahnTJUUTsM0FJhZCzCSIcKImOpDkhrhQ5YC7ROB3lUBU3EyCuBFBIIedzcx3ntvTr/a621TwIns3PO3mfvddf/+v7v/9c6DvYKoYBz1cZNYfJpVBcNBm7dcIhj3TBM15VzqAE6XAWEGggVADroOl0byDW+PtRr9E732rl9r2PxOMNsrCogVE7PA0Kge4Lcz5/TGI6v00UaK+h98u4QUA9quIDg4Pe2i2LTsknc++mzZu9cv37VHNaFAveSJICj/9aFUNzrXHXSTwdnznl/Y+X9MaEP1D0A/ToKaUdDASoAK0YVYcLad/G88S6C1aQcOkI2Nj9HylBFBRMYqPUeFp6EDXQfKcIUoud6LQQP59rwrsBEOdhy9KGDK/7j9mUPmBKcCf++Z4YbF6eKLw+6QFioKl/DoYILlXMsHE2KPCCzwlsqoNb3oUw4Kq+2a0k4G4MtXOX3J4HNyulzUkC0eqYI8ZAaQZQSAh9080Qx1m7jHStnL/3B3ctvXbcuFOwBH/p5OG12DA/29leV6wcHeI8hadE1rBldl/6ACs7WMEuz0PIcKawe0Gdzeyf36eTzcOHxVAEpTEQB0QtY0PRZPMYsX+t3tSqBxkteYeHh6qqu6yIsmVhaHHtE7/fu/8fJhzzF/OywunXQR+DJOO9pkLp2NJ64pIXhaOxb/IfmJM29PemSJ+NSzJP1s2dhwmucJ6uaoIYFzVjnkFDhLRTkb2XC03gQTKDrZNjSV1icXwzPv9y99Z5Hw6R/psQnqoniyLBQ1d65IoGiDqZuHwWwzyFzx8xl5RDBZR4uCZc9E8fS+8TdSfHZ2KxAel6VwEIYZiflxC9NKToeKcKrAcjV2d2DK3xYqOcXJ478ytf2fcL3htWGegAaSZGeBnKixWgVPXRiZpEomLq4Kcri2RCc7zN3NWuq5XlOJLwqjq9liqlHlEfzSveIdVk0Fjh5kVjdjKLneniCtcEg7N492FBWAWvrHpwLzgmYUfySi+VorcJFBE6I7jIAjFnC3DybePKE5ClxLLsPI0q3kNAsYJ4g1wjkzDuju4nQJrx6RxRe/7YHfFX3MOyHtaUHloaKcqa4rcQTDWxubHnZ0lESNoaGXad7+RmLc7GMxbS4s8Y82S3mdhMshR+Po4pk181jkx22afHc8hL3plNTjOGDjEfu7pxfWkpcyA02Ofo6xpylPsMCi3eNTROShVawM0H4+4bXaGqzcTKQzc8j6VGPkb9tFtU56bwlBdK9ZMQMKNgolMtVKepFcq6hBMAzQJAQ6srG9iwNJRfN0LtWd64z1qZjRPDieBYQkyNTqFpCsoYoKQFoFt8xhA5icZ2fXWOwY4GScsT95Tv7XoSnd0ehgLJBSPSdkdhYWbSeAk2eCSzuScDs/qQo9dpRZarVWWm5ZRuxn8YRRabYtiwhn5PVRXD9js8FzM2rowKII7MnOJSR2GSZJMVUckfzjIjKMe2p5fOsENGfPESR38AwB8AsZTUBUV025TwWVEAsubSl6gYA8rU6eUMmvE2ErjMrQEDZQGkewGI6TcqPAhlT1hHBBV0xZC/R3B09JFmdXDESrIz5GRPMlWQA6kNAoVbjf7FAyq1vsW8xrt+rImI4aEiwIuqAMjI9y/8Z5RSAS+f04P4uTcihozDLaO6kZup2gSWFIXjm3plb75sHxkugMKzAgWmQcYmsTvqrgPkuMOgHFAhY0gnolDJfOgTM0t/xMcYTJeZz9QZRgHiUd5AQIHe2fNqIY3o4xiEw3wc++A6HvzweWNbWtKmsrF853PFEwDd/LEqoVOiYQQLQ7QGXn+Zw3okOhc9i1tw8umpS7mBQ4PW9Ab/YVuHxTTV+8EyF7TsqTHQCxtsBlVWSUVBViGYHcnMDQvaUyAv03wmPDcP8ECiy2lwOKl4CFz2+AoYDx1b73rkOayaVfUXziRMu9oGTbg54cz9pNlV9FEJzi8CJv+zwwOWWoZvZfXSst3rteDPgXx4e4LZv9fDS9grLlzotkclDakmXJCCFTswAdC5eZQqphwErZgr40QInAh4XHMbsHGt6ugSmWuLZwyqwlclFhwqOrSJgZky+izydc7bj+1ZPy7P9AT2nz/MR+PuK/g6/50fg8QdDGffQFQ4b13fwyFcmccl5HczOUgVYoXTcAGEBSWBzdRY4hoLUBvGeQGFgrM84gMWglq/mwszXqcSlAahgdi57l8/Mr9gaxiqbnZwheZMU23Lw88zN0zWff5ZzCpeyAApqTNWkjBorljnceMUEbvnMEqK0qIc1A6UAnYQS5/6Md4jTNxlhGUkKRYYBHmHCiEewJxQjzmmenFdphiXsZ0aKstogvmwkEiqwYml6MmS6kQkQKcUlICsIY6hyDAEbzupgZgr448/OouyI5Y3t8YgGfq5OIaHfeiZDWXclFizWw1OmF0lRQ4A8UWevnPTEsTNFjoQ7fV0UDq3SoSyBVgmU/FmOVsuz9VmfrCUBMPIMut4f1Dj9tzv4wqcmORzIvW1qwgOcYIC5vB0gzAClQW1EGuJXkgql2MlyuTHFhg4OAlrm8vRxtHrMFUhRV4trv/hawK3fqbF/QSwoYwSUPuCwlcDJ7y3wgeMKFHAYDgN7gOmwLBwGgxobzhnH/z7Txz9/exErpz2HK1teUZ+tTSGXZYZCFGAc3eqBZsESmZs1L0e92HK5TikSKA2N2CMY8QATfuvOgLOvqrBlW0CnyOioeWVF1/v4rXd7/M2fjeGEtQWGFO+FpkzFFPKOv/7zKXz/sR5m99foUJ2rRRNhhwCfAqBOxQkbVObHKSv14UZb2KnFdBAl5CdxvMwDcnotrTsW/vW9wPnXVdi2M+DwQ4DVK4CZSWDFVDp+aRkwNR7wxE8GOOuyWdz3vT7K0jMGyN8ToKTzFTMel2yYwPxcAJe56voR/eO7tOscY0Ls2GSFkJW+Nue8QTn6agJD6gta5mhwf7mHhCdesOGGCpu3AmMthzv+qsTHf6fArj0SP5YGKXNQZpleArRcjU9ePYdHnxgwPrAStK1EXkBhvO7scRx+aIleL2SWTzFP1qdQYkCs6dx66COob/28mB61GjzACwhmc9Q2rxnt/9GfUGwY1g4XfbHG488GjLWAmzYWOOU4zwAoKG6KteYG8YSAdunQKQM+dcMc9uwLbHnRv9Baumf5dIGPnNTB4jx5gQjNgisNLuH0Gr07ygKpjpdKsFnWGiuMXtLwfaPDpoRk/dFqjcYht6Q7P3lzhQefqvn87y4usOEjkgpjYlHhyT2psjMLErOcHANe3DbAXfd1xfUZVzRH6qMf/VA7E15JkfECdX9TiB+11ughDcisQGr4+wEfDqzrtegRxAau+aca3/gvEejK8z0uOcNhsUfWtAJGviOhrWKLXRwujgImx4Fvf3cR3V7gLGBRyDnfBbxnbQurVlImqJlEmdtLSpS/I9dACpD0l+I+sTjLCNbLe3sekHlEJry5/tJxh/98usZtDwo1vfTsAp/+mMeA0hrnPssalgl0PtoEEUYn18fbDltfHmLzlgEcs0MtiZ0oY+UKjyPWlBj0lRVGy3s+J2VQreKZIGUWq7MFDMEBaW01yMyoC7iRwmikG0zaZo5BcTwE9s0FXPS7Hp+/2DO356rQquKsvy9NDWV2yuXlM4Eb0O8FbN4ieTnCheIAKWLNao9qKPm/gJdD6bfhQkHlMLE9QmouF7Mlq1geM/hpO2xU/oNciT2K2B0Wik1/cHYu4Jz3O9y80bNXCOAJfnCzRAeguUhxbF0e7eLwMyIUKeW1HRkoWS9QXzPTnmWQvoOkQMED5Q8UDnDUE0ytLVv6jtbTyae6IP8T2qczNhKbAymLWP4nwXp94IhVDv9wWcGWoBRHHD/Fr8NPn6/Q8lpFpqCKwEgCGLsjF+4umOs3nZJeS8Y8ilrSHV0kazPqq6J5BRQylsgR4z2rALXhmWWkt8CAZvES49/aYDTZXsDxRzksnaDcTqAnz5DLtkqPux8c4LuPDTjfE9rnq0ziFUpotJfH4WFdjthUSbOjMdjFSXCtWg0EyyC9DU+fWcNq6UaDMq7tExJn6fFt3J+vKmPkZog9p4wqhoc6Dwvf8vjOfw9w+RcXucNj7e+0kpPa4wZmHDg1sHK5FAVCBXRgndb8XB2boj4TmBkgW9+AsLIOr/X6m/TX1uxjiyz3AOvjNQODMcVqb1GKrtrQ83qRQoCEf+SpITbeQJsSrLcnbhOR2zVZnBU0pXc46ghRAI+phMzGf3NnjRYBLOEPK8DzOxMheqcqFF5DIF+dyRZIYkhEgpJiNmn7wGIokhlLXWzNlEeHKvyTm4f4o+sWsdgNWHuUx2RHlG2KYDfniSaGyIUMMb4Zz/k+F5pGpyKp263x6v9VaBOztNyv40RmqGsG3o30+SMQZvXBAQsdb/UaJVTRdaVHZ2sPY22HzS9WuPDaLnbuqnHWySUe+vIU/uCjbcxRIUPpylKfeQMjuLTHF+drHH9sC2tWlxxGRKJiFADY/nKFXTsqjLUpE2jsx3Qq6C8A6CQEuP2V1wCNNfpmamvG/wg6amzLOmESPh+D0P7FVwMuuHoRW7dXOP19JW79zDjaLWBqQsLGipXo9jpZa2tTuG742EQmtKZSpcU/+VEf3fmANhVDbHnJGpEa8zUnxVK+o8N4fFx/H2F/MSXl3VvrBzhqUUmIJHdNedyAcfvrARdc08WzL9U4+bgSt181jjEFP1tljiVsrOHFAzothz27a5xx6jhOfn8HVUVU12YkvUR6/c/DPXQKEi4VPkyIuDrMiqNA3pbz/tGV29j3N68QetLweWuKKEOjdjMpsMX8Sb6nt2VLgCd/VuHMK4Z44ZUK7z26wJ1Xj2N6ynGKHOvYjhR6XumrKpFkbBfAnjcrrD2mhc9dORXpb5wJhULh8dzPB9j0wwEmlxDZMM9JyC9VoGQmz7wgU0Bc089dfqRCPKApqqsutCRGrarTf8PhjT0Bu2cDdu8L2LOvxu69AbP7A3a8UeEXWyu86zCPr187jjWHNFtclvqoFUZkiRRKf6/fDdj1eoXf/PUObrtlBstnpIVH1aB5IydBB3zr6wvodym/Sy9AKG8qi1NPgOixk7XBfJ0ub2o2lJBVdY2YsK6MFiWfO9/jnSuBHz1HHuGFSmuKC5XH6uUOHz+jhdUrndQChSiBXtTEoLRHQFj1a47bibbDrxxR4twzx7Bh/QTKlvCHKLzyf+oSbX66j0f/vYtlU1K/MAFSdyceEIVXAxdxeVy5fwPtRxHd9vw0GqBqIn4zWhpw4akeF5769gmDeADFr1mOXq/urHkN8Nyzx3DGKR20yoBDVhQ4+siSFUVWr014fZCUTue9bsCXrtsfOQIxWxNamiAKiOwZojxPHmBr75a/Y2hpP988pMEHYsfT1u0TEaFTyvMCS9m9htTWpIwlMMWuw8JizV3do99Z4PNXTnHLK9UXQemz4/rBhmW84naYw99fuw/PbR5g5XTBniwIT9bWuHcS+8YraAAfGyIZBlgGyHd45fv4UsTZW+rGmB7KghoVQkqK/J1XeEiIlLRJWRQ+DzzSx8+2DHHqB9osfK9Xs9DkKZRdpAucApDcXsb2uOX6WTz0r4tYQcIPc0HT59QBSpmgsBCILa98BSfb0jKa7jMAOEhTJOmGU2C85BCoINEvyT9IwHbL49WdFW68bZ6Xu9afPcZ3m+KUPFiASQiQkkuP/ftr3PS3s3j4/i73Aql+sc4vC6+rQIL2Qs+NY6QQqG0zZEZYLC2mYowfokVN1n6dGg/NV8YPzF1iBORlFK36BLS956XuP/3sPjy7ZYDL/2QJjv3VEr2+FDK8yKrZIa0byvS//0gPt39pDttfqHiVF4NEm2PDU0tgvpZ7AdMXMUZpW1Kb+4GaqY8+twpgx96A+x4PuPjDsmB54GukX3DQl1yfXwDuf7SHm766gJdfGeIPf38c11wxxd91aO/BQV673qjw1BMDPPhvi3j6yT7GSoeZZbKIa2UyNb3yJqitBebub6tPnosj22010rsf3exEgDNRAld9o8aPX3B412rdB2xgl1Hf0CiEMseoA3r9gG3bK/xw0wAvbB1iqkMkyeOw1QW+9s0FDAeCFeIwAYNewK5dNV7ZWmHb80O8uaNmUrR0Uqo6WgITmptITlRAg1LnZMiIEODec8MwkDV4707+A4isCHJD2cNr3GDfHLi/Z3v4448Xsj38EiepEOLqTru8RaDdHeDtLrZldn6/LnHbhLlNpwQmAB3vMNFxGOPtNZrmaqvzpbYXzm/ARyWvl4YIdYbU/Rn4CFMqYGq5ly0yVqUdUMnZ6q4Bl94zM2E9xGztTxc045aavK1Of1wxxQWiqDULYJuj6G/QEje7byAl6IT1YAF0H7HsKpUmjVV4eakcra6rwlIP6DJYtkbA6Ri8P0CB1jYv5u2lvBoULsfnnJpG9vCyIEqWZHeJrjJn48adGrzzSyZgGxek2ySeZqFjz3FjNd/vo0JKw8QEVgVqt0iKH1sDlBTKy+r6TLBx6nwFuPGefpMTc79Z3RRkPXw+H21njVSPcQ9fanXbWLymb/1/29RgkKmNTRuLBVXrxx0m+lkENmVY7S/zEWtrb9BWiRxlgZGCJ+a9PLHlfEDBTP2hsTFRdpVJNWdPx21qWVPDWtP5ik+j4Zn176wFzoWN9fcyoDNhI+dXppkA0XoCTQLEPCAIdhxk5Tur+nWPsChKYzxH97h/37aqm+z2Sw7ZvGRa5x5c3IuUlBBbVBYWBlymuEx4Gyuv74X4pDTXYILWD8ja4zRKYVR49Fcdxg3invt8yUsVJCRPHshrBWNZ+R49UYLt5tYfRcR6Xy0c3Ta5dJ6/Zd/vCNjlxCcueCa2l1pgGQDGzpIVSEPMyq6w5q+wzOoNUIzu0uz0SFhkHlHTiq4InO4zr9ENSjHO841N2e5ui3PrBTZQPFlagC0Jb54Vd4pZqNiOttgPoI4AZn1ZYLPzLoQatS2CNmod3T3W7Asc+Puc5D1JKRbpRJnFYgZAI9iQub7EvY9gxc9yW1vW+HgME3KkwSkNDs0EVnXqWqARIG3X1y3XDq0xbPbTS4q7vVcCN7qwGWM73/HV3P0t7iwImoOhlMZpe0rc8q7tblaE9vxzJaTCJa3nC/iZp6QFTgNGi/0mC9TvOTukUNLUG8Y6hZte7e/2l52Iu8ar6qXalR6hrhq5P0+LI7/DaYBgrHnMve1HEhYu6RkWgq2bvKDJ3cVGOfhZLOdYkaq8xPIYX2zVV72uyPBEN01XnTDuy2WLL33w+rG7/PpT3NyvrQ4bx9tww8qT1ejHNHFPQEJ6Ke0E1LJd2FmhR90g04xpP+tfKCjmYKaWIU/ImhcpTpXi2q7UfLeH9fXVqSVsTNiMD+Rh4uraDT2mlpXu8BNaG1etcnN+3T2huPcvWg8dubS6dHJJUfD6bFVXrq5rrw3+tCaXOuGmBENzAzHpu0tvL63uNj8bykdeoCkt8QHL+SqAkRxz60wJcQ9BFh6p7CX8CYEQLtShKocTfmbpRLHs3d1LT7u+9dA99tNZ+yHxBTcNztz0mr9x74I/hnZXhD7F/PCAn6bJz+U0vrPr7K5VJUJZf5/v040NDcG02LGGJVmfOsuxdifg03U9vUZHrPz0fl7p5caGjNkiEmTFUXBooUDbjWGs5TE+Pdyy6vjqijO+MPYACb+efjwdiYsqIewMk+d8tbro1b1uXXehPrYahmn+hZmGgtefqsalNFvU1BpAhM8QXhUlCmgCmihAUnBUQixk6J2eSYqwvM9Iz5sfrApM7LDF7W651oILbef3Tky0Nk2vcfeed0dxp3Nu7h6EYr2sgOL/Aa5OuMdnE5sWAAAAAElFTkSuQmCC";
		//#endregion
		//#region src/client/plugin-icon.tsx
		const storageKey = "dsh-connect-workbuddy.icon-style";
		const changeEvent = storageKey + ".changed";
		/**
		* OUR OWN ICON IS THE DEFAULT.
		*
		* The visitor who opens the card never asked for a different glyph: the LD mark is
		* what the sidebar, the page header and the panel drew before this preference
		* existed, and it is the shape this plugin is recognised by. An alternate skin is
		* a CHOICE, so it has to be chosen — shipping the alternate as the default would
		* repaint an identity the user never asked to change, which is the same mistake as
		* a plugin rewriting another plugin's label.
		*
		* `'original'` is therefore also the fallback for a browser that stores nothing
		* (`getItem` throws behind a blocked-storage policy) and the value the server
		* snapshot reports, so the first paint and the hydrated paint agree.
		*/
		const DEFAULT_ICON_STYLE = "original";
		/** The other one, derived so the default is stated exactly ONCE. */
		const ALTERNATE_ICON_STYLE = "claude";
		/**
		* Appearance is local to this browser; account and provider settings are untouched.
		*
		* Everything is derived from {@link DEFAULT_ICON_STYLE} rather than repeating the
		* literal, and that is not tidiness: an earlier draft compared against the stored
		* 'claude' and returned 'claude' when storage was empty, so flipping the exported
		* default changed nothing at all — the constant looked like the decision while the
		* two literals beside it were. The test that pins the default could not catch it,
		* which is how the duplicate survived.
		*/
		function iconStyleSnapshot() {
			try {
				return window.localStorage.getItem(storageKey) === ALTERNATE_ICON_STYLE ? ALTERNATE_ICON_STYLE : DEFAULT_ICON_STYLE;
			} catch {
				return DEFAULT_ICON_STYLE;
			}
		}
		function subscribe(listener) {
			const onStorage = (event) => {
				if (event.key === storageKey || event.key === null) listener();
			};
			window.addEventListener(changeEvent, listener);
			window.addEventListener("storage", onStorage);
			return () => {
				window.removeEventListener(changeEvent, listener);
				window.removeEventListener("storage", onStorage);
			};
		}
		function setIconStyle(value) {
			window.localStorage.setItem(storageKey, value);
			window.dispatchEvent(new Event(changeEvent));
		}
		function PluginIcon(props) {
			const saved = (0, react.useSyncExternalStore)(subscribe, iconStyleSnapshot, () => DEFAULT_ICON_STYLE);
			const variant = props.variant ?? saved;
			const shared = {
				className: props.className,
				width: props.size ?? 16,
				height: props.size ?? 16,
				style: {
					...props.style,
					flexShrink: 0
				},
				"aria-hidden": true
			};
			if (variant === "original") return (0, react.createElement)("img", {
				...shared,
				src: WORKBUDDY_PLUGIN_ICON,
				alt: ""
			});
			return (0, react.createElement)("svg", {
				...shared,
				viewBox: "0 0 24 24",
				fill: "currentColor",
				"data-icon-style": "claude",
				"data-plugin-icon": "workbuddy"
			}, (0, react.createElement)("path", { d: "M4.5 5.5h3v11h3l3-3v4l-2 2h-7z" }), (0, react.createElement)("path", { d: "M10.5 5.5H15a7 7 0 0 1 0 14h-2v-3h2a4 4 0 0 0 0-8h-1.5v2l-3 3z" }));
		}
		/** Each choice previews the real icon and immediately persists its selection. */
		function IconStylePreference({ t }) {
			const selected = (0, react.useSyncExternalStore)(subscribe, iconStyleSnapshot, () => DEFAULT_ICON_STYLE);
			const [error, setError] = (0, react.useState)(false);
			return (0, react.createElement)("div", { className: "dsm-icon-preference" }, (0, react.createElement)("div", { className: "dsm-icon-preference-copy" }, (0, react.createElement)("b", null, t("row.iconStyleLabel")), (0, react.createElement)("span", null, t("row.iconStyleHint"))), (0, react.createElement)("div", {
				className: "dsm-icon-choices",
				role: "radiogroup",
				"aria-label": t("row.iconStyleLabel")
			}, ...["original", "claude"].map((variant) => (0, react.createElement)("button", {
				key: variant,
				type: "button",
				role: "radio",
				"aria-checked": selected === variant,
				tabIndex: selected === variant ? 0 : -1,
				onKeyDown: (event) => {
					if (![
						"ArrowLeft",
						"ArrowRight",
						"ArrowUp",
						"ArrowDown",
						"Home",
						"End"
					].includes(event.key)) return;
					event.preventDefault();
					const next = event.key === "Home" ? "original" : event.key === "End" ? "claude" : variant === "original" ? "claude" : "original";
					try {
						setIconStyle(next);
						setError(false);
						(event.currentTarget.parentElement?.querySelectorAll("[role=radio]")[next === "original" ? 0 : 1])?.focus();
					} catch {
						setError(true);
					}
				},
				onClick: () => {
					try {
						setIconStyle(variant);
						setError(false);
					} catch {
						setError(true);
					}
				}
			}, (0, react.createElement)(PluginIcon, {
				variant,
				size: 20
			}), t(variant === "claude" ? "row.iconStyleClaude" : "row.iconStyleOriginal")))), error ? (0, react.createElement)("p", {
				role: "alert",
				className: "dsm-icon-save-error"
			}, t("row.iconStyleSaveFailed")) : null);
		}
		//#endregion
		//#region src/client/series-layout.ts
		/** 同系列的公共布局规则。两个桥接插件同步维护此文件，功能专属样式留在 styles.ts。 */
		function seriesLayoutCss(plugin) {
			const p = `.dsm-${plugin}`;
			const u = `${p}-usage`;
			const members = plugin === "trae" ? `${p}-pool-card` : `${p}-pool-members`;
			const memberHead = plugin === "trae" ? `${p}-pool-card-head` : `${p}-pool-members-head`;
			const memberTitle = plugin === "trae" ? `${p}-pool-card-title` : `${p}-pool-members-title`;
			const memberActions = plugin === "trae" ? `${p}-pool-card-tools` : `${p}-pool-members-actions`;
			const saveBar = plugin === "trae" ? `${p}-pool-save-row` : `${p}-pool-save-bar`;
			return `
${p}-page{font-family:inherit;--dsm-series-sticky-top:-28px}
/* Doubled selector so this beats the host's own page rule — but NOT at the cost
 * of the settings surface, which shares the class and overrides its padding to 0
 * (see styles.ts: the Settings panel column is already padded and already
 * scrolls, so this page must not add padding of its own).
 *
 * The doubled class is (0,2,0) and a bare .dsm-workbuddy-settings is (0,1,0), so
 * the padding came back and ate 36px off EACH side of the settings column:
 * measured, the content column went 612px -> 540px, i.e. every card and the
 * account table were 72px narrower than they should be. The owner saw it before
 * any test could ("整体宽度变小了"). The :not() keeps the reach of the rule and
 * gives the settings surface its padding back. */
${p}-page${p}-page:not(${p}-settings){height:calc(100% - 16px);margin-bottom:16px;padding:28px clamp(24px,4vw,48px) 48px;gap:20px}
${u} ${p}-pool-auto-checkin-status{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#777)}
${p}-page-desc{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#999)}
${u} ${p}-pool-auto-checkin{display:flex;flex-direction:column;gap:6px;margin-top:8px}
/* 1120px, NOT the 860px the shared series layout shipped with.
 *
 * The page's own rule (styles.ts) has always been 1120px, and that is what the
 * cards, the account table and the settings block were laid out and measured
 * against. The series file narrowed the container to 860 as part of "unifying
 * spacing", which does not unify anything for this plugin: it simply made every
 * block on the page ~23% narrower, took the account table's columns with it, and
 * the owner saw it immediately ("整体宽度变小了，不行，要用原来的宽度").
 *
 * Kept as a SECOND declaration next to the page's own one ON PURPOSE: this file is
 * loaded after styles.ts (it is concatenated onto the same bundle), so it would
 * win the cascade. Stating the same 1120 here is what keeps the shared file from
 * silently re-narrowing the page the next time it is synced from trae. */
${p}-page>*{width:100%;max-width:1120px;min-width:0}
${u}{gap:16px;font-size:13px;line-height:1.5;min-width:0}
${u} .dsm-btn{box-sizing:border-box;font:inherit;font-size:13px;line-height:20px;padding:5px 14px;border-radius:8px;min-height:32px}
${u} .dsm-btn-outline{background:transparent;border-color:var(--dsw-alias-border-l2,#777);color:var(--dsw-alias-label-secondary,#999)}
${u} ${p}-tabs{display:flex;gap:8px}
${u} ${p}-tab-cell{flex:1;min-width:0;padding:8px 12px;border-radius:10px}
${u} ${p}-panels{position:sticky;top:var(--dsm-series-sticky-top,0px);z-index:2;display:flex;gap:2px;margin:0;padding:0;border-bottom:1px solid var(--dsw-alias-border-l1,#777);background:var(--dsw-alias-bg-layer-2,#24262c)}
/* 吸顶背景覆盖卡片两侧内边距，顶部偏移抵消滚动容器的顶部内边距。 */
${p}-page-body ${u} ${p}-panels{margin-inline:0;padding:0 0 8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,#777);border-radius:0;background:var(--dsw-alias-bg-layer-3,#202126)}
${p}-page[data-tabs-stuck="true"] ${p}-panels{margin-inline:-20px;padding-inline:20px;border-top:1px solid var(--dsw-alias-border-l2,#777);box-shadow:0 3px 6px rgba(0,0,0,.06)}
${u} ${p}-panel-tab{font-size:13px;font-weight:600;line-height:20px;padding:7px 11px}
${u} ${p}-panel{margin-top:0;min-width:0}
${u} ${p}-models-summary,${u} ${p}-panel-note{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
${u} ${p}-free-quota-warn{font-weight:600}
/* 说明段落的间距由容器统一控制，避免与卡片的纵向 gap 叠加。 */
${u} ${p}-region-summary{display:flex;flex-direction:column;gap:2px}
${u} ${p}-region-summary ${p}-models-summary{margin:0}
/* 说明与页签之间保留 8px，抵消外层 16px 间隔中多出的部分。 */
${u} ${p}-region-summary+${p}-panels{margin-top:-8px}
/* 页签底边已经分隔账号区，不在账号池顶部重复画线。 */
${u} #dsm-${plugin}-panel-accounts ${p}-pool{border-top:0;padding-top:0}

${u} ${p}-pool{display:flex;flex-direction:column;gap:12px;margin:0;padding:14px 0 0;border-top:1px solid var(--dsw-alias-border-l2,#777)}
${u} ${p}-pool-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
${u} ${p}-pool-title{margin:0;font-size:13px;font-weight:600;line-height:18px}
${u} ${plugin === "trae" ? `${p}-pool-current` : `${p}-pool-current-badge`}{margin-left:auto;max-width:100%;overflow-wrap:anywhere;white-space:normal;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#777);font-size:11px;font-weight:500;line-height:16px;background:var(--dsw-alias-bg-layer-2,#24262c);color:var(--dsw-alias-label-secondary,#999)}
${u} ${p}-pool-settings${p}-pool-modebar{padding:12px 14px;gap:8px;border:1px solid var(--dsw-alias-border-l2,#777);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#cf795b) 5%,var(--dsw-alias-bg-layer-2,#24262c))}
${u} ${p}-pool-modebar-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:20px}
${u} ${p}-pool-modebar-label{font-size:13px;font-weight:600;line-height:20px}
${u} ${p}-pool-modebar-state{padding:1px 9px;font-size:12px;line-height:18px;border-radius:999px;color:var(--dsw-alias-label-secondary,#999);border:1px solid var(--dsw-alias-border-l2,#777);background:var(--dsw-alias-bg-layer-2,#24262c)}
${u} ${p}-pool-note,${u} ${p}-pool-modebar ${p}-pool-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
${u} ${members}{display:flex;flex-direction:column;gap:0;min-width:0;border:1px solid var(--dsw-alias-border-l2,#777);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#24262c);overflow:hidden}
${u} ${memberHead}{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:14px 14px 12px}
${u} ${memberTitle}{margin:0;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary,#eee)}
${u} ${memberHead} ${p}-pool-note{margin-top:4px}
${u} ${memberActions}{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
${u} ${memberActions} .dsm-btn{padding:5px 14px;font-size:13px;line-height:20px}
${u} ${p}-pool-count,${u} ${memberActions} ${p}-pool-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
${u} ${members} ${p}-pool-actions{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:0 14px 12px}
${u} ${p}-pool-actions-end{margin-left:auto}
${u} ${members} ${p}-pool-action-note{margin:0;padding:0 14px 12px;font-size:12px;line-height:18px}
${u} ${members} ${p}-pool-table{border:0;border-top:1px solid var(--dsw-alias-border-l1,#777);border-radius:0}
${u} ${p}-pool-row{padding:10px 14px;align-items:start;font-size:13px;line-height:18px}
${u} ${p}-pool-row-head{padding:8px 14px;font-size:11px;line-height:16px;align-items:center}
${u} ${p}-pool-row-current{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#cf795b) 5%,var(--dsw-alias-bg-layer-2,#24262c));box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#cf795b)}
${u} ${p}-pool-row-actions .dsm-btn{min-height:26px;padding:2px 10px;font-size:12px;line-height:20px}
${u} ${p}-pool-settings-wrap{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,#777);padding-top:14px}
${u} ${p}-pool-settings{border-radius:12px;gap:0}
${u} ${p}-pool-settings-wrap :is(h3,h4){margin:0;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary,#eee)}
${u} ${p}-pool-set-ctl select{box-sizing:border-box;width:240px;min-width:0;max-width:100%}
${u} ${p}-pool-set{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px}
${u} ${p}-pool-set-copy{flex:1;min-width:0;gap:3px}
${u} ${p}-pool-set-copy b{font-size:13px;font-weight:500;line-height:18px}
${u} ${p}-pool-set-copy span{font-size:12px;line-height:18px}
/* ONCE THE SETTINGS ROW STACKS, THE CONTROL TAKES THE WHOLE LINE.
 *
 * Two rules above do the stacking (this file's .pool-set is the flex row, the
 * plugin's own @container turns it into a column), and both of the things that
 * finish that move were being overridden here:
 *
 *   - width:240px on the select — (0,2,1) beats the plugin's (0,1,0) width:100%,
 *     so the dropdown stayed a 240px stub in a 612px column, sitting alone under its
 *     label with ~180px of dead space on each side. The owner's screenshot:
 *     「这个应该 100%宽度啊」.
 *   - align-items:center on .pool-set — (0,2,0) beats the @container's
 *     align-items:stretch, so even a width:100% child would have been centred
 *     at its intrinsic width rather than filling.
 *
 * Restated here rather than narrowed above, because this is the same direction the
 * plugin already declares and the file that wins the cascade has to say it too.
 * Specificity matches the base rules above ((0,2,0)/(0,2,1)) and these come later,
 * so they win by order. */
@container (max-width:620px){
 ${u} ${p}-pool-set{flex-direction:column;align-items:stretch;gap:8px}
 ${u} ${p}-pool-set-ctl{flex:1 1 auto;justify-content:flex-start;max-width:100%;min-width:0}
 ${u} ${p}-pool-set-ctl select{width:100%;max-width:none;min-width:0}
}
${u} ${p}-models-title{font-size:13px;line-height:18px;font-weight:600}
${u} ${p}-model-list{border-radius:12px}
${u} ${p}-model{padding:12px 14px;gap:8px}
${u} ${p}-model-name{font-size:13px;line-height:20px}
${u} ${p}-model-actions,${u} ${p}-pool-save-row{gap:12px;padding-top:12px}
/* 保存栏以整个账号池为粘附范围，避免被更多设置的短父级截住。 */
${u} ${p}-pool-settings-wrap{display:contents}
${u} ${saveBar}{position:sticky;bottom:0;z-index:2;isolation:isolate;padding-bottom:12px;background:var(--dsw-alias-bg-layer-3,#202126)}
/* 滚动容器底部的内边距也属于可见区域，负偏移让背景覆盖到视口底边。 */
${p}-page ${saveBar}{bottom:-48px}
${p}-page ${saveBar}[data-save-stuck="true"]{margin-inline:-20px;padding-inline:20px;border-top:1px solid var(--dsw-alias-border-l2,#777);border-bottom:1px solid var(--dsw-alias-border-l2,#777);border-radius:0;box-shadow:0 -3px 6px rgba(0,0,0,.06)}

${u} #dsm-${plugin}-panel-capabilities:not([hidden]){display:flex;flex-direction:column;gap:14px}
${u} ${p}-prefs{gap:14px;padding:0}
${u} ${p}-pref{font-size:13px;line-height:18px;gap:10px}
${u} ${p}-pref-hint{font-size:12px;line-height:18px}
${u} ${p}-draw-image{margin:0;gap:10px;font-size:13px;line-height:18px}
${u} ${p}-draw-image>span{display:flex;flex-direction:column;gap:3px}
${u} ${p}-draw-image-hint{font-size:12px;line-height:18px}
${u} ${p}-pool-table{container-type:inline-size}
${u} ${p}-pool-current-tag{border:1px solid var(--dsw-alias-border-l2,#777);background:var(--dsw-alias-bg-layer-2,#24262c);color:var(--dsw-alias-label-secondary,#999)}
/* The ≤700px RE-GRID OF THE POOL ROW IS DELIBERATELY ABSENT.
 *
 * The shared series layout used to switch the row to display:flex + flex-wrap:wrap,
 * hide the header and give the actions their own full-width line here. That is the
 * stacked form workbuddy REMOVED: the row is three lines at every width (identity +
 * credits / verdict + timestamp + check-in + buttons / provenance), and its narrow
 * concession is one detail — dropping the absolute timestamp where it cannot sit
 * beside the verdict — not a second layout.
 *
 * Copied over, those four rules cost the row its whole shape: measured in headless
 * Chrome at the 564px Settings column, the row went from 80px to 118px, the header
 * disappeared, and the buttons fell onto a line of their own. The two-class selectors
 * below would have outranked the row's own single-class rule, so nothing warned.
 *
 * The series layout keeps everything that is genuinely shared — sticky tabs, the
 * save bar, the paddings and control metrics — and leaves each plugin row to
 * itself. trae still ships its own stacked form in its own stylesheet. */
/* 自动签到、设备参数和 SDK 是功能差异；沿用公共间距，不移除控件。 */
${u} ${p}-device-mode{margin:0;padding:0 14px 12px}
${u} ${p}-pool .sw{width:36px;height:20px}
${u} ${p}-pool .sw-track::after{top:2px;left:2px;width:16px;height:16px;background:var(--dsw-alias-bg-layer-3,#fff)}
${u} ${p}-pool .sw input:checked+.sw-track::after{transform:translateX(16px)}
@media(max-width:600px){
 ${p}-page${p}-page{padding:20px 16px 32px;--dsm-series-sticky-top:-20px}
 ${p}-page ${saveBar}{bottom:-32px}
 ${u} ${memberHead}{align-items:flex-start}
 ${u} ${memberActions}{flex-wrap:wrap}
 ${u} ${p}-pool-set{flex-wrap:wrap}
 ${u} ${p}-pool-set-ctl{max-width:100%;flex-wrap:wrap}
 ${u} ${p}-pool-set-ctl select{min-width:0;max-width:100%}
}
`;
		}
		/** 根据页签与保存栏的实际吸附位置显示边界。 */
		function updateStickyTabs(page) {
			const tabs = page.querySelector("[role=\"tablist\"][class$=\"-panels\"]");
			const stuck = tabs !== null && page.scrollTop > 0 && tabs.getBoundingClientRect().top <= page.getBoundingClientRect().top + 1;
			page.dataset.tabsStuck = String(stuck);
			const viewportBottom = page.getBoundingClientRect().bottom;
			for (const bar of Array.from(page.querySelectorAll("[class$=\"-pool-save-row\"],[class$=\"-pool-save-bar\"]"))) {
				const visible = bar.getClientRects().length > 0;
				const bottom = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
				bar.dataset.saveStuck = String(visible && Math.abs(bar.getBoundingClientRect().bottom + bottom - viewportBottom) <= 1);
			}
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Client styles for the WorkBuddy plugin card.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 整套 dsm-* 卡片样式系统（卡片外壳、按钮原语、--dsw-alias-*
		*     主题变量与十六进制回退值）逐字沿用自该项目，其又复制自
		*     dingminhua/dsh-subagent-default-model（MIT）的 SETTINGS_CSS。
		*     沿用目的是让两个插件共享同一套外部表现语言。
		* 改动：类名由 dsm-trae-* 改为 dsm-workbuddy-*；
		*   移除 trae 特有的 1M 变体样式，新增按套餐聚合的积分行样式；
		*   双 provider 化后新增国内版/国际版 tab 栏样式。
		*
		* @module dsh-connect-workbuddy/client/styles
		*/
		const WORKBUDDY_CARD_CSS = `
.dsm-icon-preference{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-icon-preference-copy{display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px;font-size:13px}
.dsm-icon-preference-copy>span{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-icon-choices{display:flex;flex-wrap:wrap;gap:6px}
.dsm-icon-choices>button{appearance:none;display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:12px;line-height:20px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#777);border-radius:8px;padding:7px 10px;cursor:pointer}
.dsm-icon-choices>button[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary,#cf795b);background:var(--dsw-alias-bg-layer-2,#25262b)}
.dsm-icon-choices>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#cf795b);outline-offset:2px}
.dsm-icon-save-error{flex-basis:100%;margin:0;color:var(--dsw-alias-state-error-primary,#c33);font-size:12px}


.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}
.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}
.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}
/* Pure-CSS caret: the host primitives' chevron icon names differ per DSH line
   (0.1.5 Outline14 vs 0.1.7 OutlineRegular), so no static import can serve
   both. A border caret in the plugin's own CSS is version-proof. */
.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;width:16px;height:16px;position:relative;transition:transform .16s}
.dsm-plugin-card-chevron::before{content:"";display:block;position:absolute;left:4px;top:5px;width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)}
.dsm-plugin-card-chevron-open{transform:rotate(180deg)}
.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}
.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-btn:disabled{opacity:.4;cursor:default}
.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsm-btn-primary:hover:not(:disabled){opacity:.9}
.dsm-workbuddy-usage{--dsm-workbuddy-surface:var(--dsw-alias-bg-layer-1,#17181b);display:flex;flex-direction:column;gap:16px;margin:0;padding:16px 0 4px;background:var(--dsw-alias-bg-layer-1,#17181b);border-radius:12px}
/* The provider bar: one CARD per region, side by side.
 *
 * COPIED FROM dsh-connect-trae, rule for rule, because an approximation of it
 * read as a different component. An earlier revision marked the selected card
 * with 1px border PLUS an inset 1.5px hairline in the contrast colour, and
 * that is 2.5 CSS px of near-black on a 2x display — five device pixels of
 * frame against the reference's one. What the reference does instead:
 *
 *   - selected = the accent COLOUR on the same 1px border, plus a slightly
 *     darker fill. The LIGHTNESS carries the state, not the thickness.
 *   - the switch is separated from the label by a hairline RULE inside the
 *     card (border-left in border-l1), not by dead space. That rule is what
 *     makes the switch read as a second control in the same box rather than
 *     as a floating square at the card's right edge.
 *   - the cell owns its padding (8px 12px) and the tab button has none, so
 *     the label's text sits at a predictable inset no matter how the button's
 *     focus ring draws.
 *   - 10px corner radius, matching the reference's card shape.
 *
 * The row stays what it was semantically: role="tablist" with one button per
 * region, and the checkbox inside each card is a SEPARATE control (switch this
 * provider on/off) — never merged into the tab action. Both regions can be on
 * at once, so this must not become a radio group just because the cards look
 * like one.
 *
 * The checkbox is the PLATFORM'S OWN, styled only with accent-color — the
 * same three declarations the reference card has, no more. An earlier revision
 * drew it here (appearance:none, 15px square, 3px radius, a tick made of two
 * rotated borders) on the theory that pinning the geometry would match the
 * reference across platforms. It did not: the reference does not draw it, so
 * the drawn box was a second, invented control sitting in the same row as the
 * real one. Measured against the screenshot, its box is 26 device px on a 2x
 * display — 13 CSS px, which is the engine's own default size, not a number
 * anyone wrote down.
 *
 * accent-color hands size, radius and tick glyph to the platform. That is the
 * point: the box then follows the reader's OS and theme, which is what makes
 * it read as a checkbox rather than as a painted square. */
.dsm-workbuddy-tabs{display:flex;gap:8px;align-items:stretch}
.dsm-workbuddy-tab-cell{display:flex;align-items:center;gap:4px;flex:1;min-width:0;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33);transition:border-color .15s,background .15s}
.dsm-workbuddy-tab-cell:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-tab-cell:has(.dsm-workbuddy-tab-active){border-color:var(--dsw-alias-brand-primary,#5686fe);background:var(--dsw-alias-bg-layer-2,#232529)}
.dsm-workbuddy-tab{appearance:none;font:inherit;cursor:pointer;flex:1;min-width:0;border:0;border-radius:7px;padding:0;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:600;line-height:20px;text-align:left;background:transparent;transition:color .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-tab:hover:not(:disabled):not(.dsm-workbuddy-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:baseline}
/* The hairline rule between the label and the switch. The auto left margin is
   what pushes the switch to the card's right edge; without it the rule would
   sit tight against the text. */
.dsm-workbuddy-tab-switch{display:inline-flex;align-items:center;flex:none;margin-left:auto;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));cursor:pointer}
.dsm-workbuddy-tab-switch input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-tab-switch input:disabled{cursor:default}
/* SECTION TABS: the card's own top-level split (accounts / models / diagnostics).
 *
 * Deliberately NOT the boxed cells above. Those are the REGION scope — a
 * two-way either/or, each side carrying its own on/off switch — while these are
 * panels of ONE document, the shape a reader already knows from the app's own
 * settings window. Two rows of boxes would read as one four-way choice.
 *
 * The hidden attribute on each panel is what does the work: an inactive panel
 * stays MOUNTED, so switching back does not refetch, a half-filled catalog draft
 * survives the trip, and the account pool keeps its log. It also takes the
 * inactive panel out of the accessibility tree, which is exactly what
 * role="tabpanel" wants — unlike display:none reached by a CSS class, it
 * cannot be overridden by a later rule. */
/* No top margin: this row is a flex child of .dsm-workbuddy-usage, whose
 * column gap already separates it from the paragraph above. The margin stacked
 * ON TOP of that gap and doubled the distance (measured: 32px where the rhythm
 * is 16px).
 *
 * The bottom rule stays: it is the tabs' underline, not spacing.
 *
 * STICKY, so the strip cannot be scrolled away from the sections it switches
 * (learned from dsh-connect-trae 4.9.0, same migration). This is NOT a decision
 * to take over scrolling: the Settings panel's own .options column scrolls, and
 * the card must not add a second scroller inside it — so there is no height:100%
 * and no overflow here either. But "not scrolling" is not the same as "may
 * disappear": the pool sits below the fold, and by the time the reader scrolls
 * down to it the five tabs are off the top, so switching sections means
 * scrolling the whole page back up first.
 *
 * The background is not decoration: it is what stops the rows sliding under a
 * transparent strip and showing through the gaps between the labels — and under
 * a wallpaper (issue #209) a transparent one would be unreadable outright.
 *
 * It paints --dsm-workbuddy-surface, NOT a hard-coded layer. That variable is
 * declared beside the fill on every surface's own .dsm-workbuddy-usage rule
 * (card / page / settings), which is the element whose opaque area the strip sits
 * inside. The three do not agree — the page paints layer-3 while the other two
 * paint layer-1 — so a strip pinned to either constant becomes a visibly lighter
 * bar over the other. One variable, declared where the fill is declared, is what
 * keeps the two from drifting; a test requires every declarer to declare it.
 *
 * top:-1px rather than 0, because the strip's own border-bottom is drawn
 * OUTSIDE the box and 0 leaves a 1px slit for the scrolling rows to show
 * through. */
.dsm-workbuddy-panels{position:sticky;top:-1px;z-index:2;display:flex;align-items:stretch;gap:2px;margin:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));background:var(--dsm-workbuddy-surface,var(--dsw-alias-bg-layer-1,#17181b))}
.dsm-workbuddy-panel-tab{appearance:none;font:inherit;cursor:pointer;border:0;background:transparent;padding:7px 11px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:600;line-height:20px;white-space:nowrap;transition:color .15s,border-color .15s}
.dsm-workbuddy-panel-tab:hover:not(.dsm-workbuddy-panel-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-panel-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-panel-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6);border-bottom-color:var(--dsw-alias-brand-primary,#5686fe)}
/* Same rule as the tab row above: the usage column's gap is the only spacing
 * between a tab row and the panel under it. This margin used to add 12px on top
 * of the 16px gap, and the panel's first block (the pool, with its own 16px top
 * padding) added a third layer. */
.dsm-workbuddy-panel{margin:0}
/* THE CAPABILITIES PANEL IS A COLUMN OF GROUPS, not a run of paragraphs.
 *
 * Measured before this rule existed: the panel was display:block with
 * gap:normal, so its six blocks had NO space between them at all and the
 * rhythm was being improvised by whatever padding each block happened to carry
 * — ink-to-ink the gaps read 12 / 50 / 2 / 17 / 0 px. The 50px hole sat between
 * the gateway card and the first switch (the card's own 10px bottom padding plus
 * .prefs' 2px top), and the 2px squeeze sat between two switch groups that are
 * different KINDS of setting. Neither number was chosen; both fell out of the
 * order the blocks happen to be written in.
 *
 * One gap now owns the rhythm, and every group drops the ad-hoc padding it used
 * to fake it. 18px is the same step the rest of this card uses between
 * distinctly different things, and it is large enough to separate two groups of
 * switches WITHOUT a divider — which is why the one divider that used to sit
 * above the first upstream switch was deleted rather than kept: once the panel
 * owns 18px, a border plus 10px of its own padding became a third spacing
 * statement in the same 20px of air (measured 69px ink-to-ink against 18px
 * everywhere else, the single visible hole in the panel). */
/* THE ID IS THE HOOK, not a second class name.
 *
 * Every panel in this card renders as plain dsm-workbuddy-panel; none of them
 * carries a per-panel class. A rule written as
 * .dsm-workbuddy-panel-capabilities{...} therefore matches NOTHING — it parses,
 * ships, and does nothing at all, which is the worst failure mode available
 * here because the panel keeps looking slightly wrong and the CSS looks right.
 * #dsm-workbuddy-panel-capabilities is the attribute that actually exists on
 * the element. */
#dsm-workbuddy-panel-capabilities{display:flex;flex-direction:column;gap:18px}
/* THE PANEL MUST STILL BE HIDEABLE (regression fix, 5.20.1).
 *
 * An ID selector outranks the UA sheet's [hidden]{display:none} on
 * specificity (1,0,0 vs 0,1,0), so adding display:flex above made the
 * capabilities panel IGNORE its own hidden attribute. Result: it painted
 * permanently and, being later in the DOM, covered the diagnostics and SDK
 * panels entirely — clicking those tabs appeared to do nothing.
 *
 * The measure is simple: a panel that is hidden must never be displayed,
 * whatever other rules set. Both declarations are needed and neither is
 * redundant — display:none wins the cascade, and !important is what stops
 * the same thing recurring the next time someone gives a panel a display value.
 *
 * Why the shot tool did not catch it: tools/capabilities-shot.tsx hides the
 * other panels with display:none!important so the section can be measured in
 * one screenful. That override masked this exact bug — the harness was fixing
 * the thing it was supposed to observe. The tool no longer forces display on
 * the panel, and tests/capabilities-layout.spec.tsx now pins that a hidden
 * panel stays hidden. */
#dsm-workbuddy-panel-capabilities[hidden]{display:none!important}
/* The note keeps the panel's gap like every other block: a special-cased
   tighter gap here would be one more number to decode, and the panel's own
   rhythm is what this rule exists to establish. */
#dsm-workbuddy-panel-capabilities > .dsm-workbuddy-panel-note{margin:0}
/* DIAGNOSTICS: a two-column fact table rather than prose. Each row is one thing
 * the card actually READ, so a bug report can quote a line instead of
 * paraphrasing the UI. No control lives here on purpose — a diagnostics panel
 * that can change settings is a settings panel with a worse name. */
.dsm-workbuddy-diag{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#232529)}
.dsm-workbuddy-diag-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:8px 12px}
.dsm-workbuddy-diag-row+.dsm-workbuddy-diag-row{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.dsm-workbuddy-diag-label{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-workbuddy-diag-value{min-width:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:18px;text-align:right;overflow-wrap:anywhere}
.dsm-workbuddy-diag-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsm-workbuddy-diag-bad{color:var(--dsw-alias-label-caution,#e8b34b)}
.dsm-workbuddy-diag-hint{margin:10px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* PREFERENCE LINES: a checkbox on a line that commits on the click, packed from
   the LEFT — the shape the reference card uses for this exact block.
 *
 * They belong to the TAB block above and carry no heading of their own, because
 * both switches describe THIS tab. Earlier revisions gave them a headed section,
 * which meant a second 「积分」 heading one line under the tab hint; the reference
 * card never had one either.
 *
 * The picker used to sit at the row's far edge, pushed there by
 * justify-content:space-between. That split one sentence into two objects with
 * half a card of empty space between them, and left the reader to guess which
 * label the control belonged to. Here nothing in a row stretches: the words ask
 * the question and the control answers right beside them.
 *
 * align-items:flex-start, not center: the hint wraps to two lines at narrow
 * widths, and centring would float the checkbox against the middle of it.
 *
 * No horizontal inset: the reference card pads this block by the same 2px its
 * tab hint carries, so box and caption share one left edge. THIS card's tab hint
 * (the dsm-workbuddy-models-summary class) has no side padding, so copying the
 * reference's 2px would leave the two edges 2px apart — a difference too small
 * to name and just big enough to look unaligned. */
.dsm-workbuddy-prefs{display:flex;flex-direction:column;gap:14px;padding:0}
/* THE GROUP'S LEAD LINE BELONGS TO THE ROW UNDER IT (5.20.0).
 *
 * Every group opens with one sentence saying what the switches beneath it
 * control. With the group's uniform 14px gap, that sentence sat as far from its
 * first row as two rows sit from each other — measured 14px on all four groups,
 * identical to the row-to-row distance — so it read as a paragraph of body text
 * that happened to precede the list rather than as the list's heading.
 *
 * Pulling it 6px closer makes the pair visible as a pair without introducing a
 * new step: the group's own rows stay 14px apart, the lead sits 8px from its
 * first row, and the 18px panel gap still separates one group from the next. */
.dsm-workbuddy-prefs > .dsm-workbuddy-pref-hint:first-child{margin-bottom:-6px}
.dsm-workbuddy-pref{display:flex;align-items:flex-start;gap:10px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:pointer}
/* The platform's own checkbox, themed only with accent-color. A hand-drawn box
   was tried on this card and reverted: brand-primary resolves to the host's
   CONTRAST colour, so a ticked box painted itself as a heavy black pill — the
   loudest object in a section made of plain 13px text. */
.dsm-workbuddy-pref input{flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
/* ── The CN gateway override (issue #220) ─────────────────────────────────────
 * One bordered block so it does not read as a fifth switch: every other control
 * in this section is a checkbox that commits on the click, this one is a text
 * field that needs an explicit Save. Giving it a card of its own is what says
 * "this answers a different question".
 *
 * The 25px LEFT padding is the same indent .dsm-workbuddy-pref-indent uses
 * (15px checkbox + 10px row gap): it puts the card's title on the same left edge
 * as every switch LABEL in the panel below it, measured 318px vs 330px before
 * this value existed. A bordered box whose text starts 12px left of the text
 * beside it reads as a misaligned column, not as a card.
 *
 * The row wraps, and the input takes the whole width when it does: a host name is
 * long (https://wb.tencentbuddy.com is 26 characters) and a half-width input in
 * the panel column would show about eight of them. */
.dsm-workbuddy-cnbase{display:flex;flex-direction:column;gap:8px;padding:10px 12px 10px 25px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#24262c)}
/* SAME TYPOGRAPHY AS A SWITCH ROW (13px/18px).
 *
 * Measured before this rule: the card's title rendered at 16px while every
 * switch label in the same panel rendered at 13px. The cause is structural
 * rather than a wrong number — a switch row gets its 13px from
 * .dsm-workbuddy-pref, and this row is NOT a .dsm-workbuddy-pref (it stacks
 * its label above a text field instead of sitting beside a 15px box), so it
 * inherited the page's 16px instead. One group rendering a size nobody chose is
 * exactly the kind of defect a screenshot shows and nobody can name. */
.dsm-workbuddy-cnbase-row{display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-cnbase-input{box-sizing:border-box;width:100%;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsm-workbuddy-cnbase-input:disabled{opacity:.5;cursor:default}
.dsm-workbuddy-cnbase-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-cnbase-error{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-cnbase-notice{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-cnbase-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsm-workbuddy-pref-check,.dsm-workbuddy-image-tool-check,.dsm-workbuddy-video-tool-check,.dsm-workbuddy-cli-bridge-check,.dsm-workbuddy-sidebar-panel-check,.dsm-workbuddy-drop-thinking-check,.dsm-workbuddy-upstream-check,.dsm-workbuddy-channel-continue-check,.dsm-workbuddy-new-models-check{inline-size:15px;block-size:15px;margin:3px 0 0}
/* The upstream-identity switches are their own group, so they get a divider
   above them instead of relying on spacing alone: they change the request the
   whole plugin sends, not a per-region display choice, and reading them as the
   tail of the preference list would misrepresent what flipping one costs. */
/* The divider above the first upstream switch is GONE as of 5.20.0.
 *
 * It was doing double duty: separating "what this tab shows" from "what the
 * plugin sends" AND propping up a panel that had no gap of its own. Once
 * #dsm-workbuddy-panel-capabilities owns the rhythm at 18px, the border plus its
 * 10px padding became a third spacing statement in the same 20px of air —
 * measured ink-to-ink 69px against 18px everywhere else, i.e. the one visible
 * hole in the panel. The semantic break it marked is still real, and it is now
 * expressed the way the rest of the panel expresses it: one group, one gap.
 * The 4px that remains is optical only, between the group's own rows. */
.dsm-workbuddy-upstream-pref{margin-top:0}
.dsm-workbuddy-pref input:disabled{cursor:default}
.dsm-workbuddy-pref:has(input:disabled){opacity:.6;cursor:default}
/* The NAME and what it does are TWO lines, not one wrapped blob: first what the
   switch does, then what it means. Running them together is what made this
   block read as a wall of text. */
.dsm-workbuddy-pref-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-workbuddy-pref-label{font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
/* The picker's own line: indented by the checkbox's width plus the row gap
   (15px + 10px), so its label starts on the same left edge as the checkbox
   labels above it rather than under their boxes. */
.dsm-workbuddy-pref-indent{padding-left:25px}
/* Name then control, packed left — 显示位置 [输入框工具栏] — so the row reads as
   one sentence instead of a text column facing a control column. */
.dsm-workbuddy-pref-lead{display:flex;align-items:center;justify-content:flex-start;gap:10px;min-width:0}
.dsm-workbuddy-pref-lead .dsm-workbuddy-pref-label{flex:none}
.dsm-workbuddy-pref-hint{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:17px}
/* The media roster: a READ-ONLY list, so it is drawn as quiet rows rather than
   as a table — it answers "what can this tab draw with" in passing, and must
   not compete with the switches above it for attention. The id is monospace
   and dimmer than the name because it is the string a tool call has to pass,
   not the thing a human reads; the tag chips carry the only colour, one hue
   per direction (text→image vs image→image), so the grouping is visible
   without a legend. */
/* Aligned with the indented rows above it, but under its OWN class: the
   credit position picker owns .dsm-workbuddy-pref-indent, and the card suite
   resolves that selector expecting the picker. This block is a block (lead
   row + hint + list), not a single indented line. */
.dsm-workbuddy-media{padding-left:25px}
.dsm-workbuddy-media-list{margin:2px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.dsm-workbuddy-media-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;min-width:0}
.dsm-workbuddy-media-name{color:var(--dsw-alias-label-secondary,#b8bcc4);font-size:12px}
.dsm-workbuddy-media-id{color:var(--dsw-alias-label-tertiary,#8b8f98);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.dsm-workbuddy-media-tags{display:inline-flex;flex-wrap:wrap;gap:4px}
.dsm-workbuddy-media-tag{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b8f98)}
/* The per-mode video-model picker. It reuses .dsm-workbuddy-media-row so the
   tag chip and the select sit on one baseline, like a roster row does. */
.dsm-workbuddy-video-model-select{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#b8bcc4);background:var(--dsw-alias-bg-l1,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;max-width:100%;min-width:0}
.dsm-workbuddy-video-model-select:disabled{opacity:.6}
.dsm-workbuddy-media-empty,.dsm-workbuddy-media-error{font-size:12px;line-height:17px}
.dsm-workbuddy-media-empty{color:var(--dsw-alias-label-tertiary,#8b8f98)}
.dsm-workbuddy-media-error{color:var(--dsw-alias-label-error,#e5675f)}
/* The supplement to the host's fixed quota sentence (issue #63). The plugin no
   longer claims the host's shell.quota-notice chain seat, so this no longer
   paints into shell.overlay — that seat is the reason the previous build's
   inline span parked at the overlay's TOP-LEFT as a box the maintainer had
   never seen before. It is kept inline and box-free for the surface that
   renders it INSIDE a line of conversation: the moment it paints a box it stops
   being a parenthetical and becomes the dialog that was already rejected once.
   The body is one step quieter than the text it follows. */
.dsm-workbuddy-quota-notice{display:inline}
.dsm-workbuddy-quota-notice-body{color:var(--dsw-alias-label-tertiary,#8b8f98);font-size:12px}
/* The seat picker is the PLATFORM's select, sized by its own two options rather
 * than stretched: the control answers one short question and sits beside the
 * words that ask it.
 *
 * This was drawn by hand for one revision — appearance:none, a layer-2 panel and
 * a chevron built from two rotated gradients — copying a reference screenshot's
 * white field. That does not survive the trip: the screenshot was a LIGHT
 * settings page, this card is dark, and the drawn field ended up the only
 * element here with its own fill, border and arrow, so it read as a form control
 * pasted into a paragraph. The reference card's own dark build uses the native
 * control with a hairline border, which is what this rule is.
 *
 * Sized by content, not by a min-width: it used to carry min-width:132px so it
 * could share a heading row with the account badge, and that floor is now the
 * reason a two-word option would still leave a gap after the word it answers. */
.dsm-workbuddy-credit-position{flex:none;max-width:none;margin-top:0;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:7px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12px;line-height:16px;cursor:pointer}
.dsm-workbuddy-credit-position:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-credit-position:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-credit-position:disabled{opacity:.5;cursor:default}
/* The quick-adjust pins of the CLI route (model, effort): two native selects
   side by side, the same hairline-bordered rule as the seat picker — content-
   sized, no chevron build, no own fill. The row rides the switch row's
   dsm-workbuddy-pref-indent indent, because it answers a question the switch
   above it poses. */
.dsm-workbuddy-cli-bridge-pickers{flex-wrap:wrap}
.dsm-workbuddy-cli-bridge-pick{display:flex;align-items:center;gap:6px;min-width:0}
.dsm-workbuddy-cli-bridge-select{flex:none;max-width:none;margin-top:0;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:7px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12px;line-height:16px;cursor:pointer}
.dsm-workbuddy-cli-bridge-select:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-cli-bridge-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-cli-bridge-select:disabled{opacity:.5;cursor:default}
/* A card whose provider is switched OFF dims its LABEL AND DOT. The checkbox
 * beside them must stay at full strength, because that checkbox is the only
 * way to switch the region back on — dimming it would grey out the control
 * that fixes the state it is reporting. Its own disabled rule still dims it
 * when writes are unavailable, which is a different condition and reads as a
 * different thing.
 *
 * That is also what the reference card does: it marks the off state on the
 * tab button and leaves the switch live. */
.dsm-workbuddy-tab-off{opacity:.55}
/* Re-detection keeps a copy in the signed-out branch (that branch is where
   "I just signed in over there" applies), so it needs its own placement: the
   pool block's rule cannot reach it. */
.dsm-workbuddy-usage-account-actions{display:flex;gap:8px;margin:10px 0 0}
.dsm-workbuddy-tab-off-notice{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px;margin:0 0 4px;padding:8px 10px;background:var(--dsw-alias-bg-layer-3,#2a2c33);border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px}
.dsm-workbuddy-usage-hint{padding-left:19px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-workbuddy-account-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:18px;white-space:pre-line}
.dsm-workbuddy-usage-select-wrap{position:relative}
.dsm-workbuddy-usage-select{appearance:none;width:100%;font:inherit;padding:10px 34px 10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-3,#2a2c33);cursor:pointer;transition:border-color .15s,box-shadow .15s}
.dsm-workbuddy-usage-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.22)}
.dsm-workbuddy-usage-select:disabled{opacity:.6;cursor:default}
.dsm-workbuddy-usage-select-wrap::after{content:"";position:absolute;top:50%;right:12px;width:7px;height:7px;transform:translateY(-65%) rotate(45deg);border-right:1.6px solid var(--dsw-alias-label-secondary,#c6c9d0);border-bottom:1.6px solid var(--dsw-alias-label-secondary,#c6c9d0);pointer-events:none}
.dsm-workbuddy-usage-text{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#b8b8b8)}
.dsm-workbuddy-searched{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-searched>summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#b8b8b8);user-select:none}
.dsm-workbuddy-searched-hint{margin:6px 0 4px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-searched-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.dsm-workbuddy-searched-list li{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-workbuddy-searched-list code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#b8b8b8);word-break:break-all}
.dsm-workbuddy-searched-reason{color:var(--dsw-alias-label-tertiary,#999);font-size:11px}
.dsm-workbuddy-searched-reason-encrypted{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-searched-reason-wrong-region{color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-searched-more{margin-top:6px;padding:0;border:0;background:none;color:var(--dsw-alias-brand-primary,#5686fe);font:inherit;font-size:12px;line-height:18px;cursor:pointer;text-align:left}
.dsm-workbuddy-searched-more:hover{text-decoration:underline}
.dsm-workbuddy-usage-error{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-state-error-primary,#ef4444)}
/* A failed status read is recoverable, so the banner carries an action: the
   message alone told the user nothing they could do but close the card. */
.dsm-workbuddy-usage-error-block{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-top:12px}
.dsm-workbuddy-usage-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.dsm-workbuddy-models{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:14px}
.dsm-workbuddy-models-fold{display:flex;flex-direction:column;gap:10px}
/* A plain header now: the section does not fold, so it is neither clickable nor
   focusable, and the list-marker rules that hid the native <details> triangle are
   gone with it. */
/* WRAPS, and the title column may shrink.
 *
 * In the Settings panel this header has ~538px for a title, a count line and
 * FOUR buttons (refresh + two availability sweeps + the speed sweep), whose
 * Chinese labels are long (一键测速启用模型). Without wrapping the flex line
 * never breaks, so the buttons keep their intrinsic width and the title column
 * is squeezed until 「已启用 3 个」 breaks mid-phrase — the header grows a second
 * line while the buttons stay put, which reads as a layout accident.
 *
 * row-gap is smaller than gap: a wrapped row is a continuation of the same
 * header, not a new section. */
.dsm-workbuddy-models-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}
/* The title column must be allowed to shrink below its content (min-width:0),
   or wrapping does not help — a flex item defaults to min-width:auto and would
   still push the buttons onto their own line at full width. */
.dsm-workbuddy-models-head>div:first-child{min-width:0}
.dsm-workbuddy-models-title-row{display:flex;align-items:center;gap:6px;min-width:0}
.dsm-workbuddy-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
/* Unsaved-changes marker. It sits in the HEADER rather than beside the save
   buttons at the foot of the list, so a pending edit is visible without
   scrolling to the end of a long model list. */
.dsm-workbuddy-models-dirty{margin-left:8px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-state-warn-primary,#f59e0b);color:#1b1d22;font-size:11px;font-weight:600;line-height:16px;vertical-align:1px;white-space:nowrap}
.dsm-workbuddy-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* The one grey line that states what a section is FOR, at the top of a panel.
   Kept as its own class instead of reusing the models-summary class: the same
   rule now heads the capability section, whose vocabulary has nothing to do with
   models, and a shared name would send the next reader to the wrong panel. */
.dsm-workbuddy-panel-note{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* The free-model quota warning (see the tabFreeQuotaWarn locale key). Bold on
   purpose, and it keeps the summary's own grey rather than the primary label
   colour: it has to stand out from the three lines around it WITHOUT reading as
   an error banner, because the fact it states is normal product behaviour
   rather than a failure. Weight is the only signal it needs. */
/* 这两句仍然连在一起读（先说这两个 tab 是什么，再说额度有限），但不再用负
 * 外边距把它们压成一坨。
 *
 * 上一版是 margin-top:-10px，本意是「不要段落间距」。实测代价是两行底部只隔
 * 6px，而第二行是加粗的：负外边距把上一行 18px 行高留下的空隙吃掉之后，加粗
 * 的字面几乎顶到上一行的下缘，读起来像一个被挤住的块，而不是两句话。改成
 * 4px 的正间距：仍然贴得比普通段落近，但加粗那一行有了自己的呼吸。 */
/* Sits ON the pool heading's line now, in the gap between the title and the
 * serving-account badge. It was a block paragraph (with margins tuned to follow
 * the region-pair explanation), so it needs a row-appropriate box: no block
 * margins, and flex:1 so it takes exactly the empty middle and pushes the
 * badge to the right edge the way the heading row already wanted.
 *
 * It may WRAP rather than ellipsize: this is the sentence that stops a ×0 tier
 * being read as "unlimited", and a truncated caveat is worse than a taller row. */
.dsm-workbuddy-free-quota-warn{font-weight:600;flex:1 1 12em;min-width:0;margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* The line that explains the REGION pair, directly under it.
 *
 * It used to be a .dsm-workbuddy-models-summary inside the accounts panel,
 * borrowing a class named for the model list. It describes the two provider
 * cells above it, so it gets its own name and its own margin: the summary's
 * margin:2px 0 0 was tuned to sit under a section heading, and here the line
 * follows a row of boxed cells and needs more air, plus it precedes the section
 * tabs whose own top margin would otherwise crowd it.
 *
 * 最后定成 margin:0，因为这个容器是 flex column 带 gap 的：外边距会**叠在**
 * gap 之上。10px 时实测空隙 26px（10 + 16），18px 时 34px，而格子的边框让它
 * 看起来更松。真正需要的只是 gap 本身——这一行本就跟着单元格，属于同一个
 * 「范围」区块，中间不需要再插一层空气。
 *
 * 上一版反过来试过两个极端都算过账：负外边距（压成 6px，加粗那行顶到上一行）、
 * 18px（34px 的空档）。正解是不加。 */
.dsm-workbuddy-tab-hint{margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* Every model is laid out in full — NO inner scroll box.
 *
 * The previous rule capped this at max-height 520px with overflow-y auto, so a
 * 20-model roster showed about seven rows and hid the rest behind a scrollbar
 * the user had to discover and then drag inside a panel that already scrolls.
 * A model picker whose whole job is "let me see and tick models" should not
 * have two scrollbars stacked on top of each other.
 *
 * overflow:hidden stays, and it is load-bearing rather than vestigial: the
 * rounded corners are drawn by this bordered box, so without clipping the first
 * and last row would paint square corners over it. Nothing is CLIPPED by it any
 * more, because the box is now exactly as tall as its contents.
 *
 * NOTE: no backticks in CSS comments inside this template literal — one would
 * terminate the string early and silently drop every rule after it. */
.dsm-workbuddy-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
.dsm-workbuddy-model{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}
.dsm-workbuddy-model-disabled{opacity:.55}
.dsm-workbuddy-model+.dsm-workbuddy-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
/* ISSUE #198 — the model row's controls MUST WRAP.

   The row carries four groups on one line: the name, the two checkboxes, the
   context-budget control, and the test/measure buttons. (It was a radio GROUP;
   as of 5.20.2 it is one select, which cannot wrap or clip internally — but the
   row still has to wrap, because the four groups together are what overflow.)
   The budget control had flex:none and the row had no flex-wrap, so on a narrow
   card (dsh-go on a phone, a ~360 px settings panel) the row's intrinsic width
   exceeded the
   container and the model list's overflow:hidden CLIPPED THE REST — the third
   radio (「模型原生窗口」, e.g. 1M) was neither visible nor clickable, and the
   largest budget a user could pick looked like 500K. A control that is clipped is
   worse than one that is missing: the README promises three tiers and the screen
   silently contradicts it. Both halves are needed — the row wraps, AND the group
   itself wraps, because its three labels can exceed even a whole narrow line —
   hence the media query below as well, which gives the group the full width on a
   phone so it reads as one deliberate line rather than a scramble. */
/* ONE MODEL = TWO LINES (requested; it was three for one release).
 *
 *   1. WHAT IT IS + HOW IT BEHAVES — checkbox, name, price, badges, load icon
 *                                    then the switches and the budget select
 *   2. WHAT IT COSTS / WHAT YOU CAN DO — window + output + tier, then the buttons
 *
 * WHY THE SWITCHES MOVED BACK UP. As three lines the row left the whole right
 * HALF of line 1 empty — the name is short, and nothing followed it — while
 * line 2 carried three controls that together are narrower than that empty
 * space. The row was three lines tall and two-thirds empty per line; two lines
 * fit the same content in less height, which is what the list is for (reading
 * a roster, not admiring whitespace).
 *
 * Line 1 is a two-part flex: the name label is flex:1 and the switch group is
 * flex:none, so a long model name shrinks (it already ellipsizes) and the
 * controls never move. When the column is too narrow for both, the controls
 * wrap UNDER the name — the same visual as the old three-line layout, decided
 * by the available width rather than always. */
.dsm-workbuddy-model-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;row-gap:8px;min-width:0}
/* Line 1's right half. flex:none so the switches and the select keep their own
   width and the NAME is the only thing that gives way. */
.dsm-workbuddy-model-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;row-gap:8px;min-width:0;flex:none}
/* Line 2: facts left, actions right. Indented to the name (22px = the
   checkbox box + its 8px gap) so the two lines read as one block rather than
   as a checkbox with two toppled fragments beside it. */
.dsm-workbuddy-model-details{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding-inline-start:22px}
.dsm-workbuddy-model-enabled{display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;flex:1}
.dsm-workbuddy-model-enabled input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe);flex:none}
.dsm-workbuddy-model-image{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-model-image input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-model-off{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-model-off input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-model-off-blocked{cursor:not-allowed;opacity:.75}
.dsm-workbuddy-model-off-flag{margin-left:2px;padding:0 4px;border-radius:4px;background:var(--dsw-alias-label-caution-background,#4a3a1f);color:var(--dsw-alias-label-caution,#e8b34b);font-size:10px;line-height:14px;white-space:nowrap}
/* The name and its chips share one line, and WHICH ONE gives way matters.
 *
 * The chips are flex:none (a half-drawn pill reads as a rendering bug), so the
 * only shrinkable item is the name — and it is also the one thing a reader
 * needs. Left alone, a long name plus two or three chips squeezes the name down
 * to a few characters: 「GLM-5.」 with nothing after it, which is exactly the
 * report this fixes.
 *
 * So the chips wrap among themselves when the line is tight, and the name gets a
 * floor. It may still ellipsize — a name longer than the whole row cannot fit —
 * but it never collapses to a stub while a badge sits whole beside it. */
.dsm-workbuddy-model-copy{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;min-width:0}
/* THE NAME MUST NOT CLAIM LEFTOVER WIDTH.
 *
 * It was flex:1 1 auto; min-width:9em, which made the name box grow to fill
 * whatever the row had spare — 117px (9em) for "Hy4", whose text is ~30px. The
 * promo chip therefore sat at the END of that inflated box, and the gap between
 * the price and the chip read as a stray blank block: it appears ONLY on rows
 * that have a chip, because that is the only case where anything follows the
 * name.
 *
 * flex:0 1 auto takes the name's own width and allows SHRINKING (so a long
 * name still ellipsizes and still cannot push the chip out of view). The floor
 * is gone with it: a minimum of 9em was what turned "do not collapse" into
 * "always at least 117px". */
.dsm-workbuddy-model-copy>.dsm-workbuddy-model-name{flex:0 1 auto;min-width:0}
/* Below the panel's own width the floor is too greedy: 9em plus two chips is
   wider than the line, and the NAME would force the wrap it is meant to avoid.
   Give it less and let the chips take the second line. */

.dsm-workbuddy-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}
/* The upstream's own promotion badge ("限时免费" / "Free now" / "Pro Only").
   The colour is the upstream's own, handed in as a custom property; without
   one the brand colour stands in. "flex:none" keeps the badge whole while the
   model name beside it truncates with an ellipsis. The plain background comes
   first so an engine without color-mix still gets a readable chip. */
.dsm-workbuddy-model-label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;vertical-align:baseline}
/* The same chip, inside the HOST's picker. A model row there is one line wide
   and already carries the name, the check mark and the load icon, so the chip
   gets a hard ceiling and the TEXT inside it truncates — the chip itself must
   stay whole, because a half-drawn pill reads as a rendering bug. "6em" at the
   chip's 10px is about six characters: enough for "夜间折扣", not enough for a
   label to push the row's own controls out of view. */
.dsm-workbuddy-model-label-promo{max-width:6em;overflow:hidden}
.dsm-workbuddy-model-label-promo-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The "本机首次见到" marker: the SAME quiet ink as the composer pill's
   "· N 新模型" segment (label-dimmed), but no chip border and one step smaller,
   so it reads as a side note beside the promotion chip rather than a second
   badge competing with the model name. */
/* A badge another PROVIDER published for its own model, reproduced in the
   host's picker so it survives this plugin holding the cell. Geometry and the
   no-border rule are copied from the host's own Tag.module.css (0.2.2-rc.1) —
   the chip must be indistinguishable from one the host drew itself, which is
   also why there is no max-width here: the host does not truncate, and a chip
   that turned "限时免费" into "限时免…" at the same row width would be the one
   visible difference. Colours arrive inline per tone. */
.dsm-workbuddy-model-label-host-badge{flex:none;display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
/* A foreign row reuses .dsm-workbuddy-model-label as its flex wrapper so both
   branches share ONE alignment model (a bare span put the pill on the text
   baseline, which rode visibly high). That class carries this plugin's own
   gap:5px, while the host's fallback uses gap:4px; the one-pixel override
   keeps the host's metric without giving our own rows a second wrapper. */
.dsm-workbuddy-model-label-host-row{gap:4px}
.dsm-workbuddy-model-label-new{flex:none;display:inline-flex;align-items:center;padding:0 5px;border-radius:999px;font-size:10px;line-height:16px;font-weight:600;white-space:nowrap;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6))}
.dsm-workbuddy-busy{flex:none;display:inline-flex;align-items:center;block-size:12px;color:var(--dsm-workbuddy-busy-color);vertical-align:-2px}
.dsm-workbuddy-busy svg{display:block;block-size:12px;inline-size:auto}
.dsm-workbuddy-model-promo{flex:none;display:inline-flex;align-items:center;padding:0 7px;border-radius:999px;font-size:10px;line-height:16px;font-weight:600;white-space:nowrap;color:var(--dsm-workbuddy-promo-color,var(--dsw-alias-brand-primary,#5686fe));background:rgba(255,255,255,.08);background:color-mix(in srgb,var(--dsm-workbuddy-promo-color,var(--dsw-alias-brand-primary,#5686fe)) 16%,transparent);border:1px solid transparent;border-color:color-mix(in srgb,var(--dsm-workbuddy-promo-color,var(--dsw-alias-brand-primary,#5686fe)) 40%,transparent)}
.dsm-workbuddy-model-id{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-model-desc{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-workbuddy-model-meta{display:flex;align-items:center;gap:7px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
.dsm-workbuddy-model-meta-tag{padding:1px 7px;border-radius:999px;font-size:11px;line-height:15px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* The per-model default thinking tier (issue #179). It lives INSIDE the meta row
   so it sits on the same baseline as the context/output figures it belongs with,
   and stays a small inline control rather than a third row of its own — the row
   already carries the probe buttons on its right-hand side. */
.dsm-workbuddy-model-effort{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.dsm-workbuddy-model-effort-select{font:inherit;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,#c6c9d0);background:rgba(174,179,187,.11);border:1px solid transparent;border-radius:999px;padding:1px 6px;cursor:pointer;max-width:180px}
.dsm-workbuddy-model-effort-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l2,#3a3d45)}
.dsm-workbuddy-model-effort-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-model-effort-select:disabled{opacity:.55;cursor:default}
/* The three tiers plus the two probe buttons plus the two checkboxes are MORE
   than one narrow line can hold, so this group must be allowed to break between
   its own labels too (issue #199's sibling, #198): flex:none alone was half of
   the clipping bug, and flex-wrap is the other half — a 1.048M label is wider
   than 200K. Left-aligning the group under the media query makes the group
   own its line on a phone instead of dangling at the right edge. */
/* ONE SELECT, NOT A ROW OF RADIOS.
 *
 * It was a wrapping flex row of three radios. In the Settings column (564px,
 * of which the model row already spends ~300px on the id/speed column) those
 * three wrapped onto a second line, and a wrapped row of radios reads as three
 * independent switches rather than as one choice.
 *
 * A FIXED min-inline-size keeps the three rows' columns aligned. Without it the
 * control sizes to its widest option, so a model offering only 192K drew a
 * 56px control while its neighbours drew 58px and the left edges stepped by 2px
 * down the list — the same misalignment the wrapped radios had, in miniature.
 *
 * Being a <select>, this is now a single fixed-width control that cannot wrap,
 * and the native dropdown is what the platform draws — so the styling here is
 * only about the closed state: the same 11px secondary text the radios used, a
 * chevron the platform provides, and a chevron-affordance gap.
 *
 * flex:none matters: the row is a flex line, and a select that grows steals
 * width from the model name beside it. */
.dsm-workbuddy-context-budget{flex:none;margin:0;min-inline-size:58px;padding:2px 4px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:6px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-secondary,#c6c9d0);font-family:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsm-workbuddy-context-budget:disabled{cursor:default;opacity:.6}
.dsm-workbuddy-context-budget:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-model-capability-note{margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* Model probe (test button + result). The result line is its own row under the
   meta line, because a cooldown sentence ("rate limited - the upstream gave no
   time") does not fit next to the context/output chips, and truncating it would
   hide exactly the part the user needs. */
/* FOUR buttons now live here (refresh + two availability sweeps + the speed
   sweep added for issue #92), and the labels are long in Chinese
   (一键测速启用模型). flex:none alone let the group run past the header on a
   narrow card, so the group may WRAP and each label refuses to break mid-word —
   the same failure the pool row's action buttons had. The wrap is what makes a
   fourth button safe; without it the header would need a scroll. */
.dsm-workbuddy-models-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dsm-workbuddy-models-head-actions .dsm-btn{white-space:nowrap}
/* The sweep buttons keep the outline weight of the refresh button beside them, so
   the header reads as one group of equal actions. */
.dsm-workbuddy-models-sweep{white-space:nowrap}
.dsm-workbuddy-models-sweep-summary{margin:6px 0 0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-model-probe{flex:none;padding:3px 10px;font-size:11px;line-height:16px}
.dsm-workbuddy-model-probe-result{margin:0;font-size:12px;line-height:18px;word-break:break-word}
.dsm-workbuddy-model-probe-result-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-model-probe-result-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-model-probe-result-bad{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-model-actions{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;row-gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-model-save-error{flex:1;min-width:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:16px;text-align:right}
.dsm-workbuddy-model-actions-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsm-workbuddy-usage-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5;transition:color .16s}
.dsm-workbuddy-usage-cheer-star{font-size:12px;line-height:1;display:inline-flex}
.dsm-workbuddy-usage-cheer:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-usage-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}

/* ---- Account pool ---- */
/* No top rule any more. It separated the 「免费模型并非无限量」 warning from the
 * pool; that warning moved up beside the region hint it belongs with, so the
 * line now had nothing above it to separate and only added a seam between the
 * section tabs and the first thing they contain. */
.dsm-workbuddy-pool{display:flex;flex-direction:column;gap:12px;margin:0;padding:0 0 4px}
/* The block's heading: title on the left, serving-account badge on the right.
 *
 * It used to hold a THIRD child — the credit-readout switch, slotted in between
 * the title and the badge by the card. A control that configures something else
 * spent several revisions sitting inside this block's title, and it forced the
 * row onto a shared baseline with a picker whose width shoved the badge to the
 * far edge. The switch now has its own section above; what is left is the one
 * thing that is genuinely this block's title row.
 *
 * The badge is pushed right with margin-left:auto rather than the row using
 * space-between, so it stays on the right edge even if a future change adds a
 * child or removes one. */
.dsm-workbuddy-pool-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
/* SOLID badge: white ink on the success green itself, plus a matching hairline.
 *
 * This is deliberately a stronger stop than a tinted pill. Green TEXT on the old
 * pale-blue tint still read as a quiet annotation — and a comment that has to be
 * looked for is not doing its job when the badge's whole point is "THIS row is
 * the one serving". Filled also matches how the host marks primary affordances.
 *
 * Both halves now come from the SAME token, so they cannot drift apart the way
 * they did when the ink was --dsw-alias-brand-primary — the host's CONTRAST
 * colour, which painted near-BLACK on light themes (see the checkbox note at
 * line ~118). Theme-following: #22c55e dark / #16a34a light.
 *
 * Contrast: white on #22c55e ≈ 2.2:1, on #16a34a ≈ 3.3:1 — under the 4.5:1 bar
 * for body text, which is why the badge stays 11-12px and BOLD and never carries
 * a sentence: it is read as a shape first, a word second. The border keeps the
 * pill from bleeding into the row tint if a theme remaps success to something
 * dark. */
.dsm-workbuddy-pool-current-badge{margin-left:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;padding:2px 10px;border-radius:999px;background:var(--dsw-alias-state-success-primary,#22c55e);border:1px solid rgba(34,197,94,.55);color:#fff;font-size:12px;font-weight:600;line-height:18px;white-space:nowrap}
/* Sits under the header block, before the batch buttons: account discovery is
   the first step of using the pool, so it reads above the actions it enables. */
/* THE HEAD SLOT — one place that answers "who is serving?".
 *
 * With the pool off it holds the account picker, with the pool on the badge.
 * Both are pushed right by the same rule so the header does not jump between
 * the two states. The picker used to live in a settings row of its own further
 * down the page, which meant the same account name appeared in the title row,
 * in that row, and again in the member table. */
.dsm-workbuddy-pool-head-pick{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px}
.dsm-workbuddy-pool-head-pick-label{color:var(--dsw-alias-label-secondary,#c6c9d0);white-space:nowrap}
.dsm-workbuddy-pool-account-select{min-width:200px}
.dsm-workbuddy-pool-title{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-badge{flex:none;padding:2px 9px;border-radius:999px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.12);border:1px solid rgba(86,134,254,.32)}
/* No top rule: this bar now hangs directly under 「本池包含的账号 / 已选 N / M /
   全选 / 全不选」 and acts on exactly that set, so a separator here would cut the
   buttons away from the count that explains them. The divider that matters is
   the one the member block has against 「更多设置」 below. */
.dsm-workbuddy-pool-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-workbuddy-pool-actions-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-workbuddy-pool-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-note{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-warn{margin:0;padding:9px 11px;border-radius:9px;font-size:12px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#f59e0b);background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.3)}
/* Ghost members (issue #60): the warning plus one removable chip per id. The
   chips are what make the warning actionable — a ghost has no row in the table
   above, because that roster is the sign-ins this machine still has. */
.dsm-workbuddy-pool-ghosts{display:flex;flex-direction:column;gap:6px}
.dsm-workbuddy-pool-ghost-list{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.dsm-workbuddy-pool-ghost{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 9px;border-radius:999px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#f59e0b);background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.3)}
.dsm-workbuddy-pool-ghost-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-pool-ghost-remove{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:999px;font-size:11px;line-height:1;cursor:pointer;color:inherit;background:transparent}
.dsm-workbuddy-pool-ghost-remove:hover:not(:disabled){background:rgba(245,158,11,.2)}
.dsm-workbuddy-pool-ghost-remove:disabled{cursor:default;opacity:.5}
.dsm-workbuddy-pool-error{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary,#ef4444);white-space:pre-line}
/* CONTAINMENT ROOT for the row breakpoints below.
 *
 * The card now renders in three places whose WIDTHS have nothing to do with the
 * window: the composer card, the full page (capped at 860px), and the Settings
 * panel's content column (~560px on a 1400px screen). Every @media breakpoint
 * in this file measures the VIEWPORT, so inside the Settings panel they never
 * fire — a 564px column got the five-column desktop table and each cell clipped.
 *
 * container-type: inline-size lets the breakpoints below measure the TABLE
 * instead, which is the width the rows actually have to fit into.
 *
 * Deliberately on the table and NOT on an ancestor: container-type makes the
 * element the containing block for position:fixed descendants, and the busy
 * veils and the device dialog are siblings of this table inside
 * .dsm-workbuddy-pool. Putting the containment here leaves them on the
 * viewport, which is where a full-screen overlay belongs. The table itself
 * contains only the header and member rows — no fixed-position descendants. */
.dsm-workbuddy-pool-table{container-type:inline-size;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
/* THREE LINES AT EVERY WIDTH — the shape the row is meant to have.
 *
 * The row used to be five columns on one line when the table was wide, and a
 * different re-grid when it was not, so its SHAPE depended on how wide the box
 * around it happened to be: the same account read differently in the composer
 * card, the full page and the Settings column. Named lines fix the shape once,
 * whatever width it lands in:
 *   line 1:  who it is ...................... credits
 *   line 2:  what state it is in ... check-in  actions
 *   line 3:  how it was measured (provenance)
 *
 * TWO ROWS OF AREAS, THREE LINES OF TEXT. The provenance line is the PROBE
 * CELL's own second line (the -probe-line and -probe-prov spans), so the row
 * grows to three lines without a third grid row, and the verdict line and the
 * provenance line keep the same left edge and wrap independently.
 *
 * What this replaced: the verdict and 「测试于 …」 were separate sub-rows, so
 * every row with a measured account was FOUR lines — the last one holding
 * nothing but a timestamp. The owner asked for those two on one line and for the
 * whole row to be three.
 *
 * NAMED AREAS, not five anonymous tracks. Every cell declares where it goes, so
 * a cell that is absent — the international region renders no check-in — leaves
 * its area empty instead of pulling the cells after it into the wrong columns.
 * That failure is not hypothetical: it is what made the international table
 * stack (5.20.26), where a template naming five cells over four tracks was
 * discarded wholesale by the browser. Both variants therefore keep the same
 * three tracks and the same three cells per line; only the areas differ.
 *
 * The first track is minmax(0,1fr) and not a bare 1fr on purpose: a bare 1fr
 * carries an automatic minimum of the item's min-content width, so a long
 * account name or verdict would push the row wider than its table instead of
 * ellipsizing. With a zero minimum the flexible track gives way, which is what
 * lets the same template serve the ~564px Settings column without a breakpoint.
 *
 * The LAST track is fixed px, never auto: the header and the rows are separate
 * grid containers, so an auto track is sized twice against different contents
 * and the two disagree. Measured at 820px, the actions track came out at 691 in
 * the header (it holds one empty span) and 615 in the row (it holds three
 * buttons), which dragged the check-in track beside it out of place by 76px. See
 * the credits rule below for the A/B numbers.
 *
 * The check-in track is minmax(0,auto) — flexible, so it can hold 「不适用（企业
 * 版）」 (96px) without overflowing, but with a ZERO minimum so it yields to the
 * account name instead of widening the row. It is also the one auto track the
 * header drift cannot reach: every cell in it is justify-self:end, so a header
 * label 24px wide and a value 36px wide still share their RIGHT edge exactly —
 * an auto track can move a left edge, and that is all it moves.
 *
 * The last track is 160px because that is what the button group needs AT REST in
 * the widest locale, measured in headless Chrome: ⚙ Test Remove is 156px, ⚙ 测试
 * 删除 134px. At 132px — the value this briefly shipped with — even the Chinese
 * resting group wrapped, dropping 删除 onto a line of its own and growing every
 * row by ~24px at every width. The in-flight labels (Testing… / Removing…,
 * 194-208px) still wrap, and that is exactly what flex-wrap on the group is for:
 * a momentary second line while a request is in flight beats a track wide enough
 * to waste ~48px per row at rest. */
.dsm-workbuddy-pool-row{
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(0,auto) 160px;
  grid-template-areas:
    "account account credits"
    "probe   checkin actions";
  column-gap:12px;row-gap:4px;align-items:center;padding:10px 14px;
  border-top:1px solid var(--dsw-alias-border-l1,#2c2d31);
  font-size:13px;color:var(--dsw-alias-label-secondary,#c6c9d0);
}
/* WITHOUT the check-in the verdict takes the freed area, so the actions stay in
   the last track — the same track, and the same right edge, in both variants.
   Three cells again: the count never changes, only which area a cell owns. */
.dsm-workbuddy-pool-table:not(.dsm-workbuddy-pool-table-checkin) .dsm-workbuddy-pool-row{
  grid-template-areas:
    "account account credits"
    "probe   probe   actions";
}
.dsm-workbuddy-pool-row:first-child{border-top:0}
.dsm-workbuddy-pool-row-head{padding:8px 14px;row-gap:1px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
/* THE HEADER SPEAKS THE SAME TEMPLATE AS THE ROWS.
 *
 * It used to be a five-span row against a five-track template, and the narrow
 * form hid it because its labels pointed at tracks that no longer existed.
 * Both templates now name the same AREAS, so the labels line up in both
 * directions — and a label cannot drift away from the value it names, because
 * there is no second column definition to keep in step.
 *
 * The cells are emitted in reading order (line one, then line two) and the
 * areas decide where each lands, exactly as in the rows.
 *
 * The check-in label is ABSENT where the region has none, exactly as its cell
 * is: an empty area stays empty, and a label over nothing is worse than none.
 * The actions cell has no text — the buttons speak — but it still has to exist,
 * or the area named in the template would have no box to fill. */
.dsm-workbuddy-pool-row-head .dsm-workbuddy-pool-col-credits{grid-area:credits;justify-self:end;text-align:right}
.dsm-workbuddy-pool-row-head .dsm-workbuddy-pool-col-probe{grid-area:probe}
.dsm-workbuddy-pool-row-head .dsm-workbuddy-pool-col-checkin{grid-area:checkin;justify-self:end}
.dsm-workbuddy-pool-row-head .dsm-workbuddy-pool-col-actions{grid-area:actions}
/* WHERE THE LABELED COLUMN ACTUALLY STARTS (learned from dsh-connect-trae, which
   carries the same rule for the same reason).
 *
 * The account cell's first element is the membership checkbox, so the account
 * NAME begins well inside the track. Measured at the plugin page's 1120px: the
 * header cell starts at x=65 and the name at x=103 — a 38px gap. Flush to the
 * cell edge, the word 「账号」 floated in the padding and pointed at nothing.
 *
 * 38px is the checkbox (13px) plus the cell's 8px gap plus the vertical
 * centring slack of an 18px glyph in a 20px label; rounded to the value that
 * measured flush rather than derived, because the two cells do not share a
 * box. The offset holds at every width now that the header is no longer hidden:
 * the cell keeps the same leading checkbox in both forms. */
.dsm-workbuddy-pool-col-account{grid-area:account;padding-inline-start:38px}
.dsm-workbuddy-pool-row-current{background:rgba(86,134,254,.07)}
/* The serving row, made findable at a glance: a left accent bar plus the tint.
   The bar is what distinguishes it in a long table, where a 7%-opacity wash
   alone reads as an alternating-row stripe. */
.dsm-workbuddy-pool-row-current{box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool-account{grid-area:account;display:flex;align-items:center;gap:8px;min-width:0}
/* The account block WRAPS AMONG ITSELF instead of stacking.
 *
 * It was a column — name / rank+arrows / current pill / membership line — which
 * is what a whole cell per fact needs, but this cell now shares line one with
 * the credits. Stacked, those four become four lines and the three-line row the
 * rest of the card promises is a lie on every row. Read as a sentence it is one
 * line — 「账号A · 第 1 位 · 当前使用」 — so it wraps instead. */
.dsm-workbuddy-pool-account-name{display:flex;flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0}
.dsm-workbuddy-pool-account-name b{font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%}
.dsm-workbuddy-pool-account-name span{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999)}
/* Declared AFTER the blanket span rule so it wins: the badge must not inherit
   the muted 11px tertiary treatment the membership line uses. */
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-current-tag{align-self:center;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-state-success-primary,#22c55e);border:1px solid rgba(34,197,94,.55);color:#fff;font-size:11px;font-weight:600;line-height:16px;white-space:nowrap}
/* Manual-priority chrome (order badge + up/down arrows). The rank badge is a SPAN,
   not a button: it only DESCRIBES the current order and must not read as a
   control (nor join the row's button list). The solid vs dashed distinction is
   load-bearing — a numeric rank must NOT appear when the credit policy still
   decides the order, so the -auto modifier is the dashed/grey state. */
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-order{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-rank{display:inline-flex;align-items:center;border-radius:999px;border:1px solid rgba(86,134,254,.32);background:rgba(86,134,254,.12);color:var(--dsw-alias-brand-primary,#5686fe);font-size:11px;font-weight:600;line-height:16px;padding:1px 6px;white-space:nowrap;cursor:default;font-variant-numeric:tabular-nums}
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-rank-auto{border:1px dashed var(--dsw-alias-border-l1,#2c2d31);background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-move{display:inline-flex;align-items:center;gap:2px}
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-move-btn{width:18px;height:18px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#2c2d31);background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:1;cursor:pointer}
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-move-btn:disabled{opacity:.4;cursor:default}
/* Hover/focus must change BOTH halves of the contrast pair.
   The rule this replaces recoloured only the glyph — to
   --dsw-alias-label-primary (#e6e6e6) — and left the background as it was. In
   the LIGHT theme that token is near-WHITE, so on hover the arrow painted
   white-on-light and vanished under the cursor (reported as "the up arrow
   disappears when I hover"). Recolouring text without also repainting its
   backdrop is unsafe whenever the two come from independent tokens, so this
   sets an explicit tinted background and keeps the glyph on the brand colour,
   which is legible in both themes. The outline is a third, theme-independent
   affordance so the target is findable even if a token is remapped. */
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-move-btn:not(:disabled):hover,
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-move-btn:not(:disabled):focus-visible{background:rgba(86,134,254,.16);border-color:rgba(86,134,254,.55);color:var(--dsw-alias-brand-primary,#5686fe);outline:2px solid rgba(86,134,254,.45);outline-offset:1px}
.dsm-workbuddy-pool-excluded{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
/* The ordering-rule disclosure, placed directly above the member table.
   A native <details>: the marker is left to the browser so the control keeps
   its built-in keyboard and screen-reader behaviour. The summary is a full-width
   row because a 12px grey label on its own is a small click target, and this is
   the one place a confused user is meant to click. */
.dsm-workbuddy-pool-order-rules{border:1px solid var(--dsw-alias-border-l1,#2c2d31);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#232529);overflow:hidden}
.dsm-workbuddy-pool-order-rules-summary{padding:8px 12px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-weight:600;line-height:18px}
.dsm-workbuddy-pool-order-rules-summary:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-order-rules-summary:focus-visible{outline:2px solid rgba(86,134,254,.55);outline-offset:-2px}
.dsm-workbuddy-pool-order-rules-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,#2c2d31);padding-top:10px}
/* The rules already carry their own "1." … "8." inside the sentence, so the <ol>
   is semantic only. Suppressing the marker keeps a single number on screen
   instead of "1. 1. …". */
.dsm-workbuddy-pool-order-rules-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-order-rules-list li{padding-left:2px}
/* The "why expiring credits win" note is the sentence users push back on, so
   it is tinted rather than buried in the same grey as the eight rules. */
.dsm-workbuddy-pool-order-rules-why{margin:0;padding:8px 10px;border-radius:8px;border-left:3px solid var(--dsw-alias-state-warn-primary,#f59e0b);background:rgba(245,158,11,.10);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* THE CREDITS TRACK IS ITS OWN COLUMN, right-aligned against the row's edge.
 *
 * This cell is pinned to its right end (justify-self:end) so one right edge
 * stands under every row, however wide the number is.
 *
 * AUTO IS THE THING THAT FAILED HERE, for the track that follows it. The header
 * and the data rows are two SEPARATE grid containers, so an auto track is
 * measured twice, each against its own contents — and it is the ACTIONS track
 * that differs (one empty span in the header, three buttons in the row). Because
 * the check-in sits immediately before it, a 76px difference there moves the
 * check-in label 76px away from the value it names: measured in headless Chrome
 * at 820px, header 691 vs data 615. jsdom does no layout and cannot see it. Fixed
 * px on the actions track keeps the two containers in step — the same reason
 * dsh-connect-qoder pins its trailing tracks.
 *
 * The cell is a ROW, not a column, and it is ONE track: the fixed 160px the
 * actions need (see the row rule). The figure and its warning sit side by side
 * and share that width — 「1,556」 is 38px and 「300 积分 3 天内过期」 103px, so
 * together they are 122px and never wrap here. Stacked, as they were, the cell
 * was 35px instead of 18px: line one grew by 17px on EVERY row, and the
 * warning's baseline landed between the verdict and the provenance line, so the
 * right side of the row read as detached from the left. flex-wrap is kept as a
 * last resort (a 3-digit figure plus a longer locale) rather than a clipped
 * number.
 *
 * THE ONE STATE THAT IS NOT THREE LINES: a claimable-benefit entry (issue #79)
 * also renders in this cell, and its own min-content is 229px — a full label
 * plus the claim pill — so inside 160px it wraps to two lines and line one
 * becomes two lines, i.e. a four-line row. That predates the three-line shape
 * and is deliberate in the benefit rule below (its tag clamps to two lines so an
 * unexpectedly long upstream title cannot push the row taller than the pill can
 * travel). Fitting it would mean moving the claim button OFF line one; the pill
 * is a seasonal campaign, so the row keeps its honest wrap instead. */
.dsm-workbuddy-pool-credits{grid-area:credits;display:flex;flex-direction:row;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:0 6px;min-width:0;justify-self:end;text-align:right;font-variant-numeric:tabular-nums}
.dsm-workbuddy-pool-credits b{color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.dsm-workbuddy-pool-soon{font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
/* Claimable benefits (issue #79). A quiet line by default — it is an opportunity, not a fault — and loud only when the window is about to close. */
.dsm-workbuddy-pool-benefits{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999);min-width:0}
/* One entry = text + pill, and the text wraps rather than being cut.
   The tag used to be nowrap + ellipsis, which truncated the label to
   「模型服务异常补偿…」 — dropping the amount, i.e. the only part the user is
   deciding on. Measured in headless Chrome at the card's real width, the entry
   line has room for two lines, so the tag clamps to two and shows the whole
   label; the pill wraps to the line below and never shrinks.
   line-clamp, not plain wrapping: an unexpectedly long upstream title must not
   push the row taller than the pill can travel. */
.dsm-workbuddy-pool-benefit-tag{min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* min-width:0 IS the whole fix (issue #79).
   The pill made this entry's min-content 229px (full line + button) inside a
   148px column, so it painted over the probe column beside it.
   A flex ITEM defaults to min-width:auto and refuses to shrink below its
   content, which is what pinned it at 229; min-width:0 lets the tag ellipsize
   and the pill keep its size.

   Measured in headless Chrome against the real rendered row, as an A/B:
     min-width:0        -> 0 overflowing children, entry 148px
     without it          -> 3 overflowing children, entry 229px
   Changing the row's grid tracks to minmax(0,...) was tried too and made NO
   difference (the entry overflows its CELL, so the CELL was never the
   constraint) — so the tracks are left as they were. */
.dsm-workbuddy-pool-benefit{display:flex;flex-wrap:wrap;align-items:center;gap:2px 5px;min-width:0;max-width:100%}
.dsm-workbuddy-pool-benefit-urgent{color:var(--dsw-alias-state-warn-primary,#f59e0b);font-weight:600}
/* The claim pill: a solid amber call to action.
   Orange, not the brand blue, because this is the ONE control in the pool that
   hands the user something (500 credits) instead of spending their attention on
   a read-only figure. It should read as an opportunity, and amber is the hue
   that says "take this" without shouting.

   Solid fill rather than a tinted outline: at 19px tall and 46px wide, a tinted
   outline sat next to the 1,294 credit figure above it and read as DISABLED.
   The solid fill also survives the row's grey text without competing for the
   eye. The card's own 已签到 green is the only other saturated element here.

   Load-bearing details, each measured in headless Chrome:
   - white-space:nowrap: without it the flex row squeezed 领取 into 领/取 on
     two lines and the pill grew into a 32px-tall blob;
   - a fixed 19px height, so it matches the 11px text beside it instead of
     inheriting .dsm-btn's padding;
   - flex:none, so the shrinking column eats the TEXT and never the pill. */
/* Order matters: this rule must come AFTER .dsm-btn-outline (line ~36) so its
   amber background wins. Two-class specificity turned out to be the wrong lever
   and was REMOVED after measuring: pairing the classes also beat the
   dsm-workbuddy-pool-small-btn padding, and without dsm-btn-outline on the
   element the button fell back to dsm-btn's default background — rendered white
   on a dark row. Source order is what was already working; keep it. */
.dsm-workbuddy-pool-benefit-btn{
  /* Flex centring plus a 1px nudge is what actually centres 领取.
     Measured on the rendered pill in headless Chrome (OCR-free pixel scan of
     the glyph mask inside the 46x19 box):
       display:inline-flex; align-items:center  ->  above 3.5px, below 4.5px,
                                                     glyph sat 1.0px low
       plus translateY(-0.5px) below           ->  above 4.0px, below 4.0px
     Flex centring centres the LINE BOX, and a CJK glyph's ink sits below the
     centre of its em box, so centring the box leaves the ink low. The nudge
     compensates for the ink, not for the box. It is half a pixel because the
     label renders at 2x on a retina display and 1px would overshoot there. */
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:none;
  padding:0 9px;
  height:19px;
  font-size:11px;
  line-height:1;
  font-weight:600;
  border-radius:999px;
  white-space:nowrap;
  letter-spacing:.01em;
  border-color:var(--dsw-alias-state-warn-primary,#f59e0b);
  color:#2a1d05;
  background:var(--dsw-alias-state-warn-primary,#f59e0b);
  /* The only shadow in the pool table: it lifts the pill off the row so the
     control reads as clickable rather than as part of the label. */
  box-shadow:0 1px 2px rgba(0,0,0,.28);
  transition:filter .12s ease;
}
/* Optical centring for the label (issue #79).
   Flex centring centres the LINE BOX, but a CJK glyph's ink sits below the
   centre of that box, so 领取 measured 3.5px above / 4.5px below — visibly low.
   padding-top pushes the ink down by shifting the line box within the centred
   flex item. Measured on the rendered pill in headless Chrome, as a sweep:
     (none)        -> above 3.5 / below 4.5  (+1.0 low)
     padding-top:1px -> above 4.0 / below 4.0  (centred)
     padding-top:2px -> above 4.5 / below 3.5  (-1.0 high)
   transform and padding-bottom were both tried first and moved the ink the
   WRONG way, because both grow the flex item, which re-centres the line box
   downward. Padding-top is the one that shifts the ink up. */
.dsm-workbuddy-pool-benefit-btn > span{display:block;padding-top:1px}
.dsm-workbuddy-pool-benefit-btn:hover:not(:disabled){
  /* Brighten, do not invert: an inverted pill loses its "take this" reading,
     and the dark-on-amber swap is the part that looked cheap in the draft. */
  filter:brightness(1.08);
  border-color:var(--dsw-alias-state-warn-primary,#f59e0b);
  color:#2a1d05;
  background:var(--dsw-alias-state-warn-primary,#f59e0b);
}
.dsm-workbuddy-pool-benefit-btn:active:not(:disabled){filter:brightness(.94)}
/* A row action is in flight: this row, or another one. The pill goes flat so it
   cannot be clicked twice while the first claim is still landing. */
.dsm-workbuddy-pool-benefit-btn:disabled{
  opacity:.45;
  cursor:default;
  box-shadow:none;
}
.dsm-workbuddy-pool-probe,.dsm-workbuddy-pool-checkin{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#999);min-width:0;overflow-wrap:anywhere}
/* The verdict cell: LINE TWO of the row, and two lines of its own.
 *
 * The -probe-line span holds the verdict together with the moment it was
 * measured (see the rule below); -probe-prov is line THREE. A 2px gap is what
 * keeps those two from reading as one wrapped paragraph: at 4px they looked like
 * a single block of text that happened to break, which is how the four-line row
 * it replaced looked. */
.dsm-workbuddy-pool-probe{grid-area:probe;display:flex;flex-direction:column;gap:2px;min-width:0}
/* VERDICT · TESTED-AT, ONE LINE.
 *
 * These were two sub-rows, and every measured account was therefore four lines
 * tall with a timestamp on the last one. They are one sentence — "被限流 · 11/08
 * 15:44 之后可再用 · 约 15 小时后 · 测试于 11/07 17:36" — so they wrap together
 * as a unit, and the measured widths say why that matters: the longest verdict
 * is 260px and 「测试于 11/07 17:36」 another 102, so the pair needs ~380px. It
 * fits from ~700px up; below that only the verdict fits, and the block further
 * down drops the timestamp rather than letting the pair wrap onto a line the row
 * does not have. */
.dsm-workbuddy-pool-probe-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;min-width:0}
.dsm-workbuddy-pool-probe-main{color:var(--dsw-alias-label-secondary,#c6c9d0);min-width:0;overflow-wrap:anywhere}
/* The separator belongs to the timestamp it introduces, so a wrapped line can
   never leave a lone 「·」 hanging at the end of the verdict. */
.dsm-workbuddy-pool-probe-sep,.dsm-workbuddy-pool-tested-at{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}
.dsm-workbuddy-pool-probe-sep{color:var(--dsw-alias-label-dimmed,#9aa0a6);opacity:.7}
/* WHEN, in the verdict's own sentence but at the weight of a timestamp: at 12px
   and the verdict's colour it read as a second verdict, and the row looked like
   two statements fighting for the same line. */
.dsm-workbuddy-pool-probe-prov{display:flex;align-items:center;gap:5px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);min-width:0;flex-wrap:wrap}
.dsm-workbuddy-pool-prov-tag{padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-tertiary,#999);font-size:10px;font-weight:600;line-height:15px;white-space:nowrap}
.dsm-workbuddy-pool-prov-live{background:rgba(245,158,11,.16);color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-prov-unknown{background:var(--dsw-alias-bg-layer-3,#2a2c33);border:1px solid var(--dsw-alias-border-l1,#2c2d31);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-prov-sep{color:var(--dsw-alias-label-dimmed,#9aa0a6);opacity:.7}
.dsm-workbuddy-pool-prov-age{color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}
/* WHICH model a verdict is about (issue #61). Deliberately quiet: it is scope
   information on the provenance line, not a status of its own, so an ok row and
   a rate-limited row must not look different because of it. */
.dsm-workbuddy-pool-prov-model{color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px}
.dsm-workbuddy-pool-members{display:flex;flex-direction:column;gap:10px}
.dsm-workbuddy-pool-members-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-workbuddy-pool-members-title{margin:0 0 3px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-members-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* The 测试/删除 and 全选/全不选 buttons. Shared with the benefit pill, which
 * OVERRIDES both properties at higher specificity (see its rule above): a pill is
 * a capsule whose height is fixed at 19px, so inheriting this 3px/10px rhythm
 * pushed its own padding/line-height out and changed how the label sat.
 * Kept as-is rather than narrowed to the parents that use it, so the row-action
 * and select-all sizing stays in one place. */
.dsm-workbuddy-pool-small-btn{padding:3px 10px;font-size:12px}
.dsm-workbuddy-pool-check{display:inline-flex;align-items:center;flex:none;cursor:pointer}
.dsm-workbuddy-pool-check input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool-check input:disabled{cursor:default;opacity:.5}
.dsm-workbuddy-pool-checked{color:var(--dsw-alias-state-success-primary,#22a06b)}
/* Line two, middle: the daily claim. Its own AREA so that a region WITHOUT it
   leaves that slot empty instead of sliding the actions one track left.
 *
 * BASELINE-aligned, not centred: line two is two lines tall (verdict above,
 * provenance below), and a centred cell floats between them — measured, 「已签到」
 * sat 8px below the verdict's baseline, which read as belonging to neither line.
 * Sharing the verdict's baseline puts the state on the same line as the verdict
 * it belongs to. */
.dsm-workbuddy-pool-checkin{grid-area:checkin;justify-self:end;align-self:baseline;white-space:nowrap;min-width:0;overflow-wrap:anywhere}
.dsm-workbuddy-pool-unknown{color:var(--dsw-alias-label-dimmed,#9aa0a6)}
.dsm-workbuddy-pool-not-member{color:var(--dsw-alias-label-dimmed,#9aa0a6)}
/* A section break, not just a gap: below this line the page stops showing what
   the pool IS and starts showing the knobs that change it. Without the rule the
   heading floated under the table with nothing marking the change of subject. */
.dsm-workbuddy-pool-settings-wrap{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:14px}
.dsm-workbuddy-pool-dirty{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
/* Second containment root, for the settings rows. They are NOT inside
 * .dsm-workbuddy-pool-table (that is the member table only), so the table's
 * container query cannot reach them. This element holds just the stacked
 * setting rows — no position:fixed descendants, so containment here cannot move
 * an overlay's containing block. */
.dsm-workbuddy-pool-settings{container-type:inline-size;display:flex;flex-direction:column;gap:1px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
/* THE MODE BAR — the page's master control, directly under the title.
 *
 * It reuses the .dsm-workbuddy-pool-settings class for the bordered, stacked
 * look, and on purpose: the component tests locate 「启用账号池」 as the first
 * checkbox inside that class, and a user who has learned "settings live in a
 * bordered block" should not have to learn a second shape for the most
 * important one.
 *
 * What it adds is a brand-tinted edge and background, so it reads as "this
 * decides what the rest of the page means" instead of as one more settings
 * card — the switch used to sit at the BOTTOM, 400px below this point.
 */
.dsm-workbuddy-pool-modebar{padding:12px 14px;gap:8px;border-color:rgba(86,134,254,.36);background:linear-gradient(180deg,rgba(86,134,254,.10),rgba(86,134,254,.02)),var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-workbuddy-pool-modebar-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
/* A ROW that holds one switch and its label — NOT a card.
 *
 * Split out from .dsm-workbuddy-pool-modebar (which is the tinted CARD) because
 * the automatic check-in switch used to carry the card class by mistake: it was
 * drawn as a second, nested card inside the mode bar, so the two switches came
 * out at different sizes with a deep dark gap between them (issue #191
 * follow-up).
 *
 * Keeping the row shape in its own class is what stops that from coming back: a
 * switch row can never inherit a card's padding, border or background, because
 * those live on a class this one does not share. Rendered geometry matches
 * .dsm-workbuddy-pool-modebar-row exactly, so switches stacked in one bar line
 * up on both axes. */
.dsm-workbuddy-pool-switchrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsm-workbuddy-pool-modebar-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
/* The mode in words. A switch's position is a 20px shape to decode; this says
   which of the two modes is in force, and therefore how to read the table. */
.dsm-workbuddy-pool-modebar-state{flex:none;padding:1px 9px;border-radius:999px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.14);border:1px solid rgba(86,134,254,.3)}
.dsm-workbuddy-pool-modebar .dsm-workbuddy-pool-dirty{margin-left:auto}
.dsm-workbuddy-pool-modebar .dsm-workbuddy-pool-note{line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* The automatic check-in block (issue #191): a switch, its hint, and — once it
   has run — a one-line progress readout. Indented under the pool switch because
   it is a second, narrower consent: the pool switch says "pick my account", this
   one says "write to it every day". */
.dsm-workbuddy-pool-auto-checkin{margin-top:10px;padding-left:2px;display:flex;flex-direction:column;gap:6px}
.dsm-workbuddy-pool-auto-checkin-status{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* The progress figure is the ANSWER to "did it work?", so it is the one part
   that carries primary text colour rather than the muted note colour. */
.dsm-workbuddy-pool-auto-checkin-line{color:var(--dsw-alias-label-primary,CanvasText);font-weight:500}
.dsm-workbuddy-pool-auto-checkin-pending{color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* A failed attempt is a real condition the user may need to act on, so it is
   not muted — but it is also not an error the plugin can fix, hence warn, not
   the error red reserved for "this broke". */
.dsm-workbuddy-pool-auto-checkin-error{color:var(--dsw-alias-label-warning,#d9822b)}
/* Orthogonal concepts in one sentence when they collide ("in use" vs "in the
   pool"). A left rule marks it as an aside about the row above, not a warning. */
.dsm-workbuddy-pool-serving-note{padding-left:10px;border-left:2px solid rgba(86,134,254,.5);color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* Subheading for "the rest of the settings": one step DOWN from the page title,
   so the panel has one title instead of two equally loud ones. */
.dsm-workbuddy-pool-card-head{display:flex;align-items:center;gap:8px}
.dsm-workbuddy-pool-card-title{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* QR sign-in + export/import, ABOVE the settings block.
   One toolbar row, not a column of two: with the captions gone (the buttons
   name themselves) there is nothing left to stack, and a row is where a user
   looks for instant actions. The dashed edge still separates them from the
   saved preferences below — that contrast is now the whole point, since the
   heading under this row is the one that says 「点保存才生效」.
   Left-aligned, not right: 扫码登录 is the primary action and it should read
   first, in the same left-hand column as 一键签到 above and 「更多设置」 below.
   Pushed to the right edge the three buttons looked like the tail of the row
   above rather than the start of this one. */
.dsm-workbuddy-pool-tools{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:8px;border:1px dashed var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;padding:6px 10px}
/* A bar inside the toolbar is a flex item, not a full-width row: it keeps only
   its own content width, and the toolbar decides where the group sits. */
.dsm-workbuddy-pool-tools .dsm-workbuddy-bar{flex:0 1 auto;min-width:0;margin:0}
/* Status text may wrap here instead of truncating: a toolbar row is short, and
   「已导出」「等待扫码」 are the whole message — an ellipsis would eat it. */
.dsm-workbuddy-pool-tools .dsm-workbuddy-bar-status{white-space:normal}
.dsm-workbuddy-pool-set{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l1,#2c2d31)}
.dsm-workbuddy-pool-set:first-child{border-top:0}
.dsm-workbuddy-pool-set-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dsm-workbuddy-pool-set-copy b{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-set-copy span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-pool-set-ctl{flex:none;display:flex;align-items:center;gap:8px}
.dsm-workbuddy-pool-num{width:74px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;text-align:center;font-variant-numeric:tabular-nums}
.dsm-workbuddy-pool-select{max-width:260px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;cursor:pointer}
.dsm-workbuddy-pool-select:disabled,.dsm-workbuddy-pool-num:disabled{opacity:.5;cursor:default}
/* The commit row: pinned to the bottom of the viewport while the panel is on
 * screen. The panel is taller than a screen, and the two buttons that make any
 * edit real used to sit at its very bottom — off-screen at the moment the user
 * finished editing, and invisible entirely in a screenshot. Opaque, because
 * content scrolls under it. */
.dsm-workbuddy-pool-save-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px;position:sticky;bottom:0;z-index:2;padding-bottom:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-workbuddy-pool-save-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none}
.dsm-workbuddy-pool-conflict{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 13px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-pending{flex:none;align-self:center;font-size:12px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-conflict-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsm-workbuddy-pool-conflict-main b{font-size:12px;font-weight:600;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-conflict-main span{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-log{border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-workbuddy-pool-log-head{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:var(--dsw-alias-bg-layer-3,#2a2c33);border-bottom:1px solid var(--dsw-alias-border-l1,#2c2d31);font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-log-clear{padding:2px 10px;font-size:12px}
.dsm-workbuddy-pool-log-body{max-height:186px;overflow-y:auto}
.dsm-workbuddy-pool-log-row{display:flex;gap:10px;padding:7px 14px;border-top:1px solid var(--dsw-alias-border-l1,#2c2d31);font-size:12px;line-height:18px}
.dsm-workbuddy-pool-log-row:first-child{border-top:0}
.dsm-workbuddy-pool-log-time{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsm-workbuddy-pool-log-text{min-width:0;overflow-wrap:anywhere}
.dsm-workbuddy-pool-log-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-pool-log-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-log-error{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-pool-log-info{color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-log-empty{padding:14px;font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}
/* Per-row actions (test / device / remove), closing line two.
 *
 * Their third resting place. They have been (1) the row's last grid cell of the
 * old single-line table, where a separate track put them on a line of their own
 * below the credits; (2) inside the account cell, pushed right by an auto
 * margin, which on the re-grid put them at the END OF LINE ONE — before the
 * reader met the facts they act on; and now (3) the row's last cell again,
 * which with two named lines means the end of line two, right after the verdict
 * they respond to. The reading order is the point:
 * who it is → what state it is in → what you can do about it.
 *
 * BASELINE-aligned for the same reason as the check-in beside them: line two is
 * two lines tall, and a centred button group sits in the gap between the verdict
 * and the provenance line — measured, the buttons' text baseline was 8px below
 * the verdict's. Sharing that baseline makes the buttons read as the end of the
 * sentence they act on.
 *
 * The nowrap is NOT cosmetic: a two-character label (测试) belongs on one line,
 * and clipping is the right failure for a button whose label is fixed and tiny.
 * flex:none is load-bearing: the name may truncate, the buttons may not, and a
 * shrunken button is unclickable. */
.dsm-workbuddy-pool-row-actions{grid-area:actions;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center;flex:none;justify-self:end;align-self:baseline;max-width:100%}
.dsm-workbuddy-pool-row-actions .dsm-workbuddy-pool-small-btn{white-space:nowrap}
.dsm-workbuddy-pool-row-actions .dsm-workbuddy-pool-small-btn{padding:2px 10px;font-size:12px}
/* The picker's cap, narrowed on a phone. NOTE this @media measures the VIEWPORT,
   which is why it is the only rule left here that is allowed to: it exists for
   the Plugins page at phone width, where the viewport IS the constraint. The
   ROW's own narrow form is the @container block further down — a media query
   cannot express it, because inside the Settings panel the viewport is 1400px
   while the table gets 564px.
 *
 * The row's re-grid that used to live here was the source of that panel's
 * 2x2 defect: it fired at phone widths only, so the 564px column kept the
 * five-track desktop grid and clipped every cell. Removed rather than left
 * behind, because a second, half-correct narrow form is worse than none. */
@media (max-width:760px){.dsm-workbuddy-pool-select{max-width:180px}}
/* The settings rows (target model, probe size) are flex with a content column
 * that grows and a control that does not. In the Settings panel the control was
 * squeezed to a sliver: max-width:260px caps it but nothing gives it a floor,
 * and the copy beside it takes everything else. Stacking gives each one a whole
 * line, which beats two columns of clipped text.
 *
 * NOTE: this is NOT the move the pool table makes. The table is three lines at
 * every width now (see the grid above), so a narrow column no longer changes
 * its shape — only these two settings rows still switch. */
@container (max-width:620px){.dsm-workbuddy-pool-set{flex-direction:column;align-items:stretch;gap:8px}
.dsm-workbuddy-pool-set-ctl{flex:1 1 auto;justify-content:flex-start}
.dsm-workbuddy-pool-select{max-width:none;width:100%}}
/* THE ONE THING THAT STILL DEPENDS ON WIDTH — and it is a DETAIL, not a shape.
 *
 * The three-line row above is the same shape at every width, so nothing here
 * re-arranges cells any more: no second track count, no second set of occupied
 * cells, no display:none on the header. All three existed because the wide and
 * narrow forms disagreed about where a cell went; both templates now name the
 * same areas, so the labels describe the rows at every width.
 *
 * What this block DOES drop is 「测试于 11/07 17:36」, and only where it cannot
 * fit beside the verdict. Measured in headless Chrome: the longest verdict is
 * 260px and the timestamp 102px, so the verdict line needs ~380px; at the
 * Settings column's 564px the probe cell has ~330px in the Chinese table (the
 * check-in and the 160px button track take the rest). Letting the pair wrap there
 * is what turns three lines into four — the exact shape the owner rejected — and
 * the timestamp is the fragment to lose, not the verdict: the provenance line
 * directly below already dates the same measurement, as 「2 小时前」. Nothing is
 * hidden that is not said again on the next line, and the absolute moment stays
 * in the activity log the test wrote.
 *
 * ONE CASE IS STILL FOUR LINES, and it is left that way on purpose: an ENGLISH
 * enterprise row in the 564px column, whose check-in cell says 「N/A (enterprise)」
 * (~96px) while the verdict is the 301px English rate-limit sentence. The probe
 * cell then has ~262px, so the verdict wraps. The alternative — clipping the
 * verdict, or ellipsizing the check-in — trades a rare extra line for a lie about
 * whether the account works, which is the one thing this row exists to say. The
 * Chinese table in the same state fits (262px for a 260px verdict). */
@container (max-width:700px){
  .dsm-workbuddy-pool-row{column-gap:8px;row-gap:3px;padding:9px 12px}
  .dsm-workbuddy-pool-row-head{padding:7px 12px}
  .dsm-workbuddy-pool-probe-sep,.dsm-workbuddy-pool-tested-at{display:none}
}

/* ISSUE #198, the same breakpoint the pool row already uses. On a phone the model
   row's budget group takes the WHOLE line and left-aligns: right-justified, a
   wrapped two-tier group reads as a stray fragment under the buttons, and the tier
   the user is trying to find — the native window — is the last label in the group,
   so the line has to start at the left to have room to end at all. */

/* Pool switch, namespaced under .dsm-workbuddy-pool so it cannot collide with host styles. */
.dsm-workbuddy-pool .sw{position:relative;display:inline-block;width:38px;height:22px;flex:none;cursor:pointer}
.dsm-workbuddy-pool .sw input{position:absolute;opacity:0;width:0;height:0}
.dsm-workbuddy-pool .sw-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l2,#3a3d45);transition:background .18s}
.dsm-workbuddy-pool .sw-track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .18s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.dsm-workbuddy-pool .sw input:checked+.sw-track{background:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool .sw input:checked+.sw-track::after{transform:translateX(16px)}
.dsm-workbuddy-pool .sw input:disabled+.sw-track{opacity:.4}
.dsm-workbuddy-pool .sw input:disabled{cursor:default}
/* Account action bars: QR sign-in and export/import.
   One row each — live status, actions — instead of a padded block per feature.
   There is no caption: each bar holds buttons that name themselves, so a
   heading above them would repeat the button in a smaller font (「扫码添加账号」
   over 「扫码登录」). The section keeps an aria-label for the same reason a
   caption existed, so the name is still available to a screen reader.
   The bar is the resting height; only an open dialog (below) grows vertically,
   so the card does not scroll past a wall of chrome to reach the buttons.
   Status text shares the row rather than claiming its own, and is what
   truncates first when the card is narrow. */
.dsm-workbuddy-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;padding:0}
.dsm-workbuddy-bar-status{flex:1 1 auto;min-width:0;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e9ed);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-bar-hint{color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-bar-actions{display:flex;gap:8px;flex:none;margin-left:auto}
.dsm-workbuddy-bar a{color:var(--dsw-alias-brand-primary,#5686fe);text-decoration:none}
.dsm-workbuddy-bar a:hover{text-decoration:underline}
.dsm-workbuddy-bar-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-bar-error{color:var(--dsw-alias-state-error-primary,#ef4444)}
/* Secondary text inside the transfer DIALOG (not a bar): the privacy note
   shown when credentials leave the machine. Kept independent of the bar
   classes so the dialog does not depend on the bar's layout to be readable. */
/* 辅助说明文字的**唯一**入口。字号与行高必须写死在这里，不能靠继承：
   这个类同时被用在 <p> 与 <span> 上，而 <p> 在宿主里带默认段落样式，于是
   同一句说明在两处会长成两种大小（实测截图里 SDK 那两段比周围 12px 的辅助
   文字大了一圈，正是这个原因）。全仓其它 hint 类都写了 12px/18px，这里补齐。 */
.dsm-workbuddy-hint{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* The transfer dialog is deliberately a block: it holds a scrollable account
   list and per-entry checkboxes, which cannot live in a one-row bar. */
.dsm-workbuddy-transfer-dialog{margin-top:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-secondary,transparent)}
.dsm-workbuddy-transfer-dialog p{margin:0 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e9ed)}
.dsm-workbuddy-transfer-dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.dsm-workbuddy-transfer-list{list-style:none;margin:0 0 8px;padding:0;max-height:180px;overflow-y:auto}
.dsm-workbuddy-transfer-list label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary,#e8e9ed);cursor:pointer;padding:2px 0}
.dsm-workbuddy-transfer-list input[type="checkbox"]{flex:none}
.dsm-workbuddy-transfer input[type="file"]{font-size:12px;color:var(--dsw-alias-label-primary,#e8e9ed);margin-bottom:8px}
/* The import picker's input is driven by the 「import」 button, so it must not
   render as a visible field: hide it from layout AND from assistive tech (the
   button carries the accessible name). Not display:none alone — that also
   removes it from the tab order in some engines, which is fine here, but the
   clip-based form is the one that reliably keeps programmatic .click() working
   across browsers. */
.dsm-workbuddy-transfer-file{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* The sign-in URL inside the OAuth dialog: long https links must wrap rather
   than push the dialog wide — break-all, since URLs have no soft wrap points. */
.dsm-workbuddy-oauth-url{word-break:break-all;overflow-wrap:anywhere}
.dsm-workbuddy-oauth-url a{color:var(--dsw-alias-brand-primary,#5686fe);text-decoration:none}
.dsm-workbuddy-oauth-url a:hover{text-decoration:underline}
/* The shared busy veil: a fixed overlay for operations whose result only shows
   up after the list re-read (remove / import / sign-in).
   It is NOT a modal: no control, no dismissal — only "this is running" and
   "here is why nothing moved yet". Fixed positioning so it covers the card
   regardless of which section started the operation, and a semi-transparent
   backdrop so the table stays visible underneath — the user is watching a
   specific row change, and hiding it would defeat the point.

   The mask and the card surface are the HOST's own tokens, not this file's
   invention. --dsw-alias-bg-mask-1 + --dsw-mask-blur is exactly what the
   host's own overlays use (see dsh-client-ui-settings-general's Dws9Sa_mask),
   so the veil now dims the way every other overlay in the shell does instead
   of laying its own black wash on top. The previous hardcoded rgba(0,0,0,.38)
   was tuned against neither theme: too weak next to the host's .24 mask in
   light mode, and it ignored the host's blur entirely.

   bg-layer-2 (not bg-primary, which does not exist in the host's token set
   at all and therefore always fell through to this file's near-black #1b1c20)
   is the same surface the host puts behind its panels — that near-black fallback
   is what made the veil read as a black slab with unreadable text on it. */
.dsm-workbuddy-veil{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32));backdrop-filter:var(--dsw-mask-blur);cursor:progress}
/* --dsw-elevation-prominent is the host's own panel shadow (a hairline stroke
   plus two soft layers); the previous 0 8px 28px rgba(0,0,0,.35) was a
   hand-rolled drop shadow that read as a heavy grey box. */
.dsm-workbuddy-veil-card{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(340px,80vw);padding:16px 20px;border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 8px 28px rgba(0,0,0,.35))}
.dsm-workbuddy-veil-text{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115);text-align:center}
/* label-secondary, not label-tertiary: this line carries the operation's
   detail and must stay legible. tertiary is the host's dimmest tier
   (neutral-bluish-600 on light, neutral-bluish-400 on dark) and is meant
   for metadata, not for a sentence the user has to read while waiting. */
.dsm-workbuddy-veil-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);text-align:center}
/* The spinner proves the UI is alive when the row under it has not changed yet
   — which is precisely the confusion the veil exists to remove. It follows the
   host's own state spinner (dsh's _dsh-state-dot-spin): an SVG arc whose
   dash breathes while it turns, currentColor so it inherits the tier it sits
   in, and the same 1.5s beat. The previous 18px border-ring at .7s was roughly
   twice the host's speed and visibly out of step with every other spinner in
   the shell — that mismatch, more than the shape itself, is what made it look
   cheap.

   Reduced-motion users get the static arc rather than a frozen ring, matching
   how the host degrades its own spinner. */
.dsm-workbuddy-veil-spinner{width:20px;height:20px;color:var(--dsw-alias-label-secondary,#61666b);animation:dsm-workbuddy-veil-spin 1.5s linear infinite}
.dsm-workbuddy-veil-spinner-track{opacity:.25}
.dsm-workbuddy-veil-spinner-arc{stroke-dasharray:12 150;animation:dsm-workbuddy-veil-dash 1.5s ease-in-out infinite}
@keyframes dsm-workbuddy-veil-spin{to{transform:rotate(360deg)}}
@keyframes dsm-workbuddy-veil-dash{0%{stroke-dasharray:12 150;stroke-dashoffset:0}50%{stroke-dasharray:24 150;stroke-dashoffset:-6}to{stroke-dasharray:12 150;stroke-dashoffset:0}}
@media (prefers-reduced-motion: reduce){.dsm-workbuddy-veil-spinner{animation:none}.dsm-workbuddy-veil-spinner-arc{animation:none;stroke-dasharray:18 150;stroke-dashoffset:-3}}
.dsm-workbuddy-page{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;gap:20px;padding:28px clamp(24px,4vw,48px) 48px;overflow:auto;color:var(--dsw-alias-label-primary,#e6e6e6)}
/* 1120px, not 860: the page is the WIDE layout — that is the whole reason the
 * sidebar row and the readout's button exist — so capping it at 860 left a third
 * of a 1440px window empty while the table inside still had five columns to
 * place. The cap still matters: past ~1120 a five-column row of short figures
 * starts to read as scattered, and a line of prose runs longer than the eye
 * likes to track. */
.dsm-workbuddy-page>*{width:100%;max-width:1120px}
.dsm-workbuddy-page-head{display:flex;flex-direction:column;gap:6px}
.dsm-workbuddy-page-back{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-1,#17181b);color:var(--dsw-alias-label-secondary,#c7c7c7);border-radius:8px;padding:5px 12px;display:inline-flex;align-items:center;gap:6px;align-self:flex-start;font-size:13px;line-height:20px}
.dsm-workbuddy-page-back:hover{color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-page-back svg{flex:none}
.dsm-workbuddy-page-icon{width:40px;height:40px;border-radius:9px;align-self:flex-start;margin-top:14px}
.dsm-workbuddy-page-title{margin:0;font-size:20px;font-weight:600;line-height:1.4}
.dsm-workbuddy-page-desc{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-page-body .dsm-workbuddy-usage{--dsm-workbuddy-surface:var(--dsw-alias-bg-layer-3,#202126);padding:20px 20px 8px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px}
/* ---- 设置面板里的一节（settings.section，5.19.0）------------------------
   面板内容列本来就窄（800px 面板减 188px 导航），而且它自己滚动。所以这一页
   不去抢整页的高度与居中：height:100% 会在列里撑出第二根滚动条，860px 的
   居中上限又会让内容缩在左边。改成从上往下排、宽度交给列，只有内边距是本插件
   自己的；卡片边框也去掉——它现在是页面内容，不再是别人列表里的一行。 */
.dsm-workbuddy-settings{height:auto;min-height:0;padding:0;gap:14px;overflow:visible}

.dsm-workbuddy-settings>*{max-width:none}
/* 顶部那块自报家门：图标与标题同排，简介独占一行。面板已有一层标题栏，这里
   不再叠一个大标题，只把"这是什么"说清楚。 */
.dsm-workbuddy-settings .dsm-workbuddy-settings-head{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;row-gap:2px;align-items:center}
.dsm-workbuddy-settings .dsm-workbuddy-page-icon{width:28px;height:28px;border-radius:6px;margin-top:0;grid-row:1}
.dsm-workbuddy-settings .dsm-workbuddy-page-title{font-size:15px;line-height:22px;grid-row:1;min-width:0}
.dsm-workbuddy-settings .dsm-workbuddy-page-desc{grid-column:1/-1;font-size:12px;line-height:18px}
/* 内容块不再是一张浮在页面上的卡：去掉边框与底色，内边距改成横向对齐列边。
 *
 * 但那是「外壳那一列是实底色」时的结论。issue #209：换上个性化壁纸后，外壳的列
 * 是半透明的，这一页自己又没有任何底色，于是壁纸整片透过内容区——标题、说明段落、
 * 标签栏、账号池 全部直接压在壁纸上。这台机器上其余内容块各自有实底
 * （表格、设置组），唯独它们之间的留白与正文没有，所以只有「什么都没有」的地方在
 * 透。修复是给内容区自己一层底，取外壳的 layer 色；实底主题上与原来看不出差别。 */
/* 页头那两行（标题、一句简介）在内容区外面，壁纸下同样没有承托。
 *
 * 补一块底而不是把它并进内容区：面板自己已经有一层标题栏，页头与正文之间要
 * 留出间隔，两块底拼成一片会让页头看起来属于正文。取同一个 layer 色，实底主题
 * 上与原来看不出差别。
 *
 * 这一条同时作用于整页（侧边栏入口那个宽页面），它同样没有底色。 */
.dsm-workbuddy-settings .dsm-workbuddy-settings-head,
.dsm-workbuddy-page .dsm-workbuddy-page-head{background:var(--dsw-alias-bg-layer-1,#17181b);border-radius:12px;padding:10px 12px}
/* 这一页的内容区不能有内边距，否则底色会缩进一截，与页头对不齐。 */
.dsm-workbuddy-settings .dsm-workbuddy-page-body .dsm-workbuddy-usage{--dsm-workbuddy-surface:var(--dsw-alias-bg-layer-1,#17181b);padding:0;border:0;border-radius:0;background:var(--dsw-alias-bg-layer-1,#17181b)}.dsm-workbuddy-panel-icon{display:block;border-radius:4px;flex:none}
/* ---- 设备头档位与逐账号参数弹窗 ------------------------------------------
   档位那一行贴着账号表：它同时决定"这台机器对外声称自己是谁"和"每行的齿轮能
   不能用"，埋进「更多设置」会让齿轮看起来时好时坏。
   弹窗用 fixed 遮罩而不是行内展开：每行已经有两个按钮和一段探针文本，再展开
   两块输入框会把表格挤成表单；而且这些值必须显式确认，误点不该直接生效。 */
.dsm-workbuddy-device-mode{
  display:flex;flex-wrap:wrap;align-items:center;gap:8px;
  margin:10px 0 2px;
}
.dsm-workbuddy-device-mode-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e9ed)}
.dsm-workbuddy-device-mode-seg{
  display:inline-flex;border:1px solid var(--dsw-alias-border-l2,#3a3d45);
  border-radius:999px;overflow:hidden;
}
/* 分段控件：两个按钮共享一条边框，选中态用底色而不是描边——描边会让"选中"
   与"聚焦"看起来一样，键盘操作时分不清光标在哪。 */
.dsm-workbuddy-device-seg-btn{
  appearance:none;border:0;background:transparent;cursor:pointer;
  padding:2px 10px;font:inherit;font-size:12px;line-height:20px;
  color:var(--dsw-alias-label-secondary,#b8bcc4);
}
/* 悬停必须排除选中项：btn:hover 的选择器权重比 .seg-on 高，不排除的话鼠标
   一划过去，选中的那一格就会被换成半透明底，看起来像"选中被取消了"。 */
.dsm-workbuddy-device-seg-btn:hover:not(:disabled):not(.dsm-workbuddy-device-seg-on){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsm-workbuddy-device-seg-btn:disabled{opacity:.55;cursor:default}
/* 选中态用"前景色做底、底色做字"这一对，而不是品牌色底 + 白字。
   原因写在截图里：暗色主题下 --dsw-alias-brand-primary 本身就是一枚浅色，
   白字落上去等于整格消失（用户看到的是一个空白胶囊）。把两者绑成反相关系后，
   亮色主题是深底浅字、暗色主题是浅底深字，任何主题都不可能出现同色叠同色——
   因为这两个变量按定义就互为背景与文字。 */
.dsm-workbuddy-device-seg-on{
  background:var(--dsw-alias-label-primary,#ededed);
  color:var(--dsw-alias-bg-base,#181818);
  font-weight:600;
}
/* 兜底：万一宿主没注入 bg-base，回落值也得跟着主题走，否则亮色主题下会变成
   "深底 + 深字"。变量在的时候这一段不生效。 */
@media (prefers-color-scheme: light){
  .dsm-workbuddy-device-seg-on{background:var(--dsw-alias-label-primary,#202020);color:var(--dsw-alias-bg-base,#fff)}
}
/* 齿轮：置灰只表达"现在用不了"，仍然可点——点了会说明原因。 */
.dsm-workbuddy-device-gear{line-height:1;padding:0 6px}
.dsm-workbuddy-device-gear-off{opacity:.45}
.dsm-workbuddy-device-backdrop{
  position:fixed;inset:0;z-index:70;
  display:flex;align-items:center;justify-content:center;
  padding:16px;
  background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32));
  backdrop-filter:var(--dsw-mask-blur);
}
.dsm-workbuddy-device-dialog{
  width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;
  padding:16px;
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;
  background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-l1,#1b1d23));
  color:var(--dsw-alias-label-primary,#e8e9ed);
  box-shadow:0 12px 40px rgba(0,0,0,.35);
}
.dsm-workbuddy-device-title{margin:0 0 8px;font-size:13px;font-weight:600}
.dsm-workbuddy-device-field{display:flex;flex-direction:column;gap:4px;margin:10px 0}
.dsm-workbuddy-device-field-label{font-size:12px;color:var(--dsw-alias-label-secondary,#b8bcc4)}
.dsm-workbuddy-device-input{
  font:inherit;font-size:12px;line-height:20px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  padding:4px 8px;border-radius:6px;
  color:var(--dsw-alias-label-primary,#e8e9ed);
  background:var(--dsw-alias-bg-l1,transparent);
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);
}

/* SDK 目录输入行（作者意见 #1）：输入框吃掉剩余宽度，按钮不换行。
   与 .dsm-workbuddy-device-input 同一套外观，只改布局——单独一条而不是复用
   弹窗那条，是因为这里旁边还有 1~2 个按钮，而弹窗里是上下堆叠。 */
.dsm-workbuddy-sdk-dir-row{display:flex;align-items:center;gap:8px;margin:2px 0 4px}
.dsm-workbuddy-sdk-dir-input{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
/* 回退开关：勾选框交回平台（accent-color），方框尺寸/圆角/勾形不由我们画。 */
.dsm-workbuddy-sdk-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary,#e8e9ed);cursor:pointer}
.dsm-workbuddy-sdk-switch input{accent-color:var(--dsw-alias-brand-primary,#5686fe)}
/* 总开关区块：它在面板最上面，与下面那组诊断之间要有一道肉眼可见的分界——
   否则"关掉它"和"看它现在的状态"会被读成同一件事。 */
.dsm-workbuddy-sdk-master{
  display:flex;flex-direction:column;gap:4px;
  margin:0 0 10px;padding:10px 12px;
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;
  background:var(--dsw-alias-bg-layer-2,#232529);
}
.dsm-workbuddy-sdk-master .dsm-workbuddy-hint{margin:0}
/* 关掉时整块诊断降饱和度：它仍然是事实（"现在没在跑"），但不再是当前动作的重点。 */
.dsm-workbuddy-sdk-master-off + .dsm-workbuddy-panel-note{opacity:.75}
.dsm-workbuddy-device-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-device-input-bad{border-color:var(--dsw-alias-label-error,#e5534b)}
.dsm-workbuddy-device-error{color:var(--dsw-alias-label-error,#e5534b);font-size:12px;margin:4px 0 0}
.dsm-workbuddy-device-random-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 12px}
/* P3 的占位行：虚线边框 + 降低对比度，读起来是"位置已经留好，还没接线"。
   标题用 label-primary 而不是 label-dimmed：它是这一段的主语（"真实设备
   Token"），dimmed 在亮色主题下几乎和背景同色，在暗色主题下又只剩一层灰雾。
   虚线边框已经表达了"占位"，不需要再靠文字颜色降级。 */
.dsm-workbuddy-device-p3{
  display:flex;flex-direction:column;gap:2px;margin:0 0 12px;padding:8px 10px;
  border:1px dashed var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;
}
.dsm-workbuddy-device-p3-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e9ed)}
.dsm-workbuddy-device-p3 .dsm-workbuddy-hint{color:var(--dsw-alias-label-secondary,#b8bcc4)}
/* 自动派生值：只在对应输入框为空时出现，所以它承担的是"你留空会发生什么"这个
   答案，必须能被复制走。等宽 + 可整段选中最省事（user-select:all 一次点击就
   选中整串 36 位 id，比再放一个复制按钮少一次交互，也不用管剪贴板权限）。 */
.dsm-workbuddy-device-derived{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;
  font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary,#b8bcc4);
}
.dsm-workbuddy-device-derived code{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-primary,#e8e9ed);
  word-break:break-all;user-select:all;
}
.dsm-workbuddy-device-derived-missing{color:var(--dsw-alias-label-secondary,#b8bcc4);font-size:11px}
.dsm-workbuddy-device-dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}

/* ---- 「SDK」分区：连接状态与真实取值 --------------------------------------
   状态点用 6px 圆点而不是图标：这一行已经有文字说清楚状态，圆点只负责"一眼"。
   token 块必须能换行——真实 token 一千多字符，不换行会把面板撑出一条横向滚动，
   而横向滚动条会让"复制"按钮跑出视口。 */
.dsm-workbuddy-sdk-dot{
  display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;
  background:var(--dsw-alias-label-error,#e5534b);vertical-align:middle;
}
.dsm-workbuddy-sdk-dot-ok{background:var(--dsw-alias-label-success,#3fb950)}
.dsm-workbuddy-sdk-value{
  display:block;max-height:96px;overflow:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:16px;
  word-break:break-all;white-space:pre-wrap;
  padding:4px 8px;border-radius:6px;
  color:var(--dsw-alias-label-primary,#e8e9ed);
  background:var(--dsw-alias-bg-l1,transparent);
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);
}

` + seriesLayoutCss("workbuddy");
		/**
		* Composer credit readout styles, injected by the readout component itself.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 该项目的 COMPOSER_POINTS_CSS，类名改为 dsm-workbuddy-*，
		*     其余（尺寸、节奏、主题变量与回退值、表格对齐）逐条沿用。
		*
		* Separate from the card bundle because the readout lives in the session's
		* composer, not inside the plugin card; a card that is closed still shows this,
		* and on some hosts the card is never mounted at all.
		*/
		const WORKBUDDY_COMPOSER_CSS = `
/* The readout is plain composer text — no border, no fill at rest. The padding
   is only the click target, invisible until the pointer arrives. */
.dsm-workbuddy-composer-credits{display:inline-flex;align-items:center;min-width:0}
.dsm-workbuddy-composer-credits-trigger{
  appearance:none;display:inline-flex;align-items:center;align-self:stretch;
  padding:2px 6px;border:0;border-radius:6px;background:transparent;
  /* EXPLICIT, not inherit. The composer row's own font and body colour are
     noticeably larger and darker than the neighbouring controls — a credit
     readout is secondary information and must not shout. 12px matches this
     plugin's original line; label-tertiary matches the shell's own composer-row
     control (ContextMeter), which is the sibling this reads alongside. */
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary,#999);
  white-space:nowrap;cursor:pointer;
  font-variant-numeric:tabular-nums;
}
.dsm-workbuddy-composer-credits-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-workbuddy-composer-credits-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
/* The new-model marker ("· 2 新模型") is its OWN button, a sibling of the credit
   trigger inside the same pill — not text bolted into it, so the row is not one
   giant click target and a screen reader can take a user straight to "which
   models". MUTED on purpose, and muted FURTHER than the figure: the credits are
   what this pill exists to show, and the marker only qualifies them, so
   "2 新模型" must never out-shout "143 积分". label-dimmed sits a step below the
   trigger's own label-tertiary for exactly that reason. */
.dsm-workbuddy-composer-credits-new{
  appearance:none;display:inline-flex;align-items:center;align-self:stretch;
  padding:2px 6px;border:0;border-radius:6px;background:transparent;
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6));
  white-space:nowrap;cursor:pointer;font-variant-numeric:tabular-nums
}
.dsm-workbuddy-composer-credits-new:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-workbuddy-composer-credits-new:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
/* The panel is portaled to document.body and positioned from the trigger, so it
   MUST be fixed — otherwise the left/top it measures are ignored and it lands in
   document flow. All material comes from shell tokens so it follows the theme. */
.dsm-workbuddy-composer-panel{
  position:fixed;z-index:1100;box-sizing:border-box;
  width:min(248px,calc(100vw - 24px));padding:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  border-radius:var(--dsw-radius-lg,14px);
  background:var(--dsw-specific-menu,Canvas);
  box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.22));
  backdrop-filter:var(--dsw-menu-backdrop-filter,none);
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#444);
}
.dsm-workbuddy-composer-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
/* nowrap: the header is a title plus an 11px control in a ~250px popover, and
   without it the TITLE broke across two lines ("WB AI" / "积分") the moment the
   settings control joined the row — measured on the live Desktop host. The
   title is the one thing that must stay on one line; what follows it is short by
   construction. */
.dsm-workbuddy-composer-panel-title{flex:none;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText)}
/* The header's TEST control, left of settings.
   A quiet pill like its neighbour, but WITHOUT the brand fill: re-testing is a
   local, repeatable action on the table right below it, while the settings pill
   is the one control that leaves the panel. Two equally loud pills would make
   the header read as a toolbar; this one stays a step quieter and earns its
   colour only on hover. */
.dsm-workbuddy-composer-panel-refresh{
  appearance:none;flex:none;
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 8px 3px 6px;margin-right:6px;
  border:1px solid transparent;border-radius:999px;
  background:transparent;
  color:var(--dsw-alias-label-secondary,#444);
  font:inherit;font-size:11px;line-height:16px;font-weight:500;
  cursor:pointer;
  transition:background-color .12s ease,border-color .12s ease,color .12s ease;
}
.dsm-workbuddy-composer-panel-refresh:hover:not(:disabled){
  background:rgba(127,127,127,.10);
  border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.34));
  color:var(--dsw-alias-label-primary,CanvasText);
}
.dsm-workbuddy-composer-panel-refresh:active:not(:disabled){background:rgba(127,127,127,.16)}
.dsm-workbuddy-composer-panel-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
/* A running batch keeps the label readable but stops the hover: the button is
   disabled, and a disabled control that still lights up on hover invites a
   second press that will be ignored. */
.dsm-workbuddy-composer-panel-refresh:disabled{cursor:default;opacity:.6}
/* The circular arrow does not shrink (a flex item defaults to it) and never
   wraps away from the label. */
.dsm-workbuddy-composer-panel-refresh-icon{flex:none;display:block}
/* While the batch runs the arrow TURNS. A disabled button with a static icon
   reads as broken, and a serial batch is long enough that "did my press land?"
   is a real question. One turn per 900ms: fast enough to read as motion, slow
   enough not to look like a rendering fault. */
.dsm-workbuddy-composer-panel-refresh-icon-spin{animation:dsm-workbuddy-panel-refresh-spin .9s linear infinite}
@keyframes dsm-workbuddy-panel-refresh-spin{to{transform:rotate(360deg)}}
.dsm-workbuddy-composer-panel-refresh-label{flex:none;white-space:nowrap}
/* The spinner is the ONLY indication the batch is alive, so under reduced
   motion it must not disappear: the animation is dropped and the icon keeps a
   distinct look (dimmed) plus the label says 「正在测试…」. */
@media (prefers-reduced-motion:reduce){
  .dsm-workbuddy-composer-panel-refresh{transition:none}
  .dsm-workbuddy-composer-panel-refresh-icon-spin{animation:none;opacity:.55}
}

/* The header's right-hand control: the link to this plugin's settings.
   A wrapper rather than an auto margin on the button, because the button is NOT
   always rendered (a host with no route renders none) and a wrapper that is
   always present keeps the header layout identical either way. */
.dsm-workbuddy-composer-panel-actions{flex:none;margin-left:auto;display:flex;align-items:center}
/* The header holds ONE control (refresh) now that the settings page lives in
   the Settings panel: the gear pill that navigated to the Plugins page retired
   with the page it pointed at. margin-left:auto on the wrapper keeps the
   control pinned right regardless of how many buttons the actions row holds. */
/* The header's right-hand control: the link to this plugin's settings.
   A wrapper rather than an auto margin on the button, because the button is NOT
   always rendered (a host with no route renders none) and a wrapper that is
   always present keeps the header layout identical either way. */
.dsm-workbuddy-composer-panel-actions{flex:none;margin-left:auto;display:flex;align-items:center}
/* Styled as a quiet text link rather than a bordered button: navigating away is
   not the header's primary action, and a loud button beside a 13px title reads as
   a toolbar. The border appears only on hover/focus, which is where the
   affordance is needed. */
/* A quiet PILL, not an underlined link. The underline made a one-word label
   read as body text that happened to be clickable — in a 13px header the eye
   does not register it as a control at all. The tinted fill plus the gear give
   it a shape at rest, which is where the affordance is actually needed; the
   underline only appeared on hover, i.e. after the user already knew.
   The fill is the brand colour at 10%, so it reads as "secondary action in this
   product" rather than as a fourth grey chip beside the title. */
.dsm-workbuddy-composer-panel-settings{
  appearance:none;flex:none;
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 8px 3px 6px;
  border:1px solid transparent;border-radius:999px;
  background:rgba(86,134,254,.10);
  color:var(--dsw-alias-brand-primary,#5686fe);
  font:inherit;font-size:11px;line-height:16px;font-weight:500;
  cursor:pointer;
  transition:background-color .12s ease,border-color .12s ease,color .12s ease;
}
.dsm-workbuddy-composer-panel-settings:hover{
  background:rgba(86,134,254,.18);
  border-color:rgba(86,134,254,.34);
  color:var(--dsw-alias-brand-primary,#5686fe);
}
.dsm-workbuddy-composer-panel-settings:active{background:rgba(86,134,254,.26)}
.dsm-workbuddy-composer-panel-settings:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
/* The gear does not shrink when the label is a longer word ("Settings" vs
   "设置"): a flex item defaults to shrinking, which would squash the icon into
   an oval on a narrow popover. */
.dsm-workbuddy-composer-panel-settings-icon{flex:none;display:block}
/* The label never wraps. Two lines in a 16px-tall pill would push the header
   taller and unstick the table below it. */
.dsm-workbuddy-composer-panel-settings-label{flex:none;white-space:nowrap}
/* Reduced motion: the colour transition is decoration, and the hover state is
   still fully visible without it. */
@media (prefers-reduced-motion:reduce){
  .dsm-workbuddy-composer-panel-settings{transition:none}
}
/* The panel is a TABLE: one row per account in the region, one figure (the
   general balance) per row, and a row click switches accounts.

   Rhythm is deliberate: the header sits on a hairline, the switch button owns
   ALL horizontal padding (and pulls back by the same amount so its label lines
   up with the header), and every row is the same height. A misaligned first
   column is what makes a two-column popover read as broken. */
.dsm-workbuddy-composer-panel-table{
  width:100%;border-collapse:collapse;
  font-size:12px;line-height:18px;
}
.dsm-workbuddy-composer-panel-table thead th{
  padding:0 0 7px;font-weight:500;text-align:left;font-size:11px;
  color:var(--dsw-alias-label-tertiary,GrayText);
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
}
.dsm-workbuddy-composer-panel-num{
  text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;
}
.dsm-workbuddy-composer-panel-table thead th.dsm-workbuddy-composer-panel-num{padding-right:0}
.dsm-workbuddy-composer-panel-table tbody th{
  padding:0;font-weight:400;text-align:left;vertical-align:middle;
}
.dsm-workbuddy-composer-panel-table tbody td{
  padding:4px 0;vertical-align:middle;
  color:var(--dsw-alias-label-primary,CanvasText);
}
/* The current account reads as current without shouting: a filled dot and a
   slightly heavier weight. Disabled — pressing it would write a selection that
   has not changed. */
.dsm-workbuddy-composer-panel-table tbody tr.dsm-workbuddy-composer-panel-row-current td{font-weight:600}
.dsm-workbuddy-composer-panel-switch{
  appearance:none;display:flex;align-items:center;gap:7px;
  width:100%;padding:4px 6px;margin-left:-6px;
  border:0;border-radius:6px;background:transparent;
  color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;
  white-space:nowrap;overflow:hidden;
}
.dsm-workbuddy-composer-panel-switch>span:last-child{overflow:hidden;text-overflow:ellipsis}
/* The name + optional reason mark. A COLUMN so the mark drops onto its own line
   under the name: side by side they would stretch the name column and squeeze
   the numeric one, and the switch's own overflow rule would ellipsise the mark
   instead of the name. */
.dsm-workbuddy-composer-panel-who{display:flex;flex-direction:column;min-width:0;gap:1px}
.dsm-workbuddy-composer-panel-name{overflow:hidden;text-overflow:ellipsis}
/* The second line under the name: TWO facts, two tones.
   .dsm-workbuddy-composer-panel-mark-current -- "当前选用", green: it says which
     account is serving this tab, which is not a problem and must not be painted
     like one. The owner asked for exactly this ("框出来的，当前选用用绿色的字").
   .dsm-workbuddy-composer-panel-mark-reason -- why it cannot serve ("被限流"),
     in the warn colour the pool table uses for the same fact, so one
     measurement reads the same on both surfaces.
   The two are siblings in a flex line and the separator between them is drawn
   here, not in the text: rendered text stays exactly "当前选用 · 被限流 · 约 6
   小时后" for anything that reads the DOM as a string. */
.dsm-workbuddy-composer-panel-mark{
  display:flex;flex-wrap:wrap;align-items:baseline;
  font-size:11px;line-height:15px;
  /* WRAP, do not clip (issue #108). The switch above sets white-space:nowrap
     and overflow:hidden for the NAME, which must stay on one line and ellipsise.
     Inherited here, those two rules cut the reason mark mid-sentence with no
     ellipsis at all — the reporter saw "…不是这个账号—" and read it as broken
     rendering, because a hard cut carries no signal that more exists. The mark
     is the one part of this row whose length is NOT under the layout's control
     (it is a translated sentence, and the two locales differ by 2x), so it
     wraps instead: an extra line is a legible outcome, a severed stroke is not.
     overflow-wrap:anywhere because Chinese has no spaces to break at. */
  white-space:normal;
  overflow-wrap:anywhere;
}
.dsm-workbuddy-composer-panel-mark-current{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-composer-panel-mark-reason{color:var(--dsw-alias-state-warn-primary,#f59e0b);min-width:0}
.dsm-workbuddy-composer-panel-mark-current+.dsm-workbuddy-composer-panel-mark-reason::before{
  content:" · ";color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6));
}
/* Hover belongs to the switch, not the row: the number cell is not clickable,
   so lighting it up would promise an action it cannot perform. */
.dsm-workbuddy-composer-panel-switch:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
}
.dsm-workbuddy-composer-panel-switch:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-1px;
}
.dsm-workbuddy-composer-panel-switch:disabled{cursor:default}
.dsm-workbuddy-composer-panel-dot{
  flex:none;width:7px;height:7px;border-radius:50%;
  background:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5));
}
/* Availability, matching the pool table's dot EXACTLY (see
   account-state.ts, stateTone, which is the one place the rule lives).
   Three states, and colour answers only the first question: can this account
   serve the next message? The second question -- which account is serving this
   tab -- is answered in words on the row ("current"), so the colour is free to
   stay honest about usability. Green for usable (selected or not), red for a
   refusal of any kind (a stated rate limit included: amber used to sit here and
   read as "mostly fine"), and the neutral grey above for an account nobody has
   measured yet, which is neither.
   NOTE: no backticks in this comment. The whole stylesheet is a template
   literal, and a stray backtick silently closes it (the file then fails to
   parse with a misleading "Expected a semicolon"). */
.dsm-workbuddy-composer-panel-dot-ok{background:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-composer-panel-dot-error{background:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-composer-panel-dot-unknown{background:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}
/* The new-model readout BELOW the foot hairline: the label ("本机首次见到的模型")
   in the footnote tone and the names in the body tone, so it reads as a note and
   never as a fourth column of the table above. Sits AFTER the foot because the
   foot's hairline is the one separator between the table and this block — two
   hairlines back to back would look like a rendering fault.
   The names WRAP rather than ellipsise (overflow-wrap:anywhere): Chinese has no
   spaces to break at, and a hard cut carries no signal that more exists. */
.dsm-workbuddy-composer-panel-new{margin-top:9px}
.dsm-workbuddy-composer-panel-new-row{margin:0;font-size:11px;line-height:16px}
/* The row is FOCUSED (not just scrolled) when the "· N 新模型" button opened the
   panel, so a screen reader lands on it; the component keeps it out of the tab
   order with tabIndex={-1}, hence outline:none here. The highlight is a
   barely-there tint: the row has to be findable, not loud — this is a footnote,
   not a notification, and the credits table above is the thing to read first. */
.dsm-workbuddy-composer-panel-new-row-revealed{outline:none;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-workbuddy-composer-panel-new-label{color:var(--dsw-alias-label-tertiary,GrayText)}
.dsm-workbuddy-composer-panel-new-list{color:var(--dsw-alias-label-secondary,#444);overflow-wrap:anywhere}
/* One class for BOTH footnotes: the definition of "new", and the version note
   when the on-disk history was written by a newer build. They are the same
   KIND of sentence — "what a word means here" — and two classes would let the
   two drift apart in size or tone. */
.dsm-workbuddy-composer-panel-note{
  margin:5px 0 0;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,GrayText);overflow-wrap:anywhere;
}
.dsm-workbuddy-composer-panel-foot{
  display:flex;justify-content:space-between;gap:8px;
  margin-top:9px;padding-top:7px;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,GrayText);
}
.dsm-workbuddy-composer-panel-empty{margin:0;color:var(--dsw-alias-label-tertiary,GrayText)}
.dsm-workbuddy-composer-panel-error{margin:8px 0 0;color:var(--dsw-alias-state-error-primary,#d92d20);font-size:11px;line-height:16px}

/* The CLI live pill shares the composer dock row with the credit readout above
   and the shell's own ContextMeter, so it takes ITS metrics from the same place
   the credit trigger does: 12px/18px, label-tertiary, tabular numerals. Rendered
   with inline styles it inherited the dock's body font and read as stray text
   sitting next to two native-looking controls. */
.dsm-workbuddy-cli-live{
  display:inline-flex;align-items:center;gap:6px;
  padding:2px 6px;border-radius:6px;
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary,#999);
  white-space:nowrap;font-variant-numeric:tabular-nums;
}
/* A quiet pulse is the whole signal that the turn is still moving: the label's
   second counter also advances, but at one tick a second it is easy to miss. */
.dsm-workbuddy-cli-live-dot{
  width:6px;height:6px;border-radius:50%;flex:0 0 auto;
  background:var(--dsw-alias-brand-primary,#5686fe);
  animation:dsm-workbuddy-cli-live-pulse 1.6s ease-in-out infinite;
}
@keyframes dsm-workbuddy-cli-live-pulse{0%,100%{opacity:.3}50%{opacity:1}}
/* Respect the OS setting: a blinking dot is decoration, the numbers are the
   information, and they keep updating with the animation off. */
@media (prefers-reduced-motion:reduce){
  .dsm-workbuddy-cli-live-dot{animation:none;opacity:.8}
}
`;
		//#endregion
		//#region src/client/searched-paths.ts
		/**
		* Reasons that explain a failure, as opposed to merely recording an absence.
		*
		* `missing` is the normal state of most candidates on any machine — the app
		* writes one file while the platform offers several possible directories — so
		* it is the one reason that gets hidden by default. Everything else is a real
		* finding: the file is there and unreadable, present but not a credential, or
		* present and encrypted without a key.
		*
		* `encrypted` is WorkBuddy-specific and the most important of the three: the
		* user is very likely signed in already, and the plugin simply cannot open the
		* token fields without the desktop app present. "Sign in again" is the one
		* action that cannot help, so this reason must never be hidden behind a toggle.
		*
		* `wrong-region` is equally a finding and equally actionable: the sign-in is
		* real and readable, it just belongs to the other tab. That is why it must be
		* shown up front — hidden among the absences it would look like "nothing here",
		* when it is in fact the whole explanation, and the cheapest possible fix.
		*/
		const INTERESTING_REASONS = [
			"encrypted",
			"invalid",
			"unreadable",
			"wrong-region"
		];
		/**
		* Partition one region's probe failures for display.
		*
		* Order within each group is preserved from the Host: the store reports
		* candidates in probe order, which is meaningful (the live file before its
		* timestamped backups).
		*
		* There is deliberately no `encrypted` flag here. There used to be, for a
		* notice rendered inside the list; that notice is gone because
		* {@link signedOutNotice} now answers the encrypted cause in the paragraph, so
		* the flag would have had no consumer — and a derived field kept "just in
		* case" is how the list and the paragraph drift apart again.
		*/
		function searchedView(items) {
			const interesting = items.filter((item) => INTERESTING_REASONS.includes(item.reason));
			return {
				interesting,
				missing: items.filter((item) => !INTERESTING_REASONS.includes(item.reason)),
				missingOpen: interesting.length === 0,
				total: items.length
			};
		}
		/** Every reason's locale key, so no reason can silently fall through to a wrong one. */
		const REASON_KEYS = {
			missing: "row.reasonMissing",
			unreadable: "row.reasonUnreadable",
			invalid: "row.reasonInvalid",
			encrypted: "row.reasonEncrypted",
			"wrong-region": "row.reasonWrongRegion"
		};
		/** The reason's short label; `missing`/`unreadable`/`invalid`/`encrypted`/`wrong-region`. */
		function searchReasonKey(reason) {
			return REASON_KEYS[reason] ?? "row.reasonInvalid";
		}
		/**
		* One entry's cause line: which store the path belongs to, and why it failed.
		*
		* The source matters because the two are fixed differently — a desktop-app path
		* is about the app's installation and sign-in, a plugin-owned copy is about the
		* plugin's own storage.
		*/
		function searchReasonLabel(item, t) {
			return `${t(item.source === "desktop" ? "row.sourceDesktop" : "row.sourceDsh")} · ${t(searchReasonKey(item.reason))}`;
		}
		/**
		* Choose the signed-out paragraph's copy.
		*
		* This exists because the card was saying the same thing twice. `resolve()`
		* refuses with a message that already ENUMERATES every path it tried
		* (`expected <Local>\workbuddy-desktop.info or <Roaming>\... or
		* WORKBUDDY_AUTH_FILE`), and the probed-path `<details>` right below it listed
		* those same paths with a per-entry reason. Both hint keys also opened with a
		* variant of "no sign-in was found", so one screen carried four statements of
		* one fact and the user's eye had nowhere to land.
		*
		* The rule: the paragraph states the situation, the list supplies the detail.
		* Whenever a list is rendered, the enumeration in `message` is redundant by
		* construction — the list is the same paths, with strictly better reasons — so
		* the paragraph falls back to the concise hint. Measured against the real
		* `resolve()` branches, the only content this drops is "or refresh an existing
		* session", which is vacuous exactly here: `searched` is attached only when
		* there are zero accounts, so there is no session to refresh.
		*
		* `selectionLost` still wins outright: there the tokens are healthy and the
		* advice is to re-pick an account, which no path list can replace.
		*
		* `encrypted` also outranks the generic hint, and for the same reason
		* `wrong-region` does: the generic copy tells the user to sign in again, which
		* is precisely the action that cannot work when the credential exists but is
		* encrypted. Leaving it in the collapsed list meant the headline contradicted
		* the detail below it — and the headline is the only part most users read.
		*
		* `encrypted` outranks `wrong-region` as well, which is a change (issue #68):
		* the two are not alternatives, they co-occur, and when they do the unreadable
		* key is the blocker. See the note in {@link signedOutNotice}.
		*/
		function signedOutNotice(input) {
			if (input.selectionLost) return { key: "row.selectionLostMessage" };
			if (input.searched.some((item) => item.reason === "encrypted")) return { key: "row.signedOutEncrypted" };
			if (input.searched.some((item) => item.reason === "wrong-region")) return { key: "row.signedOutWrongRegion" };
			if (input.searched.length > 0) return { key: "row.signedOutHint" };
			return input.message === void 0 ? { key: "row.signedOutHint" } : {
				key: "row.signedOutHint",
				fallback: input.message
			};
		}
		/**
		* The paragraph's final text: the localized copy, plus the Host message only
		* when {@link signedOutNotice} decided nothing supersedes it.
		*
		* Kept here rather than inline in the JSX so the anti-duplication guarantee can
		* be asserted on the string that is actually rendered, not on its inputs.
		*/
		function signedOutText(notice, t) {
			const hint = t(notice.key);
			return notice.fallback === void 0 ? hint : `${hint} (${notice.fallback})`;
		}
		//#endregion
		//#region src/client/WorkBuddyCard.tsx
		/**
		* WorkBuddy credits & models card contributed to Harness Plugin configuration.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 卡片的整体结构（折叠外壳 / 账号状态行 / 账号下拉 / 积分区 / 模型表 /
		*     操作按钮行）、模块加载时注入一次 `<style>` 的写法、
		*     草稿态（draftModels/draftEnabledIds）与 dirty 标记的保存流程、
		*     60 秒轮询与 AbortController 清理，均来自该项目的 TraeUsageCard。
		*   折叠卡片外壳与 `settings.plugin.item` 槽位形态来自
		*   dingminhua/dsh-subagent-default-model（MIT）。
		* 改动：
		*   0. 折叠箭头改用纯 CSS caret（理由见 styles.ts）：两版宿主的图标命名族
		*      不同，静态导入必挂一边。此前沿用的 `IconChevronDownOutline14` 已
		*      随该改动移除，故不再计入上方参考项。
		*   1. 积分区改为「合计 + 按套餐名聚合的进度条」，因为实测单个账号下
		*      同名套餐可达 19 个，逐条渲染会淹没卡片（原项目按上游条目直出）；
		*   2. 模型行补上 WorkBuddy 上游给出的积分倍率、多模态与推理档位；
		*   3. 移除与 WorkBuddy 上游无关的 1M 变体勾选；
		*   4. 双 provider 化后卡片顶部为「国内版 / 国际版」tab 栏 —— 每个 tab
		*      是一个独立供应商（workbuddy / workbuddy-global），账号、积分、
		*      模型目录与草稿完全按区域隔离，切 tab 不丢另一侧未保存的草稿。
		*
		* @module dsh-connect-workbuddy/client/WorkBuddyCard
		*/
		/**
		* The refresh cadence when the Host does not say.
		*
		* The Host answers with the SAVED interval on every document (see
		* `pollIntervalMs`), and that is what the card actually arms — this constant is
		* only the fallback for an older Host that cannot answer, so it stays a plain
		* number rather than a second source of truth.
		*
		* It is NOT a module-level `POLL_INTERVAL_MS` any more: the value is a setting
		* now, and a constant that the timer did not read would be exactly the kind of
		* duplicate that drifts from the control it describes.
		*/
		const FALLBACK_POLL_INTERVAL_MS = 3e5;
		/**
		* Retry cadence for a status read that FAILED.
		*
		* The failed read used to be terminal: `status.status === 'error'` made
		* `hasAccounts` false, which gated both the 60s poll and the open effect, so a
		* single transient failure (a WebView fetch rejected while the DSH web process
		* was restarting) left "Failed to fetch" on screen until the card was closed
		* and reopened. Backoff doubles from BASE up to MAX and resets on the first
		* read that lands; nothing is armed while the card is collapsed.
		*/
		const STATUS_RETRY_BASE_MS = 3e3;
		const STATUS_RETRY_MAX_MS = 3e4;
		/**
		* The reasoning tiers the local CodeBuddy CLI accepts for its `--effort` flag.
		*
		* Kept in sync with `EFFORT_LEVELS` in `src/cli-bridge/tool.ts` by hand: that
		* module imports the node runtime, so the client bundle cannot share the
		* constant — a drifted list here would offer a tier the CLI rejects.
		*/
		const CLI_BRIDGE_EFFORT_LEVELS = [
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max"
		];
		/**
		* The credential-region orders the quick-adjust picker offers for the CLI
		* route's `regionOrder`.
		*
		* The Host builds exactly two regions — `cn` and `global` (see
		* `REGION_KEYS` in `src/index.ts`), so every meaningful order of that pair
		* fits in these four presets: a preference, a reversed preference, or a
		* single-region lock. `''` (uncommitted) renders as the CLI's own default
		* order, CN first.
		*/
		const CLI_BRIDGE_REGION_ORDERS = [
			"cn,global",
			"global,cn",
			"cn",
			"global"
		];
		/**
		* Tooltip for one model's image checkbox. The box is pre-checked only for
		* models the vendored vendor table documents as natively multimodal, so the
		* two other outcomes need to say WHY they are off — otherwise a documented
		* text-only model and an unverified one look identically broken next to their
		* checked siblings.
		*/
		/**
		* The media roster from the Host's JSON, tolerantly.
		*
		* Anything that is not a row with a string id and a name is DROPPED, never
		* rendered: this is a read-only list, and a half-shaped entry is not worth an
		* exception that would take down the whole card. A Host older than the route
		* (or any other answer without `models`) yields an empty list, which the block
		* shows as "this tab publishes none" instead of as a failure.
		*/
		function readMediaRoster(value) {
			const models = value?.models;
			if (!Array.isArray(models)) return void 0;
			const rows = [];
			for (const entry of models) {
				const record = entry;
				if (record === null || typeof record !== "object") continue;
				if (typeof record.id !== "string" || record.id === "") continue;
				const tags = Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === "string") : [];
				rows.push({
					id: record.id,
					name: typeof record.name === "string" ? record.name : record.id,
					tags
				});
			}
			return rows;
		}
		function imageCheckboxHint(model, t) {
			switch (nativeModalityOf(model.id)) {
				case "multimodal": return t("row.modelImage");
				case "text": return t("row.modelImageText");
				default: return t("row.modelImageUnverified");
			}
		}
		/**
		* The upstream's own promotion badge for one model, or nothing.
		*
		* Drawn from the model's UNRESOLVED promo list at RENDER time, because a badge
		* is a function of the clock: the upstream's promotions run on wall-clock
		* hours in a named zone, so a badge chosen when the document was read would
		* keep claiming the night after the night is over. The card re-renders at
		* least once a minute while it is open (it polls the usage route), so a
		* window edge is picked up within a minute without a second timer.
		*
		* The chip says what the UPSTREAM says — its label, its colour, its hover
		* copy — and adds nothing of its own: a badge the user cannot trace back to
		* the upstream's feed is worse than no badge.
		*
		* One badge per model: the upstream's `priority` orders the entries that name
		* a model, and a model row is one line wide — two badges would push the
		* model name out of the row.
		*/
		function promoChip(model) {
			const promo = selectPromoBadge(model.promos, Date.now());
			if (promo === void 0) return null;
			const language = uiLanguage();
			const color = promoBadgeColor(promo);
			const tooltip = promoBadgeTooltip(promo, language);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsm-workbuddy-model-promo",
				title: tooltip === "" ? void 0 : tooltip,
				style: color === void 0 ? void 0 : { "--dsm-workbuddy-promo-color": color },
				children: promoBadgeLabel(promo, language)
			});
		}
		/**
		* The multiplier to DRAW for a model right now (issue #120).
		*
		* A "night discount" badge used to sit next to the full price: the badge was
		* resolved against the clock while the number beside it was the catalog's
		* static figure. The discount lives in the same upstream entry, so both are
		* answered against the same clock — a promotion that is running and carries a
		* readable `replace` discount wins; otherwise the catalog figure stands.
		*/
		function effectiveRate(model) {
			return selectPromoMultiplier(model.promos, Date.now()) ?? model.creditMultiplier;
		}
		/** Inject or refresh the shared card CSS for the current client bundle. */
		if (typeof document !== "undefined") {
			const cssId = "dsh-connect-workbuddy/client.css";
			const existing = document.querySelector(`style[data-plugin-css="${cssId}"]`);
			if (existing !== null) existing.textContent = WORKBUDDY_CARD_CSS;
			else {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-connect-workbuddy";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = WORKBUDDY_CARD_CSS;
				document.head.appendChild(styleTag);
			}
		}
		/**
		* One probed path, with its cause. The presentation rules — which entries are
		* worth showing up front, and how a reason is labelled — live in
		* `./searched-paths.ts` so they are unit-testable without a DOM.
		*/
		function renderSearchedItem(item, t) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.path }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: `dsm-workbuddy-searched-reason${item.reason === "encrypted" ? " dsm-workbuddy-searched-reason-encrypted" : item.reason === "wrong-region" ? " dsm-workbuddy-searched-reason-wrong-region" : ""}`,
				children: [searchReasonLabel(item, t), item.message === void 0 ? null : ` · ${item.message}`]
			})] }, `${item.source}:${item.path}`);
		}
		/**
		* The probed-path list behind a signed-out card.
		*
		* Collapsed by default because it is a diagnostic, not a headline. The
		* interesting failures (encrypted / invalid / unreadable) are listed up front;
		* the merely-absent candidates — most of them, on any normal machine — sit
		* behind a second toggle, so the one entry that explains the failure is not
		* buried under a dozen "not found" lines. When nothing interesting was found
		* the absent list IS the explanation, so it opens directly.
		*
		* An `encrypted` failure deliberately adds NO notice of its own. It used to,
		* because the paragraph above still said "sign in once in the desktop app" —
		* the one action that cannot work when the credential exists but is encrypted.
		* `signedOutNotice` now answers that cause in the paragraph itself, so a second
		* copy here would restate it: the paragraph states the situation, this list
		* supplies the detail, and the per-entry label already says what each path is.
		*/
		function SearchedPaths({ items, t }) {
			const view = searchedView(items);
			const [explicitOpen, setExplicitOpen] = (0, react.useState)(void 0);
			const showMissing = explicitOpen ?? view.missingOpen;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "dsm-workbuddy-searched",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
						t("row.searchedTitle"),
						" (",
						view.total,
						")"
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-searched-hint",
						children: t("row.searchedHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: "dsm-workbuddy-searched-list",
						children: [view.interesting.map((item) => renderSearchedItem(item, t)), showMissing ? view.missing.map((item) => renderSearchedItem(item, t)) : null]
					}),
					showMissing || view.missing.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-workbuddy-searched-more",
						onClick: () => {
							setExplicitOpen(true);
						},
						children: t("row.searchedMore", { count: view.missing.length })
					})
				]
			});
		}
		function formatNumber(value) {
			return new Intl.NumberFormat(void 0, {
				minimumFractionDigits: 0,
				maximumFractionDigits: 0
			}).format(value);
		}
		/**
		* Compact package-date rendering with time, e.g. `08/25 14:44`.
		*
		* `hourCycle: 'h23'` is what makes that example TRUE. Without it `Intl` defers
		* to the browser locale, and en-US produced `08/25, 02:44 PM` — 12-hour, with a
		* comma the template never asked for. `h23` (not `hour12: false`) keeps midnight
		* at `00:00` instead of `24:00`, and matches DSH's own clock cycle.
		*/
		function formatDate(value) {
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23"
			}).format(new Date(value));
		}
		function formatCapacity(value, unknown) {
			if (value === void 0) return unknown;
			if (value >= 1e6 && value % 1e6 === 0) return `${value / 1e6}M`;
			if (value >= 1e3 && value % 1e3 === 0) return `${value / 1e3}K`;
			return formatNumber(value);
		}
		function dotStyle(status) {
			return { background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-dimmed, #9aa0a6)" };
		}
		/**
		* The sentence a probe result gets, and how it should be coloured.
		*
		* The cooldown wording is the part that had to be got right. The upstream names
		* a "use again" time in three situations: a `Retry-After` header, the reset
		* sentence it writes into its own failure BODY (where this service actually
		* puts it — its 429s carry no rate-limit header at all), or an exhausted
		* monthly quota whose refresh point it declares. So a limited result WITHOUT
		* any stated time must say that plainly. Substituting a locally invented
		* countdown would be the single most misleading thing this feature could do: it
		* would look like an upstream answer while being a guess, and the user would
		* wait for a moment that means nothing.
		*/
		/**
		* ` · 约 1 小时后` for a future instant, or `''` when there is none.
		*
		* Kept beside {@link probeResultView} rather than inlined three times so the
		* "append only when non-empty" rule cannot drift between the two limited
		* outcomes. The absolute instant stays the primary text: it is the upstream's
		* own answer, and the relative form is a convenience derived from it.
		*/
		function retrySuffix(t, untilMs, nowMs) {
			if (untilMs === void 0) return "";
			const remaining = remainingText(t, untilMs, nowMs);
			return remaining === "" ? "" : ` · ${remaining}`;
		}
		/**
		* Render one measured speed, or why there is none (issue #92).
		*
		* The timestamp is PART of the value, not decoration: speed changes with load,
		* and a number without its moment is indistinguishable from a fresh one. When the
		* measurement could not be timed the row says so and names the reason — never a
		* zero, and never a guess extrapolated from `elapsedMs`, which for some runs is
		* time-to-first-token and for others a whole-request duration.
		*/
		function tpsResultView(result, t, measuredAtMs) {
			const stamp = measuredAtMs === void 0 ? "" : ` · ${t("row.tpsMeasuredAt", { at: formatDate(measuredAtMs) })}`;
			if (result.tokensPerSecond === void 0) {
				const reason = result.reason === "few-chunks" ? "row.tpsNoSample" : result.reason === "no-usage" ? "row.tpsNoUsage" : "row.tpsAllFailed";
				return {
					text: result.samples > 0 && result.reason !== void 0 ? `${t(reason)}${stamp}` : `${t("row.tpsAllFailed")}${stamp}`,
					tone: "bad"
				};
			}
			return {
				text: `${result.samples < TPS_EXPECTED_RUNS ? t("row.tpsPartial", {
					tps: String(result.tokensPerSecond),
					samples: String(result.samples)
				}) : result.timeToFirstTokenMs === void 0 ? t("row.tpsValue", { tps: String(result.tokensPerSecond) }) : t("row.tpsValueTtft", {
					tps: String(result.tokensPerSecond),
					ttft: (result.timeToFirstTokenMs / 1e3).toFixed(1)
				})}${result.credit === void 0 ? "" : ` · ${t("row.tpsCredit", { credit: String(result.credit) })}`}${stamp}`,
				tone: result.samples < TPS_EXPECTED_RUNS ? "warn" : "ok"
			};
		}
		/** Runs a complete measurement takes; below this the row says "n runs". */
		const TPS_EXPECTED_RUNS = 3;
		function probeResultView(result, t, nowMs = Date.now()) {
			switch (result.outcome) {
				case "ok": {
					const elapsed = result.elapsedMs === void 0 ? void 0 : `${String(result.elapsedMs / 1e3)}s`;
					return {
						text: elapsed === void 0 ? t("row.probeOk") : t("row.probeOkMs", { ms: elapsed }),
						tone: "ok"
					};
				}
				case "rate-limited": return {
					text: result.retryAtMs === void 0 ? t("row.probeRateLimitedUnknown") : t("row.probeRateLimitedAt", { at: formatDate(result.retryAtMs) }) + retrySuffix(t, result.retryAtMs, nowMs),
					tone: "warn"
				};
				case "model-busy": return {
					text: result.retryAtMs === void 0 ? t("row.probeModelBusyUnknown") : t("row.probeModelBusyAt", { at: formatDate(result.retryAtMs) }) + retrySuffix(t, result.retryAtMs, nowMs),
					tone: "warn"
				};
				case "out-of-credit": return {
					text: result.retryAtMs === void 0 ? t("row.probeOutOfCreditUnknown") : t("row.probeOutOfCreditAt", { at: formatDate(result.retryAtMs) }) + retrySuffix(t, result.retryAtMs, nowMs),
					tone: "bad"
				};
				case "credential-rejected": return {
					text: t("row.probeCredentialRejected"),
					tone: "bad"
				};
				case "account-restricted": return {
					text: t("row.probeAccountRestricted"),
					tone: "bad"
				};
				case "policy-rejected": return {
					text: t("row.probePolicyRejected"),
					tone: "bad"
				};
				case "channel-rejected": return {
					text: t("row.probeChannelRejected"),
					tone: "warn"
				};
				case "not-found": return {
					text: t("row.probeNotFound"),
					tone: "bad"
				};
				case "unavailable": return {
					text: t("row.probeUnavailable"),
					tone: "bad"
				};
				default: return {
					text: result.status === void 0 ? t("row.probeFailed") : t("row.probeFailedStatus", { status: String(result.status) }),
					tone: "bad"
				};
			}
		}
		/**
		* The configuration area's own crash face (issue #139).
		*
		* WHY THIS EXISTS. The host wraps every slot entry in its own
		* `SlotErrorBoundary`, and that boundary's failure face is an EMPTY
		* `<div data-slot-error>` (`dsh-client-ui-renderer`). So a render-time throw
		* anywhere inside this card does not look like an error — it looks like the
		* plugin never installed: the header stays, the whole configuration area
		* vanishes, and the only trace is one `console.error` line. That is precisely
		* how issue #139 was reported ("配置区整块消失"), and it is why the reporter
		* could not tell a real crash from a missing card.
		*
		* WHAT IT BUYS. The same catch, with a face that says what happened: the
		* message goes on screen, so a report can quote it without opening devtools.
		* It does NOT hide the error — `componentDidCatch` still logs it, so the
		* console keeps the full stack the host would have printed anyway.
		*
		* SCOPE: the BODY only, never the header. A user whose configuration crashed
		* must still be able to collapse and re-expand the card, and the header is
		* pure static markup — it cannot be the thing that threw.
		*
		* LIMITS, stated so nobody expects more than React gives: a boundary catches
		* errors thrown during RENDER, in lifecycle methods, and in constructors. It
		* does NOT catch throws from event handlers, timers, or promise callbacks —
		* so an async failure still surfaces the way it did before (inline error text
		* or the console), which is the correct behaviour for those paths.
		*/
		var CardBodyBoundary = class extends react.Component {
			state = {
				failed: false,
				message: void 0
			};
			static getDerivedStateFromError(error) {
				if (error instanceof Error && error.name === "SlotAssemblyError") throw error;
				return {
					failed: true,
					message: error instanceof Error ? error.message : String(error)
				};
			}
			componentDidCatch(error, info) {
				try {
					console.error("[dsh-connect-workbuddy] configuration area failed to render:", error, info.componentStack);
				} catch {}
			}
			render() {
				if (!this.state.failed) return this.props.children;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-usage",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-usage-error",
							children: this.props.t("row.cardCrashed")
						}),
						this.state.message === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-usage-error dsm-workbuddy-diag-mono",
							children: this.state.message
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-diag-hint",
							children: this.props.t("row.cardCrashedHint")
						})
					]
				});
			}
		};
		/**
		* Render WorkBuddy sign-in state, credits, and model selection as one card.
		*
		* The body is wrapped in {@link CardBodyBoundary} INSIDE the render, not here:
		* the header must keep working when the body throws (see that class).
		*/
		function WorkBuddyCard(props) {
			if (props.t === void 0) throw new Error("WorkBuddy plugin card requires its translation function");
			return (0, react.createElement)(WorkBuddyCardBody, props);
		}
		function WorkBuddyCardBody({ t, settingsScope, view, surface, backToConversation }) {
			if (t === void 0) throw new Error("WorkBuddy plugin card requires its translation function");
			const pageSurface = surface === "page";
			const settingsSurface = surface === "settings";
			const [cardOpen, setCardOpen] = (0, react.useState)(view === "page");
			const open = pageSurface || settingsSurface || cardOpen;
			/** The region whose tab is on screen; each tab is its own provider stack. */
			const [activeRegion, setActiveRegion] = (0, react.useState)("cn");
			/**
			* Last-known usage per region, so tab dots survive tab switches.
			*
			* EMPTY until a real document lands (issue #77). It used to be seeded with a
			* `signed-out` placeholder, which was then rendered: for as long as the usage
			* route took to answer — and that wait is exactly what #77 reports — a user
			* with several signed-in accounts was told they were not signed in, with a
			* "detect accounts" button as the only way out. An absent region now renders
			* the loading line instead, and the first paint itself arrives from the
			* `detail=fast` document (local state only, no upstream call), so the rows
			* appear before anything billing-side has answered.
			*/
			const [statusByRegion, setStatusByRegion] = (0, react.useState)({});
			/**
			* Which of the card's three sections is on screen.
			*
			* The section tabs exist because the card grew into one 3,500 px column that
			* carried two unrelated jobs: operating an account (who serves, how much is
			* left, which order) and editing the catalog (which models, what context
			* budget, which reasoning tiers). They even commit differently — an account
			* change lands on the click, a catalog change is a draft until saved — so a
			* single column put the save button three screens away from what it saves.
			*
			* Only the ACTIVE section is visible; the others stay MOUNTED (the `hidden`
			* attribute), so switching back never refetches, a half-filled draft
			* survives, and the pool keeps its log.
			*/
			const [panel, setPanel] = (0, react.useState)("accounts");
			const [busy, setBusy] = (0, react.useState)(false);
			const [settingsRevision, setSettingsRevision] = (0, react.useState)(0);
			/** Per-region unsaved model edits; a draft on one tab is never dropped by
			* switching to the other tab, only by that tab's discard/save. */
			const [drafts, setDrafts] = (0, react.useState)({});
			const [saving, setSaving] = (0, react.useState)(false);
			/** Save failure surfaced next to the buttons; cleared by the next attempt. */
			const [saveError, setSaveError] = (0, react.useState)(void 0);
			const [switchingAccount, setSwitchingAccount] = (0, react.useState)(false);
			/**
			* The region's MEDIA model roster (read-only), keyed by region.
			*
			* NOT part of `statusByRegion`: the usage document is the editable model
			* directory, and folding media rows into it would put them in the saved
			* `lastCatalog` — where the adapter would offer an image model as a chat
			* model. It is a separate, cheap, read-only read that only the capability
			* panel needs.
			*/
			const [mediaByRegion, setMediaByRegion] = (0, react.useState)({});
			const [mediaError, setMediaError] = (0, react.useState)(void 0);
			const [mediaBusy, setMediaBusy] = (0, react.useState)(false);
			/**
			* Whether the account pool's save is in flight. Both sections write into one
			* region slot and the Host merges per-region, so two concurrent saves can
			* interleave on a stale base and revert each other while both report success
			* — the two save buttons are serialized to make that impossible.
			*/
			const [poolBusy, setPoolBusy] = (0, react.useState)(false);
			/**
			* 设备头设置：`undefined` = 还没读到 / 这台 Host 没有这条路由。
			*
			* 两种"没有值"必须合并成同一个信号（不渲染控件），因为卡片无论哪种情况都不该
			* 显示一个点不动的开关；区别只在实现上：前者下一轮轮询会补上，后者永远不会。
			*/
			const [deviceSettings, setDeviceSettings] = (0, react.useState)(void 0);
			/** A refused account write (silently unpersisted settings on a locked file). */
			const [accountError, setAccountError] = (0, react.useState)(void 0);
			/** Region whose on/off checkbox write is in flight, so its box can't race. */
			const [togglingRegion, setTogglingRegion] = (0, react.useState)(void 0);
			/**
			* Region whose SIDEBAR-credit checkbox write is in flight.
			*
			* Tracked separately from {@link togglingRegion} because they are different
			* fields of the same region slot: one in-flight write must not disable the
			* other control, and both must stay serialized against the SAVE writers.
			*/
			const [togglingCredits, setTogglingCredits] = (0, react.useState)(void 0);
			/**
			* Which region's new-model-segment flag is being written right now.
			*
			* Tracked separately from {@link togglingCredits} for the same reason those
			* are separate from `togglingRegion`: they are different fields of one region
			* slot, so one in-flight write must not disable the other control while both
			* stay serialized against the SAVE writers.
			*/
			const [togglingNewModels, setTogglingNewModels] = (0, react.useState)(void 0);
			/**
			* Which video-model pin is being written right now: the tag string, or
			* undefined.
			*
			* A SEPARATE state from {@link togglingCredits} for the same reason those two
			* switches keep separate busy flags: the pin lives in a different field of the
			* same region slot, so one in-flight write must not disable the other control.
			*/
			const [pinningVideoModel, setPinningVideoModel] = (0, react.useState)(void 0);
			/**
			* The OPTIONAL CodeBuddy CLI route switch (global: one switch, one budget).
			*
			* `undefined` until the first Host answer arrives, so the box renders the
			* committed value instead of guessing — the same rule as `creditsShownOn`.
			*/
			const [cliBridgeOn, setCliBridgeOn] = (0, react.useState)(void 0);
			const [cliBridgeBusy, setCliBridgeBusy] = (0, react.useState)(false);
			/**
			* The OPTIONAL sidebar-row switch (PR #188).
			*
			* `undefined` until the first Host answer arrives, so the box renders the
			* committed value instead of guessing — the same rule as `cliBridgeOn`.
			*/
			const [sidebarPanelOn, setSidebarPanelOn] = (0, react.useState)(void 0);
			const [sidebarPanelBusy, setSidebarPanelBusy] = (0, react.useState)(false);
			/** This card's own successful write of the refresh interval, if any. */
			const [pollIntervalOn, setPollIntervalOn] = (0, react.useState)(void 0);
			const [pollIntervalBusy, setPollIntervalBusy] = (0, react.useState)(false);
			/**
			* The CN gateway editor's draft (issue #220). `undefined` = "not edited", so
			* the field shows the SAVED value and a background refresh cannot overwrite
			* what the user is typing — the same rule the model drafts follow.
			*/
			const [cnBaseDraft, setCnBaseDraft] = (0, react.useState)(void 0);
			const [cnBaseSaving, setCnBaseSaving] = (0, react.useState)(false);
			const [cnBaseError, setCnBaseError] = (0, react.useState)(void 0);
			const [cnBaseNotice, setCnBaseNotice] = (0, react.useState)(void 0);
			/**
			* The quick-adjust pins of the CLI route (model, effort, region order) made
			* by THIS card instance.
			*
			* Each is `undefined` until the user changes its picker here: the value
			* then renders from the Host's answer (the authoritative mirror) and falls
			* back to the settings snapshot only when the Host cannot say — the same
			* rule as `cliBridgeOn`. A failed write reverts to `undefined`, so the
			* picker shows the COMMITTED value again instead of one that never landed.
			*/
			const [cliBridgeModel, setCliBridgeModel] = (0, react.useState)(void 0);
			const [cliBridgeModelBusy, setCliBridgeModelBusy] = (0, react.useState)(false);
			const [cliBridgeEffort, setCliBridgeEffort] = (0, react.useState)(void 0);
			const [cliBridgeEffortBusy, setCliBridgeEffortBusy] = (0, react.useState)(false);
			const [cliBridgeRegionOrder, setCliBridgeRegionOrder] = (0, react.useState)(void 0);
			const [cliBridgeRegionOrderBusy, setCliBridgeRegionOrderBusy] = (0, react.useState)(false);
			/**
			* The upstream-identity switches the user flipped in this session.
			*
			* `undefined` means "not touched here, read the committed settings"; a flipped
			* value wins until the next snapshot agrees (same rule as `cliBridgeOn`). Each
			* switch has its own busy flag so flipping one does not disable the others —
			* they are independent writes, and a shared flag would make the card feel
			* frozen while one of them is in flight.
			*/
			const [usageIdentityOn, setUsageIdentityOn] = (0, react.useState)(void 0);
			const [usageIdentityBusy, setUsageIdentityBusy] = (0, react.useState)(false);
			const [keepPromptLastOn, setKeepPromptLastOn] = (0, react.useState)(void 0);
			const [keepPromptLastBusy, setKeepPromptLastBusy] = (0, react.useState)(false);
			const [sessionTitleOn, setSessionTitleOn] = (0, react.useState)(void 0);
			const [sessionTitleBusy, setSessionTitleBusy] = (0, react.useState)(false);
			const [channelRejectContinueOn, setChannelRejectContinueOn] = (0, react.useState)(void 0);
			const [channelRejectContinueBusy, setChannelRejectContinueBusy] = (0, react.useState)(false);
			const [dropAllThinkingOn, setDropAllThinkingOn] = (0, react.useState)(void 0);
			const [dropAllThinkingBusy, setDropAllThinkingBusy] = (0, react.useState)(false);
			/**
			* Probe results, keyed by region then model id.
			*
			* Kept per region for the same reason drafts are: the two tabs are separate
			* provider stacks, so a test run on one tab must not be clobbered — or shown —
			* as the other tab's answer.
			*/
			const [probes, setProbes] = (0, react.useState)({});
			/** Model ids with a probe in flight, so each row's button can disable itself. */
			const [probing, setProbing] = (0, react.useState)({});
			/** Probe failure that is not attributable to one model (a dead route, say). */
			const [probeError, setProbeError] = (0, react.useState)(void 0);
			/**
			* The active region's probe results, mirrored into a ref.
			*
			* The sweep loop reads each verdict as soon as it lands, and state read inside
			* an async loop is the value captured when the loop STARTED — so counting from
			* `probes` would tally the previous run's answers. The ref is updated in the
			* same place the state is, so the two cannot drift.
			*/
			const probesRef = (0, react.useRef)({});
			/** Progress of an in-flight sweep, or undefined when none is running. */
			const [sweeping, setSweeping] = (0, react.useState)(void 0);
			/**
			* Measured output speed per model (issue #92), keyed by model id.
			*
			* Kept in its own map, NOT merged into `probes`: a speed run says nothing about
			* availability and an availability run says nothing about speed, so one map
			* holding both would let a fresh speed reading overwrite a stale availability
			* verdict (or the reverse) with no field to tell them apart.
			*
			* Deliberately survives a region switch's re-render but is NOT persisted: a
			* speed number is only meaningful with the moment it was taken, and a stored
			* one would be indistinguishable from a fresh measurement. The row prints the
			* time beside it for the same reason.
			*/
			const [tpsResults, setTpsResults] = (0, react.useState)({});
			/** Which speed runs are in flight, so the row and the sweep button can spin. */
			const [tpsProbing, setTpsProbing] = (0, react.useState)({});
			/** Progress of a speed sweep, so the button can show "n/m" instead of hanging. */
			const [tpsSweeping, setTpsSweeping] = (0, react.useState)(void 0);
			/** When each model's speed was measured, in ms; printed beside the number. */
			const [tpsMeasuredAt, setTpsMeasuredAt] = (0, react.useState)({});
			/** The last sweep's tally, cleared when the next one starts. */
			const [sweepSummary, setSweepSummary] = (0, react.useState)(void 0);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => settingsScope?.subscribe(() => {
				setSettingsRevision((value) => value + 1);
			}), [settingsScope]);
			/**
			* Per-region latest-wins guard for the usage fetch.
			*
			* Two refreshes can overlap — the 60s poll, a save, a batch action, the
			* account re-scan — and they are plain `fetch`es with no ordering guarantee.
			* Without a guard the SLOWER response wins, so a snapshot taken before a
			* check-in could land after one taken after it and overwrite the newer
			* credits. The guard makes "the last request started" the one that is applied,
			* whatever order the responses arrive in.
			*
			* Keyed by region, not global: the card deliberately fetches BOTH regions at
			* once (`for (const region of WORKBUDDY_REGIONS)` below), so a single shared
			* counter would make each of those two calls cancel the other and leave one
			* tab permanently stale.
			*
			* The rule itself is the tested `createLatestWins` factory, not a second
			* implementation written here.
			*
			* `begin()` returns a probe that reports **stale**: `true` once a newer call
			* has claimed the same region (see `src/account-pool.ts`). So the variable is
			* named `stale` and the bail-out is `if (stale())` — the same polarity as the
			* Host's rotation guard in `src/index.ts`. Naming it `fresh` and writing
			* `if (!fresh())` inverts the poll: every response that is NOT superseded —
			* i.e. every response in the single-fetch case — gets discarded, and the card
			* renders its placeholder forever. That defect shipped once; the polarity is
			* now pinned by a rendered assertion rather than by the spelling of the
			* identifier.
			*/
			const usageGuard = (0, react.useRef)(createLatestWins());
			const refreshUsage = (0, react.useCallback)(async (region, signal) => {
				const stale = usageGuard.current.begin(region);
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_USAGE_PATH, region), {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const usage = value;
					if (stale()) return void 0;
					if (mounted.current && signal?.aborted !== true) setStatusByRegion((prev) => ({
						...prev,
						[region]: usage
					}));
					return usage;
				} catch (error) {
					if (stale()) return void 0;
					if (mounted.current && signal?.aborted !== true) {
						const message = error instanceof Error ? error.message : t("row.requestFailed");
						setStatusByRegion((prev) => {
							const previous = prev[region];
							if (previous !== void 0 && previous.status === "signed-in") return {
								...prev,
								[region]: {
									...previous,
									refreshError: message
								}
							};
							return {
								...prev,
								[region]: {
									status: "error",
									message
								}
							};
						});
					}
					return;
				}
			}, [t]);
			/**
			* FIRST PAINT (issue #77): the same usage document, built from LOCAL state
			* only — no billing request, no per-account check-in read.
			*
			* Why this exists. The card used to paint nothing until ONE monolithic
			* document landed, and that document's tail awaited an upstream call per
			* account (credits for every pool member, check-in for every account, plus
			* the selected account's own two). Each of those has a 30-second timeout and
			* no retry, so a slow or throttled upstream stacked the waits and the panel
			* stayed empty for the reported 30–60 seconds — showing a "not signed in"
			* placeholder the whole time, because that is what an absent document
			* rendered as.
			*
			* The Host answers `detail=fast` from the credential store, the local pool
			* roster and the measurement caches, so this is one local round trip. It
			* carries the whole account table (the row list lives in the `pool` block),
			* which is the part the user came for; credits, check-in and the selected
			* account's live figures arrive with the full document that follows.
			*
			* Deliberately a SEPARATE callback instead of a `detail` argument on
			* `refreshUsage`: the ordering guard inside that callback is pinned by a
			* source test that counts its writes and freshness checks, and a second
			* write path in there would either break the pin or hide a real regression
			* behind it. Here the rules are simple and independent — this response never
			* downgrades a region that has already answered in full.
			*/
			const refreshUsageFast = (0, react.useCallback)(async (region, signal) => {
				const stale = usageGuard.current.begin(region);
				try {
					const response = await fetch(withWorkBuddyRegionFastDetail(WORKBUDDY_USAGE_PATH, region), {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) return;
					const usage = await response.json().catch(() => void 0);
					if (usage === void 0) return;
					if (stale()) return;
					if (!mounted.current || signal?.aborted === true) return;
					setStatusByRegion((prev) => {
						const previous = prev[region];
						if (previous !== void 0 && previous.status === "signed-in") return prev;
						return {
							...prev,
							[region]: usage
						};
					});
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				const controller = new AbortController();
				(async () => {
					await Promise.all(WORKBUDDY_REGIONS.map(async (region) => {
						await refreshUsageFast(region, controller.signal);
					}));
					if (controller.signal.aborted) return;
					for (const region of WORKBUDDY_REGIONS) refreshUsage(region, controller.signal);
				})();
				return () => {
					controller.abort();
				};
			}, [
				open,
				activeRegion,
				refreshUsage,
				refreshUsageFast
			]);
			/**
			* The document this tab is rendering, or `undefined` before ANY has landed.
			*
			* The distinction is the point of issue #77: an absent document used to be
			* rendered as the `signed-out` placeholder below, so for the whole time the
			* usage route was out the card told a signed-in user they were not signed in
			* and offered "detect accounts" as the only remedy. `loading` now gates that
			* branch, and the placeholder is only a safe shape for the reads below it.
			*/
			const loaded = statusByRegion[activeRegion];
			const loading = loaded === void 0;
			const status = loaded ?? {
				status: "signed-out",
				accounts: [],
				selectionExplicit: false
			};
			/**
			* Whether the ACTIVE region has a usable sign-in.
			*
			* The section tabs render only here: a signed-out card is one screen of
			* instructions, and splitting that into panels would hide the only thing it
			* has to say behind a tab.
			*/
			const signedIn = status.status === "signed-in";
			/**
			* The refresh cadence to arm, from the Host's answer.
			*
			* Read off the ACTIVE region's document, which is the one the timer refreshes.
			* An absent or unrecognized value falls back to 5 minutes — the same coercion
			* the Host applies, so a hand-edited profile cannot make the card poll faster
			* than the setting allows.
			*/
			const pollIntervalMs = (() => {
				const raw = "pollIntervalMs" in status ? status.pollIntervalMs : void 0;
				return typeof raw === "number" && WORKBUDDY_POLL_INTERVALS_MS.includes(raw) ? raw : FALLBACK_POLL_INTERVAL_MS;
			})();
			/**
			* Whether the ACTIVE region knows of any account at all.
			*
			* This is the poll's precondition in place of `status === 'signed-in'`. The
			* signed-in flag means "a credential resolves", which is false for a region
			* whose accounts exist but none is usable yet — exactly the state an import
			* or a fresh OAuth sign-in creates. Polling on it meant those regions never
			* refreshed, so the list stayed empty until the card was reopened.
			*/
			const hasAccounts = status.status !== "error" && status.accounts.length > 0;
			(0, react.useEffect)(() => {
				if (!open || !hasAccounts) return;
				const controller = new AbortController();
				const timer = window.setInterval(() => {
					refreshUsage(activeRegion, controller.signal);
				}, pollIntervalMs);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				activeRegion,
				refreshUsage,
				status.status,
				pollIntervalMs
			]);
			/**
			* 设备头设置：卡片打开时读一次。
			*
			* 不跟 60 秒轮询走：这份文档只在用户自己点开关或保存齿轮时变，定时重读只是
			* 每分钟多一次请求。每次写完都把 Host 的返回值直接放进状态（见下面两个
			* handler），所以这个标签页看到的永远是最新写入的那一份。
			*/
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				(async () => {
					try {
						const settings = await fetchDeviceSettings(WORKBUDDY_DEVICE_PROFILE_PATH);
						if (!cancelled && mounted.current) setDeviceSettings(settings);
					} catch {}
				})();
				return () => {
					cancelled = true;
				};
			}, [open]);
			/** 切档：Host 是唯一真源，所以用它的返回值覆盖本地状态，而不是猜一个。 */
			const changeDeviceMode = async (mode) => {
				const settings = await putDeviceMode(WORKBUDDY_DEVICE_PROFILE_PATH, mode);
				if (mounted.current) setDeviceSettings(settings);
			};
			/** 保存一个账号的覆盖值。抛错由 AccountPool 接住并留在弹窗里。 */
			const saveDeviceProfile = async (accountId, values) => {
				const settings = await putDeviceProfile(WORKBUDDY_DEVICE_PROFILE_PATH, accountId, values);
				if (mounted.current) setDeviceSettings(settings);
			};
			/**
			* Recover from a failed status read without a close/reopen.
			*
			* Keyed on the document identity (`loaded`), not on `status.status`: every
			* failed read writes a FRESH `{ status: 'error' }` object, so the identity
			* changes and the next attempt is armed. A successful read replaces it with a
			* new object too, which resets the counter through the branch below.
			*/
			const statusRetries = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (!open || status.status !== "error") {
					statusRetries.current = 0;
					return;
				}
				const delay = Math.min(STATUS_RETRY_MAX_MS, STATUS_RETRY_BASE_MS * 2 ** statusRetries.current);
				const controller = new AbortController();
				const timer = window.setTimeout(() => {
					statusRetries.current += 1;
					refreshUsage(activeRegion, controller.signal);
				}, delay);
				return () => {
					window.clearTimeout(timer);
					controller.abort();
				};
			}, [
				open,
				activeRegion,
				refreshUsage,
				loaded
			]);
			/**
			* Re-detect the local sign-ins and refresh the panel.
			*
			* This deliberately writes NO account selection. It used to persist whatever
			* row the store reported as "selected" whenever that differed from the saved
			* value, which had two harmful effects: with no explicit choice it turned the
			* documented default (follow the app's current sign-in) into a permanent
			* explicit binding — so a later sign-in in the app was no longer followed —
			* and with an orphaned saved id it silently re-bound the region to a
			* different account, which is the silent switch that the strict
			* no-fallback rule exists to prevent. Re-detecting and re-picking are
			* separate actions now; the picker and Clear button own the selection.
			*/
			const rescanAccounts = async () => {
				setBusy(true);
				setAccountError(void 0);
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_ACCOUNTS_REFRESH_PATH, activeRegion), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok || !Array.isArray(body.accounts)) throw new Error(`HTTP ${response.status}`);
					if (body.dismissalsCleared === false) setAccountError(t("row.rescanHidesKept"));
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			const switchAccount = async (accountId) => {
				if (settingsScope === void 0) return;
				setSwitchingAccount(true);
				setAccountError(void 0);
				try {
					await writeAccountSlot(settingsScope, activeRegion, accountId);
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setSwitchingAccount(false);
				}
			};
			/**
			* Whether one region's provider is switched on.
			*
			* The HOST's answer wins, because on this deployment it is the only writer
			* that lands: the switch goes through the plugin's Host save endpoint (that
			* endpoint is the only writer that cannot drop the sibling region), and a
			* write made there does NOT update the browser settings mirror. Reading the
			* mirror therefore left the checkbox stuck ON after a successful disable —
			* "不能正确取消国际版/国内版" — even though `enabled: false` was already in
			* the profile configuration. The Host sends the committed value it derives
			* from its own config (`status.enabled`, see `deps.regionEnabled`), so the
			* card renders that.
			*
			* The mirror stays as the FALLBACK: a host that predates the field, or a
			* status that has not loaded yet, still renders from the stored document
			* rather than guessing. Both rules are the same opt-out rule (only an
			* explicit `false` disables), so the two sources cannot disagree — only one
			* of them can be stale.
			*/
			const regionOn = (item) => {
				const fromHost = statusByRegion[item]?.enabled;
				if (typeof fromHost === "boolean") return fromHost;
				return regionEnabledOf(settingsScope?.getSnapshot().value, item);
			};
			const activeRegionOn = regionOn(activeRegion);
			/**
			* Whether one region's sidebar credit line is shown — for the ACTIVE tab.
			*
			* Prefers the Host's answer, exactly like {@link regionOn} and for the same
			* measured reason: on the affected 0.1.7 deployment the browser's settings
			* mirror never picks up this plugin's writes, so a checkbox reading the mirror
			* rendered its previous value after a successful save and looked impossible to
			* turn off ("关闭不了"). The Host is the authority; the mirror is only a
			* fallback for a Host line that predates the field.
			*/
			const creditsShownOn = (item) => {
				const fromHost = statusByRegion[item]?.showCreditsInMainUi;
				if (typeof fromHost === "boolean") return fromHost;
				return regionCreditsShownOf(settingsScope?.getSnapshot().value, item);
			};
			/**
			* Whether this region's composer pill may show its "· N 新模型" segment.
			*
			* Host answer first, settings mirror second — same measured reason as
			* {@link creditsShownOn}. Both sources read this flag OPT-IN (`=== true`):
			* "new" means first seen by THIS machine, so on a fresh install it would
			* announce the entire roster, and an absent value must not become consent.
			* See `showNewModelsInMainUi` in the schema.
			*/
			const newModelsShownOn = (item) => {
				const usage = statusByRegion[item];
				if (typeof usage?.showNewModelsInMainUi === "boolean") return usage.showNewModelsInMainUi;
				return regionNewModelsShownOf(settingsScope?.getSnapshot().value, item);
			};
			/**
			* Whether the model may call the image tool in this region.
			*
			* Read off the Host's answer first, like {@link creditsShownOn} and for the
			* same measured reason — the browser mirror is stale for this namespace on the
			* affected 0.1.7 deployments, and here a stale `true` would be worse than a
			* dead checkbox: it would claim the spending capability is on.
			*/
			const imageToolOn = (item) => {
				const usage = statusByRegion[item];
				if (typeof usage?.imageToolEnabled === "boolean") return usage.imageToolEnabled;
				return regionImageToolEnabledOf(settingsScope?.getSnapshot().value, item);
			};
			/**
			* Whether the model may call the video tool in this region. Mirrors
			* imageToolOn: read off the Host answer first, so a stale mirror cannot
			* leave the spending capability on. Absent is NOT consent.
			*/
			const videoToolOn = (item) => {
				const usage = statusByRegion[item];
				if (typeof usage?.videoToolEnabled === "boolean") return usage.videoToolEnabled;
				return regionVideoToolEnabledOf(settingsScope?.getSnapshot().value, item);
			};
			/**
			* The video model pinned for one mode tag in this region, or `''` for "no pin".
			*
			* Same read order as {@link videoToolOn} and for the same measured reason: the
			* Host's answer first, because this namespace's browser mirror is stale on the
			* affected 0.1.7 deployments — a picker reading the mirror alone would keep
			* showing a pin the tool no longer uses.
			*
			* `''` rather than `undefined` because that is what the `<select>` needs for its
			* "default" row; the write path turns it back into "remove the key".
			*/
			const preferredVideoModelOf = (item, tag) => {
				const fromHost = statusByRegion[item]?.preferredVideoModels;
				if (typeof fromHost === "object" && fromHost !== null) {
					const pinned = fromHost[tag];
					if (typeof pinned === "string") return pinned;
				}
				return regionPreferredVideoModelsOf(settingsScope?.getSnapshot().value, item)[tag] ?? "";
			};
			/**
			* Switch one region's provider off or on. The write carries the region's
			* whole slot through untouched — only `enabled` changes — so the user's
			* directory, model picks, image opt-ins and budgets survive a round trip.
			* The Host withdraws or restores the provider route on the next `onChange`,
			* which is what actually removes it from DSH's model picker.
			*
			* Goes through `writeRegionEnabled` rather than calling `scope.set()`
			* directly: on the affected 0.1.7 deployments that scope settles without
			* storing anything, so a direct write appeared to succeed and then silently
			* reverted. The helper adds the landed-check and the Host-endpoint fallback
			* that every other settings write already had.
			*/
			const toggleRegion = async (item, enabled) => {
				if (settingsScope === void 0) return;
				setTogglingRegion(item);
				try {
					const slot = nextRegionEnabled(settingsScope.getSnapshot().value, item, enabled)[item];
					await writeRegionEnabled(settingsScope, item, enabled, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingRegion(void 0);
				}
			};
			/**
			* Show or hide one region's sidebar credit line.
			*
			* This is the SECOND control for that line: the sidebar row also carries an
			* `×` that writes the same `regions.<region>.showCreditsInMainUi` flag, and
			* both go through the same landed-checked writer, so they can never disagree.
			* The checkbox stays because the sidebar is not always rendered (collapsed
			* rail, or a host that never mounts the footer slot).
			*
			* Writes the region's WHOLE slot — unchanged except for this one flag — so a
			* hide never drops the directory, model picks, budgets or pool preferences
			* that live alongside it.
			*/
			/**
			* WHERE the active region's credit readout sits (issue #62).
			*
			* Read off the Host's usage answer, like {@link creditsShownOn} and for the
			* same measured reason: the browser's settings mirror for this namespace is
			* documented as stale on the affected 0.1.7 deployments, so a control reading
			* it would keep showing the previous seat after a successful write. Absent
			* means `composer`, which is what the Host resolves for a profile written
			* before the setting existed.
			*/
			const creditPositionOn = (item) => {
				return statusByRegion[item]?.creditPosition === "stats" ? "stats" : "composer";
			};
			/**
			* Move one region's credit readout between its two seats.
			*
			* Same shape as {@link toggleCredits}: whole region slot in, landed check,
			* then a Host re-read. The re-read is load-bearing here for the same reason —
			* the control renders the Host's answer, so without it the picker keeps
			* showing the seat it had and the change looks like it did nothing.
			*/
			const changeCreditPosition = async (item, position) => {
				if (settingsScope === void 0) return;
				setTogglingCredits(item);
				try {
					const slot = nextRegionCreditPosition(settingsScope.getSnapshot().value, item, position)[item];
					await writeRegionCreditPosition(settingsScope, item, position, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingCredits(void 0);
				}
			};
			const toggleNewModels = async (item, shown) => {
				if (settingsScope === void 0) return;
				setTogglingNewModels(item);
				try {
					const slot = nextRegionNewModelsShown(settingsScope.getSnapshot().value, item, shown)[item];
					await writeRegionNewModelsShown(settingsScope, item, shown, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingNewModels(void 0);
				}
			};
			const toggleCredits = async (item, shown) => {
				if (settingsScope === void 0) return;
				setTogglingCredits(item);
				try {
					const slot = nextRegionCreditsShown(settingsScope.getSnapshot().value, item, shown)[item];
					await writeRegionCreditsShown(settingsScope, item, shown, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingCredits(void 0);
				}
			};
			/**
			* Whether the CLI route is mounted.
			*
			* Host answer first, settings mirror second, for the same measured reason as
			* `imageToolOn`: this namespace's browser mirror goes stale on the affected
			* deployments, and here a stale `true` would claim a spending capability is on.
			*/
			const cliBridgeSwitchedOn = () => {
				if (cliBridgeOn !== void 0) return cliBridgeOn;
				const fromHost = statusByRegion[activeRegion]?.cliBridgeEnabled;
				if (typeof fromHost === "boolean") return fromHost;
				return cliBridgeEnabledOf(settingsScope?.getSnapshot().value);
			};
			/**
			* Flip the global CLI-route switch.
			*
			* The Host rebuilds only this route on the change (`cliBridge` is volatile),
			* so no provider stack is disposed and no in-flight request is interrupted.
			* Re-reads the usage afterwards so the box shows the COMMITTED value.
			*/
			const toggleCliBridge = async (enabled) => {
				if (settingsScope === void 0) return;
				setCliBridgeBusy(true);
				try {
					await writeCliBridgeEnabled(settingsScope, enabled);
					if (mounted.current) setCliBridgeOn(enabled);
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setCliBridgeBusy(false);
				}
			};
			/**
			* Whether the OPTIONAL sidebar row is switched on (PR #188).
			*
			* Read Host-first, mirror-second, for the same measured reason as
			* `cliBridgeSwitchedOn`: the browser's settings mirror is stale for this
			* namespace on the affected 0.1.7 deployments. `=== true` on both — absent is
			* not consent, and this switch claims a global sidebar seat.
			*/
			const sidebarPanelSwitchedOn = () => {
				if (sidebarPanelOn !== void 0) return sidebarPanelOn;
				const fromHost = statusByRegion[activeRegion]?.sidebarPanelEnabled;
				if (typeof fromHost === "boolean") return fromHost;
				return sidebarPanelEnabledOf(settingsScope?.getSnapshot().value);
			};
			/**
			* Flip the sidebar-row switch.
			*
			* Published to the entry's opt-in store on success, because the row is built
			* from slot ENTRY METADATA and therefore cannot decide its own visibility —
			* see `panel-switch.ts`. Publishing only AFTER the write is verified keeps the
			* two from disagreeing: the row never appears for a value the Host refused.
			*/
			/**
			* The refresh interval, read from the status document first and the settings
			* snapshot second.
			*
			* The document is the fresher of the two (the Host answers with the value it
			* actually stored), but the settings snapshot is what a save is verified
			* against, and it is also the only thing available before the first document
			* lands. Reading both, in that order, means the picker never shows a value the
			* timer is not using.
			*/
			const pollIntervalValue = () => {
				if (pollIntervalOn !== void 0) return pollIntervalOn;
				const fromSettings = pollIntervalMsOf(settingsScope?.getSnapshot().value);
				if ("pollIntervalMs" in status && typeof status.pollIntervalMs === "number" && WORKBUDDY_POLL_INTERVALS_MS.includes(status.pollIntervalMs)) return status.pollIntervalMs;
				return fromSettings;
			};
			const changePollInterval = async (intervalMs) => {
				if (settingsScope === void 0) return;
				setPollIntervalBusy(true);
				try {
					await writePollIntervalMs(settingsScope, intervalMs);
					if (mounted.current) setPollIntervalOn(intervalMs);
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setPollIntervalBusy(false);
				}
			};
			const toggleSidebarPanel = async (enabled) => {
				if (settingsScope === void 0) return;
				setSidebarPanelBusy(true);
				try {
					await writeSidebarPanelEnabled(settingsScope, enabled);
					if (mounted.current) setSidebarPanelOn(enabled);
					setSidebarPanelWanted(enabled);
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setSidebarPanelBusy(false);
				}
			};
			/**
			* The three upstream-identity switches, read the same three-level way the CLI
			* switch is: this card's own successful write, then the settings snapshot.
			*
			* Deliberately NOT reading them from the status document: these are
			* plugin-wide request-shape switches that the Host does not report per region,
			* and inventing a status field for them would create a second source of truth
			* for a value the settings document already owns.
			*/
			const usageIdentityValue = () => usageIdentityOn ?? upstreamSwitchOf(settingsScope?.getSnapshot().value, "usageIdentity");
			const keepPromptLastValue = () => keepPromptLastOn ?? upstreamSwitchOf(settingsScope?.getSnapshot().value, "keepPromptLast");
			const sessionTitleValue = () => {
				const committed = sessionTitleOf(settingsScope?.getSnapshot().value);
				return sessionTitleOn === void 0 ? committed : {
					...committed,
					enabled: sessionTitleOn
				};
			};
			/** The custom injected prefixes in effect, used only to REPORT their count. */
			const extraInjectedPrefixes = () => extraInjectedPrefixesOf(settingsScope?.getSnapshot().value);
			/**
			* The auto-continue block after a channel-gate refusal (see
			* `src/channel-continue.ts`), read the three-level way the other switches are.
			*
			* The cap and the text are read from the committed document rather than
			* mirrored in card state: only `enabled` has a control here, so a local copy of
			* the other two would be a second source of truth for values this card can
			* only READ.
			*/
			const channelRejectContinueValue = () => {
				const committed = channelRejectContinueOf(settingsScope?.getSnapshot().value);
				return channelRejectContinueOn === void 0 ? committed : {
					...committed,
					enabled: channelRejectContinueOn
				};
			};
			/**
			* The reasoning-redaction switch (issue #213).
			*
			* Same three-level resolution as every other switch: this card's own verified
			* write, then the committed snapshot. No Host mirror, because this one has no
			* status-document field — it does not change any number the card displays.
			*/
			const dropAllThinkingValue = () => {
				if (dropAllThinkingOn !== void 0) return dropAllThinkingOn;
				return (settingsScope?.getSnapshot().value)?.["dropAllThinking"] === true;
			};
			/**
			* Flip one upstream-identity switch.
			*
			* No `refreshUsage` afterwards, unlike the CLI switch: these change the shape
			* of the NEXT request, not any value the usage document currently reports, so
			* re-reading the usage would only cost an upstream round-trip (the exact
			* stall #131 was about) for a number that cannot have moved.
			*/
			const toggleUpstreamSwitch = async (field, enabled) => {
				if (settingsScope === void 0) return;
				const setBusy = field === "usageIdentity" ? setUsageIdentityBusy : field === "keepPromptLast" ? setKeepPromptLastBusy : field === "sessionTitle" ? setSessionTitleBusy : field === "channelRejectContinue" ? setChannelRejectContinueBusy : setDropAllThinkingBusy;
				const setOwn = field === "usageIdentity" ? setUsageIdentityOn : field === "keepPromptLast" ? setKeepPromptLastOn : field === "sessionTitle" ? setSessionTitleOn : field === "channelRejectContinue" ? setChannelRejectContinueOn : setDropAllThinkingOn;
				setBusy(true);
				try {
					await writeUpstreamSwitch(settingsScope, field, field === "sessionTitle" ? {
						...sessionTitleOf(settingsScope.getSnapshot().value),
						enabled
					} : field === "channelRejectContinue" ? {
						...channelRejectContinueOf(settingsScope.getSnapshot().value),
						enabled
					} : enabled);
					if (mounted.current) setOwn(enabled);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			/**
			* The pinned model / effort of the CLI route, rendered the same way the
			* switch is: this card's own successful write first, then the Host's answer
			* (the authoritative mirror), then the settings snapshot. `''` is a real
			* value on every level: "nothing is pinned, the CLI runs on its own
			* default".
			*/
			const cliBridgeModelValue = () => {
				if (cliBridgeModel !== void 0) return cliBridgeModel;
				const fromHost = statusByRegion[activeRegion]?.cliBridgeModel;
				if (typeof fromHost === "string") return fromHost;
				return cliBridgeModelOf(settingsScope?.getSnapshot().value);
			};
			const cliBridgeEffortValue = () => {
				if (cliBridgeEffort !== void 0) return cliBridgeEffort;
				const fromHost = statusByRegion[activeRegion]?.cliBridgeEffort;
				if (typeof fromHost === "string") return fromHost;
				return cliBridgeEffortOf(settingsScope?.getSnapshot().value);
			};
			/**
			* Pin the model the local CLI runs on (or `''` for "back to the CLI's
			* default").
			*
			* The write is the same two-writer order as the switch; on a refusal the
			* optimistic value is REVERTED so the picker renders the committed value
			* again, and the error surfaces through the card's shared error line.
			*/
			const pickCliBridgeModel = async (model) => {
				if (settingsScope === void 0) return;
				setCliBridgeModelBusy(true);
				try {
					await writeCliBridgeModel(settingsScope, model);
					if (mounted.current) setCliBridgeModel(model);
				} catch (error) {
					if (mounted.current) {
						setCliBridgeModel(void 0);
						setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
					}
				} finally {
					if (mounted.current) setCliBridgeModelBusy(false);
				}
			};
			/**
			* Pin the reasoning effort the local CLI runs on, same write-and-revert
			* rule as {@link pickCliBridgeModel}.
			*/
			const pickCliBridgeEffort = async (effort) => {
				if (settingsScope === void 0) return;
				setCliBridgeEffortBusy(true);
				try {
					await writeCliBridgeEffort(settingsScope, effort);
					if (mounted.current) setCliBridgeEffort(effort);
				} catch (error) {
					if (mounted.current) {
						setCliBridgeEffort(void 0);
						setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
					}
				} finally {
					if (mounted.current) setCliBridgeEffortBusy(false);
				}
			};
			/**
			* The credential-region order of the CLI route, rendered with the same
			* write-first rule. Unlike the model and effort pins, `''` is NOT a
			* meaningful committed value here: it means "nothing pinned", and the route
			* then runs on the CLI's own default order — CN first. The picker therefore
			* shows that default instead of an empty answer.
			*/
			const cliBridgeRegionOrderValue = () => {
				if (cliBridgeRegionOrder !== void 0) return cliBridgeRegionOrder;
				const fromHost = statusByRegion[activeRegion]?.cliBridgeRegionOrder;
				const committed = typeof fromHost === "string" && fromHost !== "" ? fromHost : cliBridgeRegionOrderOf(settingsScope?.getSnapshot().value);
				return committed !== "" ? committed : "cn,global";
			};
			/**
			* Pin the credential-region order the local CLI walks, same
			* write-and-revert rule as {@link pickCliBridgeModel}.
			*/
			const pickCliBridgeRegionOrder = async (regionOrder) => {
				if (settingsScope === void 0) return;
				setCliBridgeRegionOrderBusy(true);
				try {
					await writeCliBridgeRegionOrder(settingsScope, regionOrder);
					if (mounted.current) setCliBridgeRegionOrder(regionOrder);
				} catch (error) {
					if (mounted.current) {
						setCliBridgeRegionOrder(void 0);
						setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
					}
				} finally {
					if (mounted.current) setCliBridgeRegionOrderBusy(false);
				}
			};
			const toggleImageTool = async (item, enabled) => {
				if (settingsScope === void 0) return;
				setTogglingCredits(item);
				try {
					const slot = nextRegionImageToolEnabled(settingsScope.getSnapshot().value, item, enabled)[item];
					await writeRegionImageToolEnabled(settingsScope, item, enabled, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingCredits(void 0);
				}
			};
			const toggleVideoTool = async (item, enabled) => {
				if (settingsScope === void 0) return;
				setTogglingCredits(item);
				try {
					const slot = nextRegionVideoToolEnabled(settingsScope.getSnapshot().value, item, enabled)[item];
					await writeRegionVideoToolEnabled(settingsScope, item, enabled, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingCredits(void 0);
				}
			};
			/**
			* Pin (or clear) one region's video model for one mode tag.
			*
			* `undefined` means "no pin": the picker's default row, which the tool reads as
			* "take the first model of that group". Both directions go through the same
			* landed-checked write as every other settings control, then re-read the Host —
			* a pin that reverted silently would leave the user believing the tool would
			* use a model it never picks.
			*/
			const pinVideoModel = async (item, tag, modelId) => {
				if (settingsScope === void 0) return;
				setPinningVideoModel(tag);
				try {
					const slot = nextRegionPreferredVideoModels(settingsScope.getSnapshot().value, item, tag, modelId)[item];
					await writeRegionPreferredVideoModels(settingsScope, item, tag, modelId, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setPinningVideoModel(void 0);
				}
			};
			/**
			* Read the active region's media roster. Read-only and free (the same GET the
			* image tool performs), so it is safe to run whenever the capability panel is
			* shown; `refresh` bypasses the Host's 5-minute cache for the explicit
			* button, because a user who just enabled an image model upstream should not
			* have to wait out a TTL to see it.
			*
			* A failure lands in `mediaError` INSIDE the block and nowhere else: it must
			* not touch `statusByRegion`, or one unreachable roster would replace the
			* whole panel with an error screen.
			*/
			const loadMediaModels = (0, react.useCallback)(async (region, refresh, signal) => {
				try {
					const url = refresh ? `${withWorkBuddyRegion(WORKBUDDY_MEDIA_MODELS_PATH, region)}&refresh=1` : withWorkBuddyRegion(WORKBUDDY_MEDIA_MODELS_PATH, region);
					const response = await fetch(url, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const models = readMediaRoster(await response.json().catch(() => void 0));
					if (models === void 0) throw new Error(`HTTP ${response.status}`);
					if (!mounted.current || signal?.aborted === true) return;
					setMediaByRegion((prev) => ({
						...prev,
						[region]: models
					}));
					setMediaError(void 0);
				} catch (error) {
					if (!mounted.current || signal?.aborted === true) return;
					setMediaError(error instanceof Error ? error.message : t("row.requestFailed"));
				}
			}, [t]);
			/**
			* Regions whose media roster has already been asked for, so showing the
			* capability panel does not re-read the roster on every render — and so a
			* FAILED read is not retried in a loop. The explicit "re-read" button is the
			* only thing that asks twice, because a user who just enabled a model
			* upstream is the one case where a fresh answer is the point.
			*/
			const mediaRequested = (0, react.useRef)(/* @__PURE__ */ new Set());
			/**
			* Read the media roster once per region, when the capability panel is opened.
			*
			* Lazy rather than alongside the usage fetch: the roster is only visible in
			* this one panel, and the usage fetch runs for BOTH regions on every open. If
			* the secret store happens to hold a credential for the region the user is not
			* looking at, an eager read would spend a request nobody asked for.
			*/
			(0, react.useEffect)(() => {
				if (!open || panel !== "capabilities" || !hasAccounts) return;
				if (mediaRequested.current.has(activeRegion)) return;
				mediaRequested.current.add(activeRegion);
				const controller = new AbortController();
				loadMediaModels(activeRegion, false, controller.signal);
				return () => {
					controller.abort();
				};
			}, [
				open,
				panel,
				activeRegion,
				hasAccounts,
				loadMediaModels
			]);
			const refreshModels = async () => {
				setBusy(true);
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_MODELS_REFRESH_PATH, activeRegion), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok || !Array.isArray(body.models)) throw new Error(`HTTP ${response.status}`);
					const fresh = body.models;
					const freshIds = new Set(fresh.map((model) => model.id));
					const stillEnabled = [...activeEnabledIds].filter((id) => freshIds.has(id));
					const upstreamImages = fresh.filter((model) => imageDefaultFor(model)).map((model) => model.id);
					const stillBudgets = {};
					for (const id of freshIds) {
						const budget = activeContextBudgets[id];
						if (typeof budget === "number") stillBudgets[id] = budget;
					}
					const stillEfforts = {};
					for (const id of freshIds) {
						const effort = activeDefaultEfforts[id];
						if (typeof effort === "string" && effort !== "") stillEfforts[id] = effort;
					}
					setDrafts((prev) => ({
						...prev,
						[activeRegion]: {
							models: fresh,
							enabledIds: new Set(stillEnabled),
							imageIds: new Set(upstreamImages),
							offIds: new Set(activeOffIds),
							contextBudgets: stillBudgets,
							defaultThinkingEfforts: stillEfforts
						}
					}));
				} catch (error) {
					if (mounted.current) setStatusByRegion((prev) => ({
						...prev,
						[activeRegion]: {
							...prev[activeRegion],
							status: "error",
							message: error instanceof Error ? error.message : t("row.requestFailed")
						}
					}));
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			const draft = drafts[activeRegion];
			const visibleModels = draft?.models ?? (status.status === "signed-in" ? status.models : []);
			/**
			* The LIVE load levels, keyed by model id.
			*
			* Read off the Host's answer rather than from the model list: the list is the
			* SAVED roster the user edits, and a saved roster has no load level in it
			* (load is a fact about this minute, not a setting — `src/busy.ts`). A model
			* the probe did not answer for simply has no entry, and draws nothing.
			*/
			const busyLevels = status.status === "signed-in" ? status.busyLevels ?? {} : {};
			const savedEnabledIds = status.status === "signed-in" ? new Set(status.enabledModelIds) : /* @__PURE__ */ new Set();
			const activeEnabledIds = draft?.enabledIds ?? savedEnabledIds;
			const savedImageIds = status.status === "signed-in" ? new Set(status.imageModelIds) : /* @__PURE__ */ new Set();
			const activeImageIds = draft?.imageIds ?? savedImageIds;
			const savedOffIds = status.status === "signed-in" ? new Set(status.offModelIds) : /* @__PURE__ */ new Set();
			const activeOffIds = draft?.offIds ?? savedOffIds;
			settingsScope?.getSnapshot().value;
			const savedContextBudgets = status.status === "signed-in" ? status.contextBudgets ?? {} : {};
			const savedDefaultEfforts = status.status === "signed-in" ? status.defaultThinkingEfforts ?? {} : {};
			const activeContextBudgets = draft?.contextBudgets ?? savedContextBudgets;
			const activeDefaultEfforts = draft?.defaultThinkingEfforts ?? savedDefaultEfforts;
			const dirty = draft !== void 0;
			/**
			* Whether the card's inputs accept edits.
			*
			* Deliberately NOT the settings scope's own `writable` flag: on the affected
			* DSH 0.1.7 deployment that flag stays false (the scope initialises it false
			* and only raises it once its mirror loads as a Host-backed form), which left
			* every input `disabled` — clicking them did nothing at all. Writes no longer
			* depend on that flag: `writeField` tries the scope and falls back to the
			* plugin's own Host endpoint, which performs the mutate in the Host process.
			* A bound scope is therefore all that is required to accept an edit.
			*/
			const canWrite = settingsScope !== void 0;
			const editDraft = (edit) => {
				setDrafts((prev) => ({
					...prev,
					[activeRegion]: edit(prev[activeRegion] ?? {
						models: [...visibleModels],
						enabledIds: new Set(activeEnabledIds),
						imageIds: new Set(activeImageIds),
						offIds: new Set(activeOffIds),
						contextBudgets: { ...activeContextBudgets },
						defaultThinkingEfforts: { ...activeDefaultEfforts }
					})
				}));
			};
			const toggleModel = (modelId) => {
				editDraft((current) => {
					const next = new Set(current.enabledIds);
					if (!next.delete(modelId)) next.add(modelId);
					return {
						...current,
						enabledIds: next
					};
				});
			};
			const toggleImage = (modelId) => {
				editDraft((current) => {
					const next = new Set(current.imageIds);
					if (!next.delete(modelId)) next.add(modelId);
					return {
						...current,
						imageIds: next
					};
				});
			};
			/**
			* Flip one row's `off` answer (issue #34).
			*
			* Writes an EXPLICIT answer in both directions, so the built-in rule is only
			* consulted while the user has no opinion. That is also why there is no
			* "reset" control: once an answer matches the rule, the two are
			* indistinguishable in effect, and the tooltip already names the override.
			*/
			const offBlocked = (model) => model.reasoning?.offRefused === true || model.reasoning?.refusesOff === true;
			const toggleOff = (modelId) => {
				editDraft((current) => {
					const next = new Set(current.offIds);
					if (!next.delete(modelId)) next.add(modelId);
					return {
						...current,
						offIds: next
					};
				});
			};
			/**
			* Set one model's DSH context budget, or CLEAR it.
			*
			* `undefined` means "no cap — use the model's native window", and it is
			* written as the ABSENCE of the key rather than as a stored number equal to
			* the window. That distinction is the whole of issue #215: a stored
			* `{ id: 1000000 }` and an absent entry both resolve to 1,000,000 today, but
			* only the absent one keeps following the model if the upstream ever raises
			* its window. It is also what makes the "native" radio mean one thing —
			* "no budget" — instead of sometimes meaning "a budget that happens to equal
			* the window".
			*
			* The key is DELETED rather than assigned `undefined`: an explicit
			* `undefined` survives `structuredClone` and the settings write path's strict
			* JSON codec rejects the whole save (see `setDefaultThinkingEffort`, which
			* follows the same rule for the same reason).
			*/
			const setContextBudget = (modelId, budget) => {
				editDraft((current) => {
					const next = { ...current.contextBudgets };
					if (budget === void 0) delete next[modelId];
					else next[modelId] = budget;
					return {
						...current,
						contextBudgets: next
					};
				});
			};
			/**
			* Choose one model's default thinking tier (issue #179).
			*
			* `''` — the picker's first option — means "follow the upstream default", and
			* is written as the ABSENCE of the key rather than as an empty string. The
			* stored map is the whole answer the runtime reads, so an `''` entry would
			* persist a tier nothing declares and then silently fall back; deleting the
			* key keeps "no opinion" representable, which is what lets a future upstream
			* change to `defaultEffort` take effect for this model.
			*/
			const setDefaultThinkingEffort = (modelId, effort) => {
				editDraft((current) => {
					const next = { ...current.defaultThinkingEfforts };
					if (effort === "") delete next[modelId];
					else next[modelId] = effort;
					return {
						...current,
						defaultThinkingEfforts: next
					};
				});
			};
			const discardModels = () => {
				setDrafts((prev) => {
					const next = { ...prev };
					delete next[activeRegion];
					return next;
				});
			};
			/**
			* Probe ONE model (the route refuses more than one — see `web-status.ts`,
			* where the cap is the gate that keeps a whole-roster sweep from becoming a
			* single unaccounted spend). The HOST owns the request: the browser half sends
			* only a model id and gets an outcome back, because the credential must never
			* cross to the page.
			*
			* The plural name is historical: this used to post a whole list in one request
			* before 3.0.0 removed the batch button. It is kept because callers that
			* already hold a list (the two sweep buttons below) can still express "test
			* these" without a second code path — it just sends them one at a time.
			*
			* Probing is deliberately independent of `dirty`: a test answers "does this
			* model work right now", which is true of the SAVED selection and the draft
			* alike, and blocking it on unsaved edits would make the button dead exactly
			* when the user is deciding what to keep.
			*/
			const probeModels = async (modelIds) => {
				if (modelIds.length === 0) return;
				setProbeError(void 0);
				setProbing((previous) => {
					const next = { ...previous };
					for (const id of modelIds) next[id] = true;
					return next;
				});
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_PROBE_PATH, activeRegion), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ modelIds })
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok || !Array.isArray(body?.results)) throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
					if (!mounted.current) return;
					const landedResults = body.results;
					probesRef.current = { ...probesRef.current };
					for (const result of landedResults) probesRef.current[result.modelId] = result;
					setProbes((previous) => {
						const regionResults = { ...previous[activeRegion] ?? {} };
						for (const result of landedResults) regionResults[result.modelId] = result;
						return {
							...previous,
							[activeRegion]: regionResults
						};
					});
				} catch (error) {
					if (mounted.current) setProbeError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setProbing((previous) => {
						const next = { ...previous };
						for (const id of modelIds) delete next[id];
						return next;
					});
				}
			};
			/**
			* ONE-CLICK availability sweep over several models (issue #61 follow-up, by
			* request of the maintainer after comparing with the sibling `trae` plugin).
			*
			* WHY IT IS A CLIENT-SIDE LOOP. The route accepts exactly ONE model id and
			* refuses more, and that cap is deliberate: it is what stops a stale bundle or
			* a hand-rolled client from turning one click into an unaccounted spend over a
			* whole roster (3.0.0's reason for deleting the original batch button). A
			* sweep is therefore expressed the way trae expresses it — one model per
			* request, from here — which keeps that gate intact and has a second benefit
			* the host-side batch never had: each row's verdict appears the moment it is
			* known, instead of the card sitting blank until the slowest model answers.
			*
			* COST is stated in the button's own hint rather than in a confirmation
			* dialog: a probe sends a real-volume request, so a sweep over a whole catalog
			* spends real credit (measured 0.01 per probe at the current default size, on
			* this machine — see the hint text). The user asked for the hint form, and it
			* matches the sibling plugin.
			*
			* SEQUENTIAL, not parallel: a probe exists to discover rate limits, and firing
			* a roster's worth of requests at once is the surest way to create one — the
			* same reason the host's own loop was serial.
			*
			* STOPS ON THE FIRST AUTH FAILURE: a rejected credential answers identically
			* for every remaining model, so continuing would only spend credit to collect
			* the same answer again. Other failures (a rate limit on one model) do NOT
			* stop the sweep — that is information about that model, and stopping would
			* hide it.
			*
			* The summary counts what the run actually established, so a stopped or
			* failed sweep cannot read as a complete green roster.
			*/
			const sweepModels = async (modelIds) => {
				if (modelIds.length === 0) return;
				setProbeError(void 0);
				setSweepSummary(void 0);
				setSweeping({
					done: 0,
					total: modelIds.length
				});
				let available = 0;
				let measured = 0;
				try {
					for (const [index, modelId] of modelIds.entries()) {
						if (!mounted.current) return;
						await probeModels([modelId]);
						const result = probesRef.current[modelId];
						measured += 1;
						if (result?.outcome === "ok") available += 1;
						if (result?.outcome === "credential-rejected") {
							if (mounted.current) setProbeError(t("row.modelsTestAuth"));
							break;
						}
						if (mounted.current) setSweeping({
							done: index + 1,
							total: modelIds.length
						});
					}
					if (mounted.current) setSweepSummary(t("row.modelsTestDone", {
						available,
						total: measured
					}));
				} finally {
					if (mounted.current) setSweeping(void 0);
				}
			};
			/** Sweep the models this region has ENABLED (the current draft's selection). */
			const sweepEnabledModels = () => {
				sweepModels(visibleModels.filter((model) => activeEnabledIds.has(model.id)).map((model) => model.id));
			};
			/**
			* Measure OUTPUT SPEED for one or more models (issue #92).
			*
			* One model per request, like every other spending route: the upstream route
			* refuses more than one id, and that cap is what keeps a stale bundle from
			* turning a click into an unaccounted spend over a whole roster. The loop for a
			* sweep therefore lives here, not on the Host.
			*
			* A failed model does NOT abort the sweep. Unlike an availability sweep — where
			* a rejected credential answers identically for every remaining model and
			* continuing only spends credit to hear the same answer — a speed failure is
			* specific to that model, so stopping would hide the one thing the sweep was
			* asked to find out.
			*/
			const measureTpsFor = async (modelIds) => {
				if (modelIds.length === 0) return;
				setTpsProbing((previous) => {
					const next = { ...previous };
					for (const id of modelIds) next[id] = true;
					return next;
				});
				try {
					for (const [index, modelId] of modelIds.entries()) {
						if (!mounted.current) return;
						try {
							const response = await fetch(withWorkBuddyRegion(WORKBUDDY_TPS_PATH, activeRegion), {
								method: "POST",
								headers: {
									"content-type": "application/json",
									accept: "application/json"
								},
								credentials: "same-origin",
								body: JSON.stringify({ modelIds: [modelId] })
							});
							const body = await response.json().catch(() => void 0);
							if (!response.ok || !Array.isArray(body?.results)) throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
							if (!mounted.current) return;
							const landed = body.results[0];
							if (landed !== void 0) {
								setTpsResults((previous) => ({
									...previous,
									[landed.modelId]: landed
								}));
								setTpsMeasuredAt((previous) => ({
									...previous,
									[landed.modelId]: Date.now()
								}));
							}
						} catch (error) {
							if (!mounted.current) return;
							setProbeError(error instanceof Error ? error.message : t("row.requestFailed"));
						} finally {
							if (mounted.current) setTpsProbing((previous) => {
								const next = { ...previous };
								delete next[modelId];
								return next;
							});
						}
						if (mounted.current) setTpsSweeping({
							done: index + 1,
							total: modelIds.length
						});
					}
				} finally {
					if (mounted.current) setTpsSweeping(void 0);
				}
			};
			/**
			* Whether ANY speed run is in flight, for the sweep button's disabled state.
			*
			* NOT `tpsProbing !== undefined`. `tpsProbing` is a record that is ALWAYS an
			* object, so that comparison is permanently true and the button was
			* permanently disabled — the defect this corrects. The other two sweep buttons
			* compare `sweeping !== undefined` because `sweeping` really is an
			* `{done,total} | undefined` pair; this map has no such absent state, so the
			* emptiness of its keys is what "busy" means.
			*/
			const tpsBusy = Object.keys(tpsProbing).length > 0;
			/**
			* Sweep speed for the models this region has ENABLED.
			*
			* Enabled-only rather than the whole catalog: a speed run is three real
			* requests, so covering a 20-model roster would cost 60 requests to learn
			* something about 18 models the user does not use.
			*/
			const sweepTpsEnabledModels = () => {
				measureTpsFor(visibleModels.filter((model) => activeEnabledIds.has(model.id)).map((model) => model.id));
			};
			const saveModels = async () => {
				if (settingsScope === void 0) return;
				if (status.status !== "signed-in") return;
				setSaving(true);
				setSaveError(void 0);
				try {
					await writeRegionModels(settingsScope, status.region, {
						enabled: activeRegionOn,
						lastCatalog: visibleModels.map(toPersistedWorkBuddyModel),
						enabledModelIds: [...activeEnabledIds],
						imageModelIds: [...activeImageIds],
						imageSelectionExplicit: true,
						offModelIds: [...activeOffIds],
						contextBudgets: activeContextBudgets,
						defaultThinkingEfforts: activeDefaultEfforts
					});
					if (mounted.current) setSaving(false);
					discardModels();
					refreshUsage(activeRegion);
					return;
				} catch (error) {
					if (mounted.current) {
						const reason = error instanceof Error ? error.message : t("row.requestFailed");
						setSaveError(isFileContentionWriteError(error) ? `${reason}${t("row.saveContentionHint")}` : reason);
					}
				} finally {
					if (mounted.current) setSaving(false);
				}
			};
			const title = t("row.title");
			/**
			* Show a name, or a placeholder when the desktop app recorded none.
			*
			* The Host sends `''` rather than an identifier, because a `uin`/`uid` shown
			* where a name belongs reads as "the plugin does not know who this is" — the
			* placeholder says the honest thing instead.
			*/
			const nameOf = (value) => value === "" ? t("row.accountUnnamed") : value;
			/** The saved choice no longer matches a local sign-in (tokens are fine). */
			const selectionLost = status.status === "signed-out" && status.selectionLost === true;
			/**
			* The vault directory could not be READ at all (issue #199).
			*
			* A permissions failure masquerades as "the account is gone": `syncVault`
			* skips the vault when its readdir fails, so the saved OAuth-only account
			* drops out of the list while the desktop scan's accounts remain. Without
			* this the card tells the user to re-sign-in, which cannot repair a DACL.
			* The raw error is shown because it names the actual failing operation.
			*/
			const vaultUnreadable = status.status === "signed-out" ? status.vaultUnreadable : void 0;
			/**
			* The paths the Host probed, on the branch where nothing was found at all.
			* Absent on the legacy card payload (an older Host), so it defaults empty
			* rather than rendering an empty diagnostic.
			*/
			const searched = status.status === "signed-out" ? status.searched ?? [] : [];
			/**
			* What the signed-out paragraph says, and whether to append the Host's raw
			* error. The rule lives in `./searched-paths.ts` because it is the fix for a
			* real duplication: `resolve()`'s message already enumerated every path, and
			* the list below enumerates them again with better reasons.
			*/
			const notice = signedOutNotice({
				selectionLost,
				message: status.status === "signed-out" ? status.message : void 0,
				searched
			});
			status.status === "error" || status.selectionExplicit;
			/**
			* Account-adding and account-migration controls, defined ONCE and rendered
			* in both sign-in states: inside the pool settings block when an account
			* exists, and in the signed-out branch when it does not (the pool section is
			* not rendered there at all). Two JSX copies would be free to drift, and the
			* two states are the same feature — a user who learns these controls in one
			* must find them in the same order in the other.
			*/
			const accountTools = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OAuthSignIn, {
				t,
				region: activeRegion,
				onAdded: () => refreshUsage(activeRegion)
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountTransfer, {
				t,
				region: activeRegion,
				onChanged: () => refreshUsage(activeRegion),
				accounts: status.status === "error" ? [] : status.accounts.map((account) => ({
					id: account.id,
					accountName: account.accountName
				}))
			})] });
			/**
			* WHERE the readout sits — a two-way choice, active tab's region only
			* (issue #62).
			*
			* It sits directly under the show/hide switch because the two answer one
			* question together ("show it, and where"), and because a user only reaches
			* for this when the default seat is unavailable — typically after installing
			* another plugin that occupies the composer row. Rendered as a `<select>`
			* rather than a pair of radios so it stays one compact row.
			*
			* LABEL LEFT, CONTROL RIGHT — the reverse of the first draft, which put the
			* select first. Under an always-visible caption the label is what the eye
			* scans for ("显示位置"), so it leads and the value follows; leading with the
			* control made it read as a second checkbox whose box happened to be a
			* dropdown. It also matches the reference settings screen, where the option
			* name sits left of its picker.
			*
			* Disabled with the region, exactly like the switch: a region that is off has
			* no readout to place.
			*/
			const creditPositionPicker = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
				className: "dsm-workbuddy-credit-position",
				value: activeRegionOn ? creditPositionOn(activeRegion) : "composer",
				disabled: !activeRegionOn || togglingCredits === activeRegion || !canWrite || saving || poolBusy,
				"aria-label": t("row.creditPositionAria", { region: activeRegion === "cn" ? t("row.tabCn") : t("row.tabGlobal") }),
				onChange: (event) => {
					changeCreditPosition(activeRegion, event.currentTarget.value === "stats" ? "stats" : "composer");
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: "composer",
					children: t("row.creditPositionComposer")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: "stats",
					children: t("row.creditPositionStats")
				})]
			});
			const creditPositionCaption = t("row.creditPositionHintInline");
			const creditPositionDisabledCaption = t("row.creditPositionDisabledHint");
			/**
			* The image tool opt-in, rendered above the credit preferences.
			*
			* It sits first because it is the only preference here that authorizes SPEND
			* rather than display: the credit line is a readout, this one lets the model
			* buy an image without asking again. Shown on BOTH tabs: each gateway now
			* publishes its own `text-to-image` model (CN `hunyuan-image-alpha`,
			* international `hy-image-3.5`, measured 2026-10-25), so the global box is no
			* longer a control that can never do anything. The flag is per-region and the
			* tool uses whichever region is BOTH enabled and switched on (CN first), so
			* ticking it here only ever authorizes spending on THIS tab.
			*/
			const imageToolPreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "dsm-workbuddy-pref",
				title: t("row.imageToolHint"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					className: "dsm-workbuddy-image-tool-check",
					checked: activeRegionOn ? imageToolOn(activeRegion) : false,
					disabled: !activeRegionOn || togglingCredits === activeRegion || !canWrite || saving || poolBusy,
					onChange: (event) => {
						toggleImageTool(activeRegion, event.target.checked);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-pref-copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-label",
						children: t("row.imageToolLabel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-hint",
						children: t("row.imageToolHint")
					})]
				})]
			});
			/**
			* The video-tool opt-in. Same shape and same stakes as imageToolPreference:
			* per-region, off means the tool is NOT registered at all (not "registered
			* but refusing"), so a tick here only ever authorizes spending on THIS tab.
			* The tool is an async task that runs tens of seconds to minutes.
			*/
			const videoToolPreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "dsm-workbuddy-pref",
				title: t("row.videoToolHint"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					className: "dsm-workbuddy-video-tool-check",
					checked: activeRegionOn ? videoToolOn(activeRegion) : false,
					disabled: !activeRegionOn || togglingCredits === activeRegion || !canWrite || saving || poolBusy,
					onChange: (event) => {
						toggleVideoTool(activeRegion, event.target.checked);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-pref-copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-label",
						children: t("row.videoToolLabel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-hint",
						children: t("row.videoToolHint")
					})]
				})]
			});
			/**
			* What this region can actually draw. The IMAGE rows stay read-only; the
			* VIDEO rows are pinnable in `videoModelPreference` below.
			*
			* The roster used to be read-only because every tag group held exactly one
			* model in both regions (measured 2026-10-25), so a dropdown would have been a
			* choice of one. That stopped being true for VIDEO: CN publishes two models
			* per video tag (`kling-video-v3` and `minimax-video-h3`) — the very
			* "两个模型能不能挑" question. The pin therefore lives in its own block below,
			* and the roster keeps answering "can this tab draw at all, and with what".
			*
			* Indented like the position picker, because it is a property of the switch
			* above it rather than a fourth independent setting.
			*/
			const mediaTagLabels = {
				"text-to-image": t("row.mediaTagTextToImage"),
				"image-to-image": t("row.mediaTagImageToImage"),
				"text-to-video": t("row.mediaTagTextToVideo"),
				"image-to-video": t("row.mediaTagImageToVideo")
			};
			const activeMedia = mediaByRegion[activeRegion];
			const videoModelPreference = !(activeRegionOn && videoToolOn(activeRegion)) || activeMedia === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-pref dsm-workbuddy-media",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-pref-copy",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-label",
							children: t("row.videoModelLabel")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-hint",
							children: t("row.videoModelHint")
						}),
						["text-to-video", "image-to-video"].map((tag) => {
							const group = activeMedia.filter((model) => model.tags.includes(tag));
							if (group.length === 0) return null;
							const pinned = preferredVideoModelOf(activeRegion, tag);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-workbuddy-media-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-media-tag",
									children: mediaTagLabels[tag] ?? tag
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dsm-workbuddy-video-model-select",
									value: group.some((model) => model.id === pinned) ? pinned : "",
									disabled: !canWrite || saving || poolBusy || pinningVideoModel !== void 0,
									onChange: (event) => {
										const next = event.target.value;
										pinVideoModel(activeRegion, tag, next === "" ? void 0 : next);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("row.videoModelDefault")
									}), group.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: model.id,
										children: model.name
									}, model.id))]
								})]
							}, tag);
						})
					]
				})
			});
			const mediaModelsPreference = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-pref dsm-workbuddy-media",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-pref-copy",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-workbuddy-pref-lead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: t("row.mediaModelsLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								disabled: mediaBusy || !activeRegionOn,
								onClick: () => {
									setMediaBusy(true);
									loadMediaModels(activeRegion, true).finally(() => {
										if (mounted.current) setMediaBusy(false);
									});
								},
								children: mediaBusy ? t("row.mediaModelsRefreshing") : t("row.mediaModelsRefresh")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-hint",
							children: t("row.mediaModelsHint")
						}),
						mediaError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-media-error",
							children: t("row.mediaModelsError", { message: mediaError })
						}) : activeMedia === void 0 ? null : activeMedia.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-media-empty",
							children: t("row.mediaModelsEmpty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dsm-workbuddy-media-list",
							children: activeMedia.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "dsm-workbuddy-media-row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-media-name",
										children: model.name
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-media-id",
										children: model.id
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-media-tags",
										children: model.tags.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-media-tag",
											children: mediaTagLabels[tag] ?? tag
										}, tag))
									})
								]
							}, model.id))
						})
					]
				})
			});
			/**
			* The CLI-route switch.
			*
			* GLOBAL, so it is not gated on the active tab's provider being on — the route
			* pulls its credential from whichever region still has a signed-in account.
			* Its own class (not `.dsm-workbuddy-pref-check`) for the same reason the image
			* box has one: the credit-switch suite's "exactly one switch" selector must
			* keep resolving to the credit box alone.
			*/
			const cliBridgePreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "dsm-workbuddy-pref",
				title: t("row.cliBridgeHint"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					className: "dsm-workbuddy-cli-bridge-check",
					checked: cliBridgeSwitchedOn(),
					disabled: !canWrite || saving || poolBusy || cliBridgeBusy,
					onChange: (event) => {
						toggleCliBridge(event.target.checked);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-pref-copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-label",
						children: t("row.cliBridgeLabel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-hint",
						children: t("row.cliBridgeHint")
					})]
				})]
			});
			/**
			* The sidebar-row switch (PR #188).
			*
			* Its own class for the reason the CLI box has one: the credit-switch suite's
			* "exactly one switch" selector (`.dsm-workbuddy-pref-check`) must keep
			* resolving to the credit box alone.
			*
			* NOT gated on the active tab's provider: the row is a property of the whole
			* plugin, not of one region, and a signed-out card can still turn it on.
			*/
			/**
			* The CN gateway override editor (issue #220).
			*
			* A DRAFT + explicit Save, unlike the switches above it: a host name is typed,
			* so committing per keystroke would write `https://w`, `https://wb`, … — six
			* settings writes and six `warn` log lines for one word. The switches commit on
			* the click precisely because a click IS a complete statement; a text field is
			* not.
			*
			* CN only. The international gateways follow the credential's own brand domain
			* (`workbuddy.ai` / `codebuddy.ai`), where an override against a host of a
			* DIFFERENT brand is rejected by the upstream — there is no "equivalent host"
			* to fall back to, so the control is absent on that tab rather than present and
			* unusable.
			*
			* The draft is validated HERE and not by the Host: the Host falls back to the
			* built-in gateway and logs, which keeps a running process correct but tells a
			* half-attending user nothing. Refusing the save with the specific rule it
			* broke ("not https" vs "not a CN brand") is what makes the setting findable.
			*/
			const cnBaseSaved = regionCnBaseOf(settingsScope?.getSnapshot().value, "cn");
			const cnBaseDraftValue = cnBaseDraft ?? cnBaseSaved;
			const cnBaseDirty = cnBaseDraft !== void 0 && cnBaseDraft.trim() !== cnBaseSaved.trim();
			const cnBasePreview = resolveCnGateway(cnBaseDraftValue);
			const saveCnBase = async () => {
				if (settingsScope === void 0 || cnBaseSaving) return;
				const resolved = cnBasePreview;
				if (!resolved.ok) {
					setCnBaseError(resolved.reason === "malformed" ? t("row.cnBaseInvalidMalformed") : resolved.reason === "insecure" ? t("row.cnBaseInvalidInsecure") : t("row.cnBaseInvalidHost"));
					return;
				}
				setCnBaseSaving(true);
				setCnBaseError(void 0);
				try {
					const next = resolved.overridden ? resolved.base : "";
					await writeRegionCnBase(settingsScope, "cn", next, nextRegionCnBase(settingsScope.getSnapshot().value, "cn", next));
					if (mounted.current) {
						setCnBaseDraft(void 0);
						setCnBaseNotice(t(next === "" ? "row.cnBaseCleared" : "row.cnBaseSaved"));
					}
					await refreshUsage("cn");
				} catch (error) {
					if (mounted.current) setCnBaseError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setCnBaseSaving(false);
				}
			};
			const cnBasePreference = activeRegion !== "cn" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-cnbase",
				title: t("row.cnBaseHint"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsm-workbuddy-cnbase-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-workbuddy-pref-copy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: t("row.cnBaseLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: t("row.cnBaseHint")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "url",
							className: "dsm-workbuddy-cnbase-input",
							value: cnBaseDraftValue,
							placeholder: t("row.cnBasePlaceholder"),
							disabled: !canWrite || saving || cnBaseSaving,
							spellCheck: false,
							autoComplete: "off",
							onChange: (event) => {
								setCnBaseDraft(event.target.value);
								setCnBaseError(void 0);
								setCnBaseNotice(void 0);
							}
						})]
					}),
					cnBaseError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-cnbase-error",
						role: "alert",
						children: cnBaseError
					}) : null,
					cnBaseError === void 0 && cnBaseNotice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-cnbase-notice",
						role: "status",
						children: cnBaseNotice
					}) : null,
					cnBaseDirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-cnbase-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: cnBaseSaving,
							onClick: () => {
								setCnBaseDraft(void 0);
								setCnBaseError(void 0);
								setCnBaseNotice(void 0);
							},
							children: t("row.poolDiscard")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-primary",
							disabled: cnBaseSaving,
							onClick: () => {
								saveCnBase();
							},
							children: cnBaseSaving ? t("row.poolSaving") : t("row.poolSaved")
						})]
					}) : null
				]
			});
			/**
			* The refresh cadence, as a five-option picker.
			*
			* It lives in the capability panel because it commits on the click like every
			* other control there — no Save button. A dropdown rather than a free number
			* because the offered set IS the validation: the same five values are what the
			* Host accepts, so the control cannot produce something the Host refuses.
			*
			* Placed last among the capability groups: it changes how often the plugin
			* ASKS, not what it may do, and it is the one control here whose effect is
			* purely about request volume.
			*/
			const pollIntervalPreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-prefs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-pref-hint",
					children: t("row.pollIntervalLead")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					className: "dsm-workbuddy-pref dsm-workbuddy-upstream-pref",
					title: t("row.pollIntervalHint"),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-pref-copy",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: t("row.pollIntervalLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: t("row.pollIntervalHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "dsm-workbuddy-credit-position",
								value: String(pollIntervalValue()),
								disabled: !canWrite || saving || poolBusy || pollIntervalBusy,
								"aria-label": t("row.pollIntervalAria"),
								onChange: (event) => {
									const next = Number(event.currentTarget.value);
									if (!WORKBUDDY_POLL_INTERVALS_MS.includes(next)) return;
									changePollInterval(next);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: String(6e4),
										children: t("row.pollInterval1m")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: String(3e5),
										children: t("row.pollInterval5m")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: String(6e5),
										children: t("row.pollInterval10m")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: String(18e5),
										children: t("row.pollInterval30m")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: String(36e5),
										children: t("row.pollInterval60m")
									})
								]
							})
						]
					})
				})]
			});
			const sidebarPanelPreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-prefs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-pref-hint",
					children: t("row.sidebarPanelLead")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dsm-workbuddy-pref",
					title: t("row.sidebarPanelHint"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						className: "dsm-workbuddy-sidebar-panel-check",
						checked: sidebarPanelSwitchedOn(),
						disabled: !canWrite || saving || poolBusy || sidebarPanelBusy,
						onChange: (event) => {
							toggleSidebarPanel(event.target.checked);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-pref-copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-label",
							children: t("row.sidebarPanelLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-hint",
							children: t("row.sidebarPanelHint")
						})]
					})]
				})]
			});
			/**
			* The two quick-adjust pins of the CLI route, rendered under its switch the
			* way the seat picker sits under its switch: indented, and only while the
			* switch is ON — the pickers configure the route the switch turned on, and
			* they disappear together with it.
			*
			* The model options are the active tab's LIVE catalog (`visibleModels`), so
			* they follow the upstream instead of a hardcoded list; a pinned value the
			* catalog does not list is still offered as its own option rather than
			* vanishing from the select. The effort options are the six CLI tiers,
			* narrowed to the pinned model's `reasoning.supportedEfforts` when that
			* model is in the catalog and names tiers the CLI knows.
			*/
			const cliBridgeModelPinned = cliBridgeModelValue();
			const cliBridgeModelOptions = visibleModels.map((model) => ({
				value: model.id,
				label: model.name !== model.id ? model.name : model.id
			}));
			if (cliBridgeModelPinned !== "" && !cliBridgeModelOptions.some((option) => option.value === cliBridgeModelPinned)) cliBridgeModelOptions.push({
				value: cliBridgeModelPinned,
				label: cliBridgeModelPinned
			});
			const cliBridgeEffortPinned = cliBridgeEffortValue();
			const pinnedCliBridgeTiers = visibleModels.find((model) => model.id === cliBridgeModelPinned)?.reasoning?.supportedEfforts;
			const cliBridgeEffortLevels = (() => {
				if (pinnedCliBridgeTiers === void 0 || pinnedCliBridgeTiers.length === 0) return [...CLI_BRIDGE_EFFORT_LEVELS];
				const known = CLI_BRIDGE_EFFORT_LEVELS.filter((level) => pinnedCliBridgeTiers.includes(level));
				return known.length > 0 ? known : [...CLI_BRIDGE_EFFORT_LEVELS];
			})();
			if (cliBridgeEffortPinned !== "" && !cliBridgeEffortLevels.includes(cliBridgeEffortPinned)) cliBridgeEffortLevels.push(cliBridgeEffortPinned);
			const cliBridgeRegionOrderPinned = cliBridgeRegionOrderValue();
			const cliBridgeRegionOrderOptions = CLI_BRIDGE_REGION_ORDERS.map((order) => ({
				value: order,
				label: order === "cn,global" ? t("row.cliBridgeRegionOrderCnFirst") : order === "global,cn" ? t("row.cliBridgeRegionOrderGlobalFirst") : order === "cn" ? t("row.cliBridgeRegionOrderCnOnly") : t("row.cliBridgeRegionOrderGlobalOnly")
			}));
			if (cliBridgeRegionOrderOptions.every((option) => option.value !== cliBridgeRegionOrderPinned)) cliBridgeRegionOrderOptions.push({
				value: cliBridgeRegionOrderPinned,
				label: cliBridgeRegionOrderPinned
			});
			const cliBridgePickers = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-pref dsm-workbuddy-pref-indent",
				title: t("row.cliBridgePickersHint"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-pref-copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-pref-lead dsm-workbuddy-cli-bridge-pickers",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-workbuddy-cli-bridge-pick",
								title: t("row.cliBridgeModelHint"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-pref-label",
									children: t("row.cliBridgeModelLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dsm-workbuddy-cli-bridge-select",
									value: cliBridgeModelPinned,
									disabled: !canWrite || saving || poolBusy || cliBridgeModelBusy || cliBridgeEffortBusy || cliBridgeRegionOrderBusy,
									"aria-label": t("row.cliBridgeModelAria"),
									onChange: (event) => {
										pickCliBridgeModel(event.currentTarget.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("row.cliBridgeModelDefault")
									}), cliBridgeModelOptions.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: option.value,
										children: option.label
									}, option.value))]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-workbuddy-cli-bridge-pick",
								title: t("row.cliBridgeEffortHint"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-pref-label",
									children: t("row.cliBridgeEffortLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dsm-workbuddy-cli-bridge-select",
									value: cliBridgeEffortPinned,
									disabled: !canWrite || saving || poolBusy || cliBridgeModelBusy || cliBridgeEffortBusy || cliBridgeRegionOrderBusy,
									"aria-label": t("row.cliBridgeEffortAria"),
									onChange: (event) => {
										pickCliBridgeEffort(event.currentTarget.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("row.cliBridgeEffortDefault")
									}), cliBridgeEffortLevels.map((level) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: level,
										children: level
									}, level))]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-workbuddy-cli-bridge-pick",
								title: t("row.cliBridgeRegionOrderHint"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-pref-label",
									children: t("row.cliBridgeRegionOrderLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "dsm-workbuddy-cli-bridge-select",
									value: cliBridgeRegionOrderPinned,
									disabled: !canWrite || saving || poolBusy || cliBridgeModelBusy || cliBridgeEffortBusy || cliBridgeRegionOrderBusy,
									"aria-label": t("row.cliBridgeRegionOrderAria"),
									onChange: (event) => {
										pickCliBridgeRegionOrder(event.currentTarget.value);
									},
									children: cliBridgeRegionOrderOptions.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: option.value,
										children: option.label
									}, option.value))
								})]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-hint",
						children: t("row.cliBridgePickersHint")
					})]
				})
			});
			/**
			* The upstream-identity switches (issue #133 suggestions 2 and 3).
			*
			* These govern what the gateway SEES and how it files the call, not which
			* provider serves it, so they sit in their own group with their own heading
			* instead of the preference list below (which is all about the card's own
			* display choices). Every one of them was already settable by hand in
			* `cordis.patch.yml`; this is only a UI route to the same fields.
			*
			* ONE shared hint about reloading, not one per switch: all four are sampled
			* when the plugin mounts into the shim, so the rule and its reason are the
			* same sentence for each, and repeating it four times would bury it.
			*/
			const upstreamSwitches = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-prefs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-pref-hint",
					children: t("row.upstreamHint")
				}), [
					[
						"usageIdentity",
						"row.usageIdentityLabel",
						"row.usageIdentityHint",
						usageIdentityValue(),
						usageIdentityBusy,
						setUsageIdentityOn
					],
					[
						"keepPromptLast",
						"row.keepPromptLastLabel",
						"row.keepPromptLastHint",
						keepPromptLastValue(),
						keepPromptLastBusy,
						setKeepPromptLastOn
					],
					[
						"sessionTitle",
						"row.sessionTitleLabel",
						"row.sessionTitleHint",
						sessionTitleValue().enabled,
						sessionTitleBusy,
						setSessionTitleOn
					]
				].map(([field, labelKey, hintKey, on, busy, setOwn]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dsm-workbuddy-pref dsm-workbuddy-upstream-pref",
					title: t(hintKey),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						className: "dsm-workbuddy-upstream-check",
						checked: on,
						disabled: !canWrite || saving || poolBusy || busy,
						onChange: (event) => {
							toggleUpstreamSwitch(field, event.target.checked);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-pref-copy",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: t(labelKey)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: t(hintKey)
							}),
							field === "sessionTitle" && on ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: [
									t("row.sessionTitleModel"),
									" ",
									sessionTitleValue().model
								]
							}) : null,
							field === "keepPromptLast" && on && extraInjectedPrefixes().length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: [
									t("row.extraPrefixesCount"),
									" ",
									extraInjectedPrefixes().length
								]
							}) : null
						]
					})]
				}, field))]
			});
			/**
			* The opt-in auto-continue after a channel-gate refusal.
			*
			* Its own group, NOT a row in {@link upstreamSwitches} above, because it
			* breaks that group's one shared promise: those four are sampled when the
			* plugin mounts and need a reload, while this one is read on every failure and
			* takes effect immediately. Hiding that difference behind a shared hint would
			* teach the user the wrong rule for exactly the switch where being wrong is
			* expensive — this one spends real requests.
			*
			* The cap and the text are REPORTED while the switch is on, not edited: both
			* already live in the config file, and the cap is the one number the user asked
			* to be exactly 3, so an unvalidated free-text field here would be a second way
			* to get it wrong.
			*/
			const channelRejectContinuePreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-prefs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-pref-hint",
					children: t("row.channelRejectHint")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dsm-workbuddy-pref dsm-workbuddy-upstream-pref",
					title: t("row.channelRejectContinueHint"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						className: "dsm-workbuddy-channel-continue-check",
						checked: channelRejectContinueValue().enabled,
						disabled: !canWrite || saving || poolBusy || channelRejectContinueBusy,
						onChange: (event) => {
							toggleUpstreamSwitch("channelRejectContinue", event.target.checked);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-pref-copy",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: t("row.channelRejectContinueLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: t("row.channelRejectContinueHint")
							}),
							channelRejectContinueValue().enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: [
									t("row.channelRejectContinueLimit"),
									" ",
									String(channelRejectContinueValue().maxConsecutive),
									" · ",
									t("row.channelRejectContinueText"),
									" ",
									channelRejectContinueValue().text
								]
							}) : null
						]
					})]
				})]
			});
			/**
			* ISSUE #213: redact past reasoning from the request.
			*
			* Its own group rather than a row inside the channel-reject block, because the
			* two answer different failures: that switch RESENDS after a refusal, this one
			* removes the text that gets scanned in the first place. Grouping them would
			* imply they are alternatives of one feature.
			*/
			const dropAllThinkingPreference = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-prefs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-pref-hint",
					children: t("row.dropAllThinkingLead")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dsm-workbuddy-pref dsm-workbuddy-upstream-pref",
					title: t("row.dropAllThinkingHint"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						className: "dsm-workbuddy-drop-thinking-check",
						checked: dropAllThinkingValue(),
						disabled: !canWrite || saving || poolBusy || dropAllThinkingBusy,
						onChange: (event) => {
							toggleUpstreamSwitch("dropAllThinking", event.target.checked);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-pref-copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-label",
							children: t("row.dropAllThinkingLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-pref-hint",
							children: t("row.dropAllThinkingHint")
						})]
					})]
				})]
			});
			const creditPreferences = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-prefs",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-pref-hint",
						children: t("row.modelToolsHint")
					}),
					cliBridgePreference,
					cliBridgeSwitchedOn() ? cliBridgePickers : null,
					imageToolPreference,
					videoToolPreference,
					videoModelPreference,
					mediaModelsPreference,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsm-workbuddy-pref",
						title: activeRegion === "cn" ? t("row.showCreditsCnHint") : t("row.showCreditsGlobalHint"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							className: "dsm-workbuddy-pref-check",
							checked: activeRegionOn ? creditsShownOn(activeRegion) : false,
							disabled: !activeRegionOn || togglingCredits === activeRegion || !canWrite || saving || poolBusy,
							onChange: (event) => {
								toggleCredits(activeRegion, event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-workbuddy-pref-copy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: activeRegion === "cn" ? t("row.showCreditsCn") : t("row.showCreditsGlobal")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: t("row.showCreditsHintInline")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsm-workbuddy-pref",
						title: t("row.showNewModelsHint"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							className: "dsm-workbuddy-new-models-check",
							checked: activeRegionOn ? newModelsShownOn(activeRegion) : false,
							disabled: !activeRegionOn || togglingNewModels === activeRegion || !canWrite || saving || poolBusy,
							onChange: (event) => {
								toggleNewModels(activeRegion, event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-workbuddy-pref-copy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-label",
								children: t("row.showNewModels")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: t("row.showNewModelsHintInline")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: "dsm-workbuddy-pref dsm-workbuddy-pref-indent",
						title: t("row.creditPositionHint"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-workbuddy-pref-copy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-workbuddy-pref-lead",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-pref-label",
									children: t("row.creditPositionLabel")
								}), creditPositionPicker]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-pref-hint",
								children: activeRegionOn ? creditPositionCaption : creditPositionDisabledCaption
							})]
						})
					})
				]
			});
			/**
			* The page header: the sidebar panel's own page, and the Settings section.
			*
			* Both are "a page about WorkBuddy" rather than a row in someone else's list,
			* so both say what this is in one line. They differ in exactly one control:
			* the sidebar page needs a way back to the conversation, while the Settings
			* section is inside a dialog the shell closes for you — a back arrow there
			* would point at a place the reader did not come from.
			*/
			const pageHead = pageSurface || settingsSurface ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settingsSurface ? "dsm-workbuddy-page-head dsm-workbuddy-settings-head" : "dsm-workbuddy-page-head",
				children: [
					pageSurface && backToConversation !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsm-workbuddy-page-back",
						onClick: backToConversation,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							width: "14",
							height: "14",
							viewBox: "0 0 16 16",
							fill: "none",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: "M10 3.5 5.5 8l4.5 4.5",
								stroke: "currentColor",
								strokeWidth: "1.6",
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("nav.back") })]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginIcon, { className: "dsm-workbuddy-page-icon" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-page-title",
						children: title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-page-desc",
						children: t("row.desc")
					})
				]
			}) : null;
			const cardBody = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardBodyBoundary, {
				t,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-usage",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-tabs",
							role: "tablist",
							"aria-label": title,
							children: WORKBUDDY_REGIONS.map((region) => {
								const regionStatus = statusByRegion[region];
								const regionOnState = regionOn(region);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-tab-cell",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										role: "tab",
										"aria-selected": region === activeRegion,
										className: `dsm-workbuddy-tab${region === activeRegion ? " dsm-workbuddy-tab-active" : ""}${regionOnState ? "" : " dsm-workbuddy-tab-off"}`,
										onClick: () => {
											setActiveRegion(region);
											setAccountError(void 0);
										},
										children: [regionStatus === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											className: "dsm-workbuddy-tab-dot",
											style: dotStyle(regionStatus.status)
										}), region === "cn" ? t("row.tabCn") : t("row.tabGlobal")]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "dsm-workbuddy-tab-switch",
										title: t("row.tabSwitchHint"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: regionOnState,
											disabled: togglingRegion === region || !canWrite || saving || poolBusy,
											"aria-label": t("row.tabSwitchAria", { region: region === "cn" ? t("row.tabCn") : t("row.tabGlobal") }),
											onChange: (event) => {
												toggleRegion(region, event.target.checked);
											}
										})
									})]
								}, region);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-models-summary dsm-workbuddy-tab-hint",
							children: t("row.tabHint")
						}),
						signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-panels",
							role: "tablist",
							"aria-label": t("row.panelAria"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									id: "dsm-workbuddy-tab-accounts",
									"aria-controls": "dsm-workbuddy-panel-accounts",
									"aria-selected": panel === "accounts",
									className: `dsm-workbuddy-panel-tab${panel === "accounts" ? " dsm-workbuddy-panel-tab-active" : ""}`,
									onClick: () => {
										setPanel("accounts");
									},
									children: t("row.panelAccounts")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									id: "dsm-workbuddy-tab-models",
									"aria-controls": "dsm-workbuddy-panel-models",
									"aria-selected": panel === "models",
									className: `dsm-workbuddy-panel-tab${panel === "models" ? " dsm-workbuddy-panel-tab-active" : ""}`,
									onClick: () => {
										setPanel("models");
									},
									children: t("row.panelModels")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									id: "dsm-workbuddy-tab-capabilities",
									"aria-controls": "dsm-workbuddy-panel-capabilities",
									"aria-selected": panel === "capabilities",
									className: `dsm-workbuddy-panel-tab${panel === "capabilities" ? " dsm-workbuddy-panel-tab-active" : ""}`,
									onClick: () => {
										setPanel("capabilities");
									},
									children: t("row.panelCapabilities")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									id: "dsm-workbuddy-tab-diag",
									"aria-controls": "dsm-workbuddy-panel-diag",
									"aria-selected": panel === "diag",
									className: `dsm-workbuddy-panel-tab${panel === "diag" ? " dsm-workbuddy-panel-tab-active" : ""}`,
									onClick: () => {
										setPanel("diag");
									},
									children: t("row.panelDiag")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									id: "dsm-workbuddy-tab-sdk",
									"aria-controls": "dsm-workbuddy-panel-sdk",
									"aria-selected": panel === "sdk",
									className: `dsm-workbuddy-panel-tab${panel === "sdk" ? " dsm-workbuddy-panel-tab-active" : ""}`,
									onClick: () => {
										setPanel("sdk");
									},
									children: t("row.panelSdk")
								})
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-panel",
							role: "tabpanel",
							id: "dsm-workbuddy-panel-accounts",
							"aria-labelledby": "dsm-workbuddy-tab-accounts",
							hidden: signedIn && panel !== "accounts",
							children: [
								!activeRegionOn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-tab-off-notice",
									children: t("row.tabOffNotice")
								}) : null,
								status.status === "error" || status.status === "signed-in" && status.creditsError !== void 0 ? status.status === "signed-in" && status.credentialRejected === true ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-usage-hint",
									children: t("row.reloginHint")
								}) : null,
								accountError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-account-error",
									role: "alert",
									children: accountError
								}),
								selectionLost ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-usage-hint",
									children: t("row.selectionLostHint")
								}) : null,
								vaultUnreadable !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-account-error",
									role: "alert",
									children: t("row.vaultUnreadableHint", { message: vaultUnreadable })
								}) : null,
								status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									status.credentialRejected === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "dsm-workbuddy-usage-error",
										role: "alert",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("row.credentialRejectedTitle") }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedIntro", { accountName: nameOf(status.accountName) }) }),
											status.recovery?.usableAccount !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedSwitch", { accountName: nameOf(status.recovery.usableAccount.accountName) }) }) : status.recovery?.reloginRequired === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedRelogin") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedChoose") }),
											status.recovery?.usableAccount === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-btn dsm-btn-outline",
												disabled: switchingAccount || !canWrite,
												onClick: () => {
													const target = status.recovery?.usableAccount;
													if (target !== void 0) switchAccount(target.accountId);
												},
												children: switchingAccount ? t("row.accountsScanning") : t("row.credentialRejectedSwitchAction", { accountName: nameOf(status.recovery.usableAccount.accountName) })
											})
										]
									}) : null,
									status.creditsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-workbuddy-usage-error",
										children: t("row.creditsError", { message: status.creditsError })
									}),
									status.refreshError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-workbuddy-usage-error",
										role: "alert",
										children: t("row.requestFailedHint", { message: status.refreshError })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountPool, {
										t,
										region: activeRegion,
										...status.pool === void 0 ? {} : { pool: status.pool },
										...settingsScope === void 0 ? {} : { settingsScope },
										onRescan: () => {
											rescanAccounts();
										},
										rescanning: busy,
										onSelectAccount: (accountId) => {
											switchAccount(accountId);
										},
										selectingAccount: switchingAccount,
										accountTools,
										siblingBusy: saving || togglingRegion !== void 0,
										onBusyChange: setPoolBusy,
										onSaved: async () => await refreshUsage(activeRegion) !== void 0,
										onRefresh: () => refreshUsage(activeRegion),
										...deviceSettings === void 0 ? {} : {
											deviceMode: deviceSettings.mode,
											deviceProfiles: deviceSettings.accounts,
											...deviceSettings.derived === void 0 ? {} : { deviceDerived: deviceSettings.derived },
											onDeviceModeChange: changeDeviceMode,
											onSaveDeviceProfile: saveDeviceProfile,
											...deviceSettings.realTier === void 0 ? {} : { realTier: deviceSettings.realTier }
										}
									})
								] }) : null
							]
						}),
						signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-panel",
							role: "tabpanel",
							id: "dsm-workbuddy-panel-models",
							"aria-labelledby": "dsm-workbuddy-tab-models",
							hidden: panel !== "models",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
								className: "dsm-workbuddy-models",
								"aria-label": t("row.modelsTitle"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-models-fold",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-workbuddy-models-head",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsm-workbuddy-models-title-row",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
													className: "dsm-workbuddy-models-title",
													children: [t("row.modelsTitle"), dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-models-dirty",
														children: t("row.modelsDirty")
													}) : null]
												})
											}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-workbuddy-models-head-actions",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline",
														disabled: busy,
														onClick: () => {
															refreshModels();
														},
														children: busy ? t("row.modelsRefreshing") : t("row.modelsRefresh")
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline dsm-workbuddy-models-sweep",
														disabled: busy || sweeping !== void 0 || activeEnabledIds.size === 0,
														title: t("row.modelsTestEnabledHint"),
														onClick: sweepEnabledModels,
														children: sweeping === void 0 ? t("row.modelsTestEnabled") : t("row.modelsTesting", {
															done: sweeping.done,
															total: sweeping.total
														})
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline dsm-workbuddy-models-sweep",
														disabled: busy || tpsSweeping !== void 0 || tpsBusy || activeEnabledIds.size === 0,
														title: t("row.tpsSweepEnabledHint"),
														onClick: sweepTpsEnabledModels,
														children: tpsSweeping === void 0 ? t("row.tpsSweepEnabled") : t("row.tpsTesting", {
															done: tpsSweeping.done,
															total: tpsSweeping.total
														})
													})
												]
											})]
										}),
										probeError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-bad",
											role: "alert",
											children: t("row.probeError", { message: probeError })
										}),
										sweepSummary === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-models-sweep-summary",
											role: "status",
											children: sweepSummary
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsm-workbuddy-model-list",
											children: visibleModels.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: `dsm-workbuddy-model${activeEnabledIds.has(model.id) ? "" : " dsm-workbuddy-model-disabled"}`,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-workbuddy-model-head",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
															className: "dsm-workbuddy-model-enabled",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																type: "checkbox",
																checked: activeEnabledIds.has(model.id),
																disabled: !canWrite || saving,
																onChange: () => {
																	toggleModel(model.id);
																}
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: "dsm-workbuddy-model-copy",
																children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																		className: "dsm-workbuddy-model-name",
																		children: [model.name, effectiveRate(model) === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																			className: "dsm-workbuddy-model-name-rate",
																			children: ["x", effectiveRate(model).toFixed(2)]
																		})]
																	}),
																	promoChip(model),
																	busyIcon(busyLevels[model.id], uiLanguage())
																]
															})]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsm-workbuddy-model-controls",
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																	className: "dsm-workbuddy-model-image",
																	title: imageCheckboxHint(model, t),
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																		type: "checkbox",
																		checked: activeImageIds.has(model.id),
																		disabled: !canWrite || saving,
																		onChange: () => {
																			toggleImage(model.id);
																		}
																	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelImage") })]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																	className: `dsm-workbuddy-model-off${offBlocked(model) ? " dsm-workbuddy-model-off-blocked" : ""}`,
																	title: offBlocked(model) ? t("row.modelOffRefusedHint") : t("row.modelOffHint"),
																	children: [
																		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																			type: "checkbox",
																			checked: activeOffIds.has(model.id),
																			disabled: !canWrite || saving || offBlocked(model),
																			onChange: () => {
																				toggleOff(model.id);
																			}
																		}),
																		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelOff") }),
																		offBlocked(model) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																			className: "dsm-workbuddy-model-off-flag",
																			children: t("row.modelOffRefused")
																		}) : null
																	]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
																	className: "dsm-workbuddy-context-budget",
																	"aria-label": t("row.contextBudget"),
																	value: String(effectiveContextBudget(model.nativeContextWindow, activeContextBudgets[model.id])),
																	disabled: !canWrite || saving,
																	onChange: (event) => {
																		const picked = Number(event.target.value);
																		setContextBudget(model.id, picked === model.nativeContextWindow ? void 0 : picked);
																	},
																	children: [
																		model.nativeContextWindow > 2e5 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																			value: 2e5,
																			children: "200K"
																		}) : null,
																		model.nativeContextWindow > 5e5 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																			value: 5e5,
																			children: "500K"
																		}) : null,
																		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																			value: model.nativeContextWindow,
																			children: formatCapacity(model.nativeContextWindow, t("row.modelUnknown"))
																		})
																	]
																})
															]
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-workbuddy-model-details",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsm-workbuddy-model-meta",
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelContext", { context: formatCapacity(model.nativeContextWindow, t("row.modelUnknown")) }) }),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelOutput", { output: formatCapacity(model.maxTokens, t("row.modelUnknown")) }) }),
																(() => {
																	const efforts = selectableEfforts(model.reasoning);
																	if (efforts.length === 0) return null;
																	const saved = activeDefaultEfforts[model.id];
																	const chosen = typeof saved === "string" && efforts.includes(saved) ? saved : "";
																	const follow = defaultEffortFor(model);
																	const followLabel = follow !== void 0 ? t("row.modelEffortFollowNamed", { effort: follow }) : t("row.modelEffortFollow");
																	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																		className: "dsm-workbuddy-model-effort",
																		title: t("row.modelEffortHint"),
																		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelEffortLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
																			className: "dsm-workbuddy-model-effort-select",
																			value: chosen,
																			disabled: !canWrite || saving,
																			"aria-label": t("row.modelEffortAria", { model: model.name }),
																			onChange: (event) => {
																				setDefaultThinkingEffort(model.id, event.currentTarget.value);
																			},
																			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																				value: "",
																				children: followLabel
																			}), efforts.map((level) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																				value: level,
																				children: level
																			}, level))]
																		})]
																	});
																})()
															]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsm-workbuddy-model-actions-buttons",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-btn dsm-btn-outline dsm-workbuddy-model-probe",
																disabled: probing[model.id] === true || status.status !== "signed-in",
																title: t("row.probeHint"),
																onClick: () => {
																	probeModels([model.id]);
																},
																children: probing[model.id] === true ? t("row.probing") : t("row.probe")
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-btn dsm-btn-outline dsm-workbuddy-model-probe",
																disabled: tpsProbing[model.id] === true || status.status !== "signed-in",
																title: t("row.tpsHint"),
																onClick: () => {
																	measureTpsFor([model.id]);
																},
																children: tpsProbing[model.id] === true ? t("row.tpsMeasuring") : t("row.tpsMeasure")
															})]
														})]
													}),
													(() => {
														const result = probes[activeRegion]?.[model.id];
														if (result === void 0) return null;
														const view = probeResultView(result, t);
														const reason = inlineProbeReason(result.outcome, result.message);
														return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
															className: `dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-${view.tone}`,
															role: "status",
															...result.message === void 0 ? {} : { title: result.message },
															children: [view.text, reason === void 0 ? null : " · " + reason]
														});
													})(),
													(() => {
														const measured = tpsResults[model.id];
														if (measured === void 0) return null;
														const view = tpsResultView(measured, t, tpsMeasuredAt[model.id]);
														return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: `dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-${view.tone}`,
															role: "status",
															children: view.text
														});
													})()
												]
											}, model.id))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-model-capability-note",
											children: t("row.modelCapabilityPending")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-workbuddy-model-actions",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
													className: "dsm-workbuddy-usage-cheer",
													href: WORKBUDDY_GITHUB_URL,
													target: "_blank",
													rel: "noopener noreferrer",
													children: [t("row.cheer"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-usage-cheer-star",
														"aria-hidden": "true",
														children: "★"
													})]
												}),
												saveError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-workbuddy-model-save-error",
													children: t("row.saveError", { message: saveError })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-workbuddy-model-actions-buttons",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline",
														disabled: !dirty || saving || poolBusy || togglingRegion !== void 0,
														onClick: discardModels,
														children: t("row.discard")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-primary",
														disabled: !dirty || saving || poolBusy || togglingRegion !== void 0 || activeEnabledIds.size === 0,
														onClick: () => {
															saveModels();
														},
														children: saving ? t("row.saving") : t("row.save")
													})]
												})
											]
										})
									]
								})
							})
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-panel",
							role: "tabpanel",
							id: "dsm-workbuddy-panel-capabilities",
							"aria-labelledby": "dsm-workbuddy-tab-capabilities",
							hidden: signedIn && panel !== "capabilities",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-panel-note",
									children: t("row.panelCapabilitiesHint")
								}),
								cnBasePreference,
								creditPreferences,
								upstreamSwitches,
								channelRejectContinuePreference,
								dropAllThinkingPreference,
								sidebarPanelPreference,
								pollIntervalPreference,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-prefs",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-pref-hint",
										children: t("row.iconStyleLead")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconStylePreference, { t })]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-panel",
							role: "tabpanel",
							id: "dsm-workbuddy-panel-diag",
							"aria-labelledby": "dsm-workbuddy-tab-diag",
							hidden: !signedIn || panel !== "diag",
							children: status.status !== "signed-in" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-diag",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagRegion")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value",
											children: status.region === "cn" ? t("row.tabCn") : t("row.tabGlobal")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagDomain")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value dsm-workbuddy-diag-mono",
											children: status.domain === void 0 || status.domain === "" ? t("row.modelUnknown") : status.domain
										})]
									}),
									status.region === "cn" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagCnBase")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value dsm-workbuddy-diag-mono",
											children: (() => {
												const resolved = resolveCnGateway(regionCnBaseOf(settingsScope?.getSnapshot().value, "cn"));
												return resolved.ok && resolved.overridden ? resolved.base : t("row.diagCnBaseDefault");
											})()
										})]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagAccount")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value",
											children: nameOf(status.accountName)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagToken")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value dsm-workbuddy-diag-mono",
											children: formatDate(status.tokenExpiresAtMs)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagCatalog")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value",
											children: formatNumber(status.models.length)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagEnabled")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value",
											children: formatNumber(status.enabledModelIds.length)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagPool")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-value",
											children: status.pool?.enabled === true ? t("row.diagPoolOn", { count: status.pool.accounts.length }) : t("row.diagPoolOff")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-diag-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-diag-label",
											children: t("row.diagFailures")
										}), (() => {
											const failures = [];
											if (status.credentialRejected === true) failures.push(t("row.credentialRejectedTitle"));
											if (status.refreshError !== void 0) failures.push(status.refreshError);
											if (status.creditsError !== void 0) failures.push(status.creditsError);
											const unreadable = status.models.reduce((count, model) => count + (model.promos ?? []).filter((promo) => promo.schedule?.dailyUnusable === true).length, 0);
											if (unreadable > 0) failures.push(t("row.diagPromoUnreadable", { count: unreadable }));
											return failures.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-workbuddy-diag-value",
												children: t("row.diagNoFailures")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-workbuddy-diag-value dsm-workbuddy-diag-bad dsm-workbuddy-diag-mono",
												children: failures.join(" · ")
											});
										})()]
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-diag-hint",
								children: t("row.diagHint")
							})] })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-panel",
							role: "tabpanel",
							id: "dsm-workbuddy-panel-sdk",
							"aria-labelledby": "dsm-workbuddy-tab-sdk",
							hidden: !signedIn || panel !== "sdk",
							children: panel === "sdk" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeviceSdkPanel, {
								t,
								path: WORKBUDDY_DEVICE_SDK_PATH,
								settingsPath: WORKBUDDY_DEVICE_PROFILE_PATH
							}) : null
						}),
						status.status === "signed-out" && loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-workbuddy-usage-text",
							role: "status",
							children: t("row.accountsLoading")
						}) : null,
						status.status === "signed-out" && !loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-usage-text",
								children: signedOutText(notice, t)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-workbuddy-usage-account-actions",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									disabled: busy,
									onClick: () => {
										rescanAccounts();
									},
									children: busy ? t("row.accountsScanning") : t("row.accountsRescan")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-workbuddy-pool-tools",
								children: accountTools
							}),
							searched.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchedPaths, {
								items: searched,
								t
							}) : null
						] }) : null,
						status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-usage-error-block",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-usage-error",
								role: "alert",
								children: t("row.usageErrorHint", { message: status.message === "" ? t("row.requestFailed") : status.message })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-outline",
								onClick: () => {
									statusRetries.current = 0;
									refreshUsage(activeRegion);
								},
								children: t("row.usageRetry")
							})]
						}) : null
					]
				})
			});
			if (pageSurface || settingsSurface) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settingsSurface ? "dsm-workbuddy-page dsm-workbuddy-settings" : "dsm-workbuddy-page",
				ref: (page) => {
					if (page !== null) requestAnimationFrame(() => {
						updateStickyTabs(page);
					});
				},
				onScroll: (event) => {
					updateStickyTabs(event.currentTarget);
				},
				children: [pageHead, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-workbuddy-page-body",
					children: cardBody
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: `dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsm-plugin-card-header",
					"aria-expanded": open,
					"aria-label": `${t(open ? "row.collapse" : "row.expand")}: ${title}`,
					onClick: () => {
						setCardOpen(!cardOpen);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginIcon, { className: "dsm-plugin-card-icon" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-plugin-card-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-plugin-card-title",
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-plugin-card-description",
								children: t("row.desc")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							className: `dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-plugin-card-body",
					hidden: !open,
					children: open ? cardBody : null
				})]
			});
		}
		//#endregion
		//#region src/client/popover.ts
		/**
		* The two shell behaviours the composer credit panel needs: hanging the panel
		* off its trigger, and dismissing it on an outside press.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 该项目的 `client/popover.ts`，逐条沿用其判断：同样的上下放置、同样的
		*     视口收边、同样的 scroll(capture)/resize/自身尺寸变化重测、同样的
		*     「pointerdown 落在触发器与面板之外即关闭」。这些不是随手写的——那边
		*     2.12.0/2.13.0 的客户端加载失败与面板位置错乱都留下了记录，这里直接
		*     采用其最终结论。
		*
		* Implemented locally rather than imported from
		* `@deepseek-ai/dsh-client-ui-primitives`. The shell DOES register that package
		* for plugin bundles, so importing it is legal — this is a deliberate choice,
		* not a workaround: the two behaviours are ~40 lines of DOM geometry, and owning
		* them keeps this component renderable in the Node test suite without mocking a
		* package that itself reaches `*.module.css` and further DSH dependencies.
		*
		* NOTE ON A MISDIAGNOSIS, kept because it is the kind of thing that gets
		* re-litigated: the client load failure on the referring project was first
		* attributed to importing the primitives package. It was not that. The real
		* cause was `import { createPortal } from 'react-dom'` being BUNDLED rather than
		* externalized — the inlined development build opens with
		* `process.env.NODE_ENV` and threw `ReferenceError: process is not defined` in
		* the browser, at module-evaluation time, so the ENTIRE client half failed to
		* import. See `tsdown.config.ts` (`CLIENT_EXTERNALS`) for the fix and
		* `tests/client-runtime-imports.spec.ts` for the rule that now pins it.
		*/
		/**
		* Clearance to keep from the top of the viewport.
		*
		* The shell reserves a strip at the top of the frame
		* (`--dsh-frame-top-clearance`) for the window chrome, so a panel clamped to
		* `margin` alone can still land under it. Absent variable or no `data-fullscreen`
		* distinction is handled the same way the shell does: fall back to `min`.
		*/
		function overlayTopMargin(min) {
			if (typeof document === "undefined") return min;
			const root = document.documentElement;
			const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue("--dsh-frame-top-clearance"));
			if (Number.isNaN(clearance)) return min;
			return Math.max(min, (root.hasAttribute("data-fullscreen") ? 0 : clearance) + 20);
		}
		/** Keep a `position: fixed` floating element anchored to a trigger. */
		function useAnchoredPosition(options) {
			const { open, anchorRef, panelRef, side = "bottom", align = "start", gap, margin } = options;
			const [position, setPosition] = (0, react.useState)(null);
			(0, react.useLayoutEffect)(() => {
				if (!open) {
					setPosition(null);
					return;
				}
				const place = () => {
					const rect = anchorRef.current?.getBoundingClientRect();
					if (rect === void 0) return;
					const panel = panelRef.current;
					const width = panel?.offsetWidth ?? 0;
					const height = panel?.offsetHeight ?? 0;
					let left = align === "end" ? rect.right - width : rect.left;
					let top = side === "top" ? rect.top - gap - height : rect.bottom + gap;
					if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
					if (height > 0) top = Math.min(Math.max(top, overlayTopMargin(margin)), window.innerHeight - height - margin);
					setPosition({
						left,
						top
					});
				};
				place();
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				const panel = panelRef.current;
				let observer = null;
				if (typeof ResizeObserver !== "undefined" && panel !== null) {
					observer = new ResizeObserver(place);
					observer.observe(panel);
				}
				return () => {
					observer?.disconnect();
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [
				open,
				anchorRef,
				panelRef,
				side,
				align,
				gap,
				margin
			]);
			return position;
		}
		/**
		* Close an open popover when a pointerdown lands outside it.
		*
		* `portal` counts as inside: the panel is portaled to `document.body`, so it is
		* not a descendant of `root` and a click on the panel itself would otherwise
		* read as "outside" and dismiss the popover the user is trying to use.
		*/
		function useDismissOnOutsidePointer(root, open, setOpen, portal) {
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const closeOutside = (event) => {
					if (event.target instanceof Node && root.current?.contains(event.target) !== true && portal?.current?.contains(event.target) !== true) setOpen(false);
				};
				document.addEventListener("pointerdown", closeOutside);
				return () => {
					document.removeEventListener("pointerdown", closeOutside);
				};
			}, [
				root,
				open,
				setOpen,
				portal
			]);
		}
		//#endregion
		//#region src/client/new-model-ids.ts
		/**
		* The ids a usage document reports as first seen by THIS machine, normalised.
		*
		* One filter, two surfaces. Both the composer pill's "· N 新模型" segment and the
		* host model picker's per-row marker have to agree about which models are new,
		* so they must not each invent their own reading of the list — a difference
		* between the two would show a pill that counts two and a picker that marks
		* three. They therefore share this single normaliser, and both read the SAME
		* usage document the Host already serves.
		*
		* Three filters, none of them optional:
		* 1. Not an array answers `[]` rather than throwing. The Host's answer is the
		*    source of truth, so a missing field is "nothing to show", never an error.
		* 2. A non-string, or an id that is only whitespace, is dropped.
		* 3. Duplicates are dropped. The Host already dedupes, but the client must not
		*    trust a peer: a duplicated id would turn "2 新模型" into two rows naming
		*    the same model and stop the count meaning anything.
		*
		* @param raw - The `newModelIds` field of a usage document.
		* @returns The ids, in the order the Host sent them.
		*/
		function normalizeNewModelIds(raw) {
			if (!Array.isArray(raw)) return [];
			const seen = /* @__PURE__ */ new Set();
			const ids = [];
			for (const value of raw) {
				if (typeof value !== "string") continue;
				const id = value.trim();
				if (id === "" || seen.has(id)) continue;
				seen.add(id);
				ids.push(id);
			}
			return ids;
		}
		//#endregion
		//#region src/client/ComposerCredits.tsx
		/**
		* Credit readout for the composer row (`conversation.input.right`, rendered
		* immediately before the model picker).
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 该项目的 `client/ComposerPoints.tsx`：读数形态（`<区域> · <余额>`）、
		*     点击弹出锚定面板、面板内是**账号表格**（点行即切换账号）、刷新按钮
		*     放在面板里而不是读数上、每账号读数**只在面板打开时抓**、5 分钟定时器、
		*     失败保留上次数值。本文件把「只有国内版」扩成「两个区域都支持」：那边
		*     的国际版是订阅制、没有可比数字，本插件的国际版有真实余额，所以按当前
		*     选中模型所属的区域显示，并在读数上标明是 WB CN 还是 WB AI。
		*
		* Shows the selected region's general credit balance, but ONLY while the
		* session's selected model belongs to this plugin (the gate decides that).
		*
		* The row itself is a bare clickable readout — `WB CN · 1,072` — with NO
		* refresh control: the manual refresh lives in the panel, because the row is
		* shared with the shell's own permission/agent/model controls and every extra
		* control there costs space that is not ours. Clicking it opens an anchored
		* panel: a TABLE with one row per account in that region and its balance, where
		* a row click switches to it.
		*
		* Two deliberate choices in that panel:
		*
		*  - Per-account figures are fetched ONLY while the panel is open. The 5-minute
		*    readout must not multiply its upstream reads by the account count — a
		*    healthy balance should not pay for a table nobody is looking at.
		*  - A row whose balance could not be read shows `—`, never `0`. The endpoint
		*    omits the field in that case precisely so this component cannot render a
		*    wrong claim about the account.
		*/
		/**
		* Inject the readout's styles into the document head, once, on module load.
		*
		* Same idempotent pattern as the card's injection, and for the same reason: the
		* classes are attached to DOM this component owns, and `WORKBUDDY_CARD_CSS` only
		* loads when the settings card does — which is not guaranteed on a host where
		* the card is never rendered. The referring project shipped exactly that bug
		* (the trigger rendered as a default button box and the panel, without
		* `position: fixed`, had its measured left/top ignored and appeared nowhere).
		*/
		if (typeof document !== "undefined") {
			const cssId = "dsh-connect-workbuddy/composer-credits.css";
			if (!document.querySelector(`style[data-plugin-css="${cssId}"]`)) {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-connect-workbuddy";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = WORKBUDDY_COMPOSER_CSS;
				document.head.appendChild(styleTag);
			}
		}
		/**
		* Automatic refresh period for the READOUT. Five minutes, matching a credit
		* balance's actual rate of change: it moves on the scale of model calls, not
		* seconds, and each read is a read-only upstream call.
		*/
		const COMPOSER_CREDITS_REFRESH_INTERVAL_MS = 3e5;
		/**
		* Provider routes whose credit balance this readout can show, mapped to the
		* region to read it from.
		*
		* BOTH regions, unlike the referring project: its international side is
		* subscription-based and has no comparable balance, while WorkBuddy's
		* international accounts do carry one, so there is a real number to show on
		* either side. Mirrors `WORKBUDDY_PROVIDERS` on the host side; duplicated here
		* because the client bundle must not import the host entry.
		*/
		const WORKBUDDY_COMPOSER_PROVIDERS = {
			"workbuddy": "cn",
			"workbuddy-global": "global"
		};
		/** The credit total out of one usage document, or undefined. */
		function creditsOf(usage) {
			if (usage.status !== "signed-in") return void 0;
			return usage.credits?.total;
		}
		/**
		* The "· N 新模型" ids out of one usage document, in first-sighted order.
		*
		* The filters live in `normalizeNewModelIds`, shared with the host picker's row
		* marker, so the two surfaces cannot disagree about which models are new.
		*
		* Three filters, none of them optional:
		* 1. Not a signed-in document answers `[]` rather than throwing — a Host that
		*    predates the feature, or a degraded document, must cost the pill its
		*    credits readout, and it must not cost it a crash.
		* 2. A non-string, or an id that is only whitespace, is dropped.
		* 3. Duplicates are dropped. The Host already dedupes, but the client must not
		*    trust a peer: a duplicated id would turn "2 新模型" into two rows naming
		*    the same model and stop the count meaning anything.
		*/
		function newModelIdsOf(usage) {
			if (usage === void 0 || usage.status !== "signed-in") return [];
			return normalizeNewModelIds(usage.newModelIds);
		}
		/**
		* The display name for a first-seen id, or the id itself when the catalog does
		* not list it — a model that left the roster can still be inside the new
		* window, and showing its id is a lie-free answer to "which model".
		*/
		function modelNameOf(models, id) {
			const found = models.find((model) => model.id === id);
			return found === void 0 || found.name.trim() === "" ? id : found.name;
		}
		/**
		* The Host's per-region readout switch off a usage document, when it carries one.
		*
		* The `error` variant has no data at all, so it can only ever answer `undefined`
		* — "the Host did not say", which leaves the settings scope in charge.
		*/
		function hostCreditsShownOf(usage) {
			if (usage === void 0 || usage.status === "error") return void 0;
			const value = usage.showCreditsInMainUi;
			return typeof value === "boolean" ? value : void 0;
		}
		/**
		* Whether this region's usage document allows the "· N 新模型" segment.
		*
		* OPT-IN, so this is the mirror image of {@link hostCreditsShownOf}: absent
		* means NO. "New" means first seen by this machine, not newly listed upstream,
		* so on a fresh install it would announce the entire roster — a number that is
		* true by construction and reads as a defect. See `showNewModelsInMainUi` in the
		* schema for the full argument.
		*
		* The `error` variant answers `false` rather than `undefined`: with no document
		* there is no roster, hence no new models, hence nothing to announce anyway.
		*/
		function hostNewModelsShownOf(usage) {
			if (usage === void 0 || usage.status === "error") return false;
			return usage.showNewModelsInMainUi === true;
		}
		/**
		* A same-day instant, as the READER's locale writes it.
		*
		* The locale is `undefined` — the reader's, not a fixed one — so an English UI
		* shows `11:59 PM` rather than the Chinese convention's `23:59`. It used to
		* hardcode `'zh-CN'`, which meant the English interface printed a Chinese-style
		* time. Ported from dsh-connect-trae (issue #71).
		*
		* Only for instants that are the same day as the reader: a bare clock time on
		* a timestamp from another day is a different question (and a different
		* design), which is why this is not reused for anything but "now".
		*/
		function formatClock(value) {
			return new Date(value).toLocaleTimeString(void 0, {
				hour: "2-digit",
				minute: "2-digit"
			});
		}
		/**
		* The dot's classes, one per tone.
		*
		* Written out in full instead of `\`…-dot-${tone}\`` on purpose: the panel's
		* CSS-contract test harvests class names from this file with
		* /dsm-workbuddy-composer-[a-z-]+/ and a template literal would contribute a
		* dangling "…-dot-" prefix that no rule defines.
		*/
		const DOT_CLASS = {
			ok: "dsm-workbuddy-composer-panel-dot dsm-workbuddy-composer-panel-dot-ok",
			error: "dsm-workbuddy-composer-panel-dot dsm-workbuddy-composer-panel-dot-error",
			unknown: "dsm-workbuddy-composer-panel-dot dsm-workbuddy-composer-panel-dot-unknown"
		};
		/**
		* The dot class for one row: green when the account can serve, red when it cannot.
		*
		* The rule the owner settled on, after three rounds of this: colour answers
		* "can it be used", and the row's second line answers "is it the one I am
		* using". Those two questions used to share one channel — an earlier revision
		* painted green only on the selected account, which made every usable row grey
		* and the list read as one live row among dead ones ("这样无法知道当前用的是什么"):
		* true about selection, false about usability, and the panel is opened mainly to
		* ask the second question.
		*
		* So green is now the ordinary state of a usable account, selected or not, and
		* "当前选用" is printed under the name of the selected one. Red carries the
		* refusal — including a stated rate limit, which used to be amber; amber read as
		* "mostly fine", and an account that cannot answer this message is not fine.
		*
		* Grey is reserved for an account nobody has measured yet. Painting it green
		* would assert a health nobody checked, and red would assert a failure nobody
		* saw; the absence of a reading is its own state.
		*/
		function dotClass(account) {
			const tone = stateTone(account);
			if (tone === "ok") return DOT_CLASS.ok;
			if (tone === "warn" || tone === "error") return DOT_CLASS.error;
			return DOT_CLASS.unknown;
		}
		/**
		* The row's second line, from the facts that belong in it.
		*
		* Two independent ones: whether this is the account serving the tab, and — when
		* it cannot serve — why, with the wait but never the absolute instant. Joined
		* with the same separator the rest of this panel uses, and dropped entirely when
		* there is nothing to say, so a plain usable row stays one line tall.
		*/
		function detailLine(...parts) {
			const kept = parts.filter((part) => part !== void 0 && part !== "");
			return kept.length === 0 ? void 0 : kept.join(" · ");
		}
		function ComposerCredits(props) {
			const { t, provider, region, settingsScope, onOpenSettings } = props;
			if (t === void 0) throw new Error("Composer credits readout requires its translation function");
			const owned = provider === void 0 ? void 0 : WORKBUDDY_COMPOSER_PROVIDERS[provider];
			const activeRegion = region ?? owned;
			const [usage, setUsage] = (0, react.useState)(void 0);
			/**
			* The refresh cadence, taken from the SAME document the card polls.
			*
			* The panel used to hold its own 60s constant, and that was the whole reason
			* the two surfaces could contradict each other about one account: the card
			* re-ranked every minute while a panel opened at a different cadence drew a
			* frozen verdict. Sharing the Host's value means there is one cadence to
			* reason about, and changing it in the card changes it here too.
			*
			* An absent value (the panel opened before any document landed) falls back to
			* the same default the Host uses, so the first timer is never armed at 0.
			*/
			const refreshIntervalMs = (() => {
				const raw = usage !== void 0 && "pollIntervalMs" in usage ? usage.pollIntervalMs : void 0;
				return typeof raw === "number" && WORKBUDDY_POLL_INTERVALS_MS.includes(raw) ? raw : WORKBUDDY_DEFAULT_POLL_INTERVAL_MS;
			})();
			const [accountCredits, setAccountCredits] = (0, react.useState)(void 0);
			const [switchingId, setSwitchingId] = (0, react.useState)(void 0);
			/**
			* A test batch is running.
			*
			* Its OWN flag, not shared with `failed`/`inFlight`: a batch is one serial
			* probe per account (a minute for a big pool) while a credits read is one
			* round trip. Sharing a flag would either freeze the readout for a minute or
			* let a press be swallowed as "already refreshing".
			*/
			const [testing, setTesting] = (0, react.useState)(false);
			/** The batch's failure, in the user's language; `failed` is for reads. */
			const [testError, setTestError] = (0, react.useState)(void 0);
			const [failed, setFailed] = (0, react.useState)(false);
			/**
			* The full-page button could not reach the page on this host.
			*
			* Its own flag, not `failed`, because the two render DIFFERENT sentences: this
			* one says the host offers no route to the page, which is not the same claim as
			* "the credits read failed", and sharing a flag would print one over the other.
			*/
			const [settingsFailed, setSettingsFailed] = (0, react.useState)(false);
			const [lastRefresh, setLastRefresh] = (0, react.useState)(void 0);
			const [open, setOpen] = (0, react.useState)(false);
			const inFlight = (0, react.useRef)(false);
			/** A batch is running; guards a second press that lands before `setTesting`. */
			const testingRef = (0, react.useRef)(false);
			/** Account-table reads in flight; see `fetchAccountCredits`. */
			const accountsInFlight = (0, react.useRef)(0);
			/** Which account-table read is the newest; see `fetchAccountCredits`. */
			const accountsReadGeneration = (0, react.useRef)(0);
			const mounted = (0, react.useRef)(true);
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			/** Whether the panel was opened BY the "· N 新模型" button (so it answers the
			*  question the reader just asked, instead of just opening on the table). */
			const [revealed, setRevealed] = (0, react.useState)(false);
			const newRowRef = (0, react.useRef)(null);
			/**
			* The "· N 新模型" button is an affordance for the reader who wants to know
			* WHICH models: it opens the panel and brings the new-model row into view.
			*
			* The Host owns the model picker and offers this plugin no API to open it or
			* steer its selection, so the honest answer is the panel's own row — the one
			* surface in the pill that names them. The rows themselves are marked "新" in
			* the picker by `WorkBuddyModelLabel`, reading the same ids.
			*
			* The row is focused (not just scrolled) because that is what a screen reader
			* needs to keep its place; it is pulled out of the tab order so Tab does not
			* stop on it.
			*/
			(0, react.useEffect)(() => {
				if (!open) {
					if (revealed) setRevealed(false);
					return;
				}
				if (!revealed) return;
				const row = newRowRef.current;
				if (row === null) return;
				try {
					row.scrollIntoView({ block: "nearest" });
				} catch {}
				row.focus();
			}, [open, revealed]);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const position = useAnchoredPosition({
				open: open && activeRegion !== void 0,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: 8,
				margin: 12
			});
			useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
			const fetchUsage = (0, react.useCallback)(async (signal) => {
				if (inFlight.current || activeRegion === void 0) return;
				inFlight.current = true;
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_USAGE_PATH, activeRegion), {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const value = await response.json();
					if (!mounted.current || signal?.aborted === true) return;
					setUsage(value);
					setLastRefresh(Date.now());
					setFailed(false);
				} catch {
					if (mounted.current && signal?.aborted !== true) setFailed(true);
				} finally {
					inFlight.current = false;
				}
			}, [activeRegion]);
			/**
			* Every account's balance in the region — one upstream read per account.
			*
			* Paid only while the panel is open (see the note at the top of this file).
			* A failure keeps whatever we already have rather than clearing it: the table
			* falls back to the usage document's account list, so a failed figure must not
			* remove the switch.
			*
			* `force` distinguishes the TWO callers, and the distinction is the point:
			*
			*  - the panel's timer passes nothing, so a tick that arrives while a read is
			*    still in flight is SKIPPED. The panel is asking "has anything changed?",
			*    and a read already on its way answers that.
			*  - a deliberate action (the refresh button, or `switchTo` re-reading after a
			*    write) passes `force: true`, because it must actually happen. Skipping it
			*    would be the same defect this file is fixing: a control that reports "the
			*    table is current" without having asked. It also claims the newest
			*    generation, so its answer is the one that lands.
			*
			* Latest-wins rather than a queue: responses can resolve out of order, and a
			* slow tick started earlier must not overwrite the press that superseded it —
			* which would silently re-draw a mark the press had just cleared.
			*/
			const fetchAccountCredits = (0, react.useCallback)(async (signal, force) => {
				if (activeRegion === void 0) return;
				if (!force && accountsInFlight.current > 0) return;
				const generation = ++accountsReadGeneration.current;
				accountsInFlight.current += 1;
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_ACCOUNT_CREDITS_PATH, activeRegion), {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const data = await response.json();
					if (!mounted.current || signal?.aborted === true) return;
					if (generation !== accountsReadGeneration.current) return;
					if (Array.isArray(data.accounts)) {
						setAccountCredits(data.accounts);
						setLastRefresh(Date.now());
					}
				} catch {} finally {
					accountsInFlight.current -= 1;
				}
			}, [activeRegion]);
			const hostHidden = hostCreditsShownOf(usage) === false;
			(0, react.useEffect)(() => {
				if (owned === void 0 || hostHidden) return void 0;
				let cancelled = false;
				let timer;
				const controller = new AbortController();
				fetchUsage(controller.signal).finally(() => {
					if (cancelled) return;
					timer = window.setInterval(() => {
						fetchUsage(controller.signal);
					}, COMPOSER_CREDITS_REFRESH_INTERVAL_MS);
				});
				return () => {
					cancelled = true;
					if (timer !== void 0) window.clearInterval(timer);
					controller.abort();
				};
			}, [
				owned,
				hostHidden,
				fetchUsage
			]);
			/**
			* Per-account figures are read on OPEN, then kept fresh while the panel stays
			* open.
			*
			* The on-open read is what makes the table useful immediately. The TIMER is
			* the fix for the complaint that started this: with an open-only read, a panel
			* left open showed a frozen snapshot of every account's `excludedBy`, while
			* the pool card behind it re-ranked every 60 s. The two then disagreed about
			* the same account — the panel drawing no mark where the card said 模型繁忙 —
			* and neither surface was wrong on its own data, which is what made it so hard
			* to read.
			*
			* The timer starts only AFTER the first read settles, so a slow upstream
			* cannot stack overlapping reads (the same shape the readout's own effect
			* uses). Aborted on close: the panel pays one read per minute only while it is
			* actually on screen.
			*/
			(0, react.useEffect)(() => {
				if (!open || activeRegion === void 0) return void 0;
				let cancelled = false;
				let timer;
				const controller = new AbortController();
				fetchAccountCredits(controller.signal).finally(() => {
					if (cancelled) return;
					timer = window.setInterval(() => {
						fetchAccountCredits(controller.signal);
					}, refreshIntervalMs);
				});
				return () => {
					cancelled = true;
					if (timer !== void 0) window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				activeRegion,
				fetchAccountCredits,
				refreshIntervalMs
			]);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			/**
			* Switch to another account, then re-read both the usage document and the
			* table so the marker, the readout and the panel all move together.
			*
			* Goes through the shared `writeAccountSlot`, which is read-back checked and
			* carries the host-endpoint-first path: `set()` resolving is not proof the
			* write landed, and a refused write must report failure instead of showing a
			* marker on an account that was never selected.
			*/
			const switchTo = async (accountId) => {
				if (settingsScope === void 0 || settingsScope.getSnapshot().writable !== true) return;
				if (activeRegion === void 0 || switchingId !== void 0) return;
				if (accountId === (accountCredits?.find((account) => account.selected)?.id ?? (usage?.status === "signed-in" ? usage.accountId : void 0))) return;
				setSwitchingId(accountId);
				setFailed(false);
				try {
					await writeAccountSlot(settingsScope, activeRegion, accountId);
					await fetchUsage();
					await fetchAccountCredits(void 0, true);
				} catch {
					if (mounted.current) setFailed(true);
				} finally {
					if (mounted.current) setSwitchingId(void 0);
				}
			};
			/**
			* The header's REFRESH control: probe every account in this region.
			*
			* Named for the reader's outcome (this table, brought up to date) while the
			* work underneath is a probe batch. The distinction is not cosmetic: "refresh"
			* sounds like a free re-read of what the Host already knows, and what the Host
			* already knows is exactly the stale measurement we are trying to replace. The
			* hint says "probes each account" so the cost is not a surprise.
			*
			* THE ROW COLOURS ARE WHAT THIS PRODUCES. The dots and the "被限流 · 约 N 小时后"
			* lines in the table are not read from the upstream on every poll — they are
			* the last MEASUREMENT the Host persisted. Until something probes an account,
			* there is nothing to report and every row looks usable. That is why this
			* lives beside the settings control rather than in the pool card alone: this
			* table is where the reader sees the state, so this is where the question "is
			* this still true?" gets asked.
			*
			* The batch is SERIAL on the Host (one probe per account, with a gap), so it
			* streams NDJSON and each row is folded in the moment it lands. Waiting for
			* the whole stream would leave the row the user is watching wrong for as long
			* as the SLOWEST account takes — the dead-looking panel the streamed shape
			* exists to avoid. The re-read in `finally` then confirms the same facts from
			* the Host's own store, so the fold is a shortcut, never the record.
			*/
			const testEveryAccount = (0, react.useCallback)(async () => {
				if (activeRegion === void 0 || testingRef.current) return;
				testingRef.current = true;
				if (mounted.current) {
					setTesting(true);
					setTestError(void 0);
					setFailed(false);
				}
				try {
					const response = await fetch(withWorkBuddyRegionAndAction(WORKBUDDY_POOL_PATH, activeRegion, "test"), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					let failure;
					if ((response.headers.get("content-type") ?? "").includes("ndjson")) {
						if (!response.ok) failure = poolFailureText(t, { status: response.status });
						else await readNdjson(response.body, (line) => {
							const row = testRowOf(line);
							if (row !== void 0) {
								if (mounted.current) setUsage((previous) => previous === void 0 ? previous : withTestRow(previous, row, Date.now()));
								return;
							}
							const reason = line["reason"];
							if (typeof reason !== "string") return;
							failure = poolFailureText(t, {
								status: 200,
								reason,
								error: typeof line["error"] === "string" ? line["error"] : void 0
							});
						});
					} else {
						const body = await response.json().catch(() => void 0);
						if (!response.ok) failure = poolFailureText(t, {
							status: response.status,
							reason: body?.reason,
							error: body?.error
						});
					}
					if (mounted.current && failure !== void 0) setTestError(failure);
				} catch {
					if (mounted.current) setTestError(t("composer.refreshAccountsFailed"));
				} finally {
					testingRef.current = false;
					if (mounted.current) setTesting(false);
					await Promise.all([fetchUsage(), fetchAccountCredits(void 0, true)]);
				}
			}, [
				activeRegion,
				fetchUsage,
				fetchAccountCredits,
				t
			]);
			/**
			* The header's page control: open this plugin's full page, then close.
			*
			* CLOSING IS PART OF THE JOB. The panel is portaled to `document.body` and
			* floats over the composer; navigating the centre column does not remove it, so
			* leaving it open would park a credits table on top of the page the user just
			* asked for. It is not reopened on return — a popover that comes back by itself
			* after navigation is a popover the user cannot get rid of.
			*
			* `false` (no route on this host) sets the panel's own error line rather than
			* doing nothing: a press that changes nothing on screen is indistinguishable
			* from a broken button, and the honest answer here is "this host has no way
			* there".
			*/
			const openSettings = () => {
				if (!(onOpenSettings === void 0 ? false : onOpenSettings())) {
					setFailed(false);
					setSettingsFailed(true);
					return;
				}
				setSettingsFailed(false);
				setOpen(false);
			};
			if (owned === void 0) return null;
			/**
			* The Host's own answer for this region, when the document carries one.
			*
			* The Host is the AUTHORITY on whether this readout is wanted, exactly as the
			* card's `creditsShownOn` treats it — and here it is also the fix for a defect
			* shipped in 4.3.0 (issue #46): the gate's decision rests on the settings
			* scope, which on a host whose describe mirror lands late was bound to a
			* namespace nothing serves. Every read of that scope is then `undefined`, and
			* the opt-out rule (`!== false`) reads "shown" forever — so unticking the
			* checkbox wrote correctly and changed nothing on screen.
			*
			* Checked AFTER the fetch rather than before it because the answer only
			* arrives with the document. The cost is one usage read for a readout the user
			* may have hidden, against a persistent wrong number on screen.
			*/
			if (hostCreditsShownOf(usage) === false) return null;
			const signedIn = usage?.status === "signed-in" ? usage : void 0;
			const total = signedIn === void 0 ? void 0 : creditsOf(signedIn);
			const signedOut = usage !== void 0 && usage.status === "signed-out";
			const valueText = total === void 0 ? "—" : formatCredits(total);
			const label = t(activeRegion === "cn" ? "composer.pointsCn" : "composer.pointsGlobal");
			const newModelsShown = hostNewModelsShownOf(usage);
			const newModelNames = (newModelsShown ? newModelIdsOf(usage) : []).map((id) => modelNameOf(signedIn?.models ?? [], id));
			const newModelTooltip = newModelNames.length === 0 ? void 0 : `${t("composer.newModelsTitle")}${newModelNames.slice(0, 3).join(t("composer.newModelsSep"))}${newModelNames.length > 3 ? "…" : ""}`;
			const rosterSeenNote = newModelsShown ? signedIn?.rosterSeenVersionNote : void 0;
			/**
			* The table's rows: every account in this region, with its balance.
			*
			* The endpoint's answer is authoritative (it carries the figures). Before it
			* lands — or if it fails — fall back to the usage document's account list so
			* the switches are reachable immediately, showing `—` for the figure rather
			* than a spinner the user has to wait on.
			*/
			const selectedId = accountCredits?.find((account) => account.selected)?.id ?? (signedIn === void 0 ? void 0 : signedIn.accountId);
			const rows = (accountCredits ?? (signedIn === void 0 ? [] : signedIn.accounts.map((account) => ({
				id: account.id,
				accountName: account.accountName,
				selected: account.selected
			})))).map((row) => {
				if (row.id !== selectedId || row.credits !== void 0 || total === void 0) return row;
				return {
					...row,
					credits: total
				};
			});
			const canSwitch = settingsScope !== void 0 && settingsScope.getSnapshot().writable === true;
			const poolOrder = usage?.status === "signed-in" ? usage.pool?.orderAccountIds : void 0;
			const orderedRows = applyManualOrder(rows, poolOrder !== void 0 && poolOrder.length > 0 ? poolOrder : settingsScope === void 0 ? [] : readOrderAccountIds(settingsScope.getSnapshot().value, activeRegion));
			const poolById = new Map((usage?.status === "signed-in" ? usage.pool?.accounts ?? [] : []).map((account) => [account.accountId, account]));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: "dsm-workbuddy-composer-credits",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsm-workbuddy-composer-credits-trigger",
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						onClick: () => {
							setOpen(!open);
						},
						children: [
							label,
							" · ",
							valueText
						]
					}),
					newModelNames.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsm-workbuddy-composer-credits-new",
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						title: newModelTooltip,
						onClick: () => {
							setRevealed(true);
							setOpen(true);
						},
						children: [
							"· ",
							newModelNames.length,
							" ",
							t("composer.newModels")
						]
					}),
					open && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: panelRef,
						className: "dsm-workbuddy-composer-panel",
						style: position ?? {
							visibility: "hidden",
							left: 0,
							top: 0
						},
						role: "dialog",
						"aria-label": t("composer.panelTitle"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-composer-panel-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-composer-panel-title",
									children: t(activeRegion === "cn" ? "composer.panelTitleCn" : "composer.panelTitleGlobal")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-workbuddy-composer-panel-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dsm-workbuddy-composer-panel-refresh",
										disabled: testing || switchingId !== void 0,
										title: t("composer.refreshHint"),
										"aria-label": t("composer.refreshHint"),
										onClick: () => {
											testEveryAccount();
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
											className: testing ? "dsm-workbuddy-composer-panel-refresh-icon dsm-workbuddy-composer-panel-refresh-icon-spin" : "dsm-workbuddy-composer-panel-refresh-icon",
											viewBox: "0 0 16 16",
											width: "12",
											height: "12",
											fill: "none",
											"aria-hidden": "true",
											focusable: "false",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
												d: "M13.3 8a5.3 5.3 0 1 1-1.55-3.75",
												stroke: "currentColor",
												strokeWidth: "1.5",
												strokeLinecap: "round"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
												d: "M13.4 2.2v2.9h-2.9",
												stroke: "currentColor",
												strokeWidth: "1.5",
												strokeLinecap: "round",
												strokeLinejoin: "round"
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-composer-panel-refresh-label",
											children: testing ? t("composer.refreshing") : t("composer.refresh")
										})]
									}), onOpenSettings === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dsm-workbuddy-composer-panel-settings",
										title: t("composer.openSettingsHint"),
										onClick: openSettings,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
											className: "dsm-workbuddy-composer-panel-settings-icon",
											viewBox: "0 0 16 16",
											width: "12",
											height: "12",
											fill: "none",
											"aria-hidden": "true",
											focusable: "false",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
												d: "M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
												stroke: "currentColor",
												strokeWidth: "1.5"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
												d: "M12.9 9.6a1.2 1.2 0 0 0 .24 1.32l.04.04a1.4 1.4 0 1 1-1.98 1.98l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.1v.12a1.4 1.4 0 1 1-2.8 0v-.07a1.2 1.2 0 0 0-.78-1.1 1.2 1.2 0 0 0-1.32.24l-.04.04a1.4 1.4 0 1 1-1.98-1.98l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.72h-.12a1.4 1.4 0 1 1 0-2.8h.07a1.2 1.2 0 0 0 1.1-.78 1.2 1.2 0 0 0-.24-1.32l-.04-.04a1.4 1.4 0 1 1 1.98-1.98l.04.04a1.2 1.2 0 0 0 1.32.24h.05a1.2 1.2 0 0 0 .72-1.1v-.12a1.4 1.4 0 1 1 2.8 0v.07a1.2 1.2 0 0 0 .72 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.4 1.4 0 1 1 1.98 1.98l-.04.04a1.2 1.2 0 0 0-.24 1.32v.05a1.2 1.2 0 0 0 1.1.72h.12a1.4 1.4 0 1 1 0 2.8h-.07a1.2 1.2 0 0 0-1.1.72Z",
												stroke: "currentColor",
												strokeWidth: "1.5",
												strokeLinecap: "round",
												strokeLinejoin: "round"
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-composer-panel-settings-label",
											children: t("composer.openSettings")
										})]
									})]
								})]
							}),
							settingsFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-composer-panel-error",
								role: "status",
								children: t("composer.openSettingsFailed")
							}) : null,
							testError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-composer-panel-error",
								role: "status",
								children: testError
							}),
							signedOut ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-composer-panel-empty",
								children: t("composer.signedOut")
							}) : rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-composer-panel-empty",
								children: t("composer.noAccounts")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-workbuddy-composer-panel-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									scope: "col",
									children: t("composer.account")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									scope: "col",
									className: "dsm-workbuddy-composer-panel-num",
									children: t("composer.credits")
								})] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: orderedRows.map((row) => {
									const current = row.id === selectedId;
									const poolRow = poolById.get(row.id);
									const live = poolRow === void 0 ? current : poolRow.current;
									const availability = poolRow ?? {
										excludedBy: row.excludedBy,
										probe: void 0
									};
									const usable = stateTone(availability) === "ok";
									const currentMark = live ? t("composer.current") : void 0;
									const reasonMark = usable ? void 0 : availabilityMark(t, availability);
									const spoken = detailLine(live ? t("composer.current") : void 0, usable ? void 0 : availabilityLine(t, availability));
									const whoLabel = spoken === void 0 ? row.accountName : `${row.accountName} — ${spoken}`;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										className: live ? "dsm-workbuddy-composer-panel-row-current" : void 0,
										title: spoken,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
											scope: "row",
											"aria-label": whoLabel,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsm-workbuddy-composer-panel-switch",
												disabled: !canSwitch || switchingId !== void 0 || live,
												"aria-label": t("composer.switchTo", { account: row.accountName }),
												onClick: () => {
													switchTo(row.id);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: dotClass(availability),
													"aria-hidden": "true"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dsm-workbuddy-composer-panel-who",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-composer-panel-name",
														children: row.accountName
													}), currentMark === void 0 && reasonMark === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsm-workbuddy-composer-panel-mark",
														children: [currentMark === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-workbuddy-composer-panel-mark-current",
															children: currentMark
														}), reasonMark === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-workbuddy-composer-panel-mark-reason",
															children: reasonMark
														})]
													})]
												})]
											})
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-workbuddy-composer-panel-num",
											children: row.credits === void 0 ? "—" : formatCredits(row.credits)
										})]
									}, row.id);
								}) })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-workbuddy-composer-panel-foot",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("composer.lastRefresh"),
									" ",
									lastRefresh === void 0 ? "—" : formatClock(lastRefresh)
								] })
							}),
							newModelNames.length === 0 && rosterSeenNote === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-composer-panel-new",
								children: [newModelNames.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									ref: newRowRef,
									tabIndex: -1,
									"aria-label": `${t("composer.newModelsTitle")}${newModelNames.join(t("composer.newModelsSep"))}`,
									className: revealed ? "dsm-workbuddy-composer-panel-new-row dsm-workbuddy-composer-panel-new-row-revealed" : "dsm-workbuddy-composer-panel-new-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-composer-panel-new-label",
										children: t("composer.newModelsRow")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-composer-panel-new-list",
										children: newModelNames.join(t("composer.newModelsSep"))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-composer-panel-note",
									children: t("composer.newModelsNote")
								})] }), rosterSeenNote === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-composer-panel-note",
									children: rosterSeenNote
								})]
							}),
							failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-composer-panel-error",
								role: "status",
								children: t("composer.refreshFailed")
							}) : null,
							testError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-composer-panel-error",
								role: "status",
								children: testError
							})
						]
					}), document.body)
				]
			});
		}
		//#endregion
		//#region src/client/ComposerCreditsGate.tsx
		/**
		* Decides whether the composer credit readout belongs in this session, by
		* reading the Host's own `modelSelection` projection and the plugin's
		* per-region `showCreditsInMainUi` switch.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 该项目的 `client/ComposerPointsGate.tsx`：从 `modelSelection` 投影读
		*     「本会话当前用哪个 provider」来决定要不要渲染，以及 `next` 优先于
		*     `lastUsed` 的判定。这是本项目从侧边栏迁到输入框的核心机制。
		*
		* WHY the projection rather than this plugin's own state: the projection is
		* what the model picker writes and what the next request will use, so the
		* readout cannot disagree with the model actually in effect. `next` outranks
		* `lastUsed` because a selection that has been made but not yet sent is still
		* what the composer shows the user — the same precedence the shell itself uses.
		*
		* WHY the composer row rather than the sidebar foot: the sidebar foot is a
		* SINGLE root-scope row shared by every bundle, so two connector plugins each
		* parking a line there fight over the same width (measured on the referring
		* project: its line was squeezed to a clipped "Tr" beside this plugin's two
		* rows). The composer row is per-session and provider-scoped, so exactly one
		* plugin's credits are relevant at a time and nothing overlaps.
		*
		* WHY THERE IS A SECOND SEAT (issue #62). The composer tool row is a LIST seat,
		* so it is shared not only with the shell's own controls but with any other
		* plugin that registers there — and one report is exactly that: with a
		* third-party plugin installed the readout stopped appearing at all. A list seat
		* cannot promise that every occupant is visible, so the seat is the USER's
		* choice: `composer` (default, unchanged for anyone who does not choose) or
		* `stats`, the ambient dock below the composer card where the shell renders its
		* own round/token pills. The gate is registered in BOTH seats and renders in the
		* one the setting names, which keeps the decision in one function instead of
		* re-registering slots when the setting changes.
		*
		* Kept separate from {@link ComposerCredits} (and from the browser-plugin
		* entry) so the decision can be unit-tested without a Host: the entry imports
		* browser-only DSH packages the test environment cannot load, while this module
		* depends only on React and a narrow projection shape.
		*/
		/**
		* The provider route the session is currently pointed at.
		*
		* `next` wins over `lastUsed`: a switch that has landed but not yet been sent
		* is still the selection the composer displays.
		*/
		function selectedProviderOf(projection) {
			const provider = (projection?.next ?? projection?.lastUsed)?.provider;
			return typeof provider === "string" && provider !== "" ? provider : void 0;
		}
		/**
		* Which region's readout this session should show, or undefined for none.
		*
		* Returns undefined when the selected provider is not this plugin's — the
		* ownership test and the region choice are ONE lookup, so there is no second
		* copy of the rule to drift.
		*
		* The region's own switches are applied HERE rather than inside the component,
		* so a region that is switched off (or whose provider is off) starts no fetch
		* loop at all.
		*
		* `hostValue` is the Host's own `showCreditsInMainUi` answer for this region,
		* when a usage document carrying it is already in hand. It OUTRANKS the settings
		* scope, exactly as the card's `creditsShownOn` does and for the same measured
		* reason: the browser's settings mirror is documented as stale for this
		* namespace on the affected deployments, and — the shipped 4.3.0 defect (issue
		* #46) — the scope can be bound to a namespace nothing serves, where every read
		* is `undefined` and the opt-out rule then reads "shown" forever. The Host is
		* the authority; the scope is the fallback for a Host line that predates the
		* field.
		*/
		/**
		* The settings tree this plugin writes, unwrapped to a plain object.
		*
		* `unwrapVolatileDeep` first: the scope's value is a live cosmokit reference on
		* the 0.1.7 line, and reading fields off it without unwrapping yields proxies
		* whose `===` comparisons against a string are false.
		*/
		function scopeValueOf(scope) {
			return scope === void 0 ? void 0 : unwrapVolatileDeep(scope.getSnapshot().value);
		}
		function composerCreditsRegionOf(projection, scope, hostValue) {
			const provider = selectedProviderOf(projection);
			const region = provider === void 0 ? void 0 : WORKBUDDY_COMPOSER_PROVIDERS[provider];
			if (region === void 0) return void 0;
			if (typeof hostValue === "boolean") return hostValue ? region : void 0;
			const value = scope === void 0 ? void 0 : unwrapVolatileDeep(scope.getSnapshot().value);
			if (!regionCreditsShownOf(value, region)) return void 0;
			if (!regionEnabledOf(value, region)) return void 0;
			return region;
		}
		function ComposerCreditsGate(props) {
			const { t, position, settingsScope, useProjection, onOpenSettings } = props;
			const [, setRevision] = (0, react.useState)(0);
			(0, react.useEffect)(() => settingsScope?.subscribe(() => {
				setRevision((value) => value + 1);
			}), [settingsScope]);
			const projection = useProjection === void 0 ? void 0 : useProjection("modelSelection");
			const region = composerCreditsRegionOf(projection, settingsScope);
			if (region === void 0) return null;
			if (regionCreditPositionOf(scopeValueOf(settingsScope), region) !== (position ?? "composer")) return null;
			const provider = selectedProviderOf(projection);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComposerCredits, {
				t,
				provider,
				region,
				...settingsScope === void 0 ? {} : { settingsScope },
				...onOpenSettings === void 0 ? {} : { onOpenSettings }
			});
		}
		//#endregion
		//#region src/client/WorkBuddyModelLabel.tsx
		/**
		* The HOST's model picker label: the catalog name, the upstream's promotion
		* badge, and the load-level icon.
		*
		* WHY A SLOT. The host renders the model name as a plain string, so the only
		* thing a provider can put there is a character — and a character's colour is
		* the emoji font's business, not ours. The host therefore offers exactly one
		* seam for this: the `conversation.input.model.label` slot, whose contract is
		* "render non-interactive inline content such as a coloured name or badge"
		* while the picker keeps owning clicks, focus, check marks and the accessibility
		* text. The shipped example is the official DeepSeek "1017" release badge — a
		* coloured marker next to a model name — which is the same job.
		*
		* WHY THE BADGE BELONGS HERE AT ALL. The picker is where the choice is made,
		* and a time-boxed promotion is a choice criterion: "free until the 25th" and
		* "half price at night" both change which row you click. The card already drew
		* these badges, but the card is the settings surface — by the time you read
		* them there you have already picked. The badge is not decoration added here;
		* it is the same upstream fact, moved to the place where it can still change a
		* decision.
		*
		* WHY A SEPARATE FETCH. The slot is rendered by the host, outside the plugin's
		* card, so it cannot read the card's React state. It therefore asks the Host
		* for the snapshot itself — and asks for the SAME route the card polls
		* (`WORKBUDDY_USAGE_PATH`), which carries both the load levels and each model's
		* unresolved promotions. One request, both facts. The answer is cached briefly:
		* a picker that re-fetched on every re-render would be wasteful, and a level
		* that is a few seconds old is still true.
		*
		* WHY THE CLOCK IS RE-READ ON EVERY RENDER. A promotion's badge is a function
		* of the clock (a night window opens and closes; a campaign expires). Resolving
		* it once at fetch time and holding it would leave "夜间折扣" on the composer
		* button the next morning — the exact overstatement `src/promo.ts` refuses to
		* make. The snapshot is therefore fetched once and the BADGE is resolved at
		* render time; a shared one-minute ticker re-renders the mounted labels so a
		* window edge is picked up without one timer per model row.
		*
		* WHY THE HOST STILL OWNS THE NAME. The contract says to keep `model.name` as
		* the text and render the addition beside it, so this component returns the
		* name first and never replaces it.
		*
		* FOR A PROVIDER THAT IS NOT OURS IT RENDERS THE CATALOG NAME PLUS THAT MODEL'S
		* OWN `badge` — never another plugin's component. The name half is not
		* cosmetic: this slot is `kind: "single"`, so whatever registers becomes the
		* cell's only occupant, and an occupant that outputs plain text still occupies
		* it. A previous version of this paragraph said the component "renders nothing
		* at all" for a foreign provider, which made the lost-decoration cost look
		* harmless; issue #138 is what that mis-description looks like from the outside
		* (the host's own 1017 badge disappears on ITS rows while this plugin holds the
		* cell). Returning `null` would not free the cell either — occupancy is decided
		* by registration, never by what the component outputs.
		*
		* THE `badge` HALF IS WHAT MAKES SIBLING CHIPS SURVIVE. The host runs its own
		* badge fallback only when the cell has NO occupant, so once this plugin wins the
		* cell it must draw a sibling's badge itself or that badge is never drawn
		* anywhere. The data is `props.model.badge` — the host's catalog field, which
		* arrives here regardless of who published it — so this is not the coordination
		* `docs/DESIGN.md` §零 rules out: no ledger is read, no foreign component is
		* rendered, and the output does not change based on which plugins are installed.
		* See `HostBadgeChip` and `docs/MODEL-LABEL-SPEC.md`.
		*/
		/** The provider ids this plugin registers, and the region each one serves. */
		const PROVIDER_REGIONS = /* @__PURE__ */ new Map([["workbuddy", "cn"], ["workbuddy-global", "global"]]);
		/**
		* Every provider id this plugin owns, as a list.
		*
		* Exported because on a `keyed` host the label seat is one registration PER
		* provider id — the registration side needs the same list the component uses to
		* decide "is this row mine", and two copies of it would drift. Order is
		* irrelevant to the registry (each id is its own cell); it is stable so the
		* diagnostics line reads the same on every boot.
		*/
		const WORKBUDDY_PROVIDER_IDS = [...PROVIDER_REGIONS.keys()];
		/**
		* The region a provider id serves, or `undefined` for a provider that is not
		* this plugin's.
		*
		* Exported because the mapping is the part that can be silently wrong: asking
		* the Host without the region answers for the DEFAULT region, which would put
		* one gateway's load on the other gateway's models.
		*/
		function regionOfProvider(providerId) {
			return PROVIDER_REGIONS.get(providerId);
		}
		/** How long a fetched snapshot is trusted, in milliseconds. */
		const CACHE_MS = 6e4;
		/** How often a mounted label re-reads the clock, in milliseconds. */
		const TICK_MS = 6e4;
		/** The snapshot per region, plus when it was read. */
		const caches = /* @__PURE__ */ new Map();
		/**
		* The snapshot, read from the Host once and reused briefly.
		*
		* `undefined` means "not known" — the caller renders nothing rather than
		* guessing, because a badge that claims a level or a promotion the upstream
		* never stated is worse than no badge.
		*/
		async function statusNow(region) {
			const cached = caches.get(region);
			if (cached !== void 0 && Date.now() - cached.at < CACHE_MS) return cached.snapshot;
			try {
				const response = await fetch(withWorkBuddyRegion(WORKBUDDY_USAGE_PATH, region), {
					headers: { accept: "application/json" },
					credentials: "same-origin"
				});
				if (!response.ok) return void 0;
				const body = await response.json();
				const showNewModels = body.showNewModelsInMainUi === true;
				const promos = {};
				const rates = {};
				for (const model of body.models ?? []) {
					if (model.creditMultiplier !== void 0) rates[model.id] = model.creditMultiplier;
					if (model.promos !== void 0) promos[model.id] = model.promos;
				}
				const snapshot = {
					levels: body.busyLevels ?? {},
					promos,
					rates,
					newModelIds: showNewModels ? normalizeNewModelIds(body.newModelIds) : []
				};
				caches.set(region, {
					snapshot,
					at: Date.now()
				});
				return snapshot;
			} catch {
				return;
			}
		}
		/** One shared minute ticker, so N mounted labels cost one timer, not N. */
		const minuteTicker = {
			timer: void 0,
			listeners: /* @__PURE__ */ new Set()
		};
		/**
		* Re-render the caller once a minute while it is mounted.
		*
		* @param listener - The callback to run at each tick.
		* @returns The unsubscribe function, which stops the shared timer when the last
		*          listener leaves.
		*/
		function subscribeMinute(listener) {
			minuteTicker.listeners.add(listener);
			if (minuteTicker.timer === void 0) {
				minuteTicker.timer = setInterval(() => {
					for (const each of [...minuteTicker.listeners]) each();
				}, TICK_MS);
				minuteTicker.timer.unref?.();
			}
			return () => {
				minuteTicker.listeners.delete(listener);
				if (minuteTicker.listeners.size === 0 && minuteTicker.timer !== void 0) {
					clearInterval(minuteTicker.timer);
					minuteTicker.timer = void 0;
				}
			};
		}
		/**
		* The upstream's promotion badge, as the picker draws it.
		*
		* Reuses the card's chip class so the two surfaces cannot drift apart, and adds
		* one modifier for the two things a menu row changes: the chip must fit a row
		* that is one line wide (see `.dsm-workbuddy-model-label-promo` in the card's
		* stylesheet), and it is the only place the full tooltip is available.
		*
		* @param props - The resolved promotion, and whether space is tight.
		* @returns The chip.
		*/
		function PromoBadge(props) {
			const { promo, compact } = props;
			const language = uiLanguage();
			const label = compact ? promoBadgeShortLabel(promo, language) : promoBadgeLabel(promo, language);
			const color = promoBadgeColor(promo);
			const tooltip = promoBadgeTooltip(promo, language);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsm-workbuddy-model-promo dsm-workbuddy-model-label-promo",
				title: tooltip === "" ? void 0 : tooltip,
				style: color === void 0 ? void 0 : { "--dsm-workbuddy-promo-color": color },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-workbuddy-model-label-promo-text",
					children: label
				})
			});
		}
		/**
		* The "本机首次见到" marker, as the picker draws it.
		*
		* WHY IT IS HERE AT ALL. The pill's "· N 新模型" answers "how many" and its
		* panel answers "which" — but only once the reader opens it. The picker is
		* where the choice is actually made, and this is the SAME set marked on the
		* row, so a newly seen model is visible the moment the picker opens, with no
		* extra step. It reads the pill's normalised list (`normalizeNewModelIds`), not
		* a second reading of the same field, so the two surfaces cannot disagree.
		*
		* MUTED, and muted further than the promotion chip: a promotion is a fact about
		* price, "新" only says when this machine first recorded the id. The pill's ink
		* (label-dimmed) is reused here for the same reason it is used there — the
		* marker must not out-shout the model name or the chip beside it.
		*/
		function NewModelMark() {
			const language = uiLanguage();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsm-workbuddy-model-label-new",
				title: language === "zh" ? "本机首次见到的模型" : "First seen by this machine",
				children: language === "zh" ? "新" : "NEW"
			});
		}
		/**
		* The one line a foreign badge shows, in the reader's language.
		*
		* Mirrors the host's own resolver (`ctx.locale.resolveText`): a plain string is
		* used verbatim; a table is looked up by the full lowercase tag, then its base
		* tag (`de-DE` → `de`), then `en`, which the contract requires. The host treats
		* an EMPTY string as a translation that exists, so this function deliberately
		* goes one step further and treats it as absent — a blank chip is a decoration
		* that says nothing, and this component would rather draw the bare name.
		*
		* @param text - The badge's literal or its translation table.
		* @returns The line to draw, or `undefined` when nothing readable is left.
		*/
		function resolveHostBadgeText(text) {
			if (typeof text === "string") return text.trim() === "" ? void 0 : text;
			if (text === null || typeof text !== "object") return void 0;
			const language = uiLanguage().toLowerCase();
			const base = language.split("-")[0] ?? "";
			const picked = text[language] ?? (base === "" ? void 0 : text[base]) ?? text.en;
			if (typeof picked !== "string" || picked.trim() === "") return void 0;
			return picked;
		}
		/**
		* The tone palette, mapped onto the tokens the host's own `Tag` paints.
		*
		* WHY THESE EXACT TOKENS. They are read off the host's `Tag.module.css`
		* (0.2.2-rc.1), not invented: `info` rides `state-business-primary` (NOT
		* `brand-primary`) and `warning` rides `state-warn-primary` (NOT
		* `state-warn-secondary`). Getting either wrong leaves two chips in one row
		* that are supposed to look identical and do not.
		*
		* `neutral` is the fallback for an unknown tone: the host's `Tag` would render
		* such a chip unstyled, which reads as a rendering bug next to a real one.
		*/
		const HOST_BADGE_TONES = {
			neutral: {
				color: "var(--dsw-alias-label-secondary)",
				background: "var(--dsw-alias-bg-module-platform)"
			},
			info: {
				color: "var(--dsw-alias-state-business-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent)"
			},
			success: {
				color: "var(--dsw-alias-state-success-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)"
			},
			warning: {
				color: "var(--dsw-alias-state-warn-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)"
			}
		};
		/**
		* A badge another provider published for its own model, drawn where the host's
		* own fallback would have drawn it.
		*
		* WHY THIS PLUGIN DRAWS IT AT ALL. `conversation.input.model.label` is a
		* `single` slot, so this component is called for EVERY provider's rows, not just
		* its own. The host only runs its own badge fallback when the cell has no
		* occupant at all, so without this branch a sibling plugin's badge would never
		* appear anywhere while this plugin holds the cell.
		*
		* WHY IT IS NOT INTER-PLUGIN COORDINATION (`docs/DESIGN.md` §零). The data is
		* `props.model.badge` — the host's catalog field, handed to every occupant of
		* the cell. This component does not know which plugin filled it, does not read
		* the slot ledger, does not render another plugin's component, and its output is
		* identical whether or not any sibling is installed. Data flows one way through
		* the host; there is no channel between plugins. That is the difference between
		* this and §零's rejected "copy the host's 1017 badge", which hard-codes one
		* specific plugin's conditions and styles.
		*
		* NOT A FETCH, NOT A TIMER. A picker can show twenty foreign rows at once, so
		* this must stay a pure function of its props.
		*
		* NO `placement` PARAMETER, DELIBERATELY. The chip is always drawn AFTER the
		* name now, so where it goes is the caller's one-line decision, not something
		* this function needs to know. It used to take `placement` and ignore it, which
		* read as though a placement-dependent rule existed inside the chip.
		*
		* @param props - The badge to draw.
		* @returns The chip, or `undefined` when there is nothing readable to draw.
		*/
		function HostBadgeChip(props) {
			const badge = props.badge;
			if (badge === null || typeof badge !== "object") return void 0;
			const label = resolveHostBadgeText(badge.text);
			if (label === void 0) return void 0;
			const tone = Object.hasOwn(HOST_BADGE_TONES, badge.tone) ? HOST_BADGE_TONES[badge.tone] : HOST_BADGE_TONES.neutral;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsm-workbuddy-model-label-host-badge",
				title: label,
				style: {
					color: tone.color,
					background: tone.background
				},
				children: label
			});
		}
		/**
		* Whether a model's badge will actually draw something.
		*
		* The caller needs this BEFORE it decides on the separator: `<HostBadgeChip/>`
		* is always an element, so rendering `{chip} {name}` and then finding the chip
		* empty leaves a trailing space on the row. Deciding from the text is the only
		* way to know, which is why the resolution is exported rather than duplicated.
		*
		* @param badge - The catalog badge, if any.
		* @returns Whether a chip will be drawn.
		*/
		function hasDrawableBadge(badge) {
			const candidate = badge;
			if (candidate === null || typeof candidate !== "object") return false;
			return resolveHostBadgeText(candidate.text) !== void 0;
		}
		/**
		* The priority this plugin registers the model-label slot at.
		*
		* WHY A DISTINCT PRIORITY AT ALL. `conversation.input.model.label` is a
		* `single` slot: it holds ONE cell, and `SlotCore.register()` THROWS when a
		* second registration claims one priority — "single slot … already has a
		* registration at priority 0 — register at a different priority to shadow it
		* (lowest renders)". The default priority is `0`, which is also what the host's
		* own shipped contributor uses
		* (`@deepseek-ai/dsh-client-ui-deepseek-model-label-1017`, in the web-app
		* bundle from 0.2.1-rc.2 on), so registering at `0` made the two race. Measured
		* on 0.2.1-rc.3 that is US: the app's own crash log records
		* `single slot "conversation.input.model.label" already has a registration at
		* priority 0 (registered by Kb)` and this entry's catch-all line
		* `model label slot failed to register`, and because that catch only logs, the
		* badge simply vanished from the picker with no visible error.
		*
		* WHY NOT `-1`. That is `dsh-connect-qoder`'s slot priority, and two plugins on
		* one priority collide for exactly the same reason `0` did.
		*
		* WHY `-0.5` WAS TOO HIGH — the measured defect. `-0.5` is legal and collides
		* with nothing, but "distinct from everyone" is NOT the same as "wins", and this
		* cell only renders its LOWEST priority. `-0.5` sits ABOVE two contributors that
		* were present in the same profile:
		*
		*     dsh-connect-qoder   -1
		*     dsh-connect-trae    -0.25
		*     this plugin         -0.5   ← lost to qoder, so this component never ran
		*
		* Losing is silent by construction: the winner renders, the loser is simply not
		* called. The symptom is exactly "the picker shows no badges", with correct
		* data, a correct component and no error anywhere — which is what made this cost
		* several rounds to find. The rows still showed `Hy4 · x0.00` because that
		* string is the catalog `model.name` the WINNER drew, not our label.
		*
		* WHY `-105`. The value has to be BELOW every plausible claimant, not merely
		* different from the ones visible today. That is the whole lesson: `-0.5` was
		* chosen to be DISTINCT, was distinct, and still lost. Contributors already
		* shipped at `-10` (`dsh-model-picker-brand`, a label decorator) and `-1`
		* (`dsh-connect-qoder`), so anything in the single digits is a value someone
		* else can step under. `-105` is an ordinary number to the sort (no range is
		* reserved) and makes the ordering a decision of this plugin rather than a race
		* it keeps losing.
		*
		* WHY NOT `-100` — MEASURED, TWICE. `-100` won for a while, then two other
		* connectors moved underneath it in the same profile:
		*
		*     dsh-connect-qoder   -1   → -101
		*     dsh-connect-trae    -0.25 → -102
		*     this plugin         -100 → lost to both
		*
		* Both of them wrote THIS constant into their own source comments while doing
		* it, which is the clearest evidence that the cell is a contest and not a
		* composed surface: each new connector reads the others' shipped values and
		* steps under the lowest one. `-105` keeps a small gap below `-102` rather than
		* a huge one, so the next connector that wants the cell has to say so
		* explicitly too.
		*
		* THE COST, STATED PLAINLY. Winning here is not free: in `single` semantics the
		* winner draws EVERY row, so trae's and qoder's chips would disappear from the
		* picker exactly as ours did. What closes that gap is NOT a priority choice — it
		* is `HostBadgeChip` below: a sibling plugin publishes its badge in ITS
		* `adapter.listModels()`, the host carries it in the catalog, and this component
		* reproduces it on that plugin's rows. Every connector that adopts that channel
		* keeps its chip whichever of them wins the cell (`docs/MODEL-LABEL-SPEC.md`).
		* This value is still chosen so the users of THIS plugin see its full surface,
		* not because the arrangement is fair.
		*
		* A low priority is also the CORRECT semantic here: this label shows more than
		* any other contributor (name + price + promotion + load + new-model mark), so
		* it should be the one that takes the cell when several want it.
		*
		* WHAT CHANGES WHEN THE HOST KEYS THE SLOT — and why the number stays. On a host
		* that declares this slot `keyed`, the seat is registered once per provider id
		* (see `modelLabelSeats` in `./model-label-seat.ts`), each `key` is its own
		* cell, and priority stops deciding WHO IS VISIBLE: qoder's `-101` and trae's
		* `-102` no longer share a cell with this `-105`, so none of the three can
		* shadow another. Priority keeps exactly one meaning inside a cell — the
		* tie-breaker between two registrations that claim the SAME provider id, where
		* an equal value throws and the lowest renders. The value is therefore not
		* lowered to keep winning an auction that no longer happens; it is kept because
		* it is this plugin's rank for its own rows.
		*
		* WHAT THIS PLUGIN DELIBERATELY DOES NOT DO. It does not read the slot ledger,
		* does not look for another plugin's registration, and does not render another
		* plugin's component. Foreign rows get the plain catalog name PLUS the model's
		* own `badge`, when the host's catalog carries one — that badge is host data
		* (`props.model.badge`), not another plugin's component, and this component
		* cannot tell which provider wrote it. Inter-plugin chaining is out of scope by
		* project policy (`docs/DESIGN.md` §零) — and that policy is NOT stricter than
		* the Host's own: the shipped `dsh-client-ui-deepseek-model-label-1017` README
		* lists, under "Known Limitations and Deferred Work", that "another model-label
		* plugin at the same priority conflicts; the two presentations do not compose
		* automatically", and the remedy it documents is DISABLING it in the profile
		* patch — a configuration decision, not a runtime negotiation. Reproducing a
		* catalog badge is neither of those: nothing here branches on another plugin
		* being present.
		*
		* WHY WINNING IS THE RIGHT SIDE OF THAT TRADE. 1017 is a TEMPORARY marker
		* (its own package description: "Temporary 1017 release badge …"; its README
		* says to remove the package and its bundle row once structured release labels
		* replace it) and it decorates exactly ONE model, on two provider routes. This
		* plugin decorates every WorkBuddy model row with load level, promo price and
		* the new-model mark — its core surface. Trading a long-lived feature for a
		* temporary marker is the wrong way round, and when 1017 is removed this
		* plugin is already the only occupant of the cell.
		*
		* Exported so the test asserts against the value that actually ships rather
		* than a copy of it.
		*/
		const MODEL_LABEL_PRIORITY = -105;
		/**
		* The label for one model row in the host's picker.
		*
		* Self-contained by design: a model this plugin owns gets the full label, and
		* anything else gets the catalog name plus that model's own `badge`, if its
		* provider published one. There is no forwarding and no consultation of other
		* plugins' registrations — see `MODEL_LABEL_PRIORITY`.
		*
		* WHY THE FOREIGN BRANCH STILL EXISTS ON A KEYED HOST. It is unreachable there —
		* each seat is registered under one provider id, the owner dispatches with
		* `entryKey: provider.id`, so a lookup only ever finds the entry whose key
		* matches the row it is drawing. But ONE build serves both contracts
		* (`./model-label-seat.ts` derives the seats from the host's declaration), and
		* on a `single` host this branch is not just reachable, it is the whole row:
		* that host renders one winner for every provider. Deleting it would fix the
		* keyed case by breaking the single one.
		*
		* Its continued presence is therefore also the cheapest possible check that the
		* seat keys are right: on a keyed host, reaching this branch with a WorkBuddy
		* provider id means a seat was registered under the wrong key, and the row has
		* silently degraded to the host's fallback — visible as a missing load badge on
		* exactly those rows, nowhere else.
		*
		* @param props - The host's model identity and the placement of this label.
		* @returns The catalog name, the promotion chip when one holds, the load badge
		*          when the probe reported one, or a sibling's badge on a foreign row.
		*/
		function WorkBuddyModelLabel(props) {
			const { provider, model, placement } = props;
			const region = regionOfProvider(provider.id);
			if (region === void 0) {
				if (!hasDrawableBadge(model.badge)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name });
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-model-label dsm-workbuddy-model-label-host-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HostBadgeChip, { badge: model.badge })]
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkBuddyModelLabelInner, {
				modelId: model.id,
				name: model.name,
				region,
				compact: placement !== "trigger"
			});
		}
		/** The stateful half: fetches the snapshot, then renders what holds right now. */
		function WorkBuddyModelLabelInner(props) {
			const { modelId, name, region, compact } = props;
			const [snapshot, setSnapshot] = (0, react.useState)(void 0);
			const [, setTick] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let live = true;
				statusNow(region).then((next) => {
					if (!live || next === void 0) return;
					setSnapshot(next);
				});
				return () => {
					live = false;
				};
			}, [modelId, region]);
			(0, react.useEffect)(() => subscribeMinute(() => setTick((count) => count + 1)), []);
			const level = snapshot?.levels[modelId];
			const promo = snapshot === void 0 ? void 0 : selectPromoBadge(snapshot.promos[modelId], Date.now());
			const discounted = snapshot === void 0 ? void 0 : selectPromoMultiplier(snapshot.promos[modelId], Date.now());
			const { base, rate } = splitCatalogRate(name, snapshot?.rates[modelId], discounted);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dsm-workbuddy-model-label",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: base }),
					rate === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-model-label-rate",
						children: [" · x", rate.toFixed(2)]
					}),
					promo === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromoBadge, {
						promo,
						compact
					}),
					level === void 0 ? null : busyIcon(level, "zh"),
					snapshot?.newModelIds.includes(modelId) ?? false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NewModelMark, {}) : null
				]
			});
		}
		/**
		* Split the host's display name into "name" and "the multiplier to show".
		*
		* `workBuddyDisplayName` builds `"<name> · x<multiplier>"` and the host renders
		* that string verbatim, so appending another rate next to it printed the figure
		* twice in the picker (`DeepSeek-V4.1-Flash · x0.11 · x0.11`). The suffix is
		* therefore pulled back OUT of the string and re-drawn in the span that can
		* carry the discounted value — exactly one number, and it is the one that holds
		* right now.
		*
		* The suffix is recognised by SHAPE, not by comparing against the snapshot's
		* `baseRate`: the two can disagree (a promotion can change the catalog figure
		* between the snapshot and this render), and leaving the suffix in place then
		* prints two numbers again — the very defect this function removes.
		*
		* @param name - The host's rendered name, possibly ending in ` · x<rate>`.
		* @param baseRate - The catalog multiplier, as the snapshot reports it.
		* @param discounted - The rate to show instead, when a discount is running.
		* @returns The name without its rate suffix, and the single rate to draw.
		*          `undefined` means "draw no number" (the name had none and no
		*          discount is running).
		*/
		function splitCatalogRate(name, baseRate, discounted) {
			const match = / · x(\d+(?:\.\d+)?)$/.exec(name);
			const fromName = match === null ? void 0 : Number(match[1]);
			return {
				base: match === null ? name : name.slice(0, match.index),
				rate: discounted ?? fromName ?? baseRate
			};
		}
		//#endregion
		//#region src/client/model-label-seat.ts
		/**
		* Read the declared kind of a slot, or `undefined` when it is not declared yet.
		*
		* `spec()` is the documented read-only accessor (`SlotRegistry.spec`), present
		* on 0.1.7 and on 0.2.2. It is also the only way to learn the kind: the
		* declaration lives in the host package, and a plugin's own `SlotMap`
		* augmentation says what this plugin HOPES the slot is, not what the running
		* host declared.
		*
		* Anything unexpected — no `spec` method on an older line, a throw from a
		* service that is not ready, a kind this build does not know — returns
		* `undefined`, and the caller falls back to the single-cell shape. That is the
		* conservative direction: it is what every released version of this plugin
		* already does.
		*
		* @param slots - The `slots` service (typed loosely: the accessor is optional).
		* @param key - The slot key to inspect.
		* @returns The declared kind, or `undefined`.
		*/
		function declaredSlotKind(slots, key) {
			const face = slots;
			if (face === void 0 || typeof face.spec !== "function") return void 0;
			let spec;
			try {
				spec = face.spec(key);
			} catch {
				return;
			}
			const kind = spec?.kind;
			if (kind === "single" || kind === "list" || kind === "keyed" || kind === "chain") return kind;
		}
		/**
		* The registrations this plugin should make for the model-label seat.
		*
		* `keyed` yields ONE seat per provider id: each is its own cell, each renders
		* only the rows whose owner props carry that provider id, and a provider this
		* plugin does not own falls through to the owner's own fallback (the catalog
		* name, plus that model's `badge` on hosts that have one).
		*
		* Every other kind — including `undefined`, i.e. a host that cannot be
		* inspected — yields the single historical seat. That is not a degraded mode:
		* it is what `single` requires, and on a not-yet-declared slot it is what the
		* inject callback is about to find.
		*
		* An empty provider list under `keyed` would silently disable the label, so it
		* falls back to the single seat instead: a wrong-shaped registration that still
		* draws something beats a correct-shaped registration that draws nothing.
		*
		* @param params - Slot key, declared kind, this plugin's provider ids, priority.
		* @returns One or more `register()` option objects, in registration order.
		*/
		function modelLabelSeats(params) {
			const { name, kind, providerIds, priority } = params;
			if (kind === "list" || kind === "chain") return [];
			if (kind === "keyed" && providerIds.length > 0) return providerIds.map((id) => ({
				name,
				key: id,
				priority
			}));
			return [{
				name,
				priority
			}];
		}
		/**
		* Claim every planned seat, atomically, and hand back ONE disposer.
		*
		* WHY ATOMIC. The seat list is 2-3 entries on a `keyed` host, and `register()`
		* can throw on any ONE of them — a rival plugin claiming the same provider id at
		* the same priority, or the declaration collapsing mid-loop. A plain `.map()`
		* would then leave the earlier seats landed on the ledger with their disposers
		* unreachable (they were only ever held by the array that the throw discarded),
		* which is worse than failing outright: the component stays mounted, the caller
		* believes registration failed, and nothing will ever release those cells. On a
		* `single` host it also means the identity keeps a live entry that the next
		* `inject` re-run cannot displace without a priority clash.
		*
		* So a partial failure is rolled back in reverse order before the error is
		* rethrown, exactly as if it had never been attempted. The rethrow is important:
		* each caller already has a catch that logs, and swallowing here would hide the
		* refusal from the diagnostics that exist to explain it.
		*
		* A disposal that itself throws must not mask the original error, hence the
		* inner catch — the registry treats a second dispose as a no-op, and a broken
		* one must not turn one failure into a crash.
		*
		* @param seats - The plan from {@link modelLabelSeats}, in registration order.
		* @param register - Claims one seat and returns its disposer.
		* @returns One disposer that releases every seat, in reverse registration order.
		*/
		function registerModelLabelSeats(seats, register) {
			const claimed = [];
			try {
				for (const seat of seats) claimed.push(register(seat));
			} catch (error) {
				for (const dispose of [...claimed].reverse()) try {
					dispose();
				} catch {}
				throw error;
			}
			return () => {
				for (const dispose of [...claimed].reverse()) try {
					dispose();
				} catch {}
			};
		}
		//#endregion
		//#region src/client/CodebuddyLive.tsx
		/**
		* The composer pill that says what the CodeBuddy CLI route is doing RIGHT NOW.
		*
		* WHY THIS EXISTS. A bridged turn is a spawned agent: minutes of reading files
		* and running commands, then one answer. The Host tool contract has no progress
		* channel — `execute()` returns when it returns — so without this pill the user
		* watches a spinner with no way to tell "still working" from "hung". The pill is
		* fed by the plugin's own read-only route (`WORKBUDDY_CLI_LIVE_PATH`), which
		* serializes the host-side live board (see `../cli-bridge/live.ts`).
		*
		* WHY IT RENDERS NOTHING WHEN IDLE. This is the ambient dock under the composer,
		* a row the shell already fills with round/token pills. A permanent "no turn
		* running" line would be a claim about a feature most users never switch on
		* (`cliBridge.enabled` defaults to false), so the empty state is `null`: the row
		* is untouched until there is something true to say.
		*
		* WHY IT ONLY DESCRIBES THIS SESSION'S TURN. The board is host-wide: one route
		* answers for every session in the process, so an unfiltered pill would show the
		* turn another tab started — a line about a directory the user is not looking at,
		* sitting under the composer they are typing in. The seat is declared
		* `scope: 'session'` (`conversation.composer.dock`), so the framework hands the
		* registration its `sessionId`; the pill keeps the rows that belong to it.
		*
		* WHY NOT THE PROVIDER GATE THE CREDIT READOUT USES. `ComposerCredits` renders
		* only while the session's model is a WorkBuddy provider, because it reports that
		* provider's quota. This pill reports a spawned CLI process, and the CLI route is
		* deliberately model-independent: the whole point is that it works from any
		* session, including one running DeepSeek. Gating it on the provider would hide
		* the readout exactly when the feature is being used the way it was designed.
		* `cliBridge.enabled` needs no gate either — with the bridge off no turn can
		* begin, so the board is empty and the pill renders nothing.
		*
		* WHY POLLING, AND WHY THE INTERVAL IS 5s. The Host has no push channel to a
		* session component, so a poll is the only option. Five seconds is the slowest
		* cadence at which a turn that just started still feels immediate; the elapsed
		* counter between polls is advanced locally from `startedAt` (a 1s tick that
		* costs no request), so the number moves every second without the network
		* traffic moving with it. Concurrent sessions share ONE in-flight request per
		* interval (see {@link readLive}), which is what keeps N open tabs from becoming
		* N polls per tick.
		*
		* WHY THE CLOCK OFFSET IS APPLIED. `startedAt` is the HOST's clock. A browser
		* whose clock is a minute behind would compute a negative age and the pill would
		* print nonsense. The document ships `serverTime`, so the offset is measured at
		* each successful read and applied to the local clock instead of trusting the
		* two machines to agree.
		*
		* @module dsh-connect-workbuddy/client/CodebuddyLive
		*/
		/**
		* Inject the dock stylesheet on module load, once.
		*
		* `ComposerCredits` injects the same sheet for its own classes, and in the
		* shipped bundle both modules are static imports of the client entry, so in
		* practice the sheet is already there. This block is not redundant: it makes the
		* pill independent of whether the credit readout is mounted at all (the gate can
		* hide it for a non-WorkBuddy model), and the `data-plugin-css` guard means the
		* two never produce a second tag.
		*/
		if (typeof document !== "undefined") {
			const cssId = "dsh-connect-workbuddy/composer-credits.css";
			if (!document.querySelector(`style[data-plugin-css="${cssId}"]`)) {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-connect-workbuddy";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = WORKBUDDY_COMPOSER_CSS;
				document.head.appendChild(styleTag);
			}
		}
		/** How often the route is asked. See the module comment for why 5s. */
		const CLI_LIVE_POLL_MS = 5e3;
		/**
		* The last document any component in this page saw, shared across sessions.
		*
		* A module-level cache is safe here because the document is host state, not
		* component state: every session polls the same board, so one request serves
		* them all. `inflight` collapses the case where several components mount in the
		* same tick — without it, opening three sessions at once would fire three
		* requests and each would overwrite the others' result.
		*/
		let cached;
		let inflight;
		/**
		* Accept a document only if every number the pill does arithmetic on is a real
		* number.
		*
		* The route is our own, so this is not defence against an attacker — it is
		* defence against a HALF-AGREED wire: a field renamed on the host side, an
		* `undefined` that `JSON.stringify` drops, or a future route that answers a
		* different shape. Without the check `serverTime` becomes `NaN`, the clock
		* offset becomes `NaN`, and the pill renders `NaNs` — a number that is wrong in
		* the one place a user is looking for reassurance. Dropping the whole document
		* degrades to "no turn", which is the honest answer when the wire is unreadable.
		*/
		function acceptDocument(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const candidate = value;
			if (!Array.isArray(candidate.turns)) return void 0;
			if (typeof candidate.serverTime !== "number" || !Number.isFinite(candidate.serverTime)) return void 0;
			return {
				turns: candidate.turns.filter((turn) => {
					if (typeof turn !== "object" || turn === null) return false;
					const row = turn;
					return typeof row.startedAt === "number" && Number.isFinite(row.startedAt) && typeof row.toolCalls === "number" && Number.isFinite(row.toolCalls);
				}),
				serverTime: candidate.serverTime
			};
		}
		/** Read the board, reusing a recent document or a request already in flight. */
		async function readLive(fetchImpl, now = Date.now(), cacheMs = CLI_LIVE_POLL_MS) {
			if (cached !== void 0 && now - cached.at < cacheMs) return cached.document;
			if (inflight !== void 0) return inflight;
			inflight = (async () => {
				try {
					const response = await fetchImpl(WORKBUDDY_CLI_LIVE_PATH, { headers: { accept: "application/json" } });
					if (!response.ok) return void 0;
					const document = acceptDocument(await response.json());
					if (document === void 0) return void 0;
					cached = {
						at: Date.now(),
						document
					};
					return document;
				} catch {
					return;
				} finally {
					inflight = void 0;
				}
			})();
			return inflight;
		}
		/**
		* The text of one pill.
		*
		* Split out so the format is testable without a DOM, and so the same function
		* produces the visible label and the accessible one.
		*/
		function liveLabel(turn, elapsedMs, t) {
			const seconds = Math.max(0, Math.round(elapsedMs / 1e3));
			const parts = [t("cliLive.running"), t("cliLive.toolCalls", { count: turn.toolCalls })];
			if (turn.phase === "starting") parts.push(t("cliLive.starting"));
			else if (turn.phase === "finishing") parts.push(t("cliLive.finishing"));
			else parts.push(t("cliLive.elapsed", { seconds }));
			if (turn.lastTool !== "") parts.push(t("cliLive.lastTool", { tool: turn.lastTool }));
			return parts.join(" · ");
		}
		/**
		* Keep the rows this pill is allowed to describe.
		*
		* A row with an empty `sessionId` is one the host could not attribute (the tool
		* ran without an agent on the execution object). Hiding those would make the pill
		* silently useless on such a host, so they are kept: an unattributed row is
		* evidence of real work, and the alternative is a readout that never appears.
		*/
		function turnsForSession(turns, sessionId) {
			if (sessionId === void 0 || sessionId === "") return turns;
			return turns.filter((turn) => turn.sessionId === "" || turn.sessionId === sessionId);
		}
		/**
		* The pill itself.
		*
		* Shows the NEWEST turn (the one the last click started) and appends `+N` when
		* several are live, because the dock is a single line and a queue listing would
		* wrap. The count is the whole point of the `+N`: it tells the user there is
		* more work running than the line describes.
		*/
		function CodebuddyLive(props) {
			const { t } = props;
			const fetchImpl = props.fetchImpl ?? (typeof fetch === "function" ? fetch : void 0);
			const pollMs = props.pollMs ?? 5e3;
			const tickMs = props.tickMs ?? 1e3;
			const [document, setDocument] = (0, react.useState)(void 0);
			const [, setTick] = (0, react.useState)(0);
			const offsetRef = (0, react.useRef)(0);
			const offsetForRef = (0, react.useRef)(void 0);
			const failuresRef = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (fetchImpl === void 0) return void 0;
				let live = true;
				const read = () => {
					readLive(fetchImpl, Date.now(), pollMs).then((next) => {
						if (!live) return;
						if (next === void 0) {
							failuresRef.current += 1;
							if (failuresRef.current >= 3) setDocument(void 0);
							return;
						}
						failuresRef.current = 0;
						if (next.serverTime !== offsetForRef.current) {
							offsetForRef.current = next.serverTime;
							offsetRef.current = next.serverTime - Date.now();
						}
						setDocument(next);
					});
				};
				read();
				const timer = setInterval(read, pollMs);
				return () => {
					live = false;
					clearInterval(timer);
				};
			}, [fetchImpl, pollMs]);
			const turns = turnsForSession(document?.turns ?? [], props.sessionId);
			const active = turns.length > 0;
			(0, react.useEffect)(() => {
				if (!active) return void 0;
				const timer = setInterval(() => {
					setTick((value) => value + 1);
				}, tickMs);
				return () => {
					clearInterval(timer);
				};
			}, [active, tickMs]);
			if (!active) return null;
			const turn = turns[turns.length - 1];
			const label = liveLabel(turn, Math.max(0, Date.now() + offsetRef.current - turn.startedAt), t);
			const extra = turns.length > 1 ? ` +${String(turns.length - 1)}` : "";
			const dirTail = turn.workingDir.replace(/[\\/]+$/u, "").split(/[\\/]/u).pop() ?? "";
			const title = dirTail === "" ? `${label}${extra}` : `${label}${extra} · ${dirTail}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				role: "status",
				"aria-label": t("cliLive.aria", { detail: label }),
				title,
				className: "dsm-workbuddy-cli-live",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						className: "dsm-workbuddy-cli-live-dot"
					}),
					label,
					extra
				]
			});
		}
		//#endregion
		//#region src/client/WorkBuddyQuotaNotice.tsx
		/**
		* The supplement this plugin adds to a quota failure (issue #63).
		*
		* 参考：`dsh-connect-trae`（MIT）— 「以插件身份向宿主的通知链注册一个条目」的
		*   席位用法与自建 DOM（不依赖 ui-primitives）的渲染约定，见 docs/DESIGN.md §5.3。
		* 改动：本模块是原创实现，但其中两处决定**与本文件早期版本相反**，且都是被真机
		*   截图推翻的：(1) 曾认领 `shell.quota-notice` 链并在其中重绘宿主句子，后判定该
		*   链的语义是「接管整个界面」而非加装饰，遂改为**一律拒收**；(2) 曾是带按钮的
		*   卡片，后改为只读的行内括号。两处的原因各自写在下文对应位置，删改前请先读。
		*
		* WHY THIS EXISTS. When an upstream failure is classified `QUOTA`, the host
		* renders ONE fixed sentence — 「当前请求的额度已用尽」 — and (measured on the
		* shipped client) it DISCARDS the provider's own message to do so:
		*
		*   function failureMessage(message, code, t) {
		*     if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return t('message.failure.quota')
		*     return code === 'AUTH' ? t('message.failure.auth') : message
		*   }
		*
		* That sentence is right for a genuinely exhausted account (14018), and wrong
		* for `6004` — the upstream's own words are 「您的使用量已超出频率限制，将在
		* <时刻> 重置」, and the reporter's account still held 6,788 credits. The
		* plugin cannot fix that by re-classifying: measured against the shipped
		* classifier, every spelling that stops reading as `QUOTA` falls into
		* `RATE_LIMIT`, which IS in `DEFAULT_RETRYABLE_CODES` — so it would buy an
		* honest sentence with 5 in-place retries and ~15.5s of backoff on a limit that
		* resets hours later. Staying out of the retry set is the behaviour we keep
		* (the maintainer's call on issue #63); the sentence is what we supplement.
		*
		* HOW (SUPERSEDED — see the DECLINE note below). The host ships a CHAIN seat
		* for exactly this: `shell.quota-notice`, a frame-wide surface whose own
		* comment says "a `shell.quota-notice` entry may replace the generic Toast for
		* codes it claims". An earlier build of this plugin claimed `QUOTA` there and
		* re-rendered the sentence plus the supplement.
		*
		* THE DECLINE (the maintainer's call, on a screenshot). Claiming a chain entry
		* does not decorate the host's surface, it TAKES IT OVER: the host's generic
		* warning Toast is then not rendered at all, and what replaced it was an inline
		* `<span>` — no fixed positioning, no centring, no background, no fade-out. It
		* landed at the top-left of `shell.overlay` and stayed. That is the box the
		* maintainer reported as "not being there before", and it was correct: the
		* plugin had painted it. The registration now declines every owner, so the
		* host's own Toast is what shows — a surface whose look this plugin does not
		* get to decide — and the supplement lives in the conversation instead, beside
		* the host's failure row, which is where the user is actually looking when a
		* turn fails.
		*
		* WHY THE HOST'S SENTENCE IS LEFT ALONE: it is the string the shell shows
		* everywhere else for this code, and a plugin that reworded it would contradict
		* the shell's own vocabulary. The supplement is additive, and it is written to
		* be TRUE FOR BOTH CASES the code covers — a model's own daily quota (not
		* credits) and a genuinely empty balance — because the plugin cannot always
		* tell which one it is: the upstream states it in Chinese prose the plugin is
		* not allowed to parse for policy.
		*
		* Rendered as plain DOM with this plugin's own classes: the client half
		* deliberately does not depend on `@deepseek-ai/dsh-client-ui-primitives` (see
		* the note in `src/client/index.tsx` — a stale inject entry there once made the
		* whole card's arrival depend on the churn-heaviest host package), so the
		* notice is built from the same primitives every other component here uses.
		*/
		/**
		* The chain selector: which owner (if any) this plugin takes over.
		*
		* ALWAYS `null`, and that is the fix — see the DECLINE note in the file header.
		* Exported so the decline is unit-testable without a host: the spec asserts
		* this returns null for every owner, which is what keeps the host's own Toast
		* on screen. A function rather than an inline lambda in the registration so the
		* rule has one home and one test, instead of being restated at the call site.
		*/
		function selectQuotaNoticeClaim(_owner) {
			return null;
		}
		/**
		* The supplement this plugin adds to a quota failure.
		*
		* It is what the `shell.quota-notice` chain WOULD render if the registration
		* claimed an owner — which it no longer does. Kept as the rendering seat for
		* the supplement so the copy, the locale keys and their guards survive the
		* decline: the next surface that wants this sentence (a failure row, a
		* transcript notice) mounts this component rather than re-inventing the markup.
		*
		* ONE line, no body, no button, no host sentence of its own — the takeover that
		* used to prepend the host's sentence is exactly what was removed.
		*/
		function WorkBuddyQuotaNotice(props) {
			const { t } = props;
			return (0, react.createElement)("span", {
				className: "dsm-workbuddy-quota-notice",
				role: "status"
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-quota-notice-body" }, t("quotaNotice.supplement")));
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Plugin-card copy registered under the settings.workbuddy locale namespace.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — `row.*` 的文案键约定与中英 1:1 键对齐（`zh: Record<Key, string>`
		*     强制双语同步）来自该项目，其又继承自
		*     dingminhua/dsh-subagent-default-model（MIT）。
		* 改动：文案按 WorkBuddy 的实际情况改写（积分套餐、模型倍率、多账号）。
		*
		* @module dsh-connect-workbuddy/client/locales
		*/
		const en = {
			"nav.panel": "WorkBuddy",
			"row.iconStyleLead": "Appearance — what the plugin looks like, not what it may do.",
			"row.iconStyleLabel": "Icon style",
			"row.iconStyleHint": "Takes effect on the click in the sidebar, the page header and the panel. The default is this plugin's own icon; the alternative skin follows the theme's text colour. The choice is stored in this browser only.",
			"row.iconStyleClaude": "Claude style",
			"row.iconStyleOriginal": "Default icon",
			"row.iconStyleSaveFailed": "The icon choice could not be saved. Check browser storage permissions.",
			"nav.back": "Back to conversation",
			"row.title": "WorkBuddy credits & models (dsh-connect-workbuddy)",
			"row.desc": "Use WorkBuddy models in DSH: each refresh reads every model's credit multiplier from the upstream catalog, image input is toggled per model, several accounts can be switched or failed over automatically, and daily check-in plus your remaining credits are one click away. The domestic and international sides are two independent providers, each with its own account — use both at the same time.",
			"row.expand": "Expand",
			"row.collapse": "Collapse",
			"row.tabCn": "Domestic",
			"row.tabGlobal": "Global",
			"row.tabHint": "Each tab is a separate provider (workbuddy / workbuddy-global) with its own account, credits, and models. Both sides are live at once: different sessions can pick from either side, and changes on one tab never touch the other.",
			"row.tabFreeQuotaWarn": "Free models are not unlimited — the upstream limits them by request size and load.",
			"row.tabSwitchHint": "Uncheck to switch this provider off. Its models disappear from the DSH model picker; your account, credits, and model settings are kept and return when you check it again.",
			"row.tabSwitchAria": "Offer the {region} provider to DSH",
			"row.tabOffNotice": "This provider is switched off: none of its models are offered to DSH. Your account, credits, and model settings are kept — check the box above the tab to bring it back.",
			"row.signedOutHint": "Sign in once in the WorkBuddy desktop app; this plugin follows that sign-in automatically.",
			"row.signedOutWrongRegion": "Your WorkBuddy sign-in was found, but it belongs to the other region tab. Switch tabs above to use it — there is nothing to sign in again.",
			"row.signedOutEncrypted": "Your WorkBuddy sign-in is present, but its token fields are encrypted and the plugin could not read the key. Install the WorkBuddy desktop app, or set WORKBUDDY_APP_EXECUTABLE to its executable — signing in again will not change this.",
			"row.searchedTitle": "Paths checked",
			"row.searchedHint": "If your WorkBuddy keeps its login somewhere else, point the plugin at it with the WORKBUDDY_AUTH_FILE environment variable.",
			"row.reasonMissing": "not found",
			"row.reasonUnreadable": "unreadable",
			"row.reasonInvalid": "no usable token",
			"row.reasonEncrypted": "encrypted — needs the desktop app",
			"row.reasonWrongRegion": "belongs to the other region",
			"row.sourceDesktop": "desktop app",
			"row.sourceDsh": "plugin copy",
			"row.searchedMore": "Show the {count} path(s) that were not found",
			"row.reloginHint": "If errors occur, sign back in to the WorkBuddy app.",
			"row.rescanHidesKept": "The accounts you removed are still hidden: the plugin could not update its own list file. On Windows this is usually a file lock — close antivirus or sync tools that may be holding files in the DSH profile, then try again.",
			"row.credentialRejectedTitle": "WorkBuddy refused this account's token",
			"row.credentialRejectedIntro": "The token for \"{accountName}\" is no longer accepted by the upstream, so credits and check-in are unavailable. Signing in again only helps if the problem is the token itself — here is what actually applies:",
			"row.credentialRejectedSwitch": "Another sign-in on this machine answered the upstream: \"{accountName}\". Switching to it fixes this — no need to sign in again.",
			"row.credentialRejectedSwitchAction": "Switch to \"{accountName}\"",
			"row.credentialRejectedRelogin": "No other local sign-in exists to switch to. Sign in again in the WorkBuddy desktop app.",
			"row.credentialRejectedChoose": "Other local sign-ins exist but none of them answered the upstream just now. Try switching to one above; if none works, sign in again in the desktop app.",
			"row.requestFailed": "Request failed",
			"row.requestFailedHint": "Refresh failed — showing the last loaded data: {message}",
			"row.usageErrorHint": "Could not read the account status: {message}. The local DSH service may have just restarted — retrying automatically.",
			"row.usageRetry": "Retry",
			"row.poolErrUnavailable": "The account pool is not available in this build (or its batch route is missing). Restart the app; if it persists, the plugin needs reinstalling.",
			"row.poolErrFailed": "The batch failed on the host side: {message}",
			"row.poolErrHttp": "The batch was refused (HTTP {status}). Check the plugin is up to date and try again.",
			"row.poolErrRouteMissing": "The batch endpoint did not answer (HTTP {status}, no body) — the DSH Host is probably still running older plugin code, so this route is not registered. Quit DSH completely and start it again, then retry.",
			"row.poolErrNoMembers": "No account is checked into this pool — the batch had nothing to run. Check at least one account and save.",
			"row.poolErrNoLiveMembers": "Every account checked into this pool has lost its local sign-in, so the batch had nothing to run. Sign in again in the WorkBuddy desktop app, or save to drop them.",
			"row.poolErrNoFreeModel": "This region has no zero-multiplier model to test with. Refresh the model catalog, or pick a target model yourself.",
			"row.poolErrNoCheckin": "This region has no daily check-in — the action is not offered here.",
			"row.poolErrStaleModel": "The target model is no longer offered by this region. Pick another, or switch back to automatic.",
			"row.creditsError": "Credit query unavailable: {message}",
			"row.refresh": "Refresh",
			"row.refreshing": "Refreshing…",
			"row.accountUnnamed": "Unnamed account",
			"row.accountsHint": "Choose from locally detected sign-ins. Tokens are never shown or saved in DSH settings.",
			"row.accountsRescan": "Detect accounts again",
			"row.accountsScanning": "Detecting…",
			"row.accountsLoading": "Loading your accounts…",
			"row.accountsWriteFailed": "The account change was not saved: {message} — the active profile's configuration file could not be updated (on Windows it may be locked by an antivirus scanner or a sync client). Your previous choice is still in effect; close whatever holds that file and try again (see docs/WINDOWS.md in the plugin repo for the exact path).",
			"row.selectionLostHint": "The saved account no longer exists locally.",
			"row.selectionLostMessage": "The account saved for this region is no longer among the local sign-ins (WorkBuddy replaced its login or cleaned up backups). Your other sign-ins are fine — pick a current one from the list above. Signing in again in the desktop app will not fix this.",
			"row.vaultUnreadableHint": "The credential vault directory could not be read ({message}). This is usually a permissions problem, not a lost account: the saved accounts are still on disk. Run as administrator: takeown /F \"<vault dir>\" /R /D Y && icacls \"<vault dir>\" /reset /T, then restart DSH. The directory path is documented in docs/WINDOWS.md of the plugin repo.",
			"row.panelAccounts": "Accounts",
			"row.panelModels": "Models",
			"row.panelCapabilities": "Capabilities",
			"row.panelCapabilitiesHint": "What the plugin may do on your behalf. The switches take effect on the click — there is no Save button for them. The one field at the top (the CN gateway) is a draft and saves on its own button, because a half-typed host must never become the live one.",
			"row.panelDiag": "Diagnostics",
			"row.panelAria": "Card sections",
			"row.diagHint": "What this card actually read, so a report can quote it. Nothing here changes a setting.",
			"row.diagRegion": "Region",
			"row.diagDomain": "Upstream domain",
			"row.diagAccount": "Serving account",
			"row.diagToken": "Sign-in expires",
			"row.diagCatalog": "Models in the catalog",
			"row.diagEnabled": "Enabled models",
			"row.diagPool": "Account pool",
			"row.diagPoolOn": "on · {count} accounts",
			"row.diagPoolOff": "off",
			"row.diagFailures": "Last failure",
			"row.diagNoFailures": "Nothing reported.",
			"row.diagPromoUnreadable": "{count} promotion hour(s) unreadable — badge hidden",
			"row.cardCrashed": "The configuration area failed to render.",
			"row.cardCrashedHint": "The model provider itself is unaffected — chat and credits keep working. Quote the line above in a bug report.",
			"row.modelsTitle": "Models",
			"row.modelsDirty": "unsaved changes",
			"row.modelsRefresh": "Refresh from WorkBuddy",
			"row.modelsRefreshing": "Refreshing models…",
			"row.discard": "Discard changes",
			"row.save": "Save",
			"row.saving": "Saving…",
			"row.saveError": "Save failed: {message}",
			"row.saveContentionHint": " (The file was locked, so the write was refused — on Windows this is usually an antivirus scanner, a sync client such as OneDrive, or an editor with that file open. Close whatever holds it and save again; your edits are still here.)",
			"row.modelContext": "Maximum context {context}",
			"row.contextBudget": "DSH context budget",
			"row.modelOutput": "Output {output}",
			"row.modelRate": "{rate}x credits",
			"row.modelMultimodal": "Multimodal",
			"row.modelImage": "Image",
			"row.modelImageText": "Image input: the vendor documents this model as text-only, so a refresh leaves it unchecked. Tick it yourself only if you know it reads images.",
			"row.modelImageUnverified": "Image input unverified: no vendor source confirms this model reads images, so a refresh leaves it unchecked rather than guessing. Tick it yourself if you have verified it works.",
			"row.modelOff": "Can disable",
			"row.modelOffHint": "Offer the “off” level for this model",
			"row.modelOffRefused": "refuses off",
			"row.modelOffRefusedHint": "Measured to reject the “off” level with HTTP 400 (code 11133) on both gateways. With this ticked, every request that carries no reasoning tier — compaction summaries above all — would fail, so it cannot be enabled here.",
			"row.modelEffortLabel": "Default reasoning",
			"row.modelEffortAria": "Default reasoning level for {model}",
			"row.modelEffortHint": "The reasoning level this model uses when a request names none — new conversations, compaction summaries and session titles. Only the levels WorkBuddy itself declares for this model are offered; “Default (x)” names the level that will actually be used: your pick if you made one, otherwise the level WorkBuddy declares for this model, otherwise that model’s own middle tier (never its weakest one).",
			"row.modelEffortFollow": "Default",
			"row.modelEffortFollowNamed": "Default ({effort})",
			"row.modelUnknown": "Unknown",
			"row.modelCapabilityPending": "Only capabilities advertised by WorkBuddy are shown.",
			"row.modelsTestEnabled": "Test enabled models",
			"row.modelsTesting": "Testing {done}/{total}…",
			"row.modelsTestEnabledHint": "Tests every model you have ENABLED, one request each — each probe sends a real-volume request, so this spends real credit (about 0.01 per model at the default 25000-token size). Rows show their verdict as it lands. Stops early if the credential is rejected.",
			"row.tpsSweepEnabled": "Measure speed (enabled)",
			"row.tpsSweepEnabledHint": "Measures OUTPUT SPEED for every model you have ENABLED: three runs each, taking the median. Unlike the availability probes above, this sends a tiny prompt and asks for 256 output tokens back, so it costs far less per model (measured 0.01–0.15 credit against 0.72), because this gateway prices by input. Speed matters because DSH dispatches models as parallel sub-agents, so a slow model costs wall-clock time across the whole run.",
			"row.tpsTesting": "Measuring {done}/{total}…",
			"row.tpsMeasure": "Speed",
			"row.tpsMeasuring": "Measuring…",
			"row.tpsHint": "Measure this model's output speed: three short requests, median taken. Uses about 256 output tokens per run and costs far less than an availability probe (measured 0.01–0.15 credit). The result is shown with the time it was taken, because speed changes with load and an old number is worse than none.",
			"row.tpsValue": "{tps} tok/s",
			"row.tpsValueTtft": "{tps} tok/s · first token {ttft}s",
			"row.tpsPartial": "{tps} tok/s ({samples} runs)",
			"row.tpsNoSample": "Could not time this model (too few stream chunks)",
			"row.tpsNoUsage": "Could not time this model (upstream reported no token count)",
			"row.tpsAllFailed": "Speed measurement failed",
			"row.tpsCredit": "cost {credit} credit",
			"row.tpsMeasuredAt": "measured {at}",
			"row.modelsTestDone": "Done: {available} of {total} available",
			"row.modelsTestAuth": "Stopped: the credential was rejected, so every remaining model would answer the same way. Sign in again, then re-run.",
			"row.probe": "Test",
			"row.probing": "Testing…",
			"row.probeHint": "Send a real-volume request (~25k input tokens) to this model and report whether it answers right now. The upstream rate limit fires on request SIZE — measured: about 20k tokens pass, about 30k are refused — so a small request can look fine while every long-conversation request is refused. This is why every test costs real credits (about 0.7) and runs one model at a time.",
			"row.probeOk": "✓ Usable",
			"row.probeOkMs": "✓ Usable ({ms})",
			"row.probeRateLimitedUnknown": "✗ Rate limited · the upstream gave no time for when it frees up",
			"row.probeRateLimitedAt": "✗ Rate limited · usable again after {at}",
			"row.probeModelBusyUnknown": "✗ This model is loaded right now · not your account — another account will not help; wait about a minute or switch models",
			"row.probeModelBusyAt": "✗ This model is loaded right now · not your account; retry after {at}, or switch models",
			"row.probeOutOfCreditUnknown": "✗ Not enough credits · the upstream gave no time for when it frees up",
			"row.probeOutOfCreditAt": "✗ Not enough credits · quota refreshes {at}",
			"row.probeCredentialRejected": "✗ WorkBuddy refused this account's token — sign in again or pick another account",
			"row.probePolicyRejected": "✗ WorkBuddy's server refused this request under its content policy — re-signing in won't help; try the desktop app or another region/account",
			"row.probeChannelRejected": "✗ The gateway refused the PROMPT itself, not this account — the opening of a system message matched its third-party-agent filter, so another account or region answers the same way",
			"row.probeChannelRejectedShort": "✗ Gateway refused the prompt",
			"row.probeNotFound": "✗ The upstream does not know this model",
			"row.probeUnavailable": "✗ The upstream could not be reached — no usable answer came back",
			"row.probeFailed": "✗ Test failed",
			"row.probeFailedStatus": "✗ Test failed (HTTP {status})",
			"row.probeError": "Could not run the test: {message}",
			"row.cheer": "Star on GitHub",
			"row.oauthTitle": "Add an account by QR sign-in",
			"row.oauthStart": "Sign in with QR code",
			"row.oauthStarting": "Opening…",
			"row.oauthOpenHint": "Open the sign-in page and confirm — the account is added here automatically when you finish:",
			"row.oauthOpened": "Opened. Waiting for you to finish…",
			"row.oauthWaiting": "Waiting for the sign-in to finish… ({seconds}s)",
			"row.oauthExpires": "The sign-in window expires in about {minutes} min.",
			"row.oauthCancel": "Cancel",
			"row.oauthCancelled": "Sign-in cancelled.",
			"row.oauthTimedOut": "The sign-in timed out — start again when ready.",
			"row.oauthDone": "Added “{accountName}”. Pick it above to use it.",
			"row.oauthError": "Sign-in failed: {message}",
			"row.oauthCopy": "Copy link",
			"row.oauthCopied": "Link copied",
			"row.oauthReopen": "Open page again",
			"row.oauthDialogClose": "Close",
			"row.oauthTitleGlobal": "Add an account by web sign-in",
			"row.oauthStartGlobal": "Sign in on the web",
			"row.veilHintList": "The list refreshes as soon as this finishes.",
			"row.oauthSyncing": "Adding the account…",
			"row.transferTitle": "Export / import accounts",
			"row.transferHint": "Move accounts between computers as a JSON file. The file carries the credentials — keep it private. The format is shared with other WorkBuddy credential managers.",
			"row.transferExport": "Export accounts",
			"row.transferExporting": "Exporting…",
			"row.transferExportPick": "Choose the accounts to export ({total} available):",
			"row.transferExportConfirm": "Export {count} account(s)",
			"row.transferExported": "Exported {count} account(s) to {fileName}.",
			"row.transferImport": "Import accounts",
			"row.transferImporting": "Importing…",
			"row.transferPreviewing": "Reading the file…",
			"row.transferPreviewTotal": "{total} account(s) in the file — untick what should stay out. Accounts already stored here are overwritten by the import.",
			"row.transferImportConfirm": "Import {count} account(s)",
			"row.transferImported": "Imported {imported} account(s); {skipped} skipped (no token, or belongs to the other region).",
			"row.transferEntryUnknown": "unknown account",
			"row.transferNoToken": "no token in this record",
			"row.transferCancel": "Cancel",
			"row.transferError": "Transfer failed: {message}",
			"row.transferNoService": "Could not reach the local plugin service ({size} KiB sent). The file may be too large, or the service may be restarting — try again, and if it keeps failing, trim the file and retry.",
			"row.poolTitle": "Account pool",
			"row.poolNoCandidate": "No account in this pool can be used right now.",
			"row.poolNoCandidateHint": "Members are rate-limited, out of credits, rejected, or unreachable. Rate limits, drained quotas and transient failures return to the pool on their own — at the time the upstream states, or after a 30-minute fallback. Only a rejected credential needs a new sign-in.",
			"row.poolModelWideBusy": "Every member is blocked on the same model — this is the model, not your accounts.",
			"row.poolModelWideBusyHint": "Switching accounts cannot help: the limit follows the model, so a different account hits the same wall. Wait about a minute, or switch to a less busy model in this session.",
			"row.poolCheckinAll": "Check in selected",
			"row.poolCheckingIn": "Checking in…",
			"row.poolTestAll": "Test selected",
			"row.poolTesting": "Testing…",
			"row.poolBusyHint": "Running one account at a time…",
			"row.poolTargetAuto": "Auto",
			"row.poolTargetStaleShort": "target model unavailable",
			"row.poolTargetNoneShort": "no free model",
			"row.poolTargetFree": "Auto-picked free model: {model}",
			"row.poolTargetPreferred": "Your chosen model: {model}",
			"row.poolTargetCurrentPreferred": "Current: {model} (your choice).",
			"row.poolTargetCurrentFree": "Current: {model} (auto-picked free model).",
			"row.poolTargetNone": "This region has no zero-multiplier model yet.",
			"row.poolTargetStale": "The target model you saved is no longer offered: {model}",
			"row.poolTargetStaleHint": "The region's catalog changed and no longer lists this model, so testing is off rather than running against a model the upstream may not accept. Pick another target, or switch back to automatic.",
			"row.poolTargetStaleClear": "Switch back to automatic",
			"row.poolTargetStaleOption": "{model} (no longer offered)",
			"row.poolTargetNoneHint": "The domestic catalog only reveals its multipliers after a model refresh. Rather than quietly spending credits on a paid model, testing stays off until one appears — refresh the models, or pick a target model yourself.",
			"row.poolColumnAccount": "Account",
			"row.poolColumnCredits": "Credits",
			"row.poolColumnProbe": "Status",
			"row.poolColumnCheckin": "Check-in",
			"row.poolNeverTested": "Untested",
			"row.poolTestedAt": "Tested {at}",
			"row.poolCheckedIn": "Checked in",
			"row.poolNotCheckedIn": "Not checked in",
			"row.poolCheckinUnknown": "—",
			"row.probeAccountRestricted": "Account restricted upstream",
			"row.poolCheckinEnterprise": "N/A (enterprise)",
			"row.poolBenefitClaimable": "{title}: {count} credits",
			"row.poolBenefitUrgent": "{title}: {count} credits · {days}d left",
			"row.poolBenefitDueToday": "{title}: {count} credits · last day",
			"row.poolBenefitClaim": "Claim",
			"row.poolBenefitClaiming": "Claiming…",
			"row.poolBenefitClaimAria": "Claim {title} ({count} credits) for this account",
			"row.poolLogBenefitClaimed": "{accountName} claimed {title}: {count} credits",
			"row.poolLogBenefitFailed": "{accountName} claim failed: {message}",
			"row.poolBenefitHint": "Claim it on the plans page: {url}",
			"row.poolCreditSoon": "{count} expiring within 3 days",
			"row.poolExcludedRateLimited": "Rate limited",
			"row.poolExcludedModelBusy": "Model busy",
			"row.poolExcludedOutOfCredit": "Out of credits",
			"row.poolExcludedRejected": "Rejected",
			"row.poolExcludedAccountRestricted": "Account restricted upstream",
			"row.poolExcludedUnusable": "Unusable",
			"row.poolRetryAt": "Back after {at}",
			"row.poolRetryUnknown": "The upstream gave no time for when this frees up",
			"row.remainingImminent": "any moment now",
			"row.remainingMinutes": "in about {count} min",
			"row.remainingHours": "in about {count} h",
			"row.remainingDays": "in about {count} d",
			"row.recoversImminent": "recovering any moment now",
			"row.recoversMinutes": "recovers in about {count} min",
			"row.recoversHours": "recovers in about {count} h",
			"row.recoversDays": "recovers in about {count} d",
			"row.poolProbeJustNow": "just now",
			"row.poolProbeMinutesAgo": "{count} min ago",
			"row.poolProbeHoursAgo": "{count} h ago",
			"row.poolProbeDaysAgo": "{count} d ago",
			"row.poolProbeSourceTest": "tested",
			"row.poolProbeSourceLive": "hit by a live request",
			"row.poolProbeSourceUnknown": "source unknown",
			"row.poolProbeModel": "model {model}",
			"row.poolProbeModelUnknown": "model not recorded",
			"row.poolSettingsTitle": "More settings",
			"row.poolSettingsHint": "These are preferences: they take effect when you save (same as the model list). Test results are written automatically and are not affected by this button.",
			"row.poolEnabled": "Enable the account pool",
			"row.poolEnabledHint": "On: the pool picks the account for every request, and only a failover-worthy failure moves to the next account — a malformed request, a busy model, a platform queue, or a channel-gate refusal does not (switching accounts would only burn quota for the same refusal). Off: the account you select serves every request, and a failure is reported as it is.",
			"row.poolModeAuto": "picking automatically",
			"row.poolModeManual": "you pick",
			"row.poolManualAccountLabel": "Account in use",
			"row.poolManualAccountNone": "No account in effect",
			"row.poolTargetLabel": "Test model (whole pool)",
			"row.poolTargetHint": "One model for every account here — the test measures each row with it. Auto picks a zero-multiplier model from this region's catalog, preferring the largest context window; a manual choice wins.",
			"row.poolTargetAutoOption": "Auto — pick a free model",
			"row.poolProbeSizeLabel": "Test request size",
			"row.poolProbeSizeHint": "How much text a test sends. The upstream refuses a request once it grows past roughly 20K–30K tokens, so a test smaller than your real conversations answers \"usable\" for an account that would refuse them. Bigger tests are more truthful but cost more credit each.",
			"row.poolProbeSizeDefault": "Default (25K)",
			"row.poolProbeSizeOption": "{tokens}K tokens",
			"row.poolSaved": "Save",
			"row.poolSaving": "Saving…",
			"row.poolSaveFailed": "Could not save: {message}",
			"row.poolSavedStaleRefresh": "Saved, but the panel could not re-read it. The value is stored; the next refresh will show it.",
			"row.poolDiscard": "Discard changes",
			"row.poolDirty": "● Unsaved changes",
			"row.poolAutoCheckin": "Check in automatically each day",
			"row.poolAutoCheckinHint": "On: the plugin claims the daily check-in for the accounts checked into this pool, once a day, in the background. It reads first and never re-claims an account already checked in, so a restart cannot double-claim. Off: nothing runs until you press the button. A missed day resets the streak.",
			"row.poolAutoCheckinToday": "Today: {done} of {total} checked in",
			"row.poolAutoCheckinDone": "Today: all {total} checked in",
			"row.poolAutoCheckinPending": "{count} still to retry",
			"row.poolAutoCheckinFailed": "Last attempt failed: {message}",
			"row.poolManualUnlock": "Turn off rotation",
			"row.poolLogTitle": "Activity",
			"row.poolLogClear": "Clear",
			"row.poolLogEmpty": "Nothing yet. Check-ins, tests, and account switches are recorded here.",
			"row.poolLogCheckinStart": "Checking in {count} account(s), one at a time",
			"row.poolLogCheckinClaimed": "{accountName}: checked in (+{credit})",
			"row.poolLogCheckinAlready": "{accountName}: already checked in today — skipped",
			"row.poolLogCheckinSkipped": "{accountName}: enterprise account, no daily check-in",
			"row.poolLogCheckinFailed": "{accountName}: check-in failed — {message}",
			"row.poolLogCheckinDone": "Check-in finished",
			"row.poolLogBatchFailed": "Batch failed — nothing ran: {message}",
			"row.poolLogTestStart": "Testing {count} account(s) against {model}",
			"row.poolLogTestRow": "{accountName}: {outcome}",
			"row.poolLogTestDone": "Test finished; the pool was re-ranked",
			"row.poolLogTestRowMalformed": "{accountName}: the host returned no result for this account",
			"row.poolRegionNote": "The domestic and international pools are fully independent: accounts, switches, intervals, and target models never affect each other.",
			"row.poolMembersTitle": "Accounts in this pool",
			"row.poolMembersHint": "Only checked accounts rotate, get checked in, and get tested.",
			"row.poolSelectAll": "Select all",
			"row.poolSelectNone": "Clear all",
			"row.poolSelectedCount": "{count} of {total} selected",
			"row.poolOrderRulesTitle": "How this pool chooses an account",
			"row.poolOrderRulesIntro": "The pool always picks the first account that can actually be billed right now. The rules below are checked in order — the first one that separates two accounts decides; later rules only break ties.",
			"row.poolOrderRuleUsable": "1. Can it be billed right now? Accounts that are rate-limited, out of credit, credential-rejected, or failing are moved to the back until their cooldown ends. This outranks everything, including your own order below.",
			"row.poolOrderRuleExpiring": "2. Does it have credits expiring within 3 days? Yes goes first. This also outranks your manual order — see the note below.",
			"row.poolOrderRuleManual": "3. Your manual order. The position you set with the ↑ / ↓ arrows. Accounts you never ordered are placed after every ordered one.",
			"row.poolOrderRuleNearestExpiry": "4. Which expiry comes first? Between accounts that both have credits expiring, the one losing them sooner goes first.",
			"row.poolOrderRuleExpiringAmount": "5. How many are expiring? Between those same accounts, the one with more at stake goes first. With nothing expiring this is equivalent to comparing totals.",
			"row.poolOrderRuleTotal": "6. Total credits. The account holding more goes first, so a nearly-drained account is kept in reserve.",
			"row.poolOrderRuleFreshness": "7. Freshness of the sign-in. The more recently issued credential wins a draw.",
			"row.poolOrderRuleId": "8. Account id. A final tie-break, so the same pool always produces the same order.",
			"row.poolOrderWhy": "Why expiring credits outrank your manual order: expiring credits are money about to disappear, while a manual order may be stale or set by accident. If the manual order won, one mis-drag could let credits lapse unused. So an account with credits expiring within 3 days always goes ahead of one without, even if you dragged it to the bottom.",
			"row.poolOrderBadgeNote": "The badge shows the position you SAVED, not the live ranking. An account can read \"No. 2\" while being benched for a rate limit — the number is your saved preference, and the pool skips accounts it cannot bill right now.",
			"row.poolOrderRulesToggle": "Show the full ordering rule",
			"row.poolNoneSelected": "No account is checked into this pool.",
			"row.poolNoneSelectedHint": "Check at least one account to enable check-in and test.",
			"row.poolGhostMembers": "{count} pool member(s) are no longer signed in on this machine, so they are not counted and not used: {names}. Remove any you no longer need below.",
			"row.poolGhostRemove": "Remove {account} from this pool",
			"row.poolGhostRemoveNamed": "Remove {account} from this pool. This account is no longer signed in on this machine.",
			"row.poolGhostRemoveUnnamed": "Remove {account} from this pool. No name was ever recorded for this account, so what you see is the start of its id.",
			"row.poolSelectAria": "Include {accountName} in this region's account pool",
			"row.poolCurrentBadge": "In use",
			"row.poolCurrentHeader": "In use: {account}",
			"row.poolNotMember": "Not in pool",
			"row.poolNotMemberHint": "Not in the pool: rotation skips it, and batch check-in and test leave it alone.",
			"row.poolServingOutside": "“{account}” is serving right now but is not in this pool: rotation will not pick it, and batch check-in and test will not touch it.",
			"row.poolUnsavedMembers": "Selection changed — save to apply",
			"row.poolRankLabel": "No. {rank}",
			"row.poolRankManualTitle": "You placed this account at position {rank} in the pool manually.",
			"row.poolRankAuto": "Auto",
			"row.poolRankAutoTitle": "Not manually sorted yet: the pool spends expiring credits first, then picks accounts by remaining balance. Use ↑/↓ to set your own order.",
			"row.poolMoveUpTitle": "Move account up in this pool's order",
			"row.poolMoveDownTitle": "Move account down in this pool's order",
			"row.poolMoveUpAria": "Move {accountName} up in this pool's order",
			"row.poolMoveDownAria": "Move {accountName} down in this pool's order",
			"row.poolRowTest": "Test",
			"row.poolRowRemove": "Remove",
			"row.poolRowRemoveHint": "Remove this account from the list. The WorkBuddy desktop app is not signed out — it keeps its own sign-in. Removing only hides the account here; 「Detect accounts again」 brings it back.",
			"row.poolRowRemoveAria": "Remove the stored credential of {accountName}",
			"row.poolRowRemoved": "{accountName}: hidden from the list. 「Detect accounts again」 re-adds it; the desktop app stays signed in.",
			"row.poolRowRemoving": "Removing the account…",
			"row.poolRowRemoveDesktopOnly": "{accountName}: hidden from the list — this account comes from the desktop app's own sign-in, which is left untouched. 「Detect accounts again」 re-adds it.",
			"row.deviceModeTitle": "Device identity",
			"row.deviceModeVirtual": "Virtual",
			"row.deviceModeReal": "Real",
			"row.deviceModeHintVirtual": "Every account presents a virtual device id derived from this machine. Use the gear on a row to set one by hand.",
			"row.deviceModeHintReal": "Every account presents this machine's real device, signed by the WorkBuddy desktop SDK installed here. The gear is off — one real machine cannot be given two different ids. If the SDK is unavailable, no device header is sent at all (see 「SDK」).",
			"row.deviceModeRealUnsupported": "Not available on this platform: the desktop SDK cannot hand out a device token here — on macOS it blocks on the main dispatch queue, which a background process never drains. Switching to Real would only fall back to Virtual, so the option is disabled. See the SDK section for the current reading.",
			"row.deviceGearHint": "Edit this account's device id (X-Machine-ID / X-Session-ID)",
			"row.deviceGearBlockedHint": "Only available in the Virtual tier",
			"row.deviceGearAria": "Edit device parameters for {accountName}",
			"row.deviceModeRealBlockedTitle": "Switch to Virtual first",
			"row.deviceModeRealBlocked": "In the Real tier every account shares one real device, so there is nothing per-account to set. Switch the device identity to 「Virtual」 and open the gear again.",
			"row.deviceDialogTitle": "Device parameters · {accountName}",
			"row.deviceDialogIntro": "These two values are the X-Machine-ID / X-Session-ID this account presents upstream. Leave a field empty to keep deriving it from this machine's salt — the value that will be sent is shown under the field.",
			"row.deviceMachineLabel": "Machine ID (X-Machine-ID)",
			"row.deviceSessionLabel": "Session ID (X-Session-ID)",
			"row.deviceFieldPlaceholder": "Empty = derived automatically",
			"row.deviceDerivedNow": "Derived now:",
			"row.deviceDerivedUnavailable": "No derived value to show — this machine has no device salt yet, so no X-Machine-ID / X-Session-ID is sent.",
			"row.deviceDerivedNoUid": "This account has no uid, so nothing can be derived for it — it sends no X-Machine-ID / X-Session-ID.",
			"row.deviceRandom": "Randomize",
			"row.deviceRandomHint": "Fills both with random 36-character ids",
			"row.deviceDialogP3": "Real device token",
			"row.deviceDialogP3Hint": "Signed by the Turing Shield SDK of the WorkBuddy desktop app installed here. The Real tier uses it for every account; it is not editable here — see the 「SDK」 section.",
			"row.deviceDialogCancel": "Cancel",
			"row.deviceDialogSave": "Save",
			"row.deviceDialogSaving": "Saving…",
			"row.deviceInvalid": "Needs 36 lowercase hex characters (0-9a-f)",
			"row.panelSdk": "SDK",
			"sdk.hint": "The real device token this machine signs through the installed WorkBuddy desktop SDK. Every account sends this one value in the Real tier; the Virtual tier never sends it (the token is still kept warm so this page always shows the current one).",
			"sdk.loading": "Asking the SDK…",
			"sdk.unavailable": "This Host build has no SDK route — real device parameters are not available here. The Virtual tier still works.",
			"sdk.state": "Connection",
			"sdk.statusReady": "Working",
			"sdk.statusStale": "Reachable, but the last fetch failed — serving the previous token",
			"sdk.statusNoToken": "SDK loaded, no token yet — open 「Refresh」",
			"sdk.statusMissing": "No installed WorkBuddy desktop SDK found on this machine",
			"sdk.statusUnsupported": "The SDK refused this platform",
			"sdk.statusError": "The SDK could not be loaded",
			"sdk.statusDisabled": "Turned off in settings",
			"sdk.masterLabel": "Use the real-device SDK",
			"sdk.masterHint": "On: discover the installed desktop SDK, fetch its device token in a background child process and keep it fresh every 10 minutes. Off: none of that happens — no discovery, no child process, no prewarming — so the Real tier has no token to send. The Virtual tier is unaffected (its ids come from the local salt), so turning this off is safe if you only want virtual devices. The switch takes effect immediately: turning it on starts fetching at once and turning it off stops the timer, with no plugin reload.",
			"sdk.bundle": "SDK",
			"sdk.runtime": "Runtime",
			"sdk.fetched": "Last fetched",
			"sdk.tier": "Tier in use",
			"sdk.tierReal": "Real — accounts send this token",
			"sdk.tierVirtual": "Virtual — this token is not sent",
			"sdk.valueLabel": "X-Device-Token",
			"sdk.noValue": "No token available",
			"sdk.length": "{count} chars",
			"sdk.reveal": "Show",
			"sdk.hide": "Hide",
			"sdk.copy": "Copy",
			"sdk.copied": "Copied",
			"sdk.refresh": "Fetch again",
			"sdk.refreshing": "Fetching…",
			"sdk.never": "Never",
			"sdk.unknown": "Unknown",
			"sdk.ageJustNow": "just now",
			"sdk.ageMinutes": "{count}m ago",
			"sdk.ageHours": "{count}h {rest}m ago",
			"sdk.dirLabel": "SDK directory",
			"sdk.dirPlaceholder": "Empty = find the installed desktop app automatically",
			"sdk.dirSave": "Save",
			"sdk.dirSaving": "Saving…",
			"sdk.dirSaved": "Saved.",
			"sdk.dirClear": "Clear",
			"sdk.dirHint": "Point this at the desktop app's native/turing-sdk folder, not the folder holding WorkBuddy.exe. Saving re-probes immediately; a wrong path turns the state above into \"not found\" with that path shown, never a silent fall back to discovery. WORKBUDDY_TURING_SDK_DIR still wins.",
			"sdk.fallbackLabel": "Fall back to the virtual device when no real one is available",
			"sdk.fallbackHint": "On: when the SDK is unavailable (no desktop app, wrong directory, no token) the plugin sends the salt-derived virtual device pair instead, and the tier shown changes to “Virtual” with it — it never claims to be real. Off: no device header is sent at all, which is what the Real tier did before this switch.",
			"row.modelToolsHint": "These three decide what the model may DO on this tab: which commands it can run, and whether it can spend credits generating images or video. Each takes effect on the click.",
			"row.channelRejectHint": "One switch, on its own because it is the only one here that spends a real request every time it fires. Read its description before turning it on.",
			"row.sidebarPanelLead": "Where the card itself appears. This one only affects navigation — it changes no request and spends nothing.",
			"row.upstreamHint": "These change what the gateway sees, not which provider serves the call. All of them are sampled when the plugin mounts, so reload the plugin (or restart DSH) after changing one.",
			"row.usageIdentityLabel": "Make the usage page record these calls like the official client",
			"row.usageIdentityHint": "Adds the X-IDE-* headers (which fill the 使用端 column, otherwise blank) and sends conversation ids as 32-hex UUIDv7. Display alignment only: the User-Agent and the request body never change. Off by default because the evidence comes from a reporter, not from this plugin.",
			"row.keepPromptLastLabel": "Record what you actually typed, not the injected context",
			"row.keepPromptLastHint": "Moves the harness-injected runtime context above your real prompt, so the usage page stops showing \"Time sampled…\" as your question. Message count and text are preserved. Off by default because it changes the message order the upstream counts.",
			"row.sessionTitleLabel": "Send session titles to the lightweight model",
			"row.sessionTitleHint": "The host fires one title request per new session and bills it at the main model rate. This re-points that one request at a hidden lightweight model. The request still happens either way. Off by default.",
			"row.sessionTitleModel": "Target model:",
			"row.extraPrefixesCount": "Custom injected prefixes in effect:",
			"row.channelRejectContinueLabel": "Resend 「继续」 after the gateway refuses the request",
			"row.channelRejectContinueHint": "LAST RESORT, not a fix for 11128. When the gateway answers 400 with code 11128 (「被网关的渠道校验拦截」), the turn just fails: the plugin never retries it in place and never swaps accounts, because the gate matches the message contents and every account sends the same ones. Fixed system fingerprints are byte-identical every turn, so resending only pays for the same 400 again; since 5.13.1 `prepareChatBody` rewrites known phrases instead. The narrow case this can help is content that changes between turns. It sends the text below as a NEW turn and spends a real request each time. Stops after N CONSECUTIVE sends (default 1); one successful turn, or one message you type yourself, resets the count. Subagent sessions are never touched. Off by default. Takes effect immediately, no reload.",
			"row.channelRejectContinueLimit": "Max consecutive sends:",
			"row.channelRejectContinueText": "Text sent:",
			"row.dropAllThinkingLead": "Reasoning redaction — when the gateway refuses what we send.",
			"row.dropAllThinkingLabel": "Strip past thinking from requests (for 11128)",
			"row.dropAllThinkingHint": "LAST RESORT for 「被网关的渠道校验拦截」(400 / code 11128), and not a fix. The gateway scans the text of every request, and this plugin sends the model its own earlier reasoning as `reasoning_content` whenever a thinking block carries a signature — so past reasoning is one of the things being scanned. On, ALL thinking blocks are removed from the request: your messages, the tool calls and the answers are untouched, but the model no longer sees its own earlier reasoning, and that loss is real (it is the model working memory, not decoration). Off by default. Turn it on when the openings named in a 11128 can be matched to reasoning text in that session, which is what issue #213 measured. Takes effect on the next turn, no reload.",
			"row.cliBridgeLabel": "Let the local CodeBuddy CLI do the work",
			"row.cliBridgeHint": "Adds the codebuddy_ask tool and the /codebuddy command. Each call spends CodeBuddy quota. injectResult only affects /codebuddy — its result is injected back into the session, costing one DSH turn when the session is idle; tool calls never read it. Rate-limited: 6 turns per session per hour, 20 per process per hour, one turn at a time. Off by default.",
			"row.cnBaseLabel": "CN gateway host",
			"row.cnBaseHint": "Leave empty to use copilot.tencent.com. Set it only if your network resets that host by TLS SNI (connection fails in milliseconds while the WorkBuddy desktop app still works) — the app itself falls back to wb.tencentbuddy.com. Accepted hosts: any subdomain of copilot.tencent.com, tencentbuddy.com, workbuddy.cn or codebuddy.cn, over https. Chat, billing, catalog and check-in all follow it; your account and region do not change.",
			"row.cnBasePlaceholder": "https://wb.tencentbuddy.com",
			"row.cnBaseInvalidMalformed": "That is not a full URL. Include https:// and the host, e.g. https://wb.tencentbuddy.com",
			"row.cnBaseInvalidInsecure": "Only https is accepted — a plaintext host would send your token in the clear.",
			"row.cnBaseInvalidHost": "That host is not one of the CN brands. Use a subdomain of copilot.tencent.com, tencentbuddy.com, workbuddy.cn or codebuddy.cn.",
			"row.cnBaseSaved": "CN gateway saved. New requests use it; originals/CORS headers keep naming the CN web app.",
			"row.cnBaseCleared": "Back to the built-in CN gateway.",
			"row.diagCnBase": "CN gateway",
			"row.diagCnBaseDefault": "built-in (copilot.tencent.com)",
			"row.pollIntervalLead": "Refresh frequency",
			"row.pollIntervalLabel": "Refresh the account table",
			"row.pollIntervalHint": "How often the card re-reads credits and check-in state. One refresh costs a credits read plus a check-in read per pooled account, so this is the setting that decides the plugin's upstream request volume. The composer account panel follows this value, so the two never disagree about one account. Takes effect on the next poll — no Save needed.",
			"row.pollIntervalAria": "Refresh frequency for the account table",
			"row.pollInterval1m": "Every 1 minute",
			"row.pollInterval5m": "Every 5 minutes (default)",
			"row.pollInterval10m": "Every 10 minutes",
			"row.pollInterval30m": "Every 30 minutes",
			"row.pollInterval60m": "Every 60 minutes",
			"row.sidebarPanelLabel": "Show WorkBuddy in the sidebar",
			"row.sidebarPanelHint": "Adds a WorkBuddy row to the DSH sidebar that opens this card as a full page. Off by default: the row takes a global sidebar slot shared by every installed plugin, and the Plugins page already reaches the same content. Takes effect on the click — no Save needed — and switching it off while the page is open returns you to the conversation.",
			"row.cliBridgeModelLabel": "CLI model",
			"row.cliBridgeModelDefault": "CLI default",
			"row.cliBridgeModelAria": "Model the local CodeBuddy CLI runs on",
			"row.cliBridgeModelHint": "Written to cliBridge.model and passed to the CLI as --model. \"CLI default\" leaves the model to the CLI itself. The list is the catalog this tab synced from the upstream.",
			"row.cliBridgeEffortLabel": "CLI effort",
			"row.cliBridgeEffortDefault": "CLI default",
			"row.cliBridgeEffortAria": "Reasoning effort the local CodeBuddy CLI runs on",
			"row.cliBridgeEffortHint": "Written to cliBridge.effort and passed to the CLI as --effort. \"CLI default\" leaves the tier to the CLI itself. When the picked model lists supported tiers, only those are offered.",
			"row.cliBridgeRegionOrderLabel": "Region order",
			"row.cliBridgeRegionOrderAria": "Order in which the local CodeBuddy CLI walks the credential regions",
			"row.cliBridgeRegionOrderHint": "Written to cliBridge.regionOrder: the order the CLI tries the WorkBuddy credentials in, until one logs in. The region actually used is reported per turn as credential_region. Applies from the next call.",
			"row.cliBridgeRegionOrderCnFirst": "CN first",
			"row.cliBridgeRegionOrderGlobalFirst": "Global first",
			"row.cliBridgeRegionOrderCnOnly": "CN only",
			"row.cliBridgeRegionOrderGlobalOnly": "Global only",
			"row.cliBridgePickersHint": "All three pickers write the global cliBridge block; \"CLI default\" on model and effort is an explicit empty value, not \"unset\" — the CLI then uses its own defaults; the region picker writes cliBridge.regionOrder.",
			"row.imageToolLabel": "Let the model draw images",
			"row.imageToolHint": "Adds the workbuddy_draw_image tool, which the MODEL may call on its own — about 5.71 credits per image on the CN gateway and about 0.03 on the international one, with no per-call confirmation. Ticking it here only authorizes THIS tab's region. Off everywhere means the tool is not registered at all.",
			"row.videoToolLabel": "Let the model generate videos",
			"row.videoToolHint": "Adds the workbuddy_draw_video tool, which the MODEL may call on its own — a video is an async task (submit, poll, then download) that costs WorkBuddy credits and runs tens of seconds to minutes, with no per-call confirmation. Ticking it here only authorizes THIS tab's region. Off everywhere means the tool is not registered at all.",
			"row.videoModelLabel": "Video model per mode",
			"row.videoModelHint": "Pinned separately for text-to-video and image-to-video, from THIS region's own catalog — a model id does not carry across regions. A call that names no model uses the pin; with nothing pinned the tool takes the first model of that group. A pin the catalog no longer carries quietly falls back to the first model instead of failing.",
			"row.videoModelDefault": "Default (first in the group)",
			"row.mediaModelsLabel": "Image models in this region",
			"row.mediaModelsHint": "Read from this account's product configuration. The draw tools pick their models from here: a prompt without an image uses a text-to-image model, one WITH an image uses an image-to-image model. Image rows are read-only (pass a model to the tool to change it); the VIDEO model is pinnable in the picker above.",
			"row.mediaModelsEmpty": "This region publishes no image or video model.",
			"row.mediaModelsError": "Could not read the media model list: {message}",
			"row.mediaModelsRefresh": "Re-read",
			"row.mediaModelsRefreshing": "Reading…",
			"row.mediaTagTextToImage": "text → image",
			"row.mediaTagImageToImage": "image → image",
			"row.mediaTagTextToVideo": "text → video",
			"row.mediaTagImageToVideo": "image → video",
			"row.showCreditsCn": "Show credits in the composer toolbar",
			"row.showCreditsGlobal": "Show credits in the composer toolbar",
			"row.showCreditsCnHint": "Show the domestic (WB CN) credit balance in the composer toolbar, but only while this session uses a WB CN model. Click it for per-account balances and a one-click test of the checked accounts (the test spends real credits). The readout refreshes by itself every 5 minutes; the per-account table every 60 seconds while it is open.",
			"row.creditPositionLabel": "Position",
			"row.creditPositionComposer": "composer toolbar",
			"row.creditPositionStats": "below the input box",
			"row.creditPositionAria": "Credit readout position for {region}",
			"row.creditPositionHintInline": "Where the readout sits. \"composer toolbar\" is the default — the row with the model picker.",
			"row.creditPositionDisabledHint": "Unavailable while the switch above is off: tick \"Show credits in the composer toolbar\" first.",
			"row.showCreditsHintInline": "The balance for the account currently serving this tab. Click for per-account balances; it also refreshes every 5 minutes.",
			"row.showNewModels": "Show newly seen models",
			"row.showNewModelsHint": "Adds a \"· N new models\" segment beside the credit readout, and a \"new\" mark on those rows in the model picker. \"New\" means this machine recorded the model id for the first time — it says nothing about when the upstream listed it. Off by default: on a new install the whole roster is \"new\".",
			"row.showNewModelsHintInline": "First seen by this machine, not newly listed upstream. Off by default — on a new install the whole roster counts as new.",
			"quotaNotice.fallbackHead": "The quota for this request is exhausted",
			"quotaNotice.supplement": " (some models also have a daily limit that is unrelated to your credits)",
			"row.creditPositionHint": "Where the credit readout sits. \"composer toolbar\" is the default (the row with the model picker). Choose \"below the input box\" — the row carrying the round / step / token statistics — if another plugin occupies the composer toolbar and the readout does not appear.",
			"row.showCreditsGlobalHint": "Show the international (WB AI) credit balance in the composer toolbar, but only while this session uses a WB AI model. Click it for per-account balances and a one-click test of the checked accounts (the test spends real credits). The readout refreshes by itself every 5 minutes; the per-account table every 60 seconds while it is open.",
			"composer.pointsCn": "WB CN",
			"composer.pointsGlobal": "WB AI",
			"composer.panelTitleCn": "WB CN credits",
			"composer.panelTitleGlobal": "WB AI credits",
			"composer.account": "Account",
			"composer.credits": "Credits",
			"composer.switchTo": "Switch to {account}",
			"composer.current": "In use",
			"composer.noAccounts": "No account in this region",
			"composer.signedOut": "Not signed in",
			"composer.openSettings": "Settings",
			"composer.openSettingsHint": "Open this plugin's full page (accounts, models, switches)",
			"composer.openSettingsFailed": "This host offers no route to the plugin page",
			"composer.refresh": "Refresh",
			"composer.refreshing": "Refreshing…",
			"composer.refreshHint": "Refresh every account status in this region — probes each account once, one at a time (spends a small amount of credits, takes up to a minute)",
			"composer.refreshAccountsFailed": "Could not refresh the account status",
			"composer.refreshFailed": "Could not refresh credits",
			"composer.lastRefresh": "Last refreshed",
			"composer.panelTitle": "WorkBuddy credits",
			"composer.newModels": "new models",
			"composer.newModelsRow": "Models first seen by this machine",
			"composer.newModelsTitle": "Models first seen by this machine: ",
			"composer.newModelsSep": ", ",
			"composer.newModelsNote": "\"New\" means this machine recorded the model id for the first time; it says nothing about when the upstream listed it. Only models first seen within the last 7 days are shown.",
			"sidebar.creditsCn": "WB CN credits",
			"sidebar.creditsGlobal": "WB AI credits",
			"sidebar.refresh": "Refresh",
			"sidebar.refreshing": "Refreshing…",
			"sidebar.lastRefresh": "Last refreshed {time}",
			"sidebar.refreshFailed": "Refresh failed",
			"sidebar.signedOut": "Not signed in",
			"cliLive.running": "CodeBuddy",
			"cliLive.toolCalls": "{count} tools",
			"cliLive.elapsed": "{seconds}s",
			"cliLive.starting": "starting…",
			"cliLive.finishing": "finishing…",
			"cliLive.lastTool": "last: {tool}",
			"cliLive.chars": "{count} chars",
			"cliLive.aria": "A CodeBuddy turn is running: {detail}"
		};
		const zh = {
			"nav.panel": "WorkBuddy",
			"row.iconStyleLead": "外观 —— 插件长什么样，不是它能做什么。",
			"row.iconStyleLabel": "图标样式",
			"row.iconStyleHint": "点一下立即应用到侧边栏、页头与面板。默认是本插件自己的图标；另一个皮肤跟随主题的文字颜色。选择只存在当前浏览器里。",
			"row.iconStyleClaude": "Claude 风格",
			"row.iconStyleOriginal": "默认图标",
			"row.iconStyleSaveFailed": "图标选择保存失败，请检查浏览器存储权限。",
			"nav.back": "返回会话",
			"row.title": "接入使用 WorkBuddy 积分与模型（dsh-connect-workbuddy）",
			"row.desc": "在 DSH 中使用 WorkBuddy 模型：每次刷新都按上游目录读取每个模型的积分倍率，图片输入可逐模型开关，多个账号可切换或由账号池自动换号，每日签到与剩余积分一键可查。国内版与国际版是两个独立供应商，各有自己的账号，可同时使用。",
			"row.expand": "展开",
			"row.collapse": "收起",
			"row.tabCn": "国内版",
			"row.tabGlobal": "国际版",
			"row.tabHint": "每个 tab 是一个独立供应商（workbuddy / workbuddy-global），各有自己的账号、积分与模型。两边同时生效：不同会话可各选一边，一侧的改动不影响另一侧。",
			"row.tabFreeQuotaWarn": "免费模型并非无限量：上游按单次请求体积与负载限流。",
			"row.tabSwitchHint": "取消勾选即关闭该供应商：它的模型不再出现在 DSH 模型选择器里；账号、积分与模型设置都会保留，重新勾选即恢复。",
			"row.tabSwitchAria": "是否向 DSH 提供{region}供应商",
			"row.tabOffNotice": "该供应商已关闭：它的模型不会提供给 DSH。账号、积分与模型设置均已保留——勾选上方复选框即可恢复。",
			"row.signedOutHint": "在 WorkBuddy 桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			"row.signedOutWrongRegion": "找到了你的 WorkBuddy 登录信息，但它属于另一个地区的标签页。切换到上方对应标签页即可使用——不需要重新登录。",
			"row.signedOutEncrypted": "你的 WorkBuddy 登录信息在，但其中的 token 字段是加密的，插件拿不到密钥。请安装 WorkBuddy 桌面 App，或用环境变量 WORKBUDDY_APP_EXECUTABLE 指定它的可执行文件——重新登录无法解决这个问题。",
			"row.searchedTitle": "已检查的路径",
			"row.searchedHint": "如果你的 WorkBuddy 把登录信息存在别处，可以用环境变量 WORKBUDDY_AUTH_FILE 指定。",
			"row.reasonMissing": "不存在",
			"row.reasonUnreadable": "无法读取",
			"row.reasonInvalid": "没有可用的 token",
			"row.reasonEncrypted": "已加密——需要桌面 App",
			"row.reasonWrongRegion": "属于另一个地区",
			"row.sourceDesktop": "桌面 App",
			"row.sourceDsh": "插件副本",
			"row.searchedMore": "显示另外 {count} 条「不存在」的路径",
			"row.reloginHint": "出现错误，重新登录 WorkBuddy APP 即可。",
			"row.rescanHidesKept": "已删除的账号仍是隐藏状态：插件没能更新自己的名单文件。Windows 上通常是文件被占用——请关闭可能正在占用 DSH 配置目录的杀毒/同步工具后重试。",
			"row.credentialRejectedTitle": "WorkBuddy 拒绝了这个账号的 token",
			"row.credentialRejectedIntro": "「{accountName}」的 token 已不被上游接受，所以积分与签到都用不了。重新登录只在「确实是 token 的问题」时才有用——当前实际适用的是下面这一条：",
			"row.credentialRejectedSwitch": "本机另一个账号「{accountName}」刚刚实测可用，切换到它即可恢复，不必重新登录。",
			"row.credentialRejectedSwitchAction": "切换到「{accountName}」",
			"row.credentialRejectedRelogin": "本机没有其他账号可切换。请在 WorkBuddy 桌面端重新登录。",
			"row.credentialRejectedChoose": "本机还有其他账号，但刚才都没能通过上游校验。可以在上方切换一个试试；如果都不行，请在桌面端重新登录。",
			"row.requestFailed": "请求失败",
			"row.requestFailedHint": "刷新失败——下方为上次加载的数据：{message}",
			"row.usageErrorHint": "读取账号状态失败：{message}。本地 DSH 服务可能刚重启过，正在自动重试。",
			"row.usageRetry": "重试",
			"row.poolErrUnavailable": "本版本没有可用的账号池（或其批量接口缺失）。请重启应用；若仍不行，插件可能需要重新安装。",
			"row.poolErrFailed": "批量操作在宿主侧失败：{message}",
			"row.poolErrHttp": "批量操作被拒绝（HTTP {status}）。请确认插件是最新版本后重试。",
			"row.poolErrRouteMissing": "批量操作接口没有应答（HTTP {status}，无响应体）—— 宿主进程很可能还在跑旧版插件代码，这个接口没有注册上。请完全退出 DSH 再重新打开后重试。",
			"row.poolErrNoMembers": "本池没有勾选任何账号，批量操作没有可执行对象。请至少勾选一个账号并保存。",
			"row.poolErrNoLiveMembers": "本池勾选的账号在本机都已不再登录，批量操作没有可执行对象。请在 WorkBuddy 桌面端重新登录，或保存以移除它们。",
			"row.poolErrNoFreeModel": "本区域没有可用的免费（倍率为 0）模型。请先刷新模型目录，或自己指定一个目标模型。",
			"row.poolErrNoCheckin": "本区域没有每日签到 —— 这里不提供该操作。",
			"row.poolErrStaleModel": "目标模型已不在本区域目录中。请改选一个，或切回自动。",
			"row.creditsError": "积分查询失败：{message}",
			"row.refresh": "刷新",
			"row.refreshing": "正在刷新…",
			"row.accountUnnamed": "未命名账号",
			"row.accountsHint": "选择本机检测到的登录账号；Token 不会显示，也不会保存到 DSH 设置。",
			"row.accountsRescan": "重新检测账号",
			"row.accountsScanning": "正在检测…",
			"row.accountsLoading": "正在加载账号…",
			"row.accountsWriteFailed": "账号改动未保存：{message} —— 当前 profile 的配置文件写入失败（Windows 上可能被杀毒软件或同步盘占用）。当前仍是原来保存的选择，请先关闭占用该文件的程序再重试（文件的确切路径见插件仓库的 docs/WINDOWS.md）。",
			"row.selectionLostHint": "已保存的账号在本机已不存在。",
			"row.selectionLostMessage": "该区域保存的账号已不在本机登录列表中（WorkBuddy 更换了登录或清理了备份文件）。本机其他登录仍然可用——请在上方列表中重新选择一个当前账号。重新登录桌面端 App 无法修复此问题。",
			"row.vaultUnreadableHint": "凭据保险库目录无法读取（{message}）。这通常是权限问题而不是账号丢失：已保存的账号其实还在磁盘上。请以管理员身份运行：takeown /F \"<vault 目录>\" /R /D Y && icacls \"<vault 目录>\" /reset /T，然后重启 DSH。目录路径见插件仓库 docs/WINDOWS.md 的 vault 说明。",
			"row.panelAccounts": "账号",
			"row.panelModels": "模型",
			"row.panelCapabilities": "能力",
			"row.panelCapabilitiesHint": "插件可以替你做什么。这些开关点一下立即生效 —— 开关没有保存按钮。顶上那个「CN 网关主机」是草稿，由它自己的按钮保存：一个打到一半的主机名绝不该成为生效值。",
			"row.panelDiag": "诊断",
			"row.panelAria": "卡片分区",
			"row.diagHint": "这张卡片实际读到了什么，方便贴进问题反馈。这里没有任何会改动设置的控件。",
			"row.diagRegion": "区域",
			"row.diagDomain": "上游域名",
			"row.diagAccount": "当前服务账号",
			"row.diagToken": "登录有效期至",
			"row.diagCatalog": "目录中的模型",
			"row.diagEnabled": "已启用的模型",
			"row.diagPool": "账号池",
			"row.diagPoolOn": "开启 · {count} 个账号",
			"row.diagPoolOff": "关闭",
			"row.diagFailures": "最近一次失败",
			"row.diagNoFailures": "没有报错。",
			"row.diagPromoUnreadable": "{count} 条活动时段读不懂 —— 徽标已隐藏",
			"row.cardCrashed": "配置区渲染失败。",
			"row.cardCrashedHint": "模型服务本身未受影响，对话与积分仍可用。反馈问题时请附上上面这行。",
			"row.modelsTitle": "模型",
			"row.modelsDirty": "有未保存的修改",
			"row.modelsRefresh": "从 WorkBuddy 刷新",
			"row.modelsRefreshing": "正在刷新模型…",
			"row.discard": "放弃修改",
			"row.save": "保存",
			"row.saving": "保存中…",
			"row.saveError": "保存失败：{message}",
			"row.saveContentionHint": "（该文件被占用，写入被拒——Windows 上通常是杀毒软件、OneDrive 这类同步盘，或正打开该文件的编辑器。请先关闭占用者再保存一次；你的改动仍然还在。）",
			"row.modelContext": "最大上下文 {context}",
			"row.contextBudget": "DSH 上下文预算",
			"row.modelOutput": "最大输出 {output}",
			"row.modelRate": "积分 {rate}x",
			"row.modelMultimodal": "多模态",
			"row.modelImage": "图片",
			"row.modelImageText": "图片输入：厂商文档标明该模型仅支持文本，因此刷新时不会自动勾选。只有你确认它能读图，才建议手动勾上。",
			"row.modelImageUnverified": "图片输入未核实：没有厂商资料确认该模型能读图，刷新时按「不猜」处理，不会自动勾选。如果你验证过确实可用，可以手动勾上。",
			"row.modelOff": "可关闭思考",
			"row.modelOffHint": "为这个模型提供「关闭思考」档位",
			"row.modelOffRefused": "拒绝 off",
			"row.modelOffRefusedHint": "实测在两个网关上都拒绝「关闭思考」档位（HTTP 400 / code 11133）。勾选后，所有未指定推理档位的请求（尤其是压缩摘要）都会失败，因此这里不能启用。",
			"row.modelEffortLabel": "默认推理强度",
			"row.modelEffortAria": "{model} 的默认推理强度",
			"row.modelEffortHint": "请求未指定档位时这个模型使用的推理强度——新对话、压缩摘要、会话标题都属于这类请求。这里只列出 WorkBuddy 为该模型声明的档位；「默认（x）」里的 x 就是真正会用的那一档：你选过就是你的选择，否则是 WorkBuddy 为这个模型声明的默认档，再否则是这个模型自己声明的**中档**（永远不是最弱的那一档）。",
			"row.modelEffortFollow": "默认",
			"row.modelEffortFollowNamed": "默认（{effort}）",
			"row.modelUnknown": "未知",
			"row.modelCapabilityPending": "仅展示 WorkBuddy 接口明确公布的模型能力。",
			"row.modelsTestEnabled": "测试启用模型",
			"row.modelsTesting": "测试中 {done}/{total}…",
			"row.modelsTestEnabledHint": "逐个测试你**已启用**的模型，一个模型一次请求 —— 每次探测都发真实体积的请求，真花积分（默认 25000 token 体积下约 0.01/个）。每行的结果一出来就显示。凭据被拒时提前停止。",
			"row.tpsSweepEnabled": "测速启用模型",
			"row.tpsSweepEnabledHint": "测**已启用**模型的**输出速度**：每个模型跑 3 次取中位数。和上面的可用性探测不同，它只发一个极小的提示、要求返回 256 个输出 token —— 这个网关按**输入**计价，所以单模型成本低得多（实测 0.01–0.15 积分，可用性探测是 0.72）。速度之所以重要：DSH 会把模型当子代理并行派发，慢模型拖的是整个任务的实际耗时。",
			"row.tpsTesting": "测速中 {done}/{total}…",
			"row.tpsMeasure": "测速",
			"row.tpsMeasuring": "测速中…",
			"row.tpsHint": "测量该模型的输出速度：3 次短请求取中位数。每次约 256 个输出 token，成本远低于可用性探测（实测 0.01–0.15 积分）。结果旁边会标出**测量时间** —— 速度随负载变化，一个过期的数字比没有更糟。",
			"row.tpsValue": "{tps} tok/s",
			"row.tpsValueTtft": "{tps} tok/s · 首字 {ttft}s",
			"row.tpsPartial": "{tps} tok/s（{samples} 次）",
			"row.tpsNoSample": "无法测速：流里的分块太少，算不出速率",
			"row.tpsNoUsage": "无法测速：上游没报 token 数",
			"row.tpsAllFailed": "测速失败",
			"row.tpsCredit": "花费 {credit} 积分",
			"row.tpsMeasuredAt": "{at} 测",
			"row.modelsTestDone": "完成：{total} 个里 {available} 个可用",
			"row.modelsTestAuth": "已停止：凭据被拒，剩下的模型都会得到同一个答案。请重新登录后再跑一次。",
			"row.probe": "测试",
			"row.probing": "测试中…",
			"row.probeHint": "对该模型发一条真实体积的请求（约 25k 输入 token），报告它现在能不能用。上游的限流按请求体积触发——实测约 20k 能过、约 30k 被拒——所以小请求看着正常、长对话里却可能每次都被拒。这也是为什么每次测试都会消耗真实积分（约 0.7），且一次只测一个模型。",
			"row.probeOk": "✓ 可用",
			"row.probeOkMs": "✓ 可用（{ms}）",
			"row.probeRateLimitedUnknown": "✗ 被限流 · 上游未给出何时恢复",
			"row.probeRateLimitedAt": "✗ 被限流 · {at} 之后可再用",
			"row.probeModelBusyUnknown": "✗ 该模型当前负载较高 · 不是账号被限流——换账号没用，建议等待约 1 分钟或切换模型",
			"row.probeModelBusyAt": "✗ 该模型当前负载较高 · 不是账号被限流；{at} 之后可重试，或切换模型",
			"row.probeOutOfCreditUnknown": "✗ 积分不足 · 上游未给出何时恢复",
			"row.probeOutOfCreditAt": "✗ 积分不足 · 积分包 {at} 刷新",
			"row.probeCredentialRejected": "✗ WorkBuddy 拒绝了这个账号的 token——请重新登录或换一个账号",
			"row.probePolicyRejected": "✗ WorkBuddy 服务端按内容策略拒绝了这次请求——重新登录无效；可在桌面端验证或切换区域/账号",
			"row.probeChannelRejected": "✗ 网关拦的是提示词本身，不是这个账号——某条 system 消息的开头命中了它的第三方 agent 过滤，换账号或换区域都会得到同一个答案（测试能过、聊天被拒，正是这个原因）",
			"row.probeChannelRejectedShort": "✗ 网关拦的是提示词",
			"row.probeNotFound": "✗ 上游不认识这个模型",
			"row.probeUnavailable": "✗ 连不上上游——上游没有给出可用答复",
			"row.probeFailed": "✗ 测试失败",
			"row.probeFailedStatus": "✗ 测试失败（HTTP {status}）",
			"row.probeError": "无法执行测试：{message}",
			"row.cheer": "鼓励一下",
			"row.oauthTitle": "扫码添加账号",
			"row.oauthStart": "扫码登录",
			"row.oauthStarting": "正在打开…",
			"row.oauthOpenHint": "打开登录页并完成确认——完成后账号会自动出现在这里：",
			"row.oauthOpened": "已打开，等待你完成登录…",
			"row.oauthWaiting": "正在等待登录完成…（{seconds} 秒）",
			"row.oauthExpires": "登录窗口约 {minutes} 分钟后过期。",
			"row.oauthCancel": "取消",
			"row.oauthCancelled": "已取消登录。",
			"row.oauthTimedOut": "登录超时——请重新开始。",
			"row.oauthDone": "已添加「{accountName}」。在上方选中它即可使用。",
			"row.oauthError": "登录失败：{message}",
			"row.oauthCopy": "复制链接",
			"row.oauthCopied": "已复制链接",
			"row.oauthReopen": "重新打开页面",
			"row.oauthDialogClose": "关闭",
			"row.oauthTitleGlobal": "网页登录添加账号",
			"row.oauthStartGlobal": "网页登录",
			"row.veilHintList": "完成后列表会立即刷新。",
			"row.oauthSyncing": "正在添加账号…",
			"row.transferTitle": "导出 / 导入账号",
			"row.transferHint": "用 JSON 文件在电脑之间迁移账号。文件里是账号凭据——请妥善保管。该格式与同类 WorkBuddy 凭据管理工具通用。",
			"row.transferExport": "导出账号",
			"row.transferExporting": "正在导出…",
			"row.transferExportPick": "选择要导出的账号（共 {total} 个）：",
			"row.transferExportConfirm": "导出 {count} 个账号",
			"row.transferExported": "已导出 {count} 个账号到 {fileName}。",
			"row.transferImport": "导入账号",
			"row.transferImporting": "正在导入…",
			"row.transferPreviewing": "正在读取文件…",
			"row.transferPreviewTotal": "文件中共 {total} 个账号——不需要的请取消勾选。导入会覆盖这里已存储的同名账号。",
			"row.transferImportConfirm": "导入 {count} 个账号",
			"row.transferImported": "已导入 {imported} 个账号；跳过 {skipped} 个（缺 token，或属于另一个区域）。",
			"row.transferEntryUnknown": "未知账号",
			"row.transferNoToken": "此记录没有 token",
			"row.transferCancel": "取消",
			"row.transferError": "传输失败：{message}",
			"row.transferNoService": "与本地插件服务通信失败（本次发送 {size} KiB）。可能是文件过大，或服务正在重启——请重试；若持续失败，请精简文件后再导入。",
			"row.poolTitle": "账号池",
			"row.poolNoCandidate": "账号池里目前没有可用的账号。",
			"row.poolNoCandidateHint": "成员要么在限流冷却中、要么积分耗尽、要么凭据被拒、要么上游无响应。限流、积分耗尽与瞬时故障都会自动回池——按上游给出的恢复时间，没给时间就按 30 分钟兜底，不需要你操作；只有「凭据被拒」需要重新登录。",
			"row.poolModelWideBusy": "所有成员都卡在同一个模型上 —— 这是模型的问题，不是你的账号。",
			"row.poolModelWideBusyHint": "换账号解决不了：限制跟随模型，换一个账号撞的是同一堵墙。等大约 1 分钟，或把这个会话切到负载较低的模型。",
			"row.poolCheckinAll": "签到勾选的账号",
			"row.poolCheckingIn": "签到中…",
			"row.poolTestAll": "测试勾选的账号",
			"row.poolTesting": "测试中…",
			"row.poolBusyHint": "正在逐个账号执行…",
			"row.poolTargetAuto": "自动",
			"row.poolTargetStaleShort": "目标模型已失效",
			"row.poolTargetNoneShort": "无免费模型",
			"row.poolTargetFree": "自动选中的免费模型：{model}",
			"row.poolTargetPreferred": "你指定的模型：{model}",
			"row.poolTargetCurrentPreferred": "当前：{model}（你指定）。",
			"row.poolTargetCurrentFree": "当前：{model}（自动挑选的免费模型）。",
			"row.poolTargetNone": "本区域暂时没有倍率为 0 的免费模型。",
			"row.poolTargetStale": "你保存的目标模型已不在目录中：{model}",
			"row.poolTargetStaleHint": "本区域的模型目录已变化，不再包含这个模型，因此测试被停用——而不是拿一个上游可能不接受的模型去跑。请改选一个目标模型，或切回自动。",
			"row.poolTargetStaleClear": "切回自动",
			"row.poolTargetStaleOption": "{model}（已下架）",
			"row.poolTargetNoneHint": "国内版的倍率要等模型目录刷新后才会出现。为了不让你在不知情的情况下花掉积分，插件不会自动改用收费模型——请先刷新模型目录，或自己指定一个目标模型。",
			"row.poolColumnAccount": "账号",
			"row.poolColumnCredits": "积分",
			"row.poolColumnProbe": "状态",
			"row.poolColumnCheckin": "签到",
			"row.poolNeverTested": "未测试",
			"row.poolTestedAt": "测试于 {at}",
			"row.poolCheckedIn": "已签到",
			"row.poolNotCheckedIn": "未签到",
			"row.poolCheckinUnknown": "—",
			"row.probeAccountRestricted": "账号被上游限制使用",
			"row.poolCheckinEnterprise": "不适用（企业版）",
			"row.poolBenefitClaimable": "{title}：{count} 积分",
			"row.poolBenefitUrgent": "{title}：{count} 积分 · 剩 {days} 天",
			"row.poolBenefitDueToday": "{title}：{count} 积分 · 今天截止",
			"row.poolBenefitClaim": "领取",
			"row.poolBenefitClaiming": "领取中…",
			"row.poolBenefitClaimAria": "为该账号领取{title}（{count} 积分）",
			"row.poolLogBenefitClaimed": "{accountName} 已领取{title}：{count} 积分",
			"row.poolLogBenefitFailed": "{accountName} 领取失败：{message}",
			"row.poolBenefitHint": "去套餐与积分页领取：{url}",
			"row.poolCreditSoon": "{count} 积分 3 天内过期",
			"row.poolExcludedRateLimited": "被限流",
			"row.poolExcludedModelBusy": "模型繁忙",
			"row.poolExcludedOutOfCredit": "积分耗尽",
			"row.poolExcludedRejected": "被拒绝",
			"row.poolExcludedAccountRestricted": "账号被上游限制使用",
			"row.poolExcludedUnusable": "不可用",
			"row.poolRetryAt": "{at} 之后可再用",
			"row.poolRetryUnknown": "上游未给出何时恢复",
			"row.remainingImminent": "即将恢复",
			"row.remainingMinutes": "约 {count} 分钟后",
			"row.remainingHours": "约 {count} 小时后",
			"row.remainingDays": "约 {count} 天后",
			"row.recoversImminent": "即将恢复",
			"row.recoversMinutes": "约 {count} 分钟后恢复",
			"row.recoversHours": "约 {count} 小时后恢复",
			"row.recoversDays": "约 {count} 天后恢复",
			"row.poolProbeJustNow": "刚刚",
			"row.poolProbeMinutesAgo": "{count} 分钟前",
			"row.poolProbeHoursAgo": "{count} 小时前",
			"row.poolProbeDaysAgo": "{count} 天前",
			"row.poolProbeSourceTest": "测得",
			"row.poolProbeSourceLive": "聊天撞上",
			"row.poolProbeSourceUnknown": "来源未知",
			"row.poolProbeModel": "模型 {model}",
			"row.poolProbeModelUnknown": "未记录模型",
			"row.poolSettingsTitle": "更多设置",
			"row.poolSettingsHint": "下面是偏好设置：点保存才生效（与「模型管理」一致）。测试结果由插件自动写入，不受这个保存按钮影响。",
			"row.poolEnabled": "启用账号池",
			"row.poolEnabledHint": "开启：由账号池为每次请求挑号；只有可换号的失败才换下一个——请求本身不合法、模型繁忙、平台排队、渠道校验这四类不换（换号只会为同一个拒绝白烧一次配额）。关闭：你选的账号服务每一次请求，失败如实报错。",
			"row.poolModeAuto": "自动挑号",
			"row.poolModeManual": "手动选号",
			"row.poolManualAccountLabel": "使用哪个账号",
			"row.poolManualAccountNone": "当前没有生效的账号",
			"row.poolTargetLabel": "测试用模型（全池统一）",
			"row.poolTargetHint": "全池共用这一个模型，测试就是拿它逐个去测。「自动」会从本区域目录里挑一个倍率为 0 的免费模型，多个候选取上下文窗口最大的；手动指定优先于自动。",
			"row.poolTargetAutoOption": "自动 —— 挑一个免费模型",
			"row.poolProbeSizeLabel": "测试请求体积",
			"row.poolProbeSizeHint": "测试时发送多少文本。上游在请求大约超过 2 万～3 万 token 时会开始拒绝，所以测试体积若小于你真实对话的体积，就会出现「测出可用、实际一发就被限」。体积越大测得越准，但每次测试消耗的积分也越多。",
			"row.poolProbeSizeDefault": "默认（2.5 万）",
			"row.poolProbeSizeOption": "{tokens} 万 token",
			"row.poolSaved": "保存",
			"row.poolSaving": "保存中…",
			"row.poolSaveFailed": "保存失败：{message}",
			"row.poolSavedStaleRefresh": "已保存，但面板未能重新读取。设置已写入；下次刷新后会显示。",
			"row.poolDiscard": "放弃修改",
			"row.poolDirty": "● 有未保存的修改",
			"row.poolAutoCheckin": "每天自动签到",
			"row.poolAutoCheckinHint": "开启：插件在后台为勾选进池的账号领取每日签到，一天一次。它先读状态、已签到的不重复领取，所以重启也不会多领。关闭：不点按钮就什么都不会发生。漏一天会断连签。",
			"row.poolAutoCheckinToday": "今日：已签 {done} / {total}",
			"row.poolAutoCheckinDone": "今日：{total} 个全部已签",
			"row.poolAutoCheckinPending": "待重试 {count} 个",
			"row.poolAutoCheckinFailed": "上次尝试失败：{message}",
			"row.poolManualUnlock": "关闭自动轮换",
			"row.poolLogTitle": "活动记录",
			"row.poolLogClear": "清空",
			"row.poolLogEmpty": "尚无活动。签到、测试与账号切换都会记录在这里。",
			"row.poolLogCheckinStart": "开始签到 {count} 个账号（逐个执行）",
			"row.poolLogCheckinClaimed": "{accountName}：签到成功 +{credit}",
			"row.poolLogCheckinAlready": "{accountName}：今日已签到，跳过",
			"row.poolLogCheckinSkipped": "{accountName}：企业账号无每日签到",
			"row.poolLogCheckinFailed": "{accountName}：签到失败 —— {message}",
			"row.poolLogCheckinDone": "签到完成",
			"row.poolLogBatchFailed": "批量操作失败 —— 没有执行：{message}",
			"row.poolLogTestStart": "开始测试 {count} 个账号 × {model}",
			"row.poolLogTestRow": "{accountName}：{outcome}",
			"row.poolLogTestDone": "测试完成，已重新计算候选账号",
			"row.poolLogTestRowMalformed": "{accountName}：Host 未返回该账号的结果",
			"row.poolRegionNote": "国内版与国际版是完全独立的两个账号池：账号、开关、间隔、目标模型互不影响。",
			"row.poolMembersTitle": "本池包含的账号",
			"row.poolMembersHint": "只有勾选的账号参与轮换、签到与测试。",
			"row.poolSelectAll": "全选",
			"row.poolSelectNone": "全不选",
			"row.poolSelectedCount": "已选 {count} / {total}",
			"row.poolOrderRulesTitle": "本池如何挑选账号",
			"row.poolOrderRulesIntro": "池子总是先挑「现在确实能扣费的」账号。下面这些规则按顺序逐条比较，第一条分出胜负就停止，后面的只在平局时才看。",
			"row.poolOrderRuleUsable": "1. 现在能扣费吗？被限流、积分耗尽、凭证被拒或调用失败的账号会被挪到后面，直到冷却结束。这一条优先级最高，压过下面的手动顺序。",
			"row.poolOrderRuleExpiring": "2. 有 3 天内会过期的积分吗？有就排前面。这一条同样压过手动顺序，原因见下方说明。",
			"row.poolOrderRuleManual": "3. 你排的手动顺序。就是用 ↑ / ↓ 设定的位置。没有手动排过的账号，会排在所有已排序账号之后。",
			"row.poolOrderRuleNearestExpiry": "4. 谁先过期？两个都有临期积分时，先到期的排前面。",
			"row.poolOrderRuleExpiringAmount": "5. 过期多少？同样是两个都有临期积分时，临期数额大的排前面。没有临期积分时，这一步等同于比较总积分。",
			"row.poolOrderRuleTotal": "6. 总积分。积分多的排前面，接近耗尽的号先留着备用。",
			"row.poolOrderRuleFreshness": "7. 登录凭证新旧。凭证签发更晚的赢下平局。",
			"row.poolOrderRuleId": "8. 账号 id。最终兜底，保证同样的池子每次排出来的顺序都一样。",
			"row.poolOrderWhy": "为什么临期积分压过手动顺序：临期积分是马上要过期的钱，而手动顺序可能已经过时、也可能是手滑拖错了。如果让手动顺序赢，一次误拖就足以让积分白白过期。所以有 3 天内到期积分的账号，永远排在没有的账号前面 —— 哪怕你把它拖到了最后一位。",
			"row.poolOrderBadgeNote": "徽标显示的是你「保存」的位置，不是此刻的实际排序。一个账号可能写着「第 2 位」却因为被限流而暂时不被选中 —— 那个数字代表你的偏好，池子会跳过当下无法扣费的账号。",
			"row.poolOrderRulesToggle": "查看完整排序规则",
			"row.poolNoneSelected": "还没有勾选任何账号。",
			"row.poolNoneSelectedHint": "勾选至少一个账号，才能签到与测试。",
			"row.poolGhostMembers": "有 {count} 个已选入本池的账号在本机已不再登录，因此不计入、也不会被使用：{names}。不需要的可在下方逐个移除。",
			"row.poolGhostRemove": "把 {account} 移出本池",
			"row.poolGhostRemoveNamed": "把 {account} 移出本池。该账号在本机已不再登录。",
			"row.poolGhostRemoveUnnamed": "把 {account} 移出本池。这个账号从未记录过名字，显示的是它 id 的开头几位。",
			"row.poolSelectAria": "把 {accountName} 加入本区域的账号池",
			"row.poolCurrentBadge": "当前使用",
			"row.poolCurrentHeader": "当前使用：{account}",
			"row.poolNotMember": "未入池",
			"row.poolNotMemberHint": "不在池里：不参与轮换，也不进批量签到与测试。",
			"row.poolServingOutside": "「{account}」正在使用，但不在这个池里：轮换不会挑它，批量签到与测试也不会动它。",
			"row.poolUnsavedMembers": "勾选已改动 —— 保存后生效",
			"row.poolRankLabel": "第 {rank} 位",
			"row.poolRankManualTitle": "你在本池中手动把该账号排在第 {rank} 位。",
			"row.poolRankAuto": "自动排序",
			"row.poolRankAutoTitle": "还没有手动排序：池会先花临期积分，再按余额多寡选号。用 ↑/↓ 自己指定顺序。",
			"row.poolMoveUpTitle": "在本池顺序中上移该账号",
			"row.poolMoveDownTitle": "在本池顺序中下移该账号",
			"row.poolMoveUpAria": "在本池顺序中上移 {accountName}",
			"row.poolMoveDownAria": "在本池顺序中下移 {accountName}",
			"row.poolRowTest": "测试",
			"row.poolRowRemove": "删除",
			"row.poolRowRemoveHint": "把这个账号从列表中移除。桌面 App 不会被退出登录——它保留自己的登录状态。移除只是暂时隐藏，点「重新检测账号」即可找回。",
			"row.poolRowRemoveAria": "删除 {accountName} 的已存凭据",
			"row.poolRowRemoved": "{accountName}：已从列表中隐藏。点「重新检测账号」会重新加入，桌面 App 的登录不受影响。",
			"row.poolRowRemoving": "正在删除账号…",
			"row.poolRowRemoveDesktopOnly": "{accountName}：已从列表中隐藏——这个账号来自桌面 App 自己的登录，该登录未被改动。点「重新检测账号」会重新加入。",
			"row.deviceModeTitle": "设备头",
			"row.deviceModeVirtual": "虚拟值",
			"row.deviceModeReal": "真实值",
			"row.deviceModeHintVirtual": "每个账号使用一台按本机盐派生的虚拟设备。点某行右侧的齿轮可以手工指定它的值。",
			"row.deviceModeHintReal": "所有账号共用这台机器真实的设备，由本机安装的 WorkBuddy 桌面端 SDK 签发。齿轮已关闭——一台真机不能有两个不同的 id。SDK 不可用时一个设备头都不发（见「SDK」分区）。",
			"row.deviceModeRealUnsupported": "本平台用不了：桌面端 SDK 在这里取不到设备 token——macOS 上它会阻塞在 dispatch 主队列，而后台进程永不排空那个队列。切过去也只会降级回虚拟值，所以这一档已禁用。当前读数见「SDK」分区。",
			"row.deviceGearHint": "编辑这个账号的设备标识（X-Machine-ID / X-Session-ID）",
			"row.deviceGearBlockedHint": "只在「虚拟值」档下可用",
			"row.deviceGearAria": "编辑 {accountName} 的设备参数",
			"row.deviceModeRealBlockedTitle": "请先切回「虚拟值」",
			"row.deviceModeRealBlocked": "「真实值」档下所有账号共用这台机器的真实设备，没有\"这个账号\"的参数可改。把设备头切回「虚拟值」后再点齿轮。",
			"row.deviceDialogTitle": "设备参数 · {accountName}",
			"row.deviceDialogIntro": "这两个值就是该账号发给上游的 X-Machine-ID / X-Session-ID。留空表示继续按本机盐自动派生，字段下方会显示真正会发出去的那个值。",
			"row.deviceMachineLabel": "机器 ID（X-Machine-ID）",
			"row.deviceSessionLabel": "会话 ID（X-Session-ID）",
			"row.deviceFieldPlaceholder": "留空 = 自动派生",
			"row.deviceDerivedNow": "当前派生值：",
			"row.deviceDerivedUnavailable": "没有可显示的派生值——本机还没有设备盐，因此不会发送 X-Machine-ID / X-Session-ID。",
			"row.deviceDerivedNoUid": "这个账号没有 uid，算不出派生值，因此不会发送 X-Machine-ID / X-Session-ID。",
			"row.deviceRandom": "一键随机",
			"row.deviceRandomHint": "一次给两项各填一个 36 位随机 id",
			"row.deviceDialogP3": "真实设备 Token",
			"row.deviceDialogP3Hint": "由本机安装的桌面端 Turing Shield SDK 签发。「真实值」档下所有账号用它；它不在这里编辑——见「SDK」分区。",
			"row.deviceDialogCancel": "取消",
			"row.deviceDialogSave": "保存",
			"row.deviceDialogSaving": "保存中…",
			"row.deviceInvalid": "需要 36 个十六进制字符（0-9a-f）",
			"row.panelSdk": "SDK",
			"sdk.hint": "这台机器通过本机安装的桌面端 SDK 签发的真实设备 token。「真实值」档下所有账号都发这一个值；「虚拟值」档不发送它（仍会后台预热，所以这一页随时能看到当前值）。",
			"sdk.loading": "正在询问 SDK…",
			"sdk.unavailable": "这个 Host 版本没有 SDK 路由——这里拿不到真实设备参数。「虚拟值」档不受影响。",
			"sdk.state": "连接状态",
			"sdk.statusReady": "正常",
			"sdk.statusStale": "能连上，但最近一次取数失败——仍在使用上一枚 token",
			"sdk.statusNoToken": "SDK 已加载，还没取到 token——点「重新获取」",
			"sdk.statusMissing": "未在本机找到已安装的 WorkBuddy 桌面端 SDK",
			"sdk.statusUnsupported": "SDK 拒绝了这个平台",
			"sdk.statusError": "SDK 加载失败",
			"sdk.statusDisabled": "已在设置里关闭",
			"sdk.masterLabel": "启用真实设备 SDK",
			"sdk.masterHint": "开启时：查找本机安装的桌面端 SDK、在后台子进程里取设备 token，并每 10 分钟换新一次。关闭时这些事一件都不做——不查找、不起子进程、不预热——「真实值」档因此没有 token 可发。「虚拟值」档不受影响（它的 id 由本机盐派生），只想用虚拟设备的话关掉是安全的。开关即时生效：打开后立刻开始取，关掉即停掉定时器，都不用重载插件。",
			"sdk.bundle": "SDK",
			"sdk.runtime": "运行时",
			"sdk.fetched": "最近取到",
			"sdk.tier": "当前档位",
			"sdk.tierReal": "真实值——账号发的就是它",
			"sdk.tierVirtual": "虚拟值——这枚 token 不发出去",
			"sdk.valueLabel": "X-Device-Token",
			"sdk.noValue": "还没有可用的 token",
			"sdk.length": "{count} 字符",
			"sdk.reveal": "显示",
			"sdk.hide": "隐藏",
			"sdk.copy": "复制",
			"sdk.copied": "已复制",
			"sdk.refresh": "重新获取",
			"sdk.refreshing": "获取中…",
			"sdk.never": "从未",
			"sdk.unknown": "未知",
			"sdk.ageJustNow": "刚刚",
			"sdk.ageMinutes": "{count} 分钟前",
			"sdk.ageHours": "{count} 小时 {rest} 分前",
			"sdk.dirLabel": "SDK 目录",
			"sdk.dirPlaceholder": "留空 = 自动查找本机安装的桌面端",
			"sdk.dirSave": "保存",
			"sdk.dirSaving": "保存中…",
			"sdk.dirSaved": "已保存。",
			"sdk.dirClear": "清除",
			"sdk.dirHint": "填的是桌面端里 native/turing-sdk 那一层目录，不是 WorkBuddy.exe 所在目录。保存后会立刻重新检测；填错时上面的状态会变成「未找到」并带上这个路径，不会静默回退到自动查找。环境变量 WORKBUDDY_TURING_SDK_DIR 优先级更高。",
			"sdk.fallbackLabel": "取不到真实设备时退回虚拟值",
			"sdk.fallbackHint": "开启时：SDK 不可用（没装桌面端、目录填错、token 取不到）就改发按本机盐派生的虚拟设备对，档位显示也会跟着变成「虚拟值」——不静默冒充。关闭时：一个设备头都不发，那是「真实值」档原本的行为。",
			"row.modelToolsHint": "这三项决定模型在这个 tab 上能「做」什么：能跑哪些命令，以及能不能花积分生图、生视频。点一下即生效。",
			"row.channelRejectHint": "单独一项，因为这里是唯一「每触发一次就真花一次请求」的开关。开启前请读完它的说明。",
			"row.sidebarPanelLead": "卡片本身出现在哪。这一项只管导航，不改任何请求、不花任何额度。",
			"row.upstreamHint": "这一组改的是网关看到什么，不是由哪个 provider 提供服务。四项都在插件挂载时采样，改完需重载插件或重启 DSH。",
			"row.usageIdentityLabel": "让用量页把调用记成官方客户端的样子",
			"row.usageIdentityHint": "补上 X-IDE-* 头（「使用端」那一列就不会空白），并把会话 id 改成 32 位十六进制 UUIDv7。只影响显示：User-Agent 与请求正文永不变。默认关闭——证据来自报告者，本插件未在真机复现。",
			"row.keepPromptLastLabel": "记录你真正输入的话，而不是注入的上下文",
			"row.keepPromptLastHint": "把宿主注入的运行上下文挪到真实提问前面，用量页就不会再把「Time sampled…」当成你的提问。消息条数与文本都不变。默认关闭——它会改变上游会数到的消息顺序。",
			"row.sessionTitleLabel": "会话标题请求改用轻量模型",
			"row.sessionTitleHint": "宿主每个新会话都会发一次标题请求，并按主模型费率计费；开启后这一次改投隐藏的轻量模型。请求无论开不开都会发出。默认关闭。",
			"row.sessionTitleModel": "目标模型：",
			"row.extraPrefixesCount": "生效的自定义注入前缀：",
			"row.channelRejectContinueLabel": "被网关渠道校验拦截后，自动再发一次「继续」",
			"row.channelRejectContinueHint": "最后兜底，不是 11128 的修复。上游用 400 + code 11128（「被网关的渠道校验拦截」）拒绝时，这一轮就直接失败了：插件不会在原地重试，也不会换号——网关匹配的是消息内容，每个账号发出去都一样。固定 system 指纹每一轮逐字节相同，重发只会再付一次同一个 400；5.13.1 起由 `prepareChatBody` 按句改词处理。只有被拒内容刚好随轮次变化的窄情况才可能靠新回合碰过去。它会把下面这句作为新回合发出，每次真实消耗一次请求；默认只发 1 次、默认关闭；连续计数，成功一轮或你自己发一条消息即清零。子代理会话一律不碰，改完立即生效，不必重载插件。",
			"row.channelRejectContinueLimit": "连续发送上限：",
			"row.channelRejectContinueText": "发送的文本：",
			"row.dropAllThinkingLead": "思考剥离 —— 网关拒收我们发出去的内容时。",
			"row.dropAllThinkingLabel": "把历史思考从请求里剥掉（针对 11128）",
			"row.dropAllThinkingHint": "「被网关的渠道校验拦截」（400 + code 11128）的最后兜底，不是修复。网关会扫描每一份请求的文本，而本插件会把模型过去的思考作为 reasoning_content 发出去（thinking 块带 signature 时就会），所以历史思考也是被扫的内容之一。开启后请求里的 thinking 块会被全部移除——你的消息、工具调用和回答不受影响，但模型看不到自己之前的思考，而这个代价是真的（那是它的工作记忆，不是装饰）。默认关闭。适用情形：这次 11128 报出的那几个开头，能与该会话里的 reasoning 文本逐字对上——#213 里被证实的就是这种情况。改完下一轮生效，不必重载插件。",
			"row.cliBridgeLabel": "允许调用本机 CodeBuddy CLI 干活",
			"row.cliBridgeHint": "开启后多出 codebuddy_ask 工具与 /codebuddy 指令；每次调用花 CodeBuddy 配额。injectResult 只影响 /codebuddy：其结果回注会话，会话空闲时多花一次 DSH 回合；工具调用不读它。限流：每会话每小时 6 回合、每进程每小时 20 回合、同时只跑一个回合。默认关闭。",
			"row.cnBaseLabel": "CN 网关主机",
			"row.cnBaseHint": "留空即用 copilot.tencent.com。只有当你的网络按 TLS SNI 重置这个域名时才需要填（连接在毫秒级就失败，而同一台机器上的 WorkBuddy 桌面端正常——客户端自己会退回 wb.tencentbuddy.com）。可填 copilot.tencent.com、tencentbuddy.com、workbuddy.cn、codebuddy.cn 任一域名下的子域，且必须是 https。聊天、计费、模型目录、签到都会跟着走；账号与区域不会变。",
			"row.cnBasePlaceholder": "https://wb.tencentbuddy.com",
			"row.cnBaseInvalidMalformed": "这不是一个完整 URL。请带上 https:// 与主机名，例如 https://wb.tencentbuddy.com",
			"row.cnBaseInvalidInsecure": "只接受 https——明文主机会把你的 token 裸发出去。",
			"row.cnBaseInvalidHost": "这个主机不在 CN 品牌里。请用 copilot.tencent.com、tencentbuddy.com、workbuddy.cn、codebuddy.cn 下的子域。",
			"row.cnBaseSaved": "CN 网关已保存，新请求即刻使用它；Origin/Referer 仍然自称 CN 网页端。",
			"row.cnBaseCleared": "已回到内置 CN 网关。",
			"row.diagCnBase": "CN 网关",
			"row.diagCnBaseDefault": "内置（copilot.tencent.com）",
			"row.pollIntervalLead": "刷新频率",
			"row.pollIntervalLabel": "刷新账号表",
			"row.pollIntervalHint": "卡片多久重读一次积分与签到状态。每次刷新要为池内每个账号各读一次积分和一次签到状态，所以这一项决定插件的上游请求量。输入框的账号面板跟随同一个值，两处不会对同一个账号给出不同说法。下一次轮询即生效，不用保存。",
			"row.pollIntervalAria": "账号表的刷新频率",
			"row.pollInterval1m": "每 1 分钟",
			"row.pollInterval5m": "每 5 分钟（默认）",
			"row.pollInterval10m": "每 10 分钟",
			"row.pollInterval30m": "每 30 分钟",
			"row.pollInterval60m": "每 60 分钟",
			"row.sidebarPanelLabel": "在侧边栏显示 WorkBuddy",
			"row.sidebarPanelHint": "在 DSH 侧边栏加一个 WorkBuddy 行，点开就是这张卡片的整页版。默认关闭：这一行占的是所有插件共用的全局侧边栏座位，而「插件」页本来就能看到同样的内容。点一下即生效，不用保存；页面开着时关掉它，会直接回到对话。",
			"row.cliBridgeModelLabel": "CLI 模型",
			"row.cliBridgeModelDefault": "CLI 默认",
			"row.cliBridgeModelAria": "本地 CodeBuddy CLI 运行所用的模型",
			"row.cliBridgeModelHint": "写入 cliBridge.model，CLI 以 --model 接收；\"CLI 默认\"表示沿用 CLI 自身默认。列表来自当前页签同步到的目录。",
			"row.cliBridgeEffortLabel": "CLI 档位",
			"row.cliBridgeEffortDefault": "CLI 默认",
			"row.cliBridgeEffortAria": "本地 CodeBuddy CLI 的推理档位",
			"row.cliBridgeEffortHint": "写入 cliBridge.effort，CLI 以 --effort 接收；\"CLI 默认\"表示沿用 CLI 自身默认。所选模型列出支持档位时只给出这些档位。",
			"row.cliBridgeRegionOrderLabel": "区域顺序",
			"row.cliBridgeRegionOrderAria": "本地 CodeBuddy CLI 遍历凭据区域的顺序",
			"row.cliBridgeRegionOrderHint": "写入 cliBridge.regionOrder：CLI 按此顺序尝试 WorkBuddy 凭据，直到登录成功；实际使用的区域在工具输出里以 credential_region 报告。自下次调用起生效。",
			"row.cliBridgeRegionOrderCnFirst": "国内优先",
			"row.cliBridgeRegionOrderGlobalFirst": "国际优先",
			"row.cliBridgeRegionOrderCnOnly": "仅国内",
			"row.cliBridgeRegionOrderGlobalOnly": "仅国际",
			"row.cliBridgePickersHint": "三个选择都写入全局 cliBridge 块；模型/档位的\"CLI 默认\"是显式的空值而非未设置，届时 CLI 使用自己的默认；区域选择写入 cliBridge.regionOrder。",
			"row.imageToolLabel": "允许模型自主生图",
			"row.imageToolHint": "开启后模型可以自己调用 workbuddy_draw_image 画图——国内区约 5.71、国际区约 0.03 积分/张，没有逐次确认。在这里勾选只授权当前这一区的账号。两区都关着时该工具根本不会注册。",
			"row.videoToolLabel": "允许模型自主生视频",
			"row.videoToolHint": "开启后模型可以自己调用 workbuddy_draw_video 生成短视频——视频是异步任务（提交、轮询到完成、再下载到本地），要几十秒到几分钟，没有逐次确认。在这里勾选只授权当前这一区的账号。两区都关着时该工具根本不会注册。",
			"row.videoModelLabel": "按模式指定视频模型",
			"row.videoModelHint": "文生视频与图生视频各钉一个，选项只来自当前这一区自己的目录——模型 id 不跨区。调用时不填 model 就用这里钉的；什么都没钉就用该组第一个模型。钉住的模型如果目录里已经没有了，会安静地回落到第一个，而不是让这次生成失败。",
			"row.videoModelDefault": "默认（组内第一个）",
			"row.mediaModelsLabel": "本区可用的图像模型",
			"row.mediaModelsHint": "读自当前账号的产品配置。生图工具就按这里挑模型：不填图片走「文生图」那一组，填了图片走「图生图」那一组。「图像」那几行是只读的（想换就在调用工具时指定模型）；「视频」模型可以在上面的选择器里钉住。",
			"row.mediaModelsEmpty": "这一区的产品配置里没有图像或视频模型。",
			"row.mediaModelsError": "读取媒体模型清单失败：{message}",
			"row.mediaModelsRefresh": "重新读取",
			"row.mediaModelsRefreshing": "正在读取…",
			"row.mediaTagTextToImage": "文生图",
			"row.mediaTagImageToImage": "图生图",
			"row.mediaTagTextToVideo": "文生视频",
			"row.mediaTagImageToVideo": "图生视频",
			"row.showCreditsCn": "在输入框工具栏显示积分读数",
			"row.showCreditsGlobal": "在输入框工具栏显示积分读数",
			"row.showCreditsCnHint": "在对话输入框工具栏显示国内版（WB CN）剩余积分，仅当本会话使用 WB CN 模型时出现。点击可看各账号余额并一键测试勾选的账号（测试会真实消耗积分）。读数每 5 分钟自动刷新；各账号明细在面板打开时每 60 秒刷新。",
			"row.creditPositionLabel": "显示位置",
			"row.creditPositionComposer": "输入框工具栏",
			"row.creditPositionStats": "输入框下方",
			"row.creditPositionAria": "{region} 的积分显示位置",
			"row.creditPositionHintInline": "读数显示在哪里。「输入框工具栏」是默认位置，与模型选择同一行。",
			"row.creditPositionDisabledHint": "主开关关闭时不可调整：先勾选上方「在输入框工具栏显示积分读数」。",
			"row.showCreditsHintInline": "当前为本 tab 服务的那个账号的余额。点一下能看各账号明细，另外每 5 分钟自动刷新一次。",
			"row.showNewModels": "显示新出现的模型",
			"row.showNewModelsHint": "在积分读数旁多加一段「· N 新模型」，并在模型选择器里给这些行标一个「新」。这里的「新」指**本机首次记到这个模型 id**，与上游何时上架无关。默认关闭：全新安装时整个目录都算「新」，那个数字说明不了任何事。",
			"row.showNewModelsHintInline": "指本机首次见到，不是上游新上架。默认关闭——全新安装时整个目录都算新。",
			"quotaNotice.fallbackHead": "当前请求的额度已用尽",
			"quotaNotice.supplement": "（部分模型另有每日额度，与积分无关）",
			"row.creditPositionHint": "积分显示在哪里。「输入框工具栏」是默认位置（与模型选择同一行）。如果装了别的插件后读数不显示，改成「输入框下方」—— 那是「轮次 / 步数 / token」统计所在的那一行。",
			"row.showCreditsGlobalHint": "在对话输入框工具栏显示国际版（WB AI）剩余积分，仅当本会话使用 WB AI 模型时出现。点击可看各账号余额并一键测试勾选的账号（测试会真实消耗积分）。读数每 5 分钟自动刷新；各账号明细在面板打开时每 60 秒刷新。",
			"composer.pointsCn": "WB CN",
			"composer.pointsGlobal": "WB AI",
			"composer.panelTitleCn": "WB CN 积分",
			"composer.panelTitleGlobal": "WB AI 积分",
			"composer.account": "账号",
			"composer.credits": "积分",
			"composer.switchTo": "切换到 {account}",
			"composer.current": "当前选用",
			"composer.noAccounts": "该区域暂无账号",
			"composer.signedOut": "未登录",
			"composer.openSettings": "设置",
			"composer.openSettingsHint": "打开本插件的完整页面（账号、模型、各项开关）",
			"composer.openSettingsFailed": "这台宿主没有通往插件页面的入口",
			"composer.refresh": "刷新",
			"composer.refreshing": "正在刷新…",
			"composer.refreshHint": "刷新本区所有账号的状态——逐个探测每个账号（会消耗少量积分，最长约一分钟）",
			"composer.refreshAccountsFailed": "账号状态刷新失败",
			"composer.refreshFailed": "积分刷新失败",
			"composer.lastRefresh": "最近刷新",
			"composer.panelTitle": "WorkBuddy 积分",
			"composer.newModels": "新模型",
			"composer.newModelsRow": "本机首次见到的模型",
			"composer.newModelsTitle": "本机首次见到的模型：",
			"composer.newModelsSep": "、",
			"composer.newModelsNote": "「新」指本机首次记到它，与上游何时上架无关。只列最近 7 天内首见的。",
			"sidebar.creditsCn": "WB CN 积分",
			"sidebar.creditsGlobal": "WB AI 积分",
			"sidebar.refresh": "刷新",
			"sidebar.refreshing": "刷新中…",
			"sidebar.lastRefresh": "最近刷新 {time}",
			"sidebar.refreshFailed": "刷新失败",
			"sidebar.signedOut": "未登录",
			"cliLive.running": "CodeBuddy",
			"cliLive.toolCalls": "{count} 次工具",
			"cliLive.elapsed": "{seconds} 秒",
			"cliLive.starting": "启动中…",
			"cliLive.finishing": "收尾中…",
			"cliLive.lastTool": "最近：{tool}",
			"cliLive.chars": "{count} 字",
			"cliLive.aria": "有一个 CodeBuddy 回合正在跑：{detail}"
		};
		//#endregion
		//#region src/client/settings-jump.ts
		/**
		* The route from this plugin's UI to its **Settings section** (设置 → WorkBuddy).
		*
		* ## Two routes, best first
		*
		* 1. **The settings shell's store seat** — one call, exact, no timing:
		*    `slots.entries('sidebar.settings')[0].store.create().actions.openSection(id)`.
		* 2. **Driving the chrome** — click the sidebar's settings trigger, wait for the
		*    panel, click this plugin's nav row by label.
		*
		* Route 1 is what the owner asked for ("clicking the button should open Settings
		* already on this plugin") and it is available on the shell this plugin targets;
		* route 2 stays as the fallback for a host whose shell predates the seat. Route 1
		* is strictly better where it exists: `openSection(id)` sets `activeId` AND
		* `open` in one action, so there is no retry window in which the dialog is open
		* on the wrong section, and no dependency on the nav row's localized label.
		*
		* ## Why the seat is legitimately public (verified, not assumed)
		*
		* Read from the shipped host (0.1.7-rc.1), not from a sibling README:
		*
		*     ctx.remoteAccess.whenAccess('settings/describe', () => ctx.slots.inject('sidebar.settings', () => {
		*       const shellHandle = createSettingsShellStore()
		*       const shellInstance = shellHandle.create()
		*       const shellStore = { ...shellHandle, create: () => shellInstance }
		*       …
		*       ctx.slots.register({ name: 'sidebar.settings', store: shellStore, … })
		*     }))
		*
		* and the store itself:
		*
		*     defineStore({
		*       init: () => ({ open: false, activeId: void 0 }),
		*       actions: {
		*         open:          (d) => { d.open = true },
		*         close:         (d) => { d.open = false; d.activeId = void 0 },
		*         select:        (d, id) => { d.activeId = id },
		*         openSection:   (d, id) => { d.activeId = id; d.open = true },
		*       },
		*     })
		*
		* Three things follow, and all three are load-bearing:
		*
		*  - `create: () => shellInstance` PINS the seat to the shell's one live
		*    instance. A bare handle would mint a fresh private copy per `create()`,
		*    and `openSection` on that copy would move a dialog nobody renders.
		*  - `store` is a declared registration field ("Declared store seat; instance
		*    resolution and lifecycle live with the host machinery"), and
		*    `slots.entries(key)` is a public service method — the harness's own client
		*    tests read this exact seat the same way.
		*  - **Only `openSection` answers this need.** The published contract gives a
		*    `settings.section` registrant just `close`; `settings.launcher` gets
		*    `openSettings` with no id; `openSection(id)` is otherwise handed only to
		*    `settings.onboarding` steps. Registering a fake first-run step to reach it
		*    would be far more intrusive than reading a seat the shell published.
		*
		* ## Why the probe happens per PRESS, not during `apply`
		*
		* The seat belongs to ANOTHER bundle whose apply order is not ours to assume.
		* Probing once during `apply` would capture `undefined` on a host whose sidebar
		* applied later, leaving the button dead for the whole session. `entries()`
		* answers `[]` for an undeclared slot, so a per-press probe is stateless and
		* always current — the same reason the popover button is built around `softGet`.
		*
		* ## Route 2, and why it is kept rather than deleted
		*
		* The host range this plugin declares spans shell lines that may predate the
		* seat. When the seat is absent, the old route still lands the user on this
		* plugin's page, so deleting it would trade a working fallback for nothing. It
		* is now the SECOND choice, which also means its known weakness (the nav row is
		* found by its localized label, so a language we did not ship cannot match) can
		* no longer affect a host that has the seat.
		*
		*   1. click the shell's settings trigger (`aria-haspopup="dialog"` +
		*      `aria-expanded`) — unless the panel is already open, in which case
		*      clicking it would CLOSE it and the jump would turn into a disappearing
		*      act;
		*   2. wait for the panel to mount (it renders on demand into `body`);
		*   3. find this plugin's nav row by its LABEL and click it.
		*
		* ## Why it never throws
		*
		* Every step runs from a RENDER path (a click handler in the credits popover). A
		* throw here would take out the whole readout rather than one button, so each
		* stage swallows its own failure and the whole jump degrades to a silent no-op
		* when the shell has a different shape.
		*
		* @module dsh-connect-workbuddy/client/settings-jump
		*/
		/**
		* The settings panel container.
		*
		* `data-shortcut-modal="settings"` is the shell's OWN attribute — its shortcut
		* router keys off it to decide whether the open modal is the settings one — so
		* it is far more stable than any class name, which is a CSS-module hash.
		*/
		const SETTINGS_PANEL_SELECTOR = "[data-shortcut-modal=\"settings\"]";
		/** The sidebar's settings trigger: dialog semantics plus an expanded state. */
		const TRIGGER_SELECTOR = "button[aria-haspopup=\"dialog\"][aria-expanded]";
		/** The shipped slot whose store seat is the settings shell's state handle. */
		const SETTINGS_SLOT = "sidebar.settings";
		/**
		* Budget for "panel mounted + nav row rendered".
		*
		* The panel mounts SYNCHRONOUSLY on the click, but the nav rows' labels wait for
		* a locale snapshot, so a same-frame query is often one tick too early. Five
		* attempts over ~300ms covers one layout pass while staying under the threshold
		* where a user starts to think the click did nothing.
		*/
		const RETRY_DELAYS_MS = [
			0,
			60,
			70,
			80,
			90
		];
		function defaultSchedule(run, ms) {
			try {
				window.setTimeout(run, ms);
			} catch {
				run();
			}
		}
		function buttonsIn(scope) {
			return Array.from(scope.querySelectorAll("button"));
		}
		/** Find the nav-row button whose label is this plugin's. */
		function findSectionRow(scope, label) {
			const want = label.trim();
			if (want === "") return void 0;
			return buttonsIn(scope).find((button) => (button.textContent ?? "").trim() === want);
		}
		/**
		* Open Settings on this plugin's section through the shell's store seat.
		*
		* @returns `'opened'` when the dialog is on the right section (done), `'shell'`
		*   when the dialog was opened but not preselected (route 2 can still click the
		*   row), and `undefined` when the seat is absent or unusable.
		*/
		function openThroughStoreSeat(get, sectionId) {
			let slots;
			try {
				slots = get("slots");
			} catch {
				return;
			}
			if (slots === void 0 || typeof slots.entries !== "function") return void 0;
			let seat;
			try {
				seat = slots.entries(SETTINGS_SLOT)[0]?.store;
			} catch {
				return;
			}
			if (seat === null || typeof seat !== "object") return void 0;
			const handle = seat;
			if (typeof handle.create !== "function") return void 0;
			try {
				const instance = handle.create();
				const openSection = instance?.actions?.openSection;
				if (typeof openSection === "function") {
					openSection(sectionId);
					return "opened";
				}
				const open = instance?.actions?.open;
				if (typeof open === "function") {
					open();
					return "shell";
				}
			} catch {}
		}
		/**
		* Open the settings panel and select this plugin's section.
		*
		* @returns whether any route was taken (`false` = no route could be attempted,
		*   so the shell is unrecognisable and `onGiveUp` already ran).
		*/
		function openWorkBuddySettingsSection(options) {
			const { doc = document, label } = options;
			const schedule = options.schedule ?? defaultSchedule;
			const sectionId = options.sectionId ?? "dsh-connect-workbuddy";
			if (options.get !== void 0) {
				let seatResult;
				try {
					seatResult = openThroughStoreSeat(options.get, sectionId);
				} catch {
					seatResult = void 0;
				}
				if (seatResult === "opened") return true;
			}
			try {
				if (doc.querySelector(SETTINGS_PANEL_SELECTOR) === null) {
					const collapsed = Array.from(doc.querySelectorAll(TRIGGER_SELECTOR)).find((button) => button.getAttribute("aria-expanded") !== "true");
					if (collapsed === void 0) {
						try {
							options.onGiveUp?.();
						} catch {}
						return false;
					}
					collapsed.click();
				}
				let clicked = false;
				let remaining = RETRY_DELAYS_MS.length;
				for (const delay of RETRY_DELAYS_MS) schedule(() => {
					if (clicked) return;
					remaining -= 1;
					try {
						const row = findSectionRow(doc.querySelector(SETTINGS_PANEL_SELECTOR) ?? doc, label());
						if (row !== void 0) {
							clicked = true;
							row.click();
							return;
						}
					} catch {}
					if (remaining === 0) try {
						options.onGiveUp?.();
					} catch {}
				}, delay);
				return true;
			} catch {
				return false;
			}
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Browser half: WorkBuddy credits and model management inside Plugin
		* configuration.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 浏览器插件的注册形态（`slots` / `locale` / `settingsScope` 三项注入、
		*     `LocaleNamespaceMap` 的模块增强、`settings.plugin.item` 槽位与
		*     `key` / `priority` 的 rc.7 写法、以及整个 apply 体包 try/catch
		*     以便槽位 API 变更时降级为 console.error 而不触发
		*     "Failed to load plugins" 红色横幅）来自该项目，
		*     其亦注明沿用 corrinehu/dsh-workbuddy-connect 的同一模式。
		* 改动：无实质改动，仅改为本插件的命名空间与组件名。
		*
		* NOTE: the try/catch boundary of this function is mirrored (duplicated) in
		* `tests/client-fallback.spec.ts`, because the real client entry imports
		* browser-only DSH packages that cannot load in the Node test environment.
		* That test therefore does not import this function — it replicates its
		* shape. If you change the guarded body or the `console.error` message here,
		* update the mirrored `apply()` in that spec too, or the fallback test will
		* silently diverge from this real implementation.
		*
		* @module dsh-connect-workbuddy/client
		*/
		/** Stable browser-plugin name. */
		const name = "dsh-connect-workbuddy-client";
		/**
		* Client services required by the Plugin configuration contribution.
		*
		* Deliberately only the two services that exist on BOTH host lines. The
		* settings surface differs by line — 0.1.5 provides `settingsScope`, 0.1.7
		* replaces it with `configForms` — and Cordis' dependency gate is hard: any
		* inject entry the running line does not provide keeps `apply` from ever
		* running. Probing both via `ctx.get()` (which returns undefined, never
		* throws, for an absent service) is what lets one build serve both lines.
		*/
		const inject = ["slots", "locale"];
		/** Register card copy and the WorkBuddy card under Plugin configuration. */
		/**
		* Report whether the model-picker label slot landed.
		*
		* The slot is a `single` cell declared as a CHILD of `conversation.input.model`,
		* so the host calls our inject callback only once that parent entry mounts. Two
		* failures follow, and neither is visible on the page:
		*
		*   1. `register()` threw — another claim at the same priority.
		*   2. The callback never ran — the parent never mounted. Nothing throws, the
		*      disposer list is simply one shorter, and the picker shows no badges.
		*
		* Case 2 is why this exists: it produced NO trace of any kind. The state is
		* published on `window` (so a person can inspect it without reproducing the
		* symptom) and a failure is warned about exactly once per rebind. A healthy
		* load stays silent — a warning that fires when nothing is wrong stops being
		* read.
		*
		* Exported for the test. Called from `rebindSlots` (once, before the inject
		* callback exists) and again from inside the inject callback (the only place
		* that can observe a DEFERRED refusal or a late-arriving `slotKind`). Two
		* callers, one state object: the later call always supersedes the earlier, and
		* the warning is deduplicated so one failure still produces one line.
		*
		* @param state - What the registration path recorded.
		* @param target - Where to publish; defaults to the global object.
		* @returns The published view, or `undefined` when there is no global to
		*          publish onto (server rendering, a bare test).
		*/
		/**
		* One word for the state of the model-label registration.
		*
		* The four outcomes need DIFFERENT fixes, and three of them look identical from
		* the picker (no badges):
		*
		*   not-reached       the client half never reached registration — a boot or
		*                     composition problem, nothing to do with the slot.
		*   parent-not-mounted  we asked, the host never called back: the parent entry
		*                     (`conversation.input.model`) is not mounted, so the child
		*                     cell does not exist yet.
		*   failed            `register()` threw (a same-priority claim).
		*   claimed           it landed; if badges are still missing the cause is
		*                     downstream (render or CSS), not here.
		*
		* @param state - What the registration path recorded.
		* @returns The verdict word.
		*/
		function modelLabelVerdictOf(state) {
			if (state.failure !== void 0) return "failed";
			if (state.injectRanAt !== void 0) return "claimed";
			if (state.askedAt === void 0) return "not-reached";
			return "parent-not-mounted";
		}
		function publishModelLabelState(state, target = globalThis) {
			const view = {
				verdict: modelLabelVerdictOf(state),
				injectRanAt: state.injectRanAt,
				askedAt: state.askedAt,
				rebinds: state.rebinds,
				failure: state.failure,
				claimed: state.dispose !== void 0,
				/**
				* Which shape the host's declaration allowed, and how many seats were
				* claimed for it.
				*
				* Without these two the picker has ONE symptom ("no badges") for two very
				* different situations: a `single` host where an equal-priority rival won
				* the cell, and a `keyed` host where a provider id was missed. `slotKind`
				* says which contract was in force; `seats` says what this plugin did with
				* it. `<provider count>` on a keyed host and `1` on a single host are the
				* only healthy pairs.
				*/
				slotKind: state.slotKind,
				seats: state.seats,
				at: Date.now()
			};
			try {
				target["__dshWorkBuddyModelLabel__"] = view;
			} catch {
				return;
			}
			if (state.failure !== void 0) {
				const warned = target;
				if (warned.__dshWorkBuddyModelLabelWarned__ !== state.failure) try {
					target.warn?.("[dsh-connect-workbuddy] the model-picker badges could not be registered: " + state.failure);
					warned.__dshWorkBuddyModelLabelWarned__ = state.failure;
				} catch {}
			}
			return view;
		}
		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-connect-workbuddy: settings copy");
				const t = ctx.locale.bind(namespace);
				const softGet = (name) => ctx.get(name);
				/**
				* The credits popover's header button: open 设置 → WorkBuddy.
				*
				* ALWAYS A FUNCTION, never `undefined`, and it takes no route value at
				* creation time: it reads the store seat per press and otherwise drives the
				* shell's real chrome (see `settings-jump.ts`). That matters because the
				* readout only renders the button when this is present, and the first
				* `registerAllSlots()` happens before most of `apply` has finished — a
				* route captured from `ctx.get('layout')` at that moment is `undefined` on
				* a host whose layout plugin applies later, and the renderer caches
				* `inject()` results by entry identity, so nothing would ever correct it.
				*
				* The `onGiveUp` fallback asks the plugin manager for this bundle's page,
				* so an unrecognisable shell still lands somewhere useful.
				*/
				const openSettingsSection = () => openWorkBuddySettingsSection({
					label: () => t("nav.panel"),
					get: softGet,
					onGiveUp: () => {
						const navigation = softGet("pluginNavigation");
						if (navigation !== void 0 && typeof navigation.openBundle === "function") try {
							navigation.openBundle("dsh-connect-workbuddy");
						} catch {}
					}
				});
				let settingsScope;
				const forms = softGet("configForms");
				/**
				* Register this plugin's page — and its nav glyph — in the Settings panel.
				*
				* ## Why one callback rather than two
				*
				* `settings.section` drives the nav row; `settings.section.icon` is rendered
				* by the shell as `renderSlot('settings.section.icon', …, { only: row.id })`,
				* so the glyph's cell is only meaningful while the page's id exists.
				* Registering both from the same `inject` callback makes the pairing
				* structural: the page's declaration is what makes the glyph addressable at
				* all, and Cordis disposes both with this fiber.
				*
				* ## Why there is NO capability probe
				*
				* `ctx.slots.inject(name, …)` already IS the probe. It waits for the
				* declaration and runs its callback once the slot exists; on a host that
				* never declares `settings.section` it does nothing at all — no throw, no
				* queued-forever registration. A probe built on anything else (a version
				* string, an accessor the service may not expose) turns "not supported
				* here" into "never registers anywhere", which is how a page nobody can see
				* ships with no error at all. Let the host answer.
				*
				* `WorkBuddyCard` is registered with `surface: 'settings'`: the shell owns
				* the panel chrome (title, close), so the card drops its own collapse and
				* back affordances and keeps only its content.
				*/
				const registerSettingsSection = () => {
					try {
						return ctx.slots.inject("settings.section", () => {
							const disposers = [];
							const injected = () => settingsScope === void 0 ? {
								t,
								surface: "settings"
							} : {
								t,
								settingsScope,
								surface: "settings"
							};
							disposers.push(ctx.slots.register({
								name: "settings.section",
								id: WORKBUDDY_SETTINGS_SECTION_ID,
								order: 35,
								label: () => t("nav.panel"),
								locale: namespace,
								inject: injected
							}, WorkBuddyCard));
							try {
								const iconInject = ctx.slots.inject("settings.section.icon", () => {
									const iconDisposer = ctx.slots.register({
										name: "settings.section.icon",
										id: WORKBUDDY_SETTINGS_SECTION_ID,
										locale: namespace
									}, (iconProps) => {
										const edge = typeof iconProps?.size === "number" ? iconProps.size : 16;
										return (0, react.createElement)(PluginIcon, {
											size: edge,
											className: "dsm-workbuddy-nav-icon",
											style: {
												borderRadius: "4px",
												display: "block",
												opacity: iconProps?.active === false ? .75 : 1
											}
										});
									});
									disposers.push(iconDisposer);
									return iconDisposer;
								});
								if (typeof iconInject === "function") disposers.push(iconInject);
							} catch (error) {
								console.error("[dsh-connect-workbuddy] settings nav icon failed to register (page unaffected):", error);
							}
							return () => {
								for (const dispose of disposers) try {
									dispose();
								} catch {}
							};
						});
					} catch (error) {
						console.error("[dsh-connect-workbuddy] settings section failed to register (host provider unaffected):", error);
						return;
					}
				};
				/**
				* Credit readout in the composer row (`conversation.input.right`, a
				* session-scope list slot rendered immediately before the model picker).
				*
				* `input.right` rather than `input.left` (ported from dsh-connect-trae's
				* issue #71): the host renders `input.right` inside `div.trailing`'s
				* `standardControls`, i.e. IMMEDIATELY BEFORE the model picker, while
				* `input.left` sits at the very end of `div.tools` — 8px from the
				* permission selector. Both are clickable, so reaching for "完全权限"
				* landed on the readout and opened the credit popover. A readout is not an
				* action; next to the model picker it stops competing with a control the
				* user is actually aiming at. The `composer` SETTING value keeps its
				* meaning ("the row that carries the model picker"), so saved profiles
				* need no migration.
				*
				* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
				*   — 该项目的 `registerComposerPoints`：无条件注册插槽、由 gate 读
				*     `modelSelection` 投影自行决定是否渲染。本项目原先放在侧边栏底部
				*     （`sidebar.footer.action`），那里是**单个 root 级共享行**，两个连接器
				*     插件各占一行会互相挤压；输入框这行是 per-session 且按 provider 归属，
				*     天然只有一个插件的积分相关。
				*
				* Provider-scoped on purpose: it renders only while the session's selected
				* model belongs to this plugin, which is what keeps two connector plugins
				* from competing for one shared row. Registration is unconditional; the
				* gate reads the Host's `modelSelection` projection and returns null for
				* every other provider, so nothing is drawn and no fetch loop starts while
				* another provider is selected.
				*/
				const registerComposerCredits = () => {
					try {
						return ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
							name: "conversation.input.right",
							id: "dsh-connect-workbuddy-composer-credits",
							order: 4,
							locale: namespace,
							inject: () => ({
								t,
								position: "composer",
								...settingsScope === void 0 ? {} : { settingsScope },
								onOpenSettings: openSettingsSection
							})
						}, ComposerCreditsGate));
					} catch (error) {
						console.error("[dsh-connect-workbuddy] composer credits slot failed to register (host provider unaffected):", error);
						return;
					}
				};
				/**
				* The load badge in the HOST's model picker.
				*
				* The picker renders the model name as a plain string, so a provider can
				* only put a CHARACTER there — and a character's colour is the emoji font's
				* business, not ours. The host therefore offers exactly one seam for this:
				* the `conversation.input.model.label` slot, whose contract is "render
				* non-interactive inline content such as a coloured name or badge" while
				* the picker keeps owning clicks, focus and check marks. The shipped
				* example is the official DeepSeek "1017" release badge, which is the same
				* job — a coloured marker beside a model name.
				*
				* WHY A NEGATIVE PRIORITY (host 0.2.1-rc.2 and later). This is a `single`
				* slot: it holds ONE cell, and `SlotCore.register()` THROWS when a second
				* registration claims the same priority — "single slot … already has a
				* registration at priority 0 — register at a different priority to shadow
				* it (lowest renders)". The host itself now ships a contributor here
				* (`@deepseek-ai/dsh-client-ui-deepseek-model-label-1017`, in the web-app
				* bundle from rc.2 on) that registers at the default 0, so registering at
				* 0 makes the two race: whichever lands second throws. Measured on
				* 0.2.1-rc.3 that is US — the app's own crash log records, verbatim,
				* "single slot \"conversation.input.model.label\" already has a
				* registration at priority 0 (registered by Kb)" plus this entry's
				* catch-all line "model label slot failed to register" twice per page
				* load, which is the badge silently disappearing from the picker.
				*
				* See `MODEL_LABEL_PRIORITY` in `./WorkBuddyModelLabel.tsx` for the full
				* ordering, the measured evidence, and the deliberate absence of any
				* inter-plugin coordination (project invariant, `docs/DESIGN.md` §零).
				*
				* HOW MANY SEATS, AND WHY THAT IS READ AT MOUNT. `single` holds one cell, so
				* exactly one registration is legal there. A `keyed` host gives each
				* `options.key` its own cell, and one cell per provider id is what this
				* plugin actually wants: it then draws its OWN rows and nothing else, qoder
				* and trae stop sharing a cell with it, and a provider with no contribution
				* falls through to the host's own fallback. Which of the two shapes is
				* legal is the HOST's declaration, not this plugin's choice, so the kind is
				* read from `ctx.slots.spec(...)` at mount and the seat list is derived from
				* it (`./model-label-seat.ts`). One build therefore serves both lines — and
				* a host that cannot be inspected gets the single seat, which is what every
				* released version of this plugin already does.
				*
				* THE COST IS PAID ON ANOTHER PLUGIN'S ROWS, and it is worth stating where
				* the registration happens: holding this cell means the host's own
				* `dsh-client-ui-deepseek-model-label-1017` badge is NOT rendered on the
				* DeepSeek rows it was written for. That is not a defect and not something
				* to fix by inspecting the slot ledger — it is the price of §零, recorded in
				* `docs/DESIGN.md` and argued in the 5.8.2 CHANGELOG. Issue #138 is a user
				* meeting that price for the first time; the disposition is to state it
				* plainly rather than to coordinate at runtime. On a `keyed` host that price
				* is not paid at all: each provider keeps its own cell, so 1017's badge
				* returns to the DeepSeek rows without anyone negotiating.
				*/
				/**
				* WHY THIS RECORDS AN OUTCOME, not just a disposer.
				*
				* Claiming the cell can fail in two DIFFERENT ways and both are silent:
				*
				*  1. `register()` throws — a `single` slot with another claim at the same
				*     priority. The catch logs, the page looks fine, the badges are gone.
				*  2. `inject()` never runs — the slot is declared as a child of
				*     `conversation.input.model`, so the host only calls back once THAT
				*     entry mounts. If it never mounts (a session-less surface, an older
				*     host, a renamed parent), nothing throws at all: the callback simply
				*     does not happen and the disposer list stays one shorter.
				*
				* Case 2 left no trace of any kind, which is why this plugin could look
				* healthy while the picker showed no badges. Recording the timestamp of the
				* callback and the reason for a failure turns "did it land?" from a guess
				* into a fact the diagnostics row can print.
				*/
				const modelLabelState = {};
				/** The verdict for the console line (see `modelLabelVerdictOf`). */
				const modelLabelVerdict = () => modelLabelVerdictOf(modelLabelState);
				const registerModelLabel = () => {
					modelLabelState.askedAt = Date.now();
					/**
					* The refusal path, shared by the eager and the deferred call.
					*
					* REPUBLISHES, and that is not cosmetic. `rebindSlots` publishes once, and
					* on the normal boot it publishes BEFORE this callback exists: `inject()`
					* defers the callback until `conversation.input.model` mounts, so the
					* published view is a snapshot of a registration that has not happened
					* yet. Without this line the failure lands in a state object that nothing
					* reads again, and `window.__dshWorkBuddyModelLabel__` keeps
					* `failure: undefined` with verdict `parent-not-mounted` — the exact
					* opposite of the truth, in the surface built to state it.
					*/
					const refuse = (error) => {
						const message = error instanceof Error ? error.message : String(error);
						modelLabelState.failure = message;
						console.error("[dsh-connect-workbuddy] model label slot failed to register (host provider unaffected):", error);
						publishModelLabelState(modelLabelState);
					};
					try {
						return ctx.slots.inject("conversation.input.model.label", () => {
							modelLabelState.injectRanAt = Date.now();
							const kind = declaredSlotKind(ctx.slots, "conversation.input.model.label");
							const seats = modelLabelSeats({
								name: "conversation.input.model.label",
								kind,
								providerIds: WORKBUDDY_PROVIDER_IDS,
								priority: MODEL_LABEL_PRIORITY
							});
							const registry = ctx.slots;
							try {
								const dispose = registerModelLabelSeats(seats, (seat) => registry.register(seat, WorkBuddyModelLabel));
								modelLabelState.slotKind = kind ?? "unknown";
								modelLabelState.seats = seats.length;
								publishModelLabelState(modelLabelState);
								return dispose;
							} catch (error) {
								refuse(error);
								return () => {};
							}
						});
					} catch (error) {
						return refuse(error);
					}
				};
				/**
				* The sidebar glyph for the WorkBuddy panel row.
				*
				* The sidebar renders `sidebar.panellist` registrants with `{ size, active }`
				* inside a `currentColor`-themed glyph cell, so the brand mark is drawn as a
				* small `<img>` — the PNG's own colours read as the plugin's identity, and
				* the row's selection state is the host's to paint around it.
				*/
				function WorkBuddyPanelIcon(props) {
					const edge = typeof props.size === "number" && props.size > 0 ? props.size : 16;
					return (0, react.createElement)(PluginIcon, {
						className: "dsm-workbuddy-panel-icon",
						size: edge
					});
				}
				/**
				* The WorkBuddy panel in the sidebar (`sidebar.panellist` row + `main` keyed
				* page), mirroring how the host's own Plugins row and dsh-skill-mcp-panel
				* put a full page in the centre column.
				*
				* OPT-IN (`Config.sidebarPanel`, default false). Registering it is NOT the
				* same as showing it: `ui-sidebar` builds the nav row from the slot's ENTRY
				* METADATA (`usePanels` → `PanelRow` with `options.label` and
				* `renderSlot(...)` as the glyph), so a component returning `null` leaves a
				* blank but still-clickable button rather than no button. The row therefore
				* has to be registered only while the switch is on, which is what
				* {@link syncPanelRegistration} owns. See `panel-switch.ts` for the store
				* that decision rides on.
				*
				* Back navigation reuses the host's layout service: `selectPanel(null)`
				* hands the main area back to the conversation. It is soft-probed, so a
				* host that never declares `layout` simply renders the page without the back
				* affordance instead of blocking the whole plugin (the same degradation the
				* card already promises for a missing settings form).
				*/
				/**
				* The `main` key this plugin's full page is registered under.
				*
				* Also the id the composer readout asks `layout.selectPanel` for, so the two
				* cannot drift: a rename here that missed `openFullPage` below would leave a
				* button that throws "main panel is not registered".
				*/
				const PANEL_ID = "dsh-connect-workbuddy";
				/** Hand the centre column back to the conversation. */
				const backToConversation = () => {
					const layout = softGet("layout");
					if (layout !== void 0 && typeof layout.selectPanel === "function") layout.selectPanel(null);
				};
				/**
				* The full page: a `main` panel keyed by {@link PANEL_ID}.
				*
				* Registered ALWAYS, independently of the sidebar row. They used to share one
				* lifetime, which made the page reachable only while the optional nav row was
				* switched on — and the nav row is a global seat, off by default, that most
				* users never turn on. The page is what the composer readout's button opens,
				* so tying the two together meant that button could not exist.
				*/
				const registerMainPage = () => {
					try {
						return ctx.slots.inject("main", () => ctx.slots.register({
							name: "main",
							key: PANEL_ID,
							locale: namespace,
							inject: () => settingsScope === void 0 ? {
								t,
								surface: "page",
								backToConversation
							} : {
								t,
								settingsScope,
								surface: "page",
								backToConversation
							}
						}, WorkBuddyCard));
					} catch (error) {
						console.error("[dsh-connect-workbuddy] full page failed to register (host provider unaffected):", error);
						return;
					}
				};
				/**
				* The OPTIONAL sidebar nav row that points at {@link registerMainPage}'s page.
				*
				* Separate from the page for the reason above: `sidebar.panellist` builds its
				* rows from ENTRY METADATA (`usePanels`), so this is the only half that has to
				* come and go with the switch. Registering the row is what makes the page
				* reachable from the sidebar; the page itself exists either way.
				*/
				const registerPanelRow = () => {
					const disposers = [];
					try {
						disposers.push(ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
							name: "sidebar.panellist",
							id: PANEL_ID,
							order: 2,
							label: () => t("nav.panel"),
							locale: namespace
						}, WorkBuddyPanelIcon)));
					} catch (error) {
						console.error("[dsh-connect-workbuddy] sidebar panel row failed to register (host provider unaffected):", error);
					}
					return disposers;
				};
				/**
				* The live panel registrations, kept SEPARATE from {@link liveDisposers}.
				*
				* They are the only slots in this plugin that come and go while the page is
				* open (the opt-in switch), so owning them apart from the rest means
				* flipping the switch does not dispose and re-create the card, the composer
				* readout and the five other seats — which would be a visible flicker on the
				* Plugins page for a change that has nothing to do with it.
				*/
				let panelDisposers = [];
				/**
				* Bring the panel registrations in line with the opt-in switch.
				*
				* Dispose FIRST, then register, for the reason spelled out on
				* {@link rebindSlots}: a live `key` / `id` cannot be registered twice, and
				* the throw would be swallowed into "no entry at all".
				*
				* Re-registering (rather than only unregistering) is what keeps the entry
				* fresh after a settings-scope rebind: the renderer caches each entry's
				* `inject` result by object identity, so an entry created before the scope
				* landed would keep serving props without it forever.
				*/
				const syncPanelRegistration = () => {
					for (const dispose of panelDisposers) try {
						dispose();
					} catch {}
					panelDisposers = [];
					if (!sidebarPanelWanted()) return;
					panelDisposers = registerPanelRow();
				};
				/**
				* The SAME readout in the ambient dock below the composer card (issue #62).
				*
				* Registered unconditionally, like the composer seat, because the CHOICE
				* between the two seats lives in the gate: it renders in the seat the
				* setting names and returns null in the other. Registering only the chosen
				* seat would mean re-registering on every settings change, and the seat is
				* exactly the kind of thing a user flips once while looking at the result.
				*
				* WHY THIS SEAT EXISTS: the composer tool row is a list seat shared with any
				* other plugin that registers there, and issue #62 is one report of the
				* readout disappearing when another plugin was installed. This row is where
				* the shell renders its own round/step/token pills, so it is a place a user
				* already reads session numbers from.
				*
				* `order` places it after the shell's own pills (`stats` registers at 0), so
				* the shipped statistics stay leftmost and the readout reads as an addition
				* rather than a replacement.
				*/
				const registerStatsCredits = () => {
					try {
						return ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
							name: "conversation.composer.dock",
							id: "dsh-connect-workbuddy-stats-credits",
							order: 10,
							locale: namespace,
							inject: () => ({
								t,
								position: "stats",
								...settingsScope === void 0 ? {} : { settingsScope },
								onOpenSettings: openSettingsSection
							})
						}, ComposerCreditsGate));
					} catch (error) {
						console.error("[dsh-connect-workbuddy] stats credits slot failed to register (host provider unaffected):", error);
						return;
					}
				};
				/**
				* The live CodeBuddy turn pill, in the same ambient dock as the readout.
				*
				* `order` 11 puts it immediately after the credit readout (10) and still
				* right of the shell's own pills (0): the two numbers a user glances at while
				* a turn runs sit together. The component renders `null` whenever no turn is
				* live, which is the normal case — the bridge is off by default — so an
				* unused seat costs one poll interval and nothing on screen.
				*
				* THE SESSION ID IS THE PILL'S DISPLAY CONDITION. `conversation.composer.dock`
				* is declared `scope: 'session'`, so the registration's `inject` receives the
				* session id and the pill can keep only the rows that session started. The
				* board itself is host-wide (one route for every session in the process), so
				* without this the pill would describe whatever turn is newest anywhere —
				* including one from another tab, about a directory the reader is not in.
				* Unlike the credit readout there is deliberately no provider gate: the CLI
				* route is model-independent, and a turn started from a DeepSeek session is
				* exactly a case the readout has to cover.
				*/
				const registerCliLive = () => {
					try {
						return ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
							name: "conversation.composer.dock",
							id: "dsh-connect-workbuddy-cli-live",
							order: 11,
							locale: namespace,
							inject: (sessionId) => ({
								t,
								sessionId
							})
						}, CodebuddyLive));
					} catch (error) {
						console.error("[dsh-connect-workbuddy] cli live slot failed to register (host provider unaffected):", error);
						return;
					}
				};
				/**
				* The frame-wide quota notice, DECLINED so the host keeps its own Toast
				* (issue #63 follow-up, the maintainer's call on a screenshot).
				*
				* WHAT WAS WRONG. The previous build claimed `QUOTA` and rendered the
				* supplement as an inline `<span>` in this seat. The chain's own contract
				* says a claiming entry "takes over the surface" — so claiming REPLACED the
				* host's generic warning Toast, and the replacement was not a Toast: an
				* inline span has no `position: fixed`, no centring, no background and no
				* fade, so it parked at the TOP-LEFT of `shell.overlay` (an `inset: 0`
				* layer) and stayed there until the next notice. The maintainer read it, on
				* screen, as a box that had not been there before — and it had not.
				*
				* WHY DECLINING IS THE FIX, not a worse one. The host's own sentence is
				* already correct and already appears in the turn's failure row inside the
				* conversation (`message.failure.quota`, via `failureMessage` in
				* `ui-chat`'s MessageItem) — the place the user is actually reading when a
				* turn fails. Taking over the frame-wide surface bought this plugin nothing
				* except a second, uglier copy of a sentence the host already draws where it
				* matters. Declining the claim returns the seat to the host: the Toast is
				* the host's own design, and this plugin stops imposing a look on a surface
				* it does not own.
				*
				* The supplement itself is NOT lost — it rides in the conversation, which is
				* the only surface that is actually in the user's eyeline (see
				* `registerStatsCredits` and the failure row). The `select` below is
				* therefore an explicit, documented DECLINE of every code rather than a
				* deletion of the registration: the seat stays claimed in one place with its
				* rationale attached, so a future reader does not re-add the takeover
				* without re-reading why it was removed.
				*/
				const registerQuotaNotice = () => {
					try {
						return ctx.slots.inject("shell.quota-notice", () => ctx.slots.register({
							name: "shell.quota-notice",
							locale: namespace,
							select: selectQuotaNoticeClaim,
							inject: () => ({ t })
						}, WorkBuddyQuotaNotice));
					} catch (error) {
						console.error("[dsh-connect-workbuddy] quota notice slot failed to register (host provider unaffected):", error);
						return;
					}
				};
				/**
				* Every slot this plugin contributes, and how to (re)create them.
				*
				* Kept as one list because the binding of `settingsScope` and the slot
				* registrations must move TOGETHER: see {@link bindSettingsScope} for why a
				* late-arriving namespace has to produce fresh registrations rather than a
				* mutated closure.
				*
				* The configuration page is `settings.section` — ONE registration under an
				* id this plugin owns, so there is no inventory name to match and no
				* spelling to get wrong (see {@link WORKBUDDY_SETTINGS_SECTION_ID}). The
				* former `plugins.bundle.config` / `plugins.row.config` pair is GONE with
				* 5.19.0: the same configuration must not have two editing entries.
				*/
				const registerAllSlots = () => [
					registerSettingsSection(),
					registerComposerCredits(),
					registerStatsCredits(),
					registerCliLive(),
					registerQuotaNotice(),
					(() => {
						const dispose = registerModelLabel();
						modelLabelState.dispose = dispose;
						return dispose;
					})(),
					registerMainPage()
				].filter((disposer) => disposer !== void 0);
				/**
				* Disposers of the slots registered for the CURRENT binding.
				*
				* Declared before {@link bindSettingsScope} because that function closes
				* over it and reassigns it; the binding is only armed at the end of `apply`,
				* so this is initialised by then either way — hoisting it keeps that
				* ordering a non-requirement rather than a trap.
				*/
				let liveDisposers = [];
				/**
				* Replace the live registrations with a fresh set.
				*
				* ORDER MATTERS: dispose FIRST, then register.
				*
				* The ledger is a KEYED slot with one entry per `key` per priority, so
				* registering a key that is still live THROWS (`already has an entry for
				* key …`). Every registration in this entry is isolated by its own
				* try/catch, so the failure is not visible — the throw is logged and the
				* key is simply left with NO entry, because the old one was just disposed
				* by the `previous` loop. Registering before disposing therefore produces
				* an EMPTY ledger, which is a worse version of the very defect this
				* function exists to prevent.
				*/
				const rebindSlots = () => {
					for (const dispose of liveDisposers) try {
						dispose();
					} catch {}
					liveDisposers = [];
					modelLabelState.rebinds = (modelLabelState.rebinds ?? 0) + 1;
					liveDisposers = registerAllSlots();
					publishModelLabelState(modelLabelState);
					try {
						console.info(`[dsh-connect-workbuddy] registered ${String(liveDisposers.length)} slots (settings form: ${settingsScope === void 0 ? "none — page is read-only" : "bound"}, sidebar panel: ${sidebarPanelWanted() ? "on" : "off"}, model label: ${modelLabelVerdict()}${modelLabelState.failure === void 0 ? "" : ` (${modelLabelState.failure})`})`);
					} catch {}
					syncPanelRegistration();
				};
				/**
				* Bind `settingsScope` to whichever namespace the Host really serves, and
				* RE-REGISTER every slot when that answer changes.
				*
				* Why this is not a one-shot read at startup — the shipped 4.3.0 defect
				* (issue #46): the mirror is filled by an async `remote.settings.describe()`,
				* so at `apply` time `view` is usually still absent. The old code read that
				* absence as "the declared name must be right", bound
				* `forms.get('workbuddy')`, and never looked again. `ConfigFormController.
				* derive()` matches the namespace EXACTLY, so the guessed form stayed
				* `unavailable` forever; the composer gate — reading only that scope —
				* judged the opt-out switch `undefined !== false` and kept rendering the
				* readout. Unticking the box wrote `false` correctly and changed nothing on
				* screen.
				*
				* `whileServed` is the Host's own idiom for this (`mirror.subscribe` plus an
				* immediate sync). It is strictly better than re-reading the snapshot by
				* hand because it ALSO withdraws the binding if the Host stops serving our
				* namespace, and it hands `register` the set of namespaces actually served
				* — so the choice is made from live data instead of a captured guess.
				*
				* `register` runs on the unserved→served EDGE, not on every mirror update
				* (see the service's `sync`), so the disposal below is not a churn loop: it
				* clears whatever a previous edge left registered. That replacement is NOT
				* optional, because the renderer caches each entry's inject result by object
				* identity (`rootInjectCache` / `cachedRootInject` in
				* `dsh-client-ui-renderer`: `if (!props) { props = runInject(...) }`), so an
				* entry registered before the mirror landed is never re-evaluated. Late
				* binding can therefore only work if the OLD registrations are disposed and
				* NEW ones created — which is what this callback does.
				*/
				const bindSettingsScope = () => {
					if (forms === void 0 || typeof forms.whileServed !== "function") {
						settingsScope = forms?.get(WORKBUDDY_SETTINGS_NS);
						liveDisposers = registerAllSlots();
						syncPanelRegistration();
						return;
					}
					ctx.effect(() => forms.whileServed(WORKBUDDY_SETTINGS_NAMESPACE_CANDIDATES, (served) => {
						const ns = WORKBUDDY_SETTINGS_NAMESPACE_CANDIDATES.find((candidate) => served.has(candidate)) ?? [...served].find((entry) => /workbuddy/i.test(entry));
						settingsScope = ns === void 0 ? void 0 : forms.get(ns);
						rebindSlots();
						return () => {
							for (const dispose of liveDisposers) try {
								dispose();
							} catch {}
							liveDisposers = [];
							for (const dispose of panelDisposers) try {
								dispose();
							} catch {}
							panelDisposers = [];
						};
					}), "dsh-connect-workbuddy: settings namespace binding");
					rebindSlots();
				};
				bindSettingsScope();
				/**
				* Follow the opt-in switch, and SEED it from the Host.
				*
				* The seed is a status read rather than the settings scope on purpose. This
				* namespace's browser mirror is documented as stale on the affected 0.1.7
				* deployments, and here a stale `false` would mean the row never appears —
				* with no later event to correct it, because `whileServed` only fires on a
				* namespace edge, not on a value change. The Host's own answer is the
				* authority (`sidebarPanelEnabled` on the usage document), exactly as it is
				* for the other Host-carried switches.
				*
				* A failed read is NOT an error to show: OFF is a legitimate and, in fact,
				* the default answer, so a plugin whose status route is unreachable simply
				* gets no row. There is nothing the user could do about it from here.
				*
				* The SUBSCRIPTION is what makes the switch live: the card calls
				* `setSidebarPanelWanted` after a verified write, so the row appears and
				* disappears without a reload. `ui-layout` drops an `activePanelId` whose
				* `main` key has gone, so switching off while the page is open returns the
				* centre column to the conversation on its own.
				*/
				ctx.effect(() => subscribeSidebarPanelWanted(syncPanelRegistration), "dsh-connect-workbuddy: sidebar panel opt-in");
				(async () => {
					try {
						const response = await fetch(withWorkBuddyRegion(WORKBUDDY_USAGE_PATH, "cn"), { headers: { accept: "application/json" } });
						if (!response.ok) return;
						if ((await response.json()).sidebarPanelEnabled === true) setSidebarPanelWanted(true);
					} catch {}
				})();
			} catch (error) {
				console.error("[dsh-connect-workbuddy] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.modelLabelVerdictOf = modelLabelVerdictOf;
		exports.name = name;
		exports.publishModelLabelState = publishModelLabelState;
		return module.exports;
	}
});
