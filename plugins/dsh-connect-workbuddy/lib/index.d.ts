import z from "@deepseek-ai/schemastery";
import "@earendil-works/pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { Context } from "@deepseek-ai/cordis";
import { SettingsNamespace } from "@deepseek-ai/dsh-settings";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";
//#region src/auth.d.ts
/** Normalized WorkBuddy credential, timestamps in epoch milliseconds. */
interface WorkBuddyCredential {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  refreshExpiresAtMs?: number;
  domain: string;
  uid: string;
  enterpriseId?: string;
  nickname?: string;
  /**
   * The account's DISPLAY name, when the app publishes one (issue #124).
   *
   * For an enterprise member `nickname` is the LOGIN ALIAS, not a person's
   * name — a card showing it looks like it is managing somebody else's
   * account. The official client prefers this field, then the enterprise user
   * name, and only then the alias.
   *
   * Read from the desktop auth document when present. It is NOT always there
   * (the app writes only what it has), which is why the read order has three
   * steps rather than two.
   */
  displayName?: string;
  /** The enterprise-side user name (`enterpriseUserName`), when published. */
  enterpriseUserName?: string;
  uin?: string;
  /** Which auth file this came from; refreshes are always `dsh`. */
  source: 'desktop' | 'dsh';
  /** Absolute path of the auth file this credential was read from. */
  filePath: string;
  /**
   * Epoch ms the upstream last issued this token (`auth.lastRefreshTime`).
   *
   * This is the ONLY trustworthy freshness signal. `expiresAtMs` cannot be
   * used for ranking: when the upstream revokes a token it leaves the stored
   * `expiresAt` untouched, so a long-dead backup can claim a LATER expiry than
   * the live sign-in (observed on a real machine — a 2026-07-08 backup claimed
   * 2027-07-06 while the live file expired 2026-11-14, and only the live file
   * was accepted). Undefined when the document omits the field.
   */
  lastRefreshAtMs?: number;
}
/**
 * Why one probed path did not yield an account.
 *
 * These are safe to surface: they carry paths and cause only, never token
 * material. `encrypted` is the WorkBuddy-specific one — a build whose token
 * fields are encrypted cannot be read at all unless the desktop app itself is
 * present to hand over its at-rest key, so "sign in again" is the wrong advice
 * for it (the user may be perfectly signed in).
 *
 * `wrong-region` is the second WorkBuddy-specific one, and it exists because of
 * a real bug: a region-scoped store filters out every credential that belongs to
 * the other region, so a candidate file holding a perfectly valid sign-in for
 * the other tab was dropped by exactly the same `continue` that drops malformed
 * files. The file then appeared in NO list at all — not an account (filtered by
 * region) and not a failure (it parsed) — so a card could name two paths while
 * its report listed one, and the user's actual, working sign-in was the one
 * made invisible. Reporting it is also the most useful answer we can give: the
 * user is signed in, and merely on the wrong tab.
 */
interface WorkBuddyCandidateFailure {
  path: string;
  source: 'desktop' | 'dsh';
  reason: 'missing' | 'unreadable' | 'invalid' | 'encrypted' | 'wrong-region';
  message?: string;
}
/** Read-only sign-in summary for status and doctor output. */
interface WorkBuddyAuthStatus {
  state: 'signed-in' | 'signed-out';
  expiresAtMs?: number;
  refreshExpiresAtMs?: number;
  nickname?: string;
  domain?: string;
  source?: 'desktop' | 'dsh';
}
/**
 * Marker for a credential that EXISTS but could not be decrypted.
 *
 * Identified by {@link ENCRYPTED_CREDENTIAL_CODE} rather than `instanceof`, so
 * the check keeps working when the thrower and the caller end up in different
 * module instances (bundled host half vs. a test's source import) — the same
 * convention `WorkBuddyCredentialRejectedError` uses.
 */
declare const ENCRYPTED_CREDENTIAL_CODE = "WORKBUDDY_ENCRYPTED_CREDENTIAL";
/**
 * The user IS signed in, but the credential file cannot be read.
 *
 * This exists because "signed out" and "signed in with an unreadable credential"
 * resolve to the same observable state — zero accounts — and were therefore
 * reported with the same message. That message told a correctly signed-in user
 * to sign in again, which cannot possibly help: from WorkBuddy 5.6.x the desktop
 * app encrypts its token fields, and reading them requires asking the installed
 * app for its key. If that app cannot be located, the fix is to point the plugin
 * at it (`WORKBUDDY_APP_EXECUTABLE`), never to sign in again.
 *
 * No token material is carried: only the paths and the environment variable.
 */
declare class WorkBuddyEncryptedCredentialError extends Error {
  readonly code = "WORKBUDDY_ENCRYPTED_CREDENTIAL";
  /** Files that hold an encrypted credential, for the user to recognize. */
  readonly paths: readonly string[];
  constructor(paths: readonly string[]);
}
/** Whether an error reports an unreadable (encrypted) credential. */
declare function isEncryptedCredentialError(value: unknown): value is WorkBuddyEncryptedCredentialError;
/** Constructor options; only {@link refresh} is required. */
interface WorkBuddyStoreOptions {
  /** Explicit desktop auth-file path, overriding env and platform defaults. */
  desktopPath?: string;
  /**
   * Explicit plugin-owned copy path, overriding the per-region default.
   * Injectable so the copy/refresh cycle is testable without a real machine.
   */
  ownPath?: string;
  /**
   * Region this store serves. When set, only credentials whose login domain
   * maps to this region are discovered, selected, or refreshed — the two
   * regions' stores run side by side without seeing each other's accounts.
   */
  region?: WorkBuddyRegion;
  /**
   * Legacy single-copy path read as a migration source; defaults to the
   * pre-dual-provider location. Injectable for tests.
   */
  legacyOwnPath?: string;
  /**
   * The unified credential vault directory for this store. Defaults to the
   * per-region directory under the Harness home; injectable so the vault's
   * merge/scan behaviour is testable without touching a real machine.
   */
  vaultDir?: string;
  /**
   * Auth directories to scan, overriding the platform defaults. Injectable so
   * the multi-account scan is testable without touching a real machine.
   */
  authDirs?: readonly string[];
  /** Performs the upstream token refresh. */
  refresh: (credential: WorkBuddyCredential) => Promise<WorkBuddyRefreshOutcome>;
  /** Refresh this long before actual expiry; default five minutes. */
  refreshMarginMs?: number;
  /**
   * Resolves the desktop app's at-rest field key, used to open documents whose
   * token fields are encrypted (Windows builds). Defaults to asking the
   * installed app; injectable so the encrypted path is testable.
   */
  resolveAtRestKey?: () => Promise<Buffer | undefined>;
}
interface WorkBuddyAccountChoice {
  /** Stable id derived from `uin` (or `uid` when uin is absent). */
  id: string;
  /**
   * The account's human name, or `''` when the desktop app recorded none.
   *
   * Never an identifier: `uin`/`uid` are opaque numbers and UUIDs, and using one
   * as a display name reads as "the plugin does not know who this is". Callers
   * that render a name choose their own placeholder for the empty case.
   */
  accountName: string;
  domain: string;
  source: 'desktop' | 'dsh';
  tokenExpiresAtMs: number;
  /** The auth file this account was read from; newest is preferred. */
  filePath: string;
  selected: boolean;
  /**
   * This account belongs to an enterprise (issue #124).
   *
   * Present only when `enterpriseId` is set. The credits come from the
   * enterprise table and the consumer daily check-in does not exist for it, so
   * callers branch on this FACT rather than on `status.active` (which reads
   * `false` for every enterprise member).
   */
  enterprise?: boolean;
}
/** Legacy single-copy basename (pre-dual-provider); kept as migration source. */
declare const WORKBUDDY_AUTH_FILENAME = ".workbuddy-auth.json";
/** Env variable that overrides the desktop auth-file location. */
declare const WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
/**
 * Plugin-owned copy path for one region inside the Harness home. Each
 * region's store refreshes into its own file so two simultaneously signed-in
 * regions never overwrite each other's refreshed token.
 */
declare function workbuddyOwnAuthPath(region: WorkBuddyRegion): string;
/**
 * Pre-dual-provider single-copy path. Still read as a migration source (a
 * legacy credential serves the region it belongs to until that region's own
 * first refresh writes the per-region file), and removed by `logout`.
 */
declare function legacyWorkbuddyOwnAuthPath(): string;
/**
 * Platform-default directories holding the WorkBuddy desktop app's auth file.
 *
 * Windows and Linux prefer the OS-issued env location and fall back to the
 * home-derived convention when it is unset, so a redirected profile (OneDrive
 * folder backup, enterprise policy) still resolves. macOS has no equivalent
 * env variable; the single Application Support path is used as-is.
 *
 * `platform`, `home`, and `env` are injectable so the platform branches are
 * testable on any host without touching a real machine.
 */
declare function defaultDesktopAuthDirs(platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv): string[];
/** The live auth file's platform candidates, in probe order. */
declare function defaultDesktopAuthCandidates(): string[];
/** First platform-default candidate; see {@link defaultDesktopAuthCandidates}. */
declare function defaultDesktopAuthPath(): string | undefined;
/**
 * Parse a WorkBuddy auth document in either on-disk shape: the plugin OAuth
 * nested form `{"auth":{...},"account":{...}}` and the flat panel form.
 * Returns undefined when the document carries no access token.
 *
 * `atRestKey` is required to read documents whose fields are encrypted
 * (see {@link credentialField}); pass the key obtained from
 * `readAtRestKey()` when the plain read reports no token.
 */
declare function parseWorkBuddyAuth(text: string, filePath: string, atRestKey?: Buffer): WorkBuddyCredential | undefined;
/**
 * Whether a document carries any field the reader must decrypt — the token
 * fields or the identity fields — i.e. whether reading it needs the at-rest key
 * at all.
 *
 * Deciding this BEFORE asking the app for its key keeps the plain case (macOS
 * and older Windows builds, and every plugin-owned copy) from paying for a
 * child process on every credential read. Identity fields are included because
 * a future build could encrypt the display name while leaving tokens plain;
 * gating on tokens alone would then silently drop the name again.
 */
declare function hasEncryptedCredentialFields(text: string): boolean;
/**
 * Filename of a path regardless of the host separator: Windows paths use `\`
 * and this helper must keep working when a Windows path is compared on a
 * POSIX host (e.g. tests injecting a Windows-style auth dir).
 */
declare function authFileName(path: string): string;
/**
 * Stable account id. `uin` is the billing identity the upstream keys on and
 * survives across re-login; `uid` is the fallback for documents without one.
 */
declare function workbuddyAccountId(credential: Pick<WorkBuddyCredential, 'uin' | 'uid' | 'nickname'>): string;
/**
 * Read-only credential store with demand-driven refresh and multi-account
 * discovery.
 *
 * Refresh policy: refresh only when the access token is inside the margin
 * (or already expired), keep the refreshed credential in the plugin-owned
 * copy, and never write the desktop app's files. A failed refresh still
 * returns a not-yet-expired token so an unreachable refresh endpoint does
 * not take down a working session.
 */
declare class WorkBuddyCredentialStore {
  private readonly refresh;
  private readonly refreshMarginMs;
  private readonly region;
  private readonly ownPathExplicit;
  private readonly legacyOwnPath;
  private readonly legacyOwnPathExplicit;
  private readonly vaultDirExplicit;
  /** The vault directory, resolved ONCE at construction. */
  private readonly vaultDirResolved;
  private readonly authDirs;
  private readonly resolveAtRestKey;
  private desktopPathOverride;
  private accountId;
  private inflight;
  /**
   * In-flight/completed scan for the CURRENT `readAll` generation.
   *
   * One page open calls `readAll` six times: the usage route asks for the
   * account list, the sign-in state and the resolved credential, then the
   * per-account credits panel asks once PER ACCOUNT (`credentialFor`), and both
   * region tabs poll on the same timer. Each call re-read every auth file,
   * re-parsed it, and re-ran the vault merge — measured at 6 `readdir` + (6N+12)
   * `readFile` for N accounts, i.e. the cost grew with the account count on a
   * path whose answer cannot change within one tick.
   *
   * This is deliberately NOT a time-based cache: a TTL would make the card show
   * a stale account list after an OAuth add or an import, which is the very
   * class of bug this card keeps chasing. Instead the promise is shared while it
   * is in flight, and every WRITE clears it (see `invalidateScan`) — so a read
   * after a write always scans again, and a read during a scan joins it.
   *
   * Undefined means "no scan in flight and nothing cached".
   */
  private scanInflight;
  /**
   * When the cached scan FINISHED, epoch ms; 0 means "not finished yet".
   *
   * Deliberately the finish time, not the start time (issue #77). The window
   * used to be measured from the START, so a scan that took longer than the
   * window was already outside it the moment it landed: the very next `readAll`
   * started a fresh scan, and the sharing this cache exists for never happened.
   * On the machine in that report one scan took 1.4–2.1 s against a 1000 ms
   * window, so every one of a page open's ~6 reads re-scanned the filesystem.
   */
  private scanFinishedAtMs;
  /**
   * A RUNTIME account override from the pool's rotation, or undefined.
   *
   * Deliberately separate from {@link accountId}, which is the user's persisted
   * choice. Rotation decides who serves *now*; it must never rewrite what the
   * user picked, or "turn rotation off" could not restore their selection and
   * the plugin would be unable to tell the two apart afterwards. Nothing here
   * is ever written to settings.
   */
  private rotatedAccountId;
  constructor(options: WorkBuddyStoreOptions);
  /** Whether a credential's login domain belongs to this store's region. */
  private matchesRegion;
  /**
   * The path this store refreshes into: the per-region file for a
   * region-scoped store, the legacy single file otherwise, or an explicitly
   * injected path in tests.
   */
  ownAuthPath(): string;
  /**
   * Every plugin-owned copy to read, most preferred first. A region-scoped
   * store reads the legacy single copy as its migration source (readAll's
   * region filter drops it when it carries the other region's credential); an
   * unscoped store reads everything so diagnostics see both regions.
   *
   * With an explicitly injected own path the legacy source is read ONLY when
   * it was injected too — a test that pins one file must not accidentally see
   * the real machine's legacy copy.
   */
  private ownCandidates;
  /** The vault directory this store reads and writes (fixed at construction). */
  private vaultDir;
  /** Repoint the desktop file or directory; applies on the next read. */
  setDesktopPath(path: string | undefined): void;
  /**
   * Select an account by id; tokens stay outside settings.
   *
   * The empty string is the settings-level sentinel for "no explicit
   * selection" (the card's Clear action writes it), so it is normalized here
   * rather than being kept as an id that can never match an account. Every
   * caller therefore gets the documented default — follow the app's current
   * sign-in — instead of a dead selection.
   */
  selectAccount(accountId: string | undefined): void;
  /** Selected account id, for diagnostics and route assembly. */
  selectedAccountId(): string | undefined;
  /**
   * Whether the region runs a SAVED choice rather than the documented default.
   *
   * `false` means "follow the app's current sign-in", which is also what the
   * card's Clear action restores. The two states can resolve to the very same
   * account — an upgraded user whose pre-split `accountId` happens to be the
   * app's current sign-in clears the choice and sees no change at all — so the
   * card cannot infer this from the account list alone. It reports the state
   * here so clearing is observable instead of looking like a dead button.
   */
  hasExplicitSelection(): boolean;
  /** The auth-file path candidates, in probe order. */
  private resolveDesktopCandidates;
  /** The resolved desktop auth-file path, for diagnostics. */
  desktopAuthPath(): string | undefined;
  /**
   * Every auth file to scan: the live file plus the timestamped backups
   * WorkBuddy leaves beside it.
   *
   * An explicitly configured path pins the *directory*: its siblings are
   * still scanned, because a user who points the plugin at their auth file
   * expects account switching to work the same way it does on the default
   * path. Only the file ordering changes.
   *
   * A corrupt or signed-out file must never hide the others, so each read is
   * independent and failures are skipped rather than propagated.
   */
  private candidateFiles;
  /** Timestamped siblings of one auth file, newest first by filename. */
  private backupsBeside;
  /**
   * Read every local credential, deduplicated by account id. Files are
   * probed newest-first, so the first entry for an account is its freshest.
   *
   * A region-scoped store sees only its own region's credentials: the other
   * region's accounts are invisible to selection, refresh, and status alike,
   * which is what keeps the two regions' providers from cross-billing.
   */
  /**
   * The account list, sharing one scan across concurrent and repeated reads.
   *
   * See {@link scanInflight}: the whole performance fix lives in these lines.
   * Every caller keeps its OWN semantics (`current`, `accounts`, `status`,
   * `selectionLost`), because this returns the same array they used to build
   * themselves — only the filesystem work is shared.
   *
   * The window runs from the FINISH time ({@link scanFinishedAtMs}), so a scan
   * slower than the window still serves the reads that follow it. A scan in
   * flight is always joined, however long it has been running.
   *
   * A failed scan is NOT cached: the rejection clears the slot so the next read
   * retries, rather than pinning every later caller to one transient failure.
   */
  private readAll;
  /** Drop the shared scan so the next read re-reads the filesystem. */
  private invalidateScan;
  /** The one real scan: read every candidate file, then merge the vault. */
  private scanAll;
  /**
   * Merge the scan's credentials into the vault and read the vault back.
   *
   * Incremental by contract: a scan that finds nothing new writes nothing.
   * Per account, the vault entry is written only when the scan's read is
   * fresher by {@link isFresherVaultEntry} — so a steady-state scan is
   * mtime-stable and every sync is O(accounts) reads with at most one write
   * per CHANGED account.
   */
  private syncVault;
  /**
   * Default when no account is explicitly selected: the live sign-in, else the
   * freshest credential. Following the app's current sign-in is the documented
   * default behaviour; the backups exist so the user can switch explicitly.
   * This is NOT credit-seeking — it never reorders accounts to find one with
   * remaining credit.
   */
  private preferred;
  /**
   * Token-free account list for the plugin card.
   *
   * `selected` answers one question only: which row is the account the plugin
   * is actually going to use? That is exactly what {@link current} decides, so
   * the two must never disagree — the card renders this list while the shim
   * bills through `current()`, and a row marked "selected" that `current()`
   * refuses to use is what made the dropdown look healthy while every request
   * failed with 401.
   *
   * THE POOL'S RUNTIME OVERRIDE IS PART OF `current()`, SO IT IS PART OF THIS.
   * `current()` consults `rotatedAccountId` FIRST; this method used to ignore it
   * and answer from `accountId` alone. With the pool on, the two therefore
   * disagreed on every rotation: the shim billed account B while the card marked
   * account A — the reporter's screenshot showed 「当前选用」 on a rate-limited
   * account while the pill's total belonged to the one actually serving. Worse,
   * the usage document takes its `credential` from `current()` and its
   * `account.accountId` from this list, so one document could name two accounts.
   *
   * So an explicit selection that matches NO local account marks nothing as
   * selected (no silent fallback to a different account — see {@link current}).
   * The implicit default is marked only when nothing was explicitly chosen.
   * A live rotation marker wins over both, mirroring `current()`'s precedence,
   * and only while it still names a local account — `current()` falls through in
   * that case, and so does this.
   */
  accounts(): Promise<WorkBuddyAccountChoice[]>;
  /**
   * Whether a persisted selection exists that matches no local account, while
   * other local sign-ins ARE available to choose from.
   *
   * The card uses this to explain the state honestly (the account is signed in,
   * but the SAVED choice is gone) instead of showing the generic "sign in
   * again" hint, which misdirects: the token is usually perfectly healthy and
   * signing in again does not repair an orphaned id. When no local sign-in is
   * available at all, that hint IS accurate and this returns false.
   */
  selectionLost(): Promise<boolean>;
  /** The freshest stored credential for the current selection, no refresh. */
  current(): Promise<WorkBuddyCredential | undefined>;
  /**
   * Set (or clear) the pool's RUNTIME account override.
   *
   * Never persists and never touches {@link accountId}: the user's saved choice
   * is what `clear` restores, which is the whole reason this lives in its own
   * field. Rotation is off when this is called with `undefined`.
   */
  setRotatedAccount(accountId: string | undefined): void;
  /** The account the pool is currently rotating to, if any. */
  rotatedAccount(): string | undefined;
  /**
   * One account's stored credential by id, WITHOUT consulting or changing the
   * current selection.
   *
   * Exists so a recovery probe can test whether some OTHER local account is
   * still accepted upstream while a rejected one stays selected: mutating the
   * live selection to find that out would be exactly the silent account switch
   * this store refuses to perform (it would bill the wrong account mid-probe).
   */
  credentialFor(accountId: string): Promise<WorkBuddyCredential | undefined>;
  /** The credential to send upstream: {@link current}, refreshed on demand. */
  resolve(): Promise<WorkBuddyCredential>;
  /**
   * WHY no credential resolved, as the error to throw.
   *
   * `resolve()` seeing zero accounts has two very different causes, and the
   * generic "sign in once" message is only correct for one of them. When a
   * probe finds a credential file whose fields are encrypted and the key could
   * not be obtained, the user is signed in and re-authenticating cannot help —
   * so that case gets {@link WorkBuddyEncryptedCredentialError} instead, naming
   * the file and the environment variable that actually fixes it.
   *
   * The probe is only run on the failure path, so the healthy case pays nothing.
   * A probe that itself throws must not replace the real error, hence the
   * fallback to the generic message.
   */
  private describeMissingCredential;
  /** Read-only sign-in summary; never refreshes and never throws. */
  status(): Promise<WorkBuddyAuthStatus>;
  /**
   * Persist one OAuth sign-in into the unified vault.
   *
   * The credential is written with `source: 'dsh'` (it never came from a
   * desktop file) and joins the readable set on the next scan — the vault is
   * read by `readAll()` like any other source, so no separate discovery path
   * exists. The write is idempotent per account id: re-adding an account
   * replaces its entry, which is exactly what re-issuing a login means.
   *
   * Returns the account id so the card can offer to select it right away.
   */
  addOAuthAccount(credential: Omit<WorkBuddyCredential, 'source' | 'filePath'>): Promise<string>;
  /**
   * Drop one id from the dismissal list, if present.
   *
   * Silent by design: called on the ADD paths, where a list that cannot be
   * updated must not fail the action the user asked for. The consequence is the
   * same as before the fix — the account stays hidden until the list is
   * repaired — while throwing here would report a failed sign-in that succeeded.
   */
  private forgetDismissal;
  /**
   * Forget EVERY dismissal, so the next read lists the accounts again.
   *
   * Called by the manual 「re-scan」 action. Dismissal is "hide until I ask to
   * scan again", and this is that ask: the user is requesting what the machine
   * currently has, which includes accounts they hid earlier. Leaving the list
   * intact would make a removed desktop account unrecoverable from the UI — the
   * opposite of what the button promises.
   *
   * PREFERS deleting the file over writing an empty list: an absent file is the
   * normal state and keeps the vault directory free of a file that says nothing.
   * The unlink is not the only way, though, because on Windows removing a file
   * another process holds open fails with `EPERM`/`EBUSY`/`EACCES` — an antivirus
   * scanner, OneDrive, or an editor with it open, the same contention the card's
   * `isFileContentionWriteError` classifies for profile writes and the reason
   * `docs/WINDOWS.md` keeps a register. POSIX unlinks open files happily, so
   * without this the promise 「点重新检测账号即可找回」 would be false, silently,
   * on exactly the platform it matters most on.
   *
   * So the unlink falls back to OVERWRITING the list with an empty one through
   * the same locked atomic write `writeDismissed` uses. For every reader the two
   * outcomes are identical (`readDismissed` yields no ids either way), so the
   * user's ask is honoured even when the file itself cannot be removed.
   *
   * Returns whether the dismissals are now genuinely gone, VERIFIED by reading
   * the list back rather than by trusting the write: the caller renders this, so
   * "it worked" has to mean it. A `false` is the honest answer for a vault that
   * could neither be unlinked nor rewritten, and the rescan still runs — the
   * accounts simply stay hidden, which the UI can now say out loud instead of
   * showing a button that appears to have done nothing.
   */
  clearDismissals(): Promise<boolean>;
  /**
   * Remove ONE account from this region's list, by id.
   *
   * The account is DISMISSED, not merely deleted. Deleting the vault entry alone
   * was undone by the next scan: `syncVault` writes every desktop sign-in it
   * finds back into the vault (that is how a desktop account becomes selectable)
   * and `readAll` merges the vault in afterwards, so a removed desktop account
   * returned on the very next read while `removeAccount` had reported `true`.
   * Measured before the fix: remove → `true`, then `accounts()` still lists it.
   *
   * The desktop app's auth files stay read-only: dismissing hides the account
   * from this plugin without signing the app out, and that is exactly what the
   * card says. Re-adding it (a fresh OAuth sign-in or an import) clears the
   * dismissal, so the account is not lost to a future login.
   *
   * Returns whether a stored vault entry was also removed, so the caller can
   * still tell "removed" from "only a desktop sign-in" — the dismissal happens
   * either way, because only the user gets to decide an account is dismissed.
   */
  removeAccount(accountId: string): Promise<boolean>;
  /**
   * Remove every plugin-owned copy this store could read (per-region file,
   * legacy single file, and their lock siblings); the desktop files are
   * untouched. A region store's logout therefore also clears the legacy
   * migration source — deliberate: `logout` is the user's "forget what the
   * plugin stored" action, not a per-account toggle.
   */
  logout(): Promise<void>;
  private needsRefresh;
  private refreshNow;
  /**
   * Every readable plugin-owned copy, in candidate order; absent or corrupt
   * files are skipped rather than propagated.
   */
  private readOwns;
  /** Whether any candidate file exists as a regular file; diagnostics only. */
  desktopFilePresent(): Promise<boolean>;
  /**
   * Which paths were probed and why each one yielded no credential.
   *
   * Read-only and token-free: it exists so a signed-out card can explain
   * itself. A bare "not signed in" is undiagnosable on a machine whose layout
   * differs from the ones this plugin was written against — and on Windows it
   * is actively misleading, because encrypted token fields need the desktop app
   * present to be read at all. Only paths this store actually consults are
   * reported, and only files that failed: one healthy sibling would make the
   * whole list noise.
   */
  diagnose(): Promise<{
    tried: string[];
    failures: WorkBuddyCandidateFailure[];
  }>;
}
//#endregion
//#region src/image-gen.d.ts
/**
 * 产品配置 `data.models` 里的一个媒体模型条目。
 *
 * 实测上游只给三个字段（`{"id":"hunyuan-image-alpha","name":"Hunyuan Image Alpha",
 * "tags":["text-to-image"]}`），没有 credits、没有上下文长度。不要在这里补
 * 上游没有的字段——那正是「不猜」红线的反面。
 */
