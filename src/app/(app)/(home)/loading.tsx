import { ProjectsHomeSkeleton } from "@/components/projects/projects-home-skeleton";

/**
 * Shaped like the projects home ("/"): header, toolbar and card grid. Sibling pages (profile,
 * settings, notifications) inherit it until they add their own loading.tsx.
 */
export default function HomeLoading() {
  return <ProjectsHomeSkeleton />;
}
