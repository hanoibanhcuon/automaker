import path from 'path';
import type { Feature } from '@automaker/types';
import { createLogger } from '@automaker/utils';
import * as secureFs from '../../../lib/secure-fs.js';

const logger = createLogger('features/plan-reconcile');

export interface ParsedTask {
  id: string;
  description: string;
  filePath?: string;
  phase?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
}

export interface PlanReconcileResult {
  tasks: ParsedTask[];
  tasksCompleted: number;
  tasksTotal: number;
  currentTaskId?: string;
  missingFiles: string[];
}

function sanitizeWorktreeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getWorktreeRoots(projectPath: string, feature: Feature): string[] {
  const roots: string[] = [];
  const worktreesDir = path.join(projectPath, '.worktrees');

  if (feature.branchName) {
    roots.push(path.join(worktreesDir, sanitizeWorktreeName(feature.branchName)));
  }

  if (feature.id) {
    roots.push(path.join(worktreesDir, sanitizeWorktreeName(feature.id)));
  }

  return roots;
}

function normalizeTaskId(rawId: string): string | null {
  const digits = rawId.replace(/\D/g, '');
  if (!digits) return null;
  return `T${digits.padStart(3, '0')}`;
}

function parseTaskLineFlexible(line: string, currentPhase?: string): ParsedTask | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/^-\s*\[\s*\]\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^-\s*/, '')
    .trim();

  const taskMatch =
    normalized.match(/^(T\d+)\s*[:\-]\s*([^|]+)(?:\|\s*File:\s*(.+))?$/i) ||
    normalized.match(/^(?:Task)\s*(\d+)\s*[:\-]\s*([^|]+)(?:\|\s*File:\s*(.+))?$/i);

  if (!taskMatch) return null;

  const normalizedId = normalizeTaskId(taskMatch[1]);
  if (!normalizedId) return null;

  return {
    id: normalizedId,
    description: taskMatch[2].trim(),
    filePath: taskMatch[3]?.trim(),
    phase: currentPhase,
    status: 'pending',
  };
}

function parseTasksFromContent(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  if (!content) return tasks;

  const tasksBlockMatch = content.match(/```tasks\s*([\s\S]*?)```/);
  const source = tasksBlockMatch ? tasksBlockMatch[1] : content;
  const lines = source.split('\n');

  let currentPhase: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const phaseMatch = trimmed.match(/^##\s*(.+)$/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }

    if (!/T\d+|Task\s*\d+/i.test(trimmed)) continue;
    const parsed = parseTaskLineFlexible(trimmed, currentPhase);
    if (parsed) tasks.push(parsed);
  }

  return tasks;
}

export async function reconcileFeaturePlanSpec(
  projectPath: string,
  feature: Feature
): Promise<PlanReconcileResult | null> {
  const planSpec = (feature.planSpec as { tasks?: ParsedTask[]; content?: string }) || null;
  if (!planSpec) {
    (feature as any).planSpec = {};
  }
  const resolvedPlanSpec =
    (feature.planSpec as { tasks?: ParsedTask[]; content?: string }) || planSpec;
  if (
    (!resolvedPlanSpec?.tasks || resolvedPlanSpec.tasks.length === 0) &&
    resolvedPlanSpec?.content
  ) {
    const parsedTasks = parseTasksFromContent(resolvedPlanSpec.content);
    if (parsedTasks.length > 0) {
      resolvedPlanSpec.tasks = parsedTasks;
    }
  }

  if (
    (!resolvedPlanSpec?.tasks || resolvedPlanSpec.tasks.length === 0) &&
    !resolvedPlanSpec?.content
  ) {
    try {
      const outputPath = path.join(
        projectPath,
        '.automaker',
        'features',
        feature.id,
        'agent-output.md'
      );
      const output = (await secureFs.readFile(outputPath, 'utf-8')) as string;
      const markerIndex = output.indexOf('[SPEC_GENERATED]');
      const planContent = markerIndex > 0 ? output.substring(0, markerIndex).trim() : output.trim();
      const parsedTasks = parseTasksFromContent(planContent);
      if (parsedTasks.length > 0) {
        resolvedPlanSpec.tasks = parsedTasks;
        resolvedPlanSpec.content = planContent;
      }
    } catch {
      // ignore missing output
    }
  }

  if (!resolvedPlanSpec?.tasks || resolvedPlanSpec.tasks.length === 0) {
    return null;
  }

  const tasks: ParsedTask[] = resolvedPlanSpec.tasks.map((task) => ({
    ...task,
    status: task.status || 'pending',
  }));

  const missingFiles: string[] = [];
  const worktreeRoots = getWorktreeRoots(projectPath, feature);

  for (const task of tasks) {
    if (task.status === 'in_progress' && !task.startedAt && feature.startedAt) {
      task.startedAt = feature.startedAt;
    }
    if (!task.filePath) {
      continue;
    }

    const candidatePaths: string[] = [];
    if (path.isAbsolute(task.filePath)) {
      candidatePaths.push(task.filePath);
    } else {
      candidatePaths.push(path.join(projectPath, task.filePath));
      for (const root of worktreeRoots) {
        candidatePaths.push(path.join(root, task.filePath));
      }
    }

    let found = false;
    for (const candidate of candidatePaths) {
      try {
        const stat = await secureFs.stat(candidate);
        task.status = 'completed';
        if (!task.completedAt) {
          task.completedAt = stat.mtime.toISOString();
        }
        found = true;
        break;
      } catch {
        // continue
      }
    }

    if (!found) {
      missingFiles.push(task.filePath);
      if (task.status !== 'failed') {
        task.status = 'pending';
      }
    }
  }

  const tasksCompleted = tasks.filter((task) => task.status === 'completed').length;
  const tasksTotal = tasks.length;
  const nextPending = tasks.find((task) => task.status !== 'completed');

  logger.info(
    `Reconciled ${feature.id}: ${tasksCompleted}/${tasksTotal} tasks completed, ${missingFiles.length} missing files`
  );

  return {
    tasks,
    tasksCompleted,
    tasksTotal,
    currentTaskId: nextPending?.id,
    missingFiles,
  };
}

export function hasPlanSpecChanges(currentPlanSpec: any, reconciled: PlanReconcileResult): boolean {
  const currentTasks = currentPlanSpec?.tasks || [];
  const tasksChanged = JSON.stringify(currentTasks) !== JSON.stringify(reconciled.tasks);

  if (tasksChanged) return true;
  if ((currentPlanSpec?.tasksCompleted ?? 0) !== reconciled.tasksCompleted) return true;
  if ((currentPlanSpec?.tasksTotal ?? 0) !== reconciled.tasksTotal) return true;
  if ((currentPlanSpec?.currentTaskId ?? null) !== (reconciled.currentTaskId ?? null)) return true;

  return false;
}
