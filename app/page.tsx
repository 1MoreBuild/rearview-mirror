import { TimelineExperience } from "@/components/timeline/timeline-experience";
import { getModelEvents } from "@/lib/timeline";

export default function HomePage() {
  const events = getModelEvents();

  return (
    <main className="page-shell">
      <TimelineExperience events={events} />
    </main>
  );
}