interface WorkBuddyMediaModel {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  /**
   * 模型级视频生成配置（上游 `models[].videoGeneration`），只对视频模型出现，
   * 图像链路从不读它。透传它是因为**同一份目录**同时喂生图与生视频两条链路：
   * 视频工具要靠这里的 `minSeconds`/`maxSeconds` 在本地拦下越界时长，
   * 而不是发上去等一个「unsupported video duration」的 400。
   *
   * 形状与 `video-gen.ts` 的 `WorkBuddyVideoModelConfig` 一致（那边是视频层的
   * 同一份定义，两处必须同步——tests/video-gen.spec.ts 有一条对拍测试）。
   */
  readonly videoGeneration?: WorkBuddyMediaVideoGeneration;
}
/** `WorkBuddyMediaModel.videoGeneration` 的结构。字段缺席就是上游没给，不补默认值。 */
interface WorkBuddyMediaVideoGeneration {
  readonly resolutions?: readonly string[];
  readonly defaultResolution?: string;
  readonly defaultSeconds?: number;
  readonly minSeconds?: number;
  readonly maxSeconds?: number;
}
/** 上游成功响应的归一化结果。`url` 与 `b64` 至少有一个。 */
interface WorkBuddyImageOutcome {
  readonly url?: string;
  readonly b64?: string;
  readonly created?: number;
  readonly credit?: number;
}
//#endregion
//#region src/video-gen.d.ts
/** 提交任务后上游返回的任务元数据（task id）。 */
interface WorkBuddyVideoSubmission {
  readonly taskId: string;
  readonly warnings: readonly string[];
}
/** 轮询完成后解析出的任务结果。 */
interface WorkBuddyVideoOutcome {
  /** 每个成品视频的下载 URL（`.mp4`）。 */
  readonly videos: readonly string[];
  /** 本次实际消耗的积分；上游没给就是 undefined。 */
  readonly credit?: number | undefined;
  /** 提交阶段就攒下的非致命告警。 */
  readonly warnings?: readonly string[] | undefined;
}
//#endregion
//#region src/promo.d.ts
/**
 * WorkBuddy promotion & tier badges — the upstream's own "this model is on
 * offer" annotation, parsed and resolved against the wall clock.
 *
 * WHY A SEPARATE MODULE, AND WHY IT COSTS NO REQUEST. The upstream ships the
 * badges inside the SAME `/v3/config` document that already carries the model
 * roster: `data.modelPromotions` and `data.modelTiers` sit beside
 * `data.models` (observed on the global feed, 2026-10-21). The plugin already
 * reads that document for the roster, so drawing a promotion badge adds ZERO
 * upstream traffic — it only adds a parser, because the document is not a
 * clean list of promotions: the same `modelPromotions` array also carries
 * NON-promotion entries (`hy-image-3.5`, `kling-video-v3` — entries with
 * `tags` / `videoGeneration` and no `modelIds` and no `badge`). Those must be
 * dropped, not rendered.
 *
 * WHY THE RESOLUTION LIVES HERE AND NOT IN THE FETCHER. A badge is a function
 * of the clock, not of the fetch: the upstream's windows are wall-clock
 * windows in a named zone (`schedule.daily`, e.g. `23:00`–`7:50` in
 * `Asia/Shanghai`) and absolute windows (`schedule.validFrom` /
 * `schedule.validUntil`). Picking the badge once, at parse time, FREEZES it —
 * a badge read at 22:59 would still claim "night discount" at 08:00 the next
 * morning. So the parser keeps EVERY candidate and the RENDERER asks for the
 * one that holds at the moment it draws. The card re-renders at least once a
 * minute while it is open (it polls the usage route), so a window edge is
 * picked up within a minute without a second timer.
 *
 * THE SHAPES THIS PARSER ACCEPTS (all observed on the global feed's
 * `/v3/config`, 2026-10-21 — the CN feed publishes the same two arrays, with
 * Chinese labels and the extra fields listed at the end of this header):
 *
 *   {
 *     id: 'hy3-free-trial-202608',
 *     kind: 'discount',
 *     enabled: true,
 *     priority: 200,
 *     modelIds: ['hy3'],
 *     badge: { label: 'Free now', color: '#FF0000', display: 'activeOnly' },
 *     discount: { discountedCredits: '0x', displayMode: 'replace', factor: 0 },
 *     hover: { textZh: 'Aug 6 – Oct 31: Free daily use with unlimited credits.' },
 *     schedule: {
 *       timezone: 'Asia/Shanghai',
 *       validFrom: '2026-07-06T00:00:00+08:00',
 *       validUntil: '2026-11-01T00:00:00+08:00',
 *     },
 *   }
 *
 * and the tier shape (`data.modelTiers`), which has the same `badge` /
 * `modelIds` / `priority` core, no `schedule`, and a `requiredUserType`:
 *
 *   {
 *     id: 'gpt-pro-only',
 *     badge: { label: 'Pro Only', labelEn: 'Pro Only', color: '#009273' },
 *     hover: { textEn: 'Exclusive to Pro subscribers.', textZh: '模型仅面向 Pro 用户开放。' },
 *     modelIds: ['gpt-6-astra', …],
 *     priority: 200,
 *     requiredUserType: 'standard',
 *     tier: 'standard',
 *   }
 *
 * THE CN FEED IS THE SAME FEED, READ AS THE APP READS IT. The CN gateway
 * publishes `modelPromotions` (8 entries, measured 2026-10-21) and
 * `modelTiers` (1 entry) in the SAME `/v3/config` document — with Chinese
 * labels (`夜间折扣` / `限时免费` / `夜间免费` / `独家限免` / `限时折扣` /
 * `订阅优先`), a `schedule.daily` night window, a base64 `badge.icon` and an
 * optional `badge.display: 'activeOnly'`. Those richer shapes are exactly what
 * this parser accepts below.
 *
 * They are visible only to the APP's product identity: the CLI channel's
 * answer to the same URL publishes neither array, because it is a strict
 * subset of the app channel's document. The plugin therefore reads the
 * product configuration as the app does (`PRODUCT_UA` in `src/upstream.ts`) —
 * which is why a CN account sees the same badges here as in the WorkBuddy
 * app, without a second upstream request.
 *
 * @module dsh-connect-workbuddy/promo
 */
/** How the upstream wants the badge to appear. */
interface WorkBuddyPromoBadge {
  /**
   * The badge's own wording, region-localized ("限时免费" on the CN feed,
   * "Free now" on the global one).
   */
  label: string;
  /** The English wording, when the upstream publishes one. */
  labelEn?: string;
  /** A compact wording, when the upstream publishes one. */
  shortLabel?: string;
  /** The English compact wording, when the upstream publishes one. */
  shortLabelEn?: string;
  /**
   * The badge's colour, as a hex string ("#009273").
   *
   * The upstream publishes it for most promotions and omits it for others
   * (the CN tier entry has none), so the renderer treats it as optional.
   */
  color?: string;
  /**
   * `'activeOnly'` — the badge belongs to the promotion's RUNNING period and
   * must disappear when the promotion is over.
   *
   * Absent — the badge is STANDING: it describes the model for as long as the
   * promotion itself lasts, while the promotion's daily window governs only
   * the discount. The upstream uses this for its night-discount pairs, where
   * one entry carries the badge plus the night hours and a second, separate
   * entry carries the same badge plus the daytime hours.
   */
  display?: 'activeOnly';
}
/** One daily window, as wall-clock times in `schedule.timezone`. */
interface WorkBuddyPromoWindow {
  /** `'HH:mm'`, inclusive. */
  start: string;
  /**
   * `'HH:mm'`, exclusive.
   *
   * `end` at or before `start` means the window CROSSES MIDNIGHT: `23:00` to
   * `7:50` is the observed CN night window.
   */
  end: string;
}
/** When a promotion runs. */
interface WorkBuddyPromoSchedule {
  /** The IANA zone the daily windows are written in ("Asia/Shanghai"). */
  timezone?: string;
  /** Epoch milliseconds; the promotion has not started before it. */
  validFrom?: number;
  /** Epoch milliseconds; the promotion is over AT it. */
  validUntil?: number;
  /** The daily windows, when the upstream publishes them. */
  daily?: readonly WorkBuddyPromoWindow[];
  /**
   * The upstream PUBLISHED `daily`, but not one entry of it could be evaluated.
   *
   * This is deliberately NOT the same as "no `daily`": an entry with no
   * `daily` is a 24-hour campaign (the discount runs whenever the promotion
   * does), while an entry whose every window failed to parse says nothing at
   * all about when it runs. Reading the second as "always" would turn a live
   * night-only campaign into a badge shown around the clock — the one
   * direction that overstates what the upstream said. A promotion carrying
   * this flag therefore never counts as running; the parse failure hides the
   * badge instead of doubling it.
   */
  dailyUnusable?: true;
}
/**
 * The upstream's own discounted price for a promotion, when it publishes one.
 *
 * This is what makes a "night discount" badge more than decoration: the badge
 * says the model is on offer, and this field says HOW MUCH less it costs during
 * the offer. The plugin used to drop it, so a model could wear a "night
 * discount" badge while still showing its full price — the card and the
 * composer readout then disagreed with what the user was actually charged.
 *
 * Shapes observed on the CN feed (2026-10-21, `docs/PROMO_BADGE.md`):
 *
 *   { discountedCredits: "0x", displayMode: "replace", factor: 0 }
 *
 * `discountedCredits` is a STRING with the unit glued on ("0x", "0.06x"), not
 * a number: `Number("0.06x")` is `NaN`, so it must be parsed, not coerced.
 * `factor` is a ratio the upstream sometimes supplies (0.545 = "55% of the
 * normal price"); it is used only when `discountedCredits` cannot be read, and
 * the two disagreeing means the string wins — it is the figure the user will
 * be charged.
 */
interface WorkBuddyPromoDiscount {
  /**
   * The multiplier the user pays during the promotion, e.g. `0` for free.
   *
   * Parsed from `discountedCredits` ("0x" / "0.06x" / "0.06"), or derived from
   * `factor` when only that is present. `undefined` when neither could be read.
   */
  multiplier?: number;
  /**
   * The upstream's display instruction — how the discounted figure relates to
   * the catalog one. BOTH spellings below are observed on the live CN feed
   * (2026-10-23, eight entries dumped from `/v3/config`):
   *
   *   `'replace'`      — show the discounted figure INSTEAD of the normal one.
   *                      Used by `hy3-free-trial-202608` (`"0x"`).
   *   `'strikethrough'` — the upstream's own client strike out the normal price
   *                      and print the discounted one. Used by
   *                      `glm-52-night-discount-202607` (`"0.50x"`),
   *                      `hy4-night-discount-daytime-badge-202609` (`"0.00x"`)
   *                      and `step-5-discount-daytime-badge-202610`.
   *
   * An earlier version accepted only `'replace'`, which silently dropped every
   * real CN discount except the hy3 trial — the price never moved while the
   * badge was lit (issue #120, second report). Both modes mean "the discounted
   * figure is what you pay"; they differ only in whether the old figure is also
   * shown on screen, which this plugin does not do either way (one number per
   * row), so both are honoured identically here.
   *
   * `undefined` means the entry carries a discount the upstream did not label.
   * That is NOT acted on: the field's absence says nothing about how to read
   * the figure, and guessing "replace" would change a price on a guess.
   */
  displayMode?: 'replace' | 'strikethrough';
}
/** The upstream's explanatory copy for the badge. */
interface WorkBuddyPromoHover {
  /** The Chinese wording. */
  textZh?: string;
  /** The English wording. */
  textEn?: string;
}
/** One upstream promotion or tier, resolved into the shape this plugin uses. */
interface WorkBuddyPromo {
  /** The upstream's id ("hy3-free-trial-202608"). */
  id: string;
  /** Which upstream list the entry came from. */
  source: 'promotion' | 'tier';
  /** The models the badge applies to. */
  modelIds: readonly string[];
  /** What the badge says and how it looks. */
  badge: WorkBuddyPromoBadge;
  /** The upstream's explanatory copy, when it publishes one. */
  hover?: WorkBuddyPromoHover;
  /** When the promotion runs, when it publishes that. */
  schedule?: WorkBuddyPromoSchedule;
  /**
   * The upstream's ordering weight: the higher the number, the more the
   * badge matters. Used to pick ONE badge per model when several apply.
   */
  priority: number;
  /**
   * The discounted price during the promotion, when the upstream publishes one.
   */
  discount?: WorkBuddyPromoDiscount;
}
//#endregion
//#region src/busy.d.ts
/**
 * WorkBuddy model load — the "繁忙程度" line the WorkBuddy client draws under a
 * model, read from the upstream's own probe and rendered next to the model name.
 *
 * WHY A SEPARATE REQUEST, AND WHY IT COSTS ALMOST NOTHING. Load is NOT part of
 * the model directory: `/v3/config` lists models and prices, and says nothing
 * about how busy each one is right now. The app asks a dedicated probe —
 * `POST /v2/chat/busy { models: [...] }` — and so does this plugin, exactly once
 * per model-picker refresh, batched at the upstream's own limit of 50 ids per
 * call. The probe is read-only and free (no credits, no account mutation):
 * measured 2026-10-21 on the CN gateway, HTTP 200 with
 *
 *   {"code":0,"msg":"OK","requestId":"…","data":[
 *     {"model":"hy3","busy_level":"busy"},
 *     {"model":"deepseek-v4.1-flash","busy_level":"congested"}]}
 *
 * IDENTICAL ON EVERY CN HOST AND UNDER EITHER CLIENT IDENTITY. `copilot.tencent.com`,
 * `www.workbuddy.cn` and `www.codebuddy.cn` answer byte-for-byte the same list,
 * and so do the CLI user agent (`CLI/2.63.2 CodeBuddy/2.63.2`) and the app's
 * product identity (`WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0`). Unlike
 * `/v3/config`, this endpoint is not channel-sensitive, so the plugin asks it as
 * the CLI agent it already is on the chat path — no product identity needed.
 *
 * THE GLOBAL GATEWAY DOES NOT HAVE IT (measured 2026-10-22, and the reason the
 * README says "CN only"). `www.workbuddy.ai` answers that same POST with
 * `404 {"error_msg":"404 Route Not Found"}`, and so do `/v3/chat/busy`,
 * `/v2/models/busy`, `/v2/chat/model/busy` and `/v1/chat/busy` under both POST
 * and GET — twelve path/method pairs, twelve 404s. The credential is fine: the
 * SAME token reads that gateway's `/v3/config` (200, 28 models), and none of
 * those models carries a field whose name mentions busy / load / queue / wait /
 * level / pressure. So this is not a wrong path, a wrong identity or a
 * permission problem — upstream never published the fact for that region. The
 * probe therefore fails there on every refresh; it is caught (see
 * `withBusyLevels` in `src/index.ts`), logged once, and the roster ships with
 * no levels, which the card renders as no badge. Deliberately NOT "fixed" by
 * inferring a level from latency or credits: a made-up load badge is worse than
 * no badge, and the plugin's whole rule here is to never state a fact the
 * upstream did not state.
 *
 * THE LEVELS ARE THE APP'S OWN ENUM, and anything outside it is `unknown`:
 * `idle` / `normal` / `busy` / `congested` / `unavailable`. The app's own words
 * (from its `im-channels` bundle, `chatInput.modelSelector.busy.*`) are
 * 空闲 / 轻微拥堵 / 极度拥堵 / 不可用; English reads Idle / Slightly congested /
 * Extremely congested / Unavailable.
 *
 * WHY THE LABELS LIVE HERE AND NOT IN THE UPSTREAM CLIENT. The probe returns a
 * machine level, never text: the same response is drawn differently by the app
 * (an icon for `congested`, a word for the rest), so the rendering decision
 * belongs with the renderer. This module keeps the words, the tone, and the
 * "which levels are worth drawing at all" rule in one place.
 *
 * NOTHING HERE IS PERSISTED. Load is a fact about THIS MINUTE: a cached level
 * that survives a restart is a lie, and the model directory is saved to disk
 * while a level must not be. So the level is attached to the catalog entry at
 * refresh time and nowhere else — see `attachBusyLevels` and `src/index.ts`.
 *
 * @module dsh-connect-workbuddy/busy
 */
/**
 * One model's load, in the upstream's vocabulary.
 *
 * `unknown` is the plugin's own value, not the upstream's: it is what an
 * unusable entry becomes (a missing level, a level outside the enum, a model the
 * probe did not answer for). It is deliberately distinct from `normal` — "we
 * were told nothing" must not be drawn as "all good".
 */
type WorkBuddyBusyLevel = 'idle' | 'normal' | 'busy' | 'congested' | 'unavailable' | 'unknown';
//#endregion
//#region src/upstream.d.ts
/** WorkBuddy region selected by the credential's login domain. */
type WorkBuddyRegion = 'cn' | 'global';
/** Upstream failure classes the shim maps onto distinct HTTP answers. */
type UpstreamErrorKind = 'hard_credit' |
/**
 * The upstream's own volume limit (business code 6004, or a 429 whose body
 * names a reset time). A statement about the ACCOUNT: it comes with a
 * timestamp, it lasts, and another account is a real way around it.
 */
'soft_rate' |
/**
 * MODEL-scoped throttling with no stated time (business code 14003).
 *
 * Deliberately its own kind, because treating it as {@link soft_rate} is a
 * 30x amplification of an upstream that says "wait about a minute" — and it
 * makes the pool walk every account into the same wall (issue #56).
 *
 * The evidence that this is the MODEL's load and not the account's, measured
 * on one credential at one moment, byte-identical requests differing ONLY in
 * the `model` field, three attempts each:
 *
 *   | model                  | multiplier | ok  | failures   |
 *   | ---                    | ---        | --- | ---        |
 *   | deepseek-v4.1-flash    | x0.00      | 1/3 | 429 / 14003 |
 *   | deepseek-v4.1-flash-sg | x0.03      | 1/3 | 429 / 14003 |
 *   | glm-5.3-flash          | x0.06      | 3/3 | —          |
 *   | hy3                    | x0.00      | 3/3 | —          |
 *   | kimi-k2.6              | x0.77      | 3/3 | —          |
 *
 * The same account served other models at the same second, so the credential
 * was fine. The upstream's own words agree: "Wait about a minute before
 * retrying, or switch to a less busy model." Both halves are rendered to the
 * user; the second one is the actual remedy.
 */
'model_busy' | 'session_dead' | 'policy_reject' |
/**
 * The upstream restricted THIS account for unusual activity (issue #127).
 *
 * Kept separate from {@link policy_reject}, even though both arrive as the
 * `11140` family with the same `msg: "request illegal"`: that one is a CONTENT
 * decision and switching accounts cannot help, while this is a CREDENTIAL
 * decision and switching is exactly the remedy. `displayMsg` is the only
 * discriminator upstream provides ("账号存在异常行为，已被限制使用" / "restricted
 * due to unusual activity").
 */
'account_restricted' |
/**
 * The gateway's channel gate refused the request itself (business code
 * 11128, "Illegal API invocation from an unapproved channel").
 *
 * Deliberately its own kind, because its `displayTips` — "this call failed
 * channel verification, possibly because it was not sent from an official
 * client" — names the account or the client version, and NEITHER is the
 * cause. The gate matches the OPENING of a `system` message against a list of
 * known third-party-agent prompts, so the same credential answers 200 to a
 * probe and 400 to a real chat request one second later (issues #87 / #88 /
 * #89 / #90). Filing it as `client` was technically true and practically
 * useless: the generic "refused on its parameters" sentence left the reader
 * to try another account, which cannot change a byte of the prompt.
 *
 * NOT failover-worthy for the same reason: every account sends the same
 * system prompt, so a second account answers the same 11128 one round trip
 * later and each attempt teaches the pool a false fact about a credential
 * that was never the problem.
 */
'channel_reject' |
/**
 * The upstream put this request in a queue instead of running it: business
 * codes `6020` (waiting, with a position), `6021` (queue full), `6022` (this
 * user already holds the maximum). See `src/queue.ts`.
 *
 * Its own kind because it is the ONE failure where the credential was fine,
 * the request was fine, and the server already accepted the work — telling the
 * user "请求失败" or rotating accounts is wrong on both counts. A queued
 * request follows the MODEL and the shared queue, not the account, so another
 * account is handed the same position: NOT failover-worthy (see
 * `isFailoverWorthy` in the shim).
 *
 * Classified BEFORE the plain status branches: the queue condition arrives as
 * a business code and the HTTP status it rides on is incidental (observed on
 * 200-shaped envelopes and on 429/500). Without this member it fell through to
 * `server`/`soft_rate`, both of which DO fail over — so hitting a queue walked
 * the whole account pool, burning a real request per account, before saying
 * "you are #8777 in line".
 */
'model_queue' | 'not_found' | 'server' | 'client';
/** Reasoning capability as the upstream catalog declares it. */
interface WorkBuddyReasoning {
  supportedEfforts?: readonly string[];
  defaultEffort?: string;
  canDisableThinking?: boolean;
  /**
   * An OBSERVED refusal of the `off` tier for this model (issue #83).
   *
   * Never declared by the upstream: it is stamped from this plugin's own
   * refusal record, and it outlives the catalog that witnessed it so the card
   * can keep showing the badge after a refresh. `undefined` means "never
   * observed", which is not the same claim as "accepts".
   */
  refusesOff?: boolean;
}
/** One CLI-usable model, carrying everything the plugin card displays. */
interface WorkBuddyUpstreamModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  /** Credit multiplier parsed from the upstream `credits` string. */
  creditMultiplier?: number;
  /**
   * Upstream's OWN image-input default, parsed from `supportsImages` with
   * `disabledMultimodal: true` as a veto. This is only a PRE-FILL for the
   * card's image checkboxes on "Refresh from WorkBuddy" (the refreshed draft
   * overwrites the saved image selection with the models advertising this):
   * it is not itself the runtime capability.
   *
   * The effective flag stays {@link multimodal}, stamped at runtime from the
   * user's saved `imageModelIds` — so a user can still uncheck an upstream-
   * advertised model, and the checked state only changes on an explicit
   * refresh/save.
   */
  supportsImages?: boolean;
  /**
   * Effective image-input support at runtime, decided by the saved
   * `imageModelIds` (which a model refresh pre-fills from {@link supportsImages}
   * but the user can edit before saving). Never inferred directly by the
   * catalog parser — see `withImageSelection` in `index.ts`.
   */
  multimodal?: boolean;
  reasoning?: WorkBuddyReasoning;
  descriptionZh?: string;
  descriptionEn?: string;
  supportsToolCall?: boolean;
  /**
   * The upstream's own promotion / tier badges that name THIS model.
   *
   * Not a field of the model entry: the upstream publishes the badges in
   * sibling arrays keyed by `modelIds` (`data.modelPromotions` /
   * `data.modelTiers`), inside the SAME `/v3/config` document that carries
   * the roster — so reading them costs no extra request.
   *
   * They ride along UNRESOLVED, and that is deliberate: a badge is a function
   * of the clock (the upstream's windows are wall-clock hours in a named
   * zone), so the entry that holds NOW is decided where the badge is drawn,
   * not where the document was read. See `src/promo.ts`.
   */
  promos?: readonly WorkBuddyPromo[];
  /**
   * How busy this model is RIGHT NOW, from the upstream's own probe
   * (`POST /v2/chat/busy`, see `src/busy.ts`).
   *
   * Deliberately NOT part of the catalog document, and deliberately not
   * persisted: the directory is a fact that survives a restart, a load level is
   * a fact about the minute it was measured. It is stamped onto the in-memory
   * catalog entry at refresh time and disappears with the process.
   */
  busyLevel?: WorkBuddyBusyLevel;
}
/** One billing package as the upstream returns it, dates already parsed. */
interface WorkBuddyCreditPackage {
  packageName: string;
  /**
   * Remaining credit, always read from the CYCLE family (issue #58).
   *
   * The upstream reports a monthly resource (`CapacityType 4`) with TWO
   * capacity families, and for a long time this field carried the POOL one on
   * the theory that the pool answers "how much do I have" (issue #48). That was
   * wrong, and the official client settles it: on a live CN account the client
   * shows `总剩余积分 2,196.61` = `套餐基础积分 500` + `平台奖励积分 1,696.61`,
   * which is EXACTLY Σ `CycleCapacityRemainPrecise` over the same response
   * (1696.61 + 500), while Σ `CapacityRemain` is 2,196 — the pool figure lands
   * on the right integer only because that account's cycle is untouched, and
   * the cent is what proves which family the client reads.
   *
   * The pool family is not a balance at all: on a monthly resource whose cycle
   * is fully spent it still reports `CapacityRemain=500, CapacityUsed=0`, i.e.
   * "nothing used, everything left", while the cycle reports
   * `CycleCapacityUsed=500`. Read as a balance it OVER-reports by the whole
   * monthly allowance of every account (measured on 8/8 CN accounts: pool and
   * cycle agree only where the cycle is untouched).
   *
   * Independent confirmation comes from the international gateway: three global
   * accounts report `CapacityRemain=100` while the gateway REFUSES their chat
   * requests with `14018 Credits exhausted`, so the pool figure is not spendable
   * credit there either.
   *
   * A gift (`CapacityType 1`) carries both families with identical values, so
   * reading the cycle uniformly costs nothing and removes the branch that
   * produced the defect.
   */
  remain: number;
  /** The package's capacity, from the same family as {@link remain}. */
  size: number;
  /** CapacityType 4: refreshed every cycle and never expires. */
  monthly: boolean;
  /** Next cycle start (the monthly refresh point); only on monthly packages. */
  refreshAtMs?: number;
  /** One-off expiry; the package disappears from the account at this time. */
  expiresAtMs?: number;
}
/** Aggregated credit answer for one credential. */
interface WorkBuddyCredits {
  total: number;
  packages: readonly WorkBuddyCreditPackage[];
  /** Credits expiring within 3 days across every package. */
  expiringSoon: number;
  /** When the nearest package expires, in ms. */
  nearestExpiryMs?: number;
}
/** Daily check-in activity state. */
interface WorkBuddyCheckinStatus {
  active: boolean;
  todayCheckedIn: boolean;
  streakDays: number;
  dailyCredit: number;
  todayCredit: number;
  isStreakDay: boolean;
  nextStreakDay: number;
  streakBonusDays: number;
  streakBonusCredit: number;
  claimButtonText?: string;
}
/** Daily check-in claim result. */
interface WorkBuddyCheckinClaim {
  credit: number;
  streakDays: number;
  isStreakDay: boolean;
}
/**
 * One promotional benefit the account may or may not still be entitled to.
 *
 * Read from the billing gateway's OWN status endpoints — the same two the
 * 「套餐与积分」 page calls before it decides whether to render a claim card
 * (`/billing/meter/compensation-status`, `/billing/meter/check-gift-claimed`).
 * Reading them is what makes the card honest: the plugin shows a benefit only
 * while the gateway itself would still show one.
 *
 * The two flags answer DIFFERENT questions and neither can be derived from the
 * other — this is the single most important fact about this shape, measured on
 * a real account pool:
 *
 *   - `active` is about the WINDOW, not about the reader. An account that has
 *     already claimed still reports `active: true` (observed: `claimed: true`
 *     together with `active: true` on a claimed gift), so `active` alone cannot
 *     mean "claimable".
 *   - `claimed` is about THIS account, and it survives the window: once the
 *     campaign lapses the endpoint keeps answering `claimed: false` with
 *     `active: false` (observed on every international account, whose campaign
 *     ended months ago).
 *
 * Hence a benefit is claimable exactly when {@link active} AND NOT
 * {@link claimed}. See `benefitOf` in `src/benefits.ts`.
 */
interface WorkBuddyBenefit {
  /** Which campaign this is; the plugin renders one row per kind. */
  kind: 'compensation' | 'gift';
  /** The campaign is inside its window (empty, see: already claimed ≠ inactive). */
  active: boolean;
  /** This account has already taken it — permanently, even after the window. */
  claimed: boolean;
  /** Credits on offer, as the gateway states them. */
  creditNum: number;
  /** Window end, epoch ms. Absent when the gateway sent none it could parse. */
  endsAtMs?: number;
  /** Window start, epoch ms. Compensation omits it. */
  startsAtMs?: number;
  /** When this account claimed it, epoch ms. Only meaningful with `claimed`. */
  claimedAtMs?: number;
}
/** Token refresh answer; fields the upstream omits stay absent. */
interface WorkBuddyRefreshOutcome {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  domain?: string;
}
/** Chat answer: either a live SSE response or a classified failure. */
type WorkBuddyChatResult = {
  ok: true;
  response: Response;
} | {
  ok: false;
  status: number;
  kind: UpstreamErrorKind;
  message: string;
  /** Structured fields lifted from a JSON failure body, when there were any. */
  detail?: UpstreamErrorDetail | undefined;
};
/**
 * Chat answer that also carries the response headers.
 *
 * Used by the model probe, whose whole point is to ask "is this usable right
 * now, and if not, when?" — and the only place an upstream ever names a
 * cooldown is the `Retry-After` header, which {@link WorkBuddyChatResult}
 * deliberately does not surface. Returning a separate shape keeps the ordinary
 * chat path (and its callers) untouched.
 */
