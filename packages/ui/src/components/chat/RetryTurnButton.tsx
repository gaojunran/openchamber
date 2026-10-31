import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Runs a failed turn again. Flat on purpose: it sits inside a tinted status
 * block, so a raised control there would read as a second surface pasted onto
 * the fill. It takes the disclosure's own size, so the only thing that would
 * change for a text action is the child below.
 */
export const RetryTurnButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ onClick, disabled, className }) => {
  const { t } = useI18n();
  const label = t('chat.sessionError.retry');
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <Icon name="refresh" className="size-3.5" />
    </Button>
  );
};
