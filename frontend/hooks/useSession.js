import { useEffect } from 'react';
import useSWR from 'swr';
import { useSessionContext } from '../contexts/SessionContext';

export function useSession(sessionId) {
    const sessionContext = useSessionContext();

    // Use SWR for data fetching with reduced polling since sessions are instantly ready
    const { data, error, mutate } = useSWR(
        sessionId ? `/sessions/${sessionId}` : null,
        sessionContext.fetcher,
        {
            refreshInterval: 30000, // Reduced from 10s to 30s since no provisioning delays
            revalidateOnFocus: true,
            dedupingInterval: 10000, // Increased deduplication
        }
    );

    // Simplified loading state - no complex provisioning checks needed
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