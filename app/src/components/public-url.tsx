"use client";

import { useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";

const noop = () => () => {};

/**
 * Origin for links that leave this browser (QR codes): IntegrationStatus.publicBaseUrl, which the
 * server reads from PUBLIC_BASE_URL at request time, else window.location.origin.
 * Returns null until known so a QR never encodes the wrong host.
 */
export function usePublicBaseUrl(): string | null {
  const status = useApi("integrations", () => api.integrationStatus());
  const origin = useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => null,
  );
  if (status.loading) return null;
  const configured = status.data?.publicBaseUrl;
  return configured ? configured.replace(/\/+$/, "") : origin;
}