interface WorkBuddyProbeAnswer {
  ok: boolean;
  status: number;
  /** Raw `Retry-After`, when the upstream sent one; null otherwise. */
  retryAfter: string | null;
  /** Failure body excerpt, only when `ok` is false. */
  body?: string;
  /** The live stream, only when `ok` is true. The caller drains and discards it. */
  response?: Response;
}
/**
 * Classify an upstream failure from its HTTP status and body excerpt.
 *
 * The `11128` family is classified BY ITS CODE, not by the `msg` wording —
 * see {@link isChannelRejectBody} and {@link channelGateMemberOf}. Which
 * member of the family it is decides the ADVICE in the reply, never the
 * classification: every member is a channel-verification refusal that no
 * account, region or top-up can change.
 */
declare function classifyUpstreamError(status: number, body: string): UpstreamErrorKind;
/** Structured fields lifted out of a JSON upstream failure body. */
interface UpstreamErrorDetail {
  /** Numeric upstream error code, e.g. 11140 for a content-policy refusal. */
  upstreamCode?: number;
  /** Upstream request id — the handle support asks for. */
  requestId?: string;
  /**
   * The upstream's RAW `msg`, kept beside {@link displayMsg}.
   *
   * On the `11128` family this is the DIAGNOSTIC half — it is what names which
   * gate fired ("conversation id missing", "first message is not system
   * prompt"), while `displayMsg` is the user-facing sentence the plugin must
   * NOT use as a diagnosis (issue #113 measured it to mislabel a content
   * refusal). Keeping both means a reply can echo what arrived AND say why it
   * is or is not believable, without one overwriting the other.
   */
  rawMsg?: string;
  /** Best human-facing message: `displayMsg.zh`, falling back to `.en`, then `msg`. */
  displayMsg?: string;
  /**
   * What the upstream says to DO about it: `displayTips.zh`, falling back to
   * `.en` (issue #78).
   *
   * Kept separate from {@link displayMsg} because the two answer different
   * questions and both are needed: `displayMsg` names what was rejected
   * ("模型无法处理此请求"), while `displayTips` names the REMEDY ("请新建任务、换个
   * 模型或稍后重试"). The generic failure path used to discard it and render the
   * raw body instead, whose first 400 characters are the `code`/`requestId`/
   * `extError` skeleton — so the one actionable sentence was always cut off, and
   * a plain parameter rejection read like an empty account pool.
   *
   * Recorded as data rather than folded into `displayMsg` so a caller that wants
   * to tell the user what to change can do so without the "what went wrong"
   * clause losing its own meaning.
   */
  tips?: string;
  /**
   * The request parameter the upstream named as rejected, from
   * `extError.param` (issue #83).
   *
   * Kept because the generic sentences cannot say WHICH parameter was at fault:
   * a 11133 caused by `reasoning_effort` reads exactly like a model that is
   * unavailable, and the fix (untick one checkbox) lives nowhere in the reply.
   */
  rejectedParam?: string;
  /** The offending value of {@link rejectedParam}, when the body carries one. */
  rejectedTier?: string;
}
/**
 * Region for a login domain; an empty domain means CN (matching upstream tooling).
 *
 * The international product is reachable under TWO brand domains: the WorkBuddy
 * AI desktop app signs in at `workbuddy.ai`, while the CodeBuddy CLI signs the
 * same international account in at `codebuddy.ai` (verified against a real
 * credential file, issue #4). Both are served by the same gateway stack — a
 * read-only probe shows `/v3/config` answering HTTP 200 with the same JSON
 * envelope on both hosts — so both classify as `global`. Missing the
 * `codebuddy.ai` spelling sent those tokens to the CN gateway, which rejected
 * them at the openresty layer with an HTML 401.
 */
declare function regionOf(domain: string): WorkBuddyRegion;
/**
 * The STRICT counterpart of {@link regionOf}: a region's domain only when it is
 * positively recognised, `undefined` for anything else.
 *
 * `regionOf`'s catch-all is deliberate — the CN product is single-homed, so an
 * unrecognised spelling is treated as CN and a real (if oddly written) CN
 * credential still resolves. That reasoning holds only for a domain the
 * UPSTREAM issued. It does not hold for a value read out of a file someone
 * handed the plugin: there "unrecognised" means "cannot be classified", and
 * calling it CN would file a foreign or spoofed credential in the CN vault.
 * Import gates must use this, not {@link regionOf}.
 *
 * Both sides are matched on their registrable domain, so a bare host and any
 * subdomain qualify while a lookalike such as `codebuddy.cn.evil.com` cannot.
 *
 * `copilot.tencent.com` is NOT a third product — it is this plugin's OWN CN
 * chat gateway (`CN_CHAT_BASE`), and the credential's `domain` field carries it
 * verbatim on real records. Refusing it here made the plugin reject its own
 * export: the card exported 8 accounts, and re-importing that file skipped the
 * three whose `domain` was the gateway. It cannot be spoofed into the wrong
 * region by being recognised here — it names the CN gateway, so admitting it is
 * the same decision as admitting `workbuddy.cn`.
 */
declare function knownRegionOf(domain: string): WorkBuddyRegion | undefined;
/**
 * How the plugin should identify itself where the upstream only RECORDS the
 * request (issue #132). One switch, because the two halves are one decision.
 */
interface WorkBuddyWireIdentity {
  /**
   * Adopt the official client's usage-page identity on chat requests.
   *
   * ON adds `X-IDE-Type` / `X-IDE-Name` / `X-IDE-Version` and switches the
   * conversation-identity triple to the 32-hex UUIDv7 shape the official client
   * uses (plus `X-Request-ID`, which mirrors the message id there).
   *
   * OFF by default, and the reason is the evidence tier, not the mechanism: the
   * reporter measured HTTP 200 on their own build of this PLUGIN at 5.3.1
   * (the WorkBuddy client itself was 5.8.3), and this plugin has not
   * reproduced that against the live gateway. Nothing in either gate is documented
   * as reading these headers — `11128`'s three doors are the message openings,
   * the missing conversation id and a non-system first message, none of which a
   * header can change — but this gateway has repeatedly refused requests for
   * reasons visible only in the answer, so a display-only alignment ships behind a
   * switch rather than as a silent upgrade for every account. `User-Agent` and the
   * request BODY are untouched either way.
   */
  usageIdentity?: boolean;
}
/**
 * The model id a prepared body asks for, when it carries one (issue #61).
 *
 * Lives beside {@link prepareChatBody} because it reads the same shape: the
 * serialized OpenAI body, after this plugin's rewrites. Never throws — a
 * malformed body is the upstream's to reject, not a reason to lose the failure
 * measurement that this id is needed for.
 */
declare function modelIdOfBody(bodyJson: string): string | undefined;
/**
 * How a body should be prepared beyond the rules every request needs (issue #132).
 *
 * Both switches default to OFF, and that default is the point: each one changes
 * bytes the upstream counts, so it must be a deliberate opt-in rather than a
 * silent behaviour change on upgrade.
 */
interface PrepareChatBodyOptions {
  /**
   * Move the harness's injected `user` messages above the real prompt.
   *
   * WHY. The usage page's 请求 column is filled from the LAST `user` message in
   * the body. The DSH harness appends its runtime context (time samples,
   * `Current runtime context.`, `<system-reminder>` blocks) AFTER the user's real
   * prompt, as extra `user` messages — so the model reads the real prompt but the
   * usage page records only the injected tail, and a user comparing their usage
   * history with what they typed sees rows that look like noise.
   *
   * The move is ORDER-ONLY and only within the trailing run: the injected
   * messages are lifted out and re-inserted immediately BEFORE the real prompt,
   * which keeps every message, its text and every tool result intact (the one
   * textual edit is the recorded prompt's leading marker, documented at
   * {@link ACP_LEADING_TAG}). It is
   * therefore invisible to the model's instruction order (a runtime-context block
   * is context wherever it sits) and it is what makes the usage column show what
   * the user actually typed.
   *
   * It also removes the leading `<acp …>mNNNNN</acp>` marker from THAT prompt and no
   * other message, because otherwise the recorded row still opens with the marker
   * instead of the user's sentence. Marker only — no text is touched.
   *
   * Only messages that MATCH the harness's own injected prefixes are moved. A
   * body from any other client is untouched: this must never reorder a
   * conversation whose trailing user messages are real turns.
   */
  keepPromptLast?: boolean;
  /**
   * Additional leading markers that mark a trailing `user` message as injected
   * context, one literal prefix per entry.
   *
   * WHY. The built-in pattern at {@link INJECTED_USER_PREFIX} knows only the
   * prefixes measured at the time it was written; a companion plugin (or a DSH
   * update) that starts injecting new text would silently fall back to having
   * its blocks recorded as the prompt. Each entry is matched LITERALLY at the
   * start of the message text (after leading whitespace and the
   * `billion-context` marker, which the built-in pattern tolerates) and OR'ed
   * with the built-ins; entries are escaped, so no configuration value can turn
   * the pattern invalid.
   */
  extraInjectedPrefixes?: readonly string[];
}
/**
 * Normalize an OpenAI chat-completions body for the WorkBuddy upstream: force
 * `stream: true` (the upstream rejects non-streaming), flatten `tool_choice`
 * (the upstream's field is a string; object forms return 400), rewrite
 * `developer` to `system`, guarantee a leading system message, and move a
 * recognized third-party-agent system prompt off the gateways' content
 * fingerprint.
 *
 * The last step is not cosmetic: both gateways refuse a request whose `system`
 * message opens with one of the openings listed at
 * {@link UNAPPROVED_CHANNEL_OPENINGS} — business code 11128, surfaced to the
 * user as a "渠道校验" (channel verification) failure — which made every CN step
 * of a DSH session fail while a two-message probe on the same account returned
 * 200. Every rewrite in here is forced by a gateway rule, so a body the
 * upstream already answers keeps its prompt as close to byte-for-byte as these
 * rules allow.
 */
declare function prepareChatBody(source: string, options?: PrepareChatBodyOptions): string;
/** Marker carried by {@link WorkBuddyCredentialRejectedError}; survives bundling. */
declare const CREDENTIAL_REJECTED_CODE = "WORKBUDDY_CREDENTIAL_REJECTED";
/**
 * The upstream refused the CREDENTIAL itself rather than failing the request.
 *
 * This is a distinct, actionable class: the token is not usable and no retry
 * with the same token will help. Callers use it to tell the user what to do
 * about it (switch accounts, or sign in again) instead of showing a raw HTTP
 * error, and the card must never confuse it with a transient upstream fault.
 *
 * Identified by {@link CREDENTIAL_REJECTED_CODE} rather than `instanceof`, so
 * the check keeps working when the caller and the thrower end up in different
 * module instances (bundled host half vs. a test's source import).
 */
declare class WorkBuddyCredentialRejectedError extends Error {
  readonly code = "WORKBUDDY_CREDENTIAL_REJECTED";
  /** HTTP status the upstream answered with (401 or 403). */
  readonly status: number;
  constructor(status: number);
}
/** Whether an error reports that the upstream refused the credential itself. */
declare function isCredentialRejectedError(value: unknown): value is WorkBuddyCredentialRejectedError;
/**
 * Parse the upstream's `credits` string into a multiplier.
 *
 * Observed forms: `"x0.79 credits"`, `"x0.05"`, `"x0.00 credits"`,
 * and absent. Unparsable values yield undefined rather than a guess — the
 * card simply omits the rate instead of displaying a fabricated one.
 */
declare function parseCreditMultiplier(value: unknown): number | undefined;
/**
 * Parse the upstream's `reasoning` object; unknown shapes degrade to `{}`.
 * Both spellings normalize here: the plural form passes through as declared,
 * and the singular `effort` form folds via {@link singularEffortLadder}.
 */
declare function parseReasoning(value: unknown): WorkBuddyReasoning | undefined;
/** Parse one catalog entry; entries without usable token limits are dropped. */
declare function parseUpstreamModel(value: unknown): WorkBuddyUpstreamModel | undefined;
/**
 * Upstream HTTP client. One instance serves the whole plugin; requests take
 * the credential explicitly so token refreshes apply on the next call.
 */
declare class WorkBuddyUpstreamClient {
  private readonly onFallback?;
  private readonly identity;
  /**
   * Reports an anomaly the reader or classifier had to tolerate.
   *
   * Injected rather than logged here because this module holds no logger on
   * purpose — it is pure transport + parsing, so it stays importable from
   * tests and the CLI without a cordis context. The host wires its
   * `ctx.logger.warn` in; without a host the event is dropped, which is the
   * same silence the previous single-source reader had.
   */
  constructor(onFallback?: ((message: string) => void) | undefined, identity?: WorkBuddyWireIdentity);
  /** POST the chat endpoint; a successful answer is the raw SSE response. */
  chatStream(credential: WorkBuddyCredential, bodyJson: string, signal?: AbortSignal): Promise<WorkBuddyChatResult>;
  /**
   * Send one minimal chat request for `bodyJson` and report the RAW answer.
   *
   * Shares {@link chatHeaders} and the chat base with {@link chatStream} on
   * purpose: a probe is only meaningful if it reaches the same endpoint with the
   * same authentication as a real request. The differences are deliberate and
   * narrow — it returns the headers (for `Retry-After`) and the failure body
   * (for classification) instead of a pre-classified error, so the probe module
   * owns the interpretation and the network layer stays a transport.
   *
   * The caller MUST drain {@link WorkBuddyProbeAnswer.response}; an unread body
   * holds the connection open.
   *
   * ALWAYS bounded in time. The pool's batch runner is serial and passes no
   * signal, so without a ceiling here one stalled connection blocks every account
   * behind it — the batch looks hung with no way to tell which member did it.
   * A supplied signal is COMBINED with the timeout rather than replacing it, so
   * the single-model route keeps its cancellation behaviour and still cannot
   * hang forever.
   *
   * The ceiling covers ONLY the wait for a response — it is cleared the moment
   * `fetch` resolves. Holding a timer over the body would put a healthy but slow
   * model on the same clock as a dead endpoint, and the whole point of the
   * period is to answer "did the upstream answer at all". A probe asks for a
   * single token, so the body that follows is one SSE line.
   */
  probeChat(credential: WorkBuddyCredential, bodyJson: string, signal?: AbortSignal): Promise<WorkBuddyProbeAnswer>;
  /** POST the token-refresh endpoint; the caller merges the outcome. */
  refreshToken(credential: WorkBuddyCredential): Promise<WorkBuddyRefreshOutcome>;
  /**
   * Read the model directory for the credential's region.
   *
   * Both regions read `/v3/config`, the document the WorkBuddy app itself
   * consumes, and both read it as the APP's product identity
   * ({@link PRODUCT_UA}) — the header the app sends, not the CLI channel's.
   * That is load-bearing, not cosmetic: the CLI channel's answer is a strict
   * subset of the app channel's and publishes neither `modelPromotions` nor
   * `modelTiers`, so reading `/v3/config` as the CLI channel is what left the
   * CN card without a single promotion badge while the app showed one on the
   * same account (see {@link PRODUCT_UA}).
   *
   * CN falls back to the legacy {@link MODELS_CATALOG_PATH} when `/v3` fails,
   * returns a non-zero envelope, or resolves to no usable model, so a gateway
   * that stops serving the modern document degrades to the previous roster
   * instead of leaving the region empty. The fallback is silent when unused and
   * reported when it fires, because a roster that silently differs from the
   * app's is exactly the bug this ordering exists to fix.
   *
   * No user-side toggle is involved: the region comes from the credential's
   * `domain`.
   *
   * `keepModelIds` is the user's own selection, passed through to
   * {@link selectCliModels}: a model the upstream roster dropped but the SAME
   * document still publishes stays in the roster, so reading the directory
   * never withdraws a model the user is running (issue #32's failure mode,
   * one step upstream of it).
   */
  fetchModels(credential: WorkBuddyCredential, signal?: AbortSignal, keepModelIds?: readonly string[]): Promise<readonly WorkBuddyUpstreamModel[]>;
  /**
   * Read how busy each model is right now, from the upstream's own probe.
   *
   * Batched at the upstream's ceiling (`WORKBUDDY_BUSY_BATCH_SIZE`), because the
   * probe takes a list of ids and answers only about the ids it was given.
   *
   * Throws on anything that is not a clean `code: 0`, like every other reader in
   * this class — the CALLER decides that a failed load probe is survivable and
   * catches it. Nothing here is persisted: the level belongs to the refresh that
   * asked for it.
   */
  fetchModelBusy(credential: WorkBuddyCredential, modelIds: readonly string[], signal?: AbortSignal): Promise<Map<string, WorkBuddyBusyLevel>>;
  /**
   * 读该账号所属区的产品配置，返回**全部**媒体模型（图 + 视频，按 tag 区分）。
   *
   * 走的是和 {@link fetchModels} 同一条 `/v3/config`（国内区与国际区都答），
   * 区别只在这里保留 `data.models` 的媒体条目、而不是投影成 CLI 聊天目录。
   * 两区实测（2026-10-25，同日各跑一次只读探针）：
   *   - 国内区 61 条模型 / 17 条带 tag：`hunyuan-image-alpha`（`text-to-image`）、
   *     `hunyuan-image-alpha-edit`（`image-to-image`）、`kling-video-v3` 与
   *     `minimax-video-h3`（`text-to-video` + `image-to-video`）。
   *   - 国际区 29 条 / 7 条带 tag：`hy-image-3.5`（`text-to-image` +
   *     `image-to-image`）、`kling-video-v3`（两种视频 tag）。
   * 两边目录完全不重叠，所以「国际区一条都没有」是 2026-10-21 的旧观测，
   * 已经过期 —— 目录真的没标时才返回空数组（而不是编一个模型出来）。
   *
   * 返回的是**未分组**的全集：谁要 `text-to-image` 就自己按 tag 过滤
   * （{@link selectMediaModels} / `pickMediaModel`）。生图工具、改图路径、卡片清单
   * 因此共用这一次读取，而不是各读一遍目录。
   *
   * 这是一次 EXTRA 读取，不是「复用目录那一次」：`fetchModels` 的结果被投影成
   * 聊天目录就丢掉了媒体标签，所以这里必须再读一遍同一份文档。它是只读 GET、
   * 不花积分，且工具侧有 5 分钟缓存，但「零新增请求」的说法不成立，别那么写。
   * 国内区与 {@link fetchModels} 一样走 `/v3` → `/v2` 降级：上游一旦不答
   * `/v3`，聊天目录会降级而这里不能变成一个原始异常。
   */
  fetchMediaModels(credential: WorkBuddyCredential, signal?: AbortSignal): Promise<readonly WorkBuddyMediaModel[]>;
  /**
   * 发一次文生图请求。
   *
   * 端点、请求体、响应解析全部照抄官方 CLI 的 ImageService（见 `image-gen.ts`
   * 的模块注释）。产物是 24 小时有效的 COS 签名 URL；实扣积分随区与模型不同
   * （国内区 `hunyuan-image-alpha` 5.71、国际区 `hy-image-3.5` 0.03），
   * 只在响应的 `data.usage.credit` 里给出，调用方按实际值回报。
   *
   * 失败分两层：HTTP 非 2xx 交给 {@link describeImageFailure} 翻成带 code 的
   * 错误（401/403 提示重新登录、404 提示该区没有生图路由、429 提示限流）；
   * HTTP 200 但信封 `code !== 0` 由 {@link parseImageResponse} 处理。
   */
  generateImage(credential: WorkBuddyCredential, request: {
    readonly model: string;
    readonly prompt: string;
    readonly size?: string;
  }, signal?: AbortSignal): Promise<WorkBuddyImageOutcome>;
  /**
   * 发一次改图请求（`image-to-image`）。
   *
   * 端点换成官方 CLI `ImageService.editImage` 用的 `/v2/images/edits`，请求体是
   * 生图那一套 + `image`（**必须是 data URL 字符串数组**）+ 可选 `input_fidelity`。
   * 2026-10-25 国际区实测：`hy-image-3.5` + 一张 712×962 的截图 → 200、code 0、
   * 一张 COS 签名 URL、`credit 0.03`。
   *
   * `image` 的形态由调用方（工具层）负责规整成 data URL——这一层只发请求、
   * 不碰文件系统，和 {@link generateImage} 的分工保持一致。
   */
  editImage(credential: WorkBuddyCredential, request: {
    readonly model: string;
    readonly prompt: string;
    readonly size?: string;
    readonly image: readonly string[];
    readonly inputFidelity?: string;
  }, signal?: AbortSignal): Promise<WorkBuddyImageOutcome>;
  /**
   * 发一次生视频请求（提交任务，拿 task id）。
   *
   * 端点与请求体照抄官方 CLI 的 `VideoService.submitTask`：`POST /v2/videos/generations`，
   * 请求体由 `buildVideoBody` 拼（prompt / model / seconds / negative_prompt /
   * watermark:true / 图生视频时的 image_url / extra_parameters）。响应取
   * `data.id` 作为 task id 返回，真正的视频要再轮询 `/v2/videos/tasks` 才拿得到。
   *
   * 这是一次**花钱**的请求（与生图一样），所以失败分类交给 {@link describeVideoFailure}：
   * 401/403 提示重新登录、404 提示该区没有视频路由、429 提示限流、其它透传 msg。
   * HTTP 200 但信封 `code !== 0` 由 {@link parseVideoSubmission} 处理。
   */
  submitVideo(credential: WorkBuddyCredential, request: {
    readonly model: string;
    readonly prompt: string;
    readonly seconds: number;
    readonly negativePrompt?: string | undefined;
    readonly image?: string | undefined;
    readonly lastImage?: string | undefined;
    readonly resolution?: string | undefined;
    readonly aspectRatio?: string | undefined;
    readonly enableAudio?: boolean | undefined;
  }, signal?: AbortSignal): Promise<WorkBuddyVideoSubmission>;
  /**
   * 轮询一个生视频任务直到完成或失败。
   *
   * `POST /v2/videos/tasks`（请求体 `{ task_id }`），官方 CLI 的 `VideoService.pollTask`
   * 就是每 5 秒查一次、直到 `status === 'completed' | 'failed'`。这里照搬同样的
   * 轮询节奏与整体超时（默认 ~600s，远大于生图的 180s，因为视频要生成几十秒到几分钟）。
   *
   * 注意：轮询**已经花过钱**（提交那次就扣了），所以轮询期间的网络抖动、超时要
   * 当成真实失败——调用方据此进冷却。只有"提交那一次"因为参数写错 / 没登录而没
   * 发出去，才不进冷却（同生图工具的设计）。
   */
  pollVideoTask(credential: WorkBuddyCredential, taskId: string, signal?: AbortSignal): Promise<WorkBuddyVideoOutcome>;
  /**
   * 下载一个视频 URL 到本地临时目录，返回绝对路径。
   *
   * 官方 CLI 的 `VideoService.downloadVideos` 把每条 `data[].url` 写成本地 `.mp4`
   * （产物是 COS 签名 URL，和生图同源，但不是图片 MIME）。这里每次一条，工具层
   * 负责把多条结果各自落盘并回 `file://` 给模型与用户。
   */
  downloadVideo(credential: WorkBuddyCredential, url: string, signal?: AbortSignal): Promise<string>;
  /** Query today's check-in status without changing account state. */
  fetchCheckinStatus(credential: WorkBuddyCredential): Promise<WorkBuddyCheckinStatus>;
  /**
   * Read every promotional benefit this account can still see, WITHOUT claiming
   * anything.
   *
   * The campaign list is closed and small on purpose: the gateway exposes one
   * status endpoint per campaign, so "discover benefits" is a fixed fan-out, not
   * a search. A new campaign type means a new `/billing/meter/*-status` endpoint
   * added here — the plugin never guesses at undocumented ones.
   *
   * Every endpoint is read in parallel because they are independent, and a
   * failure is per-endpoint: one campaign answering 5xx must not blank out the
   * other. The caller gets only what was actually read.
   *
   * Note the paths carry NO `/v2` prefix — these are not the `/v2/billing/meter`
   * family the credit and check-in calls use. Probing `/v2/...` answers 404, which
   * is how this distinction was found.
   */
  fetchBenefits(credential: WorkBuddyCredential): Promise<readonly WorkBuddyBenefit[]>;
  /** One benefit status endpoint. Throws on anything that is not a clean `code: 0`. */
  private readBenefitStatus;
  /**
   * Claim one benefit campaign on ONE account (issue #79).
   *
   * This is a real credit grant on a real account, so it takes no account
   * argument other than the credential it is handed: the caller decides which
   * single account, and there is deliberately no batch form of this method. The
   * browser route is the only caller, and it guards the mutation with the same
   * POST + loopback checks the check-in route carries.
   *
   * The response is not parsed: the documented envelope of these two endpoints
   * is an empty success, and the caller re-reads the status afterwards. That
   * re-read, not this answer, is what the user is shown — which is why a claim
   * that silently did nothing still cannot leave the card saying 待领取.
   */
  claimBenefit(credential: WorkBuddyCredential, kind: WorkBuddyBenefit['kind']): Promise<void>;
  /** Claim today's check-in reward. The browser route guards this mutation. */
  claimDailyCheckin(credential: WorkBuddyCredential): Promise<WorkBuddyCheckinClaim>;
  /**
   * The ENTERPRISE credit table (issue #124).
   *
   * `/v2/billing/meter/get-user-resource` answers an enterprise member with
   * HTTP 200 and an empty `Accounts` list — a legally-shaped "you have no
   * credits" that is simply false, because the member's credits live under the
   * enterprise account. The official client branches on the account's
   * `type: "ultimate"` and calls `/billing/meter/get-enterprise-user-usage`
   * instead (no `/v2` prefix), which returns:
   *
   *   { credit: 1234, limitNum: 5000, cycleResetTime: "2026-11-01 00:00:00" }
   *
   * What REMAINS is `limitNum - credit`. `credit` there is the amount SPENT,
   * not the amount left — reading it as a balance inverts the answer, which is
   * worse than the zero it replaces.
   *
   * @returns the credits, or `undefined` when this response carried no
   *          readable balance (the caller turns that into an error rather than
   *          reporting zero).
   */
  private fetchEnterpriseCredits;
  /**
   * POST the billing endpoint for the remaining credit, keeping every package
   * separate: the card groups monthly-cycle packages itself and lists the
   * nearest-expiring one-off packages, so aggregation here would lose the
   * dates it needs.
   */
  fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits>;
}
//#endregion
//#region src/catalog.d.ts
/** One model entry the adapter exposes. */
type WorkBuddyModelInfo = WorkBuddyUpstreamModel;
/**
 * Static CLI models captured from the CN endpoint (2026-08-30). The upstream
 * refresh replaces this list at startup; it exists so the provider registers
 * with a usable catalog even while the first fetch is in flight or offline.
 *
 * The upstream's `auto` ROUTER is deliberately absent, matching what
 * `selectCliModels` now does to the live roster: it resolves to a different
 * model per request, so it is not a row this plugin can describe. Keeping it
 * here would have reintroduced it on the offline/第一帧 path only, which is the
 * hardest kind of inconsistency to notice.
 */
