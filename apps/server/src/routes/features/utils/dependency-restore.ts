import type { Feature } from '@automaker/types';
import * as secureFs from '../../../lib/secure-fs.js';

const MAX_BACKUPS = 3;

const normalizeDependencies = (deps: string[]): string[] => {
  const set = new Set<string>();
  deps.forEach((dep) => {
    const value = dep.trim();
    if (!value) return;
    set.add(value);
  });
  return Array.from(set);
};

export async function readBackupDependencies(
  featureJsonPath: string,
  maxBackups: number = MAX_BACKUPS
): Promise<string[]> {
  const dependencies = new Set<string>();

  for (let i = 1; i <= maxBackups; i += 1) {
    const backupPath = `${featureJsonPath}.bak${i}`;
    try {
      const content = (await secureFs.readFile(backupPath, 'utf-8')) as string;
      const data = JSON.parse(content) as Feature;
      if (Array.isArray(data.dependencies)) {
        data.dependencies.forEach((dep) => dependencies.add(dep));
      }
    } catch {
      // Ignore missing/corrupt backups
    }
  }

  return Array.from(dependencies);
}

export function extractDependenciesFromPlan(content?: string): string[] {
  if (!content) return [];
  const dependencies = new Set<string>();
  const lines = content.split(/\r?\n/);

  const addCandidates = (value: string) => {
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((dep) => dependencies.add(dep));
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!/dependencies?/i.test(line)) continue;

    const bracketMatch = line.match(/dependencies?\s*:\s*\[([^\]]+)\]/i);
    if (bracketMatch) {
      addCandidates(bracketMatch[1]);
      continue;
    }

    const inlineMatch = line.match(/dependencies?\s*:\s*(.+)$/i);
    if (inlineMatch && inlineMatch[1]) {
      addCandidates(inlineMatch[1]);
      continue;
    }

    if (/^dependencies?\s*:?$/i.test(line)) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextLine = lines[j].trim();
        if (!nextLine) break;
        if (nextLine.startsWith('#')) break;
        const bulletMatch = nextLine.match(/^[-*+]\s*([A-Za-z0-9:_-]+)/);
        if (bulletMatch) {
          dependencies.add(bulletMatch[1]);
        } else {
          break;
        }
      }
    }
  }

  return Array.from(dependencies);
}

export function getDependencyRestoreCandidates({
  feature,
  allFeatureIds,
  backupDependencies,
  planDependencies,
}: {
  feature: Feature;
  allFeatureIds: Set<string>;
  backupDependencies: string[];
  planDependencies: string[];
}): {
  candidates: string[];
  missing: string[];
} {
  const currentDeps = new Set<string>((feature.dependencies ?? []).filter(Boolean));
  const candidates = normalizeDependencies([...backupDependencies, ...planDependencies]).filter(
    (dep) => dep !== feature.id
  );

  const missing = candidates.filter((dep) => !currentDeps.has(dep) && allFeatureIds.has(dep));

  return {
    candidates,
    missing,
  };
}
