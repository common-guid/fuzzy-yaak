import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '../../../components/Workspace';

type WorkspaceSearchSchema = {
  environment_id?: string | null;
  cookie_jar_id?: string | null;
  view?: 'fuzzer' | null;
} & (
  | {
      request_id: string;
    }
  | {
      folder_id: string;
    }
  // biome-ignore lint/complexity/noBannedTypes: Needed to support empty
  | {}
);

export const Route = createFileRoute('/workspaces/$workspaceId/')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearchSchema => {
    const base: {
      environment_id?: string | null;
      cookie_jar_id?: string | null;
      view?: 'fuzzer' | null;
    } = {
      environment_id: search.environment_id as string,
      cookie_jar_id: search.cookie_jar_id as string,
    };

    const view = search.view as 'fuzzer' | undefined;
    if (view === 'fuzzer') {
      base.view = view;
    }

    const requestId = search.request_id as string | undefined;
    const folderId = search.folder_id as string | undefined;
    if (requestId != null) {
      return { ...base, request_id: requestId };
    }
    if (folderId) {
      return { ...base, folder_id: folderId };
    }
    return base;
  },
});

function RouteComponent() {
  return <Workspace />;
}
