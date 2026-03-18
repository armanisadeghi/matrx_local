/**
 * use-client-log — backwards-compat re-export of use-unified-log.
 *
 * All existing callers of emitClientLog / useClientLogSubscriber /
 * clearClientLog / clearClientLogBySource / getClientLogBuffer continue to
 * work without any changes. New code should import directly from
 * use-unified-log to access the full API (AccessEntry, pause, etc.).
 */

export type { LogLevel, ClientLogLine } from "./use-unified-log";
export {
  emitClientLog,
  getClientLogBuffer,
  clearClientLog,
  clearClientLogBySource,
  useClientLogSubscriber,
} from "./use-unified-log";
