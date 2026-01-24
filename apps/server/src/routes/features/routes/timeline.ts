/**
 * POST /timeline endpoint - get feature execution timeline
 */

import type { Request, Response } from 'express';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getErrorMessage, logError } from '../common.js';
import {
  reconcileFeaturePlanSpec,
  hasPlanSpecChanges,
  type ParsedTask,
} from '../utils/plan-reconcile.js';

interface TimelineEntry {
  id: string;
  type: 'feature_started' | 'plan_generated' | 'plan_approved' | 'task_started' | 'task_completed';
  title: string;
  detail?: string;
  timestamp: string;
}

function buildTimelineEntries(feature: any, tasks?: ParsedTask[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  if (feature.startedAt) {
    entries.push({
      id: `feature-started-${feature.startedAt}`,
      type: 'feature_started',
      title: 'Feature started',
      timestamp: feature.startedAt,
    });
  }

  if (feature.planSpec?.generatedAt) {
    entries.push({
      id: `plan-generated-${feature.planSpec.generatedAt}`,
      type: 'plan_generated',
      title: 'Execution plan generated',
      timestamp: feature.planSpec.generatedAt,
    });
  }

  if (feature.planSpec?.approvedAt) {
    entries.push({
      id: `plan-approved-${feature.planSpec.approvedAt}`,
      type: 'plan_approved',
      title: 'Execution plan approved',
      timestamp: feature.planSpec.approvedAt,
    });
  }

  if (tasks && tasks.length > 0) {
    for (const task of tasks) {
      if (task.startedAt) {
        entries.push({
          id: `task-started-${task.id}-${task.startedAt}`,
          type: 'task_started',
          title: `${task.id} started`,
          detail: task.description,
          timestamp: task.startedAt,
        });
      }

      if (task.completedAt) {
        entries.push({
          id: `task-completed-${task.id}-${task.completedAt}`,
          type: 'task_completed',
          title: `${task.id} completed`,
          detail: task.filePath ? `${task.description} (${task.filePath})` : task.description,
          timestamp: task.completedAt,
        });
      }
    }
  }

  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function createTimelineHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId } = req.body as {
        projectPath: string;
        featureId: string;
      };

      if (!projectPath || !featureId) {
        res.status(400).json({
          success: false,
          error: 'projectPath and featureId are required',
        });
        return;
      }

      const feature = await featureLoader.get(projectPath, featureId);
      if (!feature) {
        res.status(404).json({ success: false, error: 'Feature not found' });
        return;
      }

      const reconciled = await reconcileFeaturePlanSpec(projectPath, feature);
      let updatedFeature = feature;

      if (reconciled && hasPlanSpecChanges(feature.planSpec || {}, reconciled)) {
        const updatedPlanSpec = {
          ...feature.planSpec,
          tasks: reconciled.tasks,
          tasksCompleted: reconciled.tasksCompleted,
          tasksTotal: reconciled.tasksTotal,
          currentTaskId: reconciled.currentTaskId,
        };
        updatedFeature = await featureLoader.update(projectPath, featureId, {
          planSpec: updatedPlanSpec as any,
          updatedAt: new Date().toISOString(),
        });
      }

      const planTasks = (updatedFeature.planSpec as any)?.tasks as ParsedTask[] | undefined;
      const timeline = buildTimelineEntries(updatedFeature, planTasks);

      res.json({ success: true, timeline });
    } catch (error) {
      logError(error, 'Get timeline failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
