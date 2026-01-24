/**
 * POST /rebuild-output endpoint - rebuild agent output from filesystem
 */

import type { Request, Response } from 'express';
import type { Feature } from '@automaker/types';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getErrorMessage, logError } from '../common.js';
import {
  reconcileFeaturePlanSpec,
  hasPlanSpecChanges,
  type ParsedTask,
} from '../utils/plan-reconcile.js';
import { saveRebuiltOutput } from '../utils/rebuild-output-utils.js';

export function createRebuildOutputHandler(featureLoader: FeatureLoader) {
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
      let missingFiles: string[] = [];
      let shouldDowngradeStatus = false;

      if (reconciled) {
        missingFiles = reconciled.missingFiles;
        const currentPlanSpec = feature.planSpec || {};
        shouldDowngradeStatus =
          currentPlanSpec.status === 'approved' &&
          reconciled.tasksCompleted < reconciled.tasksTotal &&
          (feature.status === 'waiting_approval' ||
            feature.status === 'verified' ||
            feature.status === 'completed');

        if (hasPlanSpecChanges(currentPlanSpec, reconciled) || shouldDowngradeStatus) {
          const updatedPlanSpec = {
            ...currentPlanSpec,
            tasks: reconciled.tasks,
            tasksCompleted: reconciled.tasksCompleted,
            tasksTotal: reconciled.tasksTotal,
            currentTaskId: reconciled.currentTaskId,
          };
          updatedFeature = await featureLoader.update(projectPath, featureId, {
            planSpec: updatedPlanSpec as any,
            ...(shouldDowngradeStatus ? { status: 'backlog' } : {}),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      const planTasks = (updatedFeature.planSpec as any)?.tasks as ParsedTask[] | undefined;
      const rebuiltContent = await saveRebuiltOutput(
        projectPath,
        featureLoader,
        updatedFeature,
        planTasks,
        missingFiles
      );

      res.json({
        success: true,
        content: rebuiltContent,
        missingFiles,
      });
    } catch (error) {
      logError(error, 'Rebuild output failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
