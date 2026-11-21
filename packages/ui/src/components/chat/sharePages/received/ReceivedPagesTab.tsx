import { ReceivedPagesList } from './ReceivedPagesList';
import { useOpenReceivedPage } from './openReceivedPage';
import { useListScrollMemory } from '@/hooks/useListScrollMemory';

export function ReceivedPagesTab() {
  const openPage = useOpenReceivedPage();
  const scrollerRef = useListScrollMemory('received-pages');
  return (
    <div ref={scrollerRef} className="h-full min-h-0 overflow-y-auto">
      <ReceivedPagesList onOpen={(page, title) => openPage(page.receivedId, title)} />
    </div>
  );
}
