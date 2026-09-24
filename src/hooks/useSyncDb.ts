import { useEffect, useState } from "react";
import { db } from "../services/db";

/**
 * useSyncDb — Subscribe to the FatClinic database singleton.
 * Any component that calls this hook will automatically re-render
 * whenever db.notify() fires (i.e. after every create/update/delete).
 */
export function useSyncDb(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = db.subscribe(() => setTick(t => t + 1));
    return unsub;
  }, []);

  return tick;
}
