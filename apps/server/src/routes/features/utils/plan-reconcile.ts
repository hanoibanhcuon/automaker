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

export async function reconcileFeaturePlanSpec(
  projectPath: string,
  feature: Feature
): Promise<PlanReconcileResult | null> {
  const planSpec = (feature.planSpec as { tasks?: ParsedTask[] }) || null;
  if (!planSpec?.tasks || planSpec.tasks.length === 0) {
    return null;
  }

  const tasks: ParsedTask[] = planSpec.tasks.map((task) => ({
    ...task,
    status: task.status || 'pending',
  }));

  const missingFiles: string[] = [];

  for (const task of tasks) {
    if (task.status === 'in_progress' && !task.startedAt && feature.startedAt) {
      task.startedAt = feature.startedAt;
    }
    if (!task.filePath) {
      continue;
    }

    const resolvedPath = path.isAbsolute(task.filePath)
      ? task.filePath
      : path.join(projectPath, task.filePath);

    try {
      const stat = await secureFs.stat(resolvedPath);
      task.status = 'completed';
      if (!task.completedAt) {
        task.completedAt = stat.mtime.toISOString();
      }
    } catch {
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
