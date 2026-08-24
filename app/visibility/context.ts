import type { WorldSnapshot } from "../authority/types.js";
import { visibilityGate } from "./gate.js";
import { observerNamespace, toObserverContext, type ObserverContext } from "./pool.js";
import { packPrompt } from "./prompt.js";
import { rankWithinPool } from "./retrieve.js";

export type { ObserverContext } from "./pool.js";

export function contextFor(
  snapshot: WorldSnapshot,
  observerId: string,
  ambient: string[] = [],
): ObserverContext {
  return toObserverContext(visibilityGate(snapshot, observerId, ambient));
}

export function packObserverContext(context: ObserverContext): string {
  return packPrompt(
    rankWithinPool(
      {
        ...context,
        namespace: observerNamespace(context.observerId),
      },
      "",
    ),
  );
}