declare const FALLBACK_WORKBUDDY_MODELS: readonly WorkBuddyModelInfo[];
/**
 * Static CLI models captured from the INTERNATIONAL gateway's desktop-channel
 * product config (`www.workbuddy.ai/v3/config`, 2026-09-11). The two regions
 * expose different rosters — the CN list has no `gpt-*`/`gemini-*` entries —
 * so a global account must never be seeded with the CN list. Like the CN
 * fallback this is replaced by the live refresh; it only keeps the provider
 * usable before the first fetch lands. Order and rates mirror the upstream.
 */
declare const FALLBACK_WORKBUDDY_MODELS_GLOBAL: readonly WorkBuddyModelInfo[];
/**
 * Static fallback directory for a region. Each region keeps its own model
 * slot in settings; the fallback must match the region so an account never
 * shows the other region's roster.
 */
declare function fallbackModelsFor(region: 'cn' | 'global'): readonly WorkBuddyModelInfo[];
/**
 * Derive the runtime catalog from the last-refreshed directory plus the
 * user's selection. This is the single source of truth for what DSH exposes,
 * so saving only the selection is enough to rebuild it after a restart.
 *
 * An empty selection falls back to the whole directory: a plugin that has
 * never been configured must still serve models rather than nothing.
 */
type WorkBuddyContextBudget = number;
/**
 * Derive the runtime catalog from the last-refreshed directory plus the user's
 * selection.
 *
 * An empty selection means "never configured" and serves the whole directory.
 * But a NON-empty selection that intersects the directory in nothing must NOT
 * serve nothing: that is the issue #32 failure mode (the picker empties out),
 * and it now has a realistic trigger — a user whose only ticked model was the
 * upstream's `auto` router, which this version stops offering. Such a selection
 * degrades to the whole directory rather than to silence: the user asked for
 * "some models to be on", and the alternative is a region with no models at
 * all. An empty directory still yields an empty result; the guard is only about
 * a selection that no longer matches anything.
 */
declare function deriveCatalog(catalog: readonly WorkBuddyModelInfo[], enabled: ReadonlySet<string>, budgets?: Readonly<Record<string, WorkBuddyContextBudget | undefined>>): WorkBuddyModelInfo[];
/**
 * Mutable catalog shared by the shim's `/v1/models` and the adapter.
 *
 * The static fallback exists so an OFFLINE upstream never leaves a provider
 * empty — but "offline" presumes the region is usable at all. A region with no
 * local sign-in cannot serve one single request, so seeding it with a roster
 * puts models in the picker that are guaranteed to 401 (issue #12). The host
 * distinguishes the two cases through {@link WorkBuddyCatalog.setRegionUsable}.
 */
declare class WorkBuddyCatalog {
  private models;
  /**
   * Whether this region has any local sign-in. Defaults to `true` — the
   * permissive direction — so a scan that has not run yet (or failed) keeps
   * serving the fallback rather than blanking a region that may be fine.
   */
  private usable;
  /**
   * Whether the user has switched this region's provider ON. Opt-out: defaults
   * to `true`, so a config predating this switch (and the pre-region-split flat
   * fields, which never carry `enabled`) keeps both providers running. Set to
   * `false` by `setRegionEnabled` to withdraw the region from DSH's model
   * picker entirely (its adapter route and configurable-provider entry are
   * pulled by the Host via `AdapterRegistrationHandle.replace([])` /
   * `DirectoryRegistrationHandle.replace([])`). This is a USER choice, distinct
   * from {@link usable}: a region the user switched off keeps its catalog,
   * accounts, and model picks intact and reappears the moment they re-check it.
   */
  private enabled;
  /**
   * @param region Seeds the static fallback for this region; each region's
   * provider must never serve the other region's roster before its first
   * live refresh lands.
   */
  constructor(region?: 'cn' | 'global');
  /**
   * Current entries; the fallback list until the upstream answer lands.
   *
   * Empty while this region has no local sign-in OR the user has switched it
   * off: the provider stays registered (its row still hosts the settings card
   * and the account picker), but it advertises nothing to pick. DSH drops empty
   * provider groups from the picker (`buildModelCatalog` filters
   * `models.length > 0`), so the group disappears exactly when it would be pure
   * noise. The two empty causes are independent: `usable` is the automatic
   * "no account" gate (issue #12), `enabled` is the user's explicit on/off.
   */
  current(): readonly WorkBuddyModelInfo[];
  /** Whether this region currently advertises any model. */
  isRegionUsable(): boolean;
  /** Whether the user has this region's provider switched on. */
  isRegionEnabled(): boolean;
  /**
   * Record whether this region has a local sign-in.
   *
   * Separate from {@link set} on purpose: `set()` carries a live upstream
   * answer and must never be empty, while "this region has no account" is a
   * legitimate empty state that must survive across refreshes. Keeping them
   * apart is what lets the non-empty guard stay strict.
   *
   * @returns whether the value changed, so the caller can skip invalidating
   *   its adapter snapshots when nothing moved.
   */
  setRegionUsable(usable: boolean): boolean;
  /**
   * Record the user's explicit on/off choice for this region's provider.
   *
   * Distinct from {@link setRegionUsable}: that is the automatic "no local
   * account" gate, while this is a deliberate user action (issue #11-style
   * region switch). The Host reads the same `enabled` flag through
   * `regionStateOf(config, region).enabled !== false`, so the two halves never
   * disagree. Returns whether the value changed.
   */
  setRegionEnabled(enabled: boolean): boolean;
  /** Replace the list; callers invalidate their adapter snapshot after this. */
  set(models: readonly WorkBuddyModelInfo[]): void;
}
//#endregion
//#region src/cli-bridge/mount.d.ts
/**
 * The `cliBridge` settings as they arrive from the config schema.
 *
 * Every field is optional because the schema may hand over a partial object, and
 * a user who edits only one key must not have to restate the rest.
 */
interface CliBridgeSettings {
  enabled?: boolean;
  binary?: string;
  model?: string;
  permissionMode?: string;
  effort?: string;
  maxTurns?: number;
  timeoutSecs?: number;
  regionOrder?: string;
  workingDir?: string;
  allowedDirs?: string;
  appendSystemPrompt?: string;
  allowUnattended?: boolean;
  maxReplyChars?: number;
  injectResult?: boolean;
  sessionContinuity?: string;
  maxTurnsPerSessionHour?: number;
  maxTurnsPerHour?: number;
}
//#endregion
//#region src/off-thinking.d.ts
/**
 * Ids observed to REFUSE `reasoning_effort: "off"` with HTTP 400 despite
 * declaring `canDisableThinking: true` (issue #34).
 *
 * Keyed by exact model id and deliberately NOT by region: `deepseek-v4.1-flash`
 * refuses on BOTH gateways, and the split tracks the model family rather than
 * the gateway. The cost is asymmetric — offering a level that always fails
 * costs the user every request for that model, while hiding one that would have
 * worked costs a single option — so the table errs towards hiding, and
 * {@link withEffectiveOff} enforces it as a HARD wall rather than a seed
 * (issue #83: a tick used to reopen the failing level, and with no
 * `reasoningEffort` passed the level became the default for compaction too).
 * See {@link offRefused} for why the checkbox must not win.
 *
 * `deepseek-v4-pro` was measured on the CN gateway only; it is listed because
 * its sibling does refuse on both, and the same asymmetry argues for hiding.
 */
declare const REFUSES_OFF_MODEL_IDS: ReadonlySet<string>;
/** The two fields this rule needs; both are declared by the model itself. */
interface WorkBuddyOffCapability {
  id: string;
  reasoning?: WorkBuddyReasoning;
}
/**
 * Whether `off` should be offered for a model when the user has expressed no
 * opinion: the upstream's declaration, minus the ids known to refuse it.
 *
 * Only an explicit `canDisableThinking: true` enables the level; absence is
 * "unknown" and stays unoffered, matching how the rest of the plugin treats an
 * undeclared capability.
 */
declare function offDefaultFor(info: WorkBuddyOffCapability): boolean;
/**
 * The model ids the `off` level should be offered for by default (issue #34).
 *
 * The user's checkbox is a plain set: ticked = offered, unticked = withdrawn.
 * This is the seed — what the set is filled with the first time it is read —
 * so a profile that has never saved shows the correct default immediately,
 * without requiring a save.
 *
 * Only an explicit `canDisableThinking: true` enables the level; absence is
 * "unknown" and stays unoffered, matching how the rest of the plugin treats an
 * undeclared capability.
 */
declare function defaultOffModelIds(models: readonly WorkBuddyOffCapability[]): string[];
/** One OBSERVED refusal of a reasoning tier, as the upstream reported it. */
interface WorkBuddyRefusalReport {
  /** The rejected parameter (`extError.param`), e.g. `reasoning_effort`. */
  param: string;
  /** The rejected value (`extError.value`), when the body carried one. */
  tier?: string;
  /** Upstream business code, e.g. 11133. */
  code?: number;
  /** Epoch milliseconds of the observation. */
  at: number;
  /**
   * The model the refused REQUEST named — not the account's route alias.
   *
   * Taken from the body (`modelIdOfBody`), so it is the concrete id the card
   * lists; the badge would otherwise never attach, since failover re-points the
   * body at whatever the serving account routes.
   */
  modelId?: string;
}
/**
 * Stamp the user's saved `off` selection onto a model list, for the RUNTIME
 * catalog.
 *
 * The runtime model descriptor is built by `workBuddyThinkingLevelMap`, which
 * reads only the model's own declaration — so the corrected answer has to be
 * written onto the model before it reaches the adapter. Doing it here keeps the
 * adapter a pure "declared capability in, level map out" function and keeps the
 * table next to the rule it feeds.
 *
 * This OVERWRITES the declared field rather than adding a sibling, which is
 * safe because the declared value has exactly one consumer (that same level
 * map) and is never persisted where the card can see it: `toWebModel` drops
 * `canDisableThinking`, and the card's `lastCatalog` is written from the raw
 * upstream discovery, never from this stamped list. A model that declares no
 * reasoning is returned untouched — there is no level to correct.
 *
 * A refusal-table id is stamped `false` REGARDLESS of the selection
 * ({@link offRefused}): the tick stays in the saved set — the card shows it and
 * the hint explains it — but it can no longer be turned into a request that
 * fails.
 */
declare function withEffectiveOff<T extends WorkBuddyOffCapability>(models: readonly T[], selection: ReadonlySet<string>): T[];
//#endregion
//#region src/shim.d.ts
/** Minimal logger surface the plugin context already provides. */
interface ShimLogger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
/** What the plugin needs from a running shim. */
interface WorkBuddyShim {
  /** Resolves once the listener is up; rejects if listening failed. */
  ready: Promise<void>;
  /** The shim origin, e.g. `http://127.0.0.1:39271`; valid after ready. */
  baseUrl(): string;
  /**
   * The per-process shared secret the plugin's own client must carry as
   * `Authorization: Bearer <token>`. Lives only in memory; the adapter
   * resolves this instead of the upstream access token, because the shim
   * resolves the real credential itself via the store.
   */
  token(): string;
  /** Stop serving and destroy open connections. */
  close(): Promise<void>;
}
/**
 * Supplies the credential to retry a failed chat request with.
 *
 * Called with every account id already tried for THIS request, the one that just
 * failed LAST, and resolves to the next candidate — or `undefined` when the pool
 * is off, empty, or exhausted, in which case the original failure is reported
 * unchanged.
 *
 * The plugin owns the policy (which pool members count as usable, in what
 * order); the shim owns only the retry loop and the wire-level rule that a
 * retry may happen before anything has been written to the client.
 */
type WorkBuddyFailoverAccount = (triedAccountIds: readonly string[]) => Promise<WorkBuddyCredential | undefined>;
/**
 * Why the pool had no candidate, asked only after failover came up empty.
 *
 * A separate callback rather than a richer return type on
 * {@link WorkBuddyFailoverAccount}: the loop calls that one on the HOT PATH of
 * every retry, and a policy that had to explain its refusal on every call would
 * make the common case pay for the rare one. This runs at most once per failed
 * request, and only when the answer is already going to be an error.
 *
 * Returns a short Chinese clause naming the reason (e.g. "池中其余账号都在冷却"),
 * or undefined when the host has nothing to add — in which case the reply says
 * only that no other account was available.
 */
type WorkBuddyFailoverShortfall = () => Promise<string | undefined>;
/** Constructor dependencies. */
interface WorkBuddyShimOptions {
  store: WorkBuddyCredentialStore;
  client: Pick<WorkBuddyUpstreamClient, 'chatStream'>;
  catalog: WorkBuddyCatalog;
  logger?: ShimLogger;
  /**
   * When to perturb scanned messages with invisible characters.
   *
   * `off` keeps the ordinary fail-then-rescue ladder; `failure` (the default)
   * remembers a successful rescue and starts later requests with it; `always`
   * starts every request with the dense rescue. `always` is for users whose
   * gateway has already made the plain attempt a guaranteed 11128 — it trades a
   * little prompt byte-level purity for avoiding that doomed round trip.
   */
  channelPerturbation?: 'off' | 'failure' | 'always';
  /**
   * Move the harness's injected `user` blocks above the real prompt (issue #132).
   *
   * The WorkBuddy usage page records the LAST `user` message as the request
   * text, and the harness appends its runtime context after the user's real
   * prompt — so the usage column shows injected noise instead of what was typed.
   * The reorder is order-only (every message and its text survive), and it only
   * ever moves messages that MATCH the harness's own injected prefixes; the single
   * textual edit is stripping the recorded prompt's own leading marker.
   *
   * Default false: it changes bytes the upstream counts, so it is opt-in.
   */
  keepPromptLast?: boolean;
  /**
   * Extra literal prefixes (issue #133) treated like the harness's injected
   * markers under `keepPromptLast`, for context blocks a companion plugin
   * injects that the built-in list does not know about. Only read when
   * `keepPromptLast` is on.
   */
  extraInjectedPrefixes?: readonly string[];
  /**
   * Move the host's session-title request onto the hidden lightweight model
   * (issues #132/#133). Disabled by default; when enabled, a body recognized
   * as the one-message title prompt is re-pointed at `model` (default
   * `wb-lite`, measured 0 credits) instead of billing the main paid model.
   * See `rewriteSessionTitleModel` for the fail-closed detection rules.
   */
  sessionTitle?: {
    enabled?: boolean;
    model?: string;
  };
  /**
   * Pool failover for chat requests. Absent means no failover at all — the
   * pre-pool behaviour, where the selected account serves and its failure is
   * reported as-is.
   */
  failoverAccount?: WorkBuddyFailoverAccount;
  /**
   * Why the pool had no usable candidate, asked after failover found none.
   *
   * The failure path uses this to answer the question the user is actually left
   * with — "why did nothing else work?" — instead of only reporting that every
   * attempt failed. Without it the pool's own reasoning is invisible at exactly
   * the moment it matters, and "换个模型" reads as a guess rather than as the
   * conclusion of a search the plugin already performed.
   *
   * Optional, and its absence is a supported state: a host that does not supply
   * it produces the same reply as before this option existed.
   */
  failoverShortfall?: WorkBuddyFailoverShortfall;
  /**
   * Told about every refused request the plugin can attribute to a MODEL, right
   * before the failure is rendered (issue #83).
   *
   * Separate from the rendered reply because the caller that hit the refusal is
   * not always the user: compaction reads the failure as a boolean and shows
   * "could not produce a useful summary", so the one fact that explains it (this
   * model refuses `off`) never reaches any surface. This callback is how the
   * card learns it happened. Must not throw: a bookkeeping failure must never
   * replace the upstream's own failure.
   */
  reportRefusal?: (refusal: WorkBuddyRefusalReport) => void;
  /**
   * Called before the FIRST attempt of every chat request, so the plugin can
   * point the store at the account the pool's ranking says should serve.
   *
   * It exists because "who serves" and "who to retry with" are the same decision
   * made at two moments: the ranking picks the first account, and after a failure
   * picks the next one. The shim resolves the credential itself right after this
   * returns, so the ranking never has to produce a credential — which keeps
   * token REFRESH in one place (`store.resolve()`) instead of duplicating it on
   * a path that would silently send expired tokens.
   *
   * Absent means the store's own selection always serves.
   */
  prepareAccount?: () => Promise<void>;
  /**
   * Called for every attempt that failed upstream, before the next one is tried.
   *
   * Exists so the plugin can RECORD the failure as a measurement. The ranking
   * that picks the serving account reads the pool's STORED measurements, so
   * without this an account that just answered 429 still reads as untested — and
   * the next request picks it again and pays the same failed round trip before
   * failing over.
   *
   * Fired without awaiting: a slow write must never delay the retry the user is
   * waiting on, and the measurement only matters for LATER requests.
   */
  onAccountFailure?: (accountId: string, failure: {
    status: number;
    kind: UpstreamErrorKind;
    message: string;
    /**
     * The model that request asked for (issue #61).
     *
     * Carried because the failure is remembered against the ACCOUNT, and `6004`
     * is an account × model condition: without this the record cannot say which
     * model the measurement belongs to, so the card has to present a
     * single-model result as account-level availability.
     */
    modelId?: string;
  }) => void;
  /**
   * Called with the FINAL serialized body of every chat request, just before it
   * goes upstream (issue #59).
   *
   * It exists so the plugin can record what was actually sent without the shim
   * having to know where that record goes: the region belongs to whoever wires
   * this up, and the report is a plugin concern. The body handed over is the
   * post-`prepareChatBody` one, because THAT is what the upstream counts.
   *
   * Fired without awaiting: a request must never wait on a diagnostic. The
   * callee must treat the string as read-only.
   */
  onRequestBody?: (bodyJson: string) => void;
  /**
   * Called with the token counts the UPSTREAM reported for the request whose
   * body was just handed to {@link onRequestBody} (issue #59).
   *
   * `onRequestBody` records what we SENT; this records what the gateway
   * CHARGED. The issue cannot be settled with only one of them: a difference
   * between two captures is ambiguous until both sides are known, because
   * "the gateway counted the same bytes differently" and "the two bodies were
   * not the same" look identical from the sent side alone.
   *
   * May fire zero times (the upstream reported no `usage`, or the stream was
   * cut before its final frame) or more than once per body (a failover retry
   * reaches a second upstream). The callee is expected to keep the FIRST
   * real measurement, since that is the one the report's line belongs to.
   *
   * Fired without awaiting, and never allowed to fail the request.
   */
  onUpstreamUsage?: (usage: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
  }) => void;
}
/**
 * Start the loopback endpoint. Requests must carry the shim's shared secret;
 * the loopback bind alone is not a trust boundary.
 */
declare function createWorkBuddyShim(options: WorkBuddyShimOptions): WorkBuddyShim;
//#endregion
//#region src/pi-ai-runtime.d.ts
/**
 * Which `@earendil-works/pi-ai` copy THIS plugin actually resolves at runtime.
 *
 * WHY THIS EXISTS (issues #24 / #25 / #26). The plugin declares pi-ai as a
 * peer (`>=0.85.0 <0.88.0 || >=1.0.0-0 <2.0.0`), so the module it imports is
 * whatever the host environment provides — and the two generations consume
 * DIFFERENT context shapes:
 *
 * - 0.87 hands providers a normalized transcript: `{ messages: [ {role:
 *   'system', content, toolsAdded}, … ] }`. The system prompt and the tool
 *   declarations live ONLY on that leading system message; the top-level
 *   `systemPrompt` / `tools` fields are gone, and 0.87's api never reads them
 *   back.
 * - 0.85 expects `{ systemPrompt, tools, messages }` and has no branch for a
 *   `system` message inside `messages` at all: its token estimator crashes on
 *   one (issue #24), and its wire converter silently drops it.
 *
 * Which copy resolves is NOT predictable from the host version alone: a
 * nested 0.85.1 on disk shadows the host's 0.87.1 (the plugin author's own
 * symlinked checkout does exactly that), while a clean market install has no
 * local copy at all and resolves the host's (issue #26's reporter). The
 * adapter therefore gates on what THIS plugin resolves.
 *
 * HOW it is detected — deliberately WITHOUT importing pi-ai:
 * `import.meta.resolve` locates the entry file (executing nothing), the
 * package manifest sitting beside it names the version, and the generation is
 * decided from that version (0.87+ → modern). A static import would drag
 * pi-ai into the standalone `doctor` CLI, which must also run from market
 * installs where NO local pi-ai exists and the module is only provided inside
 * the DSH host — a static import there is a load-time crash. Resolution
 * itself does not need the module: the manifest version and the
 * `normalizeContext` feature (present from 0.87 on, not before) agree across
 * `0.87+` AND `1.x` — 1.x is 0.87's successor and keeps the same normalized
 * transcript, so the split is `>= 0.87` rather than "within 0.x".
 *
 * When resolution FAILS — the normal state of a market install probed outside
 * the host — there is no local copy, so inside DSH the host supplies pi-ai.
 * Every DSH host that normalizes contexts (0.2.0+, via 0.87.1) also supplies
 * 0.87.1, so the reported generation defaults to `modern` (pass-through).
 * That default is safe on older hosts too: they never normalize, and a native
 * 0.85-shaped context is an identity under BOTH branches of the adapter gate.
 *
 * `doctor` prints the resolved version and path so mixed-generation setups —
 * the silent kind that produced #24 and #26 — become visible on demand.
 *
 * @module dsh-connect-workbuddy/pi-ai-runtime
 */
/** The resolved pi-ai generation, by context-shape capability. */
type PiAiGeneration = 'modern' | 'legacy';
//#endregion
//#region src/context-rescue.d.ts
interface ContextRescue {
  /**
   * Fold history until the next request fits the given window.
   *
   * @param sessionId - session whose history should be folded.
   * @param window - context window of the route that just overflowed.
   * @returns whether any history was folded.
   */
  rescue(sessionId: string, window: number): Promise<boolean>;
}
//#endregion
//#region src/adapter.d.ts
declare const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider route this bundle owns for the international gateway. */
declare const WORKBUDDY_GLOBAL_PROVIDER = "workbuddy-global";
/** The provider id each region registers as. */
declare const WORKBUDDY_PROVIDERS: Readonly<Record<WorkBuddyRegion, string>>;
/** Region a provider route id belongs to. */
declare function regionOfProvider(provider: string): WorkBuddyRegion | undefined;
/** Human-readable provider name, shown in the DSH model picker. */
declare const WORKBUDDY_PROVIDER_DISPLAY_NAMES: Readonly<Record<WorkBuddyRegion, string>>;
/** Provider idle ceiling while one stream read is outstanding. */
declare const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Constructor dependencies. */
interface WorkBuddyAdapterOptions {
  shim: WorkBuddyShim;
  store: WorkBuddyCredentialStore;
  catalog: WorkBuddyCatalog;
  /** Provider route id this instance serves; defaults to the CN route. */
  provider?: string;
  /** pi-ai provider name and profile display name; defaults to the CN name. */
  displayName?: string;
  /**
   * Model identity stamped on every model this route serves; defaults to
   * {@link WORKBUDDY_MODEL_IDENTITY}. Tests override it to model a transcript
   * recorded by a host that still stamped per-region ids.
   *
   * It also decides the extra registry key this adapter publishes alongside
   * its route (issue #75) — see {@link modelIdentityKeysOf}, which is what
   * keeps an overridden stamp resolvable exactly like the production one.
   */
  modelIdentity?: string;
  /** Resolve the durable attachment service at request time, when present. */
  resolveAttachments?: () => AttachmentStore | undefined;
  /**
   * Resolve the host-side context-overflow rescue, when this host exposes one.
   * Omitted (or resolving to `undefined`) leaves the adapter exactly as it was:
   * a provider overflow is forwarded and the host's own recovery decides.
   */
  resolveContextRescue?: () => ContextRescue | undefined;
  /**
   * Override the pi-ai generation gate (see {@link piAiRuntimeInfo}); tests
   * inject both branches because this checkout only ever RESOLVES one of
   * them. Production callers leave it unset.
   */
  piAiGeneration?: PiAiGeneration;
  /**
   * Drop foreign thinking blocks pi-ai would publish as prose (issue #147).
   *
   * OFF by default, and read LIVE (a getter, not a boolean) so the switch takes
   * effect on the next request without reloading the plugin: turning it on
   * mid-session is the whole point — the user sees the working-notes turn,
   * flips the switch, and the next turn is answered normally.
   */
  dropForeignThinking?: () => boolean;
  /**
   * Told which foreign thinking blocks a request dropped, so the reply can name
   * the condition instead of leaving the user to conclude the model broke
   * (issue #147 asks for at least a visible hint). Called at most once per
   * request; failures are swallowed.
   */
  onForeignThinking?: (blocks: readonly ForeignThinkingBlock[]) => void;
}
/** What {@link createWorkBuddyAdapter} hands back. */
interface WorkBuddyAdapter {
  adapter: PiAiAdapter;
  /** Rebuild the adapter's provider snapshot; call after a catalog update. */
  invalidate: () => void;
}
declare const THINKING_LEVELS: readonly ["minimal", "low", "medium", "high", "xhigh", "max"];
type WorkBuddyThinkingLevel = typeof THINKING_LEVELS[number];
type WorkBuddyThinkingLevelMap = Partial<Record<'off' | WorkBuddyThinkingLevel, string | null>>;
/** pi-ai input modalities: images only when WorkBuddy advertises them. */
declare function workBuddyModelInput(info: WorkBuddyModelInfo): ('text' | 'image')[];
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
declare function workBuddyDisplayName(info: WorkBuddyModelInfo): string;
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
declare function workBuddyThinkingLevelMap(info: WorkBuddyModelInfo): WorkBuddyThinkingLevelMap | undefined;
/**
 * One foreign thinking block that pi-ai would publish as PROSE, and the reason it
 * would (issue #147).
 *
 * `variant` is not cosmetic: the two are handled by the same repair but they
 * mean different things, and the card explains them differently.
 *
 * - `flattened`: `stopReason` is a normal completion, so `transform-messages`
 *   turns the block into `{type:'text', text: thinking}` — the whole reasoning
 *   body lands in the visible answer.
 * - `dropped`: `stopReason` is `error`/`aborted`, so the entire message is
 *   skipped; nothing reaches the wire and nothing reaches the user. It is
 *   reported anyway, because it still costs context: the model's answer to
 *   "why did my last turn say nothing" is this line, and a caller cannot see it
 *   from the transcript.
 */
interface ForeignThinkingBlock {
  /** Index of the message in the context's `messages`. */
  messageIndex: number;
  /** Index of the block within that message's `content`. */
  blockIndex: number;
  /** How many characters of reasoning the block carried. */
  characters: number;
  /** Whether pi-ai would flatten it into prose or drop the whole message. */
  variant: 'flattened' | 'dropped';
}
/**
 * Assemble the adapter. The provider's `getModels` reads the live catalog,
 * and every model's `baseUrl` is re-resolved per read so the shim's
 * ephemeral port applies from the first snapshot after startup.
 */
declare function createWorkBuddyAdapter(options: WorkBuddyAdapterOptions): WorkBuddyAdapter;
//#endregion
//#region src/native-modality.d.ts
/**
 * Model-native multimodality, vendored from vendor documentation.
 *
 * The upstream catalog's `supportsImages` is the PLATFORM's image-input
 * declaration, not the model's native capability: on live data it is `true`
 * for 15/16 CN and 23/23 international models, including text-only ones. Using
 * it as the capability answer is a mistake this project already made once (see
 * `docs/DESIGN.md` 「图片输入」), and the sibling `workbuddy-manager` project hit
 * the same defect and fixed it the same way — a reviewed table keyed by exact
 * model id, with a source and a review date per entry.
 *
 * This snapshot is copied from that project's
 * `server/services/native_modalities.json` (all entries reviewed 2026-09-25).
 * The provenance — per-id source URL and evidence — is kept in
 * `docs/DESIGN.md` rather than here, because the build ships this module's
 * comments verbatim into the browser bundle. Keep the two in sync when either
 * side is updated; this is a maintained snapshot, NOT a live read.
 *
 * Only two states are vendored because only two are ever confirmed: an id is
 * either documented `multimodal` or documented `text`. Everything else —
 * including brand-new models — is `unknown` and MUST stay unclassified rather
 * than inheriting a neighbour's answer or the platform flag.
 *
 * @module dsh-connect-workbuddy/native-modality
 */
