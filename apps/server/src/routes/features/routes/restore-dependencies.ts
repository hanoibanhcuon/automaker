/**
 * POST /restore-dependencies endpoint - Restore missing dependencies from history/plan
 */

import type { Request, Response } from 'express';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getErrorMessage, logError } from '../common.js';
import {
  readBackupDependencies,
  extractDependenciesFromPlan,
  getDependencyRestoreCandidates,
} from '../utils/dependency-restore.js';

export function createRestoreDependenciesHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId, featureIds, dryRun } = req.body as {
        projectPath: string;
        featureId?: string;
        featureIds?: string[];
        dryRun?: boolean;
      };

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const allFeatures = await featureLoader.getAll(projectPath);
      const allFeatureIds = new Set(allFeatures.map((feature) => feature.id));

      const targetIds = featureId
        ? [featureId]
        : Array.isArray(featureIds) && featureIds.length > 0
          ? featureIds
          : allFeatures.map((feature) => feature.id);

      const featureMap = new Map(allFeatures.map((feature) => [feature.id, feature]));
      const results: Array<{
        featureId: string;
        restoredDependencies: string[];
        candidates: string[];
      }> = [];

      let restoredCount = 0;

      for (const id of targetIds) {
        const feature = featureMap.get(id);
        if (!feature) {
          results.push({ featureId: id, restoredDependencies: [], candidates: [] });
          continue;
        }

        const featureJsonPath = featureLoader.getFeatureJsonPath(projectPath, id);
        const backupDependencies = await readBackupDependencies(featureJsonPath);
        const planDependencies = extractDependenciesFromPlan(feature.planSpec?.content);

        const { candidates, missing } = getDependencyRestoreCandidates({
          feature,
          allFeatureIds,
          backupDependencies,
          planDependencies,
        });

        if (!dryRun && missing.length > 0) {
          const nextDependencies = Array.from(
            new Set([...(feature.dependencies ?? []), ...missing])
          );
          await featureLoader.update(projectPath, id, {
            dependencies: nextDependencies.length > 0 ? nextDependencies : undefined,
            updatedAt: new Date().toISOString(),
          });
          restoredCount += missing.length;
        }

        results.push({
          featureId: id,
          restoredDependencies: missing,
          candidates,
        });
      }

      res.json({
        success: true,
        summary: {
          processed: targetIds.length,
          restoredCount,
        },
        results,
      });
    } catch (error) {
      logError(error, 'Restore dependencies failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
