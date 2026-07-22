/** @jsxImportSource @opentui/react */

import { COLORS } from "./theme";
import { VIEW_LABEL } from "./panes";
import type { ArticleView, Feed, NavLevel } from "../types";
import type { SyncSnapshot } from "../sync";
import { truncate } from "../text";

// Segment proportions at a 132-col reference width; budgets scale with the
// actual terminal width so narrow layouts don't overflow.
const STATUS_SEGMENTS = { left: 38, middle: 44, right: 50 } as const;
const REFERENCE_WIDTH = 132;

function segmentBudget(width: number, cols: number): number {
  return Math.max(8, Math.floor((width * cols) / REFERENCE_WIDTH));
}

export function StatusBar({
  snapshot,
  filter,
  filterMode,
  busy,
  selectedFeed,
  activeFeed,
  navLevel,
  view,
  spinner,
  width,
}: {
  snapshot: SyncSnapshot;
  filter: string;
  filterMode: boolean;
  busy: boolean;
  selectedFeed: Feed | null;
  activeFeed: Feed | null;
  navLevel: NavLevel;
  view: ArticleView;
  spinner: string;
  width: number;
}) {
  const unread = snapshot.feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const status = busy ? `${spinner} syncing` : snapshot.status;
  const left = `${status}  \u00B7  ${VIEW_LABEL[view]}  \u00B7  unread ${unread}`;
  const middle = selectedFeed
    ? `${navLevel === "sources" ? "selected" : "source"}: ${selectedFeed.title}`
    : `source: ${activeFeed?.title ?? VIEW_LABEL[view]}`;
  const queue = snapshot.pendingMutations > 0 ? `${snapshot.pendingMutations} queued | ` : "";
  // An applied filter stays visible after the input row closes.
  const filterLabel = filter ? `  /${filter}` : "";
  const right = filterMode ? `/${filter}` : `${queue}${snapshot.message}${filterLabel}`;
  const rightColor =
    snapshot.status === "error" || snapshot.status === "offline" ? COLORS.danger : COLORS.accent;

  return (
    <box height={1} width="100%" flexDirection="row" justifyContent="space-between" backgroundColor={COLORS.statusBarBg}>
      <text fg={COLORS.text}>{truncate(left, segmentBudget(width, STATUS_SEGMENTS.left))}</text>
      <text fg={COLORS.textDim}>{truncate(middle, segmentBudget(width, STATUS_SEGMENTS.middle))}</text>
      <text fg={rightColor}>{truncate(right, segmentBudget(width, STATUS_SEGMENTS.right))}</text>
    </box>
  );
}

export function HelpOverlay() {
  return (
    <box
      position="absolute"
      top={2}
      left={4}
      width={66}
      height={16}
      border
      borderColor={COLORS.borderFocused}
      backgroundColor={COLORS.bg}
      title="Keys"
      padding={1}
    >
      <text fg={COLORS.text}>j/k move   g/G top/bottom   enter/l open   h back</text>
      <text fg={COLORS.text}>in reader: j/k scroll   g/G jump to top/bottom</text>
      <text> </text>
      <text fg={COLORS.text}>m read/unread   s star   v cycle view   o open in browser</text>
      <text fg={COLORS.text}>r sync   / filter   ? help   escape close   q quit</text>
      <text> </text>
      <text fg={COLORS.textDim}>Opening an article marks it read; it stays listed (dimmed)</text>
      <text fg={COLORS.textDim}>until you leave the feed. v cycles Unread / All / Starred.</text>
    </box>
  );
}
