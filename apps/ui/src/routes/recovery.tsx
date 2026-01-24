import { createFileRoute } from '@tanstack/react-router';
import { RecoveryView } from '@/components/views/recovery-view';

export const Route = createFileRoute('/recovery')({
  component: RecoveryView,
});
