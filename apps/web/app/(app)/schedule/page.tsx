import { EmptyState, PageHeader } from '@/components/ui';

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Schedule" description="Weekly calendar by site and area." />
      <EmptyState title="The schedule calendar ships in phase W2">
        The backend is ready: shifts, publish and copy-week are available in the API (<code>/docs</code>).
      </EmptyState>
    </>
  );
}
