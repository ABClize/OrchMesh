import { AnimatedValue } from "@/components/relationship-diagram/AnimatedValue";
import {
  Check,
  CircleDashed,
  CircleAlert,
  Pause,
  MessageCircle,
  Workflow,
} from "lucide-react";
import { ThinkingLoader } from "@/components/ui/thinking-loader";
import { activityLabel } from "./model";

export function activityTone(activity: string) {
  if (["executing", "running"].includes(activity)) return "running";
  if (activity === "failed") return "failed";
  if (activity.startsWith("waiting")) return "waiting";
  if (activity === "completed") return "completed";
  return "idle";
}
// Mixed aggregates retain their counts; this only chooses the leading visual cue.
export function leadingActivity(counts: Record<string, number>) {
  return (
    [
      "failed",
      "waiting_user",
      "executing",
      "running",
      "waiting_dependency",
      "waiting",
      "resuming_or_transitioning",
      "queued",
      "stopped",
      "completed",
    ].find((key) => counts[key] > 0) ?? "unknown"
  );
}
export function ObservationStatus({ activity }: { activity: string }) {
  const tone = activityTone(activity);
  const Icon =
    tone === "completed"
      ? Check
      : tone === "failed"
        ? CircleAlert
        : activity === "waiting_user"
          ? MessageCircle
          : tone === "waiting"
            ? Pause
            : CircleDashed;
  return (
    <AnimatedValue
      value={activityLabel(activity)}
      className="observation-status"
      data-tone={tone}
    >
      {tone === "running" ? (
        <ThinkingLoader
          phases={[activityLabel(activity)]}
          phase={0}
          variant="plain"
          size="sm"
        />
      ) : (
        <>
          <Icon size={13} aria-hidden="true" />
          {activityLabel(activity)}
        </>
      )}
    </AnimatedValue>
  );
}
export function AgentIdentity({
  name,
  root = false,
}: {
  name: string;
  root?: boolean;
}) {
  return (
    <span className="observation-avatar" data-root={root} aria-hidden="true">
      {root ? (
        <Workflow size={20} />
      ) : (
        name.trim().slice(0, 1).toUpperCase() || "A"
      )}
    </span>
  );
}
