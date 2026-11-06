/**
 * Push delivery. Expo today; an SNS/FCM implementation can replace it without touching callers.
 */
export type PushMessage = { to: string; title: string; body: string; data: Record<string, unknown> };
export type PushResult = { token: string; ok: boolean; unregistered?: boolean; error?: string };
export type PushSender = (messages: PushMessage[]) => Promise<PushResult[]>;

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

export function createExpoPushSender(opts: { accessToken?: string; fetch?: typeof fetch } = {}): PushSender {
  const f = opts.fetch ?? fetch;
  return async (messages) => {
    const results: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await f(EXPO_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
          },
          body: JSON.stringify(chunk.map((m) => ({ ...m, sound: 'default' }))),
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: { status: 'ok' | 'error'; message?: string; details?: { error?: string } }[];
        };
        if (!res.ok || !json.data) throw new Error(`Expo push HTTP ${res.status}`);
        json.data.forEach((t, j) =>
          results.push({
            token: chunk[j]!.to,
            ok: t.status === 'ok',
            unregistered: t.details?.error === 'DeviceNotRegistered',
            error: t.status === 'ok' ? undefined : (t.details?.error ?? t.message),
          }),
        );
      } catch (e) {
        for (const m of chunk) results.push({ token: m.to, ok: false, error: (e as Error).message });
      }
    }
    return results;
  };
}

/** For local dev / tests: records messages instead of sending. */
export function createMemoryPushSender() {
  const sent: PushMessage[] = [];
  const sender: PushSender = async (messages) => {
    sent.push(...messages);
    return messages.map((m) => ({ token: m.to, ok: true }));
  };
  return { sender, sent };
}
