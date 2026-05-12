import { useEffect } from "react";

import { hydrateChatSessionsFromStorage } from "./chatStore";
import { hydratePageSessionsFromStorage } from "./pageSessionStore";
import { hydrateShellStateFromStorage } from "./shellStore";
import { hydrateTranslatorStateFromStorage } from "./translatorStore";
import { hydrateWorkbenchChatSessionsFromStorage } from "./workbenchChatStore";
import { hydrateWorkspaceIdFromStorage } from "./workspaceStore";
import { hydrateClientStateFromServer } from "../shared/lib/clientState";

export function ClientStateHydrator() {
  useEffect(() => {
    let cancelled = false;
    void hydrateClientStateFromServer().then(() => {
      if (cancelled) {
        return;
      }
      hydrateWorkspaceIdFromStorage();
      hydrateShellStateFromStorage();
      hydrateChatSessionsFromStorage();
      hydrateWorkbenchChatSessionsFromStorage();
      hydratePageSessionsFromStorage();
      hydrateTranslatorStateFromStorage();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
