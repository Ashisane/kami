import type { LibraryStage } from './stage/LibraryStage';
import type { Store } from './state';

/** Everything a panel needs. Panels talk to the stage and store, never to each other. */
export interface LibraryContext {
  stage: LibraryStage;
  store: Store;
}
