/**
 * POST /recovery-center endpoint - Aggregate features that need recovery actions
 */

import type { Request, Response } from 'express';
import type { Feature } from '@automaker/types';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getErrorMessage, logError } from '../common.js';
import { reconcileFeaturePlanSpec, hasPlanSpecChanges } from '../utils/plan-reconcile.js';
import * as secureFs from '../../../lib/secure-fs.js';

interface RecoveryItem {
  featureId: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  providerId?: string;
  model?: string;
  planningMode?: string;
  error?: string;
  plan: {
    tasksCompleted: number;
    tasksTotal: number;
    currentTaskId?: string;
    status?: string;
  } | null;
  missingFiles: string[];
  hasAgentOutput: boolean;
  issues: string[];
  canResume: boolean;
  canRebuild: boolean;
}

export function createRecoveryCenterHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath } = req.body as { projectPath: string };

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const features = await featureLoader.getAll(projectPath);

      const items: RecoveryItem[] = [];
      let missingFilesCount = 0;
      let incompletePlansCount = 0;
      let missingOutputCount = 0;

      for (const feature of features) {
        const reconciled = await reconcileFeaturePlanSpec(projectPath, feature);
        let updatedFeature: Feature = feature;

        if (reconciled) {
          const currentPlanSpec = feature.planSpec || {};
          const needsUpdate = hasPlanSpecChanges(currentPlanSpec, reconciled);
          const shouldDowngradeStatus =
            currentPlanSpec.status === 'approved' &&
            reconciled.tasksCompleted < reconciled.tasksTotal &&
            (feature.status === 'waiting_approval' ||
              feature.status === 'verified' ||
              feature.status === 'completed');

          if (needsUpdate || shouldDowngradeStatus) {
            const updatedPlanSpec = {
              ...currentPlanSpec,
              tasks: reconciled.tasks,
              tasksCompleted: reconciled.tasksCompleted,
              tasksTotal: reconciled.tasksTotal,
              currentTaskId: reconciled.currentTaskId,
            };

            updatedFeature = await featureLoader.update(projectPath, feature.id, {
              planSpec: updatedPlanSpec as any,
              ...(shouldDowngradeStatus ? { status: 'backlog' } : {}),
              updatedAt: new Date().toISOString(),
            });
          }
        }

        const planSpec = updatedFeature.planSpec as any;
        const tasksTotal = planSpec?.tasksTotal ?? reconciled?.tasksTotal ?? 0;
        const tasksCompleted = planSpec?.tasksCompleted ?? reconciled?.tasksCompleted ?? 0;
        const missingFiles = reconciled?.missingFiles ?? [];
        const hasPlan = tasksTotal > 0;
        const incompletePlan = hasPlan && tasksCompleted < tasksTotal;

        const agentOutputPath = featureLoader.getAgentOutputPath(projectPath, feature.id);
        let hasAgentOutput = true;
        try {
          await secureFs.access(agentOutputPath);
        } catch {
          hasAgentOutput = false;
        }

        const issues: string[] = [];
        const hasError =
          typeof updatedFeature.error === 'string' && updatedFeature.error.trim().length > 0;
        const hasFailedStatus =
          updatedFeature.status === 'failed' || updatedFeature.status === 'error';
        if (hasError || hasFailedStatus) {
          issues.push('Execution error');
        }
        if (incompletePlan) {
          issues.push('Plan incomplete');
        }
        if (missingFiles.length > 0) {
          issues.push('Missing expected files');
        }
        if (!hasAgentOutput) {
          issues.push('Agent output missing');
        }

        const statusMismatch =
          planSpec?.status === 'approved' &&
          incompletePlan &&
          (updatedFeature.status === 'waiting_approval' ||
            updatedFeature.status === 'verified' ||
            updatedFeature.status === 'completed');
        if (statusMismatch) {
          issues.push('Status out of sync with plan');
        }

        if (issues.length === 0) {
          continue;
        }

        if (missingFiles.length > 0) missingFilesCount += missingFiles.length;
        if (incompletePlan) incompletePlansCount += 1;
        if (!hasAgentOutput) missingOutputCount += 1;

        items.push({
          featureId: updatedFeature.id,
          title: updatedFeature.title,
          status: updatedFeature.status,
          updatedAt: updatedFeature.updatedAt,
          providerId: updatedFeature.providerId,
          model: updatedFeature.model,
          planningMode: updatedFeature.planningMode,
          error: updatedFeature.error,
          plan: hasPlan
            ? {
                tasksCompleted,
                tasksTotal,
                currentTaskId: planSpec?.currentTaskId,
                status: planSpec?.status,
              }
            : null,
          missingFiles,
          hasAgentOutput,
          issues,
          canResume: incompletePlan,
          canRebuild: !hasAgentOutput || missingFiles.length > 0,
        });
      }

      res.json({
        success: true,
        summary: {
          total: items.length,
          incompletePlans: incompletePlansCount,
          missingFiles: missingFilesCount,
          missingOutputs: missingOutputCount,
        },
        items,
      });
    } catch (error) {
      logError(error, 'Recovery center failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
