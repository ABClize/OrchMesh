import { readFile } from "node:fs/promises";
// Parse skill metadata and bodies using the pinned official DSH provider.
import { Context } from '@deepseek-ai/cordis';
import Skills from '@deepseek-ai/dsh-skill';
import * as Filesystem from '@deepseek-ai/dsh-skill-filesystem';
import { dirname } from 'node:path';
const ctx = new Context();
try {
  await ctx.plugin(Skills);
  await ctx.plugin(Filesystem, { includeDefaultRoots: false, customSkillDirs: [dirname(process.argv[2])], watch: false });
  const entries = await ctx.skills.list();
  const selected = entries.find(s => s.resourceBase?.path === process.argv[2]);
  if (!selected) throw new Error('Invalid skill');
  const value = await ctx.skills.get(selected.name);
  const { name, description, content, invocation, metadata } = value;
  const raw = await readFile(process.argv[2] + '/SKILL.md', 'utf8');
  const unsupported = ['hooks','context','agent','allowed-tools'].filter(k => new RegExp('^' + k + ':', 'm').test(raw.split('---')[1] ?? ''));
  process.stdout.write(JSON.stringify({name, description, content, invocation, metadata, warnings: unsupported.map(k => `未映射的专属配置：${k}`)}));
} finally { await ctx.fiber.dispose(); }
