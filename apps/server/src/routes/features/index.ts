/**
 * Features routes - HTTP API for feature management
 */

import { Router } from 'express';
import { FeatureLoader } from '../../services/feature-loader.js';
import type { SettingsService } from '../../services/settings-service.js';
import type { EventEmitter } from '../../lib/events.js';
import { validatePathParams } from '../../middleware/validate-paths.js';
import { createListHandler } from './routes/list.js';
import { createGetHandler } from './routes/get.js';
import { createCreateHandler } from './routes/create.js';
import { createUpdateHandler } from './routes/update.js';
import { createBulkUpdateHandler } from './routes/bulk-update.js';
import { createBulkDeleteHandler } from './routes/bulk-delete.js';
import { createDeleteHandler } from './routes/delete.js';
import { createAgentOutputHandler, createRawOutputHandler } from './routes/agent-output.js';
import { createGenerateTitleHandler } from './routes/generate-title.js';
import { createReconcilePlanHandler } from './routes/reconcile-plan.js';
import { createRebuildOutputHandler } from './routes/rebuild-output.js';
import { createTimelineHandler } from './routes/timeline.js';
import { createRecoveryCenterHandler } from './routes/recovery-center.js';
import { createResumePendingHandler } from './routes/resume-pending.js';
import { createRestoreDependenciesHandler } from './routes/restore-dependencies.js';
import type { AutoModeService } from '../../services/auto-mode-service.js';

export function createFeaturesRoutes(
  featureLoader: FeatureLoader,
  settingsService?: SettingsService,
  events?: EventEmitter,
  autoModeService?: AutoModeService | null
): Router {
  const router = Router();

  router.post('/list', validatePathParams('projectPath'), createListHandler(featureLoader));
  router.post('/get', validatePathParams('projectPath'), createGetHandler(featureLoader));
  router.post(
    '/create',
    validatePathParams('projectPath'),
    createCreateHandler(featureLoader, events)
  );
  router.post('/update', validatePathParams('projectPath'), createUpdateHandler(featureLoader));
  router.post(
    '/bulk-update',
    validatePathParams('projectPath'),
    createBulkUpdateHandler(featureLoader)
  );
  router.post(
    '/bulk-delete',
    validatePathParams('projectPath'),
    createBulkDeleteHandler(featureLoader)
  );
  router.post('/delete', validatePathParams('projectPath'), createDeleteHandler(featureLoader));
  router.post('/agent-output', createAgentOutputHandler(featureLoader));
  router.post('/raw-output', createRawOutputHandler(featureLoader));
  router.post('/generate-title', createGenerateTitleHandler(settingsService));
  router.post(
    '/reconcile-plan',
    validatePathParams('projectPath'),
    createReconcilePlanHandler(featureLoader)
  );
  router.post(
    '/rebuild-output',
    validatePathParams('projectPath'),
    createRebuildOutputHandler(featureLoader)
  );
  router.post(
    '/resume-pending',
    validatePathParams('projectPath'),
    createResumePendingHandler(featureLoader, autoModeService ?? null)
  );
  router.post(
    '/recovery-center',
    validatePathParams('projectPath'),
    createRecoveryCenterHandler(featureLoader)
  );
  router.post(
    '/restore-dependencies',
    validatePathParams('projectPath'),
    createRestoreDependenciesHandler(featureLoader)
  );
  router.post('/timeline', validatePathParams('projectPath'), createTimelineHandler(featureLoader));

  return router;
}
