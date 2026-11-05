import { Loading, Screen } from '@/components/ui';

/** Splash while the session loads; the Guard in _layout redirects. */
export default function Index() {
  return (
    <Screen scroll={false}>
      <Loading />
    </Screen>
  );
}
