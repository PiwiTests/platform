import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ALL_SKILLS,
  findTemplatesDir,
  installSkills,
  listSkills,
  runSkills,
  SETUP_SKILL,
  WORKFLOW_SKILLS,
} from '../src/cli/skills.js';

const TEMPLATES = path.join(import.meta.dirname, '..', 'templates');

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-skills-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('skill templates ship with the package', () => {
  it('has a SKILL.md with front matter for every declared skill', () => {
    const infos = listSkills(TEMPLATES);
    expect(infos.map((i) => i.slug).sort()).toEqual([...ALL_SKILLS].sort());
    for (const info of infos) {
      expect(info.name).toBeTruthy();
      expect(info.description.length).toBeGreaterThan(20);
    }
  });

  it('separates the setup skill from the workflow skills', () => {
    expect(ALL_SKILLS).toContain(SETUP_SKILL);
    expect(WORKFLOW_SKILLS).not.toContain(SETUP_SKILL);
    expect(WORKFLOW_SKILLS.length).toBe(4);
  });
});

describe('findTemplatesDir', () => {
  it('locates templates/ from a directory inside the package', () => {
    expect(findTemplatesDir(path.join(import.meta.dirname, '..', 'src', 'cli'))).toBe(TEMPLATES);
  });
});

describe('installSkills', () => {
  it('writes each requested skill as <dir>/<slug>/SKILL.md', () => {
    const results = installSkills({
      templatesDir: TEMPLATES,
      root,
      skillsDir: '.claude/skills',
      slugs: WORKFLOW_SKILLS,
      force: false,
      dryRun: false,
    });
    expect(results.every((r) => r.status === 'created')).toBe(true);
    for (const slug of WORKFLOW_SKILLS) {
      const file = path.join(root, '.claude', 'skills', slug, 'SKILL.md');
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf-8')).toContain(`name: ${slug}`);
    }
  });

  it('writes nothing under --dry-run but still reports what it would create', () => {
    const results = installSkills({
      templatesDir: TEMPLATES,
      root,
      skillsDir: '.claude/skills',
      slugs: [SETUP_SKILL],
      force: false,
      dryRun: true,
    });
    expect(results[0].status).toBe('created');
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  });

  it('is idempotent: an unchanged reinstall reports already, a divergent one is skipped without --force', () => {
    const opts = { templatesDir: TEMPLATES, root, skillsDir: '.claude/skills', slugs: [SETUP_SKILL], force: false, dryRun: false };
    installSkills(opts);
    expect(installSkills(opts)[0].status).toBe('already');

    const file = path.join(root, '.claude', 'skills', SETUP_SKILL, 'SKILL.md');
    fs.writeFileSync(file, 'edited by hand');
    expect(installSkills(opts)[0].status).toBe('skipped');
    expect(fs.readFileSync(file, 'utf-8')).toBe('edited by hand');

    const forced = installSkills({ ...opts, force: true });
    expect(forced[0].status).toBe('updated');
    expect(fs.readFileSync(file, 'utf-8')).toContain(`name: ${SETUP_SKILL}`);
  });

  it('honors a custom skills directory', () => {
    installSkills({
      templatesDir: TEMPLATES,
      root,
      skillsDir: '.cursor/skills',
      slugs: [SETUP_SKILL],
      force: false,
      dryRun: false,
    });
    expect(fs.existsSync(path.join(root, '.cursor', 'skills', SETUP_SKILL, 'SKILL.md'))).toBe(true);
  });
});

describe('runSkills', () => {
  it('rejects an unknown skill name with exit 2', () => {
    expect(runSkills(['add', 'not-a-skill', '--cwd', root], TEMPLATES)).toBe(2);
  });

  it('installs all skills when none are named', () => {
    expect(runSkills(['add', '--cwd', root], TEMPLATES)).toBe(0);
    for (const slug of ALL_SKILLS) {
      expect(fs.existsSync(path.join(root, '.claude', 'skills', slug, 'SKILL.md'))).toBe(true);
    }
  });

  it('lists skills and exits 0', () => {
    expect(runSkills(['list'], TEMPLATES)).toBe(0);
  });
});
