"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getFacilities } from "./api";
import type { Facility } from "./types";

export function useFacilities() {
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFacilities((await getFacilities()).facilities);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not load the facility catalog.",
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  return { facilities, error, retry: load };
}
