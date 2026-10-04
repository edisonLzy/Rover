import { Inbox as InboxIcon } from 'lucide-react';

export function Inbox({ controlsVisible }: { controlsVisible: boolean }) {
  return (
    <button
      type="button"
      hidden={!controlsVisible}
      disabled
      aria-label="Inbox"
      className="pet-toolbar-trigger col-start-3"
    >
      <InboxIcon />
    </button>
  );
}
