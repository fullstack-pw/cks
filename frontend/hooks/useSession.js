// frontend/hooks/useSession.js - Updated version using the consolidated context

import { useEffect } from 'react';
import useSWR from 'swr';
import { useSessionContext } from '../contexts/SessionContext';

export function useSession(sessionId) {
    const sessionContext = useSessionContext();

    // Use SWR for data fetching with automatic revalidation
    const { data, error, mutate } = useSWR(
        sessionId ? `/sessions/${sessionId}` : null,
        sessionContext.fetcher,
        {
            refreshInterval: 10000, // Refresh every 10 seconds
            revalidateOnFocus: true,
            dedupingInterval: 5000,
        }
    );

    // Get the loading state from context
    const isLoading = sessionContext.loading || (!error && !data);

    return {
        session: data,
        isLoading,
        isError: !!error,
        error: error,

        // Actions from context
        createSession: sessionContext.createSession,
        deleteSession: sessionContext.deleteSession,
        extendSession: sessionContext.extendSession,
        validateTask: sessionContext.validateTask,
        createTerminal: sessionContext.createTerminal,

        // SWR refresh
        refresh: mutate
    };
}

export default useSession;