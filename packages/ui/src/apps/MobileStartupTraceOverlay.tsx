import React from 'react';

import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/lib/clipboard';
import { getMobileConnectDebugText } from './mobileConnectionDebug';

// Phone-side reader for the cold-launch trace on the mobile WEB: the hidden
// long-press panel lives in the native Instances sheet, which a browser build
// does not render, and reading `window.__OPENCHAMBER_CONNECT_DEBUG__()` needs a
// tethered inspector. Opt in with `?connectDebug=1`: a floating pill expands to
// the raw trail with a re-snapshot and one-tap copy, so a phone-only run can be
// captured without a computer.
export const MobileStartupTraceOverlay: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  const refresh = React.useCallback(() => {
    setText(getMobileConnectDebugText());
    setCopied(false);
    setOpen(true);
  }, []);

  const copy = React.useCallback(() => {
    void copyTextToClipboard(text).then((result) => {
      if (result.ok) setCopied(true);
    });
  }, [text]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={refresh}
        className="fixed right-3 z-[90] rounded-full border border-border/70 bg-surface-elevated px-3 py-2 typography-small text-foreground shadow-lg"
        style={{ bottom: 'calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px)' }}
      >
        trace
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-background text-foreground">
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2"
        style={{ paddingTop: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 8px)' }}
      >
        <span className="min-w-0 flex-1 truncate typography-ui-label">startup trace</span>
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          refresh
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={copy} disabled={text.length === 0}>
          {copied ? 'copied' : 'copy'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          close
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 typography-code text-muted-foreground">
        {text}
      </pre>
    </div>
  );
};
