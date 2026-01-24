/**
 * POST /list endpoint - List all features for a project
 */

import type { Request, Response } from 'express';
import { FeatureLoader } from '../../../services/feature-loader.js';
import type { Feature } from '@automaker/types';
import { getErrorMessage, logError } from '../common.js';
import { reconcileFeaturePlanSpec, hasPlanSpecChanges } from '../utils/plan-reconcile.js';

export function createListHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath } = req.body as { projectPath: string };

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const features = await featureLoader.getAll(projectPath);

      const reconciledFeatures = await Promise.all(
        features.map(async (feature) => {
          const reconciled = await reconcileFeaturePlanSpec(projectPath, feature);
          if (!reconciled) {
            return feature;
          }

          const currentPlanSpec = feature.planSpec || {};
          const needsUpdate = hasPlanSpecChanges(currentPlanSpec, reconciled);

          const shouldDowngradeStatus =
            currentPlanSpec.status === 'approved' &&
            reconciled.tasksCompleted < reconciled.tasksTotal &&
            (feature.status === 'waiting_approval' ||
              feature.status === 'verified' ||
              feature.status === 'completed');

          if (!needsUpdate && !shouldDowngradeStatus) {
            return feature;
          }

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

          return featureLoader.update(projectPath, feature.id, updates);
        })
      );

      res.json({ success: true, features: reconciledFeatures });
    } catch (error) {
      logError(error, 'List features failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
