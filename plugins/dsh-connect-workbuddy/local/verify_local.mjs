import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The chunk carries the upstream build hash, so resolve it instead of naming it:
// a version bump renames host-heartbeat-<hash>.js.
const libDir = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const chunk = readdirSync(libDir).filter((name) => /^host-heartbeat-.*\.js$/.test(name));
if (chunk.length !== 1) throw new Error(`expected exactly one host-heartbeat chunk, found ${chunk.length}`);
// The export ALIAS is not stable across upstream builds: 5.7.0 exported it as
// `$`, 5.12.0 renamed it to `rt`. Resolve whatever alias the chunk gave it,
// so a version bump cannot silently leave this script testing `undefined`.
const mod = await import(pathToFileURL(join(libDir, chunk[0])).href);
const chunkSrc = readFileSync(join(libDir, chunk[0]), "utf8");
const aliasMatch = /prepareChatBody as (\w+)/.exec(chunkSrc);
if (aliasMatch === null) throw new Error("prepareChatBody is not exported by the chunk");
const prepareChatBody = mod[aliasMatch[1]];
if (typeof prepareChatBody !== "function") throw new Error(`export ${aliasMatch[1]} is not a function`);
console.log(`chunk: ${chunk[0]}\n`);

// EVERY file in lib/ must reference the chunk that is actually here.
//
// WHY THIS IS A HARD GATE, and not a test below: on the 5.12.0 -> 5.12.4 upgrade
// the chunk was renamed (xEJRdYaC -> guET27pw) and one caller kept the OLD name.
// `bin.js` is the package's CLI entry (`bin` in package.json), so the shipped
// command threw ERR_MODULE_NOT_FOUND on load. Nothing in the behavioural suite
// could see it: the assertions below exercise the chunk directly, so a stale
// specifier in a sibling file is invisible to them. A missing module is not a
// style issue, it is a broken entry point, so this fails the run instead of
// printing a line.
const staleRefs = readdirSync(libDir)
  .filter((name) => name.endsWith(".js"))
  .flatMap((name) => {
    const text = readFileSync(join(libDir, name), "utf8");
    const refs = [...text.matchAll(/\.\/(host-heartbeat-[\w-]+\.js)/g)].map((m) => m[1]);
    return refs.filter((ref) => !chunk.includes(ref)).map((ref) => `${name} -> ${ref}`);
  });
if (staleRefs.length > 0) {
  throw new Error(`stale host-heartbeat specifier(s) pointing at a file that is not here: ${staleRefs.join(", ")}`);
}
console.log(`all lib/*.js reference ${chunk[0]}: OK\n`);


const FALLBACK = "你乃AI辅助软件也。";
const ZH = "你正通过 DeepSeek Harness 网页界面与用户对话";

function body(messages) {
  return JSON.stringify({ model: "deepseek-v4.1-flash", messages });
}

function run(name, messages, check) {
  const out = JSON.parse(prepareChatBody(body(messages)));
  const ok = check(out);
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) console.log("   -> " + JSON.stringify(out.messages).slice(0, 400));
  return ok;
}

const results = [];

results.push(
  run(
    "web-gui paragraph line replaced with Chinese prompt",
    [
      {
        role: "system",
        content:
          "You are interacting with the user through the DeepSeek Harness Web GUI.\n\nSecond paragraph stays.",
      },
    ],
    (out) => {
      const c = out.messages[0].content;
      return c.startsWith(ZH) && c.endsWith("Second paragraph stays.") && !/You are interacting with the user/.test(c);
    },
  ),
);

results.push(
  run(
    "english agent opening replaced by the short Chinese placeholder",
    [{ role: "system", content: "You are an AI agent powered by DeepSeek Harness.\n\nBody text." }],
    (out) => {
      const c = out.messages[0].content;
      return c.split("\n")[0] === FALLBACK && c.endsWith("Body text.") && !/^You are an AI agent/.test(c);
    },
  ),
);

results.push(
  run(
    "claude code opening replaced in place",
    [{ role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude.\n\nrest" }],
    (out) => out.messages[0].content.split("\n")[0] === FALLBACK,
  ),
);

results.push(
  run(
    "assistant history message is scanned too",
    [
      { role: "system", content: "clean system prompt" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "You are an AI agent powered by DeepSeek Harness.\n\nleaked" },
    ],
    (out) => out.messages[2].content.split("\n")[0] === FALLBACK,
  ),
);

results.push(
  run(
    "array text parts are handled",
    [
      {
        role: "system",
        content: [
          { type: "text", text: "You are an AI agent powered by DeepSeek Harness.\n\npart one" },
          { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ],
      },
    ],
    (out) =>
      out.messages[0].content[0].text.split("\n")[0] === FALLBACK &&
      out.messages[0].content[1].text === FALLBACK,
  ),
);

results.push(
  run(
    "clean prompt keeps its bytes",
    [{ role: "system", content: "You are a helpful coding assistant for this repo.\nsecond line" }],
    (out) => out.messages[0].content === "You are a helpful coding assistant for this repo.\nsecond line",
  ),
);

results.push(
  run(
    "no system message gets the Chinese placeholder head",
    [{ role: "user", content: "hello" }],
    (out) => out.messages[0].role === "system" && out.messages[0].content === FALLBACK,
  ),
);

results.push(
  run(
    "developer role is rewritten to system and then neutralized",
    [{ role: "developer", content: "You are an AI agent powered by DeepSeek Harness.\nx" }],
    (out) => out.messages[0].role === "system" && out.messages[0].content.split("\n")[0] === FALLBACK,
  ),
);

// The refused-content span (2026-10-28). MEASURED: with every identity clause
// already neutralised, a real 14454-character DSH prompt still answered 400 /
// 11128 because of THIS 111-character sentence in the MIDDLE of it. None of the
// identity rungs can reach a middle substring, so these three assertions pin the
// one thing that does: same sentence gone, meaning kept, everything else untouched.
const SPAN =
  "Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root";
// The replacement ends the sentence with a full stop so the host's own
// "; absolute paths identify …" continuation does not leave a half-width ";"
// glued to Chinese text — the span therefore swallows that semicolon too.
const SPAN_ZH = "以 @ 开头的标记是用户显式引用的路径，相对路径从工作区根目录解析。";

results.push(
  run(
    "refused content span is replaced with its Chinese equivalent",
    [{ role: "system", content: `Preamble line.\n\n${SPAN}\n\nFollowing paragraph.` }],
    (out) =>
      !out.messages[0].content.includes(SPAN) &&
      out.messages[0].content.includes(SPAN_ZH) &&
      out.messages[0].content.includes("Preamble line.") &&
      out.messages[0].content.includes("Following paragraph."),
  ),
);

results.push(
  run(
    "refused content span matches case-insensitively across a line wrap",
    [
      {
        role: "system",
        content:
          "TOKENS PREFIXED WITH @ ARE PATHS THE USER EXPLICITLY REFERENCED.\nRELATIVE PATHS RESOLVE FROM THE WORKSPACE ROOT\nEnd.",
      },
    ],
    (out) => out.messages[0].content.includes(SPAN_ZH) && out.messages[0].content.includes("End."),
  ),
);

results.push(
  run(
    "assistant history carrying the refused span is scanned too",
    [
      { role: "system", content: "clean system prompt" },
      { role: "user", content: "hi" },
      { role: "assistant", content: `${SPAN}` },
    ],
    (out) => out.messages[2].content === SPAN_ZH && !/[\u4e00-\u9fff];/u.test(out.messages[2].content),
  ),
);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
