/**
 * POST /resume-pending endpoint - reconcile and resume pending tasks for a feature
 */

import type { Request, Response } from 'express';
import type { Feature } from '@automaker/types';
import { FeatureLoader } from '../../../services/feature-loader.js';
import type { AutoModeService } from '../../../services/auto-mode-service.js';
import { getErrorMessage, logError } from '../common.js';
import { reconcileFeaturePlanSpec, hasPlanSpecChanges } from '../utils/plan-reconcile.js';
import { saveRebuiltOutput } from '../utils/rebuild-output-utils.js';

export function createResumePendingHandler(
  featureLoader: FeatureLoader,
  autoModeService?: AutoModeService | null
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId, useWorktrees } = req.body as {
        projectPath: string;
        featureId: string;
        useWorktrees?: boolean;
      };

      if (!projectPath || !featureId) {
        res.status(400).json({
          success: false,
          error: 'projectPath and featureId are required',
        });
        return;
      }

      if (!autoModeService) {
        res.status(500).json({ success: false, error: 'Auto mode service unavailable' });
        return;
      }

      const feature = await featureLoader.get(projectPath, featureId);
      if (!feature) {
        res.status(404).json({ success: false, error: 'Feature not found' });
        return;
      }

      const reconciled = await reconcileFeaturePlanSpec(projectPath, feature);
      if (!reconciled) {
        res.status(400).json({
          success: false,
          error: 'Feature has no plan to reconcile',
        });
        return;
      }

      const currentPlanSpec = feature.planSpec || {};
      const needsUpdate = hasPlanSpecChanges(currentPlanSpec, reconciled);
      const shouldDowngradeStatus =
        currentPlanSpec.status === 'approved' &&
        reconciled.tasksCompleted < reconciled.tasksTotal &&
        (feature.status === 'waiting_approval' ||
          feature.status === 'verified' ||
          feature.status === 'completed');

      let updatedFeature: Feature = feature;
      if (needsUpdate || shouldDowngradeStatus) {
        const updatedPlanSpec = {
          ...currentPlanSpec,
          tasks: reconciled.tasks,
          tasksCompleted: reconciled.tasksCompleted,
          tasksTotal: reconciled.tasksTotal,
          currentTaskId: reconciled.currentTaskId,
        };

        const updates: Partial<Feature> = {
          planSpec: updatedPlanSpec as any,
          updatedAt: new Date().toISOString(),
        };

        if (shouldDowngradeStatus) {
          updates.status = 'backlog';
        }

        updatedFeature = await featureLoader.update(projectPath, featureId, updates);
      }

      const tasksTotal = reconciled.tasksTotal;
      const tasksCompleted = reconciled.tasksCompleted;
      if (tasksTotal === 0 || tasksCompleted >= tasksTotal) {
        res.status(400).json({
          success: false,
          error: 'No pending tasks to resume',
          reconciled,
        });
        return;
      }

      await saveRebuiltOutput(
        projectPath,
        featureLoader,
        updatedFeature,
        reconciled.tasks,
        reconciled.missingFiles
      );

      autoModeService
        .resumeFeature(projectPath, featureId, useWorktrees ?? false)
        .catch((error) => {
          logError(error, 'Resume pending tasks failed');
        });

      res.json({
        success: true,
        reconciled,
      });
    } catch (error) {
      logError(error, 'Resume pending tasks failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
