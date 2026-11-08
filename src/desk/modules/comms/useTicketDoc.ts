import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../services/firebaseService";
import { DESK_COLLECTIONS, type TicketStatus } from "../../api";

/** The ticket fields the workspace screens read. `recipients` and `credits` are what the PRODUCT measured when the quote was made. */
export interface TicketLiveView {
  status: TicketStatus; amountMinor: number; failureReason?: string; paystackRef?: string; recipients?: number; credits?: number;
  /** A file the product made for this ticket (compliance reports): the link, when it expires (ms) and its name. */
  file?: { downloadUrl: string; expiresAt: number; fileName?: string };
}
export type TicketLive =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; ticket: TicketLiveView };

const fileOf = (v: unknown): TicketLiveView["file"] => {
  const r = v as { downloadUrl?: unknown; expiresAt?: unknown; fileName?: unknown } | null | undefined;
  if (!r || typeof r.downloadUrl !== "string" || !/^https:\/\//.test(r.downloadUrl) || typeof r.expiresAt !== "number") return undefined;
  return { downloadUrl: r.downloadUrl, expiresAt: r.expiresAt, fileName: typeof r.fileName === "string" ? r.fileName : undefined };
};
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/** Live `desk_tickets/{id}` (rules let an agent read only their own). Unlike watchTicket, a failed read is reported, not hidden. */
export function useTicketDoc(ticketId: string): TicketLive {
  const [live, setLive] = useState<TicketLive>({ state: "loading" });
  useEffect(() => {
    setLive({ state: "loading" });
    return onSnapshot(
      doc(db, DESK_COLLECTIONS.tickets, ticketId),
      (s) => {
        if (!s.exists()) { setLive({ state: "error", message: "This quote could not be found. Please start again." }); return; }
        const d = s.data() as Record<string, unknown>;
        setLive({
          state: "ready",
          ticket: {
            status: d.status as TicketStatus, amountMinor: whole(d.amountMinor) ?? 0,
            failureReason: typeof d.failureReason === "string" ? d.failureReason : undefined,
            paystackRef: typeof d.paystackRef === "string" ? d.paystackRef : undefined,
            recipients: whole(d.recipients), credits: whole(d.credits), file: fileOf(d.productResult),
          },
        });
      },
      () => setLive({ state: "error", message: "We couldn't read the quote. Check your connection and try again." }),
    );
  }, [ticketId]);
  return live;
}
