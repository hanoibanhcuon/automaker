/**
 * Helpers for rebuilding agent output from plan/task state.
 */

import type { Feature } from '@automaker/types';
import type { FeatureLoader } from '../../../services/feature-loader.js';
import * as secureFs from '../../../lib/secure-fs.js';
import path from 'path';
import type { ParsedTask } from './plan-reconcile.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export async function buildRebuiltOutput(
  projectPath: string,
  feature: Feature,
  tasks: ParsedTask[] | undefined,
  missingFiles: string[]
): Promise<string> {
  const title = feature.title || feature.id;
  const now = new Date().toISOString();
  const planSpec = feature.planSpec as any;
  const tasksTotal = planSpec?.tasksTotal ?? tasks?.length ?? 0;
  const tasksCompleted = planSpec?.tasksCompleted ?? 0;

  const fileRows: string[] = [];
  if (tasks) {
    for (const task of tasks) {
      if (!task.filePath) continue;
      const resolvedPath = path.isAbsolute(task.filePath)
        ? task.filePath
        : path.join(projectPath, task.filePath);
      try {
        const stat = await secureFs.stat(resolvedPath);
        fileRows.push(
          `- ${task.filePath} (size: ${formatBytes(stat.size)}, modified: ${stat.mtime.toISOString()})`
        );
      } catch {
        // Missing files are covered in the missing files section.
      }
    }
  }

  const taskLines =
    tasks?.map((task) => {
      const statusMark =
        task.status === 'completed' ? 'x' : task.status === 'in_progress' ? '>' : ' ';
      const fileText = task.filePath ? ` | File: ${task.filePath}` : '';
      return `- [${statusMark}] ${task.id}: ${task.description}${fileText}`;
    }) ?? [];

  const missingSection =
    missingFiles.length > 0
      ? `\n## Missing Files\n${missingFiles.map((file) => `- ${file}`).join('\n')}\n`
      : '\n## Missing Files\n- None\n';

  return `# Rebuilt Output\n\nFeature: ${title}\nFeature ID: ${feature.id}\nRebuilt At: ${now}\n\n## Plan Summary\n- Plan Status: ${planSpec?.status || 'unknown'}\n- Progress: ${tasksCompleted}/${tasksTotal}\n\n## Task Status\n${taskLines.join('\n') || '- No tasks found'}\n\n## Files Found\n${fileRows.join('\n') || '- No files found'}\n${missingSection}`;
}

export async function saveRebuiltOutput(
  projectPath: string,
  featureLoader: FeatureLoader,
  feature: Feature,
  tasks: ParsedTask[] | undefined,
  missingFiles: string[]
): Promise<string> {
  const rebuiltContent = await buildRebuiltOutput(projectPath, feature, tasks, missingFiles);
  await featureLoader.saveAgentOutput(projectPath, feature.id, rebuiltContent);
  return rebuiltContent;
}
