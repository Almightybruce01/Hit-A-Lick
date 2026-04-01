import { onSchedule } from "firebase-functions/v2/scheduler";
import { handler as propsHandler } from "./sportsdataapi/props.js";

/**
 * Daily prefetch at 3:00 AM America/Chicago:
 * warms next-day windows so app tabs load fast at open.
 */
export const prefetchNextDayProps = onSchedule(
  { schedule: "0 3 * * *", timeZone: "America/Chicago" },
  async () => {
    const sports = ["nba", "nfl", "mlb", "wnba"];
    for (const sport of sports) {
      try {
        const result = await propsHandler({
          queryStringParameters: {
            sport,
            windowDays: "2",
            planMode: "max",
            allEventProps: "1",
            skipCache: "1",
            eventPropLimit: "90",
          },
        });
        const status = Number(result?.statusCode || 500);
        console.log(
          `[prefetchNextDayProps] ${sport} -> status=${status} bodyBytes=${String(result?.body || "").length}`
        );
      } catch (err) {
        console.error(`[prefetchNextDayProps] ${sport} failed:`, err?.message || err);
      }
    }
  }
);