/** Documented native input modality for one exact model id. */
type WorkBuddyNativeModality = 'text' | 'multimodal' | 'router' | 'unknown';
/**
 * Reviewed vendor classifications, keyed by EXACT model id (never a prefix).
 * Ids absent from this record are `unknown` — see {@link nativeModalityOf}.
 */
declare const NATIVE_MODALITY_BY_MODEL_ID: Readonly<Record<string, 'text' | 'multimodal'>>;
/**
 * Native modality of one model id. Exact match only: a new model never
 * inherits a classification from its family, its display name, or the
 * platform's image flag.
 */
declare function nativeModalityOf(modelId: string): WorkBuddyNativeModality;
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
declare function imageDefaultFor(info: {
  id: string;
  supportsImages?: boolean;
}): boolean;
//#endregion
//#region src/at-rest.d.ts
/**
 * WorkBuddy desktop "at-rest" credential decryption.
 *
 * From 5.6.0 the WorkBuddy desktop app no longer stores `auth.accessToken` /
 * `auth.refreshToken` as plain strings. It writes a field wrapper:
 *
 *   { "$wbEncrypted": 1, "envelope": "<base64 of a JSON envelope>" }
 *
 * where the envelope is `{suite, keyId, nonce, authTag, ciphertext}` for
 * AES-256-GCM with a 12-byte nonce and a 16-byte tag. The authenticated
 * additional data is a length-prefixed transcript over the scheme, suite,
 * keyId and framing, so the ciphertext can only be opened for the exact field
 * shape it was sealed for.
 *
 * The field key itself is NOT a user secret: it is a build-time constant
 * compiled into the app's own Electron native module
 * (`electron_browser_workbuddy_storage`). The app fetches it through
 * `loggerGet()` and hashes the returned base64 STRING (not the decoded bytes)
 * to obtain the 32-byte key; `keyId` is the first 16 hex characters of that
 * key's SHA-256.
 *
 * This module re-derives the same key by asking the installed app for the same
 * payload, and caches it in memory for the process lifetime. Nothing is ever
 * written to disk, and the payload is never logged.
 *
 * 改动：**「macOS 也加密」这一事实**（issue #15 真机取证）。本模块原先假设该
 *   policy 是 Windows 先行、macOS 只是「将来可能」，于是 macOS 的可执行文件
 *   路径用 App 名拼成 `<bundle>/Contents/MacOS/WorkBuddy`——而两个真实 bundle
 *   的 `CFBundleExecutable` 都是 `Electron`，该路径并不存在。结果是 macOS 上
 *   加密凭据**永远**取不到密钥，用户却被报成「未登录」。现在二进制名向 bundle
 *   自己问（`macosBundleExecutable()`），候选含国际版 `WorkBuddy AI.app`，
 *   并允许 App 被归入 applications 目录的子目录——扫到的候选必须先用
 *   `CFBundleIdentifier` 确认身份才 `execFile`，因为**每个 Electron 应用的
 *   二进制都叫 `Electron`**，只按名字匹配就可能启动另一个产品。
 *
 * @module dsh-connect-workbuddy/at-rest
 */
/** A `{$wbEncrypted:1,envelope}` field wrapper, the only shape this module opens. */
interface WorkBuddyEncryptedField {
  $wbEncrypted: 1;
  envelope: string;
}
/** Env override pointing at the WorkBuddy desktop executable. */
declare const WORKBUDDY_APP_EXECUTABLE_ENV = "WORKBUDDY_APP_EXECUTABLE";
/** Whether a value is the app's encrypted-field wrapper. */
declare function isEncryptedFieldWrapper(value: unknown): value is WorkBuddyEncryptedField;
/**
 * The at-rest key id for a derived 32-byte key: the first 16 hex characters of
 * its SHA-256. This is what the envelope's `keyId` is checked against, so a
 * mismatched key fails loudly instead of returning garbage.
 */
declare function deriveAtRestKeyId(key: Buffer): string;
/**
 * Derive the 32-byte field key from the app's key payload JSON.
 *
 * The app hashes the payload's base64 STRING — not its decoded bytes — so the
 * same spelling is required here; hashing the decoded secret would produce a
 * different key and every field would fail to open.
 */
declare function deriveAtRestKey(payloadJson: string): Buffer;
/**
 * Open one encrypted field with a derived key and return its plaintext.
 *
 * Throws when the envelope is malformed, belongs to another key, or fails
 * authentication — a GCM tag mismatch is the signal that the transcript or the
 * key is wrong, and it must never degrade into a truncated token.
 */
declare function openEncryptedField(field: WorkBuddyEncryptedField, key: Buffer): string;
/**
 * The executable inside a macOS app bundle, read from the bundle's own
 * `Info.plist`.
 *
 * The binary is NOT reliably named after the app: the WorkBuddy bundles ship
 * with `CFBundleExecutable` set to `Electron`, so a path assembled as
 * `<bundle>/Contents/MacOS/WorkBuddy` does not exist and the app looks absent
 * even when it is installed in the default location. Because the bundle
 * documents the real name, asking it is both correct and robust to a future
 * build that renames the binary.
 *
 * Returns undefined when the plist is absent, unreadable, or carries no usable
 * name — never a guessed path, so a caller can keep probing.
 */
declare function macosBundleExecutable(bundle: string): string | undefined;
/**
 * Candidate paths of the WorkBuddy desktop executable, in probe order.
 *
 * The Windows build is the one that encrypts credentials, so Windows leads;
 * the macOS bundles are listed because the same native module ships there and
 * the encryption policy is enabled on macOS builds too (observed from 5.6.x),
 * and `undefined` entries (an unset env variable) are dropped.
 *
 * On macOS the executable name comes from each bundle (see
 * {@link macosBundleExecutable}) rather than being assembled from the app name.
 *
 * `readBundleExecutable` is injectable, in the same spirit as `platform`/`home`/
 * `env`: the macOS branch consults the real filesystem, so without a seam the
 * expected candidates would depend on whether the host machine happens to have
 * the app installed — and the test would pass on a developer's Mac while
 * failing in CI.
 */
declare function workbuddyAppExecutableCandidates(platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv, readBundleExecutable?: (bundle: string) => string | undefined): string[];
/**
 * Whether a bundle identifies itself as the WorkBuddy desktop app.
 *
 * The match is on dot boundaries, so a hypothetical `com.workbuddyish` cannot
 * pass as `com.workbuddy`.
 *
 * An unreadable or identifier-less plist is treated as NOT WorkBuddy: refusing
 * a candidate only costs a fallback to another path, whereas accepting the
 * wrong one would execute an unrelated application.
 */
declare function isWorkbuddyBundle(bundle: string): boolean;
/**
 * Bundles of the desktop app found one level BELOW a macOS applications
 * directory.
 *
 * Users do file apps into subfolders (`/Applications/IDE/WorkBuddy.app`), and
 * a hardcoded `/Applications/<name>` then reports the app as missing while it
 * is installed and signed in. The scan is deliberately ONE level deep and
 * matches the known bundle names only, so it stays predictable and cheap; each
 * candidate is then confirmed by {@link isWorkbuddyBundle} before use.
 *
 * Returns [] when the parent is absent or unreadable — a missing directory is
 * the normal case, not an error.
 */
declare function macosNestedAppBundles(parent: string): string[];
/**
 * The first candidate that exists as a file, or undefined when the desktop app
 * is not installed where this platform expects it.
 */
declare function findWorkbuddyAppExecutable(platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv, readRegistryAppPath?: () => string | undefined): string | undefined;
/**
 * Ask the installed desktop app for its key payload by running its own binary
 * as plain Node (`ELECTRON_RUN_AS_NODE`) and calling the native binding.
 *
 * The binding is the app's own public surface for this value, so the plugin
 * never has to carry a copy of a build-specific constant: it asks the very
 * build that wrote the file. The child is given no stdin and a hard timeout,
 * and its stdout is the only thing read.
 */
declare function fetchAtRestKeyPayload(executable: string): Promise<string>;
/**
 * The desktop app's at-rest field key, or undefined when it cannot be obtained
 * (app not installed, an older build without the native module, or a future
 * build that rotates the payload).
 *
 * Both outcomes are cached: a success for the process lifetime (the app is
 * spawned at most once), a failure for {@link AT_REST_KEY_FAILURE_TTL_MS}. The
 * failure TTL is what keeps a machine WITHOUT the app from paying the
 * synchronous registry probe on every credential file — see {@link failedKeyAtMs}.
 */
declare function readAtRestKey(): Promise<Buffer | undefined>;
/** Drop the cached key; tests and diagnostics only. */
declare function clearAtRestKeyCache(): void;
//#endregion
//#region src/credential-recovery.d.ts
/** What the user can do about a refused credential. */
interface WorkBuddyCredentialRecovery {
  /**
   * Another local account answered the upstream during this recovery, so
   * switching to it is a fix that has been verified — not a guess.
   */
  usableAccount?: {
    accountId: string;
    accountName: string;
  };
  /**
   * Whether signing in again is the only remaining fix: no other local account
   * exists at all, so there is nothing to switch to.
   */
  reloginRequired: boolean;
}
/** One account as the recovery path needs to see it. */
interface WorkBuddyRecoveryCandidate {
  id: string;
  accountName: string;
}
/** Reads one account's credential for probing, without changing the selection. */
interface WorkBuddyProbeStore {
  accounts(): Promise<readonly WorkBuddyRecoveryCandidate[]>;
  credentialFor(accountId: string): Promise<WorkBuddyCredential | undefined>;
}
/** Constructor options for {@link createAccountUsabilityProbe}. */
interface WorkBuddyUsabilityProbeOptions {
  /** The credential store for one region (its selection is never touched). */
  store(region: WorkBuddyRegion): WorkBuddyProbeStore;
  /** The upstream client; only its cheap read-only calls are used. */
  client: Pick<WorkBuddyUpstreamClient, 'fetchCheckinStatus'>;
  /**
   * How long a probe verdict is reused. The card polls the usage route, so
   * without this a broken selection would re-probe every account on every poll.
   */
  ttlMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}
/**
 * Cached "is this account still accepted upstream?" probe.
 *
 * The cache key includes the credential's own `lastRefreshAtMs`, so a fresh
 * sign-in (which rewrites the file's issuance time) invalidates a stale verdict
 * automatically — a rejection recorded before the user signed in again cannot
 * keep labelling the account unusable afterwards, and no explicit invalidation
 * is needed.
 */
declare function createAccountUsabilityProbe(options: WorkBuddyUsabilityProbeOptions): (region: WorkBuddyRegion, account: WorkBuddyRecoveryCandidate) => Promise<boolean>;
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
declare function resolveCredentialRecovery(options: {
  region: WorkBuddyRegion;
  store: WorkBuddyProbeStore;
  rejectedAccountId?: string;
  /** Verifies whether one account is still accepted; see the probe factory. */
  probe: (region: WorkBuddyRegion, account: WorkBuddyRecoveryCandidate) => Promise<boolean>;
}): Promise<WorkBuddyCredentialRecovery>;
//#endregion
//#region src/host-heartbeat.d.ts
/**
 * Host-side heartbeat: a small JSON file written under `$DSH_HOME` once the
 * `workbuddy` provider is registered. The status CLI reads it to report
 * whether the host bundle is alive, independent of the browser card.
 *
 * 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
 *   — 该机制由其设计：浏览器端无法写文件，其健康只能靠 console.error 上报，
 *     因此由宿主写心跳文件，缺失即代表宿主从未启动；崩溃后的陈旧心跳
 *     通过 PID 存活检查识别。
 * 改动：无。机制本身已完备，原样沿用。
 *
 * @module dsh-connect-workbuddy/host-heartbeat
 */
/** Basename of the host heartbeat file inside the Harness home. */
declare const WORKBUDDY_HOST_HEARTBEAT_FILENAME = ".workbuddy-host-heartbeat.json";
/** Current on-disk heartbeat format; readers reject others. */
declare const HEARTBEAT_FORMAT_VERSION = 1;
/** On-disk shape of the heartbeat. */
interface WorkBuddyHostHeartbeat {
  version: typeof HEARTBEAT_FORMAT_VERSION;
  package: 'dsh-connect-workbuddy';
  pluginVersion: string;
  /** Epoch milliseconds when the host registered the provider. */
  registeredAt: number;
  /** Host process PID, to distinguish a stale heartbeat after a crash. */
  pid: number;
}
/** Absolute path of the host heartbeat file. */
declare function workbuddyHostHeartbeatPath(): string;
/**
 * Process start time in epoch milliseconds; undefined when unavailable.
 *
 * POSIX reads `ps -o lstart=`; Windows has no such command, so the creation
 * time is taken from PowerShell's `Get-Process` StartTime, emitted as UTC ISO
 * 8601 so `Date.parse` understands it without locale assumptions. Absent or
 * unqueryable processes (other users' processes) degrade to undefined.
 */
declare function processStartTimeMs(pid: number): number | undefined;
/**
 * Whether the recorded host process still matches the heartbeat's PID.
 *
 * A PID can be reused after a crash, so the recorded start time is compared
 * against the live process: a different start time means a different process.
 */
declare function isHeartbeatProcessAlive(heartbeat: WorkBuddyHostHeartbeat): boolean;
/** Read the heartbeat; absent or unparsable files report undefined. */
declare function readHostHeartbeat(): Promise<WorkBuddyHostHeartbeat | undefined>;
/** Write the heartbeat for the current process. */
declare function writeHostHeartbeat(): Promise<void>;
/** Remove the heartbeat; called when the plugin is disposed. */
declare function clearHostHeartbeat(): Promise<void>;
//#endregion
//#region src/version.d.ts
/**
 * Package version, injected at build time by `tsdown.config.ts`.
 *
 * 参考：corrinehu/dsh-workbuddy-connect（MIT）— 版本由构建期 define 注入，
 *   而非运行时读 package.json（发布包只含 lib/，不含 package.json 的
 *   可解析路径）。沿用该做法。
 *
 * @module dsh-connect-workbuddy/version
 */
/** The npm package version this build was produced from. */
declare const WORKBUDDY_CONNECT_VERSION: string;
//#endregion
//#region src/probe.d.ts
/**
 * The system message every probe carries.
 *
 * Not decoration: the international gateway rejects a conversation that does not
 * start with a system message (see the module note). A probe that omitted it
 * would report every global model as broken.
 */
declare const PROBE_SYSTEM_PROMPT = "You are a connectivity check. Reply with a single word.";
/**
 * Output cap for a probe. One token is enough to prove the model answers.
 *
 * The probe's cost comes from its INPUT, not its output (see
 * {@link DEFAULT_PROBE_INPUT_TOKENS}), so paying for a long completion would add money
 * without adding signal.
 */
declare const PROBE_MAX_TOKENS = 1;
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
declare const DEFAULT_PROBE_INPUT_TOKENS = 25000;
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
declare const PROBE_INPUT_TOKEN_CHOICES: readonly number[];
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
declare function probeRequestBody(modelId: string, inputTokens?: number): string;
/**
 * How one probe ended.
 *
 * `rate-limited` is split out from a generic failure because it is the one
 * outcome the feature exists for: it means "this model works, but not right
 * now". Everything else is a real, actionable failure or a success.
 *
 * `model-busy` is a second such split, and it is NOT cosmetic — see
 * {@link MODEL_BUSY_COOLDOWN_MS} and `exclusionOf`. A 14003 says the MODEL is
 * loaded, everywhere, for everyone; a 6004 says THIS ACCOUNT exceeded a volume
 * limit. Reporting both as `rate-limited` made the pool bench every account for
 * the cooldown of one, which is the outage issue #56 describes.
 *
 * `channel-rejected` is a third split, and it is the one that answers the
 * question the probe itself raises: the probe's own system prompt is a neutral
 * one-liner, so it can return `ok` on a model whose real chat requests are all
 * refused with `11128`. Filing that as `failed` (the generic bucket) made the
 * pair "test passes, chat fails, every account" look like a flaky upstream
 * instead of what it is — the gateway objecting to the PROMPT, not the account
 * (issues #87–#90).
 */
type WorkBuddyProbeOutcome = 'ok' | 'rate-limited' | 'model-busy' | 'out-of-credit' | 'credential-rejected' | 'policy-rejected' |
/**
 * The upstream restricted this credential for unusual activity (issue #127).
 *
 * Split from `policy-rejected` because the pool's response differs: this is
 * an account-level exclusion, while a content-policy refusal is about the
 * request and must not teach the pool that the credential is unusable.
 */
'account-restricted' | 'channel-rejected' | 'unavailable' | 'not-found' | 'failed';
/**
 * One probe result, as the card renders it.
 *
 * `retryAtMs` is present ONLY when the upstream actually stated a time (a
 * `Retry-After` header, or the region's quota refresh point when the failure is
 * an exhausted quota). Its absence is meaningful and must be rendered as "the
 * upstream did not say", never as a locally invented countdown.
 */
