import { TimelineExperience } from "@/components/timeline/timeline-experience";
import { getTimelineEvents } from "@/lib/timeline";

export default function HomePage() {
  const events = getTimelineEvents();

  return <TimelineExperience events={events} />;
}
