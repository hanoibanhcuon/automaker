import { memo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { formatShortcut } from '@/store/app-store';
import { getEmptyStateConfig, type EmptyStateConfig } from '../constants';
import {
  Lightbulb,
  Play,
  Clock,
  CheckCircle2,
  Sparkles,
  Wand2,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';

const ICON_MAP = {
  lightbulb: Lightbulb,
  play: Play,
  clock: Clock,
  check: CheckCircle2,
  sparkles: Sparkles,
} as const;

interface EmptyStateCardProps {
  columnId: string;
  columnTitle?: string;
  /** Keyboard shortcut for adding features (from settings) */
  addFeatureShortcut?: string;
  /** Whether the column is empty due to active filters */
  isFilteredEmpty?: boolean;
  /** Whether we're in read-only mode (hide actions) */
  isReadOnly?: boolean;
  /** Called when user clicks "Use AI Suggestions" */
  onAiSuggest?: () => void;
  /** Card opacity (matches board settings) */
  opacity?: number;
  /** Enable glassmorphism effect */
  glassmorphism?: boolean;
  /** Custom config override for pipeline steps */
  customConfig?: Partial<EmptyStateConfig>;
}

export const EmptyStateCard = memo(function EmptyStateCard({
  columnId,
  columnTitle,
  addFeatureShortcut,
  isFilteredEmpty = false,
  isReadOnly = false,
  onAiSuggest,
  opacity = 100,
  glassmorphism = true,
  customConfig,
}: EmptyStateCardProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Get base config and merge with custom overrides
  const baseConfig = getEmptyStateConfig(columnId);
  const config: EmptyStateConfig = { ...baseConfig, ...customConfig };

  // Handle dismissal
  if (isDismissed) {
    return null;
  }

  const IconComponent = ICON_MAP[config.icon];
  const showActions = !isReadOnly && !isFilteredEmpty;
  const showShortcut = columnId === 'backlog' && addFeatureShortcut && showActions;

  // Minimized state - compact indicator
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className={cn(
          'w-full p-3 rounded-lg',
          'border-2 border-dashed border-border/40',
          'bg-card/30 hover:bg-card/50',
          'transition-all duration-200 ease-out',
          'flex items-center justify-center gap-2',
          'text-muted-foreground/60 hover:text-muted-foreground',
          'cursor-pointer group',
          'animate-in fade-in duration-300'
        )}
        data-testid={`empty-state-minimized-${columnId}`}
      >
        <Eye className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-medium">Show guidance</span>
      </button>
    );
  }

  // Action button handler
  const handlePrimaryAction = () => {
    if (!config.primaryAction) return;
    if (config.primaryAction.actionType === 'ai-suggest') {
      onAiSuggest?.();
    }
  };

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden',
        'border-2 border-dashed border-border/50',
        'transition-all duration-300 ease-out',
        'animate-in fade-in slide-in-from-top-2 duration-300',
        'hover:border-border/70'
      )}
      data-testid={`empty-state-card-${columnId}`}
    >
      {/* Background with opacity */}
      <div
        className={cn('absolute inset-0 bg-card/50 -z-10', glassmorphism && 'backdrop-blur-sm')}
        style={{ opacity: opacity / 100 }}
      />

      {/* Dismiss/Minimize controls */}
      <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
        <button
          onClick={() => setIsMinimized(true)}
          className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          title="Minimize guidance"
        >
          <EyeOff className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Header with icon */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
              'bg-primary/10 text-primary/70'
            )}
          >
            <IconComponent className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h4 className="font-medium text-sm text-foreground/90 mb-1">
              {isFilteredEmpty ? 'No Matching Items' : config.title}
            </h4>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              {isFilteredEmpty
                ? 'No features match your current filters. Try adjusting your filter criteria.'
                : config.description}
            </p>
          </div>
        </div>

        {/* Keyboard shortcut hint */}
        {showShortcut && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-xs text-muted-foreground/70">
              {config.shortcutHint || 'Press'}
            </span>
            <Kbd className="bg-background/80 border border-border/50 px-2 py-0.5 font-semibold">
              {formatShortcut(addFeatureShortcut, true)}
            </Kbd>
            <span className="text-xs text-muted-foreground/70">to add a feature</span>
          </div>
        )}

        {/* Example card preview */}
        {config.exampleCard && (
          <div
            className={cn(
              'p-3 rounded-lg',
              'border border-dashed border-border/30',
              'bg-muted/20',
              'opacity-60'
            )}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1">
              {config.exampleCard.category}
            </div>
            <div className="text-sm font-medium text-muted-foreground/60">
              {config.exampleCard.title}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {showActions && config.primaryAction && config.primaryAction.actionType !== 'none' && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs border-dashed"
            onClick={handlePrimaryAction}
            data-testid={`empty-state-primary-action-${columnId}`}
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5" />
            {config.primaryAction.label}
          </Button>
        )}

        {/* Filtered empty state hint */}
        {isFilteredEmpty && (
          <p className="text-xs text-center text-muted-foreground/50 italic">
            Clear filters to see all items
          </p>
        )}
      </div>
    </div>
  );
});