interface WorkBuddyProbeResult {
  modelId: string;
  outcome: WorkBuddyProbeOutcome;
  /** Round-trip time in ms, for a successful probe. */
  elapsedMs?: number;
  /** HTTP status the upstream answered with; 0 means the request never landed. */
  status?: number;
  /** Upstream's own words, redacted. Present on failures. */
  message?: string;
  /** A time the upstream named, in ms. Absent when it named none. */
  retryAtMs?: number;
  /**
   * Where a supplied `retryAtMs` came from, so the card can say so.
   *
   * `upstream-tips` is the odd one and it says exactly what it is: the upstream
   * stated a MAGNITUDE in prose ("wait about a minute") rather than a timestamp,
   * and this build turned it into {@link MODEL_BUSY_COOLDOWN_MS}. Naming it
   * separately keeps the card honest — the other three sources are the upstream
   * giving a time, this one is the upstream giving an order of magnitude.
   */
  retrySource?: 'retry-after' | 'upstream-message' | 'quota-refresh' | 'upstream-tips';
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
declare function parseRetryAfter(value: string | null, nowMs: number): number | undefined;
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
declare function cooldownOf(input: {
  outcome: WorkBuddyProbeOutcome;
  retryAfter: string | null;
  nowMs: number;
  /** The upstream's own failure text, where a reset sentence may live. */
  body?: string;
  /** The region's next monthly quota refresh, when the upstream declares one. */
  quotaRefreshAtMs?: number;
}): Pick<WorkBuddyProbeResult, 'retryAtMs' | 'retrySource'>;
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
declare function outcomeOfFailure(status: number, body: string): WorkBuddyProbeOutcome;
/**
 * Read the credit this probe consumed out of an SSE stream, when the upstream
 * reports it.
 *
 * Purely informational — the card shows it so a user can see how little a probe
 * actually costs rather than having to trust a claim. Absent when the stream
 * carried no `usage` block.
 */
declare function creditOfStream(text: string): number | undefined;
/** Whether a probe outcome means the model answered. */
declare function probeSucceeded(outcome: WorkBuddyProbeOutcome): boolean;
/** What one probe needs from the upstream client. */
interface WorkBuddyProbeClient {
  probeChat(credential: WorkBuddyCredential, bodyJson: string, signal?: AbortSignal): Promise<{
    ok: boolean;
    status: number;
    retryAfter: string | null;
    body?: string;
    response?: Response;
  }>;
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
declare function probeModel(input: {
  client: WorkBuddyProbeClient;
  credential: WorkBuddyCredential;
  modelId: string;
  nowMs: number;
  /**
   * How much input this probe sends, in tokens.
   *
   * Omitted means {@link DEFAULT_PROBE_INPUT_TOKENS}, so every existing caller
   * keeps the measured 25k and only the pool's user-facing "test" passes a
   * chosen size through.
   */
  inputTokens?: number;
  /** The region's next monthly quota refresh, when known. */
  quotaRefreshAtMs?: number;
  signal?: AbortSignal;
}): Promise<WorkBuddyProbeResult>;
//#endregion
//#region src/benefits.d.ts
/** What the account card shows for one campaign. */
type WorkBuddyBenefitState =
/** Offered, inside its window, not taken yet. The only state with a claim button. */
'claimable' |
/** This account already took it. Rendered as nothing at all. */
'claimed' |
/** The window is over and it was never taken — the offer is gone. */
'expired';
/** One campaign, resolved for display. */
interface WorkBuddyBenefitView {
  kind: WorkBuddyBenefit['kind'];
  state: WorkBuddyBenefitState;
  /** Credits on offer, as the gateway stated them. */
  creditNum: number;
  /** Window end, epoch ms. */
  endsAtMs?: number;
  /** Whole days until the window closes, floored at 0. Absent without `endsAtMs`. */
  daysLeft?: number;
  /** True while the window closes within {@link URGENT_DAYS} days. */
  urgent: boolean;
}
//#endregion
//#region src/account-pool.d.ts
/**
 * Which of the pool's writers produced a measurement.
 *
 * `test-batch` — the user pressed "test" (or the check-in batch), so the
 *   outcome is a deliberate measurement of the target model.
 * `live-request` — a real chat request failed and its failure was recorded so
 *   the NEXT request starts from a measurement instead of rediscovering the
 *   same wall.
 *
 * The distinction is diagnostic, not behavioural: both feed the same routing
 * and cooling logic. It exists so a user who watched an account measure `ok`
 * and later saw it limited can tell whether that was a later live failure
 * (expected) or an older value winning (a bug).
 */
type WorkBuddyPoolProbeSource = 'test-batch' | 'live-request';
/** One account's pool entry: what the picker needs, plus its last measurement. */
interface WorkBuddyPoolAccount {
  /** Stable account id (the same one `WorkBuddyAccountChoice` carries). */
  id: string;
  /** Human name, or `''` when the desktop app recorded none. */
  accountName: string;
  /**
   * This account belongs to an enterprise/education tenant (issue #124/#129).
   *
   * A projection fact, carried from the credential's `enterpriseId` rather than
   * inferred from any benefit or check-in response: upstream can advertise
   * campaigns and `active:false` for enterprise members while refusing every
   * write with `10001`.
   */
  enterprise?: boolean;
}
/**
 * What the pool knows about ONE account's last test of the target model.
 *
 * `undefined` means "never tested", which is deliberately distinct from every
 * measured outcome: an untested account is a candidate (the user may want to
 * use it now) whereas a measured failure is not. Collapsing the two would make
 * a fresh pool look empty until the first timer tick.
 */
interface WorkBuddyPoolProbe {
  outcome: WorkBuddyProbeOutcome;
  /** When this measurement was taken, in epoch ms. */
  atMs: number;
  /**
   * WHAT WROTE THIS MEASUREMENT.
   *
   * Two sites write probes for the same account, and before this field they
   * were indistinguishable in the file — which made a real confusion
   * unanswerable: the user presses "test", sees an account measured `ok`, and
   * later finds it `rate-limited`. Nothing in the record said whether that was
   * a NEWER measurement (a live request really did hit the limit) or an OLDER
   * one somehow winning, and the file keeps no history to tell them apart.
   *
   * With the source recorded, that question has an answer on sight: a
   * `live-request` entry that replaced a `test-batch` result is the pool
   * working as designed (a live failure steers the next request away from the
   * account); two entries of the SAME source with the OLDER one winning would
   * be a genuine bug.
   *
   * ABSENT for any measurement written before this field existed, so old probe
   * files stay readable — an absent source means "unknown", never a guess.
   */
  source?: WorkBuddyPoolProbeSource;
  /**
   * When this account may be usable again, when the upstream stated a time.
   *
   * Present for a `rate-limited` outcome whose failure body carried a reset
   * sentence, and for an `out-of-credit` outcome with a known quota refresh.
   * ABSENT when the upstream named no time — that absence is meaningful and
   * must never be turned into a locally invented countdown.
   */
  retryAtMs?: number;
  /**
   * The upstream's own words on the failure, already redacted.
   *
   * Kept so the card can say WHY an account left the pool instead of repeating
   * one generic sentence for a DNS failure, a gateway 502 and a request the user
   * cancelled alike. Those three used to render as the SAME line, which left the
   * user with a message they could not act on and no way to tell a broken
   * account from a broken network.
   *
   * ABSENT for a success, and for any measurement written before this field
   * existed: an `outcome` without a `message` is a complete, valid record, so
   * old probe files stay readable rather than being discarded.
   */
  message?: string;
  /**
   * WHICH MODEL this measurement is about (issue #61).
   *
   * The pool's "test all accounts" action probes ONE model — the region's
   * `targetModelId` — while `6004` is an ACCOUNT × MODEL condition: the reporter
   * measured two accounts where `hy4-preview-f` answered and `step-5-preview`
   * returned `429 / 6004` at the same moment. A row rendered as plain "可用"
   * therefore claims more than the measurement says, and the pool's own routing
   * reads that `ok` as an account-level fact.
   *
   * Storing the model id is what makes the claim checkable: the card can say
   * WHICH model an `ok` came from, and a reader can see that a different model
   * was never tested at all. `probeModel()` has always returned this field; the
   * write simply dropped it.
   *
   * Deliberately NOT inherited by {@link mergePoolProbe} when an update omits it
   * — the opposite of `accountName` and `retryAtMs`. Those two describe the
   * ACCOUNT (a name that a later writer could not see is still true, and a
   * future refresh time is still in the future), whereas the model describes
   * THIS measurement. Carrying an older model id forward would relabel a fresh
   * measurement with a model it was not taken on, which is exactly the confusion
   * this field exists to end. ABSENT therefore means "unknown scope", never a
   * guess.
   */
  modelId?: string;
  /**
   * The account's display name AT THE MOMENT IT WAS MEASURED (issue #60).
   *
   * Stored because a saved pool member can outlive its sign-in. Once the
   * desktop app drops a login, that id resolves to no listed account, so the
   * card has nothing left to render for it — and the old warning ("1 saved
   * account is no longer signed in") was a count with no subject, leaving the
   * user unable to tell WHICH account had gone. The name was in hand at write
   * time (both writers already carry it) and nowhere afterwards, so the record
   * is the only place it can survive.
   *
   * ABSENT on records written before this field existed, and when the desktop
   * app recorded no name: the card then falls back to a short id prefix rather
   * than inventing a label. Snapshots are never refreshed from a LISTING — only
   * a real measurement writes this, so a stale name cannot be "confirmed" by a
   * routine scan that never saw the account.
   */
  accountName?: string;
}
/** One account's live credit situation, as the pool ranks it. */
interface WorkBuddyPoolCredits {
  total: number;
  /** Credits expiring within the card's "soon" window (3 days). */
  expiringSoon: number;
  /** When the nearest package expires, if any does. */
  nearestExpiryMs?: number;
}
/**
 * Everything the ranking rule reads about one account. Assembled by the Host
 * from the credential store, the credits route, and the runtime probe store —
 * this module only consumes it.
 */
interface WorkBuddyPoolMember {
  account: WorkBuddyPoolAccount;
  credits?: WorkBuddyPoolCredits;
  probe?: WorkBuddyPoolProbe;
  /** When the stored credential expires, used as the final tie-break. */
  tokenExpiresAtMs?: number;
}
//#endregion
//#region src/account-pool-run.d.ts
/** One account's check-in outcome. */
interface WorkBuddyPoolCheckinRow {
  accountId: string;
  accountName: string;
  status: 'claimed' | 'already' | 'failed' | 'skipped';
  /** Credits gained, when the upstream stated a figure. */
  credit?: number;
  /** Streak length after the claim, when the upstream stated one. */
  streakDays?: number;
  /** The upstream's own words on failure, redacted by the caller. */
  message?: string;
}
/** One account's test outcome. */
interface WorkBuddyPoolTestRow {
  accountId: string;
  accountName: string;
  result: WorkBuddyProbeResult;
}
//#endregion
//#region src/status-paths.d.ts
/** Plugin-owned usage endpoint consumed by its browser half. */
declare const WORKBUDDY_USAGE_PATH = "/plugins/dsh-connect-workbuddy/usage";
/** Plugin-owned live model refresh endpoint. */
declare const WORKBUDDY_MODELS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/models/refresh";
/** Plugin-owned local account rescan endpoint. */
declare const WORKBUDDY_ACCOUNTS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/accounts/refresh";
/** Plugin-owned daily check-in action endpoint. */
declare const WORKBUDDY_CHECKIN_PATH = "/plugins/dsh-connect-workbuddy/checkin";
/**
 * Plugin-owned model probe endpoint.
 *
 * Sends one minimal chat request per named model so the card can answer "is
 * this model usable right now, and if it is limited, when can it be used
 * again?". Lives on the Host because the credential must never reach the
 * browser half.
 */
declare const WORKBUDDY_PROBE_PATH = "/plugins/dsh-connect-workbuddy/probe";
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
declare const WORKBUDDY_TPS_PATH = "/plugins/dsh-connect-workbuddy/tps";
/**
 * One entry of the transfer PREVIEW: display fields only, never token
 * material. `hasToken` is the import decision input — the import step skips
 * records without one — and the indexes are the FILE's positions, so the user
 * picks by the same numbers the import call sends back.
 */
interface WorkBuddyTransferPreviewEntry {
  index: number;
  uid: string;
  nickname: string;
  email: string;
  hasToken: boolean;
}
/** The preview answer: the desensitized listing plus the file's total count. */
interface WorkBuddyTransferPreview {
  accounts: readonly WorkBuddyTransferPreviewEntry[];
  total: number;
}
/**
 * The import answer. `imported` counts records merged into the vault (new OR
 * overwritten — both change the stored entry); `skipped` counts what was
 * left out: missing token, a bad index, or a record whose login domain does
 * not belong to the addressed region.
 */
interface WorkBuddyTransferImportAnswer {
  imported: number;
  skipped: number;
}
/**
 * The shared file format's record shape, subset the importer consumes.
 *
 * Contract with sibling tools exporting the same format: a JSON array of
 * objects keyed in snake_case — `access_token` (required), `refresh_token`,
 * `uid`, `nickname`, `email`, `domain`, `expiresAt` (epoch ms),
 * `refreshExpiresAt`, `auth_raw`. Extra fields ride along untouched.
 */
interface WorkBuddyTransferRecord {
  access_token: string;
  refresh_token?: string;
  uid?: string;
  nickname?: string;
  email?: string;
  domain?: string;
  /** Access-token expiry in epoch MILLISECONDS, the sibling format's unit. */
  expiresAt?: number;
  refreshExpiresAt?: number;
  /** The sibling tool's original credential document, preserved verbatim. */
  auth_raw?: unknown;
}
/** The export answer: the records themselves, tokens included. */
interface WorkBuddyTransferExportAnswer {
  accounts: WorkBuddyTransferRecord[];
}
/** Query parameter naming the region a card request addresses. */
declare const WORKBUDDY_REGION_PARAM = "region";
/** Every region, in card tab order. */
declare const WORKBUDDY_REGIONS: readonly WorkBuddyWebRegion[];
/**
 * Address one region's status route. The two regions are separate provider
 * stacks; every card request carries the region whose tab the user is on.
 */
declare function withWorkBuddyRegion(path: string, region: WorkBuddyWebRegion): string;
/**
 * Read the region parameter off a status-route URL. Absent means the domestic
 * tab (`cn`); a present-but-unknown value returns undefined so the route can
 * answer 400 instead of guessing.
 */
declare function regionOfStatusUrl(url: string): WorkBuddyWebRegion | undefined;
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
declare function regionsMapOf(value: unknown): Record<string, unknown>;
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
declare function regionsFieldIsCorrupt(value: unknown): boolean;
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
declare function regionEnabledOf(value: unknown, region: WorkBuddyWebRegion): boolean;
/** Build the next `regions` settings value for a signed-in tab's save. */
declare function nextRegionSlots<Slot extends object>(regions: unknown, region: WorkBuddyWebRegion, slot: Slot): Record<string, unknown>;
declare function nextRegionEnabled(value: unknown, region: WorkBuddyWebRegion, enabled: boolean): Record<string, unknown>;
/**
 * The two seats the credit readout can occupy (issue #62).
 *
 * `composer` is the composer tool row (`conversation.input.left`); `stats` is
 * the ambient dock below the composer card (`conversation.composer.dock`),
 * beside the shell's own round/step/token pills. Named as a union rather than a
 * boolean because a third seat is plausible and `showAtTop: boolean` would have
 * to be migrated rather than extended.
 */
type WorkBuddyCreditPosition = 'composer' | 'stats';
/** One credit package as the upstream returns it, node-free. */
interface WorkBuddyWebCreditPackage {
  packageName: string;
  /** Capacity-pool balance (`CapacityRemain`); see the host-side type for issue #48. */
  remain: number;
  size: number;
  /** CapacityType 4: refreshed every cycle and never expires. */
  monthly: boolean;
  /** Next cycle start (the monthly refresh point) in ms; only on monthly packages. */
  cycleRefreshMs?: number;
  /** One-off expiry in ms; the package disappears from the account then. */
  expiresAtMs?: number;
}
/** Aggregated credit answer rendered by the plugin card. */
interface WorkBuddyWebCredits {
  total: number;
  packages: readonly WorkBuddyWebCreditPackage[];
  /** Credits expiring within 3 days across every package. */
  expiringSoon: number;
  /** When the nearest package expires, in ms. */
  nearestExpiryMs?: number;
}
/** Daily check-in state rendered below total remaining credits. */
interface WorkBuddyWebCheckin {
  active: boolean;
  todayCheckedIn: boolean;
  streakDays: number;
  dailyCredit: number;
  todayCredit: number;
  isStreakDay: boolean;
  nextStreakDay: number;
  streakBonusDays: number;
  streakBonusCredit: number;
  claimButtonText?: string;
}
/**
 * What the user can do about a credential the upstream refused.
 *
 * Two different fixes hide behind one 401, and naming the wrong one is worse
 * than saying nothing: with a stale account SELECTED but a healthy sign-in
 * sitting right there, "sign in again" sends the user to re-authenticate — which
 * changes nothing, because the credentials were never the problem.
 */
interface WorkBuddyWebRecovery {
  /**
   * Another local account answered the upstream during recovery, so switching
   * to it is a VERIFIED fix rather than a suggestion.
   */
  usableAccount?: {
    accountId: string;
    accountName: string;
  };
  /**
   * Signing in again is the only remaining fix: this region has no other local
   * account to switch to. Set only in that case — never as a fallback for
   * "nothing could be verified".
   */
  reloginRequired: boolean;
}
/** Editable WorkBuddy model row rendered by the plugin-owned settings card. */
interface WorkBuddyWebModel {
  id: string;
  name: string;
  /** Effective DSH context after applying the saved local budget. */
  contextWindow: number;
  /**
   * Native maximum advertised by WorkBuddy, never clamped by a default.
   *
   * Models above 200K expose the tier selector (200K / 500K / max); whether the
   * window is actually reduced is the user's stored `contextBudgets` decision
   * and nothing else — see issue #33.
   */
  nativeContextWindow: number;
  maxTokens: number;
  creditMultiplier?: number;
  /**
   * The model's load level, as read from the upstream's own probe.
   *
   * Carried so the CARD can draw it as an ICON. The host's model picker cannot
   * (its name is a plain string), which is why the picker gets a character and
   * the card gets a picture.
   *
   * ABSENT means "not measured right now" and is NOT the same as `normal`: the
   * card must not draw a level the upstream never stated. It is deliberately
   * not persisted into `lastCatalog` — load is a fact about this minute.
   */
  busyLevel?: WorkBuddyBusyLevel;
  /**
   * Upstream's own image-input default from the latest refresh. Used ONLY to
   * pre-fill the image checkboxes when "Refresh from WorkBuddy" overwrites the
   * draft; it is not the effective capability. Persisted inside `lastCatalog`
   * (it rides along in the saved entries) but never read as the runtime flag —
   * that stays `imageModelIds` → stamped `multimodal`.
   */
  supportsImages?: boolean;
  multimodal?: boolean;
  reasoning?: {
    supportedEfforts?: readonly string[];
    defaultEffort?: string;
    /**
     * Upstream's own "thinking can be turned off" declaration, carried through
     * the card so it RIDES ALONG in the saved `lastCatalog` entry.
     *
     * It is a persistence detail, not the runtime answer: the adapter's level
     * map is built from the effective value stamped in `index.ts` (declaration
     * minus the models known to reject `off`, then the user's override). It has
     * to travel because the card writes the whole row back on save — omitting
     * it made one Save silently strip the declaration from every model, which
     * withdrew `off` from the models that accept it (the default is
     * conservative: an absent declaration never offers `off`, so `hy4-preview`
     * and friends keep their intended `false` but the rest lose a working
     * level). Same shape as `supportsImages` above.
     */
    canDisableThinking?: boolean;
    /**
     * This model is on the reviewed `off`-refusal table (`src/off-thinking.ts`),
     * so ticking its checkbox cannot take effect (issue #83).
     *
     * The verdict, derived on the host — not a stored preference, and not
     * something the card has to recompute. It exists so the card can explain a
     * tick that did not stick instead of leaving the user staring at a checkbox
     * that looks saved. Like every other `reasoning` field it rides along in
     * the saved `lastCatalog` entry, where it is ignored on load: the verdict is
     * always recomputed from `id`.
     */
    offRefused?: boolean;
    /**
     * A REQUEST really carried `reasoning_effort: "off"` for this model and the
     * upstream answered HTTP 400 / code 11133 (issue #83).
     *
     * Row-level, DERIVED on write from the last refusal's `modelIdOfBody` —
     * never typed in by hand. Merged rather than replaced when the saved
     * catalog is refreshed, so the badge survives the full-table overwrite a
     * model refresh performs.
     */
    refusesOff?: boolean;
  };
  description?: string;
  /**
   * The upstream's promotion / tier badges that name this model, UNRESOLVED.
   *
   * Every candidate that names the model rides along, in priority order, so
   * the card can pick the one that holds at the moment it draws — a badge is a
   * function of the clock, and a badge frozen at fetch time would keep
   * claiming a night discount after the night is over. See `src/promo.ts`.
   *
   * Persisted inside `lastCatalog` (it rides along in the saved entries) and
   * read back from there, which is why it must stay JSON-shaped.
   */
  promos?: readonly WorkBuddyPromo[];
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
declare function toPersistedWorkBuddyModel(model: WorkBuddyWebModel): Omit<WorkBuddyWebModel, 'nativeContextWindow' | 'multimodal'>;
/** One selectable local account, token-free. */
interface WorkBuddyWebAccount {
  id: string;
  /**
   * The account's human name, or `''` when the desktop app recorded none.
   * The card renders its own placeholder for the empty case.
   */
  accountName: string;
  domain: string;
  source: 'desktop' | 'dsh';
  tokenExpiresAtMs: number;
  selected: boolean;
  /**
   * This account belongs to an enterprise (issue #124).
   *
   * Its credits come from the enterprise table and its check-in is refused by
   * the upstream (`10001`), so the card must not offer the action for it. The
   * field is a FACT about the credential (`enterpriseId` is present), not a
   * guess from `status.active`: that reads `false` for every enterprise member.
   */
  enterprise?: boolean;
}
/**
 * One probed candidate path and why it yielded no account.
 *
 * Safe to send to the browser: a path, its source, and a cause. No token
 * material, and no content read out of the files beyond an error string.
 *
 * `encrypted` exists because WorkBuddy (unlike a plain JSON-token app) can
 * refuse a correctly signed-in user: Windows builds encrypt the token fields,
 * and opening them needs the desktop app present to hand over its at-rest key.
 * Telling that user to "sign in again" is wrong — they already are.
 *
 * `wrong-region` is the other WorkBuddy-specific one: the file holds a valid
 * sign-in for the OTHER tab's region, so this tab filters it out of the account
 * list. Without this entry the file was reported nowhere at all, which both
 * undercounted "paths checked" and hid the user's real sign-in.
 */
interface WorkBuddyWebSearchPath {
  path: string;
  source: 'desktop' | 'dsh';
  reason: 'missing' | 'unreadable' | 'invalid' | 'encrypted' | 'wrong-region';
  message?: string;
}
/**
 * Region of the signed-in credential: the CN app (`codebuddy.cn` /
 * `workbuddy.cn`) or the international WorkBuddy AI app (`workbuddy.ai`).
 * The card uses this to read and write the matching per-region model slot.
 */
type WorkBuddyWebRegion = 'cn' | 'global';
/** The JSON document the plugin card renders. */
type WorkBuddyWebUsage =
/**
 * Not usable right now. `accounts` is still populated so the picker can
 * offer a way out, and `selectionLost` separates the two very different
 * reasons this happens: local sign-ins exist but the SAVED choice no longer
 * matches any of them (re-select it, or clear it to follow the app's current
 * sign-in again), versus nothing usable was found at all (sign in in the
 * desktop app). Only the latter makes the "sign in again" hint truthful —
 * re-signing in does not repair an orphaned id.
 *
 * `selectionExplicit` answers a question the account list cannot: whether
 * the region runs a saved choice at all. Clearing restores the default, and
 * when the default resolves to the same account the card would otherwise
 * look unchanged — the "clear did nothing" report.
 */
{
  status: 'signed-out';
  accounts: readonly WorkBuddyWebAccount[];
  /** Whether this region's provider is currently offered to DSH. */
  enabled?: boolean;
  /**
   * Whether this region's sidebar credit line is shown.
   *
   * Carried on the Host's answer rather than read from the browser settings
   * mirror, for the same measured reason as `contextBudgets`: on the affected
   * 0.1.7 deployment the mirror never picks up this plugin's writes (a save
   * through the Host endpoint leaves it stale), so a control reading it kept
   * showing the old value and looked like it could not be turned off — the
   * "关闭不了" report.
   */
  showCreditsInMainUi?: boolean;
  /**
   * Whether the model may call the image-generation tool here (opt-in).
   *
   * Travels on the Host's answer for the same reason as the fields around it,
   * and matters more: a checkbox rendering a stale value would let the user
   * believe the spending capability was ON when it is off, or leave it on
   * after a switch-off that never landed.
   */
  imageToolEnabled?: boolean;
  /**
   * Whether the model may call the video-generation tool here (opt-in).
   * Same opt-IN travel semantics as `imageToolEnabled` — an absent value
   * is NOT consent, so a stale mirror cannot leave the spending capability on.
   */
  videoToolEnabled?: boolean;
  /**
   * The video model pinned per tag here (`text-to-video` /
   * `image-to-video`), as a model id from this region's catalog.
   *
   * Travels on the Host's answer for the same measured reason as the switches
   * above: the picker has to render the pin the TOOL will read, and the
   * browser settings mirror is stale for this namespace on the affected 0.1.7
   * deployments. Absent reads as "nothing pinned", never as a made-up id.
   */
  preferredVideoModels?: Readonly<Record<string, string>>;
  /**
   * Whether the OPTIONAL CodeBuddy CLI route is mounted (tool `codebuddy_ask`
   * + command `/codebuddy`).
   *
   * GLOBAL, not per region: the route has ONE switch for both regions, so the
   * same value rides on every region's answer and the card reads it off the
   * active tab. Absent reads as OFF — this switch authorizes a child process
   * that edits files and spends CodeBuddy quota, so a Host that cannot answer
   * must not be read as consent.
   */
  cliBridgeEnabled?: boolean;
  /**
   * The model the OPTIONAL CodeBuddy CLI route runs on, or `''` for
   * "nothing is pinned, the CLI uses its own default".
   *
   * GLOBAL like `cliBridgeEnabled`. Travels on the Host's answer for the
   * same measured reason: on the stale-mirror 0.1.7 deployment a picker that
   * read the settings mirror alone would keep showing a pin that had just
   * been cleared (or had not landed yet).
   */
  cliBridgeModel?: string;
  /**
   * The reasoning effort the OPTIONAL CodeBuddy CLI route runs on, or `''`
   * for "nothing is pinned, the CLI uses its own default".
   *
   * GLOBAL and Host-carried for the same reasons as `cliBridgeModel`.
   */
  cliBridgeEffort?: string;
  /**
   * The order the OPTIONAL CodeBuddy CLI route walks the credential
   * regions in — a comma-separated region list such as `'cn,global'` — or
   * `''` for "nothing is pinned, the CLI walks its own default order".
   *
   * GLOBAL and Host-carried for the same reasons as `cliBridgeModel`.
   */
  cliBridgeRegionOrder?: string;
  /**
   * Whether the request path drops foreign thinking blocks (issue #147).
   *
   * Optional and absent reads as OFF: the repair changes bytes the upstream
   * counts, so a Host that cannot answer must not be read as consent.
   */
  dropForeignThinking?: boolean;
  /**
   * What the LAST request had to drop, for the card's explanation of a turn
   * that arrived looking like working notes (issue #147).
   *
   * Absent means "no report", not "feature off" — the two are different facts
   * and the card says different things about them. Process-local and
   * last-wins: it describes the turn the reader is looking at.
   */
  lastForeignThinking?: {
    blocks: readonly {
      messageIndex: number;
      blockIndex: number;
      characters: number;
      variant: 'flattened' | 'dropped';
    }[];
    atMs: number;
  };
  /**
   * The LIVE load level per model id, for the card's icon.
   *
   * A SEPARATE field from `models`, because the card's model list is the
   * SAVED roster (the one the user edits) and a saved roster has no load
   * level in it. Absent means "not measured right now" — never "normal".
   */
  busyLevels?: Readonly<Record<string, WorkBuddyBusyLevel>>;
  /** WHERE this region's readout sits (issue #62); absent means `composer`. */
  creditPosition?: WorkBuddyCreditPosition;
  message?: string;
  /** The persisted account id matches no local account. */
  selectionLost?: boolean;
  /** A saved per-region choice is in effect (false = following the app). */
  selectionExplicit: boolean;
  /**
   * The paths this region's store probed, and why each yielded nothing.
   *
   * Present only on the "nothing was found at all" branch — it is the
   * explanation for a state that is otherwise a dead end. A missing candidate
   * (`missing`) is normal noise on any machine and the card filters those out
   * of its default view; the interesting ones are `unreadable`, `invalid`,
   * and especially `encrypted`.
   */
  searched?: readonly WorkBuddyWebSearchPath[];
} | {
  status: 'signed-in';
  accountId: string;
  /**
   * The account's human name, or `''` when the desktop app recorded none.
   * Never an identifier — see {@link WorkBuddyWebAccount.accountName}.
   */
  accountName: string;
  domain?: string;
  /** Which per-region model directory and selection this account owns. */
  region: WorkBuddyWebRegion;
  /** Whether this region's provider is currently offered to DSH. */
  enabled?: boolean;
  /**
   * Whether this region's sidebar credit line is shown. See the signed-out
   * variant for why this travels on the Host's answer instead of the browser
   * settings mirror.
   */
  showCreditsInMainUi?: boolean;
  /**
   * Whether the model may call the image-generation tool here (opt-in).
   *
   * Travels on the Host's answer for the same reason as the fields around it,
   * and matters more: a checkbox rendering a stale value would let the user
   * believe the spending capability was ON when it is off, or leave it on
   * after a switch-off that never landed.
   */
  imageToolEnabled?: boolean;
  /**
   * Whether the model may call the video-generation tool here (opt-in).
   * Same opt-IN travel semantics as `imageToolEnabled`.
   */
  videoToolEnabled?: boolean;
  /**
   * The video model pinned per tag here; see the signed-out variant for why
   * this travels on the Host's answer instead of the browser mirror.
   */
  preferredVideoModels?: Readonly<Record<string, string>>;
  /**
   * Whether the OPTIONAL CodeBuddy CLI route is mounted (tool `codebuddy_ask`
   * + command `/codebuddy`).
   *
   * GLOBAL, not per region: the route has ONE switch for both regions, so the
   * same value rides on every region's answer and the card reads it off the
   * active tab. Absent reads as OFF — this switch authorizes a child process
   * that edits files and spends CodeBuddy quota, so a Host that cannot answer
   * must not be read as consent.
   */
  cliBridgeEnabled?: boolean;
  /**
   * The model the OPTIONAL CodeBuddy CLI route runs on, or `''` for
   * "nothing is pinned, the CLI uses its own default".
   *
   * GLOBAL like `cliBridgeEnabled`. Travels on the Host's answer for the
   * same measured reason: on the stale-mirror 0.1.7 deployment a picker that
   * read the settings mirror alone would keep showing a pin that had just
   * been cleared (or had not landed yet).
   */
  cliBridgeModel?: string;
  /**
   * The reasoning effort the OPTIONAL CodeBuddy CLI route runs on, or `''`
   * for "nothing is pinned, the CLI uses its own default".
   *
   * GLOBAL and Host-carried for the same reasons as `cliBridgeModel`.
   */
  cliBridgeEffort?: string;
  /**
   * The order the OPTIONAL CodeBuddy CLI route walks the credential
   * regions in — a comma-separated region list such as `'cn,global'` — or
   * `''` for "nothing is pinned, the CLI walks its own default order".
   *
   * GLOBAL and Host-carried for the same reasons as `cliBridgeModel`.
   */
  cliBridgeRegionOrder?: string;
  /**
   * Whether the request path drops foreign thinking blocks (issue #147).
   *
   * Optional and absent reads as OFF: the repair changes bytes the upstream
   * counts, so a Host that cannot answer must not be read as consent.
   */
  dropForeignThinking?: boolean;
  /**
   * What the LAST request had to drop, for the card's explanation of a turn
   * that arrived looking like working notes (issue #147).
   *
   * Absent means "no report", not "feature off" — the two are different facts
   * and the card says different things about them. Process-local and
   * last-wins: it describes the turn the reader is looking at.
   */
  lastForeignThinking?: {
    blocks: readonly {
      messageIndex: number;
      blockIndex: number;
      characters: number;
      variant: 'flattened' | 'dropped';
    }[];
    atMs: number;
  };
  /**
   * The LIVE load level per model id, for the card's icon.
   *
   * A SEPARATE field from `models`, because the card's model list is the
   * SAVED roster (the one the user edits) and a saved roster has no load
   * level in it. Absent means "not measured right now" — never "normal".
   */
  busyLevels?: Readonly<Record<string, WorkBuddyBusyLevel>>;
  /** WHERE this region's readout sits (issue #62); absent means `composer`. */
  creditPosition?: WorkBuddyCreditPosition;
  source?: 'desktop' | 'dsh';
  tokenExpiresAtMs: number;
  /** A saved per-region choice is in effect (false = following the app). */
  selectionExplicit: boolean;
  accounts: readonly WorkBuddyWebAccount[];
  models: readonly WorkBuddyWebModel[];
  enabledModelIds: readonly string[];
  imageModelIds: readonly string[];
  /**
   * Model ids whose `off` thinking level is offered (issue #34): the saved
   * selection, seeded from the built-in rule the first time it is read.
   */
  offModelIds: readonly string[];
  /**
   * Ids of THIS region's roster that this machine first saw inside the
   * new-model window, oldest first — the data behind the composer pill's
   * "· N 新模型" segment.
   *
   * "新" means "this machine first recorded the id in its catalog", NOT "the
   * gateway added it": the upstream list carries no listed-since field, so
   * claiming an upstream fact would be fabricating one. Absent means "nothing
   * is new right now" or "this Host predates the feature" — never "0".
   */
  newModelIds?: readonly string[];
  /**
   * A sentence explaining why no new-model readout is shown, present only
   * when the on-disk first-sighting history is in a version this build cannot
   * read. Kept separate from the field above so "no new models" is never the
   * story for a file that simply was not read.
   */
  rosterSeenVersionNote?: string;
  credits?: WorkBuddyWebCredits;
  creditsError?: string;
  /**
   * The LAST refresh failed, but the snapshot below is intact.
   *
   * A failed usage re-read must not blank the panel. The account picker,
   * credits, model directory and account pool are all gated on this region
   * being 'signed-in', so collapsing the whole snapshot into the union's
   * `{ status: 'error' }` variant (which carries no data at all) hides every
   * one of them — including a pool the user is midway through editing. It
   * reads as "the plugin lost my configuration". Carrying the failure as an
   * overlay keeps the last good directory on screen with a banner above it,
   * which is also what `creditsError`/`checkinError` already do per section.
   *
   * Only ever set on a snapshot that WAS healthy; a region that never loaded
   * still reports the plain `{ status: 'error' }` so it can show the
   * sign-in guidance instead of an empty panel.
   */
  refreshError?: string;
  checkin?: WorkBuddyWebCheckin;
  checkinError?: string;
  /**
   * The upstream refused the credential itself (a 401/403), as opposed to a
   * transient upstream fault. Distinguishes "your token is not usable" from
   * "the request failed", which need opposite advice.
   */
  credentialRejected?: boolean;
  /** Present only alongside {@link credentialRejected}. */
  recovery?: WorkBuddyWebRecovery;
  /**
   * This region's account-pool state, when the Host supports it.
   *
   * Absent on a Host without pool support, so the card renders no pool
   * section instead of an empty one.
   */
  pool?: WorkBuddyWebPool;
  /**
   * Diagnostic only: whether this Host build's Config carries the volatile
   * markers dsh-settings requires before it will persist any field. Exposed
   * so a save refusal can be attributed to the settings gate rather than
   * guessed at.
   */
  diagVolatile?: {
    regions: boolean;
    accounts: boolean;
    authFile: boolean;
  };
  /**
   * The persisted per-region context budgets as the Host reads them. The
   * browser settings mirror can lag a write made through the Host save
   * endpoint, so the card renders these rather than a possibly-stale snapshot.
   */
  contextBudgets?: Record<string, number>;
} | {
  status: 'error';
  message: string;
};
/**
 * Outcome vocabulary of one model probe, shared by the Host and the card.
 *
 * Mirrors `WorkBuddyProbeOutcome` in `./probe.ts`; kept as its own declaration
 * here because this module is the node-free bridge and must not import the
 * Host-side probe module (which pulls in the credential type).
 */
type WorkBuddyWebProbeOutcome = 'ok' | 'rate-limited' |
/**
 * The MODEL is loaded, not the account (upstream code 14003).
 *
 * Kept apart from `rate-limited` because the two need OPPOSITE advice:
 * `rate-limited` is this account's volume limit (wait, or bill another
 * account), while `model-busy` follows the model everywhere — every account
 * hits the same wall, so switching accounts only spends a request per account
 * to learn what the first one already said. The remedy is the upstream's own:
 * wait about a minute, or switch to a less busy model.
 */
'model-busy' | 'out-of-credit' | 'credential-rejected' | 'policy-rejected' |
/**
 * The upstream restricted this credential for unusual activity (issue #127).
 *
 * Separate from `policy-rejected`: a content refusal is about the request,
 * while this is about the credential and needs re-authentication or an appeal.
 */
'account-restricted' |
/**
 * The gateway's channel gate refused the request itself (upstream code 11128).
 *
 * Kept apart from `failed` because its whole point is the question it answers:
 * the probe passes and the chat fails on the SAME model and the SAME account,
 * because the gate matches the OPENING of a `system` message and the probe's
 * is a neutral one-liner. A generic failure would leave the user swapping
 * accounts that cannot change a byte of their prompt (issues #87–#90).
 */
'channel-rejected' | 'unavailable' | 'not-found' | 'failed';
/** One model's probe result, as the card renders it. */
interface WorkBuddyWebProbeResult {
  modelId: string;
  outcome: WorkBuddyWebProbeOutcome;
  /** Round-trip time in ms; present once the request landed. */
  elapsedMs?: number;
  /** HTTP status the upstream answered with; 0 means it never landed. */
  status?: number;
  /** Upstream's own words, already redacted. */
  message?: string;
  /**
   * A time the upstream named for using this model again, in ms.
   *
   * ABSENT means the upstream named none, and the card must say exactly that.
   * A client-invented countdown here would be fiction. Four sources fill it:
   * a real `Retry-After` header; the reset sentence the upstream writes into
   * its own failure BODY (`将在 … UTC+8 重置`, which is where this service
   * actually puts it — its 429s carry no rate-limit header at all); the
   * region's own quota refresh point for an exhausted quota; or, for the
   * model-scoped 14003 throttle, the magnitude the upstream states in PROSE
   * ("wait about a minute") — see {@link WorkBuddyWebProbeOutcome}.
   */
  retryAtMs?: number;
  /** Which of those four sources supplied {@link retryAtMs}. */
  retrySource?: 'retry-after' | 'upstream-message' | 'quota-refresh' | 'upstream-tips';
}
/**
 * One model's output-speed result, as the card renders it (issue #92).
 *
 * Deliberately its own type rather than extra fields on
 * {@link WorkBuddyWebProbeResult}: the two runs answer different questions, and
 * a shared type would let a card render an availability verdict with a speed on
 * it, or vice versa, with nothing to stop it.
 */
interface WorkBuddyWebTpsResult {
  modelId: string;
  /** `ok` when at least one run answered; the speed fields say what was learned. */
  outcome: 'ok' | 'unavailable' | 'credential-rejected' | 'failed';
  /** Median output tokens/second over the usable runs. */
  tokensPerSecond?: number;
  /** Median time to first content chunk, in ms. */
  timeToFirstTokenMs?: number;
  /** Output tokens the upstream counted for the fastest usable run. */
  outputTokens?: number;
  /** How many runs contributed; below the planned count when runs were lost. */
  samples: number;
  /** Why {@link tokensPerSecond} is absent, when it is. */
  reason?: 'few-chunks' | 'no-usage' | 'all-failed';
  /** Total credit the runs reported, rounded to 2dp. */
  credit?: number;
  /** Upstream's own words when the run failed outright. */
  message?: string;
}
/** Why one account is currently out of the pool. */
type WorkBuddyWebPoolExclusion = 'unusable' | 'rate-limited' |
/**
 * The MODEL this account was measured against is loaded, not the account.
 *
 * Mirrors the same-named member of `WorkBuddyPoolExclusion` in
 * `./account-pool.ts`, and mirrored here for the same reason as the outcome
 * vocabulary above: this module is the node-free bridge and must not import
 * the Host-side pool module. The card renders it with its own label, because
 * showing "被限流" next to an ACCOUNT name asserts something the measurement
 * does not say (issue #56).
 */
'model-busy' | 'out-of-credit' | 'credential-rejected' |
/**
 * The upstream restricted this account (issue #127); unlike a request policy
 * refusal, another account can serve and this one should be benched.
 */
'account-restricted' | 'not-found' | 'unavailable' | 'failed';
/** One claimable benefit, as the card renders it (issue #79). */
interface WorkBuddyWebBenefit {
  /** Which campaign: compensation (crash补偿) or gift (新人首月赠送). */
  kind: 'compensation' | 'gift';
  /** Display name for the campaign, resolved Host-side so both clients agree. */
  title: string;
  /** Credits on offer. */
  creditNum: number;
  /**
   * Whole days until the window closes, floored at 0.
   *
   * ABSENT when the gateway stated no end time — the card must then omit the
   * countdown rather than print a number nobody knows.
   */
  daysLeft?: number;
  /** True when the window closes within 3 days, so the card can say 即将到期. */
  urgent: boolean;
}
/**
 * One account's row in the pool, as the card renders it.
 *
 * Ties together the three facts the card shows per account — credits, the last
 * test, and whether it is currently eligible — so the ranking the card displays
 * comes from ONE Host answer rather than being re-derived in the browser.
 */
interface WorkBuddyWebPoolAccount {
  accountId: string;
  accountName: string;
  /**
   * The credential belongs to an enterprise/education tenant (issues #124/#129).
   *
   * Carried through the pool row so the card can render the two actions the
   * upstream does not support for those accounts (daily check-in and benefit
   * claiming) as explicitly unavailable rather than as pending work.
   */
  enterprise?: boolean;
  /** Total remaining credits, absent when the credits route failed. */
  credits?: number;
  /** Credits expiring within 3 days. */
  expiringSoon?: number;
  /** When the nearest package expires, in ms. */
  nearestExpiryMs?: number;
  /**
   * The last test of this account's target model, absent when never tested.
   *
   * The model is recorded INSIDE the probe (issue #61) rather than assumed from
   * the row's current setting: the setting can be changed after the test, and a
   * result must keep naming what it actually measured.
   */
  probe?: {
    outcome: WorkBuddyWebProbeOutcome;
    atMs: number;
    /**
     * What wrote this measurement, so the card can explain a change the user
     * watched happen: `test-batch` is a deliberate test, `live-request` is a
     * real request that failed and overwrote it. ABSENT for records written
     * before the field existed — the card must then say "unknown" rather than
     * guess which of the two it was.
     */
    source?: 'test-batch' | 'live-request';
    /**
     * WHICH model this measurement is about (issue #61).
     *
     * `6004` is an account × model condition, so an `ok` without a model reads as
     * account-level availability — which is exactly the false positive the
     * reporter hit: the card said 可用 for two accounts whose actual model
     * returned `429 / 6004`. ABSENT for records written before the field existed;
     * the card must then say the scope is unknown rather than assume it.
     */
    modelId?: string;
    /** Only when the upstream named a time; never invented locally. */
    retryAtMs?: number;
    /**
     * Why it failed, in the upstream's own redacted words.
     *
     * Carried so the pool table can distinguish a DNS failure from a gateway
     * 502 from a request the user cancelled, instead of repeating one generic
     * sentence for all three. ABSENT on success and on measurements written
     * before this field existed, so the card must render the bare outcome then.
     */
    message?: string;
  };
  /** Set when this account cannot serve right now. */
  excludedBy?: WorkBuddyWebPoolExclusion;
  /** Whether this is the account currently billing traffic for the region. */
  current: boolean;
  /**
   * Whether the user checked this account into the pool.
   *
   * Listed rows include UNCHECKED accounts so the card can offer them to check:
   * membership is an explicit opt-in, and a user can only opt in to something
   * they can see. Only checked rows can bill or be batched.
   */
  member: boolean;
  /**
   * Today's check-in state for this account.
   *
   * ABSENT means it was not read — the card must then say so rather than
   * rendering a definite "not checked in", which would contradict the check-in
   * result the user just watched succeed.
   */
  checkedInToday?: boolean;
  /**
   * Promotional benefits this account can STILL claim (issue #79).
   *
   * Never carries a claimed or lapsed campaign: the issue's rule is that those
   * do not appear at all, so their absence here IS the "hide it" instruction.
   * ABSENT means not read (or nothing claimable), and the card renders no line
   * either way — a benefit line is only ever added to say "there is something
   * here for you", never to announce its own absence.
   */
  benefits?: readonly WorkBuddyWebBenefit[];
  /**
   * The model a TEST of this row would use (issue #61).
   *
   * Per row, because a test model can be chosen per account: the card shows it
   * beside the row it applies to rather than implying one model for the table.
   */
  testModelId?: string;
  /** Where this row's test target came from (see {@link WorkBuddyWebPool.targetModelSource}). */
  testModelSource?: 'preferred' | 'free' | 'none' | 'stale';
  /** This row's saved override that the region no longer offers. */
  staleTestModelId?: string;
}
/**
 * The pool's state for one region.
 *
 * `targetModelId`/`targetModelSource` exist so the card can state WHICH model a
 * test would use and WHERE that choice came from. `none` is a real, common
 * answer (the CN catalog carries no free model until its first refresh) and the
 * card must render it as "no free model" rather than silently substituting a
 * paid one.
 */
interface WorkBuddyWebPool {
  enabled: boolean;
  /**
   * Whether this region offers the daily check-in at all.
   *
   * The card hides the action entirely when false, rather than rendering a
   * button whose only outcome is a refusal.
   */
  checkinSupported: boolean;
  /** The model a test would use right now; absent when none can be resolved. */
  targetModelId?: string;
  /**
   * The saved target id that is no longer offered by this region's catalog.
   *
   * Present only when {@link targetModelSource} is `'stale'`. The card says so
   * and offers a way back to automatic, instead of enabling a test button that
   * would run against a model the upstream does not offer.
   */
  staleTargetModelId?: string;
  /**
   * The SAVED per-account test models, keyed by account id (issue #61).
   *
   * Sent verbatim rather than as the effective set: the card edits this map, and
   * an id whose model has left the catalog must survive a save so the user's
   * record of what they chose is not silently destroyed.
   */
  /**
   * Where the target came from. `'stale'` means the SAVED id is no longer in
   * the catalog — a distinct state from `'none'` (no free model exists),
   * because the two need opposite advice.
   */
  targetModelSource: 'preferred' | 'free' | 'none' | 'stale';
  /** The account ids the user has checked into this region's pool. */
  memberAccountIds?: readonly string[];
  /**
   * The user's hand-ordered pool order, as account ids.
   *
   * Independent of {@link memberAccountIds}: an id need not be checked in
   * (it only takes effect once the account is a member), and ids not listed
   * sort last. Kept separate from membership so reordering never conflicts
   * with, or is destroyed by, a membership edit. Only ids that resolve to a
   * currently listed account are transmitted (see `web-status.ts`).
   */
  orderAccountIds?: readonly string[];
  /**
   * Tokens each test probe sends, as the user saved it; `0`/absent = default.
   *
   * The SAVED value, not the resolved one: the card needs to tell "the user
   * never chose a size" apart from "the user chose 25000", because the first
   * must keep showing the default option rather than a number they never picked.
   */
  probeInputTokens?: number;
  /**
   * The subset of {@link memberAccountIds} that resolves to a real local
   * sign-in — i.e. what a batch actually runs on.
   *
   * Sent so the card never re-derives it: counting the raw saved list is what
   * let the UI claim "1 of 1 selected" and enable both buttons while the Host
   * ran on ZERO accounts and reported success.
   */
  effectiveMemberAccountIds?: readonly string[];
  /**
   * Last measured display name per saved member id (issue #60).
   *
   * Only ids the roster above does NOT list are useful here: those are the
   * members whose sign-in has gone, and whose name therefore survives nowhere
   * else. The card renders a name when there is one and a short id prefix when
   * there is not — the point is that the ghost warning stops being a
   * subjectless count ("1 saved account is no longer signed in") that the user
   * has no way to act on.
   */
  memberNames?: Readonly<Record<string, string>>;
  accounts: readonly WorkBuddyWebPoolAccount[];
  /**
   * The models a manual target can be chosen from.
   *
   * TRIMMED to what the picker renders (id, name, multiplier) rather than the
   * full `WorkBuddyWebModel` roster: the model table above already ships that
   * roster in the same document, and this block is re-read on every 60-second
   * poll, so carrying the full records here duplicated the whole catalog twice
   * per response for three fields.
   */
  catalog?: readonly WorkBuddyWebPoolModel[];
}
/** One model as the pool's target picker needs it. */
interface WorkBuddyWebPoolModel {
  id: string;
  name: string;
  /** Absent when the upstream stated no multiplier (NOT the same as free). */
  creditMultiplier?: number;
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
declare function unwrapVolatileDeep<T>(value: T): T;
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
declare const WORKBUDDY_SETTINGS_NS: "workbuddy";
//#endregion
//#region src/roster-seen-store.d.ts
/** A first-sighting readout, assembled read-only by the usage route. */
interface RosterSeenReadout {
  newModelIds: readonly string[];
  /** A sentence when the on-disk history is in a version this build cannot read. */
  versionNote?: string;
}
//#endregion
//#region src/web-status.d.ts
/** Constructor dependencies. */
interface WorkBuddyStatusRouteOptions {
  /** The region-scoped credential store backing each region's requests. */
  store(region: WorkBuddyRegion): WorkBuddyCredentialStore;
  client: Pick<WorkBuddyUpstreamClient, 'fetchCredits' | 'fetchCheckinStatus' | 'claimDailyCheckin' | 'fetchBenefits' | 'claimBenefit'>;
  /**
   * The requested region's last-refreshed model directory (unfiltered) for
   * card display. Region-scoped because the CN and international apps expose
   * different rosters; showing one region's directory on the other account is
   * the bug this parameter exists to prevent.
   */
  displayModels(region: WorkBuddyRegion): readonly WorkBuddyModelInfo[];
  /** The requested region's selection, stored as model ids. */
  enabledModelIds(region: WorkBuddyRegion): readonly string[];
  /** Model ids the user opted into image input, for the requested region. */
  imageModelIds(region: WorkBuddyRegion): readonly string[];
  /** Model ids whose `off` thinking level is offered, for the requested region. */
  offModelIds(region: WorkBuddyRegion): readonly string[];
  /** Saved local DSH context budgets by model id, for the requested region. */
  contextBudgets(region: WorkBuddyRegion): Readonly<Record<string, number | undefined>>;
  /** Re-read the live catalog of one region from the upstream. */
  discoverModels?(region: WorkBuddyRegion, signal?: AbortSignal): Promise<readonly WorkBuddyModelInfo[]>;
  /**
   * Which ids of the requested region's roster THIS machine first saw inside the
   * new-model window (the "· N 新模型" segment), plus a note when the on-disk
   * first-sighting history is in a version this build cannot read.
   *
   * READ-ONLY: the usage route never writes first-sighting history — only the
   * catalog reconciler does (`src/index.ts`), so a panel poll can never change
   * "who is new". Region-scoped because the two regions keep separate catalogs
   * and therefore separate first-sighting tables.
   *
   * Optional, and absent means the Host predates the feature: the pill then
   * renders no segment at all rather than a made-up "0 新模型".
   */
  rosterSeen?(region: WorkBuddyRegion): Promise<RosterSeenReadout>;
  /**
   * Read the region's MEDIA models (image + video) for the card's read-only
   * roster block.
   *
   * Optional: a Host that mounts these routes without the upstream client
   * simply answers 503, and the card hides the block. Returns the same rows the
   * image tool consumes, so the card's list and the tool's model validation
   * cannot disagree about what exists in a region.
   */
  mediaModels?(region: WorkBuddyRegion, options?: {
    readonly signal?: AbortSignal;
    readonly refresh?: boolean;
  }): Promise<readonly WorkBuddyMediaModel[]>;
  /**
   * Whether the requested region's provider is currently offered to DSH. The
   * card renders this as the tab's on/off checkbox, so the switch reflects the
   * committed settings value rather than a local guess.
   */
  regionEnabled(region: WorkBuddyRegion): boolean;
  /**
   * Whether the region's sidebar credit line is shown.
   *
   * Read from the COMMITTED settings value here rather than in the browser, for
   * the same reason as `regionEnabled` — and additionally because the browser's
   * settings mirror is documented as stale for this namespace on the affected
   * 0.1.7 deployments, which made the checkbox appear unable to turn the line
   * off ("关闭不了"). The card reads this field off the Host's answer.
   *
   * Optional so a Host that predates the setting still satisfies the interface;
   * absent reads as ON, matching the schema's `default(true)`.
   */
  showCreditsInMainUi?(region: WorkBuddyRegion): boolean;
  /**
   * WHERE this region's credit readout sits (issue #62).
   *
   * Optional, and absent reads as `composer` — the only seat before the setting
   * existed, so a Host that predates it renders exactly as it used to.
   */
  creditPosition?(region: WorkBuddyRegion): WorkBuddyCreditPosition;
  /**
   * Whether the model may call the image-generation tool in this region.
   *
   * Optional, and absent reads as OFF — the opposite of the fields above. This
   * one authorizes the MODEL to spend credits on its own, so an older Host that
   * cannot answer must not be read as consent.
   */
  imageToolEnabled?(region: WorkBuddyRegion): boolean;
  /**
   * Whether the model may call the video-generation tool in this region.
   * Optional, absent reads as OFF — same opt-IN semantics as `imageToolEnabled`
   * (the model decides to spend, so an older Host must not be read as consent).
   */
  videoToolEnabled?(region: WorkBuddyRegion): boolean;
  /**
   * The video model pinned per tag in this region (`text-to-video` /
   * `image-to-video`), as a model id from that region's own catalog.
   *
   * Optional, and absent reads as "nothing pinned" — the same direction as
   * `videoToolEnabled`: an older Host that cannot answer must not invent a
   * choice the user never made. The card uses it to render the per-mode picker
   * from the committed value the tool will actually read.
   */
  preferredVideoModels?(region: WorkBuddyRegion): Readonly<Record<string, string>>;
  /**
   * Whether the OPTIONAL CodeBuddy CLI route is mounted (`codebuddy_ask` tool +
   * `/codebuddy` command).
   *
   * GLOBAL rather than per region — one switch, one route — so it takes no
   * argument. Optional, and absent reads as OFF: this switch authorizes a child
   * process to edit files and spend CodeBuddy quota, so an older Host that
   * cannot answer must not be read as consent. The card reads it off the Host's
   * answer for the same measured reason as `imageToolEnabled`: the browser's
   * settings mirror is stale for this namespace on the affected 0.1.7
   * deployments, and a stale `true` here would claim a spending capability is on.
   */
  cliBridgeEnabled?(): boolean;
  /**
   * The model the OPTIONAL CodeBuddy CLI route runs on, or `''` for "the CLI's
   * own default".
   *
   * GLOBAL like `cliBridgeEnabled` — one route, one pin, so no argument.
   * Optional, and absent is the same as `''`: the route then runs on the CLI's
   * default. The card carries it on the Host's answer for the same measured
   * reason as `cliBridgeEnabled` — the browser's settings mirror is stale for
   * this namespace on the affected 0.1.7 deployments, so a picker reading the
   * mirror alone would keep showing a pin that had just been cleared.
   */
  cliBridgeModel?(): string;
  /**
   * The reasoning effort the OPTIONAL CodeBuddy CLI route runs on, or `''` for
   * "the CLI's own default". GLOBAL, optional, and absent-as-`''` for the same
   * reasons as {@link cliBridgeModel}.
   */
  cliBridgeEffort?(): string;
  /**
   * The order the OPTIONAL CodeBuddy CLI route walks the credential regions in
   * (a comma-separated list such as `'cn,global'`), or `''` for "the CLI's own
   * default order". GLOBAL, optional, and absent-as-`''` for the same reasons
   * as {@link cliBridgeModel}.
   */
  cliBridgeRegionOrder?(): string;
  /**
   * Whether the request path drops foreign thinking blocks (issue #147).
   *
   * Optional, absent reads as OFF: the repair changes bytes the upstream counts,
   * so a Host that cannot answer must not be read as consent.
   */
  dropForeignThinking?(): boolean;
  /**
   * What the LAST request had to drop, for the card's explanation of a turn that
   * arrived looking like working notes (issue #147).
   *
   * Optional, and absent means "nothing to report" — the card then renders no
   * warning rather than a permanent one. Process-local and last-wins: it
   * describes the turn the user is looking at, not a historical tally.
   */
  latestForeignThinking?(): {
    blocks: readonly {
      messageIndex: number;
      blockIndex: number;
      characters: number;
      variant: 'flattened' | 'dropped';
    }[];
    atMs: number;
  } | undefined;
  /**
   * The LIVE load level per model id, for the card's icon.
   *
   * Optional, and absent means "not measured": the card draws no badge rather
   * than a made-up one. A SEPARATE read because the card's model list is the
   * SAVED roster, which carries no load level (`src/busy.ts`).
   */
  busyLevels?(region: WorkBuddyRegion): Readonly<Record<string, WorkBuddyBusyLevel>>;
  /**
   * Send one real-volume request to each named model of a region and report what
   * came back.
   *
   * Optional: it is the only dependency the card's test button needs, so a Host
   * built without it (or a route mounted for a status-only consumer) simply
   * answers 503 and the button reports that instead of failing the card.
   *
   * Every request costs real credits (measured `credit: 0.72` for one probe), so
   * the card drives this ONE model per click and never as a batch.
   */
  probeModels?(region: WorkBuddyRegion, modelIds: readonly string[], options?: {
    signal?: AbortSignal;
  }): Promise<readonly WorkBuddyWebProbeResult[]>;
  /**
   * Measure OUTPUT SPEED for each named model of a region (issue #92).
   *
   * Separate from {@link probeModels} because it answers the opposite question
   * with the opposite request shape: tiny input, long output. The availability
   * probe's `max_tokens: 1` means its `elapsedMs` is time-to-first-token and
   * carries no rate information at all.
   *
   * Costs a fraction of a probe per model (measured `credit 0.01`–`0.15` against
   * `0.72`), because this gateway prices by INPUT. It still spends real credit,
   * so it stays one model per click like every other spending route.
   */
  measureTps?(region: WorkBuddyRegion, modelIds: readonly string[], options?: {
    signal?: AbortSignal;
  }): Promise<readonly WorkBuddyWebTpsResult[]>;
  /**
   * The region's next monthly quota refresh, when the upstream declares one.
   *
   * Used ONLY to answer "when can I use this again" for an out-of-credit
   * outcome, which is the one cooldown the service actually states: a monthly
   * resource that resets at a known time. Every other limited outcome has no
   * time from any source and must be reported as such.
   */
  quotaRefreshAtMs?(region: WorkBuddyRegion): number | undefined;
  /**
   * Report whether a region still has at least one local sign-in.
   *
   * The card is where sign-in state actually changes under the plugin's nose
   * (the user signs in to the desktop app, then presses "detect accounts
   * again"), so the routes are the earliest honest place to notice. Both
   * callers already read `store.accounts()` for their own answer, so this adds
   * no scan of its own.
   */
  regionUsable?(region: WorkBuddyRegion, usable: boolean): void;
  /**
   * Verify whether one local account is still accepted by the upstream.
   *
   * Consulted ONLY after the selected credential has been refused, to tell
   * "switch accounts" apart from "sign in again". Left undefined, nothing is
   * claimed usable and the card falls back to the re-login advice that needs no
   * probe.
   */
  accountUsable?(region: WorkBuddyRegion, account: WorkBuddyRecoveryCandidate): Promise<boolean>;
  /**
   * The CLI route's live turns, for the composer readout.
   *
   * A READ of the bridge's in-memory board, not a computation: the route exists
   * so a turn that is still running has somewhere to be observed from, and the
   * board is the only thing that knows. Absent (the bridge is switched off, or
   * this Host mounted the status routes without it) means "no live turns", which
   * the chip renders as nothing at all.
   */
  cliLive?(): unknown;
  /**
   * Why each of the region's accounts cannot serve right now, keyed by account
   * id. Absent key (or an absent dep) means "no reason known" — the composer
   * panel then marks nothing, which is the honest answer for an account that has
   * never been measured.
   *
   * The rule is the SAME one the pool ranks by (`exclusionOf`), including its
   * cooldown-expiry handling, so an account the pool calls usable and one the
   * panel calls rate-limited can never be the same account at the same moment.
   * Reimplementing the expiry check here would let the two drift.
   */
  accountExclusions?(region: WorkBuddyRegion): Promise<Readonly<Record<string, WorkBuddyWebPoolExclusion>>>;
  /**
   * The region's account pool, assembled on the Host.
   *
   * Optional as a whole: a Host built without pool support simply omits it, and
   * the card then renders no pool section rather than an empty, confusing one.
   * Inside it, `test` is in turn optional because a batch test is the one part
   * that needs a working probe dependency.
   */
  pool?: WorkBuddyPoolDeps;
  /**
   * OAuth QR sign-in: start a login and poll it to completion.
   *
   * Optional as a whole: a Host built without it simply omits the card's
   * sign-in affordance (an older bundle keeps rendering, minus the button).
   */
  oauth?: WorkBuddyOAuthDeps;
  /**
   * Batch credential export / import between machines.
   *
   * Optional as a whole: a Host built without it simply omits the card's
   * transfer section (an older bundle keeps rendering, minus the buttons).
   */
  transfer?: WorkBuddyTransferDeps;
}
/**
 * What the transfer route needs from the Host. Everything is region-scoped:
 * the two regions' vaults are parallel stacks, and an export of one tab must
 * never leak the other tab's accounts.
 */
interface WorkBuddyTransferDeps {
  /**
   * Export the named accounts' credentials in the shared transfer format.
   * Unknown ids are simply absent from the answer; an answer with zero
   * records means nothing named was exportable (the caller decides whether
   * that is an error).
   */
  exportAccounts(region: WorkBuddyRegion, accountIds: readonly string[]): Promise<WorkBuddyTransferExportAnswer>;
  /** Parse transfer-file text into the desensitized preview. */
  previewImport(region: WorkBuddyRegion, text: string): Promise<WorkBuddyTransferPreview>;
  /**
   * Merge the selected file entries into the region's vault. Returns the
   * counters the card reports; `skipped` covers missing tokens, bad indexes,
   * and records belonging to the other region.
   */
  importAccounts(region: WorkBuddyRegion, text: string, indexes: readonly number[]): Promise<WorkBuddyTransferImportAnswer>;
}
/**
 * What the OAuth route needs from the Host: the two session actions, plus the
 * persistence step the route cannot do itself (only the Host may touch the
 * credential vault).
 */
interface WorkBuddyOAuthDeps {
  /**
   * Start one login for the region. Resolves the URL the user opens to scan
   * and confirm, or an actionable error.
   */
  start(region: WorkBuddyRegion): Promise<WorkBuddyOAuthStartResult>;
  /**
   * Poll once. The card repeats until `done` — then either the account was
   * persisted (the Host saved it to the vault) or an error is reported.
   */
  poll(region: WorkBuddyRegion, loginId: string): Promise<WorkBuddyOAuthPollView>;
}
/** The start answer, token-free (the state never leaves the Host). */
type WorkBuddyOAuthStartResult = {
  loginId: string;
  verificationUri: string;
  expiresIn: number;
} | {
  error: string;
};
/** The poll answer the card sees. `account` carries display fields only. */
type WorkBuddyOAuthPollView = {
  done: false;
} | {
  done: true;
  accountName: string;
  accountId: string;
} | {
  done: true;
  error: string;
};
/**
 * What the pool route needs from the Host.
 *
 * Everything is region-scoped because the two regions are parallel stacks: one
 * region's pool must never see, rank, or bill the other region's accounts.
 */
interface WorkBuddyPoolDeps {
  /** The region's stored preferences, resolved from the Host config. */
  preferences(region: WorkBuddyRegion): {
    enabled: boolean;
    targetModelId: string;
    /** Per-account override of `targetModelId` (issue #61). */
    /**
     * Tokens each test probe sends as saved; `0` when the user never chose.
     *
     * Optional so a caller that has not learnt about the setting still
     * satisfies this interface, and so its absence reads as "default" — the
     * same meaning the host gives an older profile.
     */
    probeInputTokens?: number;
    memberAccountIds: readonly string[];
    /**
     * The user's hand-ordered pool order, as account ids.
     *
     * Optional so a Host that never learnt about the setting still satisfies
     * this interface — its absence then reads as "no manual order" and the
     * ranking simply ignores it.
     */
    orderAccountIds?: readonly string[];
  };
  /** One region's CHECKED accounts, plus their credits and last measurements. */
  members(region: WorkBuddyRegion): Promise<readonly WorkBuddyPoolMember[]>;
  /**
   * One region's CHECKED accounts from LOCAL state only — the first-paint
   * source (issue #77).
   *
   * Cheap by contract in the strongest sense: no upstream read at all. It
   * returns the saved members with whatever credit reading a previous full
   * document already recorded (a snapshot, possibly minutes old, possibly
   * absent), so the card can paint the account table before any billing
   * endpoint answers. `credits` being absent is normal here and renders as "—",
   * which is why {@link WorkBuddyWebPoolAccount} makes every figure optional.
   *
   * A Host built without it degrades to omitting the pool block from a
   * first-paint document (rather than paying {@link members} on that path):
   * the card then paints its account list from the full document, exactly as
   * before this contract existed.
   */
  localMembers?(region: WorkBuddyRegion): Promise<readonly WorkBuddyPoolMember[]>;
  /**
   * The checked accounts that actually RESOLVE to a local sign-in.
   *
   * Cheap by contract (a local scan, no upstream calls), unlike {@link members}
   * which fetches credits per account. The route's empty-pool guard uses this
   * so a ghost id — a saved member whose sign-in is gone — is refused with
   * `no-live-members` (distinct from `no-members`, which means nothing was ever
   * checked) instead of passing the guard and running a batch over nothing.
   */
  effectiveMemberAccountIds?(region: WorkBuddyRegion): Promise<readonly string[]>;
  /**
   * Last display name measured for each of a region's saved member ids
   * (issue #60), from the runtime probe store — no upstream call.
   *
   * The card needs this for the one case it cannot answer from its own props: a
   * saved member whose sign-in is gone resolves to no listed account, so its
   * name exists ONLY in the measurement that once saw it. Optional: a Host
   * built without it still renders, with the id-prefix fallback.
   */
  memberNames?(region: WorkBuddyRegion): Promise<Readonly<Record<string, string>>>;
  /**
   * Test ONE account against the region's target model.
   *
   * The per-row button's Host half. Optional: a Host built without it simply
   * omits the row button (an older bundle keeps rendering, minus the control).
   * Returns undefined when the region cannot name a target model — the same
   * refusal the batch route reports as 409.
   */
  testOne?(region: WorkBuddyRegion, accountId: string): Promise<WorkBuddyPoolTestRow | undefined>;
  /**
   * Forget ONE account's plugin-stored credential. Only the vault entry is
   * removed; the desktop app's files are never touched. Returns whether an
   * entry existed — false means the account exists only as a desktop sign-in
   * (or was already gone), which the card reports instead of a silent no-op.
   */
  removeOne?(region: WorkBuddyRegion, accountId: string): Promise<boolean>;
  /**
   * Today's check-in state per account id.
   *
   * Read for the pool's table so the card can state it. Absent (or a missing
   * entry) means "not read", which the card renders as unknown rather than as a
   * definite "not checked in" — a claim that would contradict the check-in the
   * user just performed.
   *
   * Only the CN region has a check-in to report; see {@link checkinSupported}.
   */
  checkedInToday?(region: WorkBuddyRegion): Promise<Readonly<Record<string, boolean>>>;
  /**
   * Today's check-in state, from the cells already measured this process.
   *
   * The first-paint counterpart of {@link checkedInToday}: reads the Host's
   * measurement cache and nothing else, so a first paint never waits on one
   * upstream request per account. An account it has not measured is simply
   * absent, which the card renders as unknown — the same meaning as a failed
   * per-account read in the full document.
   */
  cachedCheckedInToday?(region: WorkBuddyRegion): Readonly<Record<string, boolean>>;
  /**
   * Claimable promotional benefits per account id (issue #79).
   *
   * Only campaigns the account can STILL claim are present; a claimed or lapsed
   * campaign is absent on purpose, so the card renders nothing for it. Absent
   * (or a missing entry) also means "not read yet", which the card treats the
   * same way — no line, rather than a guessed state.
   */
  benefits?(region: WorkBuddyRegion): Promise<Readonly<Record<string, readonly WorkBuddyBenefitView[]>>>;
  /**
   * Claimable benefits, from the readings already taken this process.
   *
   * The first-paint counterpart of {@link benefits}: no request, so painting
   * never waits on two upstream reads per account.
   */
  cachedBenefits?(region: WorkBuddyRegion): Readonly<Record<string, readonly WorkBuddyBenefitView[]>>;
  /**
   * Forget this account's cached benefit reading so the next status read is live.
   *
   * The claim route writes to upstream directly, so nothing else in the plugin
   * knows the campaign just changed. Without this the card kept showing 领取 for
   * up to `BENEFIT_CACHE_MS` (30 min) after a SUCCESSFUL claim: the credits went
   * up, the pill stayed, and the only remaining explanation was "the claim
   * silently failed" — which invited a second click the route then refused as
   * already-claimed. `checkin` has the same rule and invalidates its own cache;
   * this is the benefit counterpart.
   *
   * Absent is legal (a Host from before this hook) and means "the click refreshes
   * the card, but the host-side cache may still answer stale for a while".
   */
  invalidateBenefit?(region: WorkBuddyRegion, accountId: string): void;
  /**
   * Every local sign-in the pool does NOT cover, so the card can offer them to
   * check in. Absent means the card lists only pool members.
   */
  otherAccounts?(region: WorkBuddyRegion): Promise<readonly {
    id: string;
    accountName: string;
    enterprise?: boolean;
  }[]>;
  /** The account currently billing traffic for the region, when known. */
  currentAccountId?(region: WorkBuddyRegion): Promise<string | undefined>;
  /**
   * Whether this region offers the daily check-in action at all.
   *
   * The CN app rewards a daily check-in; the international region is not offered
   * one here, so its card must not show the button and its route must refuse the
   * action. A capability rather than a region name compared in the browser: the
   * policy belongs in the Host, and the card should not have to know which
   * regions happen to have the feature.
   */
  checkinSupported?(region: WorkBuddyRegion): boolean;
  /**
   * Claim the daily reward for every account of one region.
   *
   * Absent means the action answers 503 — the same contract as {@link
   * WorkBuddyStatusRouteOptions.probeModels}, so a Host without the dependency
   * reports "unavailable" instead of appearing to succeed.
   */
  checkin?(region: WorkBuddyRegion): Promise<readonly WorkBuddyPoolCheckinRow[]>;
  /**
   * Test every account of one region against the resolved target model.
   *
   * `onRow` is optional and exists so the route can STREAM each account as it
   * finishes. An older Host ignores it and answers with the whole batch at once;
   * the route handles both, because a missing reporter must degrade to the
   * previous behaviour rather than to no rows at all.
   */
  test?(region: WorkBuddyRegion,
  /**
   * The model the whole batch is measured on — ONE value, by design: every
   * member of the batch must be probed on the same model or a green batch
   * stops meaning a single thing (see the removal note in `account-pool-run.ts`).
   */
  modelId: string, onRow?: (row: WorkBuddyPoolTestRow) => void): Promise<readonly WorkBuddyPoolTestRow[]>;
  /** The region's live catalog, used to resolve the free target model. */
  catalog?(region: WorkBuddyRegion): readonly WorkBuddyModelInfo[];
}
/**
 * How much live measurement a status document carries (issue #77).
 *
 * `full` is the original answer: the selected account's credit and check-in
 * plus every pool account's credit and check-in, all read from upstream now.
 * It is what the card's 60-second poll, the composer panel and every
 * measurement-driven control expect.
 *
 * `fast` is the FIRST PAINT. It answers from local state only — no token
 * refresh, no billing endpoint, no check-in endpoint — so the account list can
 * render in the first round trip and cannot be held up by a slow or
 * rate-limited upstream. Live figures are absent from it by construction; the
 * card then asks for the full document and upgrades the same snapshot.
 */
type WorkBuddyStatusDetail = 'full' | 'fast';
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
declare function workBuddyWebStatus(deps: WorkBuddyStatusRouteOptions, region: WorkBuddyRegion, options?: {
  detail?: WorkBuddyStatusDetail;
}): Promise<WorkBuddyWebUsage>;
/**
 * Mount the read-only routes on a context where `webServer` is available.
 * The caller uses `ctx.inject(['webServer'], ...)`, so Desktop startup order
 * cannot make this registration disappear.
 */
declare function registerWorkBuddyStatusRoute(ctx: Context, deps: WorkBuddyStatusRouteOptions): void;
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
declare const name = "dsh-connect-workbuddy";
/** The model registry required before the provider can register. */
declare const inject: string[];
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
declare function settingsNamespaceOf(ctx: unknown): SettingsNamespace;
/** One region's model directory and the user's selection within it. */
interface WorkBuddyRegionState {
  /**
   * Whether this region's provider is switched on. Opt-out: only an explicit
   * `false` disables it, so a config predating this switch keeps both providers
   * running. A disabled region is fully withdrawn from the harness — its adapter
   * route and its configurable-provider entry both hold zero routes, so it
   * disappears from DSH's model picker instead of lingering as an unselectable
   * row (see `syncRegionRegistration`).
   */
  enabled?: boolean;
  /**
   * Whether this region's credit balance shows at the DSH sidebar foot.
   *
   * Per-region, independently switched: WB CN and WB AI are separate accounts
   * on separate gateways, so a user holding only one of them must be able to
   * show exactly that one. Opt-out — an absent value reads as ON, so a config
   * written before this switch existed keeps whatever the default was.
   */
  showCreditsInMainUi?: boolean;
  /**
   * Whether the model may call the image-generation tool here (opt-IN).
   *
   * The only switch in this interface where an ABSENT value means OFF. Every
   * other flag here governs something the user can undo by clicking again;
   * this one authorizes the model to spend real credits on its own, so an
   * upgrade — or a config whose value could not be read — must leave it off.
   */
  imageToolEnabled?: boolean;
  /**
   * Same opt-IN shape as `imageToolEnabled`, but for the video-generation tool
   * (`workbuddy_draw_video`). Absent means OFF, for the same reason: the model
   * decides to spend, so an upgrade must never hand out a spending capability.
   */
  videoToolEnabled?: boolean;
  /**
   * The video model the user pinned in the card, keyed by video tag
   * (`text-to-video` / `image-to-video`), value is a model id from this
   * region's own catalog.
   *
   * Per-REGION and per-TAG on purpose: the two modes can be served by different
   * models (a catalog may carry a text-to-video-only row), and model ids do not
   * cross regions (CN publishes `kling-video-v3` and `minimax-video-h3`,
   * international only `kling-video-v3`). Absent or stale is NOT an error: the
   * tool falls back to the first model of the group, because a preference the
   * catalog no longer carries must not fail a generation the user asked for.
   */
  preferredVideoModels?: Record<string, string>;
  /**
   * WHERE this region's credit readout sits (issue #62).
   *
   * Two seats, because the first one is not always available:
   *
   *   - `composer` — the composer tool row (`conversation.input.left`), shared
   *     with the shell's own controls. It is the closer, more glanceable seat,
   *     and it is the default so nothing moves for anyone who does not choose.
   *   - `stats` — the ambient dock below the composer card
   *     (`conversation.composer.dock`), where the shell renders its own
   *     round/step/token pills. That row is a LIST seat whose shipped occupant
   *     registers separately, so a third-party plugin that ALSO parks something
   *     in the composer row cannot crowd this readout out of existence.
   *
   * The report behind this (issue #62) was exactly that: with another plugin
   * installed, the readout vanished from the composer row. Making the seat a
   * choice is what keeps one plugin's presence from deciding another's.
   */
  creditPosition?: WorkBuddyCreditPosition;
  /** The last-refreshed directory for this region; what the card displays. */
  lastCatalog?: WorkBuddyModelInfo[];
  /** The user's selection in this region, as model ids. */
  enabledModelIds?: string[];
  /** Model ids the user explicitly opted into image input. */
  imageModelIds?: string[];
  /**
   * Model ids whose `off` thinking level is offered (issue #34). Seeded from
   * the built-in rule (upstream declaration minus the models known to reject
   * `off`) when first read; the card's checkbox toggles membership.
   */
  offModelIds?: string[];
  /** Local DSH context budget per model in this region. */
  contextBudgets?: Record<string, WorkBuddyContextBudget>;
  /** This region's account-pool preferences (opt-in; see {@link WorkBuddyPoolPreferences}). */
  pool?: WorkBuddyPoolPreferences;
}
/**
 * One region's account-pool preferences, as stored.
 *
 * Every field is a USER CHOICE, which is why the pool's measured facts are not
 * here: preferences are saved through the card's draft-and-discard path, and a
 * measurement living in the same slot would be rolled back by the next save.
 */
interface WorkBuddyPoolPreferences {
  /**
   * Whether the pool is active for this region — which now means the
   * FAILOVER switch, not a credit ranking.
   *
   * Opt-in: default false. While on, a chat request that fails upstream is
   * retried against the other usable members of this region's pool, in order,
   * until one serves it or none is left (see `src/shim.ts`). While off the
   * plugin behaves exactly as it did before the pool existed: the account the
   * user selected serves every request, and a failure is reported as-is.
   *
   * It deliberately does NOT change the SAVED selection: while on, the pool
   * picks the serving account for every request (`applyPoolSelection` ranks
   * the usable members and sets a per-request override), but that override is
   * per-request borrowing — turning the pool off hands every request back to
   * the account the user chose, and the card can keep reporting who really
   * served. (An older version of this comment said the pool "does NOT change
   * which account serves NEXT", which was wrong the moment `applyPoolSelection`
   * started ranking on every request; what never changes is the saved choice.)
   */
  enabled?: boolean;
  /** Model id to test; `''` means auto-pick a free model from this region. */
  targetModelId?: string;
  /**
   * Per-account override of {@link targetModelId}, keyed by account id (#61).
   *
   * `6004` is an ACCOUNT × MODEL condition, so "can this account serve" has no
   * single answer: the reporter measured two accounts where one model answered
   * and another returned `429 / 6004` in the same second. The region-wide target
   * stays the default — this map only says "for THIS account, test THAT model",
   * which is what makes the pool's verdict match the model the user is actually
   * chatting with. An id that is no longer in the catalog is reported as stale
   * rather than replaced, so no credits are spent on a model nobody chose.
   */
  /**
   * How much input a probe sends, in tokens — the pool's biggest single knob.
   *
   * The upstream's rate limit (6004) fires on request SIZE, and the threshold
   * was measured to sit between 20k and 30k tokens. The probe has to be sized
   * near where the user's REAL conversations land: too small and it reports
   * "usable" while every long conversation is refused (the exact false positive
   * that made this knob necessary), too large and it costs real credit on every
   * batch AND excludes accounts that would have served the shorter requests the
   * user actually sends.
   *
   * A fixed value therefore cannot be right for everyone — the right size is a
   * property of the user's own traffic, which only they know. `undefined` keeps
   * the measured default ({@link DEFAULT_PROBE_INPUT_TOKENS}), so an existing
   * profile is unaffected.
   */
  probeInputTokens?: number;
  /**
   * The account ids checked into this region's pool.
   *
   * An EXPLICIT opt-in, and empty by default: the batch actions claim rewards
   * and spend credits on real accounts, so membership is the user's decision
   * rather than a consequence of which sign-ins happen to exist. Empty means
   * the pool covers nothing and both buttons stay disabled.
   */
  memberAccountIds?: string[];
  /**
   * The user's hand-ordered pool order, as a list of account ids.
   *
   * SEPARATE FROM MEMBERSHIP: this is purely a display/preference of what the
   * user wants the pool to prefer, and it is independent of which accounts are
   * checked in. An id here need not be in {@link memberAccountIds} — the
   * ranking only consults this order for accounts that are actually members,
   * and ids that are not listed simply sort last. Keeping them separate lets
   * the user reorder first and check accounts in later without the ordering
   * being destroyed by an unrelated membership edit (see `poolPreferencesOf`,
   * which must always carry this list through alongside membership). Ids that
   * no longer resolve to a listed account are dropped on transmit, never
   * silently merged into membership.
   */
  orderAccountIds?: string[];
}
/** Plugin configuration. */
interface Config {
  /** Explicit WorkBuddy desktop auth-file path, overriding env and platform defaults. */
  authFile?: string;
  /**
   * @deprecated Legacy single-slot account selector from before the dual
   * provider split. It is attributed to whichever region the account actually
   * belongs to (resolved once at startup from the local account scan); new
   * writes go to {@link Config.accounts}.
   */
  accountId?: string;
  /**
   * Per-region account selections, keyed `cn` | `global`. Each region's tab
   * writes its own slot; tokens remain outside settings.
   */
  accounts?: Partial<Record<WorkBuddyRegion, string>>;
  /**
   * Per-region model state, keyed `cn` | `global`. The CN app and the
   * international WorkBuddy AI app expose different rosters, so each keeps its
   * own directory and selection and switching accounts never drops the other
   * region's picks.
   */
  regions?: Partial<Record<WorkBuddyRegion, WorkBuddyRegionState>>;
  /**
   * @deprecated Legacy single-slot fields from before the region split. They
   * predate international support and are read as the CN region's state when
   * `regions.cn` is absent; new writes go to `regions`.
   */
  lastCatalog?: WorkBuddyModelInfo[];
  /** @deprecated See {@link Config.lastCatalog}. */
  enabledModelIds?: string[];
  /** @deprecated See {@link Config.lastCatalog}. */
  imageModelIds?: string[];
  /** @deprecated See {@link Config.lastCatalog}. */
  contextBudgets?: Record<string, WorkBuddyContextBudget>;
  /**
   * The optional CLI route: let the locally signed-in CodeBuddy CLI do the work
   * in a separate agent instead of proxying the gateway.
   *
   * It is OFF by default and completely independent of the provider stacks, so a
   * config that never mentions it behaves exactly as before. This is a
   * client-fingerprint workaround, not an account one — see `cli-bridge/runner`.
   */
  cliBridge?: CliBridgeSettings;
  /**
   * When scanned messages are perturbed with invisible characters.
   *
   * `failure` (default) learns from a successful channel-gate rescue and starts
   * later requests with the learned form; `always` starts every request with
   * the dense form for a gateway whose plain attempt is a guaranteed refusal;
   * `off` keeps only the post-failure rescue ladder.
   */
  channelPerturbation?: 'off' | 'failure' | 'always';
  /**
   * Adopt the official client's usage-page identity on chat requests (issue #132).
   *
   * Adds `X-IDE-Name: WorkBuddy` (which is what fills the upstream's 使用端
   * column) and sends the conversation-identity triple in the 32-hex UUIDv7
   * shape the official client uses. Off by default: the reporter measured it at
   * HTTP 200, this plugin has not reproduced that against the live gateway, and a
   * display-only change should not be the reason an account starts failing.
   */
  usageIdentity?: boolean;
  /**
   * Move the harness's injected context above the real prompt (issue #132).
   *
   * The WorkBuddy usage page records the last `user` message as the request
   * text, and DSH appends its runtime context after the user's prompt — so the
   * usage column shows the injected block instead of what the user typed. The
   * reorder is order-only and matches only the harness's own injected prefixes.
   *
   * Off by default: it changes the message order the upstream counts, so it is
   * an explicit opt-in rather than a silent change on upgrade.
   */
  keepPromptLast?: boolean;
  /**
   * Extra literal prefixes (issue #133) treated like the harness's injected
   * context markers when `keepPromptLast` is on, for injected blocks a
   * companion plugin produces that the built-in list does not recognize. Each
   * entry is matched literally at the start of a trailing `user` message.
   */
  extraInjectedPrefixes?: string[];
  /**
   * Drop foreign thinking blocks pi-ai would publish as prose (issue #147).
   *
   * When a session moves between providers, `dsh-llm-pi-ai` rebuilds the other
   * provider's assistant turns with `api: 'dsh-foreign'`, and pi-ai's
   * `isSameModel` then fails — so it does not DROP their `thinking` blocks, it
   * rewrites each one to plain `text` (`transform-messages.js:87–90`). The
   * other model's working notes therefore arrive as this turn's answer, and the
   * model copies that shape on every later turn.
   *
   * On, those blocks are removed from the request instead: they carry no
   * `thinkingSignature` (the host builds them without one), so they could never
   * be replayed as reasoning anyway — their only possible contribution to the
   * wire was the prose they turned into. Text blocks and tool calls are
   * untouched, and so is every message's identity.
   *
   * OFF by default: it changes bytes the upstream counts, so it is an explicit
   * opt-in on the same rule as {@link Config.usageIdentity}.
   */
  dropForeignThinking?: boolean;
  /**
   * Move the host's session-title request onto the hidden lightweight model
   * (issues #132/#133). Off by default: it is a real upstream request either
   * way, and the rewrite changes which bucket it is billed against.
   */
  sessionTitle?: {
    /**
     * Whether title requests are re-pointed at {@link sessionTitle.model}.
     * The host still fires the request exactly once per new session; the
     * reporter measured the lightweight model at 0 credits for these calls
     * (request volume still counts, and the evidence is reporter-level, not
     * reproduced by this plugin).
     */
    enabled?: boolean;
    /**
     * Target model for the rewritten title request. Defaults to `wb-lite`,
     * the hidden model the reporter measured; configurable in case the id
     * changes or a region exposes a different one.
     */
    model?: string;
  };
}
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
declare function asVolatile<T>(schema: z<T>): z<T>;
declare const Config: z<Config>;
/**
 * One region's saved model state. A config written before the region split has
 * only the flat fields: those were always captured from the CN endpoint (the
 * plugin had no international support), so they are read as the CN state and
 * only when no explicit CN slot exists. The global region never inherits them —
 * that inheritance is exactly the bug where a stale CN directory was
 * intersected with the international catalog and silently dropped the user's
 * picks.
 */
declare function regionStateOf(config: Config, region: WorkBuddyRegion): WorkBuddyRegionState;
/**
 * Whether one region's provider is switched on. Opt-out semantics: only an
 * explicit `false` disables it, so every config written before this switch
 * existed — including the pre-region-split flat fields, which never carry
 * `enabled` — keeps both providers running exactly as before. The card reads the
 * same rule through `regionEnabledOf`, so the two halves can never disagree
 * about a region's state.
 */
declare function regionEnabled(config: Config, region: WorkBuddyRegion): boolean;
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
declare function imageToolRegionOf(config: Config): WorkBuddyRegion | undefined;
/**
 * Region that owns the video tool right now, or `undefined` when no region has
 * it switched on. Mirrors `imageToolRegionOf` but reads `videoToolEnabled`
 * (the video-generation opt-in). Both gates required, read live: region provider
 * switch ON (`regionEnabled`, opt-OUT) and the user opted IN (`videoToolEnabled`,
 * opt-IN). CN wins when both qualify (see `REGION_KEYS`).
 */
declare function videoToolRegionOf(config: Config): WorkBuddyRegion | undefined;
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
declare function selectAccountFor(region: WorkBuddyRegion, value: Config, legacyAccountRegion: WorkBuddyRegion | undefined): string | undefined;
/** Whether a region carries the Clear sentinel rather than a saved choice. */
declare function regionCleared(value: Config, region: WorkBuddyRegion): boolean;
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
declare function legacyAttributionRegion(value: Config, accountsFor: (region: WorkBuddyRegion) => Promise<readonly {
  id: string;
}[]>): Promise<WorkBuddyRegion | undefined>;
/**
 * Start both regions' loopback endpoints, register the `workbuddy` (CN) and
 * `workbuddy-global` (international) providers, and refresh each region's
 * model catalog from the upstream once that region's credentials allow it.
 * The static fallback catalogs serve from the first moment, so an offline
 * upstream never leaves a provider empty.
 */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { CREDENTIAL_REJECTED_CODE, Config, DEFAULT_PROBE_INPUT_TOKENS, ENCRYPTED_CREDENTIAL_CODE, FALLBACK_WORKBUDDY_MODELS, FALLBACK_WORKBUDDY_MODELS_GLOBAL, NATIVE_MODALITY_BY_MODEL_ID, PROBE_INPUT_TOKEN_CHOICES, PROBE_MAX_TOKENS, PROBE_SYSTEM_PROMPT, REFUSES_OFF_MODEL_IDS, type UpstreamErrorKind, WORKBUDDY_ACCOUNTS_REFRESH_PATH, WORKBUDDY_APP_EXECUTABLE_ENV, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CHECKIN_PATH, WORKBUDDY_CONNECT_VERSION, WORKBUDDY_GLOBAL_PROVIDER, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_MODELS_REFRESH_PATH, WORKBUDDY_PROBE_PATH, WORKBUDDY_PROVIDER, WORKBUDDY_PROVIDERS, WORKBUDDY_PROVIDER_DISPLAY_NAMES, WORKBUDDY_REGIONS, WORKBUDDY_REGION_PARAM, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_TPS_PATH, WORKBUDDY_USAGE_PATH, type WorkBuddyAccountChoice, type WorkBuddyAdapter, type WorkBuddyAuthStatus, type WorkBuddyCandidateFailure, WorkBuddyCatalog, type WorkBuddyChatResult, type WorkBuddyCredential, type WorkBuddyCredentialRecovery, WorkBuddyCredentialRejectedError, WorkBuddyCredentialStore, type WorkBuddyCreditPackage, type WorkBuddyCredits, WorkBuddyEncryptedCredentialError, type WorkBuddyEncryptedField, type WorkBuddyHostHeartbeat, type WorkBuddyModelInfo, type WorkBuddyNativeModality, WorkBuddyPoolPreferences, type WorkBuddyProbeClient, type WorkBuddyProbeOutcome, type WorkBuddyProbeResult, type WorkBuddyProbeStore, type WorkBuddyReasoning, type WorkBuddyRecoveryCandidate, type WorkBuddyRefreshOutcome, WorkBuddyRegionState, type WorkBuddyShim, type WorkBuddyStatusRouteOptions, type WorkBuddyStoreOptions, WorkBuddyUpstreamClient, type WorkBuddyUpstreamModel, type WorkBuddyUsabilityProbeOptions, apply, asVolatile, authFileName, classifyUpstreamError, clearAtRestKeyCache, clearHostHeartbeat, cooldownOf, createAccountUsabilityProbe, createWorkBuddyAdapter, createWorkBuddyShim, creditOfStream, defaultDesktopAuthCandidates, defaultDesktopAuthDirs, defaultDesktopAuthPath, defaultOffModelIds, deriveAtRestKey, deriveAtRestKeyId, deriveCatalog, fallbackModelsFor, fetchAtRestKeyPayload, findWorkbuddyAppExecutable, hasEncryptedCredentialFields, imageDefaultFor, imageToolRegionOf, inject, isCredentialRejectedError, isEncryptedCredentialError, isEncryptedFieldWrapper, isHeartbeatProcessAlive, isWorkbuddyBundle, knownRegionOf, legacyAttributionRegion, legacyWorkbuddyOwnAuthPath, macosBundleExecutable, macosNestedAppBundles, modelIdOfBody, name, nativeModalityOf, nextRegionEnabled, nextRegionSlots, offDefaultFor, openEncryptedField, outcomeOfFailure, parseCreditMultiplier, parseReasoning, parseRetryAfter, parseUpstreamModel, parseWorkBuddyAuth, prepareChatBody, probeModel, probeRequestBody, probeSucceeded, processStartTimeMs, readAtRestKey, readHostHeartbeat, regionCleared, regionEnabled, regionEnabledOf, regionOf, regionOfProvider, regionOfStatusUrl, regionStateOf, regionsFieldIsCorrupt, regionsMapOf, registerWorkBuddyStatusRoute, resolveCredentialRecovery, selectAccountFor, settingsNamespaceOf, toPersistedWorkBuddyModel, unwrapVolatileDeep, videoToolRegionOf, withEffectiveOff, withWorkBuddyRegion, workBuddyDisplayName, workBuddyModelInput, workBuddyThinkingLevelMap, workBuddyWebStatus, workbuddyAccountId, workbuddyAppExecutableCandidates, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, writeHostHeartbeat };