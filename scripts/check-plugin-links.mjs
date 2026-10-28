#!/usr/bin/env node
/**
 * dsh-link-check — detect plugin links that resolve on one DSH home path but not another.
 *
 * WHY THIS EXISTS
 * A DSH home is often a junction (C:\Users\<user>\.dsh -> D:\DSH-Home). The app boots
 * through the junction path while pnpm installs in the junction's target. When a
 * dependency is a link: target on the same drive as the profile, pnpm records it
 * RELATIVE (e.g. ..\..\..\..\deepseek-harness\plugins\harness-eval), and a relative
 * link resolves against whichever path reaches it. It works through one route and
 * dangles through the other, so the plugin shows 包不可用 / 包元信息错误 and silently
 * stops loading.
 *
 * WHAT IT CHECKS
 * Every link under <home>/profiles/<profile>/node_modules must resolve through EVERY
 * route that reaches that profile's directory: the configured home path and its
 * junction target.
 *
 * EXIT CODES
 *   0 every link resolves on every route
 *   1 at least one link dangles on some route
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

/** Sibling paths that refer to the same directory: as configured, and its junction target. */
function homeRoutes(home) {
  const routes = [];
  const push = (p) => {
    if (!p) return;
    const abs = path.resolve(p);
    if (!routes.includes(abs) && fs.existsSync(abs)) routes.push(abs);
  };
  push(home);
  try {
    push(fs.realpathSync.native(home));
  } catch {
    /* an unreachable home is reported by the caller */
  }
  return routes;
}

const SKIP = new Set(['.pnpm', '.bin', '.ignored', '.pnpm-workspace-state-v1.json', '.modules.yaml']);

function isLink(p) {
  try {
    fs.readlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Every link under a node_modules directory, as paths relative to it. */
function linkNames(nodeModules) {
  const names = [];
  let entries;
  try {
    entries = fs.readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      let scoped = [];
      try {
        scoped = fs.readdirSync(full);
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (isLink(path.join(full, child))) names.push(entry.name + '/' + child);
      }
      continue;
    }
    if (isLink(full)) names.push(entry.name);
  }
  return names;
}

function main() {
  const routes = homeRoutes(HOME);
  if (routes.length === 0) {
    console.log('dsh-link-check: cannot read DSH home at ' + HOME);
    return 2;
  }

  // One entry per (profile, link) pair, checked against every route.
  const seen = new Map();

  for (const route of routes) {
    const profilesDir = path.join(route, 'profiles');
    let profiles;
    try {
      profiles = fs.readdirSync(profilesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const profile of profiles) {
      const nodeModules = path.join(profilesDir, profile, 'node_modules');
      for (const name of linkNames(nodeModules)) {
        const key = profile + '\u0000' + name;
        if (seen.has(key)) continue;
        const record = { profile, name, target: '', dead: [], checked: routes.length };
        try {
          record.target = fs.readlinkSync(path.join(nodeModules, name));
        } catch {
          record.target = '(unreadable)';
        }
        seen.set(key, record);
      }
    }
  }

  if (seen.size === 0) {
    console.log('dsh-link-check: no plugin links under ' + HOME);
    return 0;
  }

  let broken = 0;
  for (const record of seen.values()) {
    for (const route of routes) {
      const probe = path.join(route, 'profiles', record.profile, 'node_modules', record.name);
      if (!fs.existsSync(probe)) record.dead.push(route);
    }
    if (record.dead.length === 0) {
      console.log('  ok      ' + record.profile.padEnd(8) + record.name);
      continue;
    }
    broken++;
    console.log('  BROKEN  ' + record.profile.padEnd(8) + record.name);
    console.log('          target:      ' + record.target);
    for (const route of record.dead) console.log('          dangles via: ' + route);
  }

  console.log('');
  if (broken === 0) {
    console.log('dsh-link-check: all ' + seen.size + ' link(s) resolve on every route (' + routes.length + ' route(s))');
    return 0;
  }
  console.log('dsh-link-check: ' + broken + ' of ' + seen.size + ' link(s) dangle on at least one route.');
  console.log('This is what surfaces as 包不可用 / 包元信息错误, with the plugin silently unloaded.');
  console.log('Fix one link by replacing it with an absolute target:');
  console.log('  cmd /c rmdir "<link>"');
  console.log('  cmd /c mklink /J "<link>" "<absolute target>"');
  return 1;
}

process.exit(main());
