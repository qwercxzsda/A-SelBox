import { useQuery } from "@tanstack/react-query";
import { fetchPayoutPolicy } from "./api";
import type { Identity } from "./auth-session";

/** This tiny policy read advances date-dependent views when another day becomes mature. */
export function usePayoutPolicy(identity: Identity) {
  return useQuery({
    queryKey: ["payout-policy", identity.session.user.id],
    queryFn: ({ signal }) => fetchPayoutPolicy(identity.session.access_token, signal),
    staleTime: 60_000,
  });
}
