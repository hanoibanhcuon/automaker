/**
 * POST /reconcile-plan endpoint - reconcile planSpec tasks with filesystem
 */

import type { Request, Response } from 'express';
import type { Feature } from '@automaker/types';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getErrorMessage, logError } from '../common.js';
import { reconcileFeaturePlanSpec, hasPlanSpecChanges } from '../utils/plan-reconcile.js';
import { saveRebuiltOutput } from '../utils/rebuild-output-utils.js';

export function createReconcilePlanHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId, rebuildOutput } = req.body as {
        projectPath: string;
        featureId: string;
        rebuildOutput?: boolean;
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
      if (!reconciled) {
        if (rebuildOutput !== false) {
          const planTasks = (feature.planSpec as any)?.tasks;
          await saveRebuiltOutput(projectPath, featureLoader, feature, planTasks, []);
        }
        res.json({ success: true, feature, reconciled: null });
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

      if (!needsUpdate && !shouldDowngradeStatus) {
        if (rebuildOutput !== false) {
          await saveRebuiltOutput(
            projectPath,
            featureLoader,
            feature,
            reconciled.tasks,
            reconciled.missingFiles
          );
        }
        res.json({ success: true, feature, reconciled });
        return;
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

      const updatedFeature = await featureLoader.update(projectPath, featureId, updates);
      if (rebuildOutput !== false) {
        await saveRebuiltOutput(
          projectPath,
          featureLoader,
          updatedFeature,
          reconciled.tasks,
          reconciled.missingFiles
        );
      }
      res.json({
        success: true,
        feature: updatedFeature,
        reconciled: { ...reconciled, statusAdjusted: shouldDowngradeStatus },
      });
    } catch (error) {
      logError(error, 'Reconcile plan failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
