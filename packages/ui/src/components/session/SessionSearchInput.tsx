import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PICKER_SEARCH_INPUT_CLASS } from '@/components/ui/MobileSheetList';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type SessionSearchInputProps = {
  value: string;
  onSearch: (query: string) => void;
  placeholder: string;
  clearLabel: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onClose?: () => void;
  active?: boolean;
  mobile?: boolean;
  /** Replaces the Enter hint on the left of the hint row (e.g. a match count). */
  leadingHint?: React.ReactNode;
  /** Right-aligned hint on the same row as the Enter hint. */
  trailingHint?: React.ReactNode;
  /** Hides the default Enter/Esc hints; an explicit leadingHint still shows the row. */
  hideHints?: boolean;
};

// Draft text stays here: typing must not invalidate the session tree or run its
// search projection. Parents receive only submitted queries and explicit clears.
export function SessionSearchInput({
  value, onSearch, placeholder, clearLabel, inputRef, onClose, active = true, mobile = false,
  leadingHint, trailingHint, hideHints = false,
}: SessionSearchInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState(value);
  const composing = React.useRef(false);
  const ownRef = React.useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  const hintId = React.useId();
  // A narrow list drops the default shortcut hints, but a match count is
  // feedback about the search, not a hint, so it still gets its row.
  const hasHintText = leadingHint != null || !hideHints;
  const showHintRow = !mobile && (hasHintText || trailingHint != null);

  React.useLayoutEffect(() => {
    setDraft(value);
    composing.current = false;
  }, [value, active]);

  const clear = () => {
    if (!active) return;
    setDraft('');
    if (value !== '') onSearch('');
  };

  return (
    <div>
      <div className={cn('relative', mobile && 'border-b border-edge-muted py-1')}>
        <Icon name="search" className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', mobile ? 'inset-s-2.5 size-3.5' : 'inset-s-2 size-4')} />
        <Input
          ref={ref}
          value={draft}
          aria-label={placeholder}
          aria-describedby={hasHintText ? hintId : undefined}
          enterKeyHint="search"
          placeholder={placeholder}
          className={mobile ? cn(PICKER_SEARCH_INPUT_CLASS, 'pe-8') : 'h-8 w-full rounded-md border border-border bg-transparent ps-8 pe-8 typography-ui-label text-foreground'}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (active && !composing.current && next.trim().length === 0 && value !== '') onSearch('');
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(event) => {
            composing.current = false;
            if (active && event.currentTarget.value.trim().length === 0 && value !== '') onSearch('');
          }}
          onKeyDown={(event) => {
            if (!active || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              const query = event.currentTarget.value.trim();
              if (!event.repeat && query !== value) onSearch(query);
            } else if (event.key === 'Escape' && (draft.length > 0 || value.length > 0 || onClose)) {
              event.preventDefault();
              event.stopPropagation();
              if (draft.length > 0 || value.length > 0) clear();
              else onClose?.();
            }
          }}
        />
        {draft.length > 0 || value.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={clearLabel}
            className={cn('absolute inset-e-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground', mobile && 'inset-e-0')}
            onClick={() => { clear(); ref.current?.focus(); }}
          >
            <Icon name="close" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {/* The phone keyboard's own search key explains itself; the hint row is desktop-only. */}
      {showHintRow ? (
        <div className="mt-1 flex items-center justify-between gap-2 typography-micro text-muted-foreground">
          {hasHintText ? (
            <p id={hintId} className="min-w-0 truncate">{leadingHint ?? t('sessions.search.submitHint')}</p>
          ) : null}
          {trailingHint ? <span className="shrink-0">{trailingHint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
