import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getCurrentProjectKey, PROJECT_STORAGE_KEY, type Project } from './api';

interface ProjectContextValue {
  projectKey: string | null;
  project?: Project;
  projects: Project[];
  setProjectKey: (key: string) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  projectKey: null,
  projects: [],
  setProjectKey: () => undefined,
});

// Queries that don't depend on the current project survive a project switch.
const PROJECT_INDEPENDENT = new Set(['me', 'projects', 'project', 'users', 'filters', 'issue', 'comments', 'history', 'search', 'quick-search']);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [projectKey, setKey] = useState<string | null>(getCurrentProjectKey());
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    enabled: !!localStorage.getItem('token'),
  });

  const setProjectKey = useCallback(
    (key: string) => {
      if (key === getCurrentProjectKey()) return;
      localStorage.setItem(PROJECT_STORAGE_KEY, key);
      setKey(key);
      // Every request carries X-Project-Key, so refetch project-scoped data.
      queryClient.resetQueries({
        predicate: (q) => !PROJECT_INDEPENDENT.has(String(q.queryKey[0])),
      });
    },
    [queryClient],
  );

  // Pick a default (SPORTS, else the first project) when nothing valid is selected.
  useEffect(() => {
    if (!projects.length || projects.some((p) => p.key === projectKey)) return;
    setProjectKey(projects.find((p) => p.key === 'SPORTS')?.key ?? projects[0].key);
  }, [projects, projectKey, setProjectKey]);

  const project = projects.find((p) => p.key === projectKey);
  return (
    <ProjectContext.Provider value={{ projectKey, project, projects, setProjectKey }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
