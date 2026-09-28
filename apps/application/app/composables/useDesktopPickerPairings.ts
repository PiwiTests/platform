/**
 * Desktop shell: the pairings Piwi Picker asked for and the developer has not
 * answered yet, oldest first. The desktop event stream delivers each one as a
 * `picker-pairing` message, again when it is answered (in this window or
 * another) or expires; the dialog shows the first still waiting.
 */
import type { PairingView } from '#shared/desktop-pairing';

export function useDesktopPickerPairings() {
  const queue = useState<PairingView[]>('desktop-picker-pairings', () => []);

  function receive(pairing: PairingView) {
    const others = queue.value.filter((p) => p.id !== pairing.id);
    queue.value = pairing.status === 'waiting' ? [...others, pairing] : others;
  }

  function remove(id: string) {
    queue.value = queue.value.filter((p) => p.id !== id);
  }

  const current = computed(() => queue.value[0] ?? null);

  return { queue, current, receive, remove };
}
